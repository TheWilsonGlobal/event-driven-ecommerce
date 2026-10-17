import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Only the project URL and the PUBLISHABLE key reach the bundle (see
// vite.config.ts). Never add a secret/service key here.
const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isAuthConfigured = Boolean(URL && KEY)

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isAuthConfigured) {
    throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).')
  }
  client ??= createClient(URL, KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  return client
}
