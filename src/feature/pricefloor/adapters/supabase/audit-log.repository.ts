/**
 * pf_audit_log repository.
 *
 * Append-only: the DB trigger rejects UPDATE and DELETE. This repository
 * therefore exposes only insert. Every state-changing action in the quote
 * lifecycle should emit one row here — the row is the audit truth, not a
 * side-channel log.
 */

import supabase from "@/adapters/supabase/supabase.server";

export type AuditEventType =
  | "quote_received"
  | "decision_made"
  | "draft_order_created"
  | "invoice_sent"
  | "escalation_opened"
  | "quote_expired"
  | "quote_closed_won";

export interface InsertAuditEventInput {
  companyId: string;
  shop: string;
  eventType: AuditEventType;
  decisionId?: string | null;
  actor?: string | null; // "engine", "merchant:<userId>", "webhook:<topic>", etc.
  payload?: Record<string, unknown>;
}

export async function insertAuditEvent(
  input: InsertAuditEventInput,
): Promise<void> {
  const { error } = await supabase.from("pf_audit_log").insert({
    company_id: input.companyId,
    shop: input.shop,
    event_type: input.eventType,
    decision_id: input.decisionId ?? null,
    actor: input.actor ?? "engine",
    payload: input.payload ?? {},
  });
  if (error) throw new Error(`pf_audit_log insert failed: ${error.message}`);
}
