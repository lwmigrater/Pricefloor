/**
 * App Entries Service
 *
 * Generic key-value store backed by the `app_entries` Supabase table.
 * Supports any entry_type (design_config, review, setting, …)
 * with full version history per (company_id, entry_type, entry_key).
 *
 * Usage:
 *   await entriesService.set(companyId, appKey, shop, 'design_config', configObj);
 *   await entriesService.get(companyId, 'design_config');
 *   await entriesService.getHistory(companyId, 'design_config');
 *   await entriesService.restore(entryId);
 */

import supabase from "@/adapters/supabase/supabase.server";
import { APP_KEY } from "@/feature/bite/config";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AppEntry<T = Record<string, unknown>> {
  id: string;
  company_id: string;
  app_key: string;
  shop: string;
  entry_type: string;
  entry_key: string | null;
  value: T;
  meta: {
    savedBy?: string;
    label?: string;
    source?: string;
    shopifyId?: string;
    [key: string]: unknown;
  };
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SetEntryOptions {
  entryKey?: string;
  meta?: AppEntry["meta"];
  /** If true, does not deactivate previous versions (keeps all active). Default: false */
  noVersioning?: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class EntriesService {
  /**
   * Save (upsert with versioning) an entry.
   * Deactivates the current active version and creates a new one.
   */
  async set<T extends object>(
    companyId: string,
    shop: string,
    entryType: string,
    value: T,
    options: SetEntryOptions = {}
  ): Promise<AppEntry<T>> {
    const { entryKey = null, meta = {}, noVersioning = false } = options;

    // 1. Deactivate current active version(s) unless noVersioning
    if (!noVersioning) {
      const deactivateQuery = supabase
        .from("app_entries")
        .update({ is_active: false })
        .eq("company_id", companyId)
        .eq("app_key", APP_KEY)
        .eq("entry_type", entryType)
        .eq("is_active", true);

      if (entryKey) {
        deactivateQuery.eq("entry_key", entryKey);
      } else {
        deactivateQuery.is("entry_key", null);
      }

      await deactivateQuery;
    }

    // 2. Get next version number
    const versionQuery = supabase
      .from("app_entries")
      .select("version")
      .eq("company_id", companyId)
      .eq("app_key", APP_KEY)
      .eq("entry_type", entryType)
      .order("version", { ascending: false })
      .limit(1);

    if (entryKey) {
      versionQuery.eq("entry_key", entryKey);
    } else {
      versionQuery.is("entry_key", null);
    }

    const { data: lastVersion } = await versionQuery;
    const nextVersion = lastVersion && lastVersion.length > 0
      ? (lastVersion[0].version as number) + 1
      : 1;

    // 3. Insert new entry
    const { data, error } = await supabase
      .from("app_entries")
      .insert({
        company_id: companyId,
        app_key: APP_KEY,
        shop,
        entry_type: entryType,
        entry_key: entryKey,
        value,
        meta: { ...meta, savedAt: new Date().toISOString() },
        version: nextVersion,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`[EntriesService] set failed: ${error.message}`);
    }

    return data as AppEntry<T>;
  }

  /**
   * Get the currently active entry for a given type (and optional key).
   * Returns null if no entry exists.
   */
  async get<T = Record<string, unknown>>(
    companyId: string,
    entryType: string,
    entryKey?: string
  ): Promise<AppEntry<T> | null> {
    const query = supabase
      .from("app_entries")
      .select("*")
      .eq("company_id", companyId)
      .eq("app_key", APP_KEY)
      .eq("entry_type", entryType)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1);

    if (entryKey) {
      query.eq("entry_key", entryKey);
    } else {
      query.is("entry_key", null);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`[EntriesService] get failed: ${error.message}`);
    }

    return data && data.length > 0 ? (data[0] as AppEntry<T>) : null;
  }

  /**
   * Get version history for an entry type (newest first).
   */
  async getHistory<T = Record<string, unknown>>(
    companyId: string,
    entryType: string,
    options: { entryKey?: string; limit?: number } = {}
  ): Promise<AppEntry<T>[]> {
    const { entryKey, limit = 20 } = options;

    const query = supabase
      .from("app_entries")
      .select("*")
      .eq("company_id", companyId)
      .eq("app_key", APP_KEY)
      .eq("entry_type", entryType)
      .order("version", { ascending: false })
      .limit(limit);

    if (entryKey) {
      query.eq("entry_key", entryKey);
    } else {
      query.is("entry_key", null);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`[EntriesService] getHistory failed: ${error.message}`);
    }

    return (data as AppEntry<T>[]) ?? [];
  }

  /**
   * Restore a specific historical version by ID.
   * Creates a new active entry with the same value (new version number).
   */
  async restore<T extends object>(
    entryId: string,
    restoredBy?: string
  ): Promise<AppEntry<T>> {
    // Fetch the historical entry
    const { data: entry, error } = await supabase
      .from("app_entries")
      .select("*")
      .eq("id", entryId)
      .single();

    if (error || !entry) {
      throw new Error(`[EntriesService] restore: entry not found (${entryId})`);
    }

    const e = entry as AppEntry<T>;

    // Re-save it as a new version
    return this.set<T>(e.company_id, e.shop, e.entry_type, e.value as T, {
      entryKey: e.entry_key ?? undefined,
      meta: {
        ...e.meta,
        restoredFrom: entryId,
        restoredFromVersion: e.version,
        savedBy: restoredBy,
      },
    });
  }

  /**
   * List all active entries of a given type for a company.
   * Useful for entry types where multiple entry_keys exist (e.g. reviews per product).
   */
  async list<T = Record<string, unknown>>(
    companyId: string,
    entryType: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<AppEntry<T>[]> {
    const { limit = 50, offset = 0 } = options;

    const { data, error } = await supabase
      .from("app_entries")
      .select("*")
      .eq("company_id", companyId)
      .eq("app_key", APP_KEY)
      .eq("entry_type", entryType)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`[EntriesService] list failed: ${error.message}`);
    }

    return (data as AppEntry<T>[]) ?? [];
  }

  /**
   * Get a specific entry by its row ID.
   */
  async getById<T = Record<string, unknown>>(entryId: string): Promise<AppEntry<T> | null> {
    const { data, error } = await supabase
      .from("app_entries")
      .select("*")
      .eq("id", entryId)
      .single();

    if (error) return null;
    return data as AppEntry<T>;
  }

  /**
   * Update a specific entry's value in-place (no new version).
   */
  async updateById<T extends object>(entryId: string, value: T): Promise<void> {
    const { error } = await supabase
      .from("app_entries")
      .update({ value, updated_at: new Date().toISOString() })
      .eq("id", entryId);

    if (error) {
      throw new Error(`[EntriesService] updateById failed: ${error.message}`);
    }
  }

  /**
   * Delete a specific entry by ID (hard delete).
   */
  async delete(entryId: string): Promise<void> {
    const { error } = await supabase
      .from("app_entries")
      .delete()
      .eq("id", entryId);

    if (error) {
      throw new Error(`[EntriesService] delete failed: ${error.message}`);
    }
  }
}

export const entriesService = new EntriesService();

// ─── Entry Type Constants ─────────────────────────────────────────────────────
// Centralized constants to avoid typos across the codebase

// Framework-generic entry types. Modules extend this by declaring their own
// entryTypes in MODULE_REGISTRY and adding constants here if desired.
export const ENTRY_TYPES = {
  DESIGN_CONFIG: "design_config",
  SETTING: "setting",
  ONBOARDING: "onboarding",
} as const;

export type EntryType = typeof ENTRY_TYPES[keyof typeof ENTRY_TYPES];
