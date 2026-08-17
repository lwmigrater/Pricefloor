import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_URL environment variable is required');
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_KEY environment variable is required');
}

// Validate that we're using the service role key, not anon key
if (process.env.SUPABASE_SERVICE_KEY.length < 100) {
  console.warn('⚠️ SUPABASE_SERVICE_KEY seems too short. Make sure you are using the service_role key, not the anon key!');
}

// Service role key kullanıyoruz çünkü session storage RLS bypass etmeli
// Service role key automatically bypasses RLS policies
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: 'public',
    },
  }
);

// Log to verify we're using service role (only in development)
if (process.env.NODE_ENV === 'development') {
  console.log('✅ Supabase initialized with service role key');
}

export default supabase;
