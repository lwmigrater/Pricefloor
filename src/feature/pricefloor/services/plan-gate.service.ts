/**
 * Plan gate — enforce the "active companies" cap per Pricefloor plan.
 *
 * Semantics (plan §10):
 *   starter → 25 companies
 *   growth  → 100 companies
 *   scale   → unlimited (monthly_cap = -1)
 *
 * "Active company" is DISTINCT shopify_company_id ever seen in
 * pf_quote_requests. Once the cap is hit, NEW companies are rejected;
 * existing companies keep quoting freely. Walk-in / anonymous quotes
 * (shopifyCompanyId null) never count against the cap.
 *
 * Distinct-count is done client-side (small N by definition — anyone with
 * more than ~few hundred companies is on Scale = unlimited).
 */

import supabase from "@/adapters/supabase/supabase.server";

export interface PlanGateResult {
  ok: boolean;
  reason?: "cap_exceeded";
  cap?: number;
  used?: number;
  planId?: string;
}

export async function checkCompanyLimit(
  companyId: string,
  incomingShopifyCompanyId: string | null | undefined,
): Promise<PlanGateResult> {
  if (!incomingShopifyCompanyId) return { ok: true };

  const { data: c } = await supabase
    .from("company")
    .select("plan_id")
    .eq("id", companyId)
    .maybeSingle();
  const planId = (c?.plan_id as string | undefined) ?? "free";

  const { data: limit } = await supabase
    .from("plan_limits")
    .select("monthly_cap")
    .eq("plan_id", planId)
    .eq("feature", "companies")
    .maybeSingle();
  const cap = (limit?.monthly_cap as number | undefined) ?? 0;
  if (cap === -1) return { ok: true, cap, planId };

  const { data: rows } = await supabase
    .from("pf_quote_requests")
    .select("shopify_company_id")
    .eq("company_id", companyId)
    .not("shopify_company_id", "is", null);
  const distinct = new Set(
    (rows ?? []).map((r: any) => r.shopify_company_id as string),
  );
  const isNew = !distinct.has(incomingShopifyCompanyId);
  const used = distinct.size;

  if (isNew && used >= cap) {
    return { ok: false, reason: "cap_exceeded", cap, used, planId };
  }
  return { ok: true, cap, used, planId };
}
