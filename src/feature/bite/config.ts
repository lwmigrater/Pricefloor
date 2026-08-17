/**
 * Shared app configuration.
 *
 * APP_KEY isolates this app's data in the shared Supabase database.
 * All companies, sessions, and app_entries rows are scoped by this key.
 */
export const APP_KEY = process.env.APP_KEY || "pricefloor";
