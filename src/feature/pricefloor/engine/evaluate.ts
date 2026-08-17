/**
 * Pricefloor rule engine — the single pure function that decides quotes.
 *
 *   evaluate(request, ruleSet, costSnapshot) → decision
 *
 * DB- and Shopify-agnostic by design (§3, §12). Callers stamp expiresAt.
 *
 * Wired rule types: margin_floor, product_exception, volume_ladder, tier_cap.
 * Half-wired: terms_swap (read only when producing counter-offer alternatives,
 * not as a Step-2 bonus). Remaining (stock_age, discount_cap) still parse and
 * forward as `warnings: ["skipped:<type>"]` so a rule_set containing them
 * still produces a defensible decision. Filled in later per §6.2 / §6.3.
 *
 * Counter-offer alternatives (`below_floor` only) surface up to 3 upsell
 * paths — bigger qty, prepaid terms, moving to a looser tier — that the
 * MERCHANT can propose to the buyer. Filter: only alternatives that beat
 * the pre-floor bestAfterCaps are surfaced (same-price paths add noise).
 * Not shown to the buyer directly: the offer they receive is the counter
 * unitPrice; alternatives live in the merchant escalation queue.
 */

import type {
  CostSnapshot,
  CounterAlternative,
  Decision,
  DecisionReason,
  MarginFloorParams,
  QuoteDecision,
  QuoteDecisionLine,
  QuoteRequest,
  QuoteRequestLine,
  Rule,
  RuleScope,
  RuleSet,
  TermsSwapParams,
  TierCapParams,
  VolumeLadderParams,
} from "./types";

// ── Public entry point ───────────────────────────────────────
export function evaluate(
  request: QuoteRequest,
  ruleSet: RuleSet,
  costSnapshot: CostSnapshot,
): QuoteDecision {
  const warnings: string[] = collectWarningsForUnsupportedRules(ruleSet);

  const lines: QuoteDecisionLine[] = request.lines.map((line) => {
    const res = evaluateLine(line, request, ruleSet, costSnapshot);
    return {
      ...res,
      requestedUnitPrice: line.requestedUnitPrice,
      basePrice: line.basePrice,
    };
  });

  const rollup = rollUpLines(lines, request);
  const totalPrice =
    rollup.decision === "escalate"
      ? null
      : lines.reduce(
          (sum, l) => sum + (l.unitPrice ?? 0) * l.quantity,
          0,
        );

  return {
    requestId: request.requestId,
    ruleSetVersion: ruleSet.version,
    decision: rollup.decision,
    decisionReason: rollup.reason,
    lines,
    totalPrice,
    currency: request.currency,
    warnings,
  };
}

// ── Per-line evaluation (§6.3 steps 1–5) ─────────────────────
function evaluateLine(
  line: QuoteRequestLine,
  request: QuoteRequest,
  ruleSet: RuleSet,
  costSnapshot: CostSnapshot,
): QuoteDecisionLine {
  const applicable = ruleSet.rules
    .filter((r) => r.enabled)
    .filter((r) => scopeMatches(r.scope, line, request));

  // Hard-lock: product excluded (product_exception) → escalate immediately.
  const excluded = applicable.find((r) => r.params.type === "product_exception");
  if (excluded) {
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: null,
      unitCost: costSnapshot[line.variantId]?.unitCost ?? null,
      marginPct: null,
      appliedRules: [ruleId(excluded)],
      lineReason: "product_excluded",
    };
  }

  const cost = costSnapshot[line.variantId];
  if (!cost || cost.unitCost == null) {
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: null,
      unitCost: null,
      marginPct: null,
      appliedRules: [],
      lineReason: "no_cost_data",
    };
  }

  // Step 1: hard-locks → floor
  const floorResult = computeFloor(cost.unitCost, line.basePrice, applicable);

  // Never turn an impossible margin configuration into a counter offer that
  // is more expensive than the product's list price. A merchant needs to
  // review the cost or floor rule instead.
  if (
    line.basePrice != null &&
    line.basePrice > 0 &&
    floorResult.floor > line.basePrice
  ) {
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: null,
      unitCost: cost.unitCost,
      marginPct: null,
      appliedRules: floorResult.applied,
      lineReason: "rules_inconsistent",
    };
  }

  // Step 2: bonuses → best (starts from basePrice; volume_ladder discounts it)
  const bestResult = computeBest(line, applicable, floorResult.floor);

  // Step 3: tier caps clamp discount → best_after_caps
  const capsResult = applyTierCaps(
    line,
    request,
    applicable,
    bestResult.best,
    floorResult.floor,
  );
  const bestAfterCaps = capsResult.best;
  const bonusApplied = [...bestResult.applied, ...capsResult.applied];

  // Step 4: floor > best → rules inconsistent → escalate.
  // TODO(discount_cap): currently unreachable — computeBest and applyTierCaps
  // both clamp with Math.max(_, floor). Kept as a safety net for when
  // discount_cap (forces best UPWARD) is wired; a misconfigured cap can then
  // invert the ordering and this MUST escalate. Remove only when the engine
  // guarantees floor ≤ best under every rule combination.
  if (floorResult.floor > bestAfterCaps) {
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: null,
      unitCost: cost.unitCost,
      marginPct: null,
      appliedRules: [...floorResult.applied, ...bonusApplied],
      lineReason: "rules_inconsistent",
    };
  }

  // Step 5: every quote requires merchant approval. Rules still calculate
  // the safe floor and validate the request, but the engine never commits a
  // price or creates a customer-facing offer on its own.
  const requested = line.requestedUnitPrice;
  const applied = [...floorResult.applied, ...bonusApplied];
  return {
    variantId: line.variantId,
    quantity: line.quantity,
    unitPrice: null,
    unitCost: cost.unitCost,
    marginPct: null,
    appliedRules: applied,
    lineReason: "manual_review_required",
  };
}

function decidedLine(
  line: QuoteRequestLine,
  unitCost: number,
  unitPrice: number,
  applied: string[],
  reason: DecisionReason,
): QuoteDecisionLine {
  return {
    variantId: line.variantId,
    quantity: line.quantity,
    unitPrice,
    unitCost,
    marginPct: marginPct(unitPrice, unitCost),
    appliedRules: applied,
    lineReason: reason,
  };
}

// ── Floor computation from margin_floor rules ────────────────
function computeFloor(
  unitCost: number,
  basePrice: number | undefined,
  applicable: Rule[],
): { floor: number; applied: string[] } {
  const marginRules = applicable.filter(
    (r): r is Rule & { params: MarginFloorParams & { type: "margin_floor" } } =>
      r.params.type === "margin_floor",
  );

  if (marginRules.length === 0) {
    // No floor rule → floor is unit_cost itself. Engine will never approve
    // a price below cost even if the merchant forgot to configure a rule.
    return { floor: unitCost, applied: [] };
  }

  let floor = unitCost;
  const applied: string[] = [];
  for (const rule of marginRules) {
    const candidate = rule.params.kind === "max_discount"
      ? basePrice != null && basePrice > 0
        ? basePrice * (1 - rule.params.maxDiscountPct / 100)
        : unitCost
      : rule.params.kind === "percent"
        ? basePrice != null && basePrice > 0
          ? basePrice * (1 - rule.params.minMarginPct / 100)
          : unitCost
        : unitCost + rule.params.minMarginAmount;
    if (candidate > floor) floor = candidate;
    applied.push(ruleId(rule));
  }
  return { floor: round2(floor), applied };
}

// ── Best price from bonuses (volume_ladder) ──────────────────
function computeBest(
  line: QuoteRequestLine,
  applicable: Rule[],
  floor: number,
  extraBonusPct = 0,
): { best: number; applied: string[] } {
  // Without a basePrice, the engine has no reference to discount from.
  // Fall back to floor — the buyer will still get an offer, just no ladder.
  if (line.basePrice == null || line.basePrice <= 0) {
    return { best: floor, applied: [] };
  }

  const ladderRules = applicable.filter(
    (r): r is Rule & { params: VolumeLadderParams & { type: "volume_ladder" } } =>
      r.params.type === "volume_ladder",
  );

  let bestDiscountPct = 0;
  const applied: string[] = [];
  for (const rule of ladderRules) {
    const tier = pickLadderTier(rule.params.tiers, line.quantity);
    if (tier && tier.discountPct > bestDiscountPct) {
      bestDiscountPct = tier.discountPct;
    }
    if (tier) applied.push(ruleId(rule));
  }

  const totalDiscountPct = bestDiscountPct + extraBonusPct;
  const best = line.basePrice * (1 - totalDiscountPct / 100);
  // Never quote below the margin floor even if the ladder is aggressive.
  return { best: round2(Math.max(best, floor)), applied };
}

function pickLadderTier(
  tiers: VolumeLadderParams["tiers"],
  quantity: number,
): VolumeLadderParams["tiers"][number] | null {
  // Highest minQty <= quantity wins. Merchant may enter tiers unordered.
  let winner: VolumeLadderParams["tiers"][number] | null = null;
  for (const t of tiers) {
    if (t.minQty <= quantity && (!winner || t.minQty > winner.minQty)) {
      winner = t;
    }
  }
  return winner;
}

// ── Tier caps (ceiling on discount) ──────────────────────────
function applyTierCaps(
  line: QuoteRequestLine,
  request: QuoteRequest,
  applicable: Rule[],
  best: number,
  floor: number,
): { best: number; applied: string[] } {
  // No basePrice → cap is meaningless (nothing to cap discount off).
  // No tier on the request → tier_cap rules cannot bind.
  if (line.basePrice == null || !request.company.tier) {
    return { best, applied: [] };
  }

  const capRules = applicable.filter(
    (r): r is Rule & { params: TierCapParams & { type: "tier_cap" } } =>
      r.params.type === "tier_cap" && r.params.tier === request.company.tier,
  );
  if (capRules.length === 0) return { best, applied: [] };

  // Tightest cap wins (smallest maxDiscountPct → highest min price).
  const tightest = capRules.reduce((min, r) =>
    r.params.maxDiscountPct < min.params.maxDiscountPct ? r : min,
  );
  const minAllowed = line.basePrice * (1 - tightest.params.maxDiscountPct / 100);

  // Push best UP if the ladder discounted below the tier's cap. Never below floor.
  const capped = Math.max(best, minAllowed);
  return {
    best: round2(Math.max(capped, floor)),
    applied: [ruleId(tightest)],
  };
}

// ── Counter alternatives (upsell paths when below_floor) ─────
function computeAlternatives(
  line: QuoteRequestLine,
  request: QuoteRequest,
  applicable: Rule[],
  floor: number,
  currentBest: number,
): CounterAlternative[] {
  const raw: (CounterAlternative | null)[] = [
    buildVolumeAlternative(line, request, applicable, floor),
    buildTermsAlternative(line, request, applicable, floor),
    buildTierUpgradeAlternative(line, request, applicable, floor),
  ];
  // Only surface alternatives that BEAT the current bestAfterCaps. Alternatives
  // that land at the same price add noise (same outcome via a different path).
  return raw.filter(
    (a): a is CounterAlternative => a != null && a.unitPrice < currentBest,
  );
}

/** Volume upsell — nearest ladder tier ABOVE current qty, run through the
 *  same computeBest+applyTierCaps pipeline so tier caps still bind. */
function buildVolumeAlternative(
  line: QuoteRequestLine,
  request: QuoteRequest,
  applicable: Rule[],
  floor: number,
): CounterAlternative | null {
  if (line.basePrice == null || line.basePrice <= 0) return null;

  const ladderRules = applicable.filter(
    (r): r is Rule & { params: VolumeLadderParams & { type: "volume_ladder" } } =>
      r.params.type === "volume_ladder",
  );
  if (ladderRules.length === 0) return null;

  const upstream = ladderRules
    .flatMap((r) => r.params.tiers)
    .filter((t) => t.minQty > line.quantity)
    .sort((a, b) => a.minQty - b.minQty);
  const target = upstream[0];
  if (!target) return null;

  const simulatedLine: QuoteRequestLine = { ...line, quantity: target.minQty };
  const unitPrice = computeBestFinal(simulatedLine, request, applicable, floor);

  return {
    trigger: "volume_upsell",
    description: `Increase to ${target.minQty} units to unlock ${target.discountPct}% off`,
    unitPrice,
    totalPrice: round2(unitPrice * target.minQty),
    meta: { minQty: target.minQty, discountPct: target.discountPct },
  };
}

/** Terms upsell — combine current ladder discount with prepaid bonus, still
 *  clamped by tier cap and floor. */
function buildTermsAlternative(
  line: QuoteRequestLine,
  request: QuoteRequest,
  applicable: Rule[],
  floor: number,
): CounterAlternative | null {
  if (line.basePrice == null || line.basePrice <= 0) return null;
  if (request.terms?.payment === "prepaid") return null; // already prepaid

  const swapRules = applicable.filter(
    (r): r is Rule & { params: TermsSwapParams & { type: "terms_swap" } } =>
      r.params.type === "terms_swap",
  );
  const prepaidPct = swapRules
    .map((r) => r.params.prepaid ?? 0)
    .reduce((max, p) => (p > max ? p : max), 0);
  if (prepaidPct <= 0) return null;

  const unitPrice = computeBestFinal(line, request, applicable, floor, prepaidPct);
  return {
    trigger: "terms_prepaid",
    description: `Pay upfront (prepaid) to unlock an extra ${prepaidPct}% off`,
    unitPrice,
    totalPrice: round2(unitPrice * line.quantity),
    meta: { extraDiscountPct: prepaidPct },
  };
}

/**
 * Tier upgrade — surface the CHEAPER tier the buyer could reach.
 * Motor knows no tier hierarchy: it just picks the tier_cap rule with the
 * loosest (highest) maxDiscountPct that beats the buyer's current cap.
 * Merchant is warned that this exposes tier pricing — see plan §6 discussion.
 */
function buildTierUpgradeAlternative(
  line: QuoteRequestLine,
  request: QuoteRequest,
  applicable: Rule[],
  floor: number,
): CounterAlternative | null {
  if (line.basePrice == null || line.basePrice <= 0) return null;
  if (!request.company.tier) return null;

  const capRules = applicable.filter(
    (r): r is Rule & { params: TierCapParams & { type: "tier_cap" } } =>
      r.params.type === "tier_cap",
  );
  if (capRules.length === 0) return null;

  const currentCap = capRules.find((r) => r.params.tier === request.company.tier);
  const currentPct = currentCap?.params.maxDiscountPct ?? 0;

  // Find the tier with the largest cap that still beats current.
  const better = capRules
    .filter((r) => r.params.maxDiscountPct > currentPct)
    .sort((a, b) => b.params.maxDiscountPct - a.params.maxDiscountPct)[0];
  if (!better) return null;

  const simulatedRequest: QuoteRequest = {
    ...request,
    company: { ...request.company, tier: better.params.tier },
  };
  const unitPrice = computeBestFinal(line, simulatedRequest, applicable, floor);

  return {
    trigger: "tier_upgrade",
    description: `Upgrade to "${better.params.tier}" tier to allow up to ${better.params.maxDiscountPct}% off`,
    unitPrice,
    totalPrice: round2(unitPrice * line.quantity),
    meta: { targetTier: better.params.tier, maxDiscountPct: better.params.maxDiscountPct },
  };
}

/** Run computeBest + applyTierCaps just like the mainline evaluator does,
 *  optionally with an extra bonus (e.g. terms_swap prepaid pct) added into
 *  the ladder discount. Returns the final unit price, clamped to floor. */
function computeBestFinal(
  line: QuoteRequestLine,
  request: QuoteRequest,
  applicable: Rule[],
  floor: number,
  extraBonusPct = 0,
): number {
  const b = computeBest(line, applicable, floor, extraBonusPct);
  const c = applyTierCaps(line, request, applicable, b.best, floor);
  return c.best;
}

// ── Line → quote roll-up (§6.3 step 6) ───────────────────────
function rollUpLines(
  lines: QuoteDecisionLine[],
  request: QuoteRequest,
): { decision: Decision; reason: DecisionReason } {
  const escalated = lines.filter(
    (l) => l.lineReason && isEscalateReason(l.lineReason),
  );
  if (escalated.length > 0) {
    // If any line escalates, whole quote escalates. Single-line: bubble up
    // the actionable line reason. Multi-line: use line_escalated so admin
    // sees the whole picture in the queue.
    if (lines.length === 1) {
      return { decision: "escalate", reason: escalated[0].lineReason! };
    }
    return { decision: "escalate", reason: "line_escalated" };
  }

  const countered = lines.filter((l) => l.lineReason === "below_floor");
  if (countered.length > 0) {
    return { decision: "counter_offer", reason: "below_floor" };
  }

  // All lines approved. Reason mirrors whether the buyer asked for a price.
  const anyRequested = request.lines.some((l) => l.requestedUnitPrice != null);
  return {
    decision: "auto_approve",
    reason: anyRequested ? "requested_matches_best" : "no_request_best_offered",
  };
}

function isEscalateReason(reason: DecisionReason): boolean {
  return (
    reason === "no_cost_data" ||
    reason === "product_excluded" ||
    reason === "rules_inconsistent" ||
    reason === "manual_review_required"
  );
}

// ── Scope + helpers ──────────────────────────────────────────
function scopeMatches(
  scope: RuleScope,
  line: QuoteRequestLine,
  request: QuoteRequest,
): boolean {
  if (scope.variantIds?.length && !scope.variantIds.includes(line.variantId)) return false;
  if (scope.productIds?.length) {
    if (!line.productId || !scope.productIds.includes(line.productId)) return false;
  }
  // collectionIds still require a collection lookup adapter. Empty arrays are
  // treated as no filter.
  if (scope.companyTiers?.length) {
    if (!request.company.tier) return false;
    if (!scope.companyTiers.includes(request.company.tier)) return false;
  }
  return true;
}

function collectWarningsForUnsupportedRules(ruleSet: RuleSet): string[] {
  // terms_swap is "half-wired": read only inside counter-offer alternatives,
  // not as a bonus in the mainline computeBest. Listed as supported so it
  // doesn't spam warnings; ideal wire-up moves it into Step 2 in the future.
  const supported: Rule["type"][] = [
    "margin_floor",
    "product_exception",
    "volume_ladder",
    "tier_cap",
    "terms_swap",
  ];
  const skipped = new Set<string>();
  for (const rule of ruleSet.rules) {
    if (!rule.enabled) continue;
    if (!supported.includes(rule.type)) skipped.add(rule.type);
  }
  return [...skipped].map((t) => `skipped:${t}`);
}

function ruleId(rule: Rule): string {
  return `${rule.type}:${rule.id}`;
}

function marginPct(unitPrice: number, unitCost: number): number {
  if (unitPrice <= 0) return 0;
  return round2(((unitPrice - unitCost) / unitPrice) * 100);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
