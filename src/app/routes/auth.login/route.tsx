import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import type { LoaderFunctionArgs } from "react-router";

import { login } from "@/adapters/shopify/shopify.server";
import { Page, Section } from "@/feature/bite/components";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Let Shopify's login handler run — if a `shop` param is present it will
  // redirect into OAuth. If not, we fall through to the informational view
  // below (we never prompt merchants to enter their shop domain manually).
  await login(request);
  return null;
};

export default function Auth() {
  return (
    <PolarisAppProvider i18n={{}}>
      <AppProvider embedded={false}>
        <Page>
          <Section heading="Install TEMPLATE_APP_NAME from the Shopify App Store">
            <p>
              To use TEMPLATE_APP_NAME you need to install it on your Shopify store from
              the{" "}
              <a
                href="https://apps.shopify.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Shopify App Store
              </a>
              .
            </p>
          </Section>
        </Page>
      </AppProvider>
    </PolarisAppProvider>
  );
}
