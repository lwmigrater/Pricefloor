/**
 * Escalation notifier — turns a fresh escalation into a merchant email.
 *
 * Split from quote-decision.service so the cron path (24h SLA reminder) can
 * reuse the same template and delivery helper without dragging the whole
 * decideAndAct dependency graph in.
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { sendEmail } from "@/feature/bite/adapters/supabase/send-email";
import {
  getMerchantEmail,
  syncMerchantContact,
} from "@/feature/pricefloor/services/merchant-contact.service";
import type { QuoteDecision } from "@/feature/pricefloor/engine";

const APP_URL = process.env.SHOPIFY_APP_URL ?? process.env.APP_URL ?? "";

export interface NotifyEscalationOpenedInput {
  companyId: string;
  shop: string;
  escalationId: string;
  quoteRequestId: string;
  decision: QuoteDecision;
  /**
   * Admin client from the request that produced the escalation. Optional
   * because the cron reminder path has no admin — but when present, we use
   * it to lazy-sync `shop.email` into company_meta so stores that skipped
   * onboarding (or had a null shop.email at that moment) still get emails.
   */
  admin?: AdminApiContext;
}

export async function notifyEscalationOpened(
  input: NotifyEscalationOpenedInput,
): Promise<void> {
  let to = await getMerchantEmail(input.companyId);
  if (!to && input.admin) {
    // First escalation from a store that never completed onboarding, or one
    // where shop.email was blank at sync time. Try one live fetch — if it
    // returns an address, cache it and reuse for future notifications.
    try {
      to = await syncMerchantContact(input.admin, input.companyId);
    } catch (e) {
      console.warn("[escalation-notifier] merchant contact sync failed:", e);
    }
  }
  if (!to) {
    console.warn(
      `[escalation-notifier] No merchant email for company=${input.companyId}, skipping email (shop.email may be null in Shopify — ask the merchant to set a contact email)`,
    );
    return;
  }

  const subject = `[Pricefloor] New escalation — ${input.decision.decisionReason}`;
  const html = renderEscalationEmail({
    shop: input.shop,
    decision: input.decision,
    queueUrl: `${APP_URL}/app/pricefloor/escalations?highlight=${input.escalationId}`,
    kind: "opened",
  });

  const result = await sendEmail({
    to,
    subject,
    html,
    companyId: input.companyId,
  });
  if (!result.ok) {
    console.error(
      `[escalation-notifier] Email failed: ${result.error} (plan=${result.planId} used=${result.usedCount}/${result.monthlyCap})`,
    );
  }
}

export interface NotifyEscalationReminderInput extends NotifyEscalationOpenedInput {
  hoursOpen: number;
}

export async function notifyEscalationReminder(
  input: NotifyEscalationReminderInput,
): Promise<void> {
  const to = await getMerchantEmail(input.companyId);
  if (!to) return;

  const subject = `[Pricefloor] Escalation pending ${input.hoursOpen}h — please review`;
  const html = renderEscalationEmail({
    shop: input.shop,
    decision: input.decision,
    queueUrl: `${APP_URL}/app/pricefloor/escalations?highlight=${input.escalationId}`,
    kind: "reminder",
    hoursOpen: input.hoursOpen,
  });

  await sendEmail({ to, subject, html, companyId: input.companyId });
}

interface RenderInput {
  shop: string;
  decision: QuoteDecision;
  queueUrl: string;
  kind: "opened" | "reminder";
  hoursOpen?: number;
}

function renderEscalationEmail(r: RenderInput): string {
  const header =
    r.kind === "opened"
      ? "A quote request was escalated for review"
      : `A quote request has been open for ${r.hoursOpen}h`;
  const lines = r.decision.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.variantId)}</td><td>${l.quantity}</td><td>${l.lineReason ?? ""}</td></tr>`,
    )
    .join("");

  return `
<!doctype html>
<html>
<body style="font-family: -apple-system, sans-serif; color: #202223;">
  <h2>${header}</h2>
  <p><strong>Shop:</strong> ${escapeHtml(r.shop)}</p>
  <p><strong>Reason:</strong> <code>${escapeHtml(r.decision.decisionReason)}</code></p>
  <table style="border-collapse: collapse; margin: 12px 0;">
    <thead><tr><th align="left" style="padding:4px 12px;">Variant</th><th align="left" style="padding:4px 12px;">Qty</th><th align="left" style="padding:4px 12px;">Line reason</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <p><a href="${r.queueUrl}" style="background:#008060; color:#fff; padding:10px 16px; text-decoration:none; border-radius:4px;">Open in queue</a></p>
</body>
</html>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
