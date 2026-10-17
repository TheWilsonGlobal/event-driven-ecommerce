import fastify, { type FastifyInstance } from 'fastify'
import { SignJWT, generateKeyPair } from 'jose'
import {
  AuthFailure,
  MemoryRateStore,
  Money,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  Strict,
  TokenVerifier,
  Type,
  assertPolicyCoverage,
  createTestAuth,
  decide,
  loadSecurityConfig,
  registerSecurity,
  requireOwnerOrAny,
  roleFromClaims,
  securityServerOptions,
  signServiceToken,
  type RateStore,
  type RoutePolicy,
  type TestAuth,
} from '..'

let ta: TestAuth

beforeAll(async () => {
  ta = await createTestAuth()
})

const limits = {
  ipPerMin: 1000,
  authIpPerMin: 3,
  authEmailPerMin: 2,
  userReadPerMin: 1000,
  userWritePerMin: 1000,
  expensivePerMin: 1000,
  adminPerMin: 1000,
}

async function build(
  over: {
    auth?: 'report' | 'enforce'
    rate?: 'report' | 'enforce'
    store?: RateStore
    limits?: Partial<typeof limits>
    routes?: (s: FastifyInstance) => void
    serviceSecret?: string
  } = {}
): Promise<FastifyInstance> {
  const server = fastify({ ...securityServerOptions({}), logger: false })
  await registerSecurity(server, {
    service: 'test',
    overrides: {
      jwks: ta.jwks,
      store: over.store ?? new MemoryRateStore(),
      config: {
        authMode: over.auth ?? 'enforce',
        rateLimitMode: over.rate ?? 'enforce',
        issuer: ta.issuer,
        audience: ta.audience,
        serviceAuthSecret: over.serviceSecret ?? null,
        limits: { ...limits, ...(over.limits ?? {}) },
      },
    },
  })
  over.routes?.(server)
  await server.ready()
  return server
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

describe('TokenVerifier', () => {
  const v = () => new TokenVerifier({ issuer: ta.issuer, audience: ta.audience, jwks: ta.jwks })
  const code = async (p: Promise<unknown>) => {
    try {
      await p
      return 'ok'
    } catch (e) {
      return e instanceof AuthFailure ? e.code : `other:${String(e)}`
    }
  }

  it('accepts a valid token and reads the business role from app_role', async () => {
    const id = await v().verify(
      await ta.sign({ sub: 'u1', role: 'VENDOR', email: 'a@b.co', aal: 'aal2' })
    )
    expect(id).toMatchObject({
      userId: 'u1',
      role: 'VENDOR',
      aal: 'aal2',
      kind: 'user',
      email: 'a@b.co',
    })
  })

  it('ignores the Postgres `role: authenticated` claim and defaults to CUSTOMER', async () => {
    const id = await v().verify(await ta.sign({ role: null }))
    expect(id.role).toBe('CUSTOMER')
  })

  it('does not let a token grant itself ADMIN through the standard role claim', async () => {
    const id = await v().verify(await ta.sign({ role: null, extra: { role: 'ADMIN' } }))
    expect(id.role).toBe('CUSTOMER')
  })

  it('rejects an expired token', async () => {
    expect(await code(v().verify(await ta.sign({ expiresInSec: -60 })))).toBe('token_expired')
  })

  it('rejects the wrong issuer and the wrong audience', async () => {
    expect(await code(v().verify(await ta.sign({ issuer: 'https://evil.example/auth/v1' })))).toBe(
      'token_claims_invalid'
    )
    expect(await code(v().verify(await ta.sign({ audience: 'anon' })))).toBe('token_claims_invalid')
  })

  it('rejects a token signed by a different key (forgery)', async () => {
    expect(await code(v().verify(await ta.signForged()))).toBe('token_signature_invalid')
  })

  it('rejects an HS256 token that claims the Supabase issuer (algorithm confusion)', async () => {
    const t = await new SignJWT({ app_role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ta.issuer)
      .setAudience(ta.audience)
      .setSubject('attacker')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('any-secret-the-attacker-picks'))
    expect(await code(v().verify(t))).toBe('token_signature_invalid')
  })

  it('rejects alg:none and garbage', async () => {
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ iss: ta.issuer, aud: ta.audience, sub: 'x', app_role: 'ADMIN' })
    ).toString('base64url')}.`
    expect(await code(v().verify(none))).toBe('token_signature_invalid')
    expect(await code(v().verify('not-a-jwt'))).toBe('token_malformed')
  })

  it('rejects a token with no subject', async () => {
    const t = await new SignJWT({ app_role: 'ADMIN' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuer(ta.issuer)
      .setAudience(ta.audience)
      .setExpirationTime('10m')
      .sign((await generateKeyPair('ES256')).privateKey)
    // signed by an unknown key AND missing sub: either way it must not verify
    expect(await code(v().verify(t))).not.toBe('ok')
  })

  describe('service tokens', () => {
    const secret = 'unit-test-internal-secret-0123456789'
    const sv = () =>
      new TokenVerifier({
        issuer: ta.issuer,
        audience: ta.audience,
        jwks: ta.jwks,
        serviceSecret: secret,
      })

    it('accepts a service token and assigns role SERVICE', async () => {
      const id = await sv().verify(await signServiceToken(secret, 'ms-order'))
      expect(id).toMatchObject({ userId: 'ms-order', role: 'SERVICE', kind: 'service' })
    })

    it('rejects a service token signed with the wrong secret', async () => {
      expect(
        await code(
          sv().verify(await signServiceToken('some-other-secret-value-xxxxxxxx', 'ms-order'))
        )
      ).toBe('token_signature_invalid')
    })

    it('refuses internal tokens entirely when no service secret is configured', async () => {
      expect(await code(v().verify(await signServiceToken(secret, 'ms-order')))).toBe(
        'auth_not_configured'
      )
    })

    it('a user token cannot be passed off as a service token', async () => {
      const id = await sv().verify(await ta.sign({ role: 'ADMIN' }))
      expect(id.kind).toBe('user')
    })
  })

  it('roleFromClaims reads app_metadata.app_role as a fallback', () => {
    expect(roleFromClaims({ app_metadata: { app_role: 'ADMIN' } })).toBe('ADMIN')
    expect(roleFromClaims({ app_role: 'SERVICE' })).toBe('CUSTOMER') // SERVICE can never come from a user token
  })
})

describe('RBAC decision table', () => {
  const user = (role: 'ADMIN' | 'VENDOR' | 'CUSTOMER', aal: 'aal1' | 'aal2' = 'aal1') => ({
    userId: 'u',
    role,
    aal,
    sessionId: null,
    email: null,
    kind: 'user' as const,
  })

  it('has no permission that no role holds, and ADMIN holds all of them', () => {
    for (const p of PERMISSIONS) expect(ROLE_PERMISSIONS.ADMIN.has(p)).toBe(true)
    for (const r of ROLES) expect(ROLE_PERMISSIONS[r].size).toBeGreaterThan(0)
  })

  it('SERVICE cannot touch users or the operator surface', () => {
    for (const p of [
      'users:update:role',
      'users:create',
      'users:delete',
      'ops:write',
      'ops:read',
    ] as const) {
      expect(ROLE_PERMISSIONS.SERVICE.has(p)).toBe(false)
    }
  })

  it('VENDOR can read storage but holds no storage write; CUSTOMER has no storage access', () => {
    expect(ROLE_PERMISSIONS.VENDOR.has('storage:read')).toBe(true)
    expect(ROLE_PERMISSIONS.CUSTOMER.has('storage:read')).toBe(false)
    const storageWrite = PERMISSIONS.filter((p) => p.startsWith('storage:') && p !== 'storage:read')
    expect(storageWrite).toEqual([]) // no storage write permission exists to grant
    for (const p of storageWrite) expect(ROLE_PERMISSIONS.VENDOR.has(p)).toBe(false)
    expect(decide({ permission: 'storage:read' }, user('VENDOR'), null).status).toBe(200)
    expect(decide({ permission: 'storage:read' }, user('CUSTOMER'), null).status).toBe(403)
  })

  it('CUSTOMER cannot change roles, create users, or use operator routes', () => {
    for (const p of [
      'users:update:role',
      'users:create',
      'users:delete',
      'ops:read',
      'ops:write',
      'orders:read:any',
    ] as const) {
      expect(ROLE_PERMISSIONS.CUSTOMER.has(p)).toBe(false)
    }
  })

  const cases: [
    string,
    RoutePolicy | undefined,
    ReturnType<typeof user> | null,
    string | null,
    number,
  ][] = [
    ['no policy -> default deny', undefined, user('ADMIN'), null, 403],
    ['public, anonymous', { public: true }, null, null, 200],
    ['protected, anonymous', { permission: 'orders:read' }, null, null, 401],
    ['protected, bad token', { permission: 'orders:read' }, null, 'token_expired', 401],
    ['customer reads orders', { permission: 'orders:read' }, user('CUSTOMER'), null, 200],
    ['customer on admin route', { permission: 'ops:write' }, user('CUSTOMER'), null, 403],
    ['vendor on admin route', { permission: 'ops:read' }, user('VENDOR'), null, 403],
    [
      'admin aal1 on mfa route',
      { permission: 'ops:write', mfa: true },
      user('ADMIN', 'aal1'),
      null,
      403,
    ],
    [
      'admin aal2 on mfa route',
      { permission: 'ops:write', mfa: true },
      user('ADMIN', 'aal2'),
      null,
      200,
    ],
    ['authenticated-only route', {}, user('CUSTOMER'), null, 200],
  ]
  it.each(cases)('%s', (_n, policy, id, err, status) => {
    expect(decide(policy, id, err).status).toBe(status)
  })

  it('reports MFA_REQUIRED (not a generic 403) so the client can prompt', () => {
    expect(decide({ permission: 'ops:write', mfa: true }, user('ADMIN', 'aal1'), null).code).toBe(
      'MFA_REQUIRED'
    )
  })
})

describe('policy enforcement on a live server', () => {
  const routes = (s: FastifyInstance) => {
    s.get('/public', { config: { policy: { public: true } } }, async () => ({ ok: true }))
    s.get('/orders', { config: { policy: { permission: 'orders:read' } } }, async () => ({
      ok: true,
    }))
    s.post('/ops', { config: { policy: { permission: 'ops:write', mfa: true } } }, async () => ({
      ok: true,
    }))
    s.get('/orders/:owner', { config: { policy: { permission: 'orders:read' } } }, async (req) => {
      requireOwnerOrAny(req, (req.params as { owner: string }).owner, 'orders:read')
      return { ok: true }
    })
    s.get('/no-policy', async () => ({ ok: true }))
  }

  it('anonymous: 200 on public, 401 on protected', async () => {
    const s = await build({ routes })
    expect((await s.inject('/public')).statusCode).toBe(200)
    const r = await s.inject('/orders')
    expect(r.statusCode).toBe(401)
    expect(r.json()).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
    await s.close()
  })

  it('a bad token is 401 TOKEN_INVALID and never an anonymous pass', async () => {
    const s = await build({ routes })
    const expired = await ta.sign({ expiresInSec: -120 })
    const r = await s.inject({ url: '/orders', headers: bearer(expired) })
    expect(r.statusCode).toBe(401)
    expect(r.json().code).toBe('TOKEN_INVALID')
    const forged = await s.inject({
      url: '/orders',
      headers: bearer(await ta.signForged({ role: 'ADMIN' })),
    })
    expect(forged.statusCode).toBe(401)
    await s.close()
  })

  it('role and MFA are enforced', async () => {
    const s = await build({ routes })
    const customer = bearer(await ta.sign({ role: 'CUSTOMER' }))
    const admin1 = bearer(await ta.sign({ role: 'ADMIN', aal: 'aal1' }))
    const admin2 = bearer(await ta.sign({ role: 'ADMIN', aal: 'aal2' }))
    expect(
      (await s.inject({ method: 'POST', url: '/ops', headers: customer, payload: {} })).statusCode
    ).toBe(403)
    const mfa = await s.inject({ method: 'POST', url: '/ops', headers: admin1, payload: {} })
    expect(mfa.statusCode).toBe(403)
    expect(mfa.json().code).toBe('MFA_REQUIRED')
    expect(
      (await s.inject({ method: 'POST', url: '/ops', headers: admin2, payload: {} })).statusCode
    ).toBe(200)
    await s.close()
  })

  it('identity headers are never trusted', async () => {
    const s = await build({ routes })
    const r = await s.inject({
      url: '/orders',
      headers: { 'x-user-id': 'u', 'x-user-role': 'ADMIN' },
    })
    expect(r.statusCode).toBe(401)
    await s.close()
  })

  it('object-level authorization: another user gets 404, owner and ADMIN pass', async () => {
    const s = await build({ routes })
    const alice = bearer(await ta.sign({ sub: 'alice', role: 'CUSTOMER' }))
    const admin = bearer(await ta.sign({ sub: 'root', role: 'ADMIN' }))
    expect((await s.inject({ url: '/orders/alice', headers: alice })).statusCode).toBe(200)
    expect((await s.inject({ url: '/orders/bob', headers: alice })).statusCode).toBe(404)
    expect((await s.inject({ url: '/orders/bob', headers: admin })).statusCode).toBe(200)
    await s.close()
  })

  it('default deny: a route without a policy is refused in enforce mode', async () => {
    const s = await build({ routes })
    const r = await s.inject({
      url: '/no-policy',
      headers: bearer(await ta.sign({ role: 'ADMIN' })),
    })
    expect(r.statusCode).toBe(403)
    expect(r.json().code).toBe('POLICY_MISSING')
    expect(() => assertPolicyCoverage(s)).toThrow(/no-policy/)
    await s.close()
  })

  it('report mode logs but does not block', async () => {
    const s = await build({ routes, auth: 'report' })
    expect((await s.inject('/orders')).statusCode).toBe(200)
    expect((await s.inject('/no-policy')).statusCode).toBe(200)
    await s.close()
  })

  it('CORS preflight (OPTIONS) is not subject to the policy', async () => {
    const s = await build({ routes })
    const r = await s.inject({ method: 'OPTIONS', url: '/orders' })
    expect(r.statusCode).not.toBe(401)
    await s.close()
  })
})

describe('rate limiting', () => {
  const authRoute = (s: FastifyInstance) => {
    s.post(
      '/login',
      {
        config: { policy: { public: true }, rateTier: 'auth' },
        schema: { body: Strict({ email: Type.String(), password: Type.String() }) },
      },
      async () => ({ ok: true })
    )
    s.get('/read', { config: { policy: { public: true } } }, async () => ({ ok: true }))
    s.get('/health', { config: { policy: { public: true } } }, async () => ({ ok: true }))
  }
  const post = (s: FastifyInstance, email: string, ip = '10.0.0.1') =>
    s.inject({
      method: 'POST',
      url: '/login',
      remoteAddress: ip,
      payload: { email, password: 'x' },
    })

  it('429 with Retry-After once the per-IP auth bucket is exhausted', async () => {
    const s = await build({ routes: authRoute, limits: { authIpPerMin: 3, authEmailPerMin: 100 } })
    for (let i = 0; i < 3; i++) expect((await post(s, `u${i}@x.co`)).statusCode).toBe(200)
    const r = await post(s, 'u9@x.co')
    expect(r.statusCode).toBe(429)
    expect(r.headers['retry-after']).toBeDefined()
    expect(r.json().code).toBe('RATE_LIMITED')
    await s.close()
  })

  it('x-ratelimit-reset is a Unix timestamp (seconds); retry-after stays seconds-until-reset', async () => {
    const s = await build({ routes: authRoute, limits: { authIpPerMin: 1, authEmailPerMin: 100 } })
    const before = Math.floor(Date.now() / 1000)
    expect((await post(s, 'ts1@x.co')).headers['x-ratelimit-reset']).toBeDefined()
    const r = await post(s, 'ts2@x.co')
    expect(r.statusCode).toBe(429)
    const reset = Number(r.headers['x-ratelimit-reset'])
    expect(Number.isInteger(reset)).toBe(true)
    expect(reset).toBeGreaterThanOrEqual(before)
    expect(reset).toBeLessThanOrEqual(before + 61)
    const retryAfter = Number(r.headers['retry-after'])
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
    await s.close()
  })

  it('the per-email bucket limits one account even when attempts come from many IPs', async () => {
    const s = await build({ routes: authRoute, limits: { authIpPerMin: 100, authEmailPerMin: 2 } })
    expect((await post(s, 'victim@x.co', '10.0.0.1')).statusCode).toBe(200)
    expect((await post(s, 'Victim@X.co ', '10.0.0.2')).statusCode).toBe(200) // normalised: same account
    expect((await post(s, 'victim@x.co', '10.0.0.3')).statusCode).toBe(429)
    expect((await post(s, 'other@x.co', '10.0.0.3')).statusCode).toBe(200) // others unaffected
    await s.close()
  })

  it('ignores a spoofed X-Forwarded-For when the proxy is not trusted', async () => {
    const s = await build({ routes: authRoute, limits: { authIpPerMin: 2, authEmailPerMin: 100 } })
    for (let i = 0; i < 2; i++) {
      await s.inject({
        method: 'POST',
        url: '/login',
        remoteAddress: '10.0.0.1',
        headers: { 'x-forwarded-for': `203.0.113.${i}` },
        payload: { email: `a${i}@x.co`, password: 'x' },
      })
    }
    const r = await s.inject({
      method: 'POST',
      url: '/login',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.99' },
      payload: { email: 'z@x.co', password: 'x' },
    })
    expect(r.statusCode).toBe(429)
    await s.close()
  })

  it('does not limit /health', async () => {
    const s = await build({ routes: authRoute, limits: { ipPerMin: 1 } })
    for (let i = 0; i < 5; i++) expect((await s.inject('/health')).statusCode).toBe(200)
    await s.close()
  })

  it('report mode counts but does not block', async () => {
    const s = await build({
      routes: authRoute,
      rate: 'report',
      limits: { authIpPerMin: 1, authEmailPerMin: 100 },
    })
    for (let i = 0; i < 4; i++) expect((await post(s, `r${i}@x.co`)).statusCode).toBe(200)
    expect(s.rateLimitStats.limited).toBeGreaterThan(0)
    await s.close()
  })

  const broken: RateStore = {
    hit: async () => {
      throw new Error('redis down')
    },
  }

  it('store down: reads FAIL OPEN, login FAILS CLOSED with 503', async () => {
    const s = await build({ routes: authRoute, store: broken })
    expect((await s.inject('/read')).statusCode).toBe(200)
    const r = await post(s, 'a@x.co')
    expect(r.statusCode).toBe(503)
    expect(r.json().code).toBe('RATE_LIMIT_UNAVAILABLE')
    expect(s.rateLimitStats.failOpen).toBeGreaterThan(0)
    expect(s.rateLimitStats.failClosed).toBeGreaterThan(0)
    await s.close()
  })

  it('a shared store makes two server instances share one counter', async () => {
    const store = new MemoryRateStore()
    const a = await build({
      routes: authRoute,
      store,
      limits: { authIpPerMin: 2, authEmailPerMin: 100 },
    })
    const b = await build({
      routes: authRoute,
      store,
      limits: { authIpPerMin: 2, authEmailPerMin: 100 },
    })
    expect((await post(a, 'p@x.co')).statusCode).toBe(200)
    expect((await post(b, 'q@x.co')).statusCode).toBe(200)
    expect((await post(a, 'r@x.co')).statusCode).toBe(429)
    await a.close()
    await b.close()
  })
})

describe('input validation and the error shape', () => {
  const routes = (s: FastifyInstance) => {
    s.post(
      '/things',
      {
        config: { policy: { public: true } },
        schema: {
          body: Strict({
            name: Type.String({ minLength: 1, maxLength: 10 }),
            qty: Type.Integer({ minimum: 1, maximum: 5 }),
          }),
        },
      },
      async (req) => req.body
    )
    s.get(
      '/list',
      {
        config: { policy: { public: true } },
        schema: {
          querystring: Strict({ limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }) }),
        },
      },
      async (req) => req.query
    )
    s.get('/boom', { config: { policy: { public: true } } }, async () => {
      throw new Error('secret db password is hunter2')
    })
  }

  it('rejects unknown fields instead of silently stripping them', async () => {
    const s = await build({ routes })
    const r = await s.inject({
      method: 'POST',
      url: '/things',
      payload: { name: 'a', qty: 1, role: 'ADMIN' },
    })
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(r.json().fields[0].rule).toBe('unknownField:role')
    await s.close()
  })

  it('does not coerce body types ("5" is not 5)', async () => {
    const s = await build({ routes })
    expect(
      (await s.inject({ method: 'POST', url: '/things', payload: { name: 'a', qty: '5' } }))
        .statusCode
    ).toBe(400)
    await s.close()
  })

  it('Money accepts every valid 2-decimal amount (multipleOfPrecision) and rejects 3-decimal ones', async () => {
    const s = await build({
      rate: 'report', // thousands of requests below; the limiter is not under test
      routes: (r) => {
        r.post(
          '/price',
          { config: { policy: { public: true } }, schema: { body: Strict({ price: Money }) } },
          async (req) => req.body
        )
      },
    })
    const post = (price: number) => s.inject({ method: 'POST', url: '/price', payload: { price } })
    for (const price of [0, 0.01, 0.07, 0.29, 19.99, 33.33, 349.99, 1234.56, 1_000_000]) {
      expect((await post(price)).statusCode).toBe(200)
    }
    // Every cent value up to 100.00 (about one in nine fail under plain float modulo).
    for (let cents = 0; cents <= 10_000; cents++) {
      const price = cents / 100
      if ((await post(price)).statusCode !== 200) throw new Error(`rejected valid price ${price}`)
    }
    for (const price of [0.001, 1.005, 19.999, -0.01, 1_000_000.01]) {
      expect((await post(price)).statusCode).toBe(400)
    }
    await s.close()
  })

  it('enforces bounds and never echoes the offending value', async () => {
    const s = await build({ routes })
    const r = await s.inject({
      method: 'POST',
      url: '/things',
      payload: { name: 'x'.repeat(11), qty: 1 },
    })
    expect(r.statusCode).toBe(400)
    expect(JSON.stringify(r.json())).not.toContain('xxxxxxxxxx')
    expect(
      (await s.inject({ method: 'POST', url: '/things', payload: { name: 'a', qty: 0 } }))
        .statusCode
    ).toBe(400)
    expect(
      (await s.inject({ method: 'POST', url: '/things', payload: { name: 'a', qty: 1.5 } }))
        .statusCode
    ).toBe(400)
    expect(
      (await s.inject({ method: 'POST', url: '/things', payload: { name: 'a', qty: 1e308 * 10 } }))
        .statusCode
    ).toBe(400)
    await s.close()
  })

  it('coerces query strings (they are strings on the wire) and applies defaults', async () => {
    const s = await build({ routes })
    expect((await s.inject('/list?limit=5')).json()).toEqual({ limit: 5 })
    expect((await s.inject('/list')).json()).toEqual({ limit: 20 })
    expect((await s.inject('/list?limit=1000')).statusCode).toBe(400)
    expect((await s.inject('/list?limit=abc')).statusCode).toBe(400)
    await s.close()
  })

  it('rejects an oversized body with 413', async () => {
    const s = await build({ routes })
    const r = await s.inject({
      method: 'POST',
      url: '/things',
      payload: { name: 'a', qty: 1, pad: 'x'.repeat(200 * 1024) },
    })
    expect(r.statusCode).toBe(413)
    expect(r.json().code).toBe('PAYLOAD_TOO_LARGE')
    await s.close()
  })

  it('rejects a non-JSON content type with 415', async () => {
    const s = await build({ routes })
    const r = await s.inject({
      method: 'POST',
      url: '/things',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    })
    expect(r.statusCode).toBe(415)
    await s.close()
  })

  it('does not allow prototype pollution through __proto__', async () => {
    const s = await build({ routes })
    const r = await s.inject({
      method: 'POST',
      url: '/things',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":"a","qty":1,"__proto__":{"isAdmin":true}}',
    })
    expect(r.statusCode).toBe(400)
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
    await s.close()
  })

  it('an unexpected error returns a generic 500 with a request id and no internals', async () => {
    const s = await build({ routes })
    const r = await s.inject('/boom')
    expect(r.statusCode).toBe(500)
    expect(r.json().code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(r.json())).not.toContain('hunter2')
    expect(r.json().requestId).toBeDefined()
    await s.close()
  })

  it('unknown routes get the standard 404 body', async () => {
    const s = await build({ routes })
    const r = await s.inject('/nope')
    expect(r.statusCode).toBe(404)
    expect(r.json().code).toBe('NOT_FOUND')
    await s.close()
  })
})

describe('loadSecurityConfig', () => {
  it('defaults to report mode and derives issuer/JWKS from SUPABASE_URL', () => {
    const c = loadSecurityConfig({ SUPABASE_URL: 'https://abc.supabase.co/' } as NodeJS.ProcessEnv)
    expect(c.authMode).toBe('report')
    expect(c.issuer).toBe('https://abc.supabase.co/auth/v1')
    expect(c.jwksUrl).toBe('https://abc.supabase.co/auth/v1/.well-known/jwks.json')
  })

  it('treats an unknown AUTH_ENFORCE value as the safe rollout default, not as off', () => {
    expect(loadSecurityConfig({ AUTH_ENFORCE: 'banana' } as NodeJS.ProcessEnv).authMode).toBe(
      'report'
    )
    expect(loadSecurityConfig({ AUTH_ENFORCE: 'enforce' } as NodeJS.ProcessEnv).authMode).toBe(
      'enforce'
    )
  })

  it('with no SUPABASE_URL a presented token fails closed (auth_not_configured), it does not pass', async () => {
    const server = fastify({ logger: false })
    await registerSecurity(server, {
      service: 't',
      overrides: {
        config: { authMode: 'enforce', supabaseUrl: null, issuer: null, jwksUrl: null },
      },
    })
    server.get('/p', { config: { policy: { permission: 'orders:read' } } }, async () => ({
      ok: true,
    }))
    await server.ready()
    const r = await server.inject({ url: '/p', headers: bearer(await ta.sign()) })
    expect(r.statusCode).toBe(401)
    await server.close()
  })
})
