import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('StorageTab download', () => {
  const listBody = {
    objects: [{ key: 'img/a b.png', sizeBytes: 2048, lastModified: '2026-01-01T00:00:00Z' }],
  }

  beforeEach(() => {
    setAuthBridge({
      getToken: () => 'tok',
      refresh: async () => null,
      requestMfa: async () => false,
      onSessionExpired: () => {},
      notify: () => {},
    })
  })

  it('fetches the JSON url with the bearer token and opens it via a hidden anchor click', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/storage/download')
        ? res(200, { url: 'https://s3.example/signed?x=1', expiresIn: 60 })
        : res(200, listBody)
    )
    vi.stubGlobal('fetch', fetchMock)
    const clicked: HTMLAnchorElement[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this)
    })
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(<StorageTab />)
    await userEvent.click(await screen.findByRole('button', { name: /Download img\/a b\.png/ }))
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1))
    expect(clicked[0].href).toBe('https://s3.example/signed?x=1')
    expect(clicked[0].target).toBe('_blank')
    expect(clicked[0].rel).toBe('noopener noreferrer')
    expect(open).not.toHaveBeenCalled()
    expect(clicked[0].isConnected).toBe(false)
    clickSpy.mockRestore()
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/storage/download'))!
    expect(String(call[0])).toContain('key=img%2Fa%20b.png&format=json')
    const init = (call as unknown as [string, RequestInit])[1]
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok')
  })

  it('shows the error (toast + inline) and does not open on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/storage/download')
          ? res(404, {
              statusCode: 404,
              code: 'NOT_FOUND',
              message: 'No such object',
              requestId: 'r9',
            })
          : res(200, listBody)
      )
    )
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const onNotify = vi.fn()
    render(<StorageTab onNotify={onNotify} />)
    await userEvent.click(await screen.findByRole('button', { name: /Download img/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No such object \(ref r9\)/)
    expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('No such object'))
    expect(clickSpy).not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})
