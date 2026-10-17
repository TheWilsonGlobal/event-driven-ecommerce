'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBrowserSupabase } from '../lib/supabase/browser'
import { onAuthRequired } from '../lib/authEvents'
import AuthModal from './AuthModal'
import {
  AuthContext,
  type AuthContextValue,
  type AuthResult,
  type OpenAuthOptions,
} from './authContext'

export { useAuth } from './authContext'
export type { AuthContextValue, AuthResult, OpenAuthOptions } from './authContext'

/** Map a Supabase auth error to a sentence that never echoes credentials. */
function friendlyAuthError(err: {
  status?: number | undefined
  code?: string | undefined
}): string {
  if (
    err.status === 429 ||
    err.code === 'over_request_rate_limit' ||
    err.code === 'over_email_send_rate_limit'
  ) {
    return 'Too many attempts. Please wait a minute and try again.'
  }
  switch (err.code) {
    case 'invalid_credentials':
      return 'Incorrect email or password.'
    case 'email_not_confirmed':
      return 'Please confirm your email first: check your inbox for the confirmation link.'
    case 'weak_password':
      return 'That password is too weak. Use at least 10 characters.'
    case 'user_already_exists':
      return 'An account with this email already exists. Try signing in.'
    case 'signup_disabled':
      return 'Sign-ups are currently disabled.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [user, setUser] = useState<AuthContextValue['user']>(null)
  const [loading, setLoading] = useState<boolean>(!!supabase)
  const [modalOpen, setModalOpen] = useState(false)
  const [reason, setReason] = useState<string | undefined>()
  const resume = useRef<(() => void) | undefined>(undefined)

  const finishSignIn = useCallback(() => {
    const cb = resume.current
    resume.current = undefined
    setModalOpen(false)
    setReason(undefined)
    if (cb) cb()
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      const u = data.session?.user
      setUser(u ? { id: u.id, email: u.email ?? '' } : null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user
      setUser(u ? { id: u.id, email: u.email ?? '' } : null)
      setLoading(false)
      if (event === 'SIGNED_IN' && u) finishSignIn()
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [supabase, finishSignIn])

  const openAuthModal = useCallback((opts?: OpenAuthOptions) => {
    resume.current = opts?.onSignedIn
    setReason(opts?.reason)
    setModalOpen(true)
  }, [])

  const closeAuthModal = useCallback(() => {
    resume.current = undefined
    setModalOpen(false)
    setReason(undefined)
  }, [])

  // apiFetch asks for a sign-in prompt when the session is gone or rejected.
  useEffect(
    () =>
      onAuthRequired((why) => {
        setReason(why)
        setModalOpen(true)
      }),
    []
  )

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!supabase) return { ok: false, error: 'Sign-in is unavailable.' }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { ok: false, error: friendlyAuthError(error) }
      return { ok: true }
    },
    [supabase]
  )

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!supabase) return { ok: false, error: 'Sign-in is unavailable.' }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) return { ok: false, error: friendlyAuthError(error) }
      // The project requires e-mail confirmation: no session until the link is clicked.
      if (!data.session) return { ok: true, needsEmailConfirmation: true }
      return { ok: true }
    },
    [supabase]
  )

  const sendMagicLink = useCallback(
    async (email: string): Promise<AuthResult> => {
      if (!supabase) return { ok: false, error: 'Sign-in is unavailable.' }
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) return { ok: false, error: friendlyAuthError(error) }
      return { ok: true, linkSent: true }
    },
    [supabase]
  )

  const signOut = useCallback(async () => {
    if (!supabase) return
    // Local cart state lives outside auth and is deliberately left alone.
    await supabase.auth.signOut()
    setUser(null)
  }, [supabase])

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: !!supabase,
      loading,
      user,
      openAuthModal,
      closeAuthModal,
      signInWithPassword,
      signUp,
      sendMagicLink,
      signOut,
    }),
    [
      supabase,
      loading,
      user,
      openAuthModal,
      closeAuthModal,
      signInWithPassword,
      signUp,
      sendMagicLink,
      signOut,
    ]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthModal isOpen={modalOpen} reason={reason} onClose={closeAuthModal} />
    </AuthContext.Provider>
  )
}
