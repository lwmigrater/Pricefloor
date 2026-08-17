/**
 * Pricefloor module configuration constants.
 *
 * All timing/tolerance knobs live here so behaviour changes are one file.
 */

export const PRICEFLOOR = {
  /** Cost cache TTL. See plan §5.2. Beyond this, engine refetches live before deciding. */
  COST_CACHE_TTL_MS: 5 * 60 * 1000,

  /** Default quote validity window handed to alıcı. Plan §5.3. */
  QUOTE_EXPIRY_MS: 14 * 24 * 60 * 60 * 1000,

  /** SLA for the escalation queue before merchant is nudged. Plan §14. */
  ESCALATION_SLA_MS: 24 * 60 * 60 * 1000,
} as const;

export type PricefloorConfig = typeof PRICEFLOOR;
