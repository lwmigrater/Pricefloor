/**
 * pf_escalations repository.
 *
 * An escalation is a decision that requires human review — the row is what
 * powers the merchant's Escalations queue and the SLA cron. Statuses:
 *   pending  → queue default, timer starts here
 *   in_review → merchant has claimed it (assigned_to set)
 *   resolved → closed with a resolution note
 */

import supabase from "@/adapters/supabase/supabase.server";

export type EscalationStatus = "pending" | "in_review" | "resolved";

export interface EscalationRow {
  id: string;
  requestId: string;
  status: EscalationStatus;
  assignedTo: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  lastReminderAt: string | null;
}

interface RawRow {
  id: string;
  request_id: string;
  status: EscalationStatus;
  assigned_to: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  last_reminder_at: string | null;
}

function rowFromDb(r: RawRow): EscalationRow {
  return {
    id: r.id,
    requestId: r.request_id,
    status: r.status,
    assignedTo: r.assigned_to,
    resolution: r.resolution,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    lastReminderAt: r.last_reminder_at,
  };
}

export interface InsertEscalationInput {
  requestId: string;
  assignedTo?: string | null;
}

export async function insertEscalation(
  input: InsertEscalationInput,
): Promise<string> {
  const { data, error } = await supabase
    .from("pf_escalations")
    .insert({
      request_id: input.requestId,
      assigned_to: input.assignedTo ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`pf_escalations insert failed: ${error?.message}`);
  return data.id as string;
}

/**
 * List escalations for a company. Joins pf_quote_requests to filter by
 * company_id (escalations table has no company_id column of its own).
 */
export async function listEscalations(
  companyId: string,
  opts: { statuses?: EscalationStatus[]; limit?: number } = {},
): Promise<EscalationRow[]> {
  const statuses = opts.statuses ?? ["pending", "in_review"];
  const { data, error } = await supabase
    .from("pf_escalations")
    .select("*, pf_quote_requests!inner(company_id)")
    .eq("pf_quote_requests.company_id", companyId)
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 100);
  if (error) throw new Error(`pf_escalations read failed: ${error.message}`);
  return (data as (RawRow & { pf_quote_requests: unknown })[]).map(rowFromDb);
}

/**
 * Escalations that have been pending longer than `hours` AND haven't been
 * reminded in the same window — SLA cron target. Global (all companies).
 * The cron iterates over the whole set and each reminder email goes to the
 * relevant merchant.
 *
 * Idempotency: filters out rows whose last_reminder_at is newer than the
 * cutoff — so the hourly cron sends at most one email per `hours` window
 * per escalation until it's claimed or resolved.
 */
export async function listStaleEscalations(
  hours: number,
): Promise<Array<EscalationRow & { companyId: string; shop: string }>> {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("pf_escalations")
    .select(
      "*, pf_quote_requests!inner(company_id, shop)",
    )
    .eq("status", "pending")
    .lte("created_at", cutoff)
    .or(`last_reminder_at.is.null,last_reminder_at.lte.${cutoff}`);
  if (error) throw new Error(`pf_escalations stale read failed: ${error.message}`);
  return (data as Array<
    RawRow & { pf_quote_requests: { company_id: string; shop: string } }
  >).map((r) => ({
    ...rowFromDb(r),
    companyId: r.pf_quote_requests.company_id,
    shop: r.pf_quote_requests.shop,
  }));
}

/**
 * Stamp last_reminder_at = now for an escalation. Called by the SLA cron
 * after a reminder email successfully leaves the wrapper.
 */
export async function markReminderSent(id: string): Promise<void> {
  const { error } = await supabase
    .from("pf_escalations")
    .update({ last_reminder_at: new Date().toISOString() })
    .eq("id", id);
  if (error)
    throw new Error(`pf_escalations mark reminder failed: ${error.message}`);
}

export async function resolveEscalation(
  id: string,
  resolution: string,
  actor: string,
): Promise<void> {
  const { error } = await supabase
    .from("pf_escalations")
    .update({
      status: "resolved",
      resolution,
      assigned_to: actor,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`pf_escalations resolve failed: ${error.message}`);
}

export async function claimEscalation(id: string, actor: string): Promise<void> {
  const { error } = await supabase
    .from("pf_escalations")
    .update({ status: "in_review", assigned_to: actor })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(`pf_escalations claim failed: ${error.message}`);
}
