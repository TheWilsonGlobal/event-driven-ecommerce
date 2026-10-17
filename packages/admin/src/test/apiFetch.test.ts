import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch, apiFetchJson, ApiError } from '../data/apiFetch'
import { setAuthBridge, type AuthBridge } from '../auth/bridge'
import {
  USER_SERVICE_URL,
  GATEWAY_URL,
  LOKI_HOST,
  ELASTICSEARCH_HOST,
  PROMETHEUS_URL,
  GRAFANA_URL,
  RUSTFS_ENDPOINT,
  CLIENT_URL,
  ADMIN_URL,
} from '../data/serviceUrls'

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function authHeader(call: unknown[]): string | null {
  const init = call[1] as RequestInit | undefined
  return new Headers(init?.headers).get('Authorization')
}

describe('apiFetch', () => {
  let bridge: AuthBridge
  let token: string | null
  const fetchMock = vi.fn()

  beforeEach(() => {
    token = 'tok-1'
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    bridge = {
      getToken: () => token,
      refresh: vi.fn(async () => {
        token = 'tok-2'
        return 'tok-2'
      }),
      requestMfa: vi.fn(async () => true),
      onSessionExpired: vi.fn(),
      notify: vi.fn(),
    }
    setAuthBridge(bridge)
  })
  afterEach(() => setAuthBridge(null))

  it('attaches the bearer token to service origins', async () => {
    fetchMock.mockResolvedValue(json(200, {}))
    await apiFetch(`${USER_SERVICE_URL}/api/v1/users`)
    await apiFetch(`${GATEWAY_URL}/api/v1/services`)
    expect(authHeader(fetchMock.mock.calls[0])).toBe('Bearer tok-1')
    expect(authHeader(fetchMock.mock.calls[1])).toBe('Bearer tok-1')
  })

  it('NEVER attaches the token to infra or third-party hosts', async () => {
    fetchMock.mockResolvedValue(json(200, {}))
    const hosts = [
      `${LOKI_HOST}/ready`,
      `${ELASTICSEARCH_HOST}/_cluster/health`,
      `${PROMETHEUS_URL}/-/healthy`,
      `${GRAFANA_URL}/api/health`,
      `${RUSTFS_ENDPOINT}/bucket`,
      CLIENT_URL,
      ADMIN_URL,
      'https://evil.example.com/steal',
      // look-alikes: same host as a service but another port / a suffixed host
      `${USER_SERVICE_URL.replace(/:\d+$/, ':1')}/api/v1/users`,
      `${USER_SERVICE_URL}.evil.example.com/x`,
    ]
    for (const url of hosts) await apiFetch(url)
    expect(fetchMock).toHaveBeenCalledTimes(hosts.length)
    for (const call of fetchMock.mock.calls) expect(authHeader(call)).toBeNull()
  })

  it('does not refresh or sign out on a 401 from a non-service host', async () => {
    fetchMock.mockResolvedValue(json(401, {}))
    await apiFetch(`${GRAFANA_URL}/api/health`)
    expect(bridge.refresh).not.toHaveBeenCalled()
    expect(bridge.onSessionExpired).not.toHaveBeenCalled()
  })

  it('401: refreshes once and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'TOKEN_INVALID' }))
      .mockResolvedValueOnce(json(200, { ok: true }))
    const res = await apiFetch(`${USER_SERVICE_URL}/api/v1/users`)
    expect(res.status).toBe(200)
    expect(bridge.refresh).toHaveBeenCalledTimes(1)
    expect(authHeader(fetchMock.mock.calls[1])).toBe('Bearer tok-2')
    expect(bridge.onSessionExpired).not.toHaveBeenCalled()
  })

  it('401 twice: refreshes only once, then returns to sign-in', async () => {
    fetchMock.mockResolvedValue(json(401, { code: 'AUTHENTICATION_REQUIRED' }))
    const res = await apiFetch(`${USER_SERVICE_URL}/api/v1/users`)
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bridge.refresh).toHaveBeenCalledTimes(1)
    expect(bridge.onSessionExpired).toHaveBeenCalledTimes(1)
  })

  it('401 with a failed refresh: signs out without retrying', async () => {
    bridge.refresh = vi.fn(async () => null)
    fetchMock.mockResolvedValue(json(401, {}))
    await apiFetch(`${USER_SERVICE_URL}/api/v1/users`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bridge.onSessionExpired).toHaveBeenCalledTimes(1)
  })

  it('403 MFA_REQUIRED: runs the MFA flow, then retries once with the new token', async () => {
    bridge.requestMfa = vi.fn(async () => {
      token = 'tok-aal2'
      return true
    })
    fetchMock
      .mockResolvedValueOnce(json(403, { code: 'MFA_REQUIRED' }))
      .mockResolvedValueOnce(json(200, { ok: true }))
    const res = await apiFetch(`${USER_SERVICE_URL}/api/v1/events/config`, { method: 'PATCH' })
    expect(res.status).toBe(200)
    expect(bridge.requestMfa).toHaveBeenCalledTimes(1)
    expect(authHeader(fetchMock.mock.calls[1])).toBe('Bearer tok-aal2')
  })

  it('403 MFA_REQUIRED cancelled: no retry', async () => {
    bridge.requestMfa = vi.fn(async () => false)
    fetchMock.mockResolvedValue(json(403, { code: 'MFA_REQUIRED' }))
    const res = await apiFetch(`${USER_SERVICE_URL}/api/v1/events/config`)
    expect(res.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('403 FORBIDDEN does not open MFA', async () => {
    fetchMock.mockResolvedValue(json(403, { code: 'FORBIDDEN', message: 'nope' }))
    await apiFetch(`${USER_SERVICE_URL}/api/v1/users`)
    expect(bridge.requestMfa).not.toHaveBeenCalled()
  })

  it('429: notifies with the retry time and maps to ApiError', async () => {
    fetchMock.mockResolvedValue(
      json(
        429,
        { statusCode: 429, code: 'RATE_LIMITED', message: 'slow down', requestId: 'r1' },
        { 'Retry-After': '17' }
      )
    )
    await expect(apiFetchJson(`${USER_SERVICE_URL}/api/v1/users`)).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 17,
      requestId: 'r1',
    })
    expect(bridge.notify).toHaveBeenCalledWith(expect.stringContaining('17s'))
  })

  it('503 RATE_LIMIT_UNAVAILABLE is surfaced as a notice', async () => {
    fetchMock.mockResolvedValue(json(503, { code: 'RATE_LIMIT_UNAVAILABLE' }))
    await apiFetch(`${USER_SERVICE_URL}/api/v1/users`)
    expect(bridge.notify).toHaveBeenCalled()
  })

  it('400 VALIDATION_FAILED exposes fields in the error and message', async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
        fields: [{ path: 'body.email', rule: 'format' }],
      })
    )
    const err = await apiFetchJson(`${USER_SERVICE_URL}/api/v1/users`, { method: 'POST' }).catch(
      (e) => e as ApiError
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).fields).toEqual([{ path: 'body.email', rule: 'format' }])
    expect((err as ApiError).message).toContain('body.email: format')
  })

  it('sends no Authorization header while signed out (report mode)', async () => {
    token = null
    fetchMock.mockResolvedValue(json(200, {}))
    await apiFetch(`${USER_SERVICE_URL}/health`)
    expect(authHeader(fetchMock.mock.calls[0])).toBeNull()
  })
})
