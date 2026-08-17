/**
 * Shopify → Pricefloor cost sync adapter.
 *
 * Two entry points:
 *  - fetchAllVariantCosts: paged bulk pull, used on initial setup (§5.2).
 *  - fetchVariantCost:     single-variant live pull, used when the cache
 *                          TTL is stale at decision time.
 *
 * Bulk operations (`bulkOperationRunQuery`) will replace paged pull once
 * traffic grows — Hafta 1 sticks to `productVariants(first: N)` for speed
 * of implementation. See plan §11 for rate-limit rationale.
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export interface RemoteVariantCost {
  variantId: string;
  sku: string | null;
  price: number;
  unitCost: number | null;
  currency: string | null;
  inventoryQuantity: number | null;
}

const VARIANTS_PAGE_QUERY = /* GraphQL */ `
  query PricefloorVariantCosts($cursor: String) {
    productVariants(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        sku
        price
        inventoryQuantity
        inventoryItem {
          id
          unitCost { amount currencyCode }
        }
      }
    }
  }
`;

const SINGLE_VARIANT_QUERY = /* GraphQL */ `
  query PricefloorVariantCost($id: ID!) {
    productVariant(id: $id) {
      id
      sku
      price
      inventoryQuantity
      inventoryItem {
        id
        unitCost { amount currencyCode }
      }
    }
  }
`;

interface VariantNode {
  id: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
  inventoryItem: {
    id: string;
    unitCost: { amount: string; currencyCode: string } | null;
  } | null;
}

function mapVariant(node: VariantNode): RemoteVariantCost {
  return {
    variantId: node.id,
    sku: node.sku,
    price: Number.parseFloat(node.price),
    unitCost: node.inventoryItem?.unitCost
      ? Number.parseFloat(node.inventoryItem.unitCost.amount)
      : null,
    currency: node.inventoryItem?.unitCost?.currencyCode ?? null,
    inventoryQuantity: node.inventoryQuantity,
  };
}

/** Paginated pull of every variant's cost + inventory. */
export async function fetchAllVariantCosts(
  admin: AdminApiContext,
): Promise<RemoteVariantCost[]> {
  const out: RemoteVariantCost[] = [];
  let cursor: string | null = null;

  do {
    const response = await admin.graphql(VARIANTS_PAGE_QUERY, {
      variables: { cursor },
    });
    const body = (await response.json()) as {
      data: {
        productVariants: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: VariantNode[];
        };
      };
    };

    const { nodes, pageInfo } = body.data.productVariants;
    for (const node of nodes) out.push(mapVariant(node));

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return out;
}

/** Single variant refresh for stale-cache decision paths. */
export async function fetchVariantCost(
  admin: AdminApiContext,
  variantId: string,
): Promise<RemoteVariantCost | null> {
  const response = await admin.graphql(SINGLE_VARIANT_QUERY, {
    variables: { id: variantId },
  });
  const body = (await response.json()) as {
    data: { productVariant: VariantNode | null };
  };
  if (!body.data.productVariant) return null;
  return mapVariant(body.data.productVariant);
}
