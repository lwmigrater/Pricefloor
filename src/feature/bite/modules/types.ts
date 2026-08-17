/**
 * Registered app modules.
 *
 * Modules are enabled per-shop and stored in `company_meta.enabled_modules`
 * as a JSON array of ModuleId. Empty = no modules active (onboarding shows).
 */

export type ModuleId = "pricefloor";

export interface NavItem {
  to: string;
  i18nKey: string;
  fallbackLabel: string;
}

export interface ModuleConfig {
  id: ModuleId;
  i18nKey: string;
  fallbackLabel: string;
  description: string;
  navItems: NavItem[];
  /** company_meta keys owned by this module (cleared on disable if requested). */
  metaKeys: string[];
  /** app_entries entry_types owned by this module. */
  entryTypes: string[];
}
