import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  BlockStack,
  Card,
  InlineStack,
  Select,
  Text,
  Box,
} from "@shopify/polaris";

import {
  authenticate,
  registerWebhooks,
} from "@/adapters/shopify/shopify.server";
import supabase from "@/adapters/supabase/supabase.server";
import { companyService } from "@/feature/bite/services/company.service";
import { subscriptionService } from "@/feature/bite/services/subscription.service";
import { shopifyBilling } from "@/feature/bite/adapters/shopify/billing.shopify";
import { setEnabledModules } from "@/feature/bite/modules/modules.server";
import { ALL_MODULE_IDS } from "@/feature/bite/modules";
import { OnboardingWizard } from "@/feature/bite/components/templates/OnboardingWizard";
import { PricingCard } from "@/feature/bite/components";
import { syncMerchantContact } from "@/feature/pricefloor/services/merchant-contact.service";
import { syncAll as syncPricefloorCosts } from "@/feature/pricefloor/services/cost-cache.service";
import { seedDefaultRuleSet } from "@/feature/pricefloor/services/rule-set.service";

const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Türkçe", value: "tr" },
  { label: "Español", value: "es" },
  { label: "Français", value: "fr" },
  { label: "Deutsch", value: "de" },
  { label: "Português", value: "pt" },
  { label: "Italiano", value: "it" },
  { label: "Nederlands", value: "nl" },
  { label: "日本語", value: "ja" },
  { label: "中文", value: "zh" },
  { label: "한국어", value: "ko" },
  { label: "Polski", value: "pl" },
  { label: "العربية", value: "ar" },
];

interface Plan {
  id: string;
  display_name: string;
  price_usd: number;
  sort_order: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const company = await companyService.findOrCreate(session.shop);
  const completed = await companyService.getMeta(
    company.id,
    "onboarding_completed",
  );

  if (completed === "true") {
    return redirect("/app");
  }

  const { data: plansData } = await supabase
    .from("subscription_plans")
    .select("id, display_name, price_usd, sort_order")
    .eq("is_active", true)
    .order("sort_order");

  const plans: Plan[] = (plansData ?? []).map((p: any) => ({
    id: p.id as string,
    display_name: p.display_name as string,
    price_usd: (p.price_usd as number) ?? 0,
    sort_order: p.sort_order as number,
  }));

  const shopHandle = session.shop.replace(/\.myshopify\.com$/i, "");
  return { plans, themeEditorUrl: `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?context=apps` };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const company = await companyService.findOrCreate(session.shop);
  const formData = await request.formData();

  const language = (formData.get("language") as string) || "en";
  const planId = ((formData.get("plan") as string) || "free").trim() || "free";

  await companyService.setMeta(company.id, "language", language);
  await setEnabledModules(company.id, ALL_MODULE_IDS);
  await companyService.setMeta(company.id, "onboarding_completed", "true");

  try {
    await registerWebhooks({ session });
  } catch (e) {
    console.error("[Onboarding] registerWebhooks failed:", e);
  }

  // Cache shop.email so background jobs (SLA cron) can reach the merchant.
  try {
    await syncMerchantContact(admin, company.id);
  } catch (e) {
    console.error("[Onboarding] syncMerchantContact failed:", e);
  }

  // Seed a starter rule set so the engine can evaluate quotes on day 1.
  // Skips if the merchant already saved one via the Rules UI.
  try {
    await seedDefaultRuleSet(company.id, session.shop);
  } catch (e) {
    console.error("[Onboarding] seedDefaultRuleSet failed:", e);
  }

  // Bulk-pull variant costs so the engine has data to work with. The count
  // of missing costs is written to company_meta so the dashboard can surface
  // a "sync your costs" warning.
  try {
    const result = await syncPricefloorCosts(admin, company.id, session.shop);
    await companyService.setMeta(
      company.id,
      "pf_last_cost_sync",
      JSON.stringify({ at: new Date().toISOString(), ...result }),
    );
  } catch (e) {
    console.error("[Onboarding] cost sync failed:", e);
  }

  if (planId === "free") {
    await companyService.setPlan(company.id, "free");
    return redirect("/app");
  }

  const { data: plan, error: planError } = await supabase
    .from("subscription_plans")
    .select("id, display_name, price_usd")
    .eq("id", planId)
    .eq("is_active", true)
    .single();

  if (planError || !plan) {
    console.error("[Onboarding] Plan not found:", { planId, planError });
    return Response.json({ error: "Plan not found" }, { status: 404 });
  }

  if (!plan.price_usd || plan.price_usd <= 0) {
    await companyService.setPlan(company.id, plan.id);
    return redirect("/app");
  }

  const trialDays = 7;

  const { subscription: shopifySub, confirmationUrl } =
    await shopifyBilling.createAppSubscription(admin, {
      name: plan.display_name,
      price: plan.price_usd,
      currencyCode: "USD",
      interval: "MONTHLY",
      trialDays,
      // Live Shopify billing must be the default. Enable test charges only
      // explicitly for local/staging environments.
      test: process.env.BILLING_TEST_MODE === "true",
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
};

export default function Onboarding() {
  const { plans, themeEditorUrl } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [language, setLanguage] = useState("en");
  const [planId, setPlanId] = useState<string>("free");

  useEffect(() => {
    const url = (fetcher.data as any)?.confirmationUrl;
    if (url) {
      window.top?.location.assign(url);
    }
  }, [fetcher.data]);

  const submit = useCallback(() => {
    const fd = new FormData();
    fd.append("language", language);
    fd.append("plan", planId);
    fetcher.submit(fd, { method: "post" });
  }, [language, planId, fetcher]);

  const steps = [
    {
      title: "Choose your language",
      description:
        "Pick the language you want to see in the app admin.",
      canProceed: !!language,
      renderContent: () => (
        <Card>
          <BlockStack gap="400">
            <Select
              label="Admin language"
              options={LANGUAGE_OPTIONS}
              value={language}
              onChange={setLanguage}
            />
          </BlockStack>
        </Card>
      ),
    },
    {
      title: "Add the storefront quote button",
      description:
        "Open your theme editor and enable the Pricefloor app embed or add the quote button block to a product section.",
      canProceed: true,
      renderContent: () => (
        <Card>
          <BlockStack gap="300">
            <Text as="p">
              In Shopify Admin, open the theme editor, select App embeds, enable Pricefloor, then save. You can also add the Pricefloor quote button block to a product section.
            </Text>
            <a href={themeEditorUrl} target="_blank" rel="noreferrer">
              Open theme editor
            </a>
          </BlockStack>
        </Card>
      ),
    },
    {
      title: "Choose a plan",
      description:
        "Start free or pick a paid plan. You can upgrade or cancel from Subscriptions any time.",
      canProceed: !!planId,
      renderContent: () => (
        <BlockStack gap="400">
          {plans.length === 0 ? (
            <Card>
              <Text as="p" tone="subdued">
                No plans configured yet.
              </Text>
            </Card>
          ) : (
            <InlineStack gap="300" wrap>
              {plans.map((plan) => (
                <Box key={plan.id} minWidth="240px">
                  <PricingCard
                    title={plan.display_name}
                    price={plan.price_usd === 0 ? "Free" : `$${plan.price_usd.toFixed(2)}`}
                    frequency="mo"
                    features={[]}
                    featuredText={planId === plan.id ? "Selected" : undefined}
                    button={{
                      content: planId === plan.id ? "Selected" : "Select",
                      props: { onClick: () => setPlanId(plan.id) },
                    }}
                  />
                </Box>
              ))}
            </InlineStack>
          )}
        </BlockStack>
      ),
    },
  ];

  return <OnboardingWizard steps={steps} onComplete={submit} />;
}
