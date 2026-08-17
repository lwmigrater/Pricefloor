/**
 * Rule set service — thin orchestration on top of the repository.
 *
 * seedDefaultRuleSet is called by onboarding (and the seed script) to give
 * a fresh company something the engine can evaluate immediately.
 */

import {
  getActiveRuleSet,
  replaceActiveRuleSet,
  type DraftRule,
} from "@/feature/pricefloor/adapters/supabase/rule-set.repository";

const DEFAULT_RULES: DraftRule[] = [
  {
    type: "margin_floor",
    priority: 0,
    scope: {},
    enabled: true,
    params: { kind: "percent", minMarginPct: 20 },
  },
  {
    type: "volume_ladder",
    priority: 1,
    scope: {},
    enabled: true,
    params: {
      tiers: [
        { minQty: 100, discountPct: 5 },
        { minQty: 500, discountPct: 10 },
        { minQty: 1000, discountPct: 15 },
      ],
    },
  },
  {
    type: "tier_cap",
    priority: 2,
    scope: {},
    enabled: true,
    params: { tier: "gold", maxDiscountPct: 10 },
  },
];

/**
 * Create a starter rule set if none exists. Skips when the company already
 * has an active set — merchant edits should never be silently overwritten.
 */
export async function seedDefaultRuleSet(
  companyId: string,
  shop: string,
): Promise<"seeded" | "skipped_existing"> {
  const existing = await getActiveRuleSet(companyId);
  if (existing) return "skipped_existing";
  await replaceActiveRuleSet(companyId, shop, DEFAULT_RULES, "seed:onboarding", "Default rule set");
  return "seeded";
}
