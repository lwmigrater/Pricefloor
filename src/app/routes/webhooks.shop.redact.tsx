import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "@/adapters/shopify/shopify.server";
import supabase from "@/adapters/supabase/supabase.server";
import { APP_KEY } from "@/feature/bite/config";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (!payload || !shop) {
    return new Response("Missing payload or shop", { status: 400 });
  }

  console.log(`[GDPR] Shop redact request for ${shop}`);

  const { data: company } = await supabase
    .from("company")
    .select("id")
    .eq("shop", shop)
    .eq("app_key", APP_KEY)
    .maybeSingle();

  if (company) {
    await supabase.from("subscriptions").delete().eq("company_id", company.id);
    await supabase.from("company_usage").delete().eq("company_id", company.id);
    await supabase.from("company_meta").delete().eq("company_id", company.id);
    await supabase.from("company").delete().eq("id", company.id);
  }

  await supabase.from("sessions").delete().eq("shop", shop).eq("app_key", APP_KEY);

  return new Response("Shop data redacted", { status: 200 });
};
