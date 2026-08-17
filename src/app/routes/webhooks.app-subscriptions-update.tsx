import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "@/adapters/shopify/shopify.server";
import { subscriptionService } from "@/feature/bite/services/subscription.service";

/**
 * Webhook handler for APP_SUBSCRIPTIONS_UPDATE
 * 
 * Triggered when:
 * - Subscription is activated
 * - Subscription is renewed
 * - Subscription status changes
 * - Plan is changed/upgraded
 * 
 * Syncs Shopify subscription state to our database
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] Received ${topic} for ${shop}`);

  try {
    const subscription = payload.app_subscription;

    if (!subscription) {
      console.error('[Webhook] No app_subscription in payload');
      return new Response('Missing app_subscription', { status: 400 });
    }

    // Sync subscription from Shopify to database
    await subscriptionService.syncSubscriptionFromShopify(
      shop,
      subscription.admin_graphql_api_id,
      subscription
    );

    console.log(`[Webhook] Successfully synced subscription for ${shop}`);

    return new Response();
  } catch (error) {
    console.error('[Webhook] Error processing subscription update:', error);
    // Return 500 to trigger Shopify's retry mechanism
    throw error;
  }
};
