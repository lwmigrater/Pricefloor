import type { ActionFunctionArgs } from "react-router";
import supabase from "@/adapters/supabase/supabase.server";
import { authenticate } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";

/**
 * draft_orders/update — merchant or a manual override touched a draft order
 * the engine created. We log it so audit reflects reality; conflict handling
 * (merchant edited price below floor) lands in Hafta 2 alongside decision
 * writes.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const company = await companyService.findByShop(shop);
  if (!company) return new Response();

  await supabase.from("pf_audit_log").insert({
    company_id: company.id,
    shop,
    event_type: "webhook.draft_orders.update",
    payload: payload as Record<string, unknown>,
  });

  return new Response();
};
