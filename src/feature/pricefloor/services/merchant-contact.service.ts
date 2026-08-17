/**
 * Merchant contact service.
 *
 * Caches shop.email in company_meta ("merchant_email") so background jobs
 * (SLA cron) that lack an admin context can still email the merchant.
 * Onboarding calls syncMerchantContact once; subsequent reads hit the meta
 * store.
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { companyService } from "@/feature/bite/services/company.service";
import { fetchShopInfo } from "@/feature/pricefloor/adapters/shopify/shop-info.shopify";

const META_KEY = "merchant_email";

export async function syncMerchantContact(
  admin: AdminApiContext,
  companyId: string,
): Promise<string | null> {
  const info = await fetchShopInfo(admin);
  if (info.email) {
    await companyService.setMeta(companyId, META_KEY, info.email);
  }
  return info.email;
}

export async function getMerchantEmail(companyId: string): Promise<string | null> {
  return companyService.getMeta(companyId, META_KEY);
}
