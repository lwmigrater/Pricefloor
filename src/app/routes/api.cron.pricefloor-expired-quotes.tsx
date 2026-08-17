/**
 * Cron: mark expired quotes and tag their Shopify draft orders.
 *
 *   GET /api/cron/pricefloor-expired-quotes
 *
 * Scheduled hourly by Supabase pg_cron. For each decision whose expires_at is in
 * the past and which has NOT yet been marked expired in pf_audit_log:
 *   1. Append "pricefloor:expired" tag to the Shopify draft order.
 *   2. Emit a `quote_expired` audit event (which is also the idempotency
 *      marker — the next cron run skips this decision).
 *
 * Tagging is preferred over deleting/cancelling the draft order — the
 * merchant may still want to see the record. Shopify's checkout flow does
 * not automatically bounce a tagged invoice URL, so the buyer can still
 * technically pay; if that ever becomes a problem, upgrade this cron to
 * `draftOrderDelete` instead.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` header, same convention as
 * the SLA reminder cron.
 */

import type { LoaderFunctionArgs } from "react-router";
import supabase from "@/adapters/supabase/supabase.server";
import { unauthenticated } from "@/adapters/shopify/shopify.server";
import { addTags } from "@/feature/pricefloor/adapters/shopify/draft-order.shopify";
import { insertAuditEvent } from "@/feature/pricefloor/adapters/supabase/audit-log.repository";

const EXPIRED_TAG = "pricefloor:expired";

interface ExpiredCandidate {
  id: string; // pf_quote_decisions.id
  request_id: string;
  shopify_draft_order_id: string | null;
  expires_at: string;
  pf_quote_requests: {
    company_id: string;
    shop: string;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    if (header !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const now = new Date().toISOString();

  // Fetch expired candidates joined with request (for company_id + shop).
  // Idempotency filter (not-exists in audit_log) is applied in a second
  // query — Supabase JS doesn't compose NOT EXISTS cleanly in one call.
  const { data: candidatesRaw, error: candErr } = await supabase
    .from("pf_quote_decisions")
    .select(
      "id, request_id, shopify_draft_order_id, expires_at, pf_quote_requests!inner(company_id, shop)",
    )
    .lte("expires_at", now)
    .not("expires_at", "is", null)
    .not("shopify_draft_order_id", "is", null)
    .limit(200);
  if (candErr) {
    console.error("[cron/expired] candidate query failed:", candErr);
    return Response.json({ error: "candidate_query" }, { status: 500 });
  }
  const candidates = (candidatesRaw ?? []) as unknown as ExpiredCandidate[];
  if (candidates.length === 0) return Response.json({ ok: true, expired: 0 });

  const ids = candidates.map((c) => c.id);
  // Skip decisions already marked expired OR closed won — either way, the
  // cron has nothing more to do on them.
  const { data: alreadyRaw } = await supabase
    .from("pf_audit_log")
    .select("decision_id")
    .in("decision_id", ids)
    .in("event_type", ["quote_expired", "quote_closed_won"]);
  const already = new Set((alreadyRaw ?? []).map((r: any) => r.decision_id));

  const todo = candidates.filter((c) => !already.has(c.id));
  if (todo.length === 0) return Response.json({ ok: true, expired: 0 });

  // Group by shop so we can create one unauthenticated admin client per shop.
  const byShop = new Map<string, ExpiredCandidate[]>();
  for (const c of todo) {
    const arr = byShop.get(c.pf_quote_requests.shop) ?? [];
    arr.push(c);
    byShop.set(c.pf_quote_requests.shop, arr);
  }

  let expired = 0;
  let failed = 0;

  for (const [shop, items] of byShop) {
    let admin;
    try {
      ({ admin } = await unauthenticated.admin(shop));
    } catch (err) {
      console.error(`[cron/expired] unauth admin failed for shop=${shop}:`, err);
      failed += items.length;
      continue;
    }

    for (const item of items) {
      try {
        if (item.shopify_draft_order_id) {
          await addTags(admin, item.shopify_draft_order_id, [EXPIRED_TAG]);
        }
        await insertAuditEvent({
          companyId: item.pf_quote_requests.company_id,
          shop,
          eventType: "quote_expired",
          decisionId: item.id,
          actor: "cron",
          payload: {
            draftOrderId: item.shopify_draft_order_id,
            expiredAt: item.expires_at,
            taggedAt: new Date().toISOString(),
          },
        });
        expired++;
      } catch (err) {
        console.error(`[cron/expired] decision=${item.id} failed:`, err);
        failed++;
      }
    }
  }

  return Response.json({ ok: true, expired, failed, scanned: todo.length });
};
