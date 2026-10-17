// JWT claim helpers. The access token is decoded (NOT verified) only to read the
// non-authoritative `app_role` / `aal` claims for UI decisions. Every service
// verifies the signature itself, so a forged claim only changes what the local
// UI draws, never what the backend allows.

export type AppRole = 'ADMIN' | 'VENDOR' | 'CUSTOMER'
export type Aal = 'aal1' | 'aal2'

export interface TokenClaims {
  role: AppRole | null
  aal: Aal
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    // UTF-8 safe without TextDecoder (absent in some runtimes, e.g. jsdom).
    const json = decodeURIComponent(
      Array.from(bin, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
    )
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function readClaims(token: string | null | undefined): TokenClaims {
  const payload = token ? decodeJwtPayload(token) : null
  const role = payload?.app_role
  return {
    // `role` in a Supabase JWT is the Postgres role ("authenticated"); the
    // business role is read ONLY from `app_role`.
    role: role === 'ADMIN' || role === 'VENDOR' || role === 'CUSTOMER' ? role : null,
    aal: payload?.aal === 'aal2' ? 'aal2' : 'aal1',
  }
}

/** /topology needs ops:read (ADMIN) plus MFA (aal2). */
export function hasOpsAccess(token: string | null | undefined): boolean {
  const c = readClaims(token)
  return c.role === 'ADMIN' && c.aal === 'aal2'
}
