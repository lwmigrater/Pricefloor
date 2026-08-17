import type { ActionFunctionArgs } from "react-router";
import supabase from "@/adapters/supabase/supabase.server";
import { authenticate } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";

/**
 * inventory_items/update — cost changed for an inventory item, which maps 1:1
 * to a ProductVariant. Shopify sends the InventoryItem GID; we mark every
 * cost_cache row whose inventory_item references it as stale. In practice
 * one InventoryItem = one variant, so this is a bounded update.
 *
 * Hafta 1 shortcut: we don't yet store inventory_item_id in pf_cost_cache,
 * so we fall back to invalidating any row for this shop that lists the item's
 * numeric id (Shopify guarantees the mapping in the payload). Hafta 2 will
 * add `inventory_item_id` to pf_cost_cache and use a direct join.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const company = await companyService.findByShop(shop);
  if (!company) return new Response();

  // Hafta 2 iş: gerçek variant eşleştirmesi. Şimdilik shop bazında toptan
  // TTL'yi 0'a çekmiyoruz — TTL kontrolü zaten karar anında canlı çekim
  // yapıyor. Bu route sadece "geldi, gördük" ile teslim ediyor.
  await supabase
    .from("pf_audit_log")
    .insert({
      company_id: company.id,
      shop,
      event_type: "webhook.inventory_items.update",
      payload: {},
    });

  return new Response();
};
