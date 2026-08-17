/**
 * Pricefloor dashboard — merchant home.
 *
 * Metrics window: last 30 days. Highlights the north-star (§0) — the share
 * of quote requests the engine closed without human touch — plus supporting
 * counters (avg margin on approved, open escalations, missing costs).
 *
 * "Missing costs" is a call-to-action banner: without a unit cost the engine
 * escalates by design, so this number directly caps automation rate.
 */

import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Banner,
  Button,
  Link,
} from "@shopify/polaris";
import {
  DonutChart,
  LineChart,
  PolarisVizProvider,
} from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";

import { authenticate } from "@/adapters/shopify/shopify.server";
import supabase from "@/adapters/supabase/supabase.server";
import { companyService } from "@/feature/bite/services/company.service";
import { getActiveRuleSet } from "@/feature/pricefloor/adapters/supabase/rule-set.repository";
import styles from "../styles/pricefloor-pages.module.css";

const WINDOW_DAYS = 30;

interface TrendPoint {
  key: string; // ISO date (YYYY-MM-DD)
  value: number;
}

interface DashboardStats {
  totalDecisions: number;
  autoApproved: number;
  counterOffers: number;
  escalations: number;
  automationRate: number | null; // %, our north star
  avgMarginPct: number | null;
  openEscalations: number;
  cachedVariants: number;
  missingCosts: number;
  trend: {
    autoApproved: TrendPoint[];
    counterOffers: TrendPoint[];
    escalations: TrendPoint[];
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);

  if (!company) {
    return {
      shop: session.shop,
      hasActiveRuleSet: false,
      stats: emptyStats(),
    };
  }

  const active = await getActiveRuleSet(company.id);
  const hasActiveRuleSet = active != null;

  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);
  const sinceIso = since.toISOString();

  // Window decisions — one query, then aggregate + bucket by day in JS.
  const { data: winDecisions } = await supabase
    .from("pf_quote_decisions")
    .select("decision, output, decided_at, pf_quote_requests!inner(company_id)")
    .eq("pf_quote_requests.company_id", company.id)
    .gte("decided_at", sinceIso)
    .limit(5000);
  const rows = (winDecisions ?? []) as Array<{
    decision: string;
    output: { lines?: Array<{ marginPct: number | null }> };
    decided_at: string;
  }>;

  const total = rows.length;
  const auto = rows.filter((r) => r.decision === "auto_approve").length;
  const counter = rows.filter((r) => r.decision === "counter_offer").length;
  const escal = rows.filter((r) => r.decision === "escalate").length;

  const marginSamples: number[] = [];
  for (const r of rows) {
    if (r.decision === "escalate") continue;
    for (const l of r.output.lines ?? []) {
      if (l.marginPct != null) marginSamples.push(l.marginPct);
    }
  }
  const avgMarginPct =
    marginSamples.length > 0
      ? Math.round((marginSamples.reduce((a, b) => a + b, 0) / marginSamples.length) * 100) / 100
      : null;

  // Daily buckets — oldest → newest so the chart reads left→right.
  const dayKeys: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const buckets = new Map<string, { auto: number; counter: number; escalate: number }>(
    dayKeys.map((k) => [k, { auto: 0, counter: 0, escalate: 0 }]),
  );
  for (const r of rows) {
    const key = r.decided_at?.slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    if (r.decision === "auto_approve") b.auto++;
    else if (r.decision === "counter_offer") b.counter++;
    else if (r.decision === "escalate") b.escalate++;
  }
  const trend = {
    autoApproved: dayKeys.map((k) => ({ key: k, value: buckets.get(k)!.auto })),
    counterOffers: dayKeys.map((k) => ({ key: k, value: buckets.get(k)!.counter })),
    escalations: dayKeys.map((k) => ({ key: k, value: buckets.get(k)!.escalate })),
  };

  const [openEscRes, cacheRes, missingRes] = await Promise.all([
    supabase
      .from("pf_escalations")
      .select("id, pf_quote_requests!inner(company_id)", { count: "exact", head: true })
      .eq("pf_quote_requests.company_id", company.id)
      .neq("status", "resolved"),
    supabase
      .from("pf_cost_cache")
      .select("variant_id", { count: "exact", head: true })
      .eq("company_id", company.id),
    supabase
      .from("pf_cost_cache")
      .select("variant_id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .is("unit_cost", null),
  ]);

  const stats: DashboardStats = {
    totalDecisions: total,
    autoApproved: auto,
    counterOffers: counter,
    escalations: escal,
    automationRate:
      total > 0 ? Math.round((auto / total) * 1000) / 10 : null, // one decimal
    avgMarginPct,
    openEscalations: openEscRes.count ?? 0,
    cachedVariants: cacheRes.count ?? 0,
    missingCosts: missingRes.count ?? 0,
    trend,
  };

  return { shop: session.shop, hasActiveRuleSet, stats };
};

function emptyStats(): DashboardStats {
  const dayKeys: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const empty = dayKeys.map((k) => ({ key: k, value: 0 }));
  return {
    totalDecisions: 0,
    autoApproved: 0,
    counterOffers: 0,
    escalations: 0,
    automationRate: null,
    avgMarginPct: null,
    openEscalations: 0,
    cachedVariants: 0,
    missingCosts: 0,
    trend: {
      autoApproved: empty,
      counterOffers: empty,
      escalations: empty,
    },
  };
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className={styles.metric}>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
        {hint && (
          <Text as="p" variant="bodySm" tone="subdued">
            {hint}
          </Text>
        )}
      </BlockStack>
    </div>
  );
}

// polaris-viz reads `window` at render time (isTouchDevice), which crashes
// React Router's SSR. Gate chart rendering to after client mount so the
// server emits a placeholder and the chart hydrates in on the client.
function useIsClient() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready;
}

function ChartPlaceholder() {
  return (
    <Box
      minHeight="260px"
      background="bg-surface-secondary"
      borderRadius="200"
    />
  );
}

export default function Dashboard() {
  const { shop, hasActiveRuleSet, stats } = useLoaderData<typeof loader>();
  const isClient = useIsClient();

  return (
    <PolarisVizProvider>
      <Page title="Pricefloor" subtitle={`Connected to ${shop}`}>
        <Layout>
          {!hasActiveRuleSet && (
            <Layout.Section>
              <Banner
                tone="warning"
                title="No active rule set"
                action={{ content: "Set up rules", url: "/app/pricefloor/rules" }}
              >
                <p>
                  The engine can't decide quotes until you save a rule set.
                  Onboarding usually seeds a default; if you've deleted it, add
                  one now.
                </p>
              </Banner>
            </Layout.Section>
          )}
          {stats.missingCosts > 0 && (
            <Layout.Section>
              <Banner tone="warning" title={`${stats.missingCosts} variants have no unit cost`}>
                <p>
                  Every variant without a cost auto-escalates — you're capping
                  automation at{" "}
                  <strong>
                    {stats.cachedVariants > 0
                      ? `${Math.round(((stats.cachedVariants - stats.missingCosts) / stats.cachedVariants) * 100)}%`
                      : "—"}
                  </strong>
                  . Fill costs in Shopify {"→"} Inventory {"→"} Cost per item.
                </p>
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <div className={styles.dashboardHero}>
              <div className={styles.heroCopy}>
                <InlineStack gap="200" blockAlign="center"><Text as="h2" variant="headingMd">Merchant review coverage</Text><Badge tone="success">Manual mode</Badge></InlineStack>
                <span className={styles.heroValue}>100%</span>
                <Text as="p" tone="subdued">Manual approval mode is active. Every quote is held for merchant review before an offer is sent.</Text>
              </div>
              <div className={styles.heroProgress} aria-label="100% held for merchant review"><span style={{ width: "100%" }} /></div>
            </div>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">
                    Decisions per day
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Last {WINDOW_DAYS} days — auto approvals, counter offers, escalations.
                  </Text>
                </BlockStack>
                <div style={{ height: 260 }}>
                  {isClient ? (
                    <LineChart
                      isAnimated
                      data={[
                        { name: "Approved", data: stats.trend.autoApproved },
                        { name: "Counter offer", data: stats.trend.counterOffers },
                        { name: "Escalated", data: stats.trend.escalations },
                      ]}
                    />
                  ) : (
                    <ChartPlaceholder />
                  )}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">
                    Decision mix
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Where the last {WINDOW_DAYS} days of quotes landed.
                  </Text>
                </BlockStack>
                <div style={{ height: 260 }}>
                  {stats.totalDecisions === 0 ? (
                    <EmptyChart message="No decisions yet in this window." />
                  ) : isClient ? (
                    <DonutChart
                      legendPosition="right"
                      data={[
                        {
                          name: "Decisions",
                          data: [
                            { key: "Approved", value: stats.autoApproved },
                            { key: "Counter offer", value: stats.counterOffers },
                            { key: "Escalated", value: stats.escalations },
                          ].filter((slice) => slice.value > 0),
                        },
                      ]}
                    />
                  ) : (
                    <ChartPlaceholder />
                  )}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">
                    Overview
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Last {WINDOW_DAYS} days.
                  </Text>
                </BlockStack>
                <div className={styles.overviewGrid}>
                  <StatCard
                    label="Approved"
                    value={String(stats.autoApproved)}
                    hint="Went to invoice without review"
                  />
                  <StatCard
                    label="Counter offers"
                    value={String(stats.counterOffers)}
                    hint="Engine held the floor"
                  />
                  <StatCard
                    label="Escalations"
                    value={String(stats.escalations)}
                    hint="Sent to queue"
                  />
                  <StatCard
                    label="Avg margin on approved"
                    value={stats.avgMarginPct != null ? `${stats.avgMarginPct}%` : "—"}
                  />
                  <StatCard
                    label="Open escalations"
                    value={String(stats.openEscalations)}
                    hint="Now"
                  />
                  <StatCard
                    label="Variants cached"
                    value={String(stats.cachedVariants)}
                  />
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Quick links
                </Text>
                <InlineStack gap="200" wrap>
                  <Button variant="primary" url="/app/pricefloor/rules">
                    Rules
                  </Button>
                  <Button url="/app/pricefloor/simulator">Simulator</Button>
                  <Button url="/app/pricefloor/escalations">Escalations</Button>
                  <Button url="/app/pricefloor/history">Quotes history</Button>
                </InlineStack>
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <Text as="p" tone="subdued" variant="bodySm">
                    Buyers send requests to{" "}
                    <Link url={`https://${shop}/apps/pricefloor/quote`} target="_blank">
                      {`https://${shop}/apps/pricefloor/quote`}
                    </Link>
                    .
                  </Text>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </PolarisVizProvider>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <Box
      minHeight="260px"
      padding="400"
      background="bg-surface-secondary"
      borderRadius="200"
    >
      <BlockStack gap="100" align="center" inlineAlign="center">
        <Text as="p" tone="subdued" variant="bodySm">
          {message}
        </Text>
      </BlockStack>
    </Box>
  );
}
