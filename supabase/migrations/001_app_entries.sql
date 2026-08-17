-- ============================================================
-- Migration: 001_app_entries.sql
-- Creates a single generic key-value store for all app data.
-- Supports multi-app, multi-company storage with JSON values
-- and full version history.
-- ============================================================

-- ── app_entries table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  app_key      TEXT        NOT NULL,          -- e.g. 'vreviews', 'vsales'
  shop         TEXT        NOT NULL,          -- e.g. 'mystore.myshopify.com'

  -- Entry type + optional sub-key
  entry_type   TEXT        NOT NULL,          -- 'design_config', 'review', 'setting', …
  entry_key    TEXT,                          -- optional: Shopify GID, setting name, …

  -- The actual data
  value        JSONB       NOT NULL,

  -- Extra metadata (who saved, label, notes)
  meta         JSONB       NOT NULL DEFAULT '{}',

  -- Versioning
  version      INTEGER     NOT NULL DEFAULT 1,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────
-- Primary access patterns
CREATE INDEX IF NOT EXISTS idx_app_entries_company_type
  ON app_entries (company_id, entry_type);

CREATE INDEX IF NOT EXISTS idx_app_entries_company_type_key
  ON app_entries (company_id, entry_type, entry_key);

CREATE INDEX IF NOT EXISTS idx_app_entries_active
  ON app_entries (company_id, entry_type, is_active)
  WHERE is_active = TRUE;

-- Query by shop + type directly (no company join needed)
CREATE INDEX IF NOT EXISTS idx_app_entries_shop_type
  ON app_entries (shop, entry_type);

-- Time-based queries
CREATE INDEX IF NOT EXISTS idx_app_entries_created
  ON app_entries (created_at DESC);

-- ── Updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_app_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_entries_updated_at ON app_entries;

CREATE TRIGGER trg_app_entries_updated_at
  BEFORE UPDATE ON app_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_app_entries_updated_at();

-- ── Row Level Security ───────────────────────────────────────
-- Enable RLS (service_role key bypasses these — safe for server-side use)
ALTER TABLE app_entries ENABLE ROW LEVEL SECURITY;

-- Deny all access to anon/authenticated roles (server-side only)
CREATE POLICY "deny_anon_access" ON app_entries
  FOR ALL
  TO anon, authenticated
  USING (FALSE);

-- ── Comments ─────────────────────────────────────────────────
COMMENT ON TABLE app_entries IS
  'Generic key-value entry store for all Vayes apps. Each row is one versioned snapshot of an entry. is_active=true marks the current version.';

COMMENT ON COLUMN app_entries.entry_type IS
  'Type of entry: design_config | review | setting | onboarding | ...';

COMMENT ON COLUMN app_entries.entry_key IS
  'Optional sub-identifier within the entry_type scope. E.g. Shopify product GID for reviews, setting name for settings.';

COMMENT ON COLUMN app_entries.value IS
  'The JSON payload for this entry. Schema varies by entry_type.';

COMMENT ON COLUMN app_entries.meta IS
  'Optional metadata: { savedBy, label, source, shopifyId, ... }';

COMMENT ON COLUMN app_entries.version IS
  'Auto-incremented per (company_id, entry_type, entry_key) group. Starts at 1.';

COMMENT ON COLUMN app_entries.is_active IS
  'TRUE for the latest/active version. Previous versions are FALSE. Use for history.';
