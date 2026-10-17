import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from './config'

let client: SupabaseClient | null = null

/**
 * Browser Supabase client (publishable key). @supabase/ssr stores the session
 * in cookies, so server components can read it, and the library refreshes the
 * access token itself. Returns null when Supabase is not configured so the
 * anonymous storefront keeps working.
 */
export function getBrowserSupabase(): SupabaseClient | null {
  if (client) return client
  const config = getSupabaseConfig()
  if (!config) return null
  client = createBrowserClient(config.url, config.publishableKey)
  return client
}

/** Test seam. */
export function resetBrowserSupabase(): void {
  client = null
}
