import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthGate } from '../auth/AuthGate'
import { WithAuth } from './authFixtures'
import type { AuthValue } from '../auth/AuthContext'

const flush = () => act(async () => {})

function renderGate(value: Partial<AuthValue>) {
  return render(
    <WithAuth value={value}>
      <AuthGate>
        <div>PROTECTED APP</div>
      </AuthGate>
    </WithAuth>
  )
}

const mfaWith = (over: Partial<AuthValue['mfa']>): AuthValue['mfa'] => ({
  pending: false,
  findFactor: async () => 'factor-1',
  enroll: vi.fn(),
  verify: vi.fn(),
  cancel: vi.fn(),
  ...over,
})

describe('AuthGate', () => {
  it('signed out: shows the sign-in form and never the app', async () => {
    const signIn = vi.fn(async () => 'Invalid login credentials')
    const user = userEvent.setup()
    renderGate({ status: 'signed-out', session: null, email: null, role: null, signIn })
    expect(screen.queryByText('PROTECTED APP')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(signIn).toHaveBeenCalledWith('a@b.co', 'pw')
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid login credentials')
  })

  it('loading: shows neither the app nor the form', () => {
    renderGate({ status: 'loading', session: null })
    expect(screen.queryByText('PROTECTED APP')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('unconfigured: explains the missing Supabase settings', () => {
    renderGate({ status: 'unconfigured', session: null })
    expect(screen.getByText('Sign-in is not configured')).toBeInTheDocument()
  })

  it('CUSTOMER: access denied, with a sign-out button', async () => {
    const signOut = vi.fn(async () => {})
    const user = userEvent.setup()
    renderGate({ role: 'CUSTOMER', aal: 'aal1', signOut })
    expect(screen.getByText('Access denied')).toBeInTheDocument()
    expect(screen.queryByText('PROTECTED APP')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })

  it('role lookup failure is not reported as access denied', () => {
    renderGate({ role: null, roleState: 'error' })
    expect(screen.getByText('Could not determine your role')).toBeInTheDocument()
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument()
  })

  it('ADMIN at aal1 with a verified factor: asks for a code, then challenge+verify', async () => {
    const verify = vi.fn(async () => null)
    const user = userEvent.setup()
    renderGate({ aal: 'aal1', mfa: mfaWith({ verify }) })
    await flush()
    expect(screen.queryByText('PROTECTED APP')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Authentication code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(verify).toHaveBeenCalledWith('factor-1', '123456')
  })

  it('ADMIN at aal1 without a factor: enrols and shows QR + secret', async () => {
    const enroll = vi.fn(async () => ({
      factorId: 'f9',
      qrCode: 'data:image/svg+xml;base64,AA',
      secret: 'JBSWY3DP',
    }))
    renderGate({ aal: 'aal1', mfa: mfaWith({ findFactor: async () => null, enroll }) })
    await flush()
    expect(enroll).toHaveBeenCalled()
    expect(screen.getByAltText('QR code for your authenticator app')).toBeInTheDocument()
    expect(screen.getByText('JBSWY3DP')).toBeInTheDocument()
  })

  it('shows a wrong-code error in a live region', async () => {
    const user = userEvent.setup()
    renderGate({
      aal: 'aal1',
      mfa: mfaWith({ verify: async () => 'Invalid TOTP code entered' }),
    })
    await flush()
    await user.type(screen.getByLabelText('Authentication code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid TOTP code entered')
  })

  it('ADMIN at aal2 and VENDOR at aal1: the app renders', () => {
    const { unmount } = renderGate({ role: 'ADMIN', aal: 'aal2' })
    expect(screen.getByText('PROTECTED APP')).toBeInTheDocument()
    unmount()
    renderGate({ role: 'VENDOR', aal: 'aal1' })
    expect(screen.getByText('PROTECTED APP')).toBeInTheDocument()
  })

  it('a mid-session MFA_REQUIRED prompt overlays the app and can be cancelled', async () => {
    const cancel = vi.fn()
    const user = userEvent.setup()
    renderGate({ aal: 'aal2', mfa: mfaWith({ pending: true, cancel }) })
    await flush()
    expect(screen.getByText('PROTECTED APP')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalled()
  })
})
