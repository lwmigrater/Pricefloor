-- Migration: 004_fix_subscriptions_plan_id.sql
-- subscriptions.plan_id was incorrectly typed as UUID.
-- subscription_plans.id is TEXT ('free', 'pro', etc.) so plan_id must match.

-- Drop the existing FK constraint first
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_id_fkey;

-- Change column type from UUID to TEXT
ALTER TABLE subscriptions
  ALTER COLUMN plan_id TYPE TEXT;

-- Re-add FK referencing the TEXT primary key of subscription_plans
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_id_fkey
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE CASCADE;
