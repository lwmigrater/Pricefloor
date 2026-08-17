import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client compatible with Edge runtime.
 * Uses process.env for environment variables.
 */
export function createEdgeClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
