/**
 * Shop-info adapter — read a handful of shop-level fields we need for
 * Pricefloor bookkeeping (currently: contact email).
 *
 * Split from cost-sync.ts to keep each adapter small and single-purpose.
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const SHOP_INFO_QUERY = /* GraphQL */ `
  query PricefloorShopInfo {
    shop {
      id
      email
      currencyCode
      primaryDomain { url }
    }
  }
`;

export interface ShopInfo {
  id: string;
  email: string | null;
  currencyCode: string;
  primaryDomainUrl: string | null;
}

export async function fetchShopInfo(admin: AdminApiContext): Promise<ShopInfo> {
  const response = await admin.graphql(SHOP_INFO_QUERY);
  const body = (await response.json()) as {
    data: {
      shop: {
        id: string;
        email: string | null;
        currencyCode: string;
        primaryDomain: { url: string | null } | null;
      };
    };
  };
  const s = body.data.shop;
  return {
    id: s.id,
    email: s.email,
    currencyCode: s.currencyCode,
    primaryDomainUrl: s.primaryDomain?.url ?? null,
  };
}
