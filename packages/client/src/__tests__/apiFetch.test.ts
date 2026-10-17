import { apiFetch, createOrder, buildOrderBody, ApiError } from '../lib/api'
import * as browser from '../lib/supabase/browser'
import { onAuthRequired } from '../lib/authEvents'

jest.mock('../lib/supabase/browser')

type Session = { access_token: string; expires_at: number }
const future = () => Math.floor(Date.now() / 1000) + 3600

function mockSupabase(session: Session | null, refreshed: Session | null = null) {
  const auth = {
    getSession: jest.fn().mockResolvedValue({ data: { session } }),
    refreshSession: jest
      .fn()
      .mockResolvedValue(
        refreshed
          ? { data: { session: refreshed }, error: null }
          : { data: { session: null }, error: { message: 'x' } }
      ),
  }
  ;(browser.getBrowserSupabase as jest.Mock).mockReturnValue({ auth })
  return auth
}

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response
}

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

const authHeader = (call: number) =>
  (fetchMock.mock.calls[call][1].headers as Record<string, string>)['Authorization']

describe('apiFetch', () => {
  it('attaches the bearer token', async () => {
    mockSupabase({ access_token: 'tok-1', expires_at: future() })
    fetchMock.mockResolvedValue(res(200, { ok: true }))
    await expect(apiFetch('/api/v1/users/me')).resolves.toEqual({ ok: true })
    expect(authHeader(0)).toBe('Bearer tok-1')
  })

  it('does not attach a token for auth: none', async () => {
    const auth = mockSupabase({ access_token: 'tok-1', expires_at: future() })
    fetchMock.mockResolvedValue(res(200, {}))
    await apiFetch('/api/v1/products', { auth: 'none' })
    expect(authHeader(0)).toBeUndefined()
    expect(auth.getSession).not.toHaveBeenCalled()
  })

  it('refreshes an expired token before sending', async () => {
    const auth = mockSupabase(
      { access_token: 'old', expires_at: Math.floor(Date.now() / 1000) - 10 },
      { access_token: 'new', expires_at: future() }
    )
    fetchMock.mockResolvedValue(res(200, {}))
    await apiFetch('/x')
    expect(auth.refreshSession).toHaveBeenCalledTimes(1)
    expect(authHeader(0)).toBe('Bearer new')
  })

  it('retries once on 401 with the refreshed token', async () => {
    const auth = mockSupabase(
      { access_token: 'old', expires_at: future() },
      { access_token: 'new', expires_at: future() }
    )
    fetchMock
      .mockResolvedValueOnce(res(401, { statusCode: 401, code: 'TOKEN_INVALID', message: 'bad' }))
      .mockResolvedValueOnce(res(200, { done: 1 }))
    await expect(apiFetch('/x')).resolves.toEqual({ done: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(auth.refreshSession).toHaveBeenCalledTimes(1)
    expect(authHeader(1)).toBe('Bearer new')
  })

  it('gives up after one retry, prompts sign-in and throws ApiError', async () => {
    mockSupabase(
      { access_token: 'old', expires_at: future() },
      { access_token: 'new', expires_at: future() }
    )
    fetchMock.mockImplementation(async () =>
      res(401, { statusCode: 401, code: 'TOKEN_INVALID', message: 'bad', requestId: 'r1' })
    )
    const prompt = jest.fn()
    const off = onAuthRequired(prompt)
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 401, code: 'TOKEN_INVALID' })
    off()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('auth: required without a session prompts and never calls the network', async () => {
    mockSupabase(null)
    const prompt = jest.fn()
    const off = onAuthRequired(prompt)
    await expect(apiFetch('/x', { auth: 'required' })).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    })
    off()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prompt).toHaveBeenCalled()
  })

  it('maps the standard error body including fields and requestId', async () => {
    mockSupabase(null)
    fetchMock.mockResolvedValue(
      res(400, {
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
        requestId: 'req-9',
        fields: [{ path: 'items.0.quantity', rule: 'maximum' }],
      })
    )
    const err = (await apiFetch('/x', { method: 'POST', body: {} }).catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.requestId).toBe('req-9')
    expect(err.fields).toEqual([{ path: 'items.0.quantity', rule: 'maximum' }])
  })

  it('reads message and code, not the HTTP reason in error', async () => {
    mockSupabase(null)
    fetchMock.mockResolvedValue(
      res(403, { statusCode: 403, error: 'Forbidden', code: 'MFA_REQUIRED', message: 'Use MFA' })
    )
    const err = (await apiFetch('/x').catch((e) => e)) as ApiError
    expect(err.message).toBe('Use MFA')
    expect(err.code).toBe('MFA_REQUIRED')
  })

  it('falls back to error when message is absent, and to a generic text', async () => {
    mockSupabase(null)
    fetchMock.mockResolvedValueOnce(res(500, { error: 'Internal Server Error' }))
    expect(((await apiFetch('/x').catch((e) => e)) as ApiError).message).toBe(
      'Internal Server Error'
    )
    fetchMock.mockResolvedValueOnce(res(500, {}))
    expect(((await apiFetch('/x').catch((e) => e)) as ApiError).message).toContain('status 500')
  })

  it('surfaces 429 with the retry-after wait time', async () => {
    mockSupabase(null)
    fetchMock.mockResolvedValue(
      res(
        429,
        { statusCode: 429, code: 'RATE_LIMITED', message: 'slow down' },
        { 'retry-after': '12' }
      )
    )
    const err = (await apiFetch('/x').catch((e) => e)) as ApiError
    expect(err.status).toBe(429)
    expect(err.retryAfterSeconds).toBe(12)
  })

  it('falls back to retryAfterSeconds in the body', async () => {
    mockSupabase(null)
    fetchMock.mockResolvedValue(
      res(429, { code: 'RATE_LIMITED', message: 'm', retryAfterSeconds: 7 })
    )
    const err = (await apiFetch('/x').catch((e) => e)) as ApiError
    expect(err.retryAfterSeconds).toBe(7)
  })

  it('reports a network failure as ApiError status 0', async () => {
    mockSupabase(null)
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(apiFetch('/x', { serviceName: 'Order Service' })).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    })
  })
})

describe('createOrder payload', () => {
  const product = { id: 'p1', sku: 'S1', title: 'T', price: 19.999 } as never
  const totals = {
    subtotal: 20.004,
    taxAmount: 1.6003,
    shippingAmount: 0,
    discountAmount: 0,
    totalAmount: 21.6043,
    currency: 'USD',
  }
  const shipping = {
    fullName: 'A',
    email: 'a@b.co',
    addressLine1: '1 St',
    city: 'C',
    state: 'OR',
    postalCode: '97477',
  }

  it('never sends userId, rounds money and bounds quantity', () => {
    const body = buildOrderBody([{ product, quantity: 5000 }], shipping, totals)
    expect(body).not.toHaveProperty('userId')
    expect(body.items[0]).toEqual({
      productId: 'p1',
      sku: 'S1',
      title: 'T',
      unitPrice: 20,
      quantity: 1000,
    })
    expect(body.subtotal).toBe(20)
    expect(body.totalAmount).toBe(21.6)
  })

  it('requires a session', async () => {
    mockSupabase(null)
    await expect(createOrder([{ product, quantity: 1 }], shipping, totals)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    })
  })
})
