import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Select,
  Button,
} from "@shopify/polaris";

import { authenticate } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const company = await companyService.findOrCreate(session.shop);
  const language =
    (await companyService.getMeta(company.id, "language")) || "en";
  return { shop: session.shop, language };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const company = await companyService.findOrCreate(session.shop);
  const formData = await request.formData();
  const language = formData.get("language") as string;
  if (language) {
    await companyService.setMeta(company.id, "language", language);
  }
  return Response.json({ status: "success" });
};

export default function Settings() {
  const { language } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const saving = fetcher.state !== "idle";

  const [currentLanguage, setCurrentLanguage] = useState(language);
  const languageDirty = currentLanguage !== language;

  const saveLanguage = useCallback(() => {
    const fd = new FormData();
    fd.append("language", currentLanguage);
    fetcher.submit(fd, { method: "post" });
  }, [currentLanguage, fetcher]);

  return (
    <Page title="Settings" subtitle="Configure your admin preferences">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                General
              </Text>
              <Select
                label="Admin language"
                options={LANGUAGE_OPTIONS}
                value={currentLanguage}
                onChange={setCurrentLanguage}
              />
              <InlineStack align="end">
                <Button
                  variant="primary"
                  disabled={!languageDirty}
                  loading={saving}
                  onClick={saveLanguage}
                >
                  Save
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
