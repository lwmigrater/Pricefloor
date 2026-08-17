/**
 * Seed a default Pricefloor rule set for a dev store.
 *
 *   SHOPIFY_SHOP=vayes-test.myshopify.com npm run pricefloor:seed-rules
 *
 * Behavior:
 *   1. Resolve the company row by shop.
 *   2. Deactivate any existing active rule set (idx_pf_rule_sets_one_active_per_company).
 *   3. Insert a new active rule set + 3 rules:
 *        - margin_floor: 20% minimum margin over unit_cost
 *        - volume_ladder: 100→5%, 500→10%, 1000→15%
 *        - tier_cap gold: max 10% discount
 *
 * Idempotent enough — running twice creates a v2 set and deactivates v1.
 */

import supabase from "../src/feature/bite/adapters/supabase/supabase.server";
import { companyService } from "../src/feature/bite/services/company.service";

const shop = process.env.SHOPIFY_SHOP;
if (!shop) {
  console.error("Missing SHOPIFY_SHOP env var.");
  process.exit(1);
}

const company = await companyService.findByShop(shop);
if (!company) {
  console.error(`No company row for shop=${shop}. Install/onboard the app first.`);
  process.exit(1);
}

console.log(`Seeding rule set for company=${company.id} (${shop})`);

// Deactivate any current active set.
const { error: deactivateErr } = await supabase
  .from("pf_rule_sets")
  .update({ is_active: false })
  .eq("company_id", company.id)
  .eq("is_active", true);
if (deactivateErr) throw new Error(`deactivate failed: ${deactivateErr.message}`);

// Insert new active set (trigger auto-assigns version).
const { data: setRow, error: setErr } = await supabase
  .from("pf_rule_sets")
  .insert({
    company_id: company.id,
    shop,
    is_active: true,
    name: "Default Pricefloor rule set",
    created_by: "seed-script",
  })
  .select("id, version")
  .single();
if (setErr || !setRow) throw new Error(`rule set insert failed: ${setErr?.message}`);

console.log(`Created rule set id=${setRow.id} version=${setRow.version}`);

const rules = [
  {
    rule_set_id: setRow.id,
    rule_type: "margin_floor",
    priority: 0,
    scope: {},
    enabled: true,
    params: { kind: "percent", minMarginPct: 20 },
  },
  {
    rule_set_id: setRow.id,
    rule_type: "volume_ladder",
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
    rule_set_id: setRow.id,
    rule_type: "tier_cap",
    priority: 2,
    scope: {},
    enabled: true,
    params: { tier: "gold", maxDiscountPct: 10 },
  },
];

const { error: rulesErr } = await supabase.from("pf_rules").insert(rules);
if (rulesErr) throw new Error(`rules insert failed: ${rulesErr.message}`);

console.log(`Inserted ${rules.length} rules. Done.`);
