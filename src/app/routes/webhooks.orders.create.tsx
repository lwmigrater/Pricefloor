/**
 * orders/create webhook — closes the Pricefloor quote loop when a buyer
 * pays a draft-order invoice.
 *
 * Matching strategy (plan §11):
 *   1. Primary: order.draft_order_id → pf_quote_decisions.shopify_draft_order_id
 *      (draft_order_id in webhook payload is a numeric REST ID; we lift it
 *      to a GraphQL GID before lookup).
 *   2. Fallback: email + recent-window scan for the same company, choosing
 *      the newest un-closed decision whose expires_at hasn't passed. Kicks
 *      in when the buyer paid without going through the draft link or the
 *      draft_order_id field is absent (rare — pos, manual re-issue).
 *
 * On match: emit quote_closed_won audit + tag the draft order. The expiry
 * cron already ignores decisions with quote_closed_won so it won't race.
 */

import type { ActionFunctionArgs } from "react-router";
import supabase from "@/adapters/supabase/supabase.server";
import { authenticate, unauthenticated } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";
import { findDecisionByDraftOrderGID } from "@/feature/pricefloor/adapters/supabase/quote-decision.repository";
import { insertAuditEvent } from "@/feature/pricefloor/adapters/supabase/audit-log.repository";
import { addTags } from "@/feature/pricefloor/adapters/shopify/draft-order.shopify";

const CLOSED_WON_TAG = "pricefloor:closed_won";

interface OrderPayload {
  id: number | string;
  name?: string;
  email?: string | null;
  draft_order_id?: number | string | null;
  total_price?: string;
  customer?: { id?: number | string; email?: string | null } | null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const company = await companyService.findByShop(shop);
  if (!company) return new Response();

  const order = payload as OrderPayload;

  // Always log the raw event first — Pricefloor match happens on top.
  await supabase.from("pf_audit_log").insert({
    company_id: company.id,
    shop,
    event_type: "webhook.orders.create",
    payload: order as unknown as Record<string, unknown>,
  });

  const match = await matchDecision(company.id, order);
  if (!match) return new Response();

  // 1. Audit the closure.
  await insertAuditEvent({
    companyId: company.id,
    shop,
    eventType: "quote_closed_won",
    decisionId: match.decisionId,
    actor: "webhook:orders.create",
    payload: {
      orderId: order.id,
      orderName: order.name,
      totalPrice: order.total_price,
      matchStrategy: match.strategy,
      draftOrderGID: match.draftOrderGID,
    },
  });

  // 2. Tag the draft order (best-effort). Uses offline admin token since
  //    webhooks don't carry a UI session.
  if (match.draftOrderGID) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      await addTags(admin, match.draftOrderGID, [CLOSED_WON_TAG]);
    } catch (err) {
      console.error("[orders.create] tag closed_won failed:", err);
    }
  }

  return new Response();
};

interface MatchResult {
  decisionId: string;
  draftOrderGID: string | null;
  strategy: "draft_order_id" | "email_fallback";
}

async function matchDecision(
  companyId: string,
  order: OrderPayload,
): Promise<MatchResult | null> {
  // Primary — draft_order_id in the payload.
  if (order.draft_order_id) {
    const gid = `gid://shopify/DraftOrder/${order.draft_order_id}`;
    const decision = await findDecisionByDraftOrderGID(companyId, gid);
    if (decision) {
      return {
        decisionId: decision.id,
        draftOrderGID: decision.shopifyDraftOrderId,
        strategy: "draft_order_id",
      };
    }
  }

  // Fallback — email + un-closed + within expiry window. Newest wins.
  const email = order.email ?? order.customer?.email;
  if (!email) return null;

  const { data: candidates, error } = await supabase
    .from("pf_quote_decisions")
    .select(
      "id, shopify_draft_order_id, expires_at, output, pf_quote_requests!inner(company_id, raw_input)",
    )
    .eq("pf_quote_requests.company_id", companyId)
    .not("expires_at", "is", null)
    .gte("expires_at", new Date().toISOString())
    .order("decided_at", { ascending: false })
    .limit(50);
  if (error || !candidates || candidates.length === 0) return null;

  // Skip decisions already closed_won (audit lookup).
  const ids = candidates.map((c: any) => c.id);
  const { data: closed } = await supabase
    .from("pf_audit_log")
    .select("decision_id")
    .in("decision_id", ids)
    .eq("event_type", "quote_closed_won");
  const closedIds = new Set((closed ?? []).map((r: any) => r.decision_id));

  const emailLower = email.toLowerCase();
  const hit = candidates.find((c: any) => {
    if (closedIds.has(c.id)) return false;
    const raw = c.pf_quote_requests?.raw_input as
      | { customer?: { email?: string }; shopifyCustomerEmail?: string }
      | undefined;
    // raw_input schema is loose (QuoteRequest doesn't carry email today) —
    // callers that DO pass one should stash it under shopifyCustomerEmail
    // or customer.email. If neither exists, this fallback silently skips.
    const candidateEmail =
      raw?.customer?.email?.toLowerCase() ??
      raw?.shopifyCustomerEmail?.toLowerCase() ??
      null;
    return candidateEmail === emailLower;
  }) as { id: string; shopify_draft_order_id: string | null } | undefined;

  if (!hit) return null;
  return {
    decisionId: hit.id,
    draftOrderGID: hit.shopify_draft_order_id,
    strategy: "email_fallback",
  };
}
