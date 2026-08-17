/**
 * Subscription Service
 * 
 * Centralized business logic for subscription management.
 * Handles syncing between Shopify billing and local database.
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import supabase from "@/adapters/supabase/supabase.server";
import { companyService } from "./company.service";
import { shopifyBilling } from "@/feature/bite/adapters/shopify/billing.shopify";
import type {
  Subscription,
  SubscriptionStatus,
  SubscriptionEventType,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
} from "@/type/subscription.types";

// ============================================================================
// TYPES
// ============================================================================

interface ShopifySubscriptionPayload {
  admin_graphql_api_id: string;
  status: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  current_period_end?: string;
  trial_ends_on?: string;
  cancelled_on?: string;
}

// ============================================================================
// STATUS MAPPING
// ============================================================================

/**
 * Maps Shopify subscription status to our internal status
 */
function mapShopifyStatusToInternal(shopifyStatus: string): SubscriptionStatus {
  const statusMap: Record<string, SubscriptionStatus> = {
    PENDING: 'TRIAL',
    ACTIVE: 'ACTIVE',
    DECLINED: 'CANCELLED',
    EXPIRED: 'EXPIRED',
    FROZEN: 'PAUSED',
    CANCELLED: 'CANCELLED',
  };

  return statusMap[shopifyStatus] || 'CANCELLED';
}

/**
 * Determines the event type based on status change
 */
function getEventTypeForStatusChange(
  previousStatus: SubscriptionStatus | null,
  newStatus: SubscriptionStatus
): SubscriptionEventType {
  if (!previousStatus) return 'CREATED';

  if (previousStatus === 'TRIAL' && newStatus === 'ACTIVE') return 'ACTIVATED';
  if (previousStatus === 'ACTIVE' && newStatus === 'ACTIVE') return 'RENEWED';
  if (newStatus === 'CANCELLED') return 'CANCELLED';
  if (newStatus === 'EXPIRED') return 'EXPIRED';
  if (newStatus === 'PAUSED') return 'PAUSED';

  return 'CREATED';
}

// ============================================================================
// SUBSCRIPTION SERVICE
// ============================================================================

class SubscriptionService {
  /**
   * Sync subscription from Shopify webhook payload to database
   */
  async syncSubscriptionFromShopify(
    shop: string,
    shopifyChargeId: string,
    payload: ShopifySubscriptionPayload
  ): Promise<void> {
    // Find subscription by Shopify charge ID
    const { data: existingSub, error: findError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('shopify_charge_id', shopifyChargeId)
      .single();

    if (findError && findError.code !== 'PGRST116') {
      // PGRST116 = not found, which is ok
      throw new Error(`Error finding subscription: ${findError.message}`);
    }

    const newStatus = mapShopifyStatusToInternal(payload.status);

    // Idempotency check - if status hasn't changed, skip
    if (existingSub && existingSub.status === newStatus) {
      console.log('[SubscriptionService] Status unchanged, skipping sync');
      return;
    }

    // Update existing subscription
    if (existingSub) {
      await this.updateSubscriptionFromWebhook(existingSub, newStatus, payload);
    } else {
      console.warn('[SubscriptionService] Subscription not found for charge:', shopifyChargeId);
      // This shouldn't normally happen - subscriptions should be created when charge is created
      // But we could create it here as a fallback
    }
  }

  /**
   * Update subscription from webhook data
   */
  private async updateSubscriptionFromWebhook(
    subscription: Subscription,
    newStatus: SubscriptionStatus,
    payload: ShopifySubscriptionPayload
  ): Promise<void> {
    const previousStatus = subscription.status;

    // Prepare update data
    const updateData: Partial<Subscription> = {
      status: newStatus,
    };

    // Update period dates if provided
    if (payload.current_period_end) {
      updateData.current_period_end = payload.current_period_end;
      // Assume period is 30 days (adjust based on your billing interval)
      const periodEnd = new Date(payload.current_period_end);
      const periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() - 30);
      updateData.current_period_start = periodStart.toISOString();
    }

    // Set activated_at if going from trial to active
    if (previousStatus === 'TRIAL' && newStatus === 'ACTIVE' && !subscription.activated_at) {
      updateData.activated_at = new Date().toISOString();
    }

    // Update subscription
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update(updateData)
      .eq('id', subscription.id);

    if (updateError) {
      throw new Error(`Error updating subscription: ${updateError.message}`);
    }

    // Log event
    const eventType = getEventTypeForStatusChange(previousStatus, newStatus);
    await this.logSubscriptionEvent(subscription.id, eventType, previousStatus, newStatus, {
      shopify_payload: payload,
    });

    console.log(`[SubscriptionService] Updated subscription ${subscription.id}: ${previousStatus} → ${newStatus}`);

    // Sync company.plan_id when subscription becomes active
    if (newStatus === 'ACTIVE') {
      await this.syncCompanyPlan(subscription.company_id, subscription.plan_id, payload.name);
    }
  }

  /**
   * Handle subscription cancellation
   */
  async handleSubscriptionCancellation(
    shop: string,
    shopifyChargeId: string,
    payload: { status: string; cancelled_on?: string }
  ): Promise<void> {
    // Find subscription
    const { data: subscription, error: findError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('shopify_charge_id', shopifyChargeId)
      .single();

    if (findError) {
      throw new Error(`Error finding subscription: ${findError.message}`);
    }

    if (!subscription) {
      console.warn('[SubscriptionService] Subscription not found for cancellation:', shopifyChargeId);
      return;
    }

    const newStatus: SubscriptionStatus = 'CANCELLED';
    const previousStatus = subscription.status;

    // Update subscription
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({
        status: newStatus,
        cancelled_at: payload.cancelled_on || new Date().toISOString(),
      })
      .eq('id', subscription.id);

    if (updateError) {
      throw new Error(`Error cancelling subscription: ${updateError.message}`);
    }

    // Log cancellation event
    await this.logSubscriptionEvent(subscription.id, 'CANCELLED', previousStatus, newStatus, {
      cancelled_on: payload.cancelled_on,
      shopify_status: payload.status,
    });

    console.log(`[SubscriptionService] Cancelled subscription ${subscription.id}`);

    // Revert company back to free plan on cancellation
    await companyService.setPlan(subscription.company_id, 'free');
  }

  /**
   * Get active subscription for a company
   */
  async getActiveSubscription(companyId: string): Promise<Subscription | null> {
    const { data, error } = await supabase
      .from('subscriptions')
      .select(`
        *,
        plan:subscription_plans(*)
      `)
      .eq('company_id', companyId)
      .in('status', ['TRIAL', 'ACTIVE'])
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Error getting active subscription: ${error.message}`);
    }

    return data as Subscription | null;
  }

  /**
   * Create a new subscription
   */
  async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    const { data, error } = await supabase
      .from('subscriptions')
      .insert(input)
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating subscription: ${error.message}`);
    }

    // Log creation event
    await this.logSubscriptionEvent(
      data.id,
      input.status === 'TRIAL' ? 'TRIAL_STARTED' : 'CREATED',
      null,
      input.status
    );

    return data as Subscription;
  }

  /**
   * Update subscription status
   */
  async updateSubscriptionStatus(
    subscriptionId: string,
    newStatus: SubscriptionStatus,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Get current subscription
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('id', subscriptionId)
      .single();

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const previousStatus = subscription.status;

    // Update status
    const { error } = await supabase
      .from('subscriptions')
      .update({ status: newStatus })
      .eq('id', subscriptionId);

    if (error) {
      throw new Error(`Error updating subscription status: ${error.message}`);
    }

    // Log event
    const eventType = getEventTypeForStatusChange(previousStatus, newStatus);
    await this.logSubscriptionEvent(subscriptionId, eventType, previousStatus, newStatus, metadata);
  }

  /**
   * Reconcile local TRIAL/ACTIVE subscription with authoritative Shopify state.
   * Covers the gap when the merchant declines the approval screen (no charge_id
   * returned, no webhook fired) or the app_subscriptions/update webhook is
   * delayed — the local row otherwise stays TRIAL forever and blocks resubscribe.
   * Returns the reconciled active subscription, or null if none is active.
   */
  async reconcileWithShopify(
    admin: AdminApiContext,
    companyId: string,
  ): Promise<Subscription | null> {
    const local = await this.getActiveSubscription(companyId).catch(() => null);
    if (!local || !local.shopify_charge_id) return local;

    let shopifySub: { id: string; status: string; name?: string; currentPeriodEnd?: string | null } | null = null;
    try {
      shopifySub = await shopifyBilling.getAppSubscription(admin, local.shopify_charge_id);
    } catch (err) {
      console.warn("[SubscriptionService] reconcile: getAppSubscription failed:", err);
      return local;
    }

    // Shopify has no record — the charge was declined, expired, or cleaned up.
    if (!shopifySub) {
      await this.forceCancel(local, "shopify_no_record");
      return null;
    }

    const shopifyStatus = shopifySub.status;
    const terminal = new Set(["DECLINED", "EXPIRED", "CANCELLED", "FROZEN"]);
    if (terminal.has(shopifyStatus)) {
      await this.forceCancel(local, `shopify_status_${shopifyStatus.toLowerCase()}`);
      return null;
    }

    // Shopify is authoritative — sync any status drift (e.g. TRIAL → ACTIVE).
    const mappedStatus = mapShopifyStatusToInternal(shopifyStatus);
    if (mappedStatus !== local.status) {
      await this.updateSubscriptionFromWebhook(local, mappedStatus, {
        admin_graphql_api_id: shopifySub.id,
        status: shopifyStatus,
        name: shopifySub.name,
        current_period_end: shopifySub.currentPeriodEnd ?? undefined,
      });
      return this.getActiveSubscription(companyId).catch(() => null);
    }

    return local;
  }

  /**
   * Mark a local subscription CANCELLED and revert the company to the free plan,
   * without calling Shopify (used when Shopify itself already reports terminal state).
   */
  private async forceCancel(subscription: Subscription, reason: string): Promise<void> {
    const previousStatus = subscription.status;
    const { error } = await supabase
      .from("subscriptions")
      .update({ status: "CANCELLED", cancelled_at: new Date().toISOString() })
      .eq("id", subscription.id);
    if (error) {
      console.error("[SubscriptionService] forceCancel update failed:", error);
      return;
    }
    await this.logSubscriptionEvent(subscription.id, "CANCELLED", previousStatus, "CANCELLED", {
      reason,
    });
    await companyService.setPlan(subscription.company_id, "free");
    console.log(`[SubscriptionService] force-cancelled subscription ${subscription.id} (${reason})`);
  }

  /**
   * Map Shopify plan name → subscription_plans.id and update company.
   * Falls back to 'free' if the plan name doesn't match any known plan.
   */
  private async syncCompanyPlan(companyId: string, subscriptionPlanId?: string, shopifyPlanName?: string): Promise<void> {
    if (!companyId) return;

    // Subscription kaydındaki plan_id öncelikli, yoksa Shopify adından eşleştir
    let planId = subscriptionPlanId ?? 'free';

    if (!subscriptionPlanId && shopifyPlanName) {
      const { data } = await supabase
        .from('subscription_plans')
        .select('id')
        .ilike('display_name', shopifyPlanName.trim())
        .maybeSingle();
      planId = data?.id ?? 'free';
    }

    await companyService.setPlan(companyId, planId);
    console.log(`[SubscriptionService] company ${companyId} plan → ${planId}`);
  }

  /**
   * Log subscription event to audit trail
   */
  private async logSubscriptionEvent(
    subscriptionId: string,
    eventType: SubscriptionEventType,
    previousStatus: SubscriptionStatus | null,
    newStatus: SubscriptionStatus,
    metadata?: Record<string, any>
  ): Promise<void> {
    const { error } = await supabase
      .from('subscription_events')
      .insert({
        subscription_id: subscriptionId,
        event_type: eventType,
        previous_status: previousStatus,
        new_status: newStatus,
        metadata: metadata || null,
      });

    if (error) {
      console.error('[SubscriptionService] Error logging event:', error);
      // Don't throw - logging failure shouldn't break the main flow
    }
  }
}

// Export singleton instance
export const subscriptionService = new SubscriptionService();
