import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect } from "react";
import { authenticate } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";
import { subscriptionService } from "@/feature/bite/services/subscription.service";
import { shopifyBilling } from "@/feature/bite/adapters/shopify/billing.shopify";
import supabase from "@/adapters/supabase/supabase.server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  Banner,
  ProgressBar,
  Divider,
  Box,
  Icon,
  Modal,
} from "@shopify/polaris";
import { useState } from "react";
import {
  StarFilledIcon,
  EmailIcon,
  QuestionCircleIcon,
  CashDollarIcon,
  CheckIcon,
  LockIcon,
} from "@shopify/polaris-icons";

// ── Types ────────────────────────────────────────────────────
interface PlanLimit { feature: string; monthly_cap: number }
interface Plan {
  id: string;
  display_name: string;
  price_usd: number;
  sort_order: number;
  limits: PlanLimit[];
}
interface UsageRow { feature: string; used_count: number }

const FEATURE_META: Record<string, { label: string; icon: typeof StarFilledIcon }> = {
  emails:        { label: "Emails / month",    icon: EmailIcon },
  reviews:       { label: "Reviews / month",   icon: StarFilledIcon },
  faq_questions: { label: "FAQ questions",     icon: QuestionCircleIcon },
  offers:        { label: "Upsell offers",     icon: CashDollarIcon },
};

const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  free:      ["100 emails", "50 reviews", "10 FAQ questions", "3 offers", "Review request emails (delayed)", "Basic analytics", "Community support"],
  starter:   ["1 000 emails", "500 reviews", "50 FAQ questions", "20 offers", "Review request emails (delayed)", "Advanced analytics", "Email support"],
  pro:       ["5 000 emails", "Unlimited reviews", "Unlimited FAQs", "Unlimited offers", "Review request emails + Send immediately", "Priority support", "CSV export"],
  unlimited: ["Unlimited everything", "Review request emails + Send immediately", "Dedicated support", "SLA guarantee", "Custom integrations", "Onboarding call"],
};

type CompRow =
  | { type: "dynamic"; key: string }
  | { type: "static"; label: string; values: Record<string, string | boolean> };

const COMPARISON: Array<{ title: string; rows: CompRow[] }> = [
  {
    title: "Usage limits",
    rows: [
      { type: "dynamic", key: "emails" },
      { type: "dynamic", key: "reviews" },
      { type: "dynamic", key: "faq_questions" },
      { type: "dynamic", key: "offers" },
    ],
  },
  {
    title: "Features",
    rows: [
      { type: "static", label: "Analytics dashboard",         values: { free: "Basic",    starter: "Advanced", pro: "Advanced", unlimited: "Advanced" } },
      { type: "static", label: "Review request emails",       values: { free: true,       starter: true,       pro: true,       unlimited: true       } },
      { type: "static", label: "Send immediately (0-day delay)", values: { free: false,   starter: false,      pro: true,       unlimited: true       } },
      { type: "static", label: "A/B testing",                 values: { free: false,      starter: false,      pro: true,       unlimited: true       } },
      { type: "static", label: "CSV / data export",           values: { free: false,      starter: false,      pro: true,       unlimited: true       } },
      { type: "static", label: "Custom integrations",         values: { free: false,      starter: false,      pro: false,      unlimited: true       } },
      { type: "static", label: "White-label branding",        values: { free: false,      starter: false,      pro: false,      unlimited: true       } },
      { type: "static", label: "API access",                  values: { free: false,      starter: false,      pro: true,       unlimited: true       } },
    ],
  },
  {
    title: "Support",
    rows: [
      { type: "static", label: "Support channel",   values: { free: "Community forum", starter: "Email", pro: "Priority email", unlimited: "Dedicated rep" } },
      { type: "static", label: "Response time",     values: { free: "Best effort",     starter: "2 business days", pro: "1 business day", unlimited: "4 hours" } },
      { type: "static", label: "SLA guarantee",     values: { free: false, starter: false, pro: false, unlimited: true } },
      { type: "static", label: "Onboarding call",   values: { free: false, starter: false, pro: false, unlimited: true } },
    ],
  },
  {
    title: "All plans include",
    rows: [
      { type: "static", label: "7-day free trial",        values: { free: true, starter: true, pro: true, unlimited: true } },
      { type: "static", label: "No credit card required", values: { free: true, starter: true, pro: true, unlimited: true } },
      { type: "static", label: "Cancel anytime",          values: { free: true, starter: true, pro: true, unlimited: true } },
    ],
  },
];

// ── Loader ───────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const company = await companyService.findOrCreate(session.shop);
  const month = new Date().toISOString().slice(0, 7);

  // Shopify ödeme onayından döndükten sonra charge_id ile subscription senkronize et
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");
  if (chargeId) {
    try {
      const gid = `gid://shopify/AppSubscription/${chargeId}`;
      const res = await admin.graphql(
        `#graphql
          query getSubscription($id: ID!) {
            node(id: $id) {
              ... on AppSubscription {
                id name status currentPeriodEnd
              }
            }
          }`,
        { variables: { id: gid } }
      );
      const data = await res.json();
      const sub = data?.data?.node;
      if (sub && sub.status === "ACTIVE") {
        await subscriptionService.syncSubscriptionFromShopify(session.shop, gid, {
          admin_graphql_api_id: gid,
          name: sub.name,
          status: sub.status,
          current_period_end: sub.currentPeriodEnd,
        });
        // Status unchanged olsa bile plan_id'yi garantiye al
        const activeSub = await subscriptionService.getActiveSubscription(company.id).catch(() => null);
        if (activeSub?.plan_id) {
          await companyService.setPlan(company.id, activeSub.plan_id);
          console.log(`[Subscriptions] force-synced plan → ${activeSub.plan_id}`);
        }
      }
    } catch (e) {
      console.error("[Subscriptions] charge_id sync failed:", e);
    }
  }

  // Reconcile local TRIAL/ACTIVE state with Shopify — catches declined approvals
  // (no charge_id returned) and delayed app_subscriptions/update webhooks.
  await subscriptionService.reconcileWithShopify(admin, company.id).catch((e) => {
    console.warn("[Subscriptions] reconcile failed:", e);
  });

  const [activeSubscription, plansResult, usageResult] = await Promise.all([
    subscriptionService.getActiveSubscription(company.id).catch(() => null),

    supabase
      .from("subscription_plans")
      .select("id, display_name, price_usd, sort_order, plan_limits(feature, monthly_cap)")
      .eq("is_active", true)
      .order("sort_order"),

    supabase
      .from("company_usage")
      .select("feature, used_count")
      .eq("company_id", company.id)
      .eq("month", month),
  ]);

  const plans: Plan[] = (plansResult.data ?? []).map((p: any) => ({
    id: p.id,
    display_name: p.display_name,
    price_usd: p.price_usd,
    sort_order: p.sort_order,
    limits: p.plan_limits ?? [],
  }));

  const usage: UsageRow[] = usageResult.data ?? [];

  return {
    company,
    currentPlanId: company.plan_id ?? "free",
    activeSubscription,
    plans,
    usage,
    month,
  };
};

// ── Action ───────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const company = await companyService.findOrCreate(session.shop);
  const formData = await request.formData();

  if (formData.get("intent") === "subscribe") {
    const planId = String(formData.get("plan") ?? "").trim();
    if (!planId) {
      return Response.json({ error: "Plan required" }, { status: 400 });
    }

    const { data: plan, error: planError } = await supabase
      .from("subscription_plans")
      .select("id, display_name, price_usd")
      .eq("id", planId)
      .eq("is_active", true)
      .single();

    if (planError || !plan) {
      console.error("[Subscriptions] Plan not found:", { planId, planError });
      return Response.json({ error: "Plan not found" }, { status: 404 });
    }

    if (!plan.price_usd || plan.price_usd <= 0) {
      await companyService.setPlan(company.id, plan.id);
      return Response.json({
        confirmationUrl: `${process.env.SHOPIFY_APP_URL}/app/subscriptions?subscription=success`,
      });
    }

    // Reconcile before creating a new charge — clears any locally-TRIAL row
    // that Shopify has already declined/expired so a fresh subscribe can proceed.
    await subscriptionService.reconcileWithShopify(admin, company.id).catch((e) => {
      console.warn("[Subscriptions] pre-subscribe reconcile failed:", e);
    });

    const trialDays = 7;

    const { subscription: shopifySub, confirmationUrl } =
      await shopifyBilling.createAppSubscription(admin, {
        name: plan.display_name,
        price: plan.price_usd,
        currencyCode: "USD",
        interval: "MONTHLY",
        trialDays,
        test: process.env.NODE_ENV !== "production",
        shop: session.shop,
      });

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + 30);
    await subscriptionService.createSubscription({
      company_id: company.id,
      plan_id: plan.id,
      status: trialDays > 0 ? "TRIAL" : "ACTIVE",
      shopify_charge_id: shopifySub.id,
      shopify_confirmation_url: confirmationUrl,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    });

    return Response.json({ confirmationUrl });
  }

  if (formData.get("intent") === "cancel") {
    try {
      const company = await companyService.findByShop(session.shop);
      if (!company) return Response.json({ error: "Company not found" }, { status: 404 });

      const sub = await subscriptionService.getActiveSubscription(company.id);
      if (!sub) return Response.json({ error: "No active subscription" }, { status: 404 });

      if (sub.shopify_charge_id) {
        await admin.graphql(
          `#graphql
          mutation appSubscriptionCancel($id: ID!, $prorate: Boolean) {
            appSubscriptionCancel(id: $id, prorate: $prorate) {
              userErrors { field message }
              appSubscription { id status }
            }
          }`,
          { variables: { id: sub.shopify_charge_id, prorate: false } },
        );
      }
      await subscriptionService.updateSubscriptionStatus(sub.id, "CANCELLED");
      await companyService.setPlan(company.id, "free");

      return Response.json({ success: true });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  return Response.json({ error: "Invalid action" }, { status: 400 });
};

// ── Helpers ──────────────────────────────────────────────────
function formatCap(cap: number) {
  return cap === -1 ? "Unlimited" : cap.toLocaleString();
}

function usagePct(used: number, cap: number) {
  if (cap === -1 || cap === 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

function usageTone(pct: number): "success" | "highlight" | "critical" {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "highlight";
  return "success";
}

// ── Page ─────────────────────────────────────────────────────
export default function Subscriptions() {
  const { currentPlanId, activeSubscription, plans, usage, month } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const billingFetcher = useFetcher<{ confirmationUrl?: string; error?: string }>();

  useEffect(() => {
    if (billingFetcher.data?.confirmationUrl) {
      open(billingFetcher.data.confirmationUrl, "_top");
    }
  }, [billingFetcher.data]);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [downgradeTarget, setDowngradeTarget] = useState<{ planId: string; planName: string; warnings: string[] } | null>(null);
  const isCancelling = fetcher.state !== "idle";
  const usageMap = Object.fromEntries(usage.map((u) => [u.feature, u.used_count]));

  const currentPlan = plans.find((p) => p.id === currentPlanId);
  const periodEnd = activeSubscription?.current_period_end
    ? new Date(activeSubscription.current_period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  // Check if current usage exceeds the limits of a target plan
  function getDowngradeWarnings(targetPlan: Plan): string[] {
    return targetPlan.limits
      .filter((l) => {
        if (l.monthly_cap === -1 || l.monthly_cap === 0) return false;
        const used = usageMap[l.feature] ?? 0;
        return used > l.monthly_cap;
      })
      .map((l) => {
        const meta = FEATURE_META[l.feature];
        const used = usageMap[l.feature] ?? 0;
        return `${meta?.label ?? l.feature}: ${used.toLocaleString()} used, limit is ${l.monthly_cap.toLocaleString()}`;
      });
  }

  function handleDowngradeClick(targetPlanId: string, targetPlanName: string, onConfirm: () => void) {
    const targetPlan = plans.find((p) => p.id === targetPlanId);
    const warnings = targetPlan ? getDowngradeWarnings(targetPlan) : [];
    if (warnings.length > 0) {
      setDowngradeTarget({ planId: targetPlanId, planName: targetPlanName, warnings });
    } else {
      onConfirm();
    }
  }

  const handleCancel = () => {
    setShowCancelModal(false);
    fetcher.submit({ intent: "cancel" }, { method: "POST" });
  };

  return (
    <Page
      title="Subscription & Billing"
      subtitle="Manage your plan and track feature usage"
    >
      <BlockStack gap="600">

        {/* ── Success / Error banners ── */}
        {fetcher.data?.success && (
          <Banner title="Subscription cancelled" tone="info">
            <Text as="p" variant="bodyMd">You've been moved to the Free plan.</Text>
          </Banner>
        )}
        {fetcher.data?.error && (
          <Banner title="Something went wrong" tone="critical">
            <Text as="p" variant="bodyMd">{fetcher.data.error}</Text>
          </Banner>
        )}

        {/* ── Current plan + usage ── */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Current plan</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{month}</Text>
                  </BlockStack>
                  <Badge tone={currentPlanId === "free" ? "new" : "success"}>
                    {currentPlan?.display_name ?? "Free"}
                  </Badge>
                </InlineStack>

                {currentPlanId !== "free" && (
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        ${currentPlan?.price_usd?.toFixed(2)} / month
                      </Text>
                      {activeSubscription?.status === "TRIAL" && (
                        <Badge tone="attention">Trial</Badge>
                      )}
                    </InlineStack>
                    {periodEnd && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {activeSubscription?.status === "TRIAL" ? "Trial ends" : "Renews"} {periodEnd}
                      </Text>
                    )}
                  </BlockStack>
                )}

                <Divider />

                {currentPlanId === "free" ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Upgrade to unlock higher limits and priority support.
                  </Text>
                ) : (
                  <Button
                    tone="critical"
                    variant="plain"
                    loading={isCancelling}
                    onClick={() => setShowCancelModal(true)}
                  >
                    Cancel subscription
                  </Button>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Monthly usage</Text>
                <BlockStack gap="500">
                  {(currentPlan?.limits ?? [])
                    .filter((l) => l.monthly_cap !== 0)
                    .map((limit) => {
                      const meta  = FEATURE_META[limit.feature];
                      const used  = usageMap[limit.feature] ?? 0;
                      const cap   = limit.monthly_cap;
                      const pct   = usagePct(used, cap);
                      const tone  = usageTone(pct);
                      if (!meta) return null;
                      return (
                        <BlockStack gap="150" key={limit.feature}>
                          <InlineStack align="space-between">
                            <InlineStack gap="200" blockAlign="center">
                              <Icon source={meta.icon} tone="base" />
                              <Text as="span" variant="bodyMd">{meta.label}</Text>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {used.toLocaleString()} / {formatCap(cap)}
                              {cap !== -1 && ` (${pct}%)`}
                            </Text>
                          </InlineStack>
                          {cap !== -1 && (
                            <ProgressBar progress={pct} tone={tone} size="small" />
                          )}
                        </BlockStack>
                      );
                    })}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* ── Plan cards ── */}
        <BlockStack gap="300">
          <Text as="h2" variant="headingLg">Choose your plan</Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            All plans include a 7-day free trial. No credit card required to start.
          </Text>
        </BlockStack>

        {/* Paid plans — 3-column grid */}
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          {plans.filter((p) => p.id !== "free").map((plan) => {
            const isCurrent  = plan.id === currentPlanId;
            const isPopular  = plan.id === "pro";
            const highlights = PLAN_HIGHLIGHTS[plan.id] ?? [];

            return (
              <div key={plan.id} style={{ paddingTop: "14px" }}>
                <div
                  style={{
                    position: "relative",
                    height: "100%",
                    border: isCurrent
                      ? "2px solid var(--p-color-border-brand)"
                      : isPopular
                      ? "2px solid var(--p-color-border-info)"
                      : "1px solid var(--p-color-border)",
                    borderRadius: "var(--p-border-radius-300)",
                    padding: "var(--p-space-500)",
                    background: isCurrent
                      ? "var(--p-color-bg-surface-brand-selected)"
                      : "var(--p-color-bg-surface)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--p-space-400)",
                  }}
                >
                  {/* Badge centered at top, half overlapping the border */}
                  {(isCurrent || (isPopular && !isCurrent)) && (
                    <div style={{
                      position: "absolute",
                      top: "-12px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      zIndex: 1,
                      whiteSpace: "nowrap",
                    }}>
                      {isCurrent
                        ? <Badge tone="success">Current plan</Badge>
                        : <Badge tone="info">Most popular</Badge>
                      }
                    </div>
                  )}

                  {/* Name left, price right */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <Text as="h3" variant="headingLg">{plan.display_name}</Text>
                    <InlineStack gap="100" blockAlign="baseline">
                      <Text as="p" variant="heading2xl" fontWeight="bold">
                        ${plan.price_usd.toFixed(0)}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">/ mo</Text>
                    </InlineStack>
                  </div>

                  <Divider />

                  {/* Features left-aligned */}
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: "10px 8px" }}>
                    {highlights.flatMap((f, i) => [
                      <div key={`icon-${i}`} style={{ display: "flex" }}><Icon source={CheckIcon} tone="success" /></div>,
                      <span key={`text-${i}`} style={{ fontSize: "14px" }}>{f}</span>,
                    ])}
                  </div>

                  <div style={{ marginTop: "auto" }}>
                    {isCurrent ? (
                      <Button disabled fullWidth>Current plan</Button>
                    ) : (
                      <Button
                        variant="primary"
                        fullWidth
                        loading={billingFetcher.state !== "idle" && billingFetcher.formData?.get("plan") === plan.id}
                        onClick={() => {
                          const isDowngrade = (currentPlan?.sort_order ?? 0) > plan.sort_order;
                          const submit = () => billingFetcher.submit({ intent: "subscribe", plan: plan.id }, { method: "POST" });
                          if (isDowngrade) {
                            handleDowngradeClick(plan.id, plan.display_name, submit);
                          } else {
                            submit();
                          }
                        }}
                      >
                        {(currentPlan?.sort_order ?? 0) < plan.sort_order
                          ? `Upgrade to ${plan.display_name}`
                          : `Switch to ${plan.display_name}`}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </InlineGrid>

        {/* Free plan — full-width horizontal card */}
        {(() => {
          const free       = plans.find((p) => p.id === "free");
          const isCurrent  = currentPlanId === "free";
          const highlights = PLAN_HIGHLIGHTS["free"] ?? [];
          if (!free) return null;
          return (
            <div
              style={{
                border: isCurrent
                  ? "2px solid var(--p-color-border-brand)"
                  : "1px solid var(--p-color-border)",
                borderRadius: "var(--p-border-radius-300)",
                padding: "var(--p-space-500)",
                background: "var(--p-color-bg-surface)",
                display: "flex",
                gap: "var(--p-space-600)",
                alignItems: "center",
              }}
            >
              {/* Left: name + badge */}
              <div style={{ minWidth: "140px" }}>
                <BlockStack gap="150">
                  {isCurrent && <Badge tone="success">Current plan</Badge>}
                  <Text as="h3" variant="headingLg">Free</Text>
                  <Text as="p" variant="heading2xl" fontWeight="bold">$0</Text>
                </BlockStack>
              </div>

              <div style={{ width: "1px", alignSelf: "stretch", background: "var(--p-color-border)" }} />

              {/* Middle: 2-column features */}
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
                {highlights.map((f, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: "8px" }}>
                    <div style={{ display: "flex" }}><Icon source={CheckIcon} tone="success" /></div>
                    <span style={{ fontSize: "14px" }}>{f}</span>
                  </div>
                ))}
              </div>

              {/* Right: CTA */}
              <div style={{ minWidth: "160px" }}>
                {isCurrent ? (
                  <Button disabled fullWidth>Current plan</Button>
                ) : (
                  <Button fullWidth loading={isCancelling} onClick={() => handleDowngradeClick("free", "Free", () => setShowCancelModal(true))}>
                    Downgrade to Free
                  </Button>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Feature comparison table ── */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">Feature comparison</Text>
              <Text as="p" variant="bodySm" tone="subdued">A detailed breakdown of what's included in each plan.</Text>
            </BlockStack>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "2px solid var(--p-color-border)", color: "var(--p-color-text-subdued)", width: "200px" }}>
                      Feature
                    </th>
                    {plans.map((p) => (
                      <th
                        key={p.id}
                        style={{
                          textAlign: "center",
                          padding: "10px 12px",
                          borderBottom: "2px solid var(--p-color-border)",
                          color: p.id === currentPlanId ? "var(--p-color-text-brand)" : "var(--p-color-text)",
                          fontWeight: p.id === currentPlanId ? 700 : 500,
                          minWidth: "110px",
                        }}
                      >
                        {p.display_name}
                        {p.id === currentPlanId && (
                          <span style={{ display: "block", fontSize: "11px", fontWeight: 400, color: "var(--p-color-text-subdued)" }}>
                            current
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.flatMap((category, catIdx) => [
                    <tr key={`cat-${catIdx}`}>
                      <td
                        colSpan={plans.length + 1}
                        style={{
                          padding: "10px 12px 8px",
                          fontWeight: 600,
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: "var(--p-color-text-subdued)",
                          background: "var(--p-color-bg-surface-secondary)",
                          borderTop: catIdx > 0 ? "1px solid var(--p-color-border)" : undefined,
                        }}
                      >
                        {category.title}
                      </td>
                    </tr>,
                    ...category.rows.map((row, rowIdx) => {
                      const bg = rowIdx % 2 !== 0 ? "var(--p-color-bg-surface-secondary)" : "transparent";
                      if (row.type === "dynamic") {
                        const meta = FEATURE_META[row.key];
                        if (!meta) return null as unknown as JSX.Element;
                        return (
                          <tr key={`${catIdx}-${row.key}`} style={{ background: bg }}>
                            <td style={{ padding: "10px 12px", color: "var(--p-color-text)" }}>{meta.label}</td>
                            {plans.map((p) => {
                              const limit = p.limits.find((l) => l.feature === row.key);
                              const cap = limit?.monthly_cap;
                              return (
                                <td key={p.id} style={{ textAlign: "center", padding: "10px 12px" }}>
                                  {cap === undefined || cap === 0 ? (
                                    <span style={{ color: "var(--p-color-text-disabled)" }}>—</span>
                                  ) : cap === -1 ? (
                                    <Badge tone="success">Unlimited</Badge>
                                  ) : (
                                    <Text as="span" variant="bodySm">{cap.toLocaleString()}</Text>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      }
                      return (
                        <tr key={`${catIdx}-${row.label}`} style={{ background: bg }}>
                          <td style={{ padding: "10px 12px", color: "var(--p-color-text)" }}>{row.label}</td>
                          {plans.map((p) => {
                            const val = row.values[p.id];
                            return (
                              <td key={p.id} style={{ textAlign: "center", padding: "10px 12px" }}>
                                {typeof val === "boolean" ? (
                                  val ? (
                                    <span style={{ display: "inline-flex", justifyContent: "center" }}>
                                      <Icon source={CheckIcon} tone="success" />
                                    </span>
                                  ) : (
                                    <span style={{ color: "var(--p-color-text-disabled)" }}>—</span>
                                  )
                                ) : (
                                  <Text as="span" variant="bodySm">{String(val ?? "—")}</Text>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }),
                  ])}
                </tbody>
              </table>
            </div>
          </BlockStack>
        </Card>

        {/* ── Help ── */}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">Need a custom plan?</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Contact us for volume pricing or enterprise requirements.
              </Text>
            </BlockStack>
            <Button url="mailto:hello@vayes.app">Contact sales</Button>
          </InlineStack>
        </Card>

      </BlockStack>

      <Modal
        open={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Cancel subscription?"
        primaryAction={{ content: "Yes, cancel", destructive: true, loading: isCancelling, onAction: handleCancel }}
        secondaryActions={[{ content: "Keep plan", onAction: () => setShowCancelModal(false) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Your subscription will be cancelled immediately and you'll be moved to the Free plan. This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      <Modal
        open={!!downgradeTarget}
        onClose={() => setDowngradeTarget(null)}
        title="Usage exceeds plan limits"
        primaryAction={{
          content: "Downgrade anyway",
          destructive: true,
          onAction: () => {
            const target = downgradeTarget!;
            setDowngradeTarget(null);
            if (target.planId === "free") {
              setShowCancelModal(true);
            } else {
              billingFetcher.submit({ intent: "subscribe", plan: target.planId }, { method: "POST" });
            }
          },
        }}
        secondaryActions={[{ content: "Keep current plan", onAction: () => setDowngradeTarget(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Your current usage exceeds the limits of the <strong>{downgradeTarget?.planName}</strong> plan. Downgrading may restrict access to features until next month.
            </Text>
            <BlockStack gap="100">
              {downgradeTarget?.warnings.map((w, i) => (
                <Text key={i} as="p" variant="bodySm" tone="critical">• {w}</Text>
              ))}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
