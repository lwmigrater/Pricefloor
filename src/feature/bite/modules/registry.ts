import type { ModuleConfig, ModuleId } from "./types";

/**
 * Registered modules for this app.
 *
 * To add a module:
 *   1. Extend the ModuleId union in ./types.ts.
 *   2. Add an entry to MODULE_REGISTRY below.
 *   3. Add its route file(s) under src/app/routes/.
 *   4. Add its entry_type constants to entries.service.ts.
 *
 * The Dashboard nav, Onboarding wizard, and Settings tab all read from this
 * registry — you do not need to touch them when adding a module.
 */
export const MODULE_REGISTRY: Record<ModuleId, ModuleConfig> = {
  pricefloor: {
    id: "pricefloor",
    i18nKey: "modules.pricefloor.name",
    fallbackLabel: "Pricefloor",
    description:
      "Rule-based automatic B2B quote engine. Every offer validated against unit_cost so margin floors are never breached.",
    navItems: [
      {
        to: "/app/pricefloor/rules",
        i18nKey: "modules.pricefloor.nav.rules",
        fallbackLabel: "Rules",
      },
      {
        to: "/app/pricefloor/costs",
        i18nKey: "modules.pricefloor.nav.costs",
        fallbackLabel: "Costs",
      },
      {
        to: "/app/pricefloor/simulator",
        i18nKey: "modules.pricefloor.nav.simulator",
        fallbackLabel: "Simulator",
      },
      {
        to: "/app/pricefloor/quotes",
        i18nKey: "modules.pricefloor.nav.history",
        fallbackLabel: "Quote Requests",
      },
    ],
    metaKeys: [],
    entryTypes: [],
  },
};

export const ALL_MODULE_IDS: ModuleId[] = Object.keys(
  MODULE_REGISTRY,
) as ModuleId[];

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && value in MODULE_REGISTRY;
}

/** Parse the raw company_meta.enabled_modules JSON value into a clean ModuleId[]. */
export function parseEnabledModules(
  raw: string | null | undefined,
): ModuleId[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isModuleId);
  } catch {
    return [];
  }
}
