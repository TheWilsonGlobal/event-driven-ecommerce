import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthGate } from '../auth/AuthGate'
import { WithAuth, fakeAuth } from './authFixtures'
import type { AuthValue } from '../auth/AuthContext'

function renderGate(value: Partial<AuthValue> = { aal: 'aal1' }) {
  const auth = fakeAuth(value)
  render(
    <WithAuth value={auth}>
      <AuthGate>
        <div>PROTECTED APP</div>
      </AuthGate>
    </WithAuth>
  )
  return auth
}

afterEach(() => vi.unstubAllEnvs())

describe('DEV mock two-factor', () => {
  it('is inactive by default: the real screen shows', async () => {
    renderGate()
    expect(await screen.findByText('Two-factor authentication')).toBeInTheDocument()
    expect(screen.queryByText(/DEV MOCK/)).not.toBeInTheDocument()
    expect(screen.queryByText('MFA MOCKED (dev)')).not.toBeInTheDocument()
  })

  it('is inactive with DEV true but the flag unset or not exactly "true"', async () => {
    vi.stubEnv('VITE_MOCK_MFA', '1')
    renderGate()
    expect(await screen.findByText('Two-factor authentication')).toBeInTheDocument()
    expect(screen.queryByText(/DEV MOCK/)).not.toBeInTheDocument()
  })

  it('is inert when DEV is false even if the flag is "true"', async () => {
    vi.stubEnv('VITE_MOCK_MFA', 'true')
    vi.stubEnv('DEV', false)
    expect(import.meta.env.DEV).not.toBe(true)
    renderGate()
    expect(await screen.findByText('Two-factor authentication')).toBeInTheDocument()
    expect(screen.queryByText(/DEV MOCK/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Skip/ })).not.toBeInTheDocument()
    expect(screen.queryByText('PROTECTED APP')).not.toBeInTheDocument()
  })

  describe('active (DEV true + flag)', () => {
    it('shows the labelled mock screen with the warning banner', () => {
      vi.stubEnv('VITE_MOCK_MFA', 'true')
      const auth = renderGate()
      expect(screen.getByText('DEV MOCK: two-factor')).toBeInTheDocument()
      expect(screen.getByRole('note').textContent).toMatch(
        /Development only\. No real second factor/
      )
      expect(screen.getByRole('note').textContent).toMatch(/MFA_REQUIRED/)
      expect(screen.queryByText('PROTECTED APP')).not.toBeInTheDocument()
      expect(auth.mfa.findFactor).not.toHaveBeenCalled()
    })

    it.each(['', '12345', '1234567', '12'])('rejects %j as Invalid code', async (bad) => {
      vi.stubEnv('VITE_MOCK_MFA', 'true')
      const user = userEvent.setup()
      renderGate()
      if (bad) await user.type(screen.getByLabelText('Authentication code'), bad)
      await user.click(screen.getByRole('button', { name: 'Verify (mock)' }))
      expect((await screen.findByRole('alert')).textContent).toBe('Invalid code')
      expect(screen.queryByText('PROTECTED APP')).not.toBeInTheDocument()
    })

    it('unlocks on exactly 6 digits, shows the badge, makes no Supabase MFA calls', async () => {
      vi.stubEnv('VITE_MOCK_MFA', 'true')
      const user = userEvent.setup()
      const auth = renderGate()
      await user.type(screen.getByLabelText('Authentication code'), '123456')
      await user.click(screen.getByRole('button', { name: 'Verify (mock)' }))
      expect(screen.getByText('PROTECTED APP')).toBeInTheDocument()
      expect(screen.getByText('MFA MOCKED (dev)')).toBeInTheDocument()
      expect(auth.mfa.findFactor).not.toHaveBeenCalled()
      expect(auth.mfa.enroll).not.toHaveBeenCalled()
      expect(auth.mfa.verify).not.toHaveBeenCalled()
    })

    it('Skip (mock) unlocks without any MFA call', async () => {
      vi.stubEnv('VITE_MOCK_MFA', 'true')
      const user = userEvent.setup()
      const auth = renderGate()
      await user.click(screen.getByRole('button', { name: 'Skip (mock)' }))
      expect(screen.getByText('PROTECTED APP')).toBeInTheDocument()
      expect(screen.getByText('MFA MOCKED (dev)')).toBeInTheDocument()
      expect(auth.mfa.findFactor).not.toHaveBeenCalled()
      expect(auth.mfa.verify).not.toHaveBeenCalled()
    })

    it('passing the mock stores nothing in web storage', async () => {
      vi.stubEnv('VITE_MOCK_MFA', 'true')
      const user = userEvent.setup()
      renderGate()
      await user.click(screen.getByRole('button', { name: 'Skip (mock)' }))
      expect(localStorage.length).toBe(0)
      expect(sessionStorage.length).toBe(0)
    })
  })

  it('the real screen shows the Dev tip when DEV is true', async () => {
    renderGate()
    expect(await screen.findByText(/Dev tip/)).toBeInTheDocument()
    expect(screen.getByText(/totp-dev\.mjs/)).toBeInTheDocument()
  })
})
