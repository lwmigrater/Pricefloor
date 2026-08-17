/**
 * Shopify draft-order adapter.
 *
 * Wraps `draftOrderCreate` (with priceOverride per line) and the optional
 * `draftOrderInvoiceSend` mutation. The engine's decision maps to a single
 * draft order — each decided line becomes one lineItem with its unitPrice
 * pushed into `priceOverride`.
 *
 * Plan §1.5 validated `DraftOrderLineItemInput.priceOverride: MoneyInput`
 * against API 2026-07 (session sabitleyen version) so the shape here is
 * stable — see reference-plan-doc §1.
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export interface DraftOrderLine {
  variantId: string; // Shopify GID
  quantity: number;
  unitPrice: number;
}

export interface CreateDraftOrderInput {
  customerId?: string | null; // Shopify Customer GID (optional; walk-in quotes exist)
  email?: string | null; // Guest buyer email when no Shopify customer GID exists
  shopifyCompanyId?: string | null; // Shopify Company GID (B2B)
  currencyCode: string;
  lines: DraftOrderLine[];
  tags?: string[];
  note?: string;
}

export interface CreateDraftOrderResult {
  id: string;
  name: string;
  invoiceUrl: string | null;
}

const DRAFT_ORDER_CREATE = /* GraphQL */ `
  mutation PricefloorDraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
      }
      userErrors { field message }
    }
  }
`;

const DRAFT_ORDER_INVOICE_SEND = /* GraphQL */ `
  mutation PricefloorDraftOrderInvoiceSend($id: ID!) {
    draftOrderInvoiceSend(id: $id) {
      draftOrder { id }
      userErrors { field message }
    }
  }
`;

export async function createDraftOrder(
  admin: AdminApiContext,
  input: CreateDraftOrderInput,
): Promise<CreateDraftOrderResult> {
  const variables = {
    input: {
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(!input.customerId && input.email ? { email: input.email } : {}),
      ...(input.shopifyCompanyId
        ? { purchasingEntity: { purchasingCompany: { companyId: input.shopifyCompanyId } } }
        : {}),
      ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      ...(input.note ? { note: input.note } : {}),
      lineItems: input.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        priceOverride: {
          amount: line.unitPrice.toFixed(2),
          currencyCode: input.currencyCode,
        },
      })),
    },
  };

  const response = await admin.graphql(DRAFT_ORDER_CREATE, { variables });
  const body = (await response.json()) as {
    data: {
      draftOrderCreate: {
        draftOrder: { id: string; name: string; invoiceUrl: string | null } | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    };
  };

  const payload = body.data.draftOrderCreate;
  if (payload.userErrors.length > 0 || !payload.draftOrder) {
    const msg = payload.userErrors.map((e) => e.message).join("; ") || "empty draftOrder";
    throw new Error(`draftOrderCreate failed: ${msg}`);
  }

  return {
    id: payload.draftOrder.id,
    name: payload.draftOrder.name,
    invoiceUrl: payload.draftOrder.invoiceUrl,
  };
}

const TAGS_ADD = /* GraphQL */ `
  mutation PricefloorTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

/** Add tags to any Shopify resource (draft order, order, etc.). */
export async function addTags(
  admin: AdminApiContext,
  resourceId: string,
  tags: string[],
): Promise<void> {
  const response = await admin.graphql(TAGS_ADD, {
    variables: { id: resourceId, tags },
  });
  const body = (await response.json()) as {
    data: {
      tagsAdd: {
        userErrors: { field: string[] | null; message: string }[];
      };
    };
  };
  const errors = body.data.tagsAdd.userErrors;
  if (errors.length > 0) {
    throw new Error(`tagsAdd failed: ${errors.map((e) => e.message).join("; ")}`);
  }
}

export async function sendDraftOrderInvoice(
  admin: AdminApiContext,
  draftOrderId: string,
): Promise<void> {
  const response = await admin.graphql(DRAFT_ORDER_INVOICE_SEND, {
    variables: { id: draftOrderId },
  });
  const body = (await response.json()) as {
    data: {
      draftOrderInvoiceSend: {
        userErrors: { field: string[] | null; message: string }[];
      };
    };
  };
  const errors = body.data.draftOrderInvoiceSend.userErrors;
  if (errors.length > 0) {
    throw new Error(
      `draftOrderInvoiceSend failed: ${errors.map((e) => e.message).join("; ")}`,
    );
  }
}
