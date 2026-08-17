import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "@/adapters/shopify/shopify.server";
import { invalidateVariants } from "@/feature/pricefloor/adapters/supabase/cost-cache.repository";
import { companyService } from "@/feature/bite/services/company.service";

/**
 * products/update — a product's variant list or pricing may have changed.
 * We only invalidate cost_cache rows for the shop; the next quote pulls fresh
 * data live (§5.2). No full sync here — that would burn rate-limit budget on
 * every product edit.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const company = await companyService.findByShop(shop);
  if (!company) return new Response();

  const variantIds = extractVariantGids(payload as ProductUpdatePayload);
  if (variantIds.length > 0) {
    await invalidateVariants(company.id, variantIds);
  }
  return new Response();
};

interface ProductUpdatePayload {
  variants?: Array<{ admin_graphql_api_id?: string; id?: number }>;
}

function extractVariantGids(payload: ProductUpdatePayload): string[] {
  if (!payload?.variants) return [];
  return payload.variants
    .map((v) =>
      v.admin_graphql_api_id ??
      (v.id ? `gid://shopify/ProductVariant/${v.id}` : null),
    )
    .filter((v): v is string => v !== null);
}
