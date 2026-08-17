/**
 * Subscription System Types
 * 
 * TypeScript types for the subscription/billing database schema
 */

// ============================================================================
// ENUMS
// ============================================================================

export type BillingInterval = 'MONTHLY' | 'YEARLY' | 'ONE_TIME';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAUSED';

export type SubscriptionEventType =
  | 'CREATED'
  | 'TRIAL_STARTED'
  | 'ACTIVATED'
  | 'RENEWED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'PAUSED'
  | 'RESUMED'
  | 'PLAN_CHANGED';

// ============================================================================
// SUBSCRIPTION PLAN TYPES
// ============================================================================

export interface SubscriptionPlanFeatures {
  [key: string]: any; // Flexible structure for plan features
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  interval: BillingInterval;
  trial_days: number;
  features: SubscriptionPlanFeatures | null;
  is_active: boolean;
  usage_based: boolean;
  usage_capped_amount: number | null;
  usage_terms: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSubscriptionPlanInput {
  name: string;
  slug: string;
  description?: string;
  price: number;
  currency?: string;
  interval: BillingInterval;
  trial_days?: number;
  features?: SubscriptionPlanFeatures;
  is_active?: boolean;
  usage_based?: boolean;
  usage_capped_amount?: number;
  usage_terms?: string;
  sort_order?: number;
}

export interface UpdateSubscriptionPlanInput {
  name?: string;
  description?: string;
  price?: number;
  trial_days?: number;
  features?: SubscriptionPlanFeatures;
  is_active?: boolean;
  usage_based?: boolean;
  usage_capped_amount?: number;
  usage_terms?: string;
  sort_order?: number;
}

// ============================================================================
// SUBSCRIPTION TYPES
// ============================================================================

export interface SubscriptionMetadata {
  [key: string]: any; // Flexible structure for subscription metadata
}

export interface Subscription {
  id: string;
  company_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  shopify_charge_id: string | null;
  shopify_confirmation_url: string | null;
  current_period_start: string;
  current_period_end: string;
  trial_start: string | null;
  trial_end: string | null;
  cancelled_at: string | null;
  cancel_at_period_end: boolean;
  activated_at: string | null;
  metadata: SubscriptionMetadata | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionWithPlan extends Subscription {
  plan: SubscriptionPlan;
}

export interface CreateSubscriptionInput {
  company_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  shopify_charge_id?: string;
  shopify_confirmation_url?: string;
  current_period_start: string;
  current_period_end: string;
  trial_start?: string;
  trial_end?: string;
  metadata?: SubscriptionMetadata;
}

export interface UpdateSubscriptionInput {
  status?: SubscriptionStatus;
  shopify_charge_id?: string;
  shopify_confirmation_url?: string;
  current_period_start?: string;
  current_period_end?: string;
  cancelled_at?: string;
  cancel_at_period_end?: boolean;
  activated_at?: string;
  metadata?: SubscriptionMetadata;
}

// ============================================================================
// SUBSCRIPTION EVENT TYPES
// ============================================================================

export interface SubscriptionEventMetadata {
  [key: string]: any; // Flexible structure for event metadata
}

export interface SubscriptionEvent {
  id: string;
  subscription_id: string;
  event_type: SubscriptionEventType;
  previous_status: SubscriptionStatus | null;
  new_status: SubscriptionStatus;
  metadata: SubscriptionEventMetadata | null;
  created_at: string;
}

export interface CreateSubscriptionEventInput {
  subscription_id: string;
  event_type: SubscriptionEventType;
  previous_status?: SubscriptionStatus;
  new_status: SubscriptionStatus;
  metadata?: SubscriptionEventMetadata;
}

// ============================================================================
// SUBSCRIPTION USAGE TYPES
// ============================================================================

export interface SubscriptionUsageMetadata {
  [key: string]: any; // Flexible structure for usage metadata
}

export interface SubscriptionUsage {
  id: string;
  subscription_id: string;
  metric_name: string;
  quantity: number;
  unit_price: number | null;
  total_amount: number | null;
  billing_period_start: string;
  billing_period_end: string;
  reported_to_shopify: boolean;
  shopify_usage_record_id: string | null;
  metadata: SubscriptionUsageMetadata | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSubscriptionUsageInput {
  subscription_id: string;
  metric_name: string;
  quantity: number;
  unit_price?: number;
  total_amount?: number;
  billing_period_start: string;
  billing_period_end: string;
  reported_to_shopify?: boolean;
  shopify_usage_record_id?: string;
  metadata?: SubscriptionUsageMetadata;
}

export interface UpdateSubscriptionUsageInput {
  quantity?: number;
  unit_price?: number;
  total_amount?: number;
  reported_to_shopify?: boolean;
  shopify_usage_record_id?: string;
  metadata?: SubscriptionUsageMetadata;
}

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Check if a subscription is currently active (trial or active status)
 */
export function isSubscriptionActive(subscription: Subscription): boolean {
  return subscription.status === 'TRIAL' || subscription.status === 'ACTIVE';
}

/**
 * Check if a subscription is in trial period
 */
export function isSubscriptionInTrial(subscription: Subscription): boolean {
  return subscription.status === 'TRIAL';
}

/**
 * Check if a subscription has expired
 */
export function hasSubscriptionExpired(subscription: Subscription): boolean {
  const now = new Date();
  const periodEnd = new Date(subscription.current_period_end);
  return now > periodEnd && subscription.status !== 'ACTIVE';
}

/**
 * Get days remaining in current period
 */
export function getDaysRemainingInPeriod(subscription: Subscription): number {
  const now = new Date();
  const periodEnd = new Date(subscription.current_period_end);
  const diffTime = periodEnd.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}
