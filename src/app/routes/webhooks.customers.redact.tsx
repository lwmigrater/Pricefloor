import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "@/adapters/shopify/shopify.server";
import supabase from "@/adapters/supabase/supabase.server";
import { APP_KEY } from "@/feature/bite/config";
import { companyService } from "@/feature/bite/services/company.service";

type Payload = {
  shop_id?: number;
  shop_domain?: string;
  customer?: { id?: number; email?: string; phone?: string };
  orders_to_redact?: number[];
};

const REDACTED_EMAIL = "redacted@example.invalid";
const REDACTED_NAME = "Redacted";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  if (!payload || !shop) {
    return new Response("Missing payload or shop", { status: 400 });
  }

  const body = payload as Payload;
  const customerEmail = body.customer?.email?.toLowerCase() ?? "";
  const customerId = body.customer?.id?.toString() ?? "";
  const orderIds = new Set((body.orders_to_redact ?? []).map(String));

  const company = await companyService.findByShop(shop);
  if (!company || (!customerEmail && !customerId && orderIds.size === 0)) {
    return new Response("Nothing to redact", { status: 200 });
  }

  const { data: entries } = await supabase
    .from("app_entries")
    .select("id, entry_type, entry_key, value")
    .eq("company_id", company.id)
    .eq("app_key", APP_KEY);

  let redactedCount = 0;

  for (const row of entries ?? []) {
    const value = (row.value ?? {}) as Record<string, any>;
    const emailMatch =
      customerEmail &&
      typeof value.author_email === "string" &&
      value.author_email.toLowerCase() === customerEmail;
    const idMatch =
      customerId && String(value.customer_id ?? "") === customerId;
    const orderMatch =
      orderIds.size > 0 &&
      typeof value.order_id === "string" &&
      orderIds.has(value.order_id.replace(/^gid:\/\/shopify\/Order\//, ""));

    if (!(emailMatch || idMatch || orderMatch)) continue;

    const scrubbed = {
      ...value,
      author_email: REDACTED_EMAIL,
      author_name: REDACTED_NAME,
      customer_id: null,
      customer_phone: null,
    };

    const { error } = await supabase
      .from("app_entries")
      .update({ value: scrubbed })
      .eq("id", row.id);

    if (!error) redactedCount++;
  }

  console.log(
    `[GDPR] Customer redact for ${shop} customer=${customerEmail || customerId} orders=${orderIds.size} — ${redactedCount} record(s) scrubbed`,
  );

  return new Response(
    JSON.stringify({ received: true, redacted: redactedCount }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
