import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthValue, type RoleState, type TotpEnrollment } from './AuthContext'
import { parseRole, readClaims, type AppRole } from './claims'
import { setAuthBridge } from './bridge'
import { getSupabase, isAuthConfigured } from './supabaseClient'
import { apiFetch } from '../data/apiFetch'
import { USER_SERVICE_URL } from '../data/serviceUrls'

interface Props {
  children: ReactNode
  /** Surfaces rate-limit / refusal notices; wired to the app toast. */
  onNotice?: (message: string) => void
}

export function AuthProvider({ children, onNotice }: Props) {
  const [status, setStatus] = useState<AuthValue['status']>(
    isAuthConfigured ? 'loading' : 'unconfigured'
  )
  const [session, setSession] = useState<Session | null>(null)
  const [claimRole, setClaimRole] = useState<AppRole | null>(null)
  const [meRole, setMeRole] = useState<AppRole | null>(null)
  const [roleState, setRoleState] = useState<RoleState>('loading')
  const [roleAttempt, setRoleAttempt] = useState(0)
  const [mfaPending, setMfaPending] = useState(false)

  const sessionRef = useRef<Session | null>(null)
  const mfaWaiter = useRef<((ok: boolean) => void) | null>(null)
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice

  const applySession = useCallback((next: Session | null) => {
    sessionRef.current = next
    setSession(next)
    setClaimRole(readClaims(next?.access_token).role)
    if (!next) {
      setMeRole(null)
      setRoleState('loading')
    }
    setStatus(next ? 'ready' : 'signed-out')
  }, [])

  const settleMfa = useCallback((ok: boolean) => {
    mfaWaiter.current?.(ok)
    mfaWaiter.current = null
    setMfaPending(false)
  }, [])

  // Session bootstrap + live updates (token refresh, sign-out in another tab).
  useEffect(() => {
    if (!isAuthConfigured) return
    const supabase = getSupabase()
    let alive = true
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) applySession(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) applySession(next)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [applySession])

  const signOut = useCallback(async () => {
    settleMfa(false)
    try {
      await getSupabase().auth.signOut()
    } finally {
      applySession(null)
    }
  }, [applySession, settleMfa])

  // Connect apiFetch to this session.
  useEffect(() => {
    setAuthBridge({
      getToken: () => sessionRef.current?.access_token ?? null,
      refresh: async () => {
        try {
          const { data, error } = await getSupabase().auth.refreshSession()
          if (error || !data.session) return null
          applySession(data.session)
          return data.session.access_token
        } catch {
          return null
        }
      },
      requestMfa: () =>
        new Promise<boolean>((resolve) => {
          mfaWaiter.current?.(false)
          mfaWaiter.current = resolve
          setMfaPending(true)
        }),
      onSessionExpired: () => {
        void signOut()
      },
      notify: (m) => noticeRef.current?.(m),
    })
    return () => setAuthBridge(null)
  }, [applySession, signOut])

  // Role: prefer the app_role claim; fall back to GET /users/me (the claim
  // only exists once the access-token hook is deployed).
  const hasSession = Boolean(session)
  useEffect(() => {
    if (!hasSession) return
    if (claimRole) {
      setRoleState('resolved')
      return
    }
    let alive = true
    setRoleState('loading')
    void (async () => {
      try {
        const res = await apiFetch(`${USER_SERVICE_URL}/api/v1/users/me`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { role?: unknown; user?: { role?: unknown } }
        if (!alive) return
        setMeRole(parseRole(body.role ?? body.user?.role))
        setRoleState('resolved')
      } catch {
        if (alive) setRoleState('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [hasSession, claimRole, roleAttempt])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password })
      return error ? error.message : null
    } catch (err) {
      return err instanceof Error ? err.message : 'Sign-in failed'
    }
  }, [])

  const mfa = useMemo<AuthValue['mfa']>(
    () => ({
      pending: mfaPending,
      findFactor: async () => {
        const { data, error } = await getSupabase().auth.mfa.listFactors()
        if (error) throw error
        return data.totp.find((f) => f.status === 'verified')?.id ?? null
      },
      enroll: async (): Promise<TotpEnrollment> => {
        const supabase = getSupabase()
        // A half-finished earlier enrolment blocks a new one; drop it first.
        const { data: list } = await supabase.auth.mfa.listFactors()
        for (const f of list?.all ?? []) {
          if (f.factor_type === 'totp' && f.status === 'unverified') {
            await supabase.auth.mfa.unenroll({ factorId: f.id })
          }
        }
        const { data, error } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: `Admin cockpit ${new Date().toISOString()}`,
        })
        if (error) throw error
        return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
      },
      verify: async (factorId, code) => {
        try {
          const supabase = getSupabase()
          const ch = await supabase.auth.mfa.challenge({ factorId })
          if (ch.error) return ch.error.message
          const v = await supabase.auth.mfa.verify({
            factorId,
            challengeId: ch.data.id,
            code,
          })
          if (v.error) return v.error.message
          const { data } = await supabase.auth.getSession()
          applySession(data.session)
          settleMfa(true)
          return null
        } catch (err) {
          return err instanceof Error ? err.message : 'Verification failed'
        }
      },
      cancel: () => settleMfa(false),
    }),
    [mfaPending, applySession, settleMfa]
  )

  const role = claimRole ?? meRole
  const value = useMemo<AuthValue>(
    () => ({
      status,
      email: session?.user?.email ?? null,
      role,
      roleState,
      aal: readClaims(session?.access_token).aal,
      session,
      signIn,
      signOut,
      retryRole: () => setRoleAttempt((n) => n + 1),
      mfa,
    }),
    [status, session, role, roleState, signIn, signOut, mfa]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
