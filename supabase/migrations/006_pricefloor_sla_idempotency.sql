-- 006_pricefloor_sla_idempotency.sql
--
-- SLA reminder idempotency: track the last time we emailed a merchant about
-- an open escalation so the hourly cron does not spam. Cron treats reminders
-- as due when last_reminder_at IS NULL (first) or older than the SLA window.

ALTER TABLE pf_escalations
  ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

-- Cron reads by (status = 'pending', created_at ≤ cutoff, last_reminder_at
-- older-than-cutoff or null). The existing (status, created_at) index still
-- covers the first two; last_reminder_at is a follow-up filter over a small
-- result set so no dedicated index is needed at this scale.

COMMENT ON COLUMN pf_escalations.last_reminder_at IS
  'Timestamp of the most recent SLA reminder email. NULL = never reminded.';
