import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

const supabaseConfig = {
  anonKey: supabaseAnonKey,
  url: supabaseUrl,
};

const globalForSupabase = globalThis as typeof globalThis & {
  __coachOsSupabaseClient?: SupabaseClient;
};

export function getSupabaseClient() {
  if (!globalForSupabase.__coachOsSupabaseClient) {
    globalForSupabase.__coachOsSupabaseClient = createClient(
      supabaseConfig.url,
      supabaseConfig.anonKey,
    );
  }

  return globalForSupabase.__coachOsSupabaseClient;
}

export const supabase = getSupabaseClient();
