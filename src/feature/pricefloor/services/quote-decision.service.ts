/**
 * Quote decision service.
 *
 * The orchestrator that ties the pure engine to Shopify + Supabase:
 *   1. Persist the raw request (pf_quote_requests).
 *   2. Run the engine (pure).
 *   3. If the decision is auto_approve or counter_offer → create a Shopify
 *      draft order with priceOverride, optionally send the invoice email.
 *   4. Persist the decision (pf_quote_decisions) with invoice URL + expiry.
 *   5. Escalate paths: skip Shopify, still persist the decision so the
 *      escalation queue (Hafta 3) can pick it up.
 *
 * expires_at is stamped HERE (14 days by default) — the pure engine has no
 * clock (see §3 rationale).
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { evaluate } from "@/feature/pricefloor/engine";
import type {
  CostSnapshot,
  QuoteDecision,
  QuoteRequest,
  RuleSet,
} from "@/feature/pricefloor/engine";
import { insertQuoteRequest } from "@/feature/pricefloor/adapters/supabase/quote-request.repository";
import { insertQuoteDecision } from "@/feature/pricefloor/adapters/supabase/quote-decision.repository";
import { insertAuditEvent } from "@/feature/pricefloor/adapters/supabase/audit-log.repository";
import { insertEscalation } from "@/feature/pricefloor/adapters/supabase/escalation.repository";
import { notifyEscalationOpened } from "@/feature/pricefloor/services/escalation-notifier.service";
import {
  createDraftOrder,
  sendDraftOrderInvoice,
  type DraftOrderLine,
} from "@/feature/pricefloor/adapters/shopify/draft-order.shopify";
import type { QuoteRequestSource } from "@/feature/pricefloor/adapters/supabase/quote-request.repository";

export interface DecideAndActInput {
  admin: AdminApiContext;
  shop: string;
  companyId: string;
  shopifyCustomerId?: string | null;
  shopifyCompanyId?: string | null;
  shopifyCustomerEmail?: string | null;
  source: QuoteRequestSource;
  request: QuoteRequest;
  ruleSet: RuleSet;
  ruleSetDbId: string; // pf_rule_sets.id (uuid), NOT the engine's ruleSet.id string
  costSnapshot: CostSnapshot;
  autoSendInvoice?: boolean; // only used when automatic fulfillment is explicitly enabled
  expiryDays?: number; // default 14
}

export interface DecideAndActResult {
  decision: QuoteDecision;
  quoteRequestId: string;
  quoteDecisionId: string;
  draftOrderId: string | null;
  invoiceUrl: string | null;
  expiresAt: string | null;
  escalationId: string | null;
}

const DEFAULT_EXPIRY_DAYS = 14;

export async function decideAndAct(
  input: DecideAndActInput,
): Promise<DecideAndActResult> {
  const decision = evaluate(input.request, input.ruleSet, input.costSnapshot);

  const quoteRequestId = await insertQuoteRequest({
    companyId: input.companyId,
    shop: input.shop,
    shopifyCompanyId: input.shopifyCompanyId,
    shopifyCustomerEmail: input.shopifyCustomerEmail ?? null,
    source: input.source,
    raw: input.request,
  });

  await insertAuditEvent({
    companyId: input.companyId,
    shop: input.shop,
    eventType: "quote_received",
    payload: {
      requestId: input.request.requestId,
      quoteRequestId,
      source: input.source,
      lineCount: input.request.lines.length,
    },
  });

  let draftOrderId: string | null = null;
  let draftOrderName: string | null = null;
  let invoiceUrl: string | null = null;
  let expiresAt: string | null = null;
  let invoiceSent = false;

  // Safety default: the engine may recommend a price, but it must not create
  // a Shopify Draft Order or send an invoice until a merchant approves it.
  // Enable only deliberately with PRICEFLOOR_AUTO_APPROVAL=true.
  const automaticFulfillment = process.env.PRICEFLOOR_AUTO_APPROVAL === "true";
  if (automaticFulfillment && decision.decision !== "escalate") {
    const lines = buildDraftLines(decision);
    if (lines.length > 0) {
      const draft = await createDraftOrder(input.admin, {
        customerId: input.shopifyCustomerId ?? null,
        shopifyCompanyId: input.shopifyCompanyId ?? null,
        currencyCode: decision.currency,
        lines,
        note: `Pricefloor quote ${input.request.requestId}`,
      });
      draftOrderId = draft.id;
      draftOrderName = draft.name;
      invoiceUrl = draft.invoiceUrl;

      expiresAt = stampExpiry(input.expiryDays ?? DEFAULT_EXPIRY_DAYS);

      const shouldSend =
        input.autoSendInvoice ??
        // Auto_approve: buyer expects the invoice immediately. Counter_offer:
        // merchant may want to review before sending, so default to off.
        decision.decision === "auto_approve";
      if (shouldSend) {
        await sendDraftOrderInvoice(input.admin, draft.id);
        invoiceSent = true;
      }
    }
  }

  const decisionWithExpiry: QuoteDecision = expiresAt
    ? { ...decision, expiresAt }
    : decision;

  const quoteDecisionId = await insertQuoteDecision({
    requestId: quoteRequestId,
    ruleSetId: input.ruleSetDbId,
    decision: decision.decision,
    decisionReason: decision.decisionReason,
    output: decisionWithExpiry,
    shopifyDraftOrderId: draftOrderId,
    shopifyDraftOrderName: draftOrderName,
    invoiceUrl,
    expiresAt,
  });

  // Every decision emits one decision_made row; draft_order_created / invoice_sent
  // / escalation_opened are additional facets, not replacements.
  await insertAuditEvent({
    companyId: input.companyId,
    shop: input.shop,
    eventType: "decision_made",
    decisionId: quoteDecisionId,
    payload: {
      decision: decision.decision,
      reason: decision.decisionReason,
      ruleSetVersion: decision.ruleSetVersion,
      appliedRules: decision.lines.flatMap((l) => l.appliedRules),
      totalPrice: decision.totalPrice,
      warnings: decision.warnings,
    },
  });

  if (draftOrderId) {
    await insertAuditEvent({
      companyId: input.companyId,
      shop: input.shop,
      eventType: "draft_order_created",
      decisionId: quoteDecisionId,
      payload: {
        draftOrderId,
        draftOrderName,
        invoiceUrl,
        expiresAt,
      },
    });
  }

  if (invoiceSent) {
    await insertAuditEvent({
      companyId: input.companyId,
      shop: input.shop,
      eventType: "invoice_sent",
      decisionId: quoteDecisionId,
      payload: { draftOrderId },
    });
  }

  let escalationId: string | null = null;
  if (decision.decision === "escalate") {
    escalationId = await insertEscalation({ requestId: quoteRequestId });
    await insertAuditEvent({
      companyId: input.companyId,
      shop: input.shop,
      eventType: "escalation_opened",
      decisionId: quoteDecisionId,
      payload: {
        escalationId,
        reason: decision.decisionReason,
        // Line-level reasons help the queue triage.
        lineReasons: decision.lines.map((l) => ({
          variantId: l.variantId,
          reason: l.lineReason ?? null,
        })),
      },
    });
    // Email is best-effort. A failed send should not block persisting the
    // escalation — the queue UI is still the authoritative surface.
    try {
      await notifyEscalationOpened({
        companyId: input.companyId,
        shop: input.shop,
        escalationId,
        quoteRequestId,
        decision: decisionWithExpiry,
        // Admin lets the notifier lazy-sync shop.email when the merchant_email
        // meta hasn't been populated yet (e.g. store skipped onboarding).
        admin: input.admin,
      });
    } catch (e) {
      console.error("[decideAndAct] escalation email failed:", e);
    }
  }

  return {
    decision: decisionWithExpiry,
    quoteRequestId,
    quoteDecisionId,
    draftOrderId,
    invoiceUrl,
    expiresAt,
    escalationId,
  };
}

function buildDraftLines(decision: QuoteDecision): DraftOrderLine[] {
  return decision.lines
    .filter((l): l is typeof l & { unitPrice: number } => l.unitPrice != null)
    .map((l) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    }));
}

function stampExpiry(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
