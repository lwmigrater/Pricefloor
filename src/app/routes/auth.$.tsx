
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate, registerWebhooks } from "@/adapters/shopify/shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { companyService } from "@/feature/bite/services/company.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log('[Auth] Request URL:', url.href);
  console.log('[Auth] Shop parameter:', url.searchParams.get('shop'));

  const { session } = await authenticate.admin(request);

  // Ensure company exists for this shop
  try {
    const company = await companyService.findOrCreate(session.shop);
    console.log('[Auth] Company ensured for shop:', session.shop, 'Company ID:', company.id);
  } catch (error) {
    console.error('[Auth] Error ensuring company exists:', error);
  }

  // Register / sync webhooks with Shopify
  try {
    const response = await registerWebhooks({ session });
    console.log('[Auth] Webhooks registered:', response);
  } catch (error) {
    console.error('[Auth] Error registering webhooks:', error);
  }

  // After successful authentication, redirect to app
  return redirect('/app');
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

