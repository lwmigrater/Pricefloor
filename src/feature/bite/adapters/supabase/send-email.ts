/**
 * Wrapper around the `send-email` Supabase edge function.
 *
 * The edge function (see supabase/functions/send-email/index.ts) handles:
 *   - Mailgun delivery
 *   - Per-company monthly email limit (via check_feature_limit RPC)
 *   - Usage increment on successful send
 *
 * Server code should call `sendEmail` instead of hitting Mailgun directly so
 * limit tracking stays consistent.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Company ID for per-plan limit tracking. Omit for admin-only mail. */
  companyId?: string;
  from?: string;
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
  planId?: string;
  monthlyCap?: number;
  usedCount?: number;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { ok: false, error: "supabase_env_missing" };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.companyId ? { company_id: input.companyId } : {}),
      ...(input.from ? { from: input.from } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as SendEmailResult;
  return { ...body, ok: body.ok ?? res.ok };
}
