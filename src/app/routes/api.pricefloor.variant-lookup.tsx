/**
 * Admin-only lookup for a Shopify product variant.
 *
 *   POST /api/pricefloor/variant-lookup
 *   body: { variantId: "gid://shopify/ProductVariant/..." }
 *
 * Used by the Simulator's product picker to auto-fill base price + unit cost.
 * Combines a live Shopify pull with the current cost-cache row so the UI can
 * warn if the cache is stale or missing.
 *
 * NOT a loader — GET returns 405.
 */

import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";
import { getCostsForVariants } from "@/feature/pricefloor/adapters/supabase/cost-cache.repository";

const VARIANT_LOOKUP_QUERY = /* GraphQL */ `
  query PricefloorSimulatorVariant($id: ID!) {
    productVariant(id: $id) {
      id
      sku
      title
      price
      inventoryQuantity
      product { id title }
      inventoryItem {
        unitCost { amount currencyCode }
      }
    }
  }
`;

interface VariantNode {
  id: string;
  sku: string | null;
  title: string | null;
  price: string;
  inventoryQuantity: number | null;
  product: { id: string; title: string } | null;
  inventoryItem: {
    unitCost: { amount: string; currencyCode: string } | null;
  } | null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const { session, admin } = await authenticate.admin(request);

  let variantId: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { variantId?: unknown };
    if (typeof body.variantId === "string") variantId = body.variantId.trim();
  } else {
    const fd = await request.formData();
    const raw = fd.get("variantId");
    if (typeof raw === "string") variantId = raw.trim();
  }

  if (!variantId || !variantId.startsWith("gid://shopify/ProductVariant/")) {
    return Response.json({ error: "invalid_variant_id" }, { status: 400 });
  }

  const company = await companyService.findByShop(session.shop);
  if (!company) {
    return Response.json({ error: "company_not_provisioned" }, { status: 404 });
  }

  const response = await admin.graphql(VARIANT_LOOKUP_QUERY, {
    variables: { id: variantId },
  });
  const body = (await response.json()) as { data: { productVariant: VariantNode | null } };
  const node = body.data.productVariant;
  if (!node) {
    return Response.json({ error: "variant_not_found" }, { status: 404 });
  }

  const cached = await getCostsForVariants(company.id, [variantId]);
  const cachedRow = cached[0] ?? null;

  return Response.json({
    remote: {
      variantId: node.id,
      sku: node.sku,
      variantTitle: node.title,
      productTitle: node.product?.title ?? null,
      price: Number.parseFloat(node.price),
      unitCost: node.inventoryItem?.unitCost
        ? Number.parseFloat(node.inventoryItem.unitCost.amount)
        : null,
      currency: node.inventoryItem?.unitCost?.currencyCode ?? null,
      inventoryQuantity: node.inventoryQuantity,
    },
    cached: cachedRow
      ? {
          unitCost: cachedRow.unitCost,
          currency: cachedRow.currency,
          fetchedAt: cachedRow.fetchedAt,
        }
      : null,
  });
};
