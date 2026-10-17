import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from './AuthContext'
import { AuthShell, ErrorLine } from './AuthScreens'

/**
 * DEV ONLY. Replaces the real TOTP screen when VITE_MOCK_MFA=true under the Vite dev server.
 * It only flips an in-memory UI flag (via `onPass`): no token is touched and no Supabase MFA
 * endpoint is called. The API still decides access.
 */
export function DevMockMfaScreen({ onPass }: { onPass: () => void }) {
  const { signOut } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => codeRef.current?.focus(), [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Invalid code')
      setCode('')
      codeRef.current?.focus()
      return
    }
    onPass()
  }

  return (
    <AuthShell title="DEV MOCK: two-factor">
      <p className="auth-banner" role="note">
        Development only. No real second factor. The API still decides access: with
        AUTH_ENFORCE=enforce operator routes will answer MFA_REQUIRED until a real aal2 session
        exists.
      </p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <p className="auth-note">Accept any 6-digit code.</p>
        <div className="form-group">
          <label htmlFor="auth-code">Authentication code</label>
          <input
            id="auth-code"
            ref={codeRef}
            className="input-field mono"
            inputMode="numeric"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            aria-invalid={error ? true : undefined}
            aria-describedby="auth-error"
          />
        </div>
        <div id="auth-error">
          <ErrorLine message={error} />
        </div>
        <button className="btn btn-primary" type="submit">
          Verify (mock)
        </button>
      </form>
      <div className="auth-actions">
        <button className="btn btn-ghost" type="button" onClick={onPass}>
          Skip (mock)
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </AuthShell>
  )
}

export function DevMockMfaBadge() {
  return (
    <div
      className="dev-mfa-badge"
      role="status"
      title="VITE_MOCK_MFA is on: the UI two-factor step is mocked. The API is not."
    >
      MFA MOCKED (dev)
    </div>
  )
}
