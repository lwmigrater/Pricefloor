import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  EmptyState,
  InlineStack,
  Layout,
  Link,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";

import { authenticate } from "@/adapters/shopify/shopify.server";
import supabase from "@/adapters/supabase/supabase.server";
import { companyService } from "@/feature/bite/services/company.service";
import { createDraftOrder, sendDraftOrderInvoice } from "@/feature/pricefloor/adapters/shopify/draft-order.shopify";
import { resolveEscalation } from "@/feature/pricefloor/adapters/supabase/escalation.repository";
import {
  listQuoteDecisions,
  markDecisionFulfilled,
  type QuoteDecisionRow,
} from "@/feature/pricefloor/adapters/supabase/quote-decision.repository";
import type { Decision, QuoteDecisionLine } from "@/feature/pricefloor/engine";
import { labelForDecision, labelForReason } from "@/feature/pricefloor/lib/labels";
import styles from "../styles/quote-history.module.css";

const PAGE_SIZE = 50;
const FILTERS: Array<{ label: string; value: "" | Decision }> = [
  { label: "All", value: "" },
  { label: "Approved", value: "auto_approve" },
  { label: "Counter offers", value: "counter_offer" },
  { label: "Needs review", value: "escalate" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  if (!company) return { rows: [] as QuoteDecisionRow[], filter: "" };

  const raw = new URL(request.url).searchParams.get("filter") ?? "";
  const filter = (["auto_approve", "counter_offer", "escalate"] as const).includes(raw as Decision)
    ? (raw as Decision)
    : undefined;
  const rows = await listQuoteDecisions(company.id, { decision: filter, limit: PAGE_SIZE });
  return { rows, filter: filter ?? "" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  if (!company || !["approve", "manualOffer"].includes(intent))
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });

  const decisionId = String(fd.get("decisionId") ?? "");
  const { data: row, error } = await supabase
    .from("pf_quote_decisions")
    .select("id, request_id, output, pf_quote_requests!inner(company_id, raw_input, shopify_company_id)")
    .eq("id", decisionId)
    .eq("pf_quote_requests.company_id", company.id)
    .single();
  if (error || !row) return Response.json({ ok: false, error: "Quote not found." }, { status: 404 });

  const output = row.output as QuoteDecisionRow["output"];
  if (intent === "manualOffer") {
    if (output.lines.length !== 1)
      return Response.json({ ok: false, error: "Multi-product quotes require a price for each product." }, { status: 400 });
    const line = output.lines[0];
    const unitPrice = Number(fd.get("unitPrice"));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0)
      return Response.json({ ok: false, error: "Enter a valid offer price." }, { status: 400 });
    if (line.unitCost != null && unitPrice < line.unitCost)
      return Response.json({ ok: false, error: "Offer cannot be below unit cost." }, { status: 400 });
    if (line.basePrice != null && unitPrice > line.basePrice)
      return Response.json({ ok: false, error: "Offer cannot exceed the list price." }, { status: 400 });
    const requestRow = row.pf_quote_requests as unknown as { raw_input?: { shopifyCustomerEmail?: string }; shopify_company_id?: string | null };
    const draft = await createDraftOrder(admin, {
      currencyCode: output.currency,
      email: requestRow.raw_input?.shopifyCustomerEmail ?? null,
      shopifyCompanyId: requestRow.shopify_company_id ?? null,
      lines: [{ variantId: line.variantId, quantity: line.quantity, unitPrice }],
      note: `Merchant-approved Pricefloor offer ${decisionId}`,
    });
    const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
    await markDecisionFulfilled(decisionId, { ...draft, expiresAt });
    if (draft.id) await sendDraftOrderInvoice(admin, draft.id);
    const { data: escalation } = await supabase.from("pf_escalations").select("id").eq("request_id", row.request_id).neq("status", "resolved").maybeSingle();
    if (escalation?.id) await resolveEscalation(escalation.id, `Merchant offer: ${output.currency} ${unitPrice.toFixed(2)} per unit`, `merchant:${session.shop}`);
    return Response.json({ ok: true, draftOrderName: draft.name, invoiceUrl: draft.invoiceUrl });
  }
  const lines = output.lines
    .filter((line) => line.unitPrice != null)
    .map((line) => ({ variantId: line.variantId, quantity: line.quantity, unitPrice: line.unitPrice! }));
  if (!lines.length)
    return Response.json({ ok: false, error: "This quote has no proposed prices." }, { status: 400 });
  if (output.lines.some((line) => line.unitPrice != null && line.basePrice != null && line.unitPrice > line.basePrice))
    return Response.json({ ok: false, error: "This offer exceeds the list price. Review the margin rule before creating a draft order." }, { status: 400 });

  const draft = await createDraftOrder(admin, {
    currencyCode: output.currency,
    lines,
    note: `Pricefloor merchant-approved quote ${decisionId}`,
  });
  const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
  await markDecisionFulfilled(decisionId, { ...draft, expiresAt });
  if (fd.get("sendInvoice") === "true" && draft.id) await sendDraftOrderInvoice(admin, draft.id);
  return Response.json({ ok: true, draftOrderName: draft.name, invoiceUrl: draft.invoiceUrl });
};

export default function HistoryPage() {
  const { rows, filter } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const counts = countDecisions(rows);

  return (
    <Page
      backAction={{ content: "Dashboard", url: "/app" }}
      title="Quote requests"
      subtitle="Review buyer requests, pricing decisions, and margin impact in one place."
      primaryAction={{ content: "Test a quote", url: "/app/pricefloor/simulator" }}
    >
      <Layout>
        <Layout.Section>
          <div className={styles.toolbar}>
            <div className={styles.filterGroup} role="group" aria-label="Filter quote requests">
              {FILTERS.map((item) => (
                <button
                  className={`${styles.filterButton} ${filter === item.value ? styles.filterButtonActive : ""}`}
                  key={item.value || "all"}
                  onClick={() => setSearchParams(item.value ? { filter: item.value } : {})}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <Text as="span" tone="subdued" variant="bodySm">
              Showing {rows.length} most recent {rows.length === 1 ? "request" : "requests"}
            </Text>
          </div>
        </Layout.Section>

        {filter === "" && rows.length > 0 && (
          <Layout.Section>
            <div className={styles.metrics}>
              <Metric label="Total requests" value={counts.total} />
              <Metric label="Approved" value={counts.auto} tone="success" />
              <Metric label="Counter offers" value={counts.counter} tone="warning" />
              <Metric label="Needs review" value={counts.escalate} tone="critical" />
            </div>
          </Layout.Section>
        )}

        <Layout.Section>
          {rows.length === 0 ? (
            <Card>
              <EmptyState
                heading={filter ? "No matching quote requests" : "No quote requests yet"}
                image=""
                action={filter
                  ? { content: "Show all requests", onAction: () => setSearchParams({}) }
                  : { content: "Test a quote", url: "/app/pricefloor/simulator" }}
              >
                <p>{filter ? "Choose another status to broaden your results." : "New storefront and simulator requests will appear here."}</p>
              </EmptyState>
            </Card>
          ) : (
            <div className={styles.list}>
              {rows.map((row) => <DecisionRow key={row.id} row={row} />)}
            </div>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "critical" }) {
  return (
    <div className={styles.metric}>
      <Text as="span" tone="subdued" variant="bodySm">{label}</Text>
      <div className={styles.metricValue}>
        <span className={`${styles.metricDot} ${tone ? styles[`dot_${tone}`] : ""}`} />
        <Text as="strong" variant="headingLg">{value}</Text>
      </div>
    </div>
  );
}

function DecisionRow({ row }: { row: QuoteDecisionRow }) {
  const [open, setOpen] = useState(false);
  const [offerPrice, setOfferPrice] = useState("");
  const approveFetcher = useFetcher<{ ok: boolean; error?: string; draftOrderName?: string }>();
  const lineCount = row.output.lines.length;
  const unitCount = row.output.lines.reduce((sum, line) => sum + line.quantity, 0);
  const requestedTotal = sumLinePrices(row.output.lines, "requestedUnitPrice");
  const listTotal = sumLinePrices(row.output.lines, "basePrice");
  const proposedTotal = row.output.totalPrice ?? sumLinePrices(row.output.lines, "unitPrice");
  const requestedSavings = requestedTotal != null && listTotal != null ? listTotal - requestedTotal : null;
  const applied = Array.from(new Set(row.output.lines.flatMap((line) => line.appliedRules)));
  const fulfilled = Boolean(row.shopifyDraftOrderId);
  const exceedsListPrice = proposedTotal != null && listTotal != null && proposedTotal > listTotal;
  const reviewLine = row.decision === "escalate" && row.output.lines.length === 1 ? row.output.lines[0] : null;

  return (
    <article className={styles.quoteCard}>
      <div className={styles.quoteHeader}>
        <div className={styles.quoteIdentity}>
          <InlineStack gap="200" blockAlign="center" wrap>
            <Badge tone={badgeToneFor(row.decision)}>{labelForDecision(row.decision)}</Badge>
            {fulfilled && <Badge tone="success">Draft created</Badge>}
            <Text as="span" tone="subdued" variant="bodySm">{formatDate(row.decidedAt)}</Text>
          </InlineStack>
          <Text as="h2" variant="headingMd">{labelForReason(row.decisionReason)}</Text>
          <Text as="p" tone="subdued" variant="bodySm">
            {lineCount} {lineCount === 1 ? "product" : "products"} · {unitCount} units
          </Text>
        </div>
        <div className={styles.totalBlock}>
          <Text as="span" tone="subdued" variant="bodySm">
            {row.decision === "counter_offer" ? "Counter-offer total" : row.decision === "escalate" ? "Requested total" : "Approved total"}
          </Text>
          <Text as="strong" variant="headingLg">{money(proposedTotal, row.output.currency)}</Text>
        </div>
      </div>

      <div className={styles.priceStrip}>
        <PricePoint label="List total" value={money(listTotal, row.output.currency)} />
        <span className={styles.priceArrow} aria-hidden>→</span>
        <PricePoint
          label="Buyer requested"
          value={money(requestedTotal, row.output.currency)}
          caption={requestedSavings != null && requestedSavings > 0 ? `${percentage(requestedSavings, listTotal)} below list` : undefined}
        />
        <span className={styles.priceArrow} aria-hidden>→</span>
        <PricePoint
          label={row.decision === "counter_offer" ? "Your counter offer" : "Final decision"}
          value={money(proposedTotal, row.output.currency)}
          emphasis
        />
      </div>

      {exceedsListPrice && <div className={styles.pricingWarning}><Text as="strong" tone="critical">Pricing rule conflict</Text><Text as="span" tone="subdued" variant="bodySm">The margin floor produces an offer above the list price. Update the product cost or margin rule; new quotes will be sent to manual review.</Text></div>}

      {reviewLine && !fulfilled && <approveFetcher.Form method="post" className={styles.reviewBar}>
        <input type="hidden" name="intent" value="manualOffer" />
        <input type="hidden" name="decisionId" value={row.id} />
        <div className={styles.reviewCopy}><Text as="strong">Review this request</Text><Text as="span" tone="subdued" variant="bodySm">Approve the buyer’s price or enter your own unit price.</Text></div>
        <div className={styles.reviewInput}><TextField label="Offer per unit" labelHidden name="unitPrice" type="number" min={reviewLine.unitCost ?? 0} max={reviewLine.basePrice} step={0.01} value={offerPrice} onChange={setOfferPrice} autoComplete="off" placeholder={reviewLine.requestedUnitPrice != null ? money(reviewLine.requestedUnitPrice, row.output.currency, false) : "Enter price"} error={approveFetcher.data?.error} /></div>
        <Button onClick={() => setOfferPrice(String(reviewLine.requestedUnitPrice ?? ""))} disabled={reviewLine.requestedUnitPrice == null}>Use buyer price</Button>
        <Button submit variant="primary" loading={approveFetcher.state !== "idle"} disabled={!offerPrice.trim()}>Approve & send</Button>
      </approveFetcher.Form>}

      {approveFetcher.data?.ok && <div className={styles.successBar}><Badge tone="success">Offer sent</Badge><Text as="span" variant="bodySm">Draft order {approveFetcher.data.draftOrderName} was created.</Text></div>}

      <div className={styles.quoteActions}>
        <Button onClick={() => setOpen((value) => !value)} variant="plain" disclosure={open ? "up" : "down"}>
          {open ? "Hide breakdown" : "View price breakdown"}
        </Button>
        {row.invoiceUrl && <Link url={row.invoiceUrl} target="_blank">Open checkout</Link>}
      </div>

      <Collapsible open={open} id={`quote-${row.id}`}>
        <div className={styles.details}>
          <div className={styles.sectionHeading}>
            <Text as="h3" variant="headingSm">Products</Text>
            <Text as="span" tone="subdued" variant="bodySm">Unit prices shown in {row.output.currency}</Text>
          </div>
          <div className={styles.lineTable}>
            <div className={`${styles.lineGrid} ${styles.tableHeader}`}>
              <span>Product variant</span><span>Qty</span><span>List</span><span>Requested</span><span>Offer</span><span>Margin</span>
            </div>
            {row.output.lines.map((line, index) => (
              <div className={styles.lineRow} key={`${line.variantId}-${index}`}>
                <div className={styles.lineGrid}>
                  <div className={styles.variantCell}>
                    <Text as="span" variant="bodySm">Variant {shortId(line.variantId)}</Text>
                    {line.lineReason && <Text as="span" tone="subdued" variant="bodySm">{labelForReason(line.lineReason)}</Text>}
                  </div>
                  <span>{line.quantity}</span>
                  <span>{money(line.basePrice, row.output.currency, false)}</span>
                  <span>{money(line.requestedUnitPrice, row.output.currency, false)}</span>
                  <strong>{money(line.unitPrice, row.output.currency, false)}</strong>
                  <Margin value={line.marginPct} />
                </div>
                {line.alternatives?.length ? (
                  <div className={styles.alternatives}>
                    <Text as="span" variant="bodySm" tone="subdued">Ways to improve this price:</Text>
                    {line.alternatives.map((alt, i) => <Badge key={i} tone="info">{`${alt.description}: ${money(alt.unitPrice, row.output.currency, false)}`}</Badge>)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className={styles.detailFooter}>
            <div>
              <Text as="h3" variant="headingSm">Decision details</Text>
              <div className={styles.ruleList}>
                {applied.length ? applied.map((rule) => <span className={styles.rule} key={rule}>{friendlyRule(rule)}</span>) : <Text as="span" tone="subdued" variant="bodySm">No pricing rules were applied.</Text>}
              </div>
              <Text as="p" tone="subdued" variant="bodySm">Reference {shortId(row.requestId)} · {formatDate(row.decidedAt, true)}</Text>
            </div>

            {!fulfilled && row.decision !== "escalate" && !exceedsListPrice && (
              <approveFetcher.Form method="post" className={styles.approveForm}>
                <input type="hidden" name="intent" value="approve" />
                <input type="hidden" name="decisionId" value={row.id} />
                {approveFetcher.data?.error && <Text as="p" tone="critical" variant="bodySm">{approveFetcher.data.error}</Text>}
                {approveFetcher.data?.ok ? (
                  <Badge tone="success">{`Draft order ${approveFetcher.data.draftOrderName ?? ""} created`}</Badge>
                ) : (
                  <Button submit variant="primary" loading={approveFetcher.state !== "idle"}>Approve & create draft order</Button>
                )}
              </approveFetcher.Form>
            )}
          </div>
        </div>
      </Collapsible>
    </article>
  );
}

function PricePoint({ label, value, caption, emphasis }: { label: string; value: string; caption?: string; emphasis?: boolean }) {
  return <div className={`${styles.pricePoint} ${emphasis ? styles.pricePointEmphasis : ""}`}><Text as="span" tone="subdued" variant="bodySm">{label}</Text><Text as="strong" variant="headingSm">{value}</Text>{caption && <Text as="span" tone="subdued" variant="bodySm">{caption}</Text>}</div>;
}

function Margin({ value }: { value: number | null }) {
  if (value == null) return <span>—</span>;
  const className = value < 10 ? styles.marginBad : value < 20 ? styles.marginWarn : styles.marginGood;
  return <span className={`${styles.margin} ${className}`}>{value.toFixed(1)}%</span>;
}

function sumLinePrices(lines: QuoteDecisionLine[], key: "basePrice" | "requestedUnitPrice" | "unitPrice") {
  if (!lines.length || lines.some((line) => line[key] == null)) return null;
  return lines.reduce((sum, line) => sum + Number(line[key]) * line.quantity, 0);
}

function money(value: number | null | undefined, currency: string, showCurrency = true) {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: showCurrency ? "currency" : "decimal", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch { return `${showCurrency ? `${currency} ` : ""}${value.toFixed(2)}`; }
}

function percentage(value: number, base: number | null) { return base && base > 0 ? `${Math.round((value / base) * 100)}%` : ""; }
function shortId(value: string) { return value.split("/").pop()?.slice(-12) ?? value.slice(0, 12); }
function friendlyRule(value: string) { return value.split(":")[0].replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value: string, includeYear = false) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(includeYear ? { year: "numeric" as const } : {}), hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function countDecisions(rows: QuoteDecisionRow[]) { return { total: rows.length, auto: rows.filter((r) => r.decision === "auto_approve").length, counter: rows.filter((r) => r.decision === "counter_offer").length, escalate: rows.filter((r) => r.decision === "escalate").length }; }
function badgeToneFor(decision: Decision): "success" | "warning" | "critical" { return decision === "auto_approve" ? "success" : decision === "counter_offer" ? "warning" : "critical"; }
