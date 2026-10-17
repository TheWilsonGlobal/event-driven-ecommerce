/**
 * Shared types for the API defense layer.
 *
 * ── Roles ───────────────────────────────────────────────────────────────────
 * ADMIN / VENDOR / CUSTOMER are business roles and match `ms_user.users.role`.
 * SERVICE is a machine identity for service-to-service HTTP calls; it is never
 * issued to a person. The role comes from the custom `app_role` JWT claim (a
 * Supabase Custom Access Token Hook copies it from ms_user.users). It is NOT the
 * JWT's own `role` claim: that one is the Postgres role ("authenticated") and
 * means nothing here.
 */

export const ROLES = ['ADMIN', 'VENDOR', 'CUSTOMER', 'SERVICE'] as const
export type Role = (typeof ROLES)[number]

/** Roles a human account can hold (what ms_user.users.role may contain). */
export const USER_ROLES = ['ADMIN', 'VENDOR', 'CUSTOMER'] as const
export type UserRole = (typeof USER_ROLES)[number]

export type AuthenticatorAssurance = 'aal1' | 'aal2'

export interface AuthIdentity {
  /** `sub`: the Supabase auth user id (uuid), or the calling service's name. */
  userId: string
  role: Role
  /** aal2 means the session passed a second factor (TOTP). */
  aal: AuthenticatorAssurance
  sessionId: string | null
  email: string | null
  kind: 'user' | 'service'
}

/**
 * report  - decisions are computed and LOGGED, nothing is blocked. The rollout mode.
 * enforce - decisions are applied (401 / 403 / 429).
 */
export type EnforceMode = 'report' | 'enforce'

declare module 'fastify' {
  interface FastifyRequest {
    /** The verified identity, or null for an anonymous (or invalid-token) caller. */
    auth: AuthIdentity | null
    /** Why a presented token was rejected (a stable code), or null. */
    authError: string | null
  }
}
