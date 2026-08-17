/**
 * pf_quote_requests repository.
 *
 * A quote request is the raw inbound payload — customer/company/lines/terms.
 * The engine consumes it as {@link QuoteRequest}; this row keeps the exact
 * shape received so audit + escalation can reconstruct intent even if the
 * engine's input schema evolves.
 */

import supabase from "@/adapters/supabase/supabase.server";
import type { QuoteRequest } from "@/feature/pricefloor/engine";

export type QuoteRequestSource = "form" | "proxy" | "api";

export interface InsertQuoteRequestInput {
  companyId: string;
  shop: string;
  shopifyCompanyId?: string | null;
  source: QuoteRequestSource;
  raw: QuoteRequest;
  // Stored as a top-level `shopifyCustomerEmail` field on raw_input. The
  // orders/create fallback matcher reads this to tie an order back to its
  // quote when draft_order_id is absent. QuoteRequest itself is engine-facing
  // and stays email-agnostic.
  shopifyCustomerEmail?: string | null;
}

export async function insertQuoteRequest(
  input: InsertQuoteRequestInput,
): Promise<string> {
  const email = input.shopifyCustomerEmail?.trim().toLowerCase();
  const rawInput = email
    ? { ...input.raw, shopifyCustomerEmail: email }
    : input.raw;
  const { data, error } = await supabase
    .from("pf_quote_requests")
    .insert({
      company_id: input.companyId,
      shop: input.shop,
      shopify_company_id: input.shopifyCompanyId ?? null,
      source: input.source,
      raw_input: rawInput,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`pf_quote_requests insert failed: ${error?.message}`);
  return data.id as string;
}
