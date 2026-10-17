'use client'

import { createContext, useContext } from 'react'

export interface AuthResult {
  ok: boolean
  /** Sign-up succeeded but the e-mail link must be clicked before a session exists. */
  needsEmailConfirmation?: boolean
  /** Magic link e-mail sent. */
  linkSent?: boolean
  error?: string
}

export interface OpenAuthOptions {
  reason?: string
  /** Called once after the user signs in (used to resume checkout). */
  onSignedIn?: () => void
}

export interface AuthContextValue {
  /** False when Supabase is not configured: the storefront then stays anonymous-only. */
  configured: boolean
  loading: boolean
  user: { id: string; email: string } | null
  /** ADMIN role (app_role claim) with aal2: may read /topology. UI hint only. */
  isOps: boolean
  openAuthModal: (opts?: OpenAuthOptions) => void
  closeAuthModal: () => void
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  sendMagicLink: (email: string) => Promise<AuthResult>
  signOut: () => Promise<void>
}

const noop = async (): Promise<AuthResult> => ({ ok: false, error: 'Sign-in is unavailable.' })

const defaultValue: AuthContextValue = {
  configured: false,
  loading: false,
  user: null,
  isOps: false,
  openAuthModal: () => undefined,
  closeAuthModal: () => undefined,
  signInWithPassword: noop,
  signUp: noop,
  sendMagicLink: noop,
  signOut: async () => undefined,
}

export const AuthContext = createContext<AuthContextValue>(defaultValue)

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
