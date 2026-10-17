import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The Supabase client is the only external boundary; everything else (provider,
// gate, MFA screen, claim decoding) is the real code.
const sb = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
}))

vi.mock('../auth/supabaseClient', () => ({
  isAuthConfigured: true,
  getSupabase: () => ({
    auth: {
      getSession: sb.getSession,
      onAuthStateChange: sb.onAuthStateChange,
      signOut: vi.fn(async () => ({ error: null })),
      refreshSession: vi.fn(),
      mfa: {
        listFactors: sb.listFactors,
        enroll: sb.enroll,
        unenroll: sb.unenroll,
        challenge: sb.challenge,
        verify: sb.verify,
      },
    },
  }),
}))

import { AuthProvider } from '../auth/AuthProvider'
import { AuthGate } from '../auth/AuthGate'

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`
}
const session = (aal: 'aal1' | 'aal2') => ({
  access_token: jwt({ app_role: 'ADMIN', aal, exp: 4102444800 }),
  user: { email: 'admin@example.com' },
})

const flush = () => act(async () => {})

function renderApp() {
  return render(
    <AuthProvider>
      <AuthGate>
        <div>PROTECTED APP</div>
      </AuthGate>
    </AuthProvider>
  )
}

describe('AuthProvider + AuthGate: admin TOTP at aal1 (mocked Supabase)', () => {
  beforeEach(() => {
    Object.values(sb).forEach((m) => m.mockReset())
    sb.getSession.mockResolvedValue({ data: { session: session('aal1') } })
    sb.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
    sb.challenge.mockResolvedValue({ data: { id: 'ch-1' }, error: null })
    sb.unenroll.mockResolvedValue({ error: null })
  })

  it('no factor: enrols TOTP, shows QR + secret, then challenge+verify unlocks the app', async () => {
    sb.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null })
    sb.enroll.mockResolvedValue({
      data: { id: 'f-new', totp: { qr_code: 'data:image/svg+xml;base64,AA', secret: 'JBSWY3DP' } },
      error: null,
    })
    // verify succeeds; the refreshed session is now aal2
    sb.verify.mockImplementation(async () => {
      sb.getSession.mockResolvedValue({ data: { session: session('aal2') } })
      return { data: {}, error: null }
    })
    const user = userEvent.setup()
    renderApp()
    await flush()

    expect(screen.queryByText('PROTECTED APP')).not.toBeInTheDocument()
    expect(sb.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }))
    expect(screen.getByAltText('QR code for your authenticator app')).toBeInTheDocument()
    expect(screen.getByText('JBSWY3DP')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Authentication code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Activate and continue' }))
    await flush()

    expect(sb.challenge).toHaveBeenCalledWith({ factorId: 'f-new' })
    expect(sb.verify).toHaveBeenCalledWith({
      factorId: 'f-new',
      challengeId: 'ch-1',
      code: '123456',
    })
    expect(screen.getByText('PROTECTED APP')).toBeInTheDocument()
  })

  it('verified factor: goes straight to challenge, never enrols', async () => {
    sb.listFactors.mockResolvedValue({
      data: { totp: [{ id: 'f-1', status: 'verified' }], all: [] },
      error: null,
    })
    sb.verify.mockResolvedValue({ data: {}, error: null })
    const user = userEvent.setup()
    renderApp()
    await flush()

    expect(sb.enroll).not.toHaveBeenCalled()
    expect(screen.getByText('Two-factor authentication')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Authentication code'), '654321')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await flush()
    expect(sb.verify).toHaveBeenCalledWith({
      factorId: 'f-1',
      challengeId: 'ch-1',
      code: '654321',
    })
  })

  it('drops a half-finished earlier enrolment before enrolling again', async () => {
    sb.listFactors.mockResolvedValue({
      data: { totp: [], all: [{ id: 'stale', factor_type: 'totp', status: 'unverified' }] },
      error: null,
    })
    sb.enroll.mockResolvedValue({
      data: { id: 'f-2', totp: { qr_code: 'data:x', secret: 'S' } },
      error: null,
    })
    renderApp()
    await flush()
    expect(sb.unenroll).toHaveBeenCalledWith({ factorId: 'stale' })
    expect(sb.enroll).toHaveBeenCalledTimes(1)
  })

  it('wrong code keeps the app locked and shows the provider message', async () => {
    sb.listFactors.mockResolvedValue({
      data: { totp: [{ id: 'f-1', status: 'verified' }], all: [] },
      error: null,
    })
    sb.verify.mockResolvedValue({ data: null, error: { message: 'Invalid TOTP code entered' } })
    const user = userEvent.setup()
    renderApp()
    await flush()
    await user.type(screen.getByLabelText('Authentication code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('Invalid TOTP code entered')
    expect(screen.queryByText('PROTECTED APP')).not.toBeInTheDocument()
  })

  it('enrolment failure is shown instead of locking the admin out silently', async () => {
    sb.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null })
    sb.enroll.mockResolvedValue({ data: null, error: new Error('MFA enroll is disabled') })
    renderApp()
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('MFA enroll is disabled')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('already aal2: renders the app without touching MFA', async () => {
    sb.getSession.mockResolvedValue({ data: { session: session('aal2') } })
    renderApp()
    await flush()
    expect(screen.getByText('PROTECTED APP')).toBeInTheDocument()
    expect(sb.listFactors).not.toHaveBeenCalled()
  })
})
