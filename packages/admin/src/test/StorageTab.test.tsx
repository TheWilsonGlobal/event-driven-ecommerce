import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import StorageTab from '../screens/StorageTab'
import { setAuthBridge } from '../auth/bridge'

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('StorageTab error states', () => {
  beforeEach(() => {
    setAuthBridge({
      getToken: () => 't',
      refresh: async () => null,
      requestMfa: async () => false,
      onSessionExpired: () => {},
      notify: () => {},
    })
  })

  it('403 FORBIDDEN renders a message, not a crash or "unreachable"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(403, {
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Missing storage:read',
          requestId: 'q7',
        })
      )
    )
    render(<StorageTab />)
    expect(await screen.findByText(/do not have access to storage/i)).toBeInTheDocument()
    expect(screen.getByText(/ref q7/)).toBeInTheDocument()
    expect(screen.queryByText(/Is it running/)).not.toBeInTheDocument()
  })

  it('network failure still says the service is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )
    render(<StorageTab />)
    expect(await screen.findByText(/Is it running/)).toBeInTheDocument()
  })
})
