/**
 * App-proxy endpoint: POST /apps/pricefloor/quote
 *
 * Shopify forwards storefront POSTs from /apps/pricefloor/quote to this
 * URL, signed with the app secret. `authenticate.public.appProxy` validates
 * the signature and gives us the shop context + a live admin GraphQL client.
 *
 * Body (JSON):
 *   {
 *     "requestId": "uuid",              // optional; server generates if absent
 *     "shopifyCustomerId": "gid://...", // optional; walk-in quotes allowed
 *     "shopifyCompanyId": "gid://...",  // optional; B2B
 *     "companyTier": "gold",            // optional; drives tier_cap rules
 *     "terms": { "payment": "net30" },  // optional
 *     "lines": [
 *       { "variantId": "gid://...", "quantity": 100, "requestedUnitPrice": 12.5, "basePrice": 15 }
 *     ]
 *   }
 *
 * Response (200): decision summary + invoice URL if a draft order was created.
 *
 * NOT a loader — GET is disallowed. The absent loader export means Remix
 * returns 405 on GET, which is what we want.
 */

import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";
import { getActiveRuleSet } from "@/feature/pricefloor/adapters/supabase/rule-set.repository";
import { getFreshSnapshot } from "@/feature/pricefloor/services/cost-cache.service";
import { decideAndAct } from "@/feature/pricefloor/services/quote-decision.service";
import { checkCompanyLimit } from "@/feature/pricefloor/services/plan-gate.service";
import type { QuoteRequest } from "@/feature/pricefloor/engine";

interface ProxyQuoteBody {
  requestId?: string;
  shopifyCustomerId?: string;
  shopifyCompanyId?: string;
  // Buyer email — stashed on raw_input.shopifyCustomerEmail so orders/create
  // fallback matcher (email + expires_at window) can tie a paid order back
  // to this quote when draft_order_id is absent.
  customerEmail?: string;
  companyTier?: string;
  terms?: { payment?: string; leadTimeDays?: number };
  lines: Array<{
    variantId: string;
    quantity: number;
    requestedUnitPrice?: number;
    basePrice?: number;
  }>;
  currency?: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  // Wrap the whole action so anything from authenticate.public.appProxy → DB
  // calls → engine surfaces as a labelled JSON error in the log instead of an
  // opaque 500. Buyer-facing widget just shows "Something went wrong (500)"
  // regardless, but the log line tells us which stage blew up.
  try {
    const { session, admin } = await authenticate.public.appProxy(request);
    if (!session || !admin) {
      return Response.json({ error: "unauthenticated" }, { status: 401 });
    }

    let body: ProxyQuoteBody;
    try {
      body = (await request.json()) as ProxyQuoteBody;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return Response.json({ error: "missing_lines" }, { status: 400 });
    }

    const company = await companyService.findByShop(session.shop);
    if (!company) {
      return Response.json({ error: "company_not_provisioned" }, { status: 404 });
    }

    const gate = await checkCompanyLimit(company.id, body.shopifyCompanyId ?? null);
    if (!gate.ok) {
      return Response.json(
        {
          error: "plan_cap_exceeded",
          planId: gate.planId,
          cap: gate.cap,
          used: gate.used,
        },
        { status: 402 },
      );
    }

    const active = await getActiveRuleSet(company.id);
    if (!active) {
      return Response.json({ error: "no_active_rule_set" }, { status: 409 });
    }

    const variantIds = body.lines.map((l) => l.variantId);
    const [costSnapshot, variantResponse] = await Promise.all([
      getFreshSnapshot(admin, company.id, session.shop, variantIds),
      admin.graphql(`#graphql
        query PricefloorVariantProducts($ids: [ID!]!) {
          nodes(ids: $ids) { ... on ProductVariant { id price product { id } } }
        }
      `, { variables: { ids: variantIds } }),
    ]);
    const variantJson = await variantResponse.json() as { data?: { nodes?: Array<{ id: string; price: string; product?: { id: string } } | null> } };
    const variantInfo = new Map((variantJson.data?.nodes ?? []).filter((node): node is { id: string; price: string; product?: { id: string } } => Boolean(node?.id)).map((node) => [node.id, node]));

    const quoteRequest: QuoteRequest = {
      requestId: body.requestId ?? crypto.randomUUID(),
      company: {
        id: body.shopifyCompanyId ?? "gid://shopify/Company/anonymous",
        ...(body.companyTier ? { tier: body.companyTier } : {}),
      },
      currency: body.currency ?? "USD",
      lines: body.lines.map((l) => ({
        variantId: l.variantId,
        ...(variantInfo.get(l.variantId)?.product?.id ? { productId: variantInfo.get(l.variantId)!.product!.id } : {}),
        quantity: l.quantity,
        ...(l.requestedUnitPrice != null
          ? { requestedUnitPrice: l.requestedUnitPrice }
          : {}),
        ...((variantInfo.get(l.variantId)?.price ?? l.basePrice) != null ? { basePrice: Number(variantInfo.get(l.variantId)?.price ?? l.basePrice) } : {}),
      })),
      ...(body.terms ? { terms: body.terms } : {}),
    };

    try {
      const result = await decideAndAct({
        admin,
        shop: session.shop,
        companyId: company.id,
        shopifyCustomerId: body.shopifyCustomerId ?? null,
        shopifyCompanyId: body.shopifyCompanyId ?? null,
        shopifyCustomerEmail: body.customerEmail ?? null,
        source: "proxy",
        request: quoteRequest,
        ruleSet: active.ruleSet,
        ruleSetDbId: active.dbId,
        costSnapshot,
      });
      return Response.json({
        decision: result.decision.decision,
        reason: result.decision.decisionReason,
        totalPrice: result.decision.totalPrice,
        currency: result.decision.currency,
        lines: result.decision.lines,
        invoiceUrl: result.invoiceUrl,
        expiresAt: result.expiresAt,
        warnings: result.decision.warnings,
      });
    } catch (err) {
      console.error("[proxy/quote] decideAndAct failed:", err);
      return Response.json({ error: "engine_error" }, { status: 500 });
    }
  } catch (err) {
    // authenticate.public.appProxy throws a Response for HMAC failures — pass
    // it through untouched so Shopify sees the intended status.
    if (err instanceof Response) throw err;
    console.error("[proxy/quote] setup failed:", err);
    return Response.json(
      { error: "setup_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};
