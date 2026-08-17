/**
 * Pricefloor rule-engine domain types.
 *
 * Deliberately DB- and Shopify-agnostic. The engine is a pure function
 * over these types so it stays testable and reusable (agent bridge, §12).
 */

// ── Money ────────────────────────────────────────────────────
export type CurrencyCode = string; // ISO-4217 (e.g. "USD")

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

// ── Inbound request (§6.1) ───────────────────────────────────
export interface QuoteRequestLine {
  variantId: string; // Shopify GID
  productId?: string; // Shopify Product GID, required for product-scoped rules
  quantity: number;
  /** Optional: alıcı's asking price per unit. Omit for "what's your best?" */
  requestedUnitPrice?: number;
  /**
   * Optional: reference list price the engine discounts from.
   * Callers pass Shopify variant.price. Without it, volume_ladder and
   * tier_cap are skipped (engine stays list-price-agnostic).
   */
  basePrice?: number;
}

export type CompanyTier = string; // free-form ("gold"|"silver"|... — merchant defines)

export interface CompanyInfo {
  /** Shopify B2B company GID. */
  id: string;
  tier?: CompanyTier;
}

export interface PaymentTerms {
  payment?: string;       // e.g. "net30", "prepaid"
  leadTimeDays?: number;
}

export interface QuoteRequest {
  requestId: string;
  company: CompanyInfo;
  lines: QuoteRequestLine[];
  terms?: PaymentTerms;
  currency: CurrencyCode;
}

// ── Cost snapshot (§5.2) ─────────────────────────────────────
export interface CostEntry {
  /** NULL when Shopify has no cost — engine MUST escalate this line. */
  unitCost: number | null;
  currency: CurrencyCode;
  /** Epoch millis. Engine callers filter by TTL before invoking. */
  fetchedAt: number;
  inventoryQuantity?: number;
}

/** variantId → CostEntry. Engine treats missing keys as "no cost data". */
export type CostSnapshot = Record<string, CostEntry>;

// ── Rules (§6.2) ─────────────────────────────────────────────
export type RuleType =
  | "margin_floor"
  | "volume_ladder"
  | "tier_cap"
  | "stock_age"
  | "product_exception"
  | "terms_swap"
  | "discount_cap";

/** Restricts a rule's applicability. All fields optional; empty = global. */
export interface RuleScope {
  productIds?: string[];    // Shopify Product GIDs
  variantIds?: string[];    // Shopify Variant GIDs
  collectionIds?: string[];
  companyTiers?: CompanyTier[];
}

// Discriminated-union rule params. Add types as MVP → phase 2 expands.
export type MarginFloorParams =
  | { kind: "max_discount"; maxDiscountPct: number } // e.g. 20 = never sell below 80% of list price
  | { kind: "percent"; minMarginPct: number }   // legacy v1: interpreted as max discount
  | { kind: "absolute"; minMarginAmount: number }; // per-unit currency amount above unit_cost

export interface VolumeLadderParams {
  /** Ordered by minQty ASC. Engine picks the highest tier whose minQty <= requested qty. */
  tiers: Array<{ minQty: number; discountPct: number }>;
}

export interface TierCapParams {
  /** Maximum discount percentage this tier is ever allowed. */
  tier: CompanyTier;
  maxDiscountPct: number;
}

export interface StockAgeParams {
  /** Days threshold — variants older than this get extra room. */
  minAgeDays: number;
  addPct: number;
}

export interface ProductExceptionParams {
  /** Products in this list are non-negotiable; force escalate. */
  reason: "map" | "new_season" | "brand_protected";
}

export interface TermsSwapParams {
  /** Optional add-on percentages when specific terms are agreed. */
  prepaid?: number;
  extendedLeadTime?: { minDays: number; addPct: number };
  mixedPallet?: number;
}

export interface DiscountCapParams {
  /** Absolute ceiling on total discount %, regardless of accumulated bonuses. */
  maxTotalDiscountPct: number;
}

export type RuleParams =
  | ({ type: "margin_floor" }      & MarginFloorParams)
  | ({ type: "volume_ladder" }     & VolumeLadderParams)
  | ({ type: "tier_cap" }          & TierCapParams)
  | ({ type: "stock_age" }         & StockAgeParams)
  | ({ type: "product_exception" } & ProductExceptionParams)
  | ({ type: "terms_swap" }        & TermsSwapParams)
  | ({ type: "discount_cap" }      & DiscountCapParams);

export interface Rule {
  id: string;
  type: RuleType;
  priority: number;
  scope: RuleScope;
  enabled: boolean;
  params: RuleParams;
}

export interface RuleSet {
  id: string;
  version: number;
  rules: Rule[];
}

// ── Decision output (§6.4) ───────────────────────────────────
export type Decision = "auto_approve" | "counter_offer" | "escalate";

export type DecisionReason =
  // auto_approve
  | "requested_matches_best"
  | "requested_between_floor_and_best"
  | "no_request_best_offered"
  // counter_offer
  | "below_floor"
  | "discount_cap_exceeded"
  // escalate
  | "no_cost_data"
  | "product_excluded"
  | "rules_inconsistent"
  | "line_escalated"
  | "manual_review_required";

export interface QuoteDecisionLine {
  variantId: string;
  quantity: number;
  requestedUnitPrice?: number;
  basePrice?: number;
  /** Unit price the engine recommends OR would counter with. Null only when escalated. */
  unitPrice: number | null;
  unitCost: number | null;
  marginPct: number | null;
  appliedRules: string[];
  /** Per-line reason surfaced when roll-up escalation would otherwise hide it. */
  lineReason?: DecisionReason;
  /**
   * Populated only when the line was countered (below_floor). Each entry
   * describes ONE alternative path the buyer could take to improve the price
   * without breaching the floor. Non-binding — merchant/UI decides how to
   * surface them.
   */
  alternatives?: CounterAlternative[];
}

export type CounterAlternativeTrigger =
  | "volume_upsell"
  | "terms_prepaid"
  | "tier_upgrade";

export interface CounterAlternative {
  trigger: CounterAlternativeTrigger;
  /** Human-readable one-liner. Engine keeps English; UI localizes if needed. */
  description: string;
  unitPrice: number;
  totalPrice: number;
  /** Trigger-specific payload (target qty, target tier, terms swap key). */
  meta: Record<string, string | number>;
}

export interface QuoteDecision {
  requestId: string;
  ruleSetVersion: number;
  decision: Decision;
  decisionReason: DecisionReason;
  lines: QuoteDecisionLine[];
  totalPrice: number | null;
  currency: CurrencyCode;
  /** Populated only when the engine caller stamps expiry. Engine itself does not know clock. */
  expiresAt?: string; // ISO-8601
  /** Non-fatal engine warnings (e.g. unsupported rule types, skipped for now). */
  warnings: string[];
}
