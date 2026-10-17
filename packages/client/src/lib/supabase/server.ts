import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from './config'

/**
 * Supabase client for server components / route handlers, backed by the
 * request cookies (publishable key only). Writing cookies is not allowed while
 * rendering a server component, so failures there are ignored: the browser
 * client performs the refresh and persists the new cookies.
 */
export function createServerSupabase(): SupabaseClient | null {
  const config = getSupabaseConfig()
  if (!config) return null
  const cookieStore = cookies()
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // called from a server component: safe to ignore
        }
      },
    },
  })
}
