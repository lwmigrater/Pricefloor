/**
 * Shopify Billing Helper
 * 
 * GraphQL Admin API functions for Shopify App Billing
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { BillingInterval } from "@/type/subscription.types";

// ============================================================================
// TYPES
// ============================================================================

export interface CreateSubscriptionParams {
  name: string;
  price: number;
  currencyCode?: string;
  interval: BillingInterval;
  trialDays?: number;
  test?: boolean;
  shop: string; // Add shop parameter for returnUrl
}

export interface ShopifySubscriptionResponse {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export interface CreateSubscriptionResult {
  subscription: ShopifySubscriptionResponse;
  confirmationUrl: string;
}

// ============================================================================
// GRAPHQL QUERIES & MUTATIONS
// ============================================================================

const CREATE_APP_SUBSCRIPTION_MUTATION = `
  mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean, $trialDays: Int) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
      lineItems: $lineItems
    ) {
      appSubscription {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
        createdAt
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_APP_SUBSCRIPTION_QUERY = `
  query getAppSubscription($id: ID!) {
    node(id: $id) {
      ... on AppSubscription {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
        createdAt
      }
    }
  }
`;

const CANCEL_APP_SUBSCRIPTION_MUTATION = `
  mutation appSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_ACTIVE_SUBSCRIPTIONS_QUERY = `
  query getCurrentAppInstallation {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
        createdAt
      }
    }
  }
`;

// ============================================================================
// BILLING SERVICE
// ============================================================================

export class ShopifyBillingService {
  /**
   * Create a new app subscription charge
   */
  async createAppSubscription(
    admin: AdminApiContext,
    params: CreateSubscriptionParams
  ): Promise<CreateSubscriptionResult> {
    const {
      name,
      price,
      currencyCode = 'USD',
      interval,
      trialDays = 0,
      test = false,
      shop,
    } = params;

    // Map our interval to Shopify's format
    const intervalMap: Record<BillingInterval, string> = {
      MONTHLY: 'EVERY_30_DAYS',
      YEARLY: 'ANNUAL',
      ONE_TIME: 'EVERY_30_DAYS', // Shopify doesn't have one-time subscriptions, use 30 days
    };

    // Include shop parameter in returnUrl for session restoration
    const returnUrl = `${process.env.SHOPIFY_APP_URL}/app/subscriptions?subscription=success&shop=${shop}`;
    console.log('[ShopifyBilling] Creating subscription with returnUrl:', returnUrl);

    const response = await admin.graphql(CREATE_APP_SUBSCRIPTION_MUTATION, {
      variables: {
        name,
        test,
        trialDays,
        returnUrl,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: price, currencyCode },
                interval: intervalMap[interval],
              },
            },
          },
        ],
      },
    });

    const result = await response.json();

    if (result.data?.appSubscriptionCreate?.userErrors?.length > 0) {
      const errors = result.data.appSubscriptionCreate.userErrors;
      throw new Error(`Failed to create subscription: ${errors.map((e: any) => e.message).join(', ')}`);
    }

    const confirmationUrl = result.data.appSubscriptionCreate.confirmationUrl;
    console.log('[ShopifyBilling] Shopify confirmation URL:', confirmationUrl);

    return {
      subscription: result.data.appSubscriptionCreate.appSubscription,
      confirmationUrl,
    };
  }

  /**
   * Get subscription details by ID
   */
  async getAppSubscription(
    admin: AdminApiContext,
    subscriptionId: string
  ): Promise<ShopifySubscriptionResponse | null> {
    const response = await admin.graphql(GET_APP_SUBSCRIPTION_QUERY, {
      variables: { id: subscriptionId },
    });

    const result = await response.json();
    return result.data?.node || null;
  }

  /**
   * Cancel an app subscription
   */
  async cancelAppSubscription(
    admin: AdminApiContext,
    subscriptionId: string
  ): Promise<void> {
    const response = await admin.graphql(CANCEL_APP_SUBSCRIPTION_MUTATION, {
      variables: { id: subscriptionId },
    });

    const result = await response.json();

    if (result.data?.appSubscriptionCancel?.userErrors?.length > 0) {
      const errors = result.data.appSubscriptionCancel.userErrors;
      throw new Error(`Failed to cancel subscription: ${errors.map((e: any) => e.message).join(', ')}`);
    }
  }

  /**
   * Get all active subscriptions for the current shop
   */
  async getActiveSubscriptions(
    admin: AdminApiContext
  ): Promise<ShopifySubscriptionResponse[]> {
    const response = await admin.graphql(GET_ACTIVE_SUBSCRIPTIONS_QUERY);
    const result = await response.json();

    return result.data?.currentAppInstallation?.activeSubscriptions || [];
  }

  /**
   * Check if shop has an active subscription
   */
  async hasActiveSubscription(admin: AdminApiContext): Promise<boolean> {
    const subscriptions = await this.getActiveSubscriptions(admin);
    return subscriptions.some(
      (sub) => sub.status === 'ACTIVE' || sub.status === 'PENDING'
    );
  }
}

// Export singleton instance
export const shopifyBilling = new ShopifyBillingService();
