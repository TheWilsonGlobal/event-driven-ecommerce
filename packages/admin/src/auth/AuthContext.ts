import { createContext, useContext } from 'react'
import type { Aal, AppRole } from './claims'

export type AuthStatus = 'loading' | 'signed-out' | 'ready' | 'unconfigured'
export type RoleState = 'loading' | 'resolved' | 'error'

export interface TotpEnrollment {
  factorId: string
  /** `data:image/svg+xml...` QR code produced by Supabase. */
  qrCode: string
  secret: string
}

export interface MfaApi {
  /** A mid-session MFA_REQUIRED prompt is open (separate from the aal1 gate). */
  pending: boolean
  /** Verified TOTP factor id, or null when the admin still has to enrol. */
  findFactor: () => Promise<string | null>
  enroll: () => Promise<TotpEnrollment>
  /** challenge + verify; resolves an error message, or null on success (aal2). */
  verify: (factorId: string, code: string) => Promise<string | null>
  /** Dismiss a mid-session prompt; the original action is abandoned. */
  cancel: () => void
}

export interface AuthValue {
  status: AuthStatus
  email: string | null
  role: AppRole | null
  roleState: RoleState
  aal: Aal
  /** Raw Supabase session; typed loosely so tests need no SDK types. */
  session: { access_token: string } | null
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  retryRole: () => void
  mfa: MfaApi
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
