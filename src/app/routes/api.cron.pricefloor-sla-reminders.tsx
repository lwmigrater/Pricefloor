/**
 * Cron: SLA reminders for pending escalations.
 *
 *   GET /api/cron/pricefloor-sla-reminders
 *
 * Scheduled hourly by vercel.json. Sends one reminder email per escalation
 * that has been `pending` for ≥ 24h AND hasn't been reminded within the
 * same window. Idempotency is enforced by pf_escalations.last_reminder_at
 * (see listStaleEscalations + markReminderSent).
 *
 * Auth: Vercel calls this URL directly. We check the `Authorization: Bearer
 * ${CRON_SECRET}` header (set as env var + Vercel deploy setting) to reject
 * random public hits. If CRON_SECRET is unset, the endpoint is open — fine
 * for local dev, gated in prod by requiring the env var.
 */

import type { LoaderFunctionArgs } from "react-router";
import {
  listStaleEscalations,
  markReminderSent,
} from "@/feature/pricefloor/adapters/supabase/escalation.repository";
import { notifyEscalationReminder } from "@/feature/pricefloor/services/escalation-notifier.service";
import supabase from "@/adapters/supabase/supabase.server";
import type { QuoteDecision } from "@/feature/pricefloor/engine";

const SLA_HOURS = 24;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    if (header !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const stale = await listStaleEscalations(SLA_HOURS);
  if (stale.length === 0) {
    return Response.json({ ok: true, reminded: 0 });
  }

  // Batch-fetch the associated decision.output payloads once so we don't
  // hit the DB per escalation.
  const requestIds = stale.map((e) => e.requestId);
  const { data: decisions } = await supabase
    .from("pf_quote_decisions")
    .select("request_id, output")
    .in("request_id", requestIds);
  const byReq = new Map<string, QuoteDecision>(
    (decisions ?? []).map((d: any) => [d.request_id, d.output as QuoteDecision]),
  );

  let reminded = 0;
  let failed = 0;
  for (const e of stale) {
    const decision = byReq.get(e.requestId);
    if (!decision) continue;
    const hoursOpen = Math.floor(
      (Date.now() - new Date(e.createdAt).getTime()) / 3600 / 1000,
    );
    try {
      await notifyEscalationReminder({
        companyId: e.companyId,
        shop: e.shop,
        escalationId: e.id,
        quoteRequestId: e.requestId,
        decision,
        hoursOpen,
      });
      // Stamp only after a successful send so a transient email failure
      // stays eligible for the next cron tick instead of being silently
      // silenced for another SLA window.
      await markReminderSent(e.id);
      reminded++;
    } catch (err) {
      console.error("[cron/sla] reminder failed:", e.id, err);
      failed++;
    }
  }

  return Response.json({ ok: true, reminded, failed, total: stale.length });
};
