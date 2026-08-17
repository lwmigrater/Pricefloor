import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "@/adapters/shopify/shopify.server";
import { subscriptionService } from "@/feature/bite/services/subscription.service";

/**
 * Webhook handler for APP_SUBSCRIPTIONS_CANCELLED
 * 
 * Triggered when:
 * - Merchant cancels subscription
 * - Payment fails
 * - Subscription expires
 * - Merchant declines charge
 * 
 * Updates subscription status to CANCELLED/EXPIRED in database
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

    // Handle cancellation
    await subscriptionService.handleSubscriptionCancellation(
      shop,
      subscription.admin_graphql_api_id,
      {
        status: subscription.status,
        cancelled_on: subscription.cancelled_on
      }
    );

    console.log(`[Webhook] Successfully processed cancellation for ${shop}`);

    return new Response();
  } catch (error) {
    console.error('[Webhook] Error processing subscription cancellation:', error);
    // Return 500 to trigger Shopify's retry mechanism
    throw error;
  }
};
