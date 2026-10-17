import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth, type TotpEnrollment } from './AuthContext'
import { DevTotpTip } from './DevTotpTip'

/** Centered card used by every pre-app screen. */
export function AuthShell({
  title,
  children,
  overlay = false,
}: {
  title: string
  children: ReactNode
  overlay?: boolean
}) {
  return (
    <div className={overlay ? 'auth-overlay' : 'auth-page'}>
      <section
        className="auth-card"
        role={overlay ? 'dialog' : undefined}
        aria-modal={overlay ? true : undefined}
        aria-labelledby="auth-title"
      >
        <div className="auth-brand">
          <span>Admin</span> Cockpit
        </div>
        <h1 id="auth-title" className="auth-title">
          {title}
        </h1>
        {children}
      </section>
    </div>
  )
}

/** Error text announced to screen readers; always mounted so changes are read. */
export function ErrorLine({ message }: { message: string | null }) {
  return (
    <p className="auth-error" role="alert" aria-live="assertive">
      {message}
    </p>
  )
}

export function StatusScreen({ title, detail }: { title: string; detail?: string }) {
  return (
    <AuthShell title={title}>
      <p className="auth-note" role="status">
        {detail ?? 'Please wait...'}
      </p>
    </AuthShell>
  )
}

export function ConfigMissingScreen() {
  return (
    <AuthShell title="Sign-in is not configured">
      <p className="auth-note" role="alert">
        The admin was built without <code>SUPABASE_URL</code> and{' '}
        <code>SUPABASE_PUBLISHABLE_KEY</code>. Set both in the repo-root .env and restart the dev
        server.
      </p>
    </AuthShell>
  )
}

export function SignInScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => emailRef.current?.focus(), [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const failure = await signIn(email.trim(), password)
    setBusy(false)
    if (failure) setError(failure)
  }

  return (
    <AuthShell title="Sign in">
      <form className="auth-form" onSubmit={submit} noValidate={false}>
        <div className="form-group">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            ref={emailRef}
            className="input-field"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby="auth-error"
          />
        </div>
        <div className="form-group">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            className="input-field"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby="auth-error"
          />
        </div>
        <div id="auth-error">
          <ErrorLine message={error} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  )
}

export function AccessDeniedScreen({ reason }: { reason?: string }) {
  const { signOut, email, role } = useAuth()
  return (
    <AuthShell title="Access denied">
      <p className="auth-note" role="alert">
        {reason ??
          `${email ?? 'This account'} (${role ?? 'no role'}) is not allowed to use the admin cockpit. Only ADMIN and VENDOR accounts can sign in here.`}
      </p>
      <button className="btn btn-ghost" onClick={() => void signOut()} autoFocus>
        Sign out
      </button>
    </AuthShell>
  )
}

export function RoleErrorScreen() {
  const { retryRole, signOut } = useAuth()
  return (
    <AuthShell title="Could not determine your role">
      <p className="auth-note" role="alert">
        The user service did not answer GET /api/v1/users/me. Check that ms-user is running.
      </p>
      <div className="auth-actions">
        <button className="btn btn-primary" onClick={retryRole} autoFocus>
          Retry
        </button>
        <button className="btn btn-ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </AuthShell>
  )
}

type MfaPhase =
  | { kind: 'loading' }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'enroll'; enrollment: TotpEnrollment }
  | { kind: 'failed'; message: string }

/**
 * TOTP step. Verified factor present: ask for a code (challenge + verify).
 * None: enrol (QR + secret) and verify the first code. `overlay` is the
 * mid-session MFA_REQUIRED prompt, which can be cancelled; the aal1 gate cannot.
 */
export function MfaScreen({ overlay = false }: { overlay?: boolean }) {
  const { mfa, signOut } = useAuth()
  const [phase, setPhase] = useState<MfaPhase>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const factorId = await mfa.findFactor()
        if (!alive) return
        if (factorId) return setPhase({ kind: 'challenge', factorId })
        const enrollment = await mfa.enroll()
        if (alive) setPhase({ kind: 'enroll', enrollment })
      } catch (err) {
        if (alive) {
          setPhase({
            kind: 'failed',
            message: err instanceof Error ? err.message : 'Could not start MFA',
          })
        }
      }
    })()
    return () => {
      alive = false
    }
    // Intentionally runs once per mount (mfa identity changes on every render).
  }, [])

  const ready = phase.kind === 'challenge' || phase.kind === 'enroll'
  useEffect(() => {
    if (ready) codeRef.current?.focus()
  }, [ready])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (phase.kind !== 'challenge' && phase.kind !== 'enroll') return
    const factorId = phase.kind === 'challenge' ? phase.factorId : phase.enrollment.factorId
    setBusy(true)
    setError(null)
    const failure = await mfa.verify(factorId, code.trim())
    setBusy(false)
    if (failure) {
      setError(failure)
      setCode('')
      codeRef.current?.focus()
    }
  }

  const title =
    phase.kind === 'enroll' ? 'Set up two-factor authentication' : 'Two-factor authentication'

  return (
    <AuthShell title={title} overlay={overlay}>
      {phase.kind === 'loading' && (
        <p className="auth-note" role="status">
          Preparing two-factor authentication...
        </p>
      )}
      {phase.kind === 'failed' && (
        <p className="auth-error" role="alert">
          {phase.message}
        </p>
      )}
      {ready && (
        <form className="auth-form" onSubmit={submit}>
          {phase.kind === 'enroll' ? (
            <>
              <p className="auth-note">
                Operator actions require a second factor. Scan the QR code with an authenticator
                app, then enter the 6-digit code it shows.
              </p>
              <img
                className="auth-qr"
                src={phase.enrollment.qrCode}
                alt="QR code for your authenticator app"
                width={176}
                height={176}
              />
              <p className="auth-note">
                Can&apos;t scan? Enter this key manually:{' '}
                <code className="mono">{phase.enrollment.secret}</code>
              </p>
            </>
          ) : (
            <p className="auth-note">Enter the 6-digit code from your authenticator app.</p>
          )}
          <div className="form-group">
            <label htmlFor="auth-code">Authentication code</label>
            <input
              id="auth-code"
              ref={codeRef}
              className="input-field mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-invalid={error ? true : undefined}
              aria-describedby="auth-error"
            />
          </div>
          <div id="auth-error">
            <ErrorLine message={error} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Verifying...' : phase.kind === 'enroll' ? 'Activate and continue' : 'Verify'}
          </button>
        </form>
      )}
      {import.meta.env.DEV === true && ready && <DevTotpTip />}
      <div className="auth-actions">
        {overlay ? (
          <button className="btn btn-ghost" onClick={mfa.cancel}>
            Cancel
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </div>
    </AuthShell>
  )
}
