// Only the project URL and the PUBLISHABLE key are ever read here. Both are
// safe in the browser; nothing server-only may be referenced from client code.
export function getSupabaseConfig(): { url: string; publishableKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !publishableKey) return null
  return { url, publishableKey }
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null
}
