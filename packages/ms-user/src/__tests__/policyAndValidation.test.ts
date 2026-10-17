import { assertPolicyCoverage, describePolicies } from '@ecommerce/shared-security'
import {
  PERSONAS,
  buildTestServer,
  headersFor,
  testAuth,
  untouchablePrisma,
  type Persona,
} from './helpers'
import type { FastifyInstance } from 'fastify'

/**
 * Authorization and input validation, with NO database: the Prisma stand-in
 * throws if a handler touches it, so every assertion here also proves the request
 * was refused BEFORE reaching business logic.
 */

let server: FastifyInstance

beforeAll(async () => {
  ;({ server } = await buildTestServer(untouchablePrisma()))
})
afterAll(async () => {
  await server.close()
})

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  persona: Persona,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
) {
  const headers: Record<string, string> = { ...(await headersFor(persona)), ...extraHeaders }
  const res = await server.inject({
    method,
    url,
    headers,
    ...(body !== undefined
      ? {
          payload: typeof body === 'string' ? body : JSON.stringify(body),
          headers: { 'content-type': 'application/json', ...headers },
        }
      : {}),
  })
  let json: Record<string, unknown> = {}
  try {
    json = res.json()
  } catch {
    /* non-JSON body */
  }
  return { status: res.statusCode, json, text: res.body }
}

const VALID_CREATE = { email: 'new.person@example.com', firstName: 'New', lastName: 'Person' }

describe('route policy coverage', () => {
  it('every registered route declares a policy (default deny)', () => {
    expect(() => assertPolicyCoverage(server)).not.toThrow()
    const table = describePolicies(server)
    expect(table.length).toBeGreaterThanOrEqual(14)
    // Nothing is public except health, metrics and the three auth routes.
    const publicRoutes = table
      .filter((r) => r.policy?.public)
      .map((r) => `${r.method} ${r.url}`)
      .sort()
    expect(publicRoutes).toEqual(
      [
        'GET /health',
        'GET /metrics',
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/refresh',
        'POST /api/v1/auth/register',
      ].sort()
    )
  })

  it('fails the assertion for a route added without a policy', () => {
    // Prove the check itself bites, not just that it currently passes.
    server.routePolicies.push({ method: 'GET', url: '/api/v1/oops', policy: undefined })
    expect(() => assertPolicyCoverage(server)).toThrow(/GET \/api\/v1\/oops/)
    server.routePolicies.pop()
  })
})

// [method, url, body, expected status per persona that is refused before the handler]
type Row = [string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?]
const ADMIN_MFA_ROUTES: Row[] = [
  ['create user', 'POST', '/api/v1/users', VALID_CREATE],
  ['change role', 'PATCH', '/api/v1/users/p-b/role', { role: 'VENDOR' }],
  ['delete user', 'DELETE', '/api/v1/users/p-b', undefined],
  ['list logs', 'GET', '/api/v1/logs', undefined],
  ['read log', 'GET', '/api/v1/logs/ms-user-error.log', undefined],
  ['schema', 'GET', '/api/v1/schema', undefined],
  ['endpoints', 'GET', '/api/v1/endpoints', undefined],
]
const ADMIN_ROUTES: Row[] = [
  ['list users', 'GET', '/api/v1/users', undefined],
  ['change status', 'PATCH', '/api/v1/users/p-b/status', { isActive: false }],
]
const SELF_ROUTES: Row[] = [
  ['my profile', 'GET', '/api/v1/users/me', undefined],
  ['one profile', 'GET', '/api/v1/users/p-a', undefined],
  ['update profile', 'PATCH', '/api/v1/users/p-a', { firstName: 'X' }],
]

describe('policy matrix (refusals)', () => {
  const all = [...ADMIN_MFA_ROUTES, ...ADMIN_ROUTES, ...SELF_ROUTES]

  it.each(all)('ANON gets 401 on %s', async (_n, method, url, body) => {
    const r = await call(method, url, 'ANON', body)
    expect(r.status).toBe(401)
    expect(r.json.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it.each([...ADMIN_MFA_ROUTES, ...ADMIN_ROUTES])(
    'CUSTOMER and VENDOR get 403 on %s',
    async (_n, method, url, body) => {
      for (const persona of ['CUSTOMER', 'VENDOR'] as const) {
        const r = await call(method, url, persona, body)
        expect(r.status).toBe(403)
        expect(r.json.code).toBe('FORBIDDEN')
      }
    }
  )

  it.each(ADMIN_MFA_ROUTES)(
    'an ADMIN without a second factor gets 403 MFA_REQUIRED on %s',
    async (_n, method, url, body) => {
      const r = await call(method, url, 'ADMIN_AAL1', body)
      expect(r.status).toBe(403)
      expect(r.json.code).toBe('MFA_REQUIRED')
    }
  )

  it('refuses forged, expired and wrong-audience tokens with 401', async () => {
    const ta = await testAuth()
    for (const token of [
      await ta.signForged({ role: 'ADMIN', aal: 'aal2' }),
      await ta.sign({ role: 'ADMIN', aal: 'aal2', expiresInSec: -60 }),
      await ta.sign({ role: 'ADMIN', aal: 'aal2', audience: 'someone-else' }),
      'not.a.jwt',
    ]) {
      const r = await call('GET', '/api/v1/users', 'ANON', undefined, {
        authorization: `Bearer ${token}`,
      })
      expect(r.status).toBe(401)
    }
  })

  it('ignores the Postgres `role` claim: a token without app_role has no admin power', async () => {
    const ta = await testAuth()
    const token = await ta.sign({ role: null, aal: 'aal2', extra: { role: 'service_role' } })
    const r = await call('GET', '/api/v1/users', 'ANON', undefined, {
      authorization: `Bearer ${token}`,
    })
    expect(r.status).toBe(403)
  })
})

describe('public routes', () => {
  it('serves /health and /metrics without a token', async () => {
    for (const persona of PERSONAS) {
      expect((await call('GET', '/health', persona)).status).toBe(200)
    }
    expect((await call('GET', '/metrics', 'ANON')).status).toBe(200)
  })

  it('health never leaks driver error text', async () => {
    const r = await call('GET', '/health', 'ANON')
    expect(Object.keys(r.json).sort()).toEqual(['database', 'service', 'status', 'timestamp'])
  })
})

describe('hostile input is refused at the edge', () => {
  const admin = 'ADMIN_AAL2' as const

  it.each([
    ['unknown field passwordHash', { ...VALID_CREATE, passwordHash: '$2a$10$x' }],
    ['unknown role', { ...VALID_CREATE, role: 'SUPERUSER' }],
    ['lowercase role', { ...VALID_CREATE, role: 'admin' }],
    ['not an email', { ...VALID_CREATE, email: 'not-an-email' }],
    ['300 char email', { ...VALID_CREATE, email: `${'a'.repeat(290)}@example.com` }],
    ['oversize name', { ...VALID_CREATE, firstName: 'a'.repeat(101) }],
    ['empty name', { ...VALID_CREATE, firstName: '' }],
    ['markup in name', { ...VALID_CREATE, firstName: '<script>alert(1)</script>' }],
    ['control char in name', { ...VALID_CREATE, lastName: 'bad\u0000name' }],
    ['number as name', { ...VALID_CREATE, firstName: 42 }],
    ['object as name', { ...VALID_CREATE, firstName: { $ne: null } }],
    ['string as boolean', { ...VALID_CREATE, isActive: 'true' }],
    ['huge address', { ...VALID_CREATE, addressLine1: 'a'.repeat(5000) }],
    ['missing lastName', { email: 'a@example.com', firstName: 'A' }],
    ['array body', [VALID_CREATE]],
    ['null body', 'null'],
    [
      'prototype pollution key',
      `{"email":"a@example.com","firstName":"A","lastName":"B","__proto__":{"role":"ADMIN"}}`,
    ],
    ['constructor key', { ...VALID_CREATE, constructor: { prototype: { role: 'ADMIN' } } }],
  ])('POST /users rejects %s', async (_name, body) => {
    const r = await call('POST', '/api/v1/users', admin, body)
    expect(r.status).toBe(400)
  })

  it.each([
    ['empty object', {}],
    ['role (the old self-promotion hole)', { role: 'ADMIN' }],
    ['isActive', { isActive: true }],
    ['isEmailVerified', { isEmailVerified: true }],
    ['role next to a valid field', { firstName: 'Ok', role: 'ADMIN' }],
    ['authUserId', { authUserId: '00000000-0000-4000-8000-000000000001' }],
    ['oversize name', { firstName: 'a'.repeat(101) }],
    ['bad phone', { phoneNumber: 'call me maybe' }],
    ['phone as number', { phoneNumber: 5551234567 }],
  ])('PATCH /users/:id rejects %s', async (_name, body) => {
    // Even an ADMIN cannot smuggle these through the profile route.
    const r = await call('PATCH', '/api/v1/users/p-a', admin, body)
    expect(r.status).toBe(400)
  })

  it.each([
    [{ role: 'ROOT' }],
    [{ role: 'ADMIN', extra: 1 }],
    [{}],
    [{ role: ['ADMIN'] }],
    [{ role: null }],
  ])('PATCH /users/:id/role rejects %j', async (body) => {
    expect((await call('PATCH', '/api/v1/users/p-a/role', admin, body)).status).toBe(400)
  })

  it.each([[{ isActive: 'yes' }], [{}], [{ isActive: true, role: 'ADMIN' }]])(
    'PATCH /users/:id/status rejects %j',
    async (body) => {
      expect((await call('PATCH', '/api/v1/users/p-a/status', admin, body)).status).toBe(400)
    }
  )

  it.each([
    ['limit=0'],
    ['limit=1000'],
    ['limit=-5'],
    ['page=0'],
    ['page=abc'],
    ['limit=NaN'],
    ['limit=Infinity'],
    ['limit=10;DROP%20TABLE%20users'],
    ['limit=1.5'],
    ['unknown=1'],
  ])('GET /users?%s is rejected', async (qs) => {
    expect((await call('GET', `/api/v1/users?${qs}`, admin)).status).toBe(400)
  })

  it.each([["x'%3B%20DROP%20TABLE%20users%3B--"], ['a'.repeat(65)], ['..%2F..%2Fetc'], ['%00']])(
    'rejects the id %s',
    async (id) => {
      expect((await call('GET', `/api/v1/users/${id}`, admin)).status).toBe(400)
      expect((await call('DELETE', `/api/v1/users/${id}`, admin)).status).toBe(400)
    }
  )

  it.each([
    [
      'register: 9 char password',
      '/api/v1/auth/register',
      { email: 'a@example.com', password: 'x'.repeat(9), firstName: 'A', lastName: 'B' },
    ],
    [
      'register: 129 char password',
      '/api/v1/auth/register',
      { email: 'a@example.com', password: 'x'.repeat(129), firstName: 'A', lastName: 'B' },
    ],
    [
      'register: bad email',
      '/api/v1/auth/register',
      { email: 'nope', password: 'x'.repeat(12), firstName: 'A', lastName: 'B' },
    ],
    [
      'register: extra role field',
      '/api/v1/auth/register',
      {
        email: 'a@example.com',
        password: 'x'.repeat(12),
        firstName: 'A',
        lastName: 'B',
        role: 'ADMIN',
      },
    ],
    [
      'register: missing names',
      '/api/v1/auth/register',
      { email: 'a@example.com', password: 'x'.repeat(12) },
    ],
    [
      'register: password as number',
      '/api/v1/auth/register',
      { email: 'a@example.com', password: 1234567890, firstName: 'A', lastName: 'B' },
    ],
    ['login: missing password', '/api/v1/auth/login', { email: 'a@example.com' }],
    ['login: email as array', '/api/v1/auth/login', { email: ['a@example.com'], password: 'x' }],
    [
      'login: oversize password',
      '/api/v1/auth/login',
      { email: 'a@example.com', password: 'x'.repeat(129) },
    ],
    [
      'login: extra field',
      '/api/v1/auth/login',
      { email: 'a@example.com', password: 'x', admin: true },
    ],
    ['refresh: missing token', '/api/v1/auth/refresh', {}],
    ['refresh: oversize token', '/api/v1/auth/refresh', { refresh_token: 'x'.repeat(1025) }],
  ])('%s is a 400 for an anonymous caller', async (_n, url, body) => {
    const r = await call('POST', url, 'ANON', body)
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('VALIDATION_FAILED')
    // The error names the rule, never the value.
    expect(r.text).not.toContain('x'.repeat(20))
  })

  it('rejects non-JSON content types with 415', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'email=a@example.com',
    })
    expect(res.statusCode).toBe(415)
  })

  it('rejects a body over the 100 KB limit with 413', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(200 * 1024) }),
    })
    expect(res.statusCode).toBe(413)
  })

  it('answers an unauthenticated hostile body with 401, not a 400 that maps the schema', async () => {
    const r = await call('POST', '/api/v1/users', 'ANON', { totally: 'wrong' })
    expect(r.status).toBe(401)
  })
})
