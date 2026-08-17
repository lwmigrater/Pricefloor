/**
 * Cost cache orchestration.
 *
 *   syncAll             — initial full pull; called during onboarding.
 *   getFreshSnapshot    — returns a CostSnapshot ready for the engine.
 *                         Stale rows are refetched live before the snapshot
 *                         is handed over — the TTL check is the second line
 *                         of defence behind webhook invalidation (§5.2).
 *   handleShopifyUpdate — webhook handler entry: invalidate + refetch one variant.
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import { PRICEFLOOR } from "../config";
import type { CostSnapshot } from "../engine/types";
import {
  fetchAllVariantCosts,
  fetchVariantCost,
} from "../adapters/shopify/cost-sync";
import {
  getCostsForVariants,
  invalidateVariants,
  upsertCosts,
  type CostCacheRow,
} from "../adapters/supabase/cost-cache.repository";

export async function syncAll(
  admin: AdminApiContext,
  companyId: string,
  shop: string,
): Promise<{ total: number; missingCost: number }> {
  const remote = await fetchAllVariantCosts(admin);
  await upsertCosts(
    remote.map((r) => ({
      companyId,
      shop,
      variantId: r.variantId,
      unitCost: r.unitCost,
      currency: r.currency,
      inventoryQuantity: r.inventoryQuantity,
    })),
  );
  return {
    total: remote.length,
    missingCost: remote.filter((r) => r.unitCost == null).length,
  };
}

export async function getFreshSnapshot(
  admin: AdminApiContext,
  companyId: string,
  shop: string,
  variantIds: string[],
  now: number = Date.now(),
): Promise<CostSnapshot> {
  const cached = await getCostsForVariants(companyId, variantIds);
  const cachedById = new Map(cached.map((c) => [c.variantId, c]));

  const stale: string[] = [];
  const missing: string[] = [];
  for (const id of variantIds) {
    const row = cachedById.get(id);
    if (!row) {
      missing.push(id);
      continue;
    }
    if (now - row.fetchedAt > PRICEFLOOR.COST_CACHE_TTL_MS) stale.push(id);
  }

  const toRefetch = [...missing, ...stale];
  if (toRefetch.length > 0) {
    const refreshed = await Promise.all(
      toRefetch.map((id) => fetchVariantCost(admin, id)),
    );
    const refreshedNonNull = refreshed.filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );
    await upsertCosts(
      refreshedNonNull.map((r) => ({
        companyId,
        shop,
        variantId: r.variantId,
        unitCost: r.unitCost,
        currency: r.currency,
        inventoryQuantity: r.inventoryQuantity,
      })),
    );
    for (const r of refreshedNonNull) {
      cachedById.set(r.variantId, {
        companyId,
        variantId: r.variantId,
        shop,
        unitCost: r.unitCost,
        currency: r.currency,
        inventoryQuantity: r.inventoryQuantity,
        fetchedAt: Date.now(),
      });
    }
  }

  return snapshotFromRows(cachedById);
}

function snapshotFromRows(
  rowsById: Map<string, CostCacheRow>,
): CostSnapshot {
  const out: CostSnapshot = {};
  for (const [id, row] of rowsById.entries()) {
    out[id] = {
      unitCost: row.unitCost,
      currency: row.currency ?? "USD",
      fetchedAt: row.fetchedAt,
      inventoryQuantity: row.inventoryQuantity ?? undefined,
    };
  }
  return out;
}

/** Webhook path: mark stale and refetch immediately. */
export async function handleShopifyVariantUpdate(
  admin: AdminApiContext,
  companyId: string,
  shop: string,
  variantId: string,
): Promise<void> {
  await invalidateVariants(companyId, [variantId]);
  const remote = await fetchVariantCost(admin, variantId);
  if (remote) {
    await upsertCosts([
      {
        companyId,
        shop,
        variantId: remote.variantId,
        unitCost: remote.unitCost,
        currency: remote.currency,
        inventoryQuantity: remote.inventoryQuantity,
      },
    ]);
  }
}
