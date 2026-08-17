/**
 * Escalation queue page.
 *
 *   /app/pricefloor/escalations
 *
 * Lists pending + in_review escalations for the shop and lets the merchant
 * mark one resolved. The resolve action re-uses the same repository the cron
 * uses to close SLA reminders.
 */

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  TextField,
  EmptyState,
} from "@shopify/polaris";

import { authenticate } from "@/adapters/shopify/shopify.server";
import supabase from "@/adapters/supabase/supabase.server";
import { companyService } from "@/feature/bite/services/company.service";
import {
  listEscalations,
  resolveEscalation,
  type EscalationRow,
} from "@/feature/pricefloor/adapters/supabase/escalation.repository";
import {
  labelForEscalationStatus,
  labelForReason,
} from "@/feature/pricefloor/lib/labels";
import styles from "../styles/pricefloor-pages.module.css";
import type { QuoteDecisionLine } from "@/feature/pricefloor/engine";
import { createDraftOrder, sendDraftOrderInvoice } from "@/feature/pricefloor/adapters/shopify/draft-order.shopify";
import { markDecisionFulfilled } from "@/feature/pricefloor/adapters/supabase/quote-decision.repository";

interface EscalationWithDecision extends EscalationRow {
  decisionId: string | null;
  decisionReason: string | null;
  totalPrice: number | null;
  currency: string | null;
  lines: QuoteDecisionLine[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  if (!company) return { escalations: [] as EscalationWithDecision[] };

  const escalations = await listEscalations(company.id);
  if (escalations.length === 0) return { escalations: [] };

  // Join to decisions (via request) so the queue shows the reason + total
  // without additional client-side round-trips.
  const requestIds = escalations.map((e) => e.requestId);
  const { data: decisions } = await supabase
    .from("pf_quote_decisions")
    .select("id, request_id, decision_reason, output")
    .in("request_id", requestIds);

  const byReq = new Map<string, { id: string; reason: string | null; output: any }>(
    (decisions ?? []).map((d: any) => [
      d.request_id,
      { id: d.id, reason: d.decision_reason, output: d.output },
    ]),
  );

  const enriched: EscalationWithDecision[] = escalations.map((e) => {
    const d = byReq.get(e.requestId);
    return {
      ...e,
      decisionId: d?.id ?? null,
      decisionReason: d?.reason ?? null,
      totalPrice: d?.output?.totalPrice ?? null,
      currency: d?.output?.currency ?? null,
      lines: d?.output?.lines ?? [],
    };
  });

  return { escalations: enriched };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  if (!company) return Response.json({ ok: false }, { status: 404 });

  const fd = await request.formData();
  const intent = fd.get("intent");
  const id = fd.get("id") as string;
  if (intent === "counter") {
    const decisionId = String(fd.get("decisionId") ?? "");
    const unitPrice = Number(fd.get("unitPrice"));
    if (!id || !decisionId || !Number.isFinite(unitPrice) || unitPrice <= 0)
      return Response.json({ ok: false, error: "Enter a valid counter-offer price." }, { status: 400 });
    const { data: row, error } = await supabase
      .from("pf_quote_decisions")
      .select("id, output, pf_quote_requests!inner(company_id, raw_input, shopify_company_id)")
      .eq("id", decisionId)
      .eq("pf_quote_requests.company_id", company.id)
      .single();
    if (error || !row) return Response.json({ ok: false, error: "Quote not found." }, { status: 404 });
    const output = row.output as { currency: string; lines: QuoteDecisionLine[] };
    const requestRow = row.pf_quote_requests as unknown as { raw_input?: { shopifyCustomerEmail?: string }; shopify_company_id?: string | null };
    if (output.lines.length !== 1)
      return Response.json({ ok: false, error: "Multi-product quotes require a price for each product." }, { status: 400 });
    const line = output.lines[0];
    if (line.unitCost != null && unitPrice < line.unitCost)
      return Response.json({ ok: false, error: "Counter offer cannot be below unit cost." }, { status: 400 });
    if (line.basePrice != null && unitPrice > line.basePrice)
      return Response.json({ ok: false, error: "Counter offer cannot exceed the list price." }, { status: 400 });
    const draft = await createDraftOrder(admin, {
      currencyCode: output.currency,
      email: requestRow.raw_input?.shopifyCustomerEmail ?? null,
      shopifyCompanyId: requestRow.shopify_company_id ?? null,
      lines: [{ variantId: line.variantId, quantity: line.quantity, unitPrice }],
      note: `Manual Pricefloor counter offer ${decisionId}`,
    });
    const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
    await markDecisionFulfilled(decisionId, { ...draft, expiresAt });
    if (draft.id) await sendDraftOrderInvoice(admin, draft.id);
    await resolveEscalation(id, `Manual counter offer: ${output.currency} ${unitPrice.toFixed(2)} per unit`, `merchant:${session.shop}`);
    return Response.json({ ok: true, draftOrderName: draft.name });
  }
  if (intent !== "resolve") return Response.json({ ok: false, error: "Invalid action." }, { status: 400 });

  const resolution = ((fd.get("resolution") as string) || "").trim();
  if (!id || !resolution)
    return Response.json({ ok: false, error: "missing_fields" }, { status: 400 });

  await resolveEscalation(id, resolution, `merchant:${session.shop}`);
  return Response.json({ ok: true });
};

export default function EscalationsPage() {
  const { escalations } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get("highlight");

  return (
    <Page
      backAction={{ content: "Dashboard", url: "/app" }}
      title="Needs review"
      subtitle="Resolve quotes that Pricefloor could not safely decide automatically."
    >
      <Layout>
        <Layout.Section>
          {escalations.length === 0 ? (
            <Card>
              <EmptyState
                heading="No open escalations"
                image=""
              >
                <p>
                  Escalations appear here when the engine can't decide a quote
                  on its own — missing cost data, excluded products, or
                  inconsistent rules.
                </p>
              </EmptyState>
            </Card>
          ) : (
            <BlockStack gap="300">
              {escalations.map((e) => (
                <EscalationCard
                  key={e.id}
                  escalation={e}
                  highlighted={e.id === highlight}
                />
              ))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function EscalationCard({
  escalation,
  highlighted,
}: {
  escalation: EscalationWithDecision;
  highlighted: boolean;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string; draftOrderName?: string }>();
  const [resolution, setResolution] = useState("");
  const [counterPrice, setCounterPrice] = useState("");
  const submitting = fetcher.state !== "idle";
  const done = fetcher.data?.ok;
  const lineCount = Array.isArray(escalation.lines) ? escalation.lines.length : 0;
  const singleLine = lineCount === 1 ? escalation.lines[0] : null;
  const requestedTotal = escalation.lines.reduce((sum, line) => sum + (line.requestedUnitPrice ?? 0) * line.quantity, 0);

  return (
    <article className={styles.escalationCard} style={highlighted ? { outline: "2px solid var(--p-color-border-info)" } : undefined}>
      <div className={styles.escalationMain}>
        <div className={styles.escalationReason}>
          <InlineStack gap="200" blockAlign="center" wrap>
            <Badge tone={escalation.status === "pending" ? "warning" : "info"}>{labelForEscalationStatus(escalation.status)}</Badge>
            <Text as="span" tone="subdued" variant="bodySm">Opened {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(escalation.createdAt))}</Text>
          </InlineStack>
          <Text as="h3" variant="headingMd">{labelForReason(escalation.decisionReason)}</Text>
          <Text as="p" tone="subdued" variant="bodySm">{lineCount ? `${lineCount} ${lineCount === 1 ? "product" : "products"} · ` : ""}Reference {escalation.requestId.slice(0, 8)}</Text>
        </div>
        {(escalation.totalPrice != null || requestedTotal > 0) && <div className={styles.escalationTotal}><Text as="p" tone="subdued" variant="bodySm">Buyer requested</Text><Text as="p" variant="headingLg">{new Intl.NumberFormat(undefined, { style: "currency", currency: escalation.currency ?? "USD" }).format(escalation.totalPrice ?? requestedTotal)}</Text></div>}
      </div>
      <div className={styles.resolution}>
        {done ? <InlineStack gap="200" blockAlign="center"><Badge tone="success">Resolved</Badge><Text as="span" tone="subdued">{fetcher.data?.draftOrderName ? `Counter offer ${fetcher.data.draftOrderName} created and sent.` : "This quote has been removed from the review queue."}</Text></InlineStack> : singleLine && escalation.decisionReason === "manual_review_required" ? (
          <fetcher.Form method="post" className={styles.resolutionForm}>
            <input type="hidden" name="intent" value="counter" />
            <input type="hidden" name="id" value={escalation.id} />
            <input type="hidden" name="decisionId" value={escalation.decisionId ?? ""} />
            <TextField label={`Approve or counter per unit (${escalation.currency ?? "USD"})`} name="unitPrice" type="number" min={singleLine.unitCost ?? 0} max={singleLine.basePrice} step={0.01} value={counterPrice} onChange={setCounterPrice} autoComplete="off" helpText={`Buyer requested ${singleLine.requestedUnitPrice ?? "—"} · Cost ${singleLine.unitCost ?? "—"} · List ${singleLine.basePrice ?? "—"}`} error={fetcher.data?.error} />
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              {singleLine.requestedUnitPrice != null && <Button onClick={() => setCounterPrice(String(singleLine.requestedUnitPrice))}>Use buyer price</Button>}
              <Button submit variant="primary" loading={submitting} disabled={!counterPrice.trim() || !escalation.decisionId}>Approve & send offer</Button>
            </InlineStack>
          </fetcher.Form>
        ) : (
            <fetcher.Form method="post" className={styles.resolutionForm}>
              <input type="hidden" name="intent" value="resolve" />
              <input type="hidden" name="id" value={escalation.id} />
                <TextField
                  label="How was this resolved?"
                  name="resolution"
                  value={resolution}
                  onChange={setResolution}
                  autoComplete="off"
                  placeholder="e.g. Offered $7,900 by email"
                />
                  <Button
                    submit
                    variant="primary"
                    loading={submitting}
                    disabled={!resolution.trim()}
                  >
                    Mark resolved
                  </Button>
            </fetcher.Form>
          )}
      </div>
    </article>
  );
}
