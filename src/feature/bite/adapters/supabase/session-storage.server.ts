import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { SupabaseClient } from "@supabase/supabase-js";
import { APP_KEY } from "@/feature/bite/config";

function sessionToRow(session: Session) {
  return {
    id: session.id,
    app_key: APP_KEY,
    shop: session.shop,
    // Store as explicit JSON string to avoid JSONB double-serialization issues
    payload: JSON.stringify(Object.fromEntries(session.toPropertyArray())),
    expires: session.expires?.toISOString() ?? null,
  };
}

function rowToSession(row: Record<string, unknown>): Session {
  const raw = row.payload;
  const obj: Record<string, unknown> =
    typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>);
  const entries = Object.entries(obj) as [string, string | number | boolean][];
  return Session.fromPropertyArray(entries);
}

export class SupabaseSessionStorage implements SessionStorage {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  private table() {
    return this.supabase.from("sessions");
  }

  async storeSession(session: Session): Promise<boolean> {
    try {
      const { error } = await this.table().upsert(sessionToRow(session), {
        onConflict: "id,app_key",
      });
      if (error) {
        console.error("[session:store]", error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("[session:store] exception:", e);
      return false;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    try {
      const { data, error } = await this.table()
        .select("*")
        .eq("id", id)
        .eq("app_key", APP_KEY)
        .maybeSingle();

      if (error) {
        console.error("[session:load]", error);
        return undefined;
      }
      if (!data) return undefined;
      return rowToSession(data);
    } catch (e) {
      console.error("[session:load] exception:", e);
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      const { error } = await this.table()
        .delete()
        .eq("id", id)
        .eq("app_key", APP_KEY);

      if (error) {
        console.error("[session:delete]", error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("[session:delete] exception:", e);
      return false;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      if (ids.length === 0) return true;
      const { error } = await this.table()
        .delete()
        .in("id", ids)
        .eq("app_key", APP_KEY);

      if (error) {
        console.error("[session:deleteMany]", error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("[session:deleteMany] exception:", e);
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    try {
      const { data, error } = await this.table()
        .select("*")
        .eq("shop", shop)
        .eq("app_key", APP_KEY);

      if (error) {
        console.error("[session:findByShop]", error);
        return [];
      }
      return (data ?? []).map(rowToSession);
    } catch (e) {
      console.error("[session:findByShop] exception:", e);
      return [];
    }
  }
}
