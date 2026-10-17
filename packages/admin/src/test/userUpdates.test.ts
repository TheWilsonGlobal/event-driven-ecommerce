import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyUserEdit, setUserStatus } from '../hooks/ecommerce/userUpdates'
import { setAuthBridge } from '../auth/bridge'

const before = { id: 'u1', firstName: 'A', lastName: 'B', role: 'CUSTOMER', isActive: true }

function res(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
const calls = () =>
  vi.mocked(fetch).mock.calls.map(([url, init]) => ({
    path: String(url).replace(/^.*\/api\/v1\/users/, ''),
    method: (init as RequestInit).method,
    body: JSON.parse(String((init as RequestInit).body)),
  }))

describe('applyUserEdit', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(200))
    )
    setAuthBridge({
      getToken: () => 't',
      refresh: async () => null,
      requestMfa: async () => false,
      onSessionExpired: () => {},
      notify: () => {},
    })
  })

  it('sends role and status on their own routes, never in the profile PATCH', async () => {
    const failures = await applyUserEdit(before, {
      firstName: 'A2',
      lastName: 'B',
      role: 'VENDOR',
      isActive: false,
    })
    expect(failures).toEqual([])
    expect(calls()).toEqual([
      { path: '/u1', method: 'PATCH', body: { firstName: 'A2', lastName: 'B' } },
      { path: '/u1/role', method: 'PATCH', body: { role: 'VENDOR' } },
      { path: '/u1/status', method: 'PATCH', body: { isActive: false } },
    ])
  })

  it('sends nothing for unchanged fields, and no role when the control was disabled', async () => {
    await applyUserEdit(before, { firstName: 'A', lastName: 'B', role: undefined, isActive: true })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('surfaces the server message for a refused role change and still applies the rest', async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith('/role')
        ? res(403, {
            code: 'SELF_ROLE_CHANGE',
            message: 'You cannot change your own role',
            requestId: 'r1',
          })
        : res(200)
    )
    const failures = await applyUserEdit(before, {
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      isActive: false,
    })
    expect(failures).toEqual(['role: You cannot change your own role (ref r1)'])
    expect(calls().map((c) => c.path)).toEqual(['/u1/role', '/u1/status'])
  })

  it('setUserStatus rejects with the server message', async () => {
    vi.mocked(fetch).mockResolvedValue(
      res(403, { code: 'SELF_DEACTIVATION', message: 'You cannot deactivate your own account' })
    )
    await expect(setUserStatus('u1', false)).rejects.toThrow(
      'You cannot deactivate your own account'
    )
  })
})
