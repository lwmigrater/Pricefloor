import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "@/adapters/shopify/shopify.server";
import supabase from "@/adapters/supabase/supabase.server";
import { APP_KEY } from "@/feature/bite/config";
import { companyService } from "@/feature/bite/services/company.service";

type Payload = {
  shop_id?: number;
  shop_domain?: string;
  customer?: { id?: number; email?: string; phone?: string };
  orders_requested?: number[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  if (!payload || !shop) {
    return new Response("Missing payload or shop", { status: 400 });
  }

  const body = payload as Payload;
  const customerEmail = body.customer?.email?.toLowerCase() ?? "";
  const customerId = body.customer?.id?.toString() ?? "";

  const company = await companyService.findByShop(shop);
  const collected: Array<{ source: string; type: string; row: any }> = [];

  if (company && (customerEmail || customerId)) {
    const { data: entries } = await supabase
      .from("app_entries")
      .select("id, entry_type, entry_key, value, created_at")
      .eq("company_id", company.id)
      .eq("app_key", APP_KEY);

    for (const row of entries ?? []) {
      const value = row.value as Record<string, any> | null;
      if (!value) continue;
      const emailMatch =
        customerEmail &&
        typeof value.author_email === "string" &&
        value.author_email.toLowerCase() === customerEmail;
      const idMatch =
        customerId && String(value.customer_id ?? "") === customerId;
      if (emailMatch || idMatch) {
        collected.push({ source: "app_entries", type: row.entry_type, row });
      }
    }
  }

  console.log(
    `[GDPR] Customer data request for ${shop} customer=${customerEmail || customerId} — ${collected.length} record(s) collected`,
  );

  // Shopify only requires a 200 acknowledgement. Merchants receive the request
  // in Shopify Admin; the app-owned PII we hold (review author emails cached in
  // app_entries) is enumerated above and can be delivered to the merchant on
  // request. Extend this handler to email/export the payload when needed.

  return new Response(
    JSON.stringify({ received: true, records: collected.length }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
