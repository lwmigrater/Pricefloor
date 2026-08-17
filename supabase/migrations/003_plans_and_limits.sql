-- ============================================================
-- Migration: 003_plans_and_limits.sql
-- Subscription plans, per-plan feature limits, and per-company
-- monthly usage tracking.
-- ============================================================

-- Drop in dependency order (safe — no production data yet)
DROP TABLE IF EXISTS company_usage      CASCADE;
DROP TABLE IF EXISTS plan_limits        CASCADE;
DROP TABLE IF EXISTS subscription_plans CASCADE;

-- ── subscription_plans ───────────────────────────────────────
CREATE TABLE subscription_plans (
  id           TEXT          PRIMARY KEY,   -- 'free' | 'starter' | 'pro' | 'unlimited'
  display_name TEXT          NOT NULL,
  price_usd    NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order   INTEGER       NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── plan_limits ──────────────────────────────────────────────
-- monthly_cap = -1 → unlimited, 0 → feature not available on this plan
CREATE TABLE plan_limits (
  plan_id     TEXT    NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  feature     TEXT    NOT NULL,   -- 'emails' | 'reviews' | 'faq_questions' | 'offers'
  monthly_cap INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (plan_id, feature)
);

-- ── company_usage ─────────────────────────────────────────────
CREATE TABLE company_usage (
  company_id UUID    NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  feature    TEXT    NOT NULL,
  month      TEXT    NOT NULL,   -- 'YYYY-MM'
  used_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, feature, month)
);

CREATE INDEX idx_company_usage_month ON company_usage (month);

-- ── Seed: plans ───────────────────────────────────────────────
INSERT INTO subscription_plans (id, display_name, price_usd, sort_order) VALUES
  ('free',      'Free',       0.00, 0),
  ('starter',   'Starter',    9.99, 1),
  ('pro',       'Pro',       29.99, 2),
  ('unlimited', 'Unlimited', 99.99, 3);

-- ── Seed: limits ─────────────────────────────────────────────
INSERT INTO plan_limits (plan_id, feature, monthly_cap) VALUES
  ('free',      'emails',        100),
  ('free',      'reviews',        50),
  ('free',      'faq_questions',  10),
  ('free',      'offers',          3),

  ('starter',   'emails',       1000),
  ('starter',   'reviews',       500),
  ('starter',   'faq_questions',  50),
  ('starter',   'offers',         20),

  ('pro',       'emails',       5000),
  ('pro',       'reviews',        -1),
  ('pro',       'faq_questions',  -1),
  ('pro',       'offers',         -1),

  ('unlimited', 'emails',         -1),
  ('unlimited', 'reviews',        -1),
  ('unlimited', 'faq_questions',  -1),
  ('unlimited', 'offers',         -1);

-- ── Link company → plan ───────────────────────────────────────
-- Must run after seed so existing rows get a valid FK value ('free' already exists)
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES subscription_plans(id) DEFAULT 'free';

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_usage      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_anon" ON subscription_plans FOR ALL TO anon, authenticated USING (FALSE);
CREATE POLICY "deny_anon" ON plan_limits        FOR ALL TO anon, authenticated USING (FALSE);
CREATE POLICY "deny_anon" ON company_usage      FOR ALL TO anon, authenticated USING (FALSE);

-- ── RPC: check_feature_limit ──────────────────────────────────
CREATE OR REPLACE FUNCTION check_feature_limit(
  p_company_id UUID,
  p_feature    TEXT,
  p_month      TEXT
)
RETURNS TABLE (
  can_use     BOOLEAN,
  monthly_cap INTEGER,
  used_count  INTEGER,
  plan_id     TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    (pl.monthly_cap = -1 OR COALESCE(cu.used_count, 0) < pl.monthly_cap) AS can_use,
    pl.monthly_cap,
    COALESCE(cu.used_count, 0)                                            AS used_count,
    COALESCE(c.plan_id, 'free')                                           AS plan_id
  FROM company c
  JOIN plan_limits pl
    ON pl.plan_id = COALESCE(c.plan_id, 'free')
   AND pl.feature = p_feature
  LEFT JOIN company_usage cu
    ON cu.company_id = c.id
   AND cu.feature    = p_feature
   AND cu.month      = p_month
  WHERE c.id = p_company_id;
$$;

-- ── RPC: increment_feature_usage ─────────────────────────────
CREATE OR REPLACE FUNCTION increment_feature_usage(
  p_company_id UUID,
  p_feature    TEXT,
  p_month      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO company_usage (company_id, feature, month, used_count)
  VALUES (p_company_id, p_feature, p_month, 1)
  ON CONFLICT (company_id, feature, month)
  DO UPDATE SET used_count = company_usage.used_count + 1;
END;
$$;

-- ── Comments ─────────────────────────────────────────────────
COMMENT ON TABLE subscription_plans IS
  'Master plan catalogue. id is a stable text key used across the system.';
COMMENT ON TABLE plan_limits IS
  'Monthly feature caps per plan. monthly_cap: -1 = unlimited, 0 = feature disabled.';
COMMENT ON TABLE company_usage IS
  'Monthly feature usage per company. Incremented atomically via increment_feature_usage().';
COMMENT ON COLUMN plan_limits.feature IS
  'Feature key: emails | reviews | faq_questions | offers';

-- ── Boolean-style feature flags (stored in subscription_plans as plan comparison metadata) ─────────
-- These are not quantity limits — they are gated per plan in application logic:
--   review_email_immediate  : "Send immediately" (0-day delay) for review request emails
--                             Available: pro, unlimited  |  Blocked: free, starter (min 1 day enforced in webhook)
-- See: webhooks.orders.fulfilled.tsx → effectiveDelay logic
--      app.settings.tsx → isPremium gate on "Send immediately" Select option
