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
import { RedisUnavailableError, type OutboxRelay } from '@ecommerce/shared-messaging'
import type { loadDatabaseConfig } from '@ecommerce/shared-database'
import type { InventoryStore } from '../db/store'
import { createInventoryConsumer } from '../events'
import type { QueueManager } from '../queues'
import { registerServiceRoutes } from '../routes'
import { registerInventorySecurity } from '../security'

/**
 * API-defense tests for ms-inventory: the policy matrix per role, strict
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
    schema: 'ms_inventory',
    db: {
      schema: 'ms_inventory',
      query: async (text: string, params: unknown[] = []) => {
        sql.push({ text, params })
        return { rows: [], rowCount: 0 }
      },
    },
    transaction: async () => undefined,
  } as unknown as InventoryStore

  const queueManager = {
    checkRedis: async () => new RedisUnavailableError('redis_unavailable', 'stub'),
    tryEnqueue: async () => undefined,
  } as unknown as QueueManager
  const relay = {
    stats: async () => ({
      enabled: false,
      running: false,
      workerId: 'w',
      counts: { pending: 0, processing: 0, sent: 0, failed: 0 },
      oldestPendingAgeMs: null,
      sinceStart: { sent: 0, failedAttempts: 0, lastError: null, lastTickAt: null },
    }),
    requeueFailed: async () => 0,
  } as unknown as OutboxRelay

  const server = fastify({ ...securityServerOptions({}), logger: false })
  await registerInventorySecurity(server, {
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
  registerMetrics(server, { service: 'ms-inventory-test', collectDefaults: false })
  const registry = createRouteRegistry(server)
  registerServiceRoutes(server, {
    store,
    queueManager,
    eventConsumer: createInventoryConsumer({ store, queueManager }),
    outboxRelay: relay,
    dbConfig: {
      mode: 'test',
      document: { driver: 'postgres' },
      keyValue: { driver: 'embedded' },
    } as unknown as ReturnType<typeof loadDatabaseConfig>,
    probe: async () => ({ reachable: true, schema: 'ms_inventory', latencyMs: 1 }),
  })
  registerEndpointsRoute(server, registry, 'ms-inventory')
  await server.ready()
  return { server, sql }
}

describe('policy matrix (role x route)', () => {
  let server: FastifyInstance
  beforeAll(async () => {
    ;({ server } = await build())
  })
  afterAll(async () => server.close())

  type Row = { method: 'GET' | 'POST'; url: string; allow: Who[]; mfaFor?: Who[] }
  const STOCK: Who[] = ['VENDOR', 'ADMIN1', 'ADMIN2', 'SERVICE']
  const OPS: Who[] = ['ADMIN2']

  const rows: Row[] = [
    { method: 'GET', url: '/health', allow: WHO },
    { method: 'GET', url: '/metrics', allow: WHO },
    { method: 'GET', url: '/api/v1/inventory', allow: STOCK },
    { method: 'GET', url: '/api/v1/inventory/prod-1', allow: STOCK },
    { method: 'GET', url: '/api/v1/reservations', allow: STOCK },
    ...['/api/v1/events', '/api/v1/queues', '/api/v1/outbox', '/api/v1/endpoints'].map(
      (url): Row => ({ method: 'GET', url, allow: OPS, mfaFor: ['ADMIN1'] })
    ),
    { method: 'POST', url: '/api/v1/outbox/requeue', allow: OPS, mfaFor: ['ADMIN1'] },
  ]

  const cases = rows.flatMap((row) =>
    WHO.map((who) => [`${row.method} ${row.url}`, who, row] as const)
  )

  it.each(cases)('%s as %s', async (_name, who, row) => {
    const res = await server.inject({
      method: row.method,
      url: row.url,
      headers: await headersFor(who),
      ...(row.method === 'POST' ? { payload: {} } : {}),
    })
    if (row.allow.includes(who)) {
      // 404 (no such product) and 503 (Redis stub down) are fine: the policy let it through.
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

  it('every registered route carries a policy and is listed in the matrix', () => {
    expect(() => assertPolicyCoverage(server)).not.toThrow()
    const listed = new Set(rows.map((r) => `${r.method} ${r.url.replace('prod-1', ':productId')}`))
    const unlisted = describePolicies(server)
      .filter((r) => !r.url.startsWith('/api-docs') && !r.url.startsWith('/documentation'))
      .map((r) => `${r.method} ${r.url}`)
      .filter((k) => !listed.has(k))
    expect(unlisted).toEqual([])
  })

  it('a customer has no business in stock data even with a valid token', async () => {
    const res = await server.inject({
      url: '/api/v1/inventory',
      headers: await headersFor('CUSTOMER'),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('FORBIDDEN')
  })

  it('a forged or expired token is a 401', async () => {
    for (const t of [
      await ta.signForged({ role: 'ADMIN' }),
      await ta.sign({ expiresInSec: -120 }),
    ]) {
      expect(
        (await server.inject({ url: '/api/v1/inventory', headers: bearer(t) })).statusCode
      ).toBe(401)
    }
  })
})

describe('validation and responses', () => {
  let b: Built
  let H: Record<string, string>
  beforeAll(async () => {
    b = await build()
    H = await headersFor('VENDOR')
  })
  afterAll(async () => b.server.close())
  const get = (url: string) => b.server.inject({ url, headers: H })

  it.each([
    '/api/v1/inventory?limit=0',
    '/api/v1/inventory?limit=101',
    '/api/v1/inventory?limit=abc',
    '/api/v1/inventory?offset=-1',
    '/api/v1/inventory?limit=1.5',
    '/api/v1/inventory?unknown=1',
    '/api/v1/reservations?limit=5000',
    `/api/v1/reservations?orderId=${'x'.repeat(65)}`,
    "/api/v1/reservations?orderId=o'%3B%20DROP%20TABLE%20reservations%3B--",
    `/api/v1/inventory/${'x'.repeat(65)}`,
    '/api/v1/inventory/a%20b',
  ])('%s is a 400', async (url) => {
    const res = await get(url)
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_FAILED')
  })

  it('applies the page bounds as SQL parameters, never as interpolated text', async () => {
    b.sql.length = 0
    expect((await get('/api/v1/inventory?limit=7&offset=14')).statusCode).toBe(200)
    expect(b.sql[0]!.params).toEqual([7, 14])
    expect(b.sql[0]!.text).not.toMatch(/LIMIT 7/)
    b.sql.length = 0
    await get('/api/v1/reservations?orderId=ord-1')
    expect(b.sql[0]!.params).toEqual(['ord-1', 100, 0])
  })

  it('an unknown product is a 404 in the standard error shape', async () => {
    const res = await get('/api/v1/inventory/prod-404')
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
  })

  it('/health is closed: only documented fields, no raw error text', async () => {
    const res = await b.server.inject('/health')
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.json()).sort()).toEqual([
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
    expect((await server.inject('/api/v1/inventory')).statusCode).toBe(200)
    expect((await server.inject('/api/v1/inventory?limit=0')).statusCode).toBe(400)
    await server.close()
  })
})
