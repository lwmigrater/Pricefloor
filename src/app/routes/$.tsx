import { Link, useLoaderData } from "react-router";
import { authenticate } from "@/adapters/shopify/shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function NotFound() {
  return (
    <s-page heading="Page Not Found">
      <s-section>
        <s-grid justifyItems="center" maxInlineSize="500px" gap="base">
          <s-stack alignItems="center">
            <s-heading>404</s-heading>
            <s-paragraph>
              The page you are looking for does not exist.
            </s-paragraph>
          </s-stack>
          <s-link href="/app">
            <s-button>Go Home</s-button>
          </s-link>
        </s-grid>
      </s-section>
    </s-page>
  );
}
