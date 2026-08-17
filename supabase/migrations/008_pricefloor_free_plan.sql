-- Add the low-limit Free tier to the Pricefloor plan catalogue.
-- Free merchants can quote and approve for up to 3 distinct B2B companies.

INSERT INTO subscription_plans (id, display_name, price_usd, sort_order)
VALUES ('free', 'Free', 0.00, 0)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  price_usd = EXCLUDED.price_usd,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

INSERT INTO plan_limits (plan_id, feature, monthly_cap)
VALUES ('free', 'companies', 3)
ON CONFLICT (plan_id, feature) DO UPDATE SET monthly_cap = EXCLUDED.monthly_cap;

ALTER TABLE company ALTER COLUMN plan_id SET DEFAULT 'free';
