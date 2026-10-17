import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import StorefrontFooter from '../components/StorefrontFooter'
import { AuthContext, type AuthContextValue } from '../components/authContext'
import { hasOpsAccess } from '../lib/claims'
import * as api from '../lib/api'

jest.mock('../lib/supabase/browser', () => ({ getBrowserSupabase: () => null }))
jest.mock('../lib/api', () => ({ getTopology: jest.fn() }))

const getTopology = api.getTopology as jest.Mock

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'none' })}.${enc(payload)}.sig`
}

function renderFooter(isOps: boolean) {
  const value = { isOps, user: null } as unknown as AuthContextValue
  return render(
    <AuthContext.Provider value={value}>
      <StorefrontFooter />
    </AuthContext.Provider>
  )
}

beforeEach(() => getTopology.mockReset())

describe('footer /topology gating', () => {
  it('makes no topology request for non-ops users', async () => {
    renderFooter(false)
    expect(getTopology).not.toHaveBeenCalled()
    expect(screen.getByText(/Gateway: —/)).toBeInTheDocument()
  })

  it('fetches topology for ops users and shows ports', async () => {
    getTopology.mockResolvedValue([{ name: 'gateway', url: 'http://localhost:5460' }])
    renderFooter(true)
    await waitFor(() => expect(screen.getByText('Gateway: 5460')).toBeInTheDocument())
    expect(getTopology).toHaveBeenCalledTimes(1)
  })
})

describe('hasOpsAccess', () => {
  it('requires ADMIN app_role and aal2', () => {
    expect(hasOpsAccess(jwt({ app_role: 'ADMIN', aal: 'aal2' }))).toBe(true)
    expect(hasOpsAccess(jwt({ app_role: 'ADMIN', aal: 'aal1' }))).toBe(false)
    expect(hasOpsAccess(jwt({ app_role: 'CUSTOMER', aal: 'aal2' }))).toBe(false)
    expect(hasOpsAccess(jwt({ role: 'ADMIN', aal: 'aal2' }))).toBe(false)
    expect(hasOpsAccess(null)).toBe(false)
    expect(hasOpsAccess('garbage')).toBe(false)
  })
})
