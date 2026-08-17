/**
 * pf_cost_cache repository.
 *
 * The engine's freshness check runs in-memory over the rows this repository
 * returns; upsert is the write path both bulk sync and single-variant refresh
 * share.
 */

import supabase from "@/adapters/supabase/supabase.server";

export interface CostCacheRow {
  companyId: string;
  variantId: string;
  shop: string;
  unitCost: number | null;
  currency: string | null;
  inventoryQuantity: number | null;
  fetchedAt: number; // epoch ms
}

interface RawRow {
  company_id: string;
  variant_id: string;
  shop: string;
  unit_cost: string | null;
  currency: string | null;
  inventory_quantity: number | null;
  fetched_at: string; // ISO
}

function rowFromDb(r: RawRow): CostCacheRow {
  return {
    companyId: r.company_id,
    variantId: r.variant_id,
    shop: r.shop,
    unitCost: r.unit_cost == null ? null : Number.parseFloat(r.unit_cost),
    currency: r.currency,
    inventoryQuantity: r.inventory_quantity,
    fetchedAt: new Date(r.fetched_at).getTime(),
  };
}

export async function getCostsForVariants(
  companyId: string,
  variantIds: string[],
): Promise<CostCacheRow[]> {
  if (variantIds.length === 0) return [];
  const { data, error } = await supabase
    .from("pf_cost_cache")
    .select("*")
    .eq("company_id", companyId)
    .in("variant_id", variantIds);
  if (error) throw new Error(`pf_cost_cache read failed: ${error.message}`);
  return (data as RawRow[]).map(rowFromDb);
}

export async function listMissingCosts(
  companyId: string,
): Promise<CostCacheRow[]> {
  const { data, error } = await supabase
    .from("pf_cost_cache")
    .select("*")
    .eq("company_id", companyId)
    .is("unit_cost", null);
  if (error) throw new Error(`pf_cost_cache read failed: ${error.message}`);
  return (data as RawRow[]).map(rowFromDb);
}

export interface CostUpsertInput {
  companyId: string;
  shop: string;
  variantId: string;
  unitCost: number | null;
  currency: string | null;
  inventoryQuantity: number | null;
}

export async function upsertCosts(rows: CostUpsertInput[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    company_id: r.companyId,
    shop: r.shop,
    variant_id: r.variantId,
    unit_cost: r.unitCost,
    currency: r.currency,
    inventory_quantity: r.inventoryQuantity,
    fetched_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("pf_cost_cache")
    .upsert(payload, { onConflict: "company_id,variant_id" });
  if (error) throw new Error(`pf_cost_cache upsert failed: ${error.message}`);
}

export async function invalidateVariants(
  companyId: string,
  variantIds: string[],
): Promise<void> {
  if (variantIds.length === 0) return;
  // "Invalidate" = set fetched_at to epoch so the TTL check treats it as stale.
  // We intentionally keep the last-known unit_cost so a webhook race doesn't
  // wipe a good value before the refetch arrives.
  const { error } = await supabase
    .from("pf_cost_cache")
    .update({ fetched_at: new Date(0).toISOString() })
    .eq("company_id", companyId)
    .in("variant_id", variantIds);
  if (error) throw new Error(`pf_cost_cache invalidate failed: ${error.message}`);
}
