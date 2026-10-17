import * as crypto from 'crypto'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import fastify, { type FastifyInstance } from 'fastify'
import {
  MemoryRateStore,
  createTestAuth,
  securityServerOptions,
  type TestAuth,
} from '@ecommerce/shared-security'
import {
  applyServiceUrlDefaults,
  closeServicePools,
  getServicePool,
} from '@ecommerce/shared-database'
import type { EventContext, EventEnvelope } from '@ecommerce/shared-messaging'
import { MIGRATIONS_DIR, createAnalyticsStoreOn, type AnalyticsStore } from '../../aggregates/store'
import { handleOrderCreated } from '../../events/handlers'
import { registerAnalyticsRoutes } from '../../routes/analytics'
import { registerAnalyticsSecurity } from '../../security'
import { RankingEngine, mergeLines, postgresRanking, type RankRedis } from '../engine'
import { createRankRedis } from '../redis'
import { WINDOW_SPECS, bucketExpiryMs, inWindow, liveBuckets } from '../windows'
import { FakeRedis } from './fakeRedis'

dotenv.config({ path: path.resolve(__dirname, '../../../../../.env') })
jest.setTimeout(60_000)
applyServiceUrlDefaults(process.env)

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN

/** A store whose SQL is answered by regex -> rows. Records every statement. */
function stubStore(
  answers: [RegExp, (params: unknown[]) => Record<string, unknown>[]][] = []
): AnalyticsStore & { sql: string[] } {
  const sql: string[] = []
  const query = async (text: string, params: unknown[] = []) => {
    sql.push(text)
    const hit = answers.find(([re]) => re.test(text))
    const rows = hit ? hit[1](params) : []
    return { rows, rowCount: rows.length }
  }
  return {
    schema: 'ms_analytics',
    db: { schema: 'ms_analytics', query },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ schema: 'ms_analytics', query }),
    sql,
  } as unknown as AnalyticsStore & { sql: string[] }
}

const SAMPLE = [
  { productId: 'p1', categoryId: 'c1', quantity: 2 },
  { productId: 'p2', categoryId: null, quantity: 1 },
]

describe('windows', () => {
  it('has 60 / 48 / 28 live buckets and the newest is the current one', () => {
    expect(liveBuckets(NOW, WINDOW_SPECS['1h'])).toHaveLength(60)
    expect(liveBuckets(NOW, WINDOW_SPECS['24h'])).toHaveLength(48)
    expect(liveBuckets(NOW, WINDOW_SPECS['7d'])).toHaveLength(28)
    const b = liveBuckets(NOW, WINDOW_SPECS['1h'])
    expect(b[b.length - 1]).toBe(Math.floor(NOW / MIN))
  })

  it('inWindow excludes events older than the window and from the future', () => {
    const s = WINDOW_SPECS['1h']
    expect(inWindow(NOW - 30 * MIN, NOW, s)).toBe(true)
    expect(inWindow(NOW - 2 * HOUR, NOW, s)).toBe(false)
    expect(inWindow(NOW + 5 * MIN, NOW, s)).toBe(false)
  })

  it('expires a bucket shortly after it leaves the window', () => {
    const s = WINDOW_SPECS['1h']
    const bucket = Math.floor(NOW / MIN)
    const ttl = bucketExpiryMs(bucket, s) - NOW
    expect(ttl).toBeGreaterThan(HOUR)
    expect(ttl).toBeLessThanOrEqual(HOUR + 3 * MIN)
  })
})

describe('mergeLines', () => {
  it('sums repeated products and drops unusable quantities', () => {
    const out = mergeLines([
      { productId: 'a', categoryId: null, quantity: 1 },
      { productId: 'a', categoryId: 'c', quantity: 2 },
      { productId: 'b', categoryId: null, quantity: 0 },
      { productId: 'c', categoryId: null, quantity: Number.NaN },
    ])
    expect(out).toEqual([{ productId: 'a', categoryId: 'c', quantity: 3 }])
  })
})

describe('RankingEngine write path (fake redis)', () => {
  let redis: FakeRedis
  let engine: RankingEngine
  const logs: string[] = []
  beforeEach(() => {
    redis = new FakeRedis()
    logs.length = 0
    engine = new RankingEngine(redis, stubStore(), {
      prefix: 'rank',
      now: () => NOW,
      log: (m) => logs.push(m),
    })
  })

  it('increments global and category sets for every window', async () => {
    await engine.recordOrder({ occurredAt: new Date(NOW), lines: SAMPLE })
    const keys = redis.keys()
    for (const w of ['1h', '24h', '7d']) {
      expect(keys.some((k) => k.startsWith(`rank:global:${w}:b`))).toBe(true)
      expect(keys.some((k) => k.startsWith(`rank:cat:c1:${w}:b`))).toBe(true)
    }
    // p2 has no category: it is in global sets only.
    const catSets = keys.filter((k) => k.startsWith('rank:cat:'))
    for (const k of catSets) {
      expect([...(redis.zsets.get(k)?.keys() ?? [])]).toEqual(['p1'])
    }
  })

  it('skips the category set for a missing or key-unsafe category id', async () => {
    await engine.recordOrder({
      occurredAt: new Date(NOW),
      lines: [
        { productId: 'p1', categoryId: null, quantity: 1 },
        { productId: 'p2', categoryId: 'bad:id*', quantity: 1 },
      ],
    })
    expect(redis.keys().filter((k) => k.startsWith('rank:cat:'))).toEqual([])
    expect(redis.keys().filter((k) => k.startsWith('rank:global:1h:'))).toHaveLength(1)
  })

  it('gives every bucket key an absolute expiry (bounded memory)', async () => {
    await engine.recordOrder({ occurredAt: new Date(NOW), lines: SAMPLE })
    for (const k of redis.keys()) expect(redis.expireAt.get(k)).toBeGreaterThan(NOW)
    expect(redis.expireAt.size).toBe(redis.keys().length)
  })

  it('does not put a replayed old event into a window it has left', async () => {
    await engine.recordOrder({ occurredAt: new Date(NOW - 3 * HOUR), lines: SAMPLE })
    const keys = redis.keys()
    expect(keys.some((k) => k.startsWith('rank:global:1h:'))).toBe(false)
    expect(keys.some((k) => k.startsWith('rank:global:24h:'))).toBe(true)
  })

  it('never throws on a Redis failure and marks itself for rebuild', async () => {
    redis.failing = true
    await expect(
      engine.recordOrder({ occurredAt: new Date(NOW), lines: SAMPLE })
    ).resolves.toBeUndefined()
    expect(logs.join()).toMatch(/rank write failed/)
  })
})

describe('RankingEngine read path and rebuild (fake redis)', () => {
  it('ranks by units, honours limit, and excludes buckets older than the window', async () => {
    const redis = new FakeRedis()
    let now = NOW
    const engine = new RankingEngine(redis, stubStore(), { now: () => now })
    await engine.recordOrder({
      occurredAt: new Date(NOW),
      lines: [
        { productId: 'a', categoryId: null, quantity: 5 },
        { productId: 'b', categoryId: null, quantity: 9 },
        { productId: 'c', categoryId: null, quantity: 1 },
      ],
    })
    now = NOW + 10 * MIN
    await engine.recordOrder({
      occurredAt: new Date(NOW + 10 * MIN),
      lines: [{ productId: 'a', categoryId: null, quantity: 6 }],
    })
    // marks ready so the (empty) stub store is not asked to rebuild
    redis.strings.set('rank:meta:ready', 'x')

    now = NOW + 10 * MIN
    const top = await engine.top({ window: '1h', limit: 2 })
    expect(top.source).toBe('redis')
    expect(top.products).toEqual([
      { rank: 1, productId: 'a', unitsSold: 11 },
      { rank: 2, productId: 'b', unitsSold: 9 },
    ])

    // 65 minutes after the first order: only the second is still in the 1h window.
    now = NOW + 65 * MIN
    const later = await engine.top({ window: '1h', limit: 10 })
    expect(later.products).toEqual([{ rank: 1, productId: 'a', unitsSold: 6 }])
    const day = await engine.top({ window: '24h', limit: 10 })
    expect(day.products[0]).toEqual({ rank: 1, productId: 'a', unitsSold: 11 })
  })

  it('rebuilds from Postgres sales_lines after a flush', async () => {
    const bucket = Math.floor(NOW / MIN)
    const store = stubStore([
      [
        /FROM ms_analytics\.sales_lines[\s\S]*GROUP BY product_id, category_id, bucket/,
        (params) => {
          const bucketMs = params[1] as number
          const b = Math.floor(NOW / bucketMs)
          return [
            { product_id: 'p1', category_id: 'c1', bucket: String(b), units: '4' },
            { product_id: 'p2', category_id: null, bucket: String(b), units: '7' },
            // outside this window's ring: must be ignored
            { product_id: 'old', category_id: null, bucket: String(b - 1000), units: '99' },
          ]
        },
      ],
    ])
    const redis = new FakeRedis()
    const engine = new RankingEngine(redis, store, { now: () => NOW })
    expect(await engine.isReady()).toBe(false)

    const global = await engine.top({ window: '24h', limit: 10 }) // triggers rebuild
    expect(global.products.map((p) => [p.productId, p.unitsSold])).toEqual([
      ['p2', 7],
      ['p1', 4],
    ])
    const cat = await engine.top({ window: '1h', limit: 10, categoryId: 'c1' })
    expect(cat.products).toEqual([{ rank: 1, productId: 'p1', unitsSold: 4 }])
    expect(bucket).toBeGreaterThan(0)

    // Flush again: the next read rebuilds again, to the same answer.
    redis.flush()
    const again = await engine.top({ window: '24h', limit: 10 })
    expect(again.products).toEqual(global.products)
    // and the sales_lines prune ran with a 7d+ cutoff
    expect(store.sql.some((s) => /DELETE FROM ms_analytics\.sales_lines/.test(s))).toBe(true)
  })

  it('single-flights concurrent rebuilds', async () => {
    const store = stubStore()
    const engine = new RankingEngine(new FakeRedis(), store, { now: () => NOW })
    await Promise.all([engine.rebuild(), engine.rebuild(), engine.rebuild()])
    expect(store.sql.filter((s) => /DELETE FROM/.test(s))).toHaveLength(1)
  })

  it('rebuilds on the next read after a failed write', async () => {
    const redis = new FakeRedis()
    const store = stubStore()
    const engine = new RankingEngine(redis, store, { now: () => NOW })
    await engine.rebuild()
    redis.failing = true
    await engine.recordOrder({ occurredAt: new Date(NOW), lines: SAMPLE })
    redis.failing = false
    const before = store.sql.length
    await engine.top({ window: '1h', limit: 5 })
    expect(store.sql.length).toBeGreaterThan(before) // went back to Postgres
  })
})

describe('postgresRanking', () => {
  it('global: all-time product_counters, flagged as such', async () => {
    const store = stubStore([
      [
        /FROM ms_analytics\.product_counters/,
        () => [
          { product_id: 'p1', sku: 's1', units_ordered: '3', times_ordered: '1', revenue: '9' },
          { product_id: 'p2', sku: 's2', units_ordered: '8', times_ordered: '2', revenue: '16' },
        ],
      ],
    ])
    const r = await postgresRanking(store, { window: '1h', limit: 1 }, NOW)
    expect(r).toMatchObject({ source: 'postgres', window: '1h', windowApplied: 'all-time' })
    expect(r.products).toEqual([{ rank: 1, productId: 'p2', unitsSold: 8 }])
  })

  it('category: windowed sales_lines', async () => {
    const store = stubStore([
      [/FROM ms_analytics\.sales_lines/, () => [{ product_id: 'p9', units: '5' }]],
    ])
    const r = await postgresRanking(store, { window: '24h', limit: 5, categoryId: 'c1' }, NOW)
    expect(r.windowApplied).toBe('24h')
    expect(r.products).toEqual([{ rank: 1, productId: 'p9', unitsSold: 5 }])
  })
})

describe('HTTP endpoints', () => {
  let ta: TestAuth
  let headers: Record<string, string>
  beforeAll(async () => {
    ta = await createTestAuth()
    headers = { authorization: `Bearer ${await ta.sign({ sub: 'v1', role: 'VENDOR' })}` }
  })

  async function build(rankings: RankingEngine | undefined, store = stubStore()) {
    const server = fastify({ ...securityServerOptions({}), logger: false })
    await registerAnalyticsSecurity(server, {
      redis: null,
      overrides: {
        jwks: ta.jwks,
        store: new MemoryRateStore(),
        config: {
          authMode: 'enforce',
          rateLimitMode: 'enforce',
          issuer: ta.issuer,
          audience: ta.audience,
          serviceAuthSecret: 'unit-test-internal-secret-0123456789',
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
    registerAnalyticsRoutes(server, { store, rankings })
    await server.ready()
    return server
  }

  const servers: FastifyInstance[] = []
  afterAll(async () => Promise.all(servers.map((s) => s.close())))

  it('serves from redis and says so', async () => {
    const redis = new FakeRedis()
    const engine = new RankingEngine(redis, stubStore(), { now: () => Date.now() })
    await engine.rebuild()
    await engine.recordOrder({
      occurredAt: new Date(),
      lines: [{ productId: 'p1', categoryId: 'c1', quantity: 3 }],
    })
    const server = await build(engine)
    servers.push(server)

    const top = await server.inject({
      url: '/api/v1/analytics/rankings/top-products?limit=5&window=1h',
      headers,
    })
    expect(top.statusCode).toBe(200)
    expect(top.json()).toMatchObject({
      source: 'redis',
      window: '1h',
      windowApplied: '1h',
      limit: 5,
      products: [{ rank: 1, productId: 'p1', unitsSold: 3 }],
    })

    const cat = await server.inject({
      url: '/api/v1/analytics/rankings/category/c1',
      headers,
    })
    expect(cat.json()).toMatchObject({
      source: 'redis',
      window: '24h',
      categoryId: 'c1',
      products: [{ rank: 1, productId: 'p1', unitsSold: 3 }],
    })
  })

  it('falls back to Postgres when redis is down', async () => {
    const redis = new FakeRedis()
    redis.failing = true
    const store = stubStore([
      [
        /FROM ms_analytics\.product_counters/,
        () => [
          { product_id: 'pg1', sku: '', units_ordered: '4', times_ordered: '1', revenue: '0' },
        ],
      ],
    ])
    const server = await build(new RankingEngine(redis, store), store)
    servers.push(server)
    const res = await server.inject({ url: '/api/v1/analytics/rankings/top-products', headers })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      source: 'postgres',
      windowApplied: 'all-time',
      products: [{ rank: 1, productId: 'pg1', unitsSold: 4 }],
    })
  })

  it('answers from Postgres when there is no redis engine (KV driver not redis)', async () => {
    const server = await build(undefined)
    servers.push(server)
    const res = await server.inject({ url: '/api/v1/analytics/rankings/top-products', headers })
    expect(res.json()).toMatchObject({ source: 'postgres', products: [] })
  })

  it.each([
    '/api/v1/analytics/rankings/top-products?limit=0',
    '/api/v1/analytics/rankings/top-products?limit=101',
    '/api/v1/analytics/rankings/top-products?window=2h',
    '/api/v1/analytics/rankings/top-products?foo=1',
    '/api/v1/analytics/rankings/category/bad%20id',
    '/api/v1/analytics/rankings/category/c1?window=30d',
    '/api/v1/analytics/rankings/category/c1?extra=1',
  ])('rejects %s with 400', async (url) => {
    const server = await build(undefined)
    servers.push(server)
    const res = await server.inject({ url, headers })
    expect(res.statusCode).toBe(400)
  })

  it('requires analytics:read', async () => {
    const server = await build(undefined)
    servers.push(server)
    expect(
      (await server.inject({ url: '/api/v1/analytics/rankings/top-products' })).statusCode
    ).toBe(401)
    const customer = { authorization: `Bearer ${await ta.sign({ sub: 'c', role: 'CUSTOMER' })}` }
    expect(
      (
        await server.inject({
          url: '/api/v1/analytics/rankings/top-products',
          headers: customer,
        })
      ).statusCode
    ).toBe(403)
  })
})

// ─── Real Postgres: idempotency through the real claim ─────────────────────

const HAS_DB = Boolean(process.env.ANALYTICS_DATABASE_URL)
const dbDescribe = HAS_DB ? describe : describe.skip

dbDescribe('order.created -> ranks (real Postgres, throwaway schema)', () => {
  const SCHEMA = `test_rank_${crypto.randomBytes(6).toString('hex')}`
  let store: AnalyticsStore

  beforeAll(async () => {
    const pool = getServicePool('analytics').pool
    await pool.query(`CREATE SCHEMA ${SCHEMA}`)
    for (const f of fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      await pool.query(
        fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').replace(/\{\{schema\}\}/g, SCHEMA)
      )
    }
    store = createAnalyticsStoreOn(pool, SCHEMA)
  })
  afterAll(async () => {
    await getServicePool('analytics')
      .pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
      .catch(() => undefined)
    await closeServicePools()
  })

  const CONTEXT: EventContext = { topic: 'ecommerce.orders.v1', partition: 0, offset: '1' }
  function orderCreated(eventId: string, occurredAt: string, items: unknown[]): EventEnvelope {
    return {
      eventId,
      eventType: 'order.created',
      eventVersion: 1,
      occurredAt,
      producer: 'test',
      correlationId: 'c',
      payload: {
        orderId: `o-${eventId}`,
        orderNumber: 'ORD-1',
        userId: 'u',
        customerEmail: 'a@example.com',
        status: 'PENDING',
        totalAmount: 10,
        currency: 'USD',
        items,
      },
    } as unknown as EventEnvelope
  }

  it('does not double count a redelivered eventId, and rebuilds the same ranks', async () => {
    const redis = new FakeRedis()
    const engine = new RankingEngine(redis, store, { now: () => Date.now() })
    await engine.rebuild()
    const deps = { store, log: () => undefined, rankings: engine }
    const at = new Date().toISOString()
    const items = [
      { productId: 'p1', sku: 's1', quantity: 2, unitPrice: 5, categoryId: 'c1' },
      { productId: 'p1', sku: 's1', quantity: 1, unitPrice: 5, categoryId: 'c1' },
      { productId: 'p2', sku: 's2', quantity: 1, unitPrice: 5 },
    ]

    await handleOrderCreated(deps, orderCreated('e-1', at, items), CONTEXT)
    await handleOrderCreated(deps, orderCreated('e-1', at, items), CONTEXT) // redelivery
    await handleOrderCreated(deps, orderCreated('e-2', at, [items[2]]), CONTEXT)

    const live = await engine.top({ window: '1h', limit: 10 })
    expect(live.products.map((p) => [p.productId, p.unitsSold])).toEqual([
      ['p1', 3],
      ['p2', 2],
    ])
    const liveCat = await engine.top({ window: '24h', limit: 10, categoryId: 'c1' })
    expect(liveCat.products).toEqual([{ rank: 1, productId: 'p1', unitsSold: 3 }])

    const { rows } = await store.db.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.sales_lines`)
    expect(rows[0].n).toBe(3) // e-1/p1, e-1/p2, e-2/p2 -- the redelivery added none

    // Flush Redis; the rebuild from sales_lines reproduces the same ranks.
    redis.flush()
    const rebuilt = await engine.top({ window: '1h', limit: 10 })
    expect(rebuilt.products).toEqual(live.products)
    expect((await engine.top({ window: '7d', limit: 10, categoryId: 'c1' })).products).toEqual(
      liveCat.products
    )

    // Postgres fallbacks read the same data.
    const pgCat = await postgresRanking(store, { window: '24h', limit: 10, categoryId: 'c1' })
    expect(pgCat.products).toEqual([{ rank: 1, productId: 'p1', unitsSold: 3 }])
    const pgGlobal = await postgresRanking(store, { window: '24h', limit: 10 })
    expect(pgGlobal.products.map((p) => [p.productId, p.unitsSold])).toEqual([
      ['p1', 3],
      ['p2', 2],
    ])
  })

  it('writes nothing for an unparseable occurredAt', async () => {
    const redis = new FakeRedis()
    const engine = new RankingEngine(redis, store, { now: () => Date.now() })
    await engine.rebuild()
    const before = redis.keys().length
    const deps = { store, log: () => undefined, rankings: engine }
    await handleOrderCreated(
      deps,
      orderCreated('e-bad-1', 'not-a-date', [
        { productId: 'px', sku: 's', quantity: 1, unitPrice: 1 },
      ]),
      CONTEXT
    )
    expect(redis.keys().length).toBe(before)
  })
})

// ─── Live infra-redis (skipped when unreachable) ───────────────────────────

describe('live Redis (unique prefix, deleted afterwards)', () => {
  const PREFIX = `rank-test-${crypto.randomBytes(5).toString('hex')}`
  let client: (RankRedis & { disconnect(): void }) | null = null
  let reachable = false

  beforeAll(async () => {
    const host = process.env.REDIS_HOST === 'localhost' ? '127.0.0.1' : process.env.REDIS_HOST
    const c = createRankRedis({
      host: host ?? '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB ?? '0', 10),
    })
    await new Promise((r) => setTimeout(r, 1_200))
    try {
      await c.exists(`${PREFIX}:ping`)
      client = c
      reachable = true
    } catch {
      c.disconnect()
    }
  })

  afterAll(async () => {
    if (!client) return
    let cursor = '0'
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', `${PREFIX}:*`, 'COUNT', 500)
      if (keys.length > 0)
        await client
          .multi()
          .del(...keys)
          .exec()
      cursor = next
    } while (cursor !== '0')
    client.disconnect()
  })

  it('ranks, rotates keys with TTL, and rebuilds after the keys vanish', async () => {
    if (!reachable || !client) {
      console.warn('live Redis not reachable: live test skipped')
      return
    }
    const bucketMs = WINDOW_SPECS['1h'].bucketMs
    const store = stubStore([
      [
        /GROUP BY product_id, category_id, bucket/,
        (params) => [
          {
            product_id: 'live1',
            category_id: 'cat-live',
            bucket: String(Math.floor(Date.now() / (params[1] as number))),
            units: '5',
          },
        ],
      ],
    ])
    const engine = new RankingEngine(client, store, { prefix: PREFIX })
    await engine.recordOrder({
      occurredAt: new Date(),
      lines: [
        { productId: 'live1', categoryId: 'cat-live', quantity: 2 },
        { productId: 'live2', categoryId: null, quantity: 7 },
      ],
    })
    // ready marker present -> no rebuild, pure ZSET path
    await client.multi().set(`${PREFIX}:meta:ready`, 'x').exec()

    const top = await engine.top({ window: '1h', limit: 5 })
    expect(top.source).toBe('redis')
    expect(top.products).toEqual([
      { rank: 1, productId: 'live2', unitsSold: 7 },
      { rank: 2, productId: 'live1', unitsSold: 2 },
    ])
    const cat = await engine.top({ window: '24h', limit: 5, categoryId: 'cat-live' })
    expect(cat.products).toEqual([{ rank: 1, productId: 'live1', unitsSold: 2 }])

    // Every key written carries a TTL (the ready marker is the only one without).
    const pipe = client.multi() as unknown as { pttl(k: string): unknown; exec(): Promise<unknown> }
    const bucketKey = `${PREFIX}:global:1h:b${Math.floor(Date.now() / bucketMs)}`
    pipe.pttl(bucketKey)
    const ttl = (await pipe.exec()) as [Error | null, number][]
    expect(ttl[0]?.[1]).toBeGreaterThan(0)

    // Wipe the keys (a flush of our prefix), then read: rebuilt from Postgres.
    const [, keys] = await client.scan('0', 'MATCH', `${PREFIX}:*`, 'COUNT', 500)
    await client
      .multi()
      .del(...keys)
      .exec()
    expect(await engine.isReady()).toBe(false)
    const rebuilt = await engine.top({ window: '1h', limit: 5 })
    expect(rebuilt.products).toEqual([{ rank: 1, productId: 'live1', unitsSold: 5 }])
    expect(await engine.isReady()).toBe(true)
  })
})
