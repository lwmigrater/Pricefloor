/**
 * pf_quote_decisions repository.
 *
 * One row per engine verdict. Draft-order + invoice fields are populated
 * asynchronously by the service after Shopify accepts the mutation.
 */

import supabase from "@/adapters/supabase/supabase.server";
import type { Decision, DecisionReason, QuoteDecision } from "@/feature/pricefloor/engine";

export interface InsertQuoteDecisionInput {
  requestId: string;
  ruleSetId: string;
  decision: Decision;
  decisionReason: DecisionReason;
  output: QuoteDecision;
  shopifyDraftOrderId?: string | null;
  shopifyDraftOrderName?: string | null;
  invoiceUrl?: string | null;
  expiresAt?: string | null; // ISO
}

export async function insertQuoteDecision(
  input: InsertQuoteDecisionInput,
): Promise<string> {
  const { data, error } = await supabase
    .from("pf_quote_decisions")
    .insert({
      request_id: input.requestId,
      rule_set_id: input.ruleSetId,
      decision: input.decision,
      decision_reason: input.decisionReason,
      output: input.output,
      shopify_draft_order_id: input.shopifyDraftOrderId ?? null,
      shopify_draft_order_name: input.shopifyDraftOrderName ?? null,
      invoice_url: input.invoiceUrl ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`pf_quote_decisions insert failed: ${error?.message}`);
  return data.id as string;
}

export interface QuoteDecisionRow {
  id: string;
  requestId: string;
  decision: Decision;
  decisionReason: DecisionReason;
  output: QuoteDecision;
  shopifyDraftOrderId: string | null;
  shopifyDraftOrderName: string | null;
  invoiceUrl: string | null;
  expiresAt: string | null;
  decidedAt: string;
  buyerEmail: string | null;
}

interface RawDecisionRow {
  id: string;
  request_id: string;
  decision: Decision;
  decision_reason: DecisionReason;
  output: QuoteDecision;
  shopify_draft_order_id: string | null;
  shopify_draft_order_name: string | null;
  invoice_url: string | null;
  expires_at: string | null;
  decided_at: string;
  pf_quote_requests?: { company_id: string; raw_input?: { shopifyCustomerEmail?: string | null } };
}

function rowFromDb(r: RawDecisionRow): QuoteDecisionRow {
  return {
    id: r.id,
    requestId: r.request_id,
    decision: r.decision,
    decisionReason: r.decision_reason,
    output: r.output,
    shopifyDraftOrderId: r.shopify_draft_order_id,
    shopifyDraftOrderName: r.shopify_draft_order_name,
    invoiceUrl: r.invoice_url,
    expiresAt: r.expires_at,
    decidedAt: r.decided_at,
    buyerEmail: r.pf_quote_requests?.raw_input?.shopifyCustomerEmail ?? null,
  };
}

export interface ListDecisionsOpts {
  decision?: Decision;
  limit?: number;
  offset?: number;
}

export async function findDecisionByDraftOrderGID(
  companyId: string,
  draftOrderGID: string,
): Promise<QuoteDecisionRow | null> {
  const { data, error } = await supabase
    .from("pf_quote_decisions")
    .select("*, pf_quote_requests!inner(company_id)")
    .eq("pf_quote_requests.company_id", companyId)
    .eq("shopify_draft_order_id", draftOrderGID)
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`pf_quote_decisions find failed: ${error.message}`);
  return data ? rowFromDb(data as RawDecisionRow) : null;
}

export async function listQuoteDecisions(
  companyId: string,
  opts: ListDecisionsOpts = {},
): Promise<QuoteDecisionRow[]> {
  let query = supabase
    .from("pf_quote_decisions")
    .select("*, pf_quote_requests!inner(company_id)")
    .eq("pf_quote_requests.company_id", companyId)
    .order("decided_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.offset) query = query.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1);
  if (opts.decision) query = query.eq("decision", opts.decision);
  const { data, error } = await query;
  if (error) throw new Error(`pf_quote_decisions list failed: ${error.message}`);
  return (data as RawDecisionRow[]).map(rowFromDb);
}

export async function markDecisionFulfilled(
  id: string,
  draft: { id: string; name: string; invoiceUrl: string | null; expiresAt: string },
): Promise<void> {
  const { error } = await supabase.from("pf_quote_decisions").update({
    shopify_draft_order_id: draft.id,
    shopify_draft_order_name: draft.name,
    invoice_url: draft.invoiceUrl,
    expires_at: draft.expiresAt,
  }).eq("id", id);
  if (error) throw new Error(`pf_quote_decisions fulfillment update failed: ${error.message}`);
}
