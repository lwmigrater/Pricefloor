/**
 * Simulator — dry-run the engine without touching Shopify or persisting.
 *
 *   /app/pricefloor/simulator
 *
 * Plan §8: "Bu ekran satışın kendisi. Demo bunun üzerinden yapılır, MVP'den
 * çıkarma." Merchant picks a variant, optionally overrides qty/price/tier and
 * sees exactly what the engine would decide.
 *
 * Uses the ACTIVE rule set + the CACHED cost snapshot — the same inputs the
 * live proxy uses. Draft order creation is skipped: pure `evaluate` only.
 *
 * Optional persist: when the "Save to Quotes history" box is ticked the
 * action ALSO writes a pf_quote_request + pf_quote_decision row (source:
 * "form"). It never calls decideAndAct — that would create a Shopify draft
 * order + send an invoice, wrong for a test tool.
 */

import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Select,
  Button,
  ButtonGroup,
  Badge,
  Banner,
  Box,
  Checkbox,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";
import { getActiveRuleSet } from "@/feature/pricefloor/adapters/supabase/rule-set.repository";
import { getFreshSnapshot } from "@/feature/pricefloor/services/cost-cache.service";
import { insertQuoteRequest } from "@/feature/pricefloor/adapters/supabase/quote-request.repository";
import { insertQuoteDecision } from "@/feature/pricefloor/adapters/supabase/quote-decision.repository";
import { evaluate } from "@/feature/pricefloor/engine";
import type { QuoteDecision, QuoteRequest } from "@/feature/pricefloor/engine";
import { labelForDecision, labelForReason } from "@/feature/pricefloor/lib/labels";
import styles from "../styles/pricefloor-pages.module.css";

const QUANTITY_PRESETS = [100, 500, 1000, 2500] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  const ruleSetVersion = company
    ? (await getActiveRuleSet(company.id))?.ruleSet.version ?? null
    : null;
  return { shop: session.shop, ruleSetVersion };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  if (!company) return Response.json({ ok: false, error: "no_company" }, { status: 404 });

  const active = await getActiveRuleSet(company.id);
  if (!active)
    return Response.json({ ok: false, error: "no_active_rule_set" }, { status: 409 });

  const fd = await request.formData();
  const variantId = String(fd.get("variantId") ?? "").trim();
  const productId = String(fd.get("productId") ?? "").trim();
  const quantity = Number(fd.get("quantity") ?? 0);
  const requestedRaw = fd.get("requestedUnitPrice");
  const basePriceRaw = fd.get("basePrice");
  const tier = String(fd.get("tier") ?? "").trim();
  const currency = String(fd.get("currency") ?? "USD").trim() || "USD";
  const persist = String(fd.get("persist") ?? "") === "true";

  if (!variantId || !quantity)
    return Response.json({ ok: false, error: "missing_fields" }, { status: 400 });

  const cost = await getFreshSnapshot(admin, company.id, session.shop, [variantId]);

  const req: QuoteRequest = {
    requestId: persist ? crypto.randomUUID() : "sim",
    company: {
      id: "gid://shopify/Company/simulator",
      ...(tier ? { tier } : {}),
    },
    currency,
    lines: [
      {
        variantId,
        ...(productId ? { productId } : {}),
        quantity,
        ...(requestedRaw ? { requestedUnitPrice: Number(requestedRaw) } : {}),
        ...(basePriceRaw ? { basePrice: Number(basePriceRaw) } : {}),
      },
    ],
  };

  const decision = evaluate(req, active.ruleSet, cost);

  let persisted = false;
  if (persist) {
    try {
      const quoteRequestId = await insertQuoteRequest({
        companyId: company.id,
        shop: session.shop,
        source: "form",
        shopifyCompanyId: null,
        shopifyCustomerEmail: null,
        raw: req,
      });
      await insertQuoteDecision({
        requestId: quoteRequestId,
        ruleSetId: active.dbId,
        decision: decision.decision,
        decisionReason: decision.decisionReason,
        output: decision,
      });
      persisted = true;
    } catch (err) {
      console.error("[simulator] persist failed:", err);
      return Response.json({ ok: true, decision, persisted: false, persistError: (err as Error).message });
    }
  }

  return Response.json({ ok: true, decision, persisted });
};

interface ActionResult {
  ok: boolean;
  decision?: QuoteDecision;
  error?: string;
  persisted?: boolean;
  persistError?: string;
}

interface LookupResult {
  remote?: {
    variantId: string;
    sku: string | null;
    variantTitle: string | null;
    productTitle: string | null;
    price: number;
    unitCost: number | null;
    currency: string | null;
    inventoryQuantity: number | null;
  };
  cached?: { unitCost: number | null; currency: string | null; fetchedAt: number } | null;
  error?: string;
}

interface PickedVariant {
  variantId: string;
  productId?: string;
  displayName: string;
  sku: string | null;
}

export default function SimulatorPage() {
  const { ruleSetVersion } = useLoaderData<typeof loader>();
  const runFetcher = useFetcher<ActionResult>({ key: "sim-run" });
  const lookupFetcher = useFetcher<LookupResult>({ key: "sim-lookup" });
  const running = runFetcher.state !== "idle";
  const looking = lookupFetcher.state !== "idle";
  const shopify = useAppBridge();

  const [picked, setPicked] = useState<PickedVariant | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [variantIdManual, setVariantIdManual] = useState("");
  const [quantity, setQuantity] = useState("100");
  const [requestedUnitPrice, setRequestedUnitPrice] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [tier, setTier] = useState("gold");
  const [currency, setCurrency] = useState("USD");
  const [persist, setPersist] = useState(false);

  const effectiveVariantId = manualMode ? variantIdManual.trim() : picked?.variantId ?? "";

  const openPicker = useCallback(async () => {
    const selected = await shopify.resourcePicker({ type: "variant", multiple: false });
    if (!selected || selected.length === 0) return;
    const v = selected[0];
    const parent = (v.product as { title?: string } | undefined)?.title ?? "";
    const displayName =
      (v.displayName as string | undefined) ??
      (parent ? `${parent} — ${(v.title as string) ?? ""}` : (v.title as string) ?? v.id);
    setPicked({ variantId: v.id, productId: (v.product as { id?: string } | undefined)?.id, displayName, sku: (v.sku as string | null) ?? null });
    setManualMode(false);
    setVariantIdManual("");
    const fd = new FormData();
    fd.append("variantId", v.id);
    lookupFetcher.submit(fd, { method: "post", action: "/api/pricefloor/variant-lookup" });
  }, [shopify, lookupFetcher]);

  // Auto-fill base price from picker lookup (only if user hasn't typed one).
  useEffect(() => {
    const remote = lookupFetcher.data?.remote;
    if (!remote) return;
    if (!basePrice) setBasePrice(String(remote.price));
    if (remote.currency) setCurrency(remote.currency);
  }, [lookupFetcher.data, basePrice]);

  const submitRun = useCallback(
    (overrideQty?: string) => {
      const qty = overrideQty ?? quantity;
      if (!effectiveVariantId || !qty) return;
      const fd = new FormData();
      fd.append("variantId", effectiveVariantId);
      if (!manualMode && picked?.productId) fd.append("productId", picked.productId);
      fd.append("quantity", qty);
      if (requestedUnitPrice) fd.append("requestedUnitPrice", requestedUnitPrice);
      if (basePrice) fd.append("basePrice", basePrice);
      if (tier) fd.append("tier", tier);
      if (currency) fd.append("currency", currency);
      if (persist) fd.append("persist", "true");
      runFetcher.submit(fd, { method: "post" });
    },
    [effectiveVariantId, manualMode, picked?.productId, quantity, requestedUnitPrice, basePrice, tier, currency, persist, runFetcher],
  );

  const clickPreset = useCallback(
    (n: number) => {
      setQuantity(String(n));
      submitRun(String(n));
    },
    [submitRun],
  );

  const remote = lookupFetcher.data?.remote;
  const cached = lookupFetcher.data?.cached;

  return (
    <Page
      backAction={{ content: "Dashboard", url: "/app" }}
      title="Quote simulator"
      subtitle={
        ruleSetVersion != null
          ? `Runs against active rule set v${ruleSetVersion}.`
          : "No active rule set — save one in Rules first."
      }
    >
      <Layout>
        <Layout.Section>
          <div className={styles.simulatorGrid}>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                1. Choose a product
              </Text>
              {manualMode ? (
                <BlockStack gap="200">
                  <TextField
                    label="Variant GID"
                    value={variantIdManual}
                    onChange={setVariantIdManual}
                    autoComplete="off"
                    helpText="e.g. gid://shopify/ProductVariant/1234567890"
                  />
                  <InlineStack>
                    <Button
                      variant="plain"
                      onClick={() => {
                        setManualMode(false);
                        setVariantIdManual("");
                      }}
                    >
                      Back to product picker
                    </Button>
                  </InlineStack>
                </BlockStack>
              ) : picked ? (
                <BlockStack gap="200">
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {picked.displayName}
                      </Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {picked.sku ? `SKU: ${picked.sku} · ` : ""}
                        <code>{picked.variantId}</code>
                      </Text>
                    </BlockStack>
                  </Card>
                  <InlineStack gap="200">
                    <Button onClick={openPicker} loading={looking}>
                      Change variant
                    </Button>
                    <Button variant="plain" onClick={() => setManualMode(true)}>
                      Paste GID manually
                    </Button>
                  </InlineStack>
                </BlockStack>
              ) : (
                <BlockStack gap="200">
                  <InlineStack gap="200">
                    <Button variant="primary" onClick={openPicker} loading={looking}>
                      Pick product
                    </Button>
                    <Button variant="plain" onClick={() => setManualMode(true)}>
                      Or paste GID manually
                    </Button>
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Pick a variant to auto-fill the base price and check the cached unit cost.
                  </Text>
                </BlockStack>
              )}

              {remote && (
                <Banner
                  tone={remote.unitCost == null || !cached ? "warning" : "info"}
                  title="Cost & price"
                >
                  <p>
                    Live from Shopify: price{" "}
                    <b>
                      {remote.currency ?? currency} {remote.price.toFixed(2)}
                    </b>
                    , unit cost{" "}
                    <b>
                      {remote.unitCost != null
                        ? `${remote.currency ?? currency} ${remote.unitCost.toFixed(2)}`
                        : "—"}
                    </b>
                    {remote.inventoryQuantity != null ? `, inventory ${remote.inventoryQuantity}` : ""}.
                  </p>
                  <p>
                    Cache:{" "}
                    {cached
                      ? `unit cost ${cached.unitCost ?? "—"} (${timeAgo(cached.fetchedAt)})`
                      : "no cache row — engine will hold the quote for missing cost data unless costs are synced."}
                  </p>
                </Banner>
              )}

              {lookupFetcher.data?.error && (
                <Banner tone="critical" title="Variant lookup failed">
                  <p>
                    <code>{lookupFetcher.data.error}</code>
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                2. Build the scenario
              </Text>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  Quick presets — click to set quantity and run immediately.
                </Text>
                <InlineStack gap="200">
                  <ButtonGroup variant="segmented">
                    {QUANTITY_PRESETS.map((n) => (
                      <Button
                        key={n}
                        onClick={() => clickPreset(n)}
                        pressed={String(n) === quantity}
                        disabled={!effectiveVariantId}
                      >
                        {n.toLocaleString()}
                      </Button>
                    ))}
                  </ButtonGroup>
                </InlineStack>
              </BlockStack>
              <InlineStack gap="200" wrap>
                <div style={{ minWidth: 140 }}>
                  <TextField
                    label="Quantity"
                    type="number"
                    value={quantity}
                    onChange={setQuantity}
                    autoComplete="off"
                  />
                </div>
                <div style={{ minWidth: 160 }}>
                  <TextField
                    label="Requested unit price"
                    type="number"
                    value={requestedUnitPrice}
                    onChange={setRequestedUnitPrice}
                    autoComplete="off"
                    helpText="Blank = ask engine for best"
                  />
                </div>
                <div style={{ minWidth: 160 }}>
                  <TextField
                    label="Base (list) price"
                    type="number"
                    value={basePrice}
                    onChange={setBasePrice}
                    autoComplete="off"
                    helpText="Enables volume ladder + tier cap"
                  />
                </div>
                <div style={{ minWidth: 140 }}>
                  <TextField
                    label="Company tier"
                    value={tier}
                    onChange={setTier}
                    autoComplete="off"
                  />
                </div>
                <div style={{ minWidth: 120 }}>
                  <Select
                    label="Currency"
                    options={[
                      { label: "USD", value: "USD" },
                      { label: "EUR", value: "EUR" },
                      { label: "GBP", value: "GBP" },
                      { label: "TRY", value: "TRY" },
                    ]}
                    value={currency}
                    onChange={setCurrency}
                  />
                </div>
              </InlineStack>
              <Checkbox
                label="Save this decision to Quotes history"
                checked={persist}
                onChange={setPersist}
                helpText="Writes a row you can review under Quotes. No Shopify draft order or email — just an audit trail."
              />
              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={() => submitRun()}
                  loading={running}
                  disabled={!effectiveVariantId || !quantity}
                >
                  Run quote
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
          </div>
        </Layout.Section>

        {runFetcher.data?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Simulation failed">
              <p>{runFetcher.data.error}</p>
            </Banner>
          </Layout.Section>
        )}

        {runFetcher.data?.persistError && (
          <Layout.Section>
            <Banner tone="warning" title="Decision computed but not saved">
              <p>{runFetcher.data.persistError}</p>
            </Banner>
          </Layout.Section>
        )}

        {runFetcher.data?.persisted && (
          <Layout.Section>
            <Banner
              tone="success"
              title="Decision saved to Quotes history"
              action={{ content: "View in Quotes", url: "/app/pricefloor/history" }}
            />
          </Layout.Section>
        )}

        {runFetcher.data?.decision && (
          <Layout.Section>
            <DecisionCard decision={runFetcher.data.decision} />
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}

function DecisionCard({ decision }: { decision: QuoteDecision }) {
  const tone =
    decision.decision === "auto_approve"
      ? "success"
      : decision.decision === "counter_offer"
        ? "warning"
        : "critical";
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" wrap={false}>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={tone}>{labelForDecision(decision.decision)}</Badge>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              {labelForReason(decision.decisionReason)}
            </Text>
          </BlockStack>
          {decision.totalPrice != null && (
            <BlockStack gap="050" inlineAlign="end">
              <Text as="p" tone="subdued" variant="bodySm">
                Total
              </Text>
              <Text as="p" variant="headingSm">
                {decision.currency} {decision.totalPrice}
              </Text>
            </BlockStack>
          )}
        </InlineStack>
        {decision.lines.map((l, i) => (
          <Box
            key={i}
            padding="300"
            background="bg-surface-secondary"
            borderRadius="200"
          >
            <BlockStack gap="150">
              <Text as="p" variant="bodySm">
                Qty {l.quantity} · unit {l.unitPrice ?? "—"} · cost {l.unitCost ?? "—"} · margin{" "}
                {l.marginPct != null ? `${l.marginPct}%` : "—"}
              </Text>
              {l.appliedRules.length > 0 && (
                <InlineStack gap="100" wrap>
                  {l.appliedRules.map((r) => (
                    <Badge key={r} tone="info">
                      {r}
                    </Badge>
                  ))}
                </InlineStack>
              )}
              {l.lineReason && (
                <Text as="p" tone="subdued" variant="bodySm">
                  {labelForReason(l.lineReason)}
                </Text>
              )}
              {l.alternatives?.map((alt, ai) => (
                <Text key={ai} as="p" tone="subdued" variant="bodySm">
                  ↪ {alt.description} → {alt.unitPrice}
                </Text>
              ))}
            </BlockStack>
          </Box>
        ))}
        {decision.warnings.length > 0 && (
          <Banner tone="warning" title="Engine warnings">
            <ul>
              {decision.warnings.map((w) => (
                <li key={w}>{labelForReason(w)}</li>
              ))}
            </ul>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
