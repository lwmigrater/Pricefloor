/**
 * Shop metafield writer for Pricefloor's storefront kill-switch.
 *
 * The buyer widget (extensions/pricefloor-quote-form/blocks/*) is rendered
 * by the merchant's theme, which knows nothing about our Supabase state.
 * To hide the "Request bulk quote" button when the app has no active rule
 * set (fresh install without onboarding, or the merchant deleted every
 * rule), we mirror that state onto a shop metafield:
 *
 *   shop.metafields.pricefloor.enabled : boolean
 *
 * The theme extension's Liquid then guards render on that value. Because
 * Liquid can only read metafields that carry a definition with storefront
 * access, we also create the definition on first write (idempotent — an
 * "already exists" error from Shopify is treated as success).
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const NAMESPACE = "pricefloor";
const KEY = "enabled";

const SHOP_ID_QUERY = /* GraphQL */ `
  query PricefloorShopId {
    shop { id }
  }
`;

const DEFINITION_CREATE = /* GraphQL */ `
  mutation PricefloorEnabledDefinitionCreate($def: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $def) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

const METAFIELDS_SET = /* GraphQL */ `
  mutation PricefloorEnabledSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }
`;

async function fetchShopId(admin: AdminApiContext): Promise<string> {
  const res = await admin.graphql(SHOP_ID_QUERY);
  const body = (await res.json()) as { data: { shop: { id: string } } };
  return body.data.shop.id;
}

/**
 * Create the `pricefloor.enabled` boolean metafield definition on the shop.
 * Idempotent: Shopify returns a `TAKEN` userError if it already exists, which
 * we swallow. We tag the definition with `PUBLIC_READ` storefront access so
 * `shop.metafields.pricefloor.enabled` is readable from Liquid (default is
 * private, which would make the guard always fail).
 */
async function ensureDefinition(admin: AdminApiContext): Promise<void> {
  const res = await admin.graphql(DEFINITION_CREATE, {
    variables: {
      def: {
        name: "Pricefloor enabled",
        namespace: NAMESPACE,
        key: KEY,
        description: "True when the Pricefloor engine has an active rule set. Used by the storefront widget to gate rendering.",
        type: "boolean",
        ownerType: "SHOP",
        access: { storefront: "PUBLIC_READ" },
      },
    },
  });
  const body = (await res.json()) as {
    data?: {
      metafieldDefinitionCreate?: {
        createdDefinition: { id: string } | null;
        userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
      };
    };
  };
  const errors = body.data?.metafieldDefinitionCreate?.userErrors ?? [];
  if (errors.length === 0) return;
  const onlyTaken = errors.every((e) => e.code === "TAKEN");
  if (onlyTaken) return;
  throw new Error(
    `metafieldDefinitionCreate failed: ${errors.map((e) => e.message).join("; ")}`,
  );
}

/**
 * Set `shop.metafields.pricefloor.enabled` to the given boolean. Creates the
 * definition on demand so callers don't need a separate onboarding step.
 * Safe to call from any admin-authenticated flow.
 */
export async function setPricefloorEnabled(
  admin: AdminApiContext,
  enabled: boolean,
): Promise<void> {
  await ensureDefinition(admin);
  const shopId = await fetchShopId(admin);
  const res = await admin.graphql(METAFIELDS_SET, {
    variables: {
      metafields: [
        {
          ownerId: shopId,
          namespace: NAMESPACE,
          key: KEY,
          type: "boolean",
          value: enabled ? "true" : "false",
        },
      ],
    },
  });
  const body = (await res.json()) as {
    data?: {
      metafieldsSet?: {
        metafields: Array<{ id: string }> | null;
        userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
      };
    };
  };
  const errors = body.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `metafieldsSet failed: ${errors.map((e) => e.message).join("; ")}`,
    );
  }
}
