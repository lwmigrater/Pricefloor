/**
 * Pricefloor engine smoke test.
 *
 *   npx tsx scripts/pricefloor-smoke.ts
 *
 * Runs canonical scenarios through the pure engine so you can see end-to-end
 * that (request, rule_set, cost_snapshot) → decision works without Shopify
 * or Supabase in the loop.
 *
 * Live mode (Hafta 2.4 verification): set these env vars to also hit the real
 * Shopify Admin GraphQL and print an invoice URL:
 *
 *   PF_LIVE=true
 *   SHOPIFY_SHOP=vayes-test.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN=shpat_xxx
 *   PF_TEST_VARIANT_ID=gid://shopify/ProductVariant/XXXXX
 *   PF_TEST_CUSTOMER_ID=gid://shopify/Customer/YYYYY   (optional)
 *
 * The live scenario creates a draft order with priceOverride and prints the
 * invoiceUrl — it does NOT send the invoice email (safe to run repeatedly).
 */

import { evaluate } from "../src/feature/pricefloor/engine";
import type {
  CostSnapshot,
  QuoteRequest,
  RuleSet,
} from "../src/feature/pricefloor/engine";
import { createDraftOrder } from "../src/feature/pricefloor/adapters/shopify/draft-order.shopify";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const VARIANT_A = "gid://shopify/ProductVariant/1001";
const VARIANT_B = "gid://shopify/ProductVariant/1002";

const baseRuleSet: RuleSet = {
  id: "rs_1",
  version: 1,
  rules: [
    {
      id: "r1",
      type: "margin_floor",
      priority: 0,
      scope: {},
      enabled: true,
      params: { type: "margin_floor", kind: "percent", minMarginPct: 20 },
    },
  ],
};

const ladderRuleSet: RuleSet = {
  id: "rs_2",
  version: 1,
  rules: [
    {
      id: "r1",
      type: "margin_floor",
      priority: 0,
      scope: {},
      enabled: true,
      params: { type: "margin_floor", kind: "percent", minMarginPct: 20 },
    },
    {
      id: "r2",
      type: "volume_ladder",
      priority: 1,
      scope: {},
      enabled: true,
      params: {
        type: "volume_ladder",
        tiers: [
          { minQty: 100, discountPct: 5 },
          { minQty: 500, discountPct: 10 },
          { minQty: 1000, discountPct: 15 },
        ],
      },
    },
    {
      id: "r3",
      type: "tier_cap",
      priority: 2,
      scope: {},
      enabled: true,
      params: { type: "tier_cap", tier: "gold", maxDiscountPct: 8 },
    },
  ],
};

const cost: CostSnapshot = {
  [VARIANT_A]: {
    unitCost: 10,
    currency: "USD",
    fetchedAt: Date.now(),
    inventoryQuantity: 500,
  },
  [VARIANT_B]: {
    unitCost: null, // no cost data on purpose → escalate
    currency: "USD",
    fetchedAt: Date.now(),
  },
};

const scenarios: Array<{
  name: string;
  request: QuoteRequest;
  ruleSet?: RuleSet;
}> = [
  {
    name: "auto_approve — requested above floor",
    request: {
      requestId: "req_1",
      company: { id: "gid://shopify/Company/1", tier: "gold" },
      currency: "USD",
      lines: [{ variantId: VARIANT_A, quantity: 500, requestedUnitPrice: 12.5 }],
    },
  },
  {
    name: "counter_offer — requested below floor",
    request: {
      requestId: "req_2",
      company: { id: "gid://shopify/Company/1", tier: "gold" },
      currency: "USD",
      lines: [{ variantId: VARIANT_A, quantity: 500, requestedUnitPrice: 11.5 }],
    },
  },
  {
    name: "auto_approve — no request, engine picks best",
    request: {
      requestId: "req_3",
      company: { id: "gid://shopify/Company/1", tier: "gold" },
      currency: "USD",
      lines: [{ variantId: VARIANT_A, quantity: 500 }],
    },
  },
  {
    name: "escalate — variant has no cost data",
    request: {
      requestId: "req_4",
      company: { id: "gid://shopify/Company/1", tier: "gold" },
      currency: "USD",
      lines: [{ variantId: VARIANT_B, quantity: 100, requestedUnitPrice: 5 }],
    },
  },
  {
    name: "volume_ladder — no request, 500 qty picks 10% off basePrice 20",
    ruleSet: ladderRuleSet,
    request: {
      requestId: "req_5",
      company: { id: "gid://shopify/Company/1", tier: "silver" },
      currency: "USD",
      lines: [{ variantId: VARIANT_A, quantity: 500, basePrice: 20 }],
    },
  },
  {
    name: "tier_cap — gold capped at 8% though ladder offers 10%",
    ruleSet: ladderRuleSet,
    request: {
      requestId: "req_6",
      company: { id: "gid://shopify/Company/1", tier: "gold" },
      currency: "USD",
      lines: [{ variantId: VARIANT_A, quantity: 500, basePrice: 20 }],
    },
  },
  {
    name: "tier_cap — gold cap floor-clamped when 8% below floor",
    ruleSet: ladderRuleSet,
    request: {
      requestId: "req_7",
      company: { id: "gid://shopify/Company/1", tier: "gold" },
      currency: "USD",
      lines: [{ variantId: VARIANT_A, quantity: 1500, basePrice: 12.5 }],
    },
  },
  {
    name: "multi-line — one auto + one below_floor → counter_offer (whole quote)",
    request: {
      requestId: "req_8",
      company: { id: "gid://shopify/Company/1", tier: "silver" },
      currency: "USD",
      lines: [
        { variantId: VARIANT_A, quantity: 100, requestedUnitPrice: 13 },
        { variantId: VARIANT_A, quantity: 200, requestedUnitPrice: 11 },
      ],
    },
  },
  {
    name: "multi-line — one auto + one no_cost_data → escalate whole quote (line_escalated)",
    request: {
      requestId: "req_9",
      company: { id: "gid://shopify/Company/1", tier: "silver" },
      currency: "USD",
      lines: [
        { variantId: VARIANT_A, quantity: 100, requestedUnitPrice: 13 },
        { variantId: VARIANT_B, quantity: 50, requestedUnitPrice: 8 },
      ],
    },
  },
  {
    name: "multi-line — both auto_approve → single auto decision, totalPrice summed",
    request: {
      requestId: "req_10",
      company: { id: "gid://shopify/Company/1", tier: "silver" },
      currency: "USD",
      lines: [
        { variantId: VARIANT_A, quantity: 100, requestedUnitPrice: 13 },
        { variantId: VARIANT_A, quantity: 200, requestedUnitPrice: 14 },
      ],
    },
  },
  {
    name: "counter alternatives — below_floor produces volume + terms + tier upsells",
    ruleSet: {
      id: "rs_alt",
      version: 1,
      rules: [
        {
          id: "r_floor",
          type: "margin_floor",
          priority: 0,
          scope: {},
          enabled: true,
          params: { type: "margin_floor", kind: "percent", minMarginPct: 20 },
        },
        {
          id: "r_ladder",
          type: "volume_ladder",
          priority: 1,
          scope: {},
          enabled: true,
          params: {
            type: "volume_ladder",
            tiers: [
              { minQty: 100, discountPct: 5 },
              { minQty: 500, discountPct: 10 },
              { minQty: 1000, discountPct: 15 },
            ],
          },
        },
        {
          id: "r_cap_silver",
          type: "tier_cap",
          priority: 2,
          scope: {},
          enabled: true,
          params: { type: "tier_cap", tier: "silver", maxDiscountPct: 5 },
        },
        {
          id: "r_cap_gold",
          type: "tier_cap",
          priority: 2,
          scope: {},
          enabled: true,
          params: { type: "tier_cap", tier: "gold", maxDiscountPct: 12 },
        },
        {
          id: "r_terms",
          type: "terms_swap",
          priority: 3,
          scope: {},
          enabled: true,
          params: { type: "terms_swap", prepaid: 4 },
        },
      ],
    },
    request: {
      requestId: "req_12",
      company: { id: "gid://shopify/Company/1", tier: "silver" },
      currency: "USD",
      terms: { payment: "net30" },
      lines: [
        { variantId: VARIANT_A, quantity: 200, requestedUnitPrice: 10.5, basePrice: 20 },
      ],
    },
  },
  {
    name: "counter alternatives — gold buyer, ladder can meaningfully improve",
    ruleSet: {
      id: "rs_alt2",
      version: 1,
      rules: [
        {
          id: "r_floor",
          type: "margin_floor",
          priority: 0,
          scope: {},
          enabled: true,
          params: { type: "margin_floor", kind: "percent", minMarginPct: 15 },
        },
        {
          id: "r_ladder",
          type: "volume_ladder",
          priority: 1,
          scope: {},
          enabled: true,
          params: {
            type: "volume_ladder",
            tiers: [
              { minQty: 100, discountPct: 5 },
              { minQty: 500, discountPct: 12 },
              { minQty: 1000, discountPct: 20 },
            ],
          },
        },
        {
          id: "r_cap_gold",
          type: "tier_cap",
          priority: 2,
          scope: {},
          enabled: true,
          params: { type: "tier_cap", tier: "gold", maxDiscountPct: 25 },
        },
        {
          id: "r_terms",
          type: "terms_swap",
          priority: 3,
          scope: {},
          enabled: true,
          params: { type: "terms_swap", prepaid: 3 },
        },
      ],
    },
    request: {
      requestId: "req_13",
      company: { id: "gid://shopify/Company/1", tier: "gold" },
      currency: "USD",
      terms: { payment: "net30" },
      lines: [
        { variantId: VARIANT_A, quantity: 200, requestedUnitPrice: 10, basePrice: 20 },
      ],
    },
  },
  {
    name: "warning surfacing — rule set contains an unwired stock_age rule",
    ruleSet: {
      id: "rs_3",
      version: 1,
      rules: [
        ...baseRuleSet.rules,
        {
          id: "r_age",
          type: "stock_age",
          priority: 5,
          scope: {},
          enabled: true,
          params: { type: "stock_age", minAgeDays: 90, addPct: 3 },
        },
      ],
    },
    request: {
      requestId: "req_11",
      company: { id: "gid://shopify/Company/1", tier: "gold" },
      currency: "USD",
      lines: [{ variantId: VARIANT_A, quantity: 500, requestedUnitPrice: 12.5 }],
    },
  },
];

for (const { name, request, ruleSet } of scenarios) {
  const decision = evaluate(request, ruleSet ?? baseRuleSet, cost);
  console.log(`\n── ${name} ──`);
  console.log(JSON.stringify(decision, null, 2));
}

// ── Live Shopify verification (Hafta 2.4) ─────────────────────
if (process.env.PF_LIVE === "true") {
  const shop = requireEnv("SHOPIFY_SHOP");
  const token = requireEnv("SHOPIFY_ADMIN_TOKEN");
  const variantId = requireEnv("PF_TEST_VARIANT_ID");
  const customerId = process.env.PF_TEST_CUSTOMER_ID || null;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-07";

  const admin: AdminApiContext = {
    // Minimal shim: adapter only calls admin.graphql(query, { variables }).
    graphql: async (query: string, opts?: { variables?: unknown }) => {
      const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables: opts?.variables ?? {} }),
      });
      return res as unknown as Response;
    },
  } as unknown as AdminApiContext;

  console.log(`\n── LIVE: draftOrderCreate on ${shop} ──`);
  try {
    const draft = await createDraftOrder(admin, {
      customerId,
      currencyCode: "USD",
      lines: [{ variantId, quantity: 3, unitPrice: 12.5 }],
      note: "Pricefloor smoke test — no invoice sent",
    });
    console.log(JSON.stringify(draft, null, 2));
    console.log("\nOpen the invoiceUrl in incognito to confirm checkout at $12.50.");
  } catch (err) {
    console.error("LIVE draftOrderCreate failed:", (err as Error).message);
    process.exitCode = 1;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
