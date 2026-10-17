import fastify, { type FastifyInstance } from 'fastify'
import {
  MemoryRateStore,
  assertPolicyCoverage,
  createTestAuth,
  describePolicies,
  securityServerOptions,
  signServiceToken,
  type EnforceMode,
  type TestAuth,
} from '@ecommerce/shared-security'
import {
  createRouteRegistry,
  registerEndpointsRoute,
  registerMetrics,
} from '@ecommerce/shared-utils'
import type { loadDatabaseConfig } from '@ecommerce/shared-database'
import type { AnalyticsStore } from '../aggregates/store'
import { createAnalyticsConsumer } from '../events'
import { registerServiceRoutes } from '../routes'
import { registerAnalyticsSecurity } from '../security'

/**
 * API-defense tests for ms-analytics: the policy matrix per role, strict
 * query/param validation and the rollout (report) mode. Real handlers and the
 * real security plugin; the database is a stub that records the SQL it is given.
 */

const SECRET = 'unit-test-internal-secret-0123456789'
let ta: TestAuth
beforeAll(async () => {
  ta = await createTestAuth()
})

const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

type Who = 'ANON' | 'CUSTOMER' | 'VENDOR' | 'ADMIN1' | 'ADMIN2' | 'SERVICE'
const WHO: Who[] = ['ANON', 'CUSTOMER', 'VENDOR', 'ADMIN1', 'ADMIN2', 'SERVICE']

async function headersFor(who: Who): Promise<Record<string, string>> {
  switch (who) {
    case 'ANON':
      return {}
    case 'CUSTOMER':
      return bearer(await ta.sign({ sub: 'cust-a', role: 'CUSTOMER' }))
    case 'VENDOR':
      return bearer(await ta.sign({ sub: 'vend-a', role: 'VENDOR' }))
    case 'ADMIN1':
      return bearer(await ta.sign({ sub: 'adm-a', role: 'ADMIN', aal: 'aal1' }))
    case 'ADMIN2':
      return bearer(await ta.sign({ sub: 'adm-a', role: 'ADMIN', aal: 'aal2' }))
    case 'SERVICE':
      return bearer(await signServiceToken(SECRET, 'ms-test'))
  }
}

interface Built {
  server: FastifyInstance
  sql: { text: string; params: unknown[] }[]
}

async function build(auth: EnforceMode = 'enforce'): Promise<Built> {
  const sql: Built['sql'] = []
  const store = {
    schema: 'ms_analytics',
    db: {
      schema: 'ms_analytics',
      query: async (text: string, params: unknown[] = []) => {
        sql.push({ text, params })
        return { rows: [], rowCount: 0 }
      },
    },
    transaction: async () => undefined,
  } as unknown as AnalyticsStore

  const server = fastify({ ...securityServerOptions({}), logger: false })
  await registerAnalyticsSecurity(server, {
    redis: null,
    overrides: {
      jwks: ta.jwks,
      store: new MemoryRateStore(),
      config: {
        authMode: auth,
        rateLimitMode: 'enforce',
        issuer: ta.issuer,
        audience: ta.audience,
        serviceAuthSecret: SECRET,
        limits: {
          ipPerMin: 100_000,
          authIpPerMin: 100_000,
          authEmailPerMin: 100_000,
          userReadPerMin: 100_000,
          userWritePerMin: 100_000,
          expensivePerMin: 100_000,
          adminPerMin: 100_000,
        },
      },
    },
  })
  registerMetrics(server, { service: 'ms-analytics-test', collectDefaults: false })
  const registry = createRouteRegistry(server)
  registerServiceRoutes(server, {
    store,
    consumer: createAnalyticsConsumer(store),
    dbConfig: {
      mode: 'test',
      document: { driver: 'postgres' },
      keyValue: { driver: 'embedded' },
    } as unknown as ReturnType<typeof loadDatabaseConfig>,
    probe: async () => ({ reachable: true, schema: 'ms_analytics', latencyMs: 1 }),
  })
  registerEndpointsRoute(server, registry, 'ms-analytics')
  await server.ready()
  return { server, sql }
}

describe('policy matrix (role x route)', () => {
  let server: FastifyInstance
  beforeAll(async () => {
    ;({ server } = await build())
  })
  afterAll(async () => server.close())

  type Row = { url: string; allow: Who[]; mfaFor?: Who[] }
  const BI: Who[] = ['VENDOR', 'ADMIN1', 'ADMIN2']
  const rows: Row[] = [
    { url: '/health', allow: WHO },
    { url: '/metrics', allow: WHO },
    ...[
      '/api/v1/analytics/summary',
      '/api/v1/analytics/revenue',
      '/api/v1/analytics/top-products',
      '/api/v1/analytics/funnel',
    ].map((url): Row => ({ url, allow: BI })),
    ...['/api/v1/events', '/api/v1/endpoints'].map((url): Row => ({
      url,
      allow: ['ADMIN2'],
      mfaFor: ['ADMIN1'],
    })),
  ]
  const cases = rows.flatMap((row) => WHO.map((who) => [row.url, who, row] as const))

  it.each(cases)('GET %s as %s', async (_name, who, row) => {
    const res = await server.inject({ url: row.url, headers: await headersFor(who) })
    if (row.allow.includes(who)) {
      expect([401, 403, 429]).not.toContain(res.statusCode)
    } else if (who === 'ANON') {
      expect(res.statusCode).toBe(401)
    } else if (row.mfaFor?.includes(who)) {
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('MFA_REQUIRED')
    } else {
      expect(res.statusCode).toBe(403)
    }
  })

  it('SERVICE tokens cannot read analytics (not in its permission set)', async () => {
    const res = await server.inject({
      url: '/api/v1/analytics/summary',
      headers: await headersFor('SERVICE'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('every registered route carries a policy and is listed in the matrix', () => {
    expect(() => assertPolicyCoverage(server)).not.toThrow()
    const listed = new Set(rows.map((r) => `GET ${r.url}`))
    const unlisted = describePolicies(server)
      .filter((r) => !r.url.startsWith('/api-docs') && !r.url.startsWith('/documentation'))
      .map((r) => `${r.method} ${r.url}`)
      .filter((k) => !listed.has(k))
    expect(unlisted).toEqual([])
  })

  it('a forged or expired token is a 401', async () => {
    for (const t of [
      await ta.signForged({ role: 'ADMIN' }),
      await ta.sign({ expiresInSec: -120 }),
    ]) {
      const res = await server.inject({ url: '/api/v1/analytics/summary', headers: bearer(t) })
      expect(res.statusCode).toBe(401)
    }
  })
})

describe('validation', () => {
  let server: FastifyInstance
  let H: Record<string, string>
  beforeAll(async () => {
    ;({ server } = await build())
    H = await headersFor('VENDOR')
  })
  afterAll(async () => server.close())

  it.each([
    '/api/v1/analytics/revenue?hours=0',
    '/api/v1/analytics/revenue?hours=169',
    '/api/v1/analytics/revenue?hours=99999',
    '/api/v1/analytics/revenue?hours=1.5',
    '/api/v1/analytics/revenue?hours=abc',
    '/api/v1/analytics/revenue?from=2026-01-01',
    '/api/v1/analytics/top-products?limit=0',
    '/api/v1/analytics/top-products?limit=101',
    '/api/v1/analytics/top-products?limit=-1',
    '/api/v1/analytics/summary?x=1',
  ])('%s is a 400 in the standard error shape', async (url) => {
    const res = await server.inject({ url, headers: H })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_FAILED')
  })

  it('accepts the bounds and applies the defaults', async () => {
    for (const url of [
      '/api/v1/analytics/revenue',
      '/api/v1/analytics/revenue?hours=168',
      '/api/v1/analytics/top-products?limit=100',
      '/api/v1/analytics/top-products',
    ]) {
      expect((await server.inject({ url, headers: H })).statusCode).toBe(200)
    }
  })

  it('/health is closed: only documented fields, no raw error text', async () => {
    const res = await server.inject('/health')
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.json()).sort()).toEqual([
      'consumer',
      'database',
      'events',
      'service',
      'status',
      'timestamp',
    ])
    expect(res.json().database).not.toHaveProperty('error')
  })
})

describe('AUTH_ENFORCE=report (rollout mode)', () => {
  it('logs but does not block, while validation still applies', async () => {
    const { server } = await build('report')
    expect((await server.inject('/api/v1/analytics/summary')).statusCode).toBe(200)
    expect((await server.inject('/api/v1/analytics/revenue?hours=0')).statusCode).toBe(400)
    await server.close()
  })
})
