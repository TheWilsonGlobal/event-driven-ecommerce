import * as http from 'http'
import type { AddressInfo } from 'net'
import type { FastifyInstance } from 'fastify'
import {
  MemoryRateStore,
  assertPolicyCoverage,
  createTestAuth,
  type TestAuth,
} from '@ecommerce/shared-security'
import { buildGateway } from '../app'
import { hasTraversal, isIdentityHeader, resolveCorsOrigins, redisFromEnv } from '../security'

/**
 * The gateway is built with the same buildGateway() index.ts uses. Upstreams are a
 * local stub on an ephemeral port that records what it was sent, tokens are real
 * ES256 JWTs verified against a local key set, and the rate-limit store is in
 * memory: nothing here touches the network beyond 127.0.0.1.
 */

interface Seen {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  bytes: number
}

let ta: TestAuth
let stub: http.Server
let stubUrl: string
const seen: Seen[] = []

beforeAll(async () => {
  ta = await createTestAuth()
  stub = http.createServer((req, res) => {
    let bytes = 0
    req.on('data', (c: Buffer) => (bytes += c.length))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, bytes })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r))
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()))
})

beforeEach(() => {
  seen.length = 0
})

const ORIGINS = ['http://localhost:5461', 'http://localhost:5462']

const roomyLimits = {
  ipPerMin: 100_000,
  authIpPerMin: 100_000,
  authEmailPerMin: 100_000,
  userReadPerMin: 100_000,
  userWritePerMin: 100_000,
  expensivePerMin: 100_000,
  adminPerMin: 100_000,
}

const open: FastifyInstance[] = []

async function build(limits: Partial<typeof roomyLimits> = {}): Promise<FastifyInstance> {
  const { server } = await buildGateway({
    logger: false,
    port: 5460,
    upstreams: {
      user: stubUrl,
      product: stubUrl,
      order: stubUrl,
      inventory: stubUrl,
      analytics: stubUrl,
    },
    admin: stubUrl,
    client: stubUrl,
    rustfs: stubUrl,
    corsOrigins: ORIGINS,
    security: {
      overrides: {
        jwks: ta.jwks,
        store: new MemoryRateStore(),
        config: {
          authMode: 'enforce',
          rateLimitMode: 'enforce',
          issuer: ta.issuer,
          audience: ta.audience,
          production: false,
          limits: { ...roomyLimits, ...limits },
        },
      },
    },
    env: {},
  })
  await server.ready()
  open.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()))
})

const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

async function tokens() {
  return {
    ANON: undefined,
    CUSTOMER: await ta.sign({ sub: 'c1', role: 'CUSTOMER' }),
    VENDOR: await ta.sign({ sub: 'v1', role: 'VENDOR' }),
    ADMIN_AAL1: await ta.sign({ sub: 'a1', role: 'ADMIN', aal: 'aal1' }),
    ADMIN_AAL2: await ta.sign({ sub: 'a1', role: 'ADMIN', aal: 'aal2' }),
  }
}

// Expected status for [ANON, CUSTOMER, VENDOR, ADMIN aal1, ADMIN aal2].
type Row = [string, string, number, number, number, number, number]
const MATRIX: Row[] = [
  // gateway-native
  ['GET', '/health', 200, 200, 200, 200, 200],
  ['GET', '/metrics', 200, 200, 200, 200, 200],
  ['GET', '/api/v1/services', 401, 403, 403, 403, 200],
  ['GET', '/api/v1/topology', 401, 403, 403, 403, 200],
  ['GET', '/api/v1/logs', 401, 403, 403, 403, 200],
  ['GET', '/api/v1/endpoints', 401, 403, 403, 403, 200],
  ['GET', '/api-docs/json', 200, 200, 200, 200, 200],
  // catalogue: public reads, role-gated writes
  ['GET', '/api/v1/products', 200, 200, 200, 200, 200],
  ['GET', '/api/v1/products/prod-1', 200, 200, 200, 200, 200],
  ['GET', '/api/v1/categories', 200, 200, 200, 200, 200],
  ['POST', '/api/v1/products', 401, 403, 200, 200, 200],
  ['PATCH', '/api/v1/products/prod-1', 401, 403, 200, 200, 200],
  ['DELETE', '/api/v1/products/prod-1', 401, 403, 200, 200, 200],
  ['POST', '/api/v1/products/upload', 401, 403, 200, 200, 200],
  ['POST', '/api/v1/categories', 401, 403, 403, 200, 200],
  // authenticated only
  ['GET', '/api/v1/orders', 401, 200, 200, 200, 200],
  ['POST', '/api/v1/orders', 401, 200, 200, 200, 200],
  ['GET', '/api/v1/cart', 401, 200, 200, 200, 200],
  ['POST', '/api/v1/payments/o1/capture', 401, 200, 200, 200, 200],
  ['GET', '/api/v1/users/u1', 401, 200, 200, 200, 200],
  ['PATCH', '/api/v1/users/u1', 401, 200, 200, 200, 200],
  // back-office reads
  ['GET', '/api/v1/inventory', 401, 403, 200, 200, 200],
  ['GET', '/api/v1/reservations', 401, 403, 200, 200, 200],
  ['GET', '/api/v1/analytics/summary', 401, 403, 200, 200, 200],
  // login/register are public at the gateway; ms-user is authoritative
  ['POST', '/api/v1/auth/login', 200, 200, 200, 200, 200],
  ['POST', '/api/v1/auth/register', 200, 200, 200, 200, 200],
  // operator prefixes are not proxied at all
  ['GET', '/api/v1/queues', 404, 404, 404, 404, 404],
  ['GET', '/api/v1/schema', 404, 404, 404, 404, 404],
  ['PATCH', '/api/v1/events/config', 404, 404, 404, 404, 404],
]

describe('gateway policy matrix', () => {
  it.each(MATRIX)('%s %s', async (method, url, ...expected) => {
    const server = await build()
    const t = await tokens()
    const order = ['ANON', 'CUSTOMER', 'VENDOR', 'ADMIN_AAL1', 'ADMIN_AAL2'] as const
    const got: number[] = []
    for (const who of order) {
      const token = t[who]
      const res = await server.inject({
        method: method as 'GET',
        url,
        headers: token ? bearer(token) : {},
        ...(method === 'GET' ? {} : { payload: '{}' }),
      })
      got.push(res.statusCode)
    }
    expect(got).toEqual(expected)
  })

  it('answers an admin without a second factor with MFA_REQUIRED so the client can prompt', async () => {
    const server = await build()
    const res = await server.inject({
      url: '/api/v1/logs',
      headers: bearer(await ta.sign({ role: 'ADMIN', aal: 'aal1' })),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('MFA_REQUIRED')
  })

  it('rejects a forged or expired token with 401 even on a public-read prefix + write', async () => {
    const server = await build()
    const forged = await ta.signForged({ role: 'ADMIN', aal: 'aal2' })
    const expired = await ta.sign({ role: 'ADMIN', expiresInSec: -60 })
    for (const token of [forged, expired]) {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: bearer(token),
        payload: '{}',
      })
      expect(res.statusCode).toBe(401)
    }
    expect(seen).toHaveLength(0) // never reached the upstream
  })

  it('every registered route has a policy (default deny holds)', async () => {
    const server = await build()
    expect(() => assertPolicyCoverage(server)).not.toThrow()
    expect(server.routePolicies.length).toBeGreaterThan(20)
  })

  it('does not let a path-traversal URL reach an operator route through an authorised prefix', async () => {
    // Sent over a real socket: light-my-request would normalise `..` away before
    // the gateway ever saw it, which is not what an attacker's client does.
    const server = await build()
    await server.listen({ port: 0, host: '127.0.0.1' })
    const port = (server.server.address() as AddressInfo).port
    const token = await ta.sign({ role: 'CUSTOMER' })
    const rawGet = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port, path, headers: bearer(token) }, (res) => {
            let body = ''
            res.on('data', (c: Buffer) => (body += c.toString()))
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
          })
          .on('error', reject)
      })
    for (const path of [
      '/api/v1/orders/../queues',
      '/api/v1/orders/%2e%2e/queues',
      '/api/v1/orders/%2E%2E%2Fqueues',
      '/api/v1/orders/..%5Cqueues',
    ]) {
      const res = await rawGet(path)
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body).code).toBe('INVALID_PATH')
    }
    expect(seen).toHaveLength(0)
    expect((await rawGet('/api/v1/orders/o1')).status).toBe(200) // a normal path still goes through
  })
})

describe('identity header stripping', () => {
  it('never forwards client-supplied identity headers, but forwards Authorization unchanged', async () => {
    const server = await build()
    const token = await ta.sign({ sub: 'c1', role: 'CUSTOMER' })
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: {
        authorization: `Bearer ${token}`,
        'x-user-id': 'someone-else',
        'x-user-role': 'ADMIN',
        'x-user-email': 'admin@example.com',
        'X-Service-Token': 'forged',
        'x-auth-role': 'ADMIN',
        'x-internal-call': '1',
        'x-role': 'ADMIN',
        'x-request-source': 'storefront',
        'content-type': 'application/json',
      },
      payload: '{"a":1}',
    })
    expect(res.statusCode).toBe(200)
    expect(seen).toHaveLength(1)
    const h = seen[0]!.headers
    expect(h['authorization']).toBe(`Bearer ${token}`)
    expect(h['x-request-source']).toBe('storefront') // ordinary headers pass
    expect(Object.keys(h).filter((k) => isIdentityHeader(k))).toEqual([])
    for (const forbidden of [
      'x-user-id',
      'x-user-role',
      'x-user-email',
      'x-service-token',
      'x-role',
    ]) {
      expect(h[forbidden]).toBeUndefined()
    }
    expect(seen[0]!.bytes).toBe(7) // and the body still arrives intact
  })

  it('strips them on public routes too (an anonymous GET cannot smuggle a role)', async () => {
    const server = await build()
    await server.inject({
      url: '/api/v1/products',
      headers: { 'x-user-role': 'ADMIN', 'x-user-id': 'root' },
    })
    expect(seen[0]!.headers['x-user-role']).toBeUndefined()
    expect(seen[0]!.headers['x-user-id']).toBeUndefined()
  })

  it('classifies header names by prefix, case-insensitively', () => {
    for (const n of ['x-user-id', 'X-User-Role', 'x-userid', 'x-service-token', 'x-auth-user']) {
      expect(isIdentityHeader(n)).toBe(true)
    }
    for (const n of ['authorization', 'x-request-id', 'content-type', 'x-forwarded-for']) {
      expect(isIdentityHeader(n)).toBe(false)
    }
  })
})

describe('correlation propagation', () => {
  const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
  const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`

  it('forwards a valid x-correlation-id and traceparent and echoes the id', async () => {
    const server = await build()
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: { 'x-correlation-id': 'trace-test-1', traceparent: TRACEPARENT },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-correlation-id']).toBe('trace-test-1')
    expect(seen[0]!.headers['x-correlation-id']).toBe('trace-test-1')
    expect(seen[0]!.headers['traceparent']).toBe(TRACEPARENT)
  })

  it('derives the id from traceparent alone', async () => {
    const server = await build()
    await server.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: { traceparent: TRACEPARENT },
    })
    expect(seen[0]!.headers['x-correlation-id']).toBe(TRACE_ID)
  })

  it('replaces a malformed id and drops a malformed traceparent instead of forwarding them', async () => {
    const server = await build()
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: { 'x-correlation-id': 'bad id; drop', traceparent: 'not-a-traceparent' },
    })
    const forwarded = seen[0]!.headers['x-correlation-id']
    expect(forwarded).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.headers['x-correlation-id']).toBe(forwarded)
    expect(seen[0]!.headers['traceparent']).toBeUndefined()
  })

  it('generates and forwards an id when the caller sent none', async () => {
    const server = await build()
    await server.inject({ method: 'GET', url: '/api/v1/products' })
    expect(seen[0]!.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('exposes x-correlation-id to browsers via CORS', async () => {
    const server = await build()
    const res = await server.inject({ url: '/health', headers: { origin: ORIGINS[0]! } })
    expect(String(res.headers['access-control-expose-headers']).toLowerCase()).toContain(
      'x-correlation-id'
    )
  })
})

describe('CORS allow-list', () => {
  it('echoes an allowed origin and allows credentials', async () => {
    const server = await build()
    const res = await server.inject({ url: '/health', headers: { origin: ORIGINS[0]! } })
    expect(res.headers['access-control-allow-origin']).toBe(ORIGINS[0])
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('sends no CORS headers to a disallowed origin', async () => {
    const server = await build()
    const res = await server.inject({ url: '/health', headers: { origin: 'https://evil.example' } })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('answers a preflight from an allowed origin and refuses one from a disallowed origin', async () => {
    const server = await build()
    const preflight = (origin: string) =>
      server.inject({
        method: 'OPTIONS',
        url: '/api/v1/products',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      })
    const ok = await preflight(ORIGINS[1]!)
    expect(ok.statusCode).toBe(204)
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGINS[1])
    const bad = await preflight('https://evil.example')
    expect(bad.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('error responses carry CORS headers too (a browser can read the 401)', async () => {
    const server = await build()
    const res = await server.inject({ url: '/api/v1/orders', headers: { origin: ORIGINS[0]! } })
    expect(res.statusCode).toBe(401)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGINS[0])
  })

  it('resolveCorsOrigins: env list, dev fallback, and a wildcard is never honoured', () => {
    expect(resolveCorsOrigins({ CORS_ORIGINS: 'https://a.example, https://b.example' })).toEqual([
      'https://a.example',
      'https://b.example',
    ])
    expect(resolveCorsOrigins({})).toEqual(['http://localhost:5461', 'http://localhost:5462'])
    expect(resolveCorsOrigins({ CORS_ORIGINS: '*' })).toEqual([
      'http://localhost:5461',
      'http://localhost:5462',
    ])
  })
})

describe('Content-Security-Policy', () => {
  it('sets a load-nothing CSP on API responses', async () => {
    const server = await build()
    const csp = String((await server.inject('/health')).headers['content-security-policy'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).not.toContain('upgrade-insecure-requests')
  })

  it('also sets it on error responses', async () => {
    const server = await build()
    const res = await server.inject('/api/v1/orders')
    expect(res.statusCode).toBe(401)
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'")
  })

  it('lets the Swagger UI load: its static page carries its own policy, not the load-nothing one', async () => {
    const server = await build()
    const res = await server.inject('/api-docs/static/index.html')
    expect(res.statusCode).toBe(200)
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("style-src 'self'")
    expect(csp).not.toContain("default-src 'none'")
    expect(csp).not.toContain('upgrade-insecure-requests')
    const redirect = await server.inject('/api-docs')
    expect([301, 302]).toContain(redirect.statusCode)
  })

  it('keeps the other helmet headers', async () => {
    const server = await build()
    const h = (await server.inject('/health')).headers
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['strict-transport-security']).toBeDefined()
  })
})

describe('rate limiting (Redis-backed limiter replaces the in-memory 100/min)', () => {
  it('429 with Retry-After and the standard error body once the per-IP bucket is exhausted', async () => {
    const server = await build({ ipPerMin: 3 })
    for (let i = 0; i < 3; i++) {
      expect((await server.inject('/api/v1/products')).statusCode).toBe(200)
    }
    const res = await server.inject('/api/v1/products')
    expect(res.statusCode).toBe(429)
    expect(res.headers['retry-after']).toBeDefined()
    expect(res.json()).toMatchObject({ code: 'RATE_LIMITED', statusCode: 429 })
  })

  it('/health is never limited', async () => {
    const server = await build({ ipPerMin: 1 })
    for (let i = 0; i < 5; i++) expect((await server.inject('/health')).statusCode).toBe(200)
  })

  it('proxied writes use the stricter write tier, reads the read tier', async () => {
    const server = await build({ userWritePerMin: 2, userReadPerMin: 100 })
    const headers = bearer(await ta.sign({ role: 'CUSTOMER' }))
    const post = () =>
      server.inject({ method: 'POST', url: '/api/v1/orders', headers, payload: '{}' })
    expect((await post()).statusCode).toBe(200)
    expect((await post()).statusCode).toBe(200)
    expect((await post()).statusCode).toBe(429)
    expect((await server.inject({ url: '/api/v1/orders', headers })).statusCode).toBe(200)
  })

  it('the auth prefix gets the strict auth tier on writes', async () => {
    const server = await build({ authIpPerMin: 2 })
    const login = () => server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: '{}' })
    expect((await login()).statusCode).toBe(200)
    expect((await login()).statusCode).toBe(200)
    expect((await login()).statusCode).toBe(429)
  })

  it('uploads use the expensive tier', async () => {
    const server = await build({ expensivePerMin: 1 })
    const headers = bearer(await ta.sign({ role: 'VENDOR' }))
    const up = () =>
      server.inject({ method: 'POST', url: '/api/v1/products/upload', headers, payload: 'x' })
    expect((await up()).statusCode).toBe(200)
    expect((await up()).statusCode).toBe(429)
  })
})

describe('proxied body size', () => {
  const big = 'x'.repeat(200 * 1024)

  it('rejects a JSON body over 100 KB with 413 before it reaches the upstream', async () => {
    const server = await build()
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: {
        ...bearer(await ta.sign({ role: 'CUSTOMER' })),
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ pad: big }),
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().code).toBe('PAYLOAD_TOO_LARGE')
    expect(seen).toHaveLength(0)
  })

  it('allows the larger cap on the upload route only', async () => {
    const server = await build()
    const headers = bearer(await ta.sign({ role: 'VENDOR' }))
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/products/upload',
      headers,
      payload: big,
    })
    expect(res.statusCode).toBe(200)
    expect(seen[0]!.bytes).toBe(big.length)
  })

  it('refuses a chunked body (no length to check) with 411', async () => {
    const server = await build()
    await server.listen({ port: 0, host: '127.0.0.1' })
    const port = (server.server.address() as AddressInfo).port
    const token = await ta.sign({ role: 'CUSTOMER' })
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/v1/orders',
          headers: { authorization: `Bearer ${token}`, 'transfer-encoding': 'chunked' },
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', reject)
      req.write('{"a":')
      req.end('1}')
    })
    expect(status).toBe(411)
  })
})

describe('helpers', () => {
  it('hasTraversal flags dot segments and encoded separators only', () => {
    expect(hasTraversal('/api/v1/orders/../queues')).toBe(true)
    expect(hasTraversal('/api/v1/orders/%2e%2e/queues')).toBe(true)
    expect(hasTraversal('/api/v1/orders/a%2Fb')).toBe(true)
    expect(hasTraversal('/api/v1/orders/%E0%A4%A')).toBe(true) // malformed encoding
    expect(hasTraversal('/api/v1/products/prod-1?x=../y')).toBe(false)
    expect(hasTraversal('/api/v1/products/my..product')).toBe(false)
  })

  it('redisFromEnv follows KV_CACHE_DRIVER, defaulting to redis unless DB_MODE=embedded', () => {
    expect(redisFromEnv({ KV_CACHE_DRIVER: 'redis', REDIS_PORT: '6400' })).toMatchObject({
      port: 6400,
    })
    expect(redisFromEnv({ KV_CACHE_DRIVER: 'embedded' })).toBeNull()
    expect(redisFromEnv({ DB_MODE: 'embedded' })).toBeNull()
    expect(redisFromEnv({})).not.toBeNull()
  })
})
