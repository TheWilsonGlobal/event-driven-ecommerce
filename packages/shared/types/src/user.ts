import type { Address } from './address'

/**
 * The three roles a user account can hold.
 *
 * Not currently enforced anywhere server-side (no service checks a caller's
 * role before allowing a mutation) — this union only constrains what gets
 * stored and displayed today. Reuse it in ms-user's route schema (enum:
 * USER_ROLES) rather than leaving `role` as a free-form string, and once
 * real authorization is added, this is the type the checks should key off.
 */
export type UserRole = 'CUSTOMER' | 'ADMIN' | 'VENDOR'

export const USER_ROLES: readonly UserRole[] = ['CUSTOMER', 'ADMIN', 'VENDOR'] as const

/**
 * The public user shape returned by ms-user's API and rendered by admin —
 * never includes `passwordHash` or any other credential material.
 */
export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  isActive: boolean
  isEmailVerified: boolean
  addresses: Address[]
  createdAt: string
}
