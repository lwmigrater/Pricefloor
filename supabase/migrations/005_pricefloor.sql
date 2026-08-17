-- ============================================================
-- Migration: 005_pricefloor.sql
-- Pricefloor (quote engine) schema:
--   pf_rule_sets, pf_rules, pf_quote_requests, pf_quote_decisions,
--   pf_audit_log (append-only), pf_cost_cache (TTL), pf_escalations.
--
-- Also overwrites the generic seed in 003_plans_and_limits.sql with
-- Pricefloor's own tiers (starter / growth / scale, feature='companies').
-- ============================================================

-- ── Clean install of Pricefloor tables (safe pre-launch) ─────
DROP TABLE IF EXISTS pf_escalations     CASCADE;
DROP TABLE IF EXISTS pf_audit_log       CASCADE;
DROP TABLE IF EXISTS pf_cost_cache      CASCADE;
DROP TABLE IF EXISTS pf_quote_decisions CASCADE;
DROP TABLE IF EXISTS pf_quote_requests  CASCADE;
DROP TABLE IF EXISTS pf_rules           CASCADE;
DROP TABLE IF EXISTS pf_rule_sets       CASCADE;

-- ── pf_rule_sets ─────────────────────────────────────────────
-- Versioned per company. quote_decisions FK to a specific version so
-- old decisions stay explainable after rule changes.
CREATE TABLE pf_rule_sets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  shop        TEXT        NOT NULL,
  version     INTEGER     NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT FALSE,
  name        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, version)
);

CREATE UNIQUE INDEX idx_pf_rule_sets_one_active_per_company
  ON pf_rule_sets (company_id)
  WHERE is_active = TRUE;

-- Auto-increment version per company on INSERT
CREATE OR REPLACE FUNCTION pf_rule_sets_next_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.version IS NULL THEN
    SELECT COALESCE(MAX(version), 0) + 1
      INTO NEW.version
      FROM pf_rule_sets
     WHERE company_id = NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pf_rule_sets_version
  BEFORE INSERT ON pf_rule_sets
  FOR EACH ROW EXECUTE FUNCTION pf_rule_sets_next_version();

-- ── pf_rules ─────────────────────────────────────────────────
CREATE TABLE pf_rules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id  UUID        NOT NULL REFERENCES pf_rule_sets(id) ON DELETE CASCADE,
  rule_type    TEXT        NOT NULL CHECK (rule_type IN (
                 'margin_floor',
                 'volume_ladder',
                 'tier_cap',
                 'stock_age',
                 'product_exception',
                 'terms_swap',
                 'discount_cap'
               )),
  priority     INTEGER     NOT NULL DEFAULT 0,
  scope        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  params       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pf_rules_set ON pf_rules (rule_set_id, rule_type, priority);

-- ── pf_quote_requests ────────────────────────────────────────
CREATE TABLE pf_quote_requests (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  shop                 TEXT        NOT NULL,
  shopify_company_id   TEXT,
  source               TEXT        NOT NULL CHECK (source IN ('form', 'proxy', 'api')),
  raw_input            JSONB       NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pf_quote_requests_company_received
  ON pf_quote_requests (company_id, received_at DESC);

-- ── pf_quote_decisions ───────────────────────────────────────
CREATE TABLE pf_quote_decisions (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                UUID        NOT NULL REFERENCES pf_quote_requests(id) ON DELETE CASCADE,
  rule_set_id               UUID        NOT NULL REFERENCES pf_rule_sets(id),
  decision                  TEXT        NOT NULL CHECK (decision IN (
                              'auto_approve',
                              'counter_offer',
                              'escalate'
                            )),
  decision_reason           TEXT        NOT NULL,
  output                    JSONB       NOT NULL,
  shopify_draft_order_id    TEXT,
  shopify_draft_order_name  TEXT,
  invoice_url               TEXT,
  expires_at                TIMESTAMPTZ,
  decided_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pf_quote_decisions_request ON pf_quote_decisions (request_id);
CREATE INDEX idx_pf_quote_decisions_draft   ON pf_quote_decisions (shopify_draft_order_id)
  WHERE shopify_draft_order_id IS NOT NULL;
CREATE INDEX idx_pf_quote_decisions_expiry  ON pf_quote_decisions (expires_at)
  WHERE expires_at IS NOT NULL;

-- ── pf_audit_log ─────────────────────────────────────────────
-- Append-only. Enforced by trigger below.
CREATE TABLE pf_audit_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  shop          TEXT        NOT NULL,
  event_type    TEXT        NOT NULL,
  decision_id   UUID        REFERENCES pf_quote_decisions(id) ON DELETE SET NULL,
  actor         TEXT,
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pf_audit_log_company_time
  ON pf_audit_log (company_id, created_at DESC);

CREATE OR REPLACE FUNCTION pf_audit_log_no_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'pf_audit_log is append-only (rows cannot be updated or deleted)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pf_audit_log_no_update
  BEFORE UPDATE ON pf_audit_log
  FOR EACH ROW EXECUTE FUNCTION pf_audit_log_no_mutation();

CREATE TRIGGER trg_pf_audit_log_no_delete
  BEFORE DELETE ON pf_audit_log
  FOR EACH ROW EXECUTE FUNCTION pf_audit_log_no_mutation();

-- ── pf_cost_cache ────────────────────────────────────────────
-- (company_id, variant_id) composite key. TTL enforced at read time by engine.
CREATE TABLE pf_cost_cache (
  company_id          UUID          NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  variant_id          TEXT          NOT NULL,             -- Shopify GID
  shop                TEXT          NOT NULL,
  unit_cost           NUMERIC(12,4),                      -- NULL when Shopify has no cost
  currency            TEXT,
  inventory_quantity  INTEGER,
  fetched_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, variant_id)
);

CREATE INDEX idx_pf_cost_cache_freshness
  ON pf_cost_cache (company_id, fetched_at);

CREATE INDEX idx_pf_cost_cache_missing_cost
  ON pf_cost_cache (company_id)
  WHERE unit_cost IS NULL;

-- ── pf_escalations ───────────────────────────────────────────
CREATE TABLE pf_escalations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID        NOT NULL REFERENCES pf_quote_requests(id) ON DELETE CASCADE,
  assigned_to   TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
                  'pending',
                  'in_review',
                  'resolved'
                )),
  resolution    TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pf_escalations_status_time
  ON pf_escalations (status, created_at)
  WHERE status <> 'resolved';

-- ── Shared updated_at triggers ───────────────────────────────
CREATE OR REPLACE FUNCTION pf_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pf_rule_sets_updated_at
  BEFORE UPDATE ON pf_rule_sets
  FOR EACH ROW EXECUTE FUNCTION pf_touch_updated_at();

-- ── RLS: deny anon/authenticated (service_role bypasses) ─────
ALTER TABLE pf_rule_sets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_quote_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_quote_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_cost_cache      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_escalations     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_anon" ON pf_rule_sets;
DROP POLICY IF EXISTS "deny_anon" ON pf_rules;
DROP POLICY IF EXISTS "deny_anon" ON pf_quote_requests;
DROP POLICY IF EXISTS "deny_anon" ON pf_quote_decisions;
DROP POLICY IF EXISTS "deny_anon" ON pf_audit_log;
DROP POLICY IF EXISTS "deny_anon" ON pf_cost_cache;
DROP POLICY IF EXISTS "deny_anon" ON pf_escalations;

CREATE POLICY "deny_anon" ON pf_rule_sets       FOR ALL TO anon, authenticated USING (FALSE);
CREATE POLICY "deny_anon" ON pf_rules           FOR ALL TO anon, authenticated USING (FALSE);
CREATE POLICY "deny_anon" ON pf_quote_requests  FOR ALL TO anon, authenticated USING (FALSE);
CREATE POLICY "deny_anon" ON pf_quote_decisions FOR ALL TO anon, authenticated USING (FALSE);
CREATE POLICY "deny_anon" ON pf_audit_log       FOR ALL TO anon, authenticated USING (FALSE);
CREATE POLICY "deny_anon" ON pf_cost_cache      FOR ALL TO anon, authenticated USING (FALSE);
CREATE POLICY "deny_anon" ON pf_escalations     FOR ALL TO anon, authenticated USING (FALSE);

-- ── Plan seed overwrite (Pricefloor standalone) ──────────────
-- Wipe generic seeds from 003 and install Pricefloor's own.
-- company.plan_id FK references subscription_plans(id); switch defaults to 'starter'.
ALTER TABLE company ALTER COLUMN plan_id DROP DEFAULT;

DELETE FROM plan_limits;
DELETE FROM subscription_plans;

INSERT INTO subscription_plans (id, display_name, price_usd, sort_order) VALUES
  ('starter', 'Starter',  49.00, 1),
  ('growth',  'Growth',   99.00, 2),
  ('scale',   'Scale',   199.00, 3);

-- Pricefloor plan gating uses feature='companies' (total active B2B
-- companies scoped to this shop). -1 = unlimited.
INSERT INTO plan_limits (plan_id, feature, monthly_cap) VALUES
  ('starter', 'companies',  25),
  ('growth',  'companies', 100),
  ('scale',   'companies',  -1);

ALTER TABLE company ALTER COLUMN plan_id SET DEFAULT 'starter';

-- Backfill any pre-existing rows to the new default
UPDATE company SET plan_id = 'starter' WHERE plan_id NOT IN ('starter', 'growth', 'scale');

-- ── Comments ─────────────────────────────────────────────────
COMMENT ON TABLE pf_rule_sets IS
  'Versioned rule sets per company. Only one row per company has is_active=true. Quote decisions FK a specific version so history stays explainable.';

COMMENT ON TABLE pf_rules IS
  'Individual rules inside a rule_set. rule_type constrains param shape; scope narrows applicability (products/collections/tiers).';

COMMENT ON TABLE pf_quote_requests IS
  'Raw inbound quote requests. raw_input is the §6.1 payload as received.';

COMMENT ON TABLE pf_quote_decisions IS
  'Engine output for a request. FK to rule_set version locks in the interpretation used at decision time.';

COMMENT ON TABLE pf_audit_log IS
  'Append-only event stream. Triggers block UPDATE and DELETE at the DB level.';

COMMENT ON TABLE pf_cost_cache IS
  'Variant unit_cost + inventory snapshot per company. fetched_at drives 5-minute TTL enforced by the engine at read time.';

COMMENT ON COLUMN pf_cost_cache.unit_cost IS
  'NULL when Shopify has no cost for this variant. Engine MUST escalate rather than auto-approve when NULL.';

COMMENT ON TABLE pf_escalations IS
  'Human-review queue for requests the engine could not decide.';
