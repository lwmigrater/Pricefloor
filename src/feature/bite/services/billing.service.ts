import { authenticate } from "@/adapters/shopify/shopify.server";

/**
 * Service to handle Usage-based Billing
 */
export const billingService = {
  /**
   * Create a usage record for a subscription line item
   * @param request The loader/action request
   * @param description Description of the charge
   * @param price Price amount
   * @param currencyCode Currency code (usually matching the subscription)
   * @param subscriptionLineItemId The specific line item ID from the subscription to charge against
   */
  async createUsageRecord(
    request: Request,
    description: string,
    price: number,
    currencyCode: string = "USD",
    subscriptionLineItemId: string
  ) {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(
      `#graphql
        mutation appSubscriptionCreateUsageRecord($description: String!, $price: MoneyInput!, $subscriptionLineItemId: ID!) {
          appSubscriptionCreateUsageRecord(
            description: $description,
            price: $price,
            subscriptionLineItemId: $subscriptionLineItemId
          ) {
            userErrors {
              field
              message
            }
            appUsageRecord {
              id
            }
          }
        }`,
      {
        variables: {
          description,
          price: {
            amount: price,
            currencyCode,
          },
          subscriptionLineItemId,
        },
      }
    );

    const responseJson = await response.json();
    return responseJson.data.appSubscriptionCreateUsageRecord;
  },
};
