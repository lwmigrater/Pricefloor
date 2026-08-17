import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


// These are set as Supabase secrets — never in the project repo.
const MAILGUN_API_KEY    = Deno.env.get("MAILGUN_API_KEY")    ?? "";
const MAILGUN_DOMAIN     = Deno.env.get("MAILGUN_DOMAIN")     ?? "";
const MAILGUN_EU         = Deno.env.get("MAILGUN_EU")         === "true";
const MAILGUN_BASE_URL   = MAILGUN_EU
  ? `https://api.eu.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`
  : `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;
const FROM_EMAIL      = Deno.env.get("FROM_EMAIL")      ?? "noreply@vayes.app";

// Built-in Supabase edge runtime env vars (always available)
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")              ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface Payload {
  to: string;
  subject: string;
  html: string;
  from?: string;
  company_id?: string;  // UUID — required for limit tracking
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method Not Allowed" }, 405);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  if (!payload.to || !payload.subject || !payload.html) {
    return json({ ok: false, error: "Missing required fields: to, subject, html" }, 400);
  }

  // ── Limit check ─────────────────────────────────────────────
  if (payload.company_id) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const month    = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    const { data: limit } = await supabase.rpc("check_feature_limit", {
      p_company_id: payload.company_id,
      p_feature:    "emails",
      p_month:      month,
    }).maybeSingle();

    if (limit && !limit.can_use) {
      console.warn(
        `[send-email] Limit reached: company=${payload.company_id} plan=${limit.plan_id} cap=${limit.monthly_cap} used=${limit.used_count}`
      );
      return json({
        ok: false,
        error:       "Monthly email limit reached",
        plan_id:     limit.plan_id,
        monthly_cap: limit.monthly_cap,
        used_count:  limit.used_count,
      }, 429);
    }

    const sent = await sendViaMailgun(payload.from ?? FROM_EMAIL, payload.to, payload.subject, payload.html);
    if (sent) {
      await supabase.rpc("increment_feature_usage", {
        p_company_id: payload.company_id,
        p_feature:    "emails",
        p_month:      month,
      });
    }
    return json({ ok: sent }, sent ? 200 : 502);
  }

  // No company_id — send without tracking (e.g. admin notifications)
  const sent = await sendViaMailgun(payload.from ?? FROM_EMAIL, payload.to, payload.subject, payload.html);
  return json({ ok: sent }, sent ? 200 : 502);
});

// ── Mailgun helper ───────────────────────────────────────────
async function sendViaMailgun(from: string, to: string, subject: string, html: string): Promise<boolean> {
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.error("[send-email] MAILGUN_API_KEY or MAILGUN_DOMAIN not set in Supabase secrets");
    return false;
  }

  const form = new FormData();
  form.append("from",    from);
  form.append("to",      to);
  form.append("subject", subject);
  form.append("html",    html);

  console.log(`[send-email] POST ${MAILGUN_BASE_URL} | domain="${MAILGUN_DOMAIN}" eu=${MAILGUN_EU} keySet=${!!MAILGUN_API_KEY}`);
  try {
    const res = await fetch(MAILGUN_BASE_URL, {
      method:  "POST",
      headers: { Authorization: `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}` },
      body:    form,
    });
    if (!res.ok) {
      console.error("[send-email] Mailgun error:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[send-email] Mailgun fetch failed:", err);
    return false;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
