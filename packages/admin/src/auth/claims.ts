// JWT claim helpers. The token is decoded (NOT verified) only to read the
// non-authoritative `app_role` / `aal` claims for UI decisions; every service
// verifies the signature itself, so a forged claim here only changes what the
// local UI draws, never what the backend allows.

export type AppRole = 'ADMIN' | 'VENDOR' | 'CUSTOMER'
export type Aal = 'aal1' | 'aal2'

export interface TokenClaims {
  role: AppRole | null
  aal: Aal
  exp: number | null
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function parseRole(value: unknown): AppRole | null {
  return value === 'ADMIN' || value === 'VENDOR' || value === 'CUSTOMER' ? value : null
}

export function readClaims(token: string | null | undefined): TokenClaims {
  const payload = token ? decodeJwtPayload(token) : null
  return {
    // `role` in a Supabase JWT is the Postgres role ("authenticated"), so the
    // business role is read ONLY from `app_role`.
    role: parseRole(payload?.app_role),
    aal: payload?.aal === 'aal2' ? 'aal2' : 'aal1',
    exp: typeof payload?.exp === 'number' ? payload.exp : null,
  }
}
