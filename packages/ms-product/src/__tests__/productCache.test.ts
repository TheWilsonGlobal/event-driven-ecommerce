import type { FastifyInstance } from 'fastify'
import { bearer, buildApp, type TestApp } from './testApp'
import { FakeRedis } from './fakeRedis'
import { ProductCache, cacheKey, lockKey } from '../cache/productCache'

const open: FastifyInstance[] = []
async function app(redis?: FakeRedis | null): Promise<TestApp> {
  const a = await buildApp({ redis: redis ?? null })
  open.push(a.server)
  return a
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()))
})

const get = (a: TestApp, id: string) => a.server.inject({ url: `/api/v1/products/${id}` })

describe('GET /products/:id cache-aside', () => {
  it('miss fills Redis with a jittered TTL, hit skips the store, bodies identical', async () => {
    const redis = new FakeRedis()
    const a = await app(redis)
    const first = await get(a, 'prod-a')
    const second = await get(a, 'prod-a')
    expect(first.statusCode).toBe(200)
    expect(second.json()).toEqual(first.json())
    expect(a.products.findOneCalls).toBe(1)
    expect(a.cacheResults).toMatchObject({ miss: 1, hit: 1 })
    expect(redis.data.has(cacheKey('prod-a'))).toBe(true)
    const ttl = redis.ttls.get(cacheKey('prod-a')) as number
    expect(ttl).toBeGreaterThanOrEqual(3600)
    expect(ttl).toBeLessThanOrEqual(3900)
    // the lock is released after the fill
    expect(redis.data.has(lockKey('prod-a'))).toBe(false)
  })

  it('TTL jitter spans the 3600..3900 range', () => {
    const lo = new ProductCache({ redis: null, random: () => 0 })
    const hi = new ProductCache({ redis: null, random: () => 0.999999 })
    expect(lo.ttlSeconds()).toBe(3600)
    expect(hi.ttlSeconds()).toBe(3900)
  })

  it('does not cache a 404', async () => {
    const redis = new FakeRedis()
    const a = await app(redis)
    expect((await get(a, 'nope')).statusCode).toBe(404)
    expect((await get(a, 'nope')).statusCode).toBe(404)
    expect(a.products.findOneCalls).toBe(2)
    expect(redis.data.has(cacheKey('nope'))).toBe(false)
  })

  it('single-flight: 25 parallel misses read the store once', async () => {
    const redis = new FakeRedis()
    redis.latencyMs = 2
    const a = await app(redis)
    a.products.findOneDelayMs = 40
    const res = await Promise.all(Array.from({ length: 25 }, () => get(a, 'prod-a')))
    expect(res.every((r) => r.statusCode === 200)).toBe(true)
    expect(a.products.findOneCalls).toBe(1)
    expect(new Set(res.map((r) => r.body)).size).toBe(1)
  })

  it('single-flight also holds with no Redis at all', async () => {
    const a = await app(null)
    a.products.findOneDelayMs = 40
    const res = await Promise.all(Array.from({ length: 25 }, () => get(a, 'prod-a')))
    expect(res.every((r) => r.statusCode === 200)).toBe(true)
    expect(a.products.findOneCalls).toBe(1)
  })

  it('falls back to direct reads, without errors, when Redis is down', async () => {
    const redis = new FakeRedis()
    redis.down = true
    const a = await app(redis)
    expect((await get(a, 'prod-a')).statusCode).toBe(200)
    expect((await get(a, 'prod-a')).statusCode).toBe(200)
    expect(a.products.findOneCalls).toBe(2)
    expect(a.cacheResults.hit).toBe(0)
    // and writes still succeed, invalidation failing quietly
    const t = await a.tokens()
    const patch = await a.server.inject({
      method: 'PATCH',
      url: '/api/v1/products/prod-a',
      headers: bearer(t.ADMIN_AAL2),
      payload: { price: 99 },
    })
    expect(patch.statusCode).toBe(200)
  })

  it('waits for another replica holding the lock, then serves its fill', async () => {
    const redis = new FakeRedis()
    const a = await app(redis)
    redis.data.set(lockKey('prod-a'), '1') // someone else is loading
    setTimeout(
      () =>
        redis.data.set(
          cacheKey('prod-a'),
          JSON.stringify({ ...a.products.docs[1], title: 'From peer' })
        ),
      60
    )
    const res = await get(a, 'prod-a')
    expect(res.json().title).toBe('From peer')
    expect(a.products.findOneCalls).toBe(0)
  })

  describe('invalidation', () => {
    it.each([
      ['PATCH price', 'PATCH', { price: 55 }],
      ['PATCH stock', 'PATCH', { stock: 0 }],
      ['DELETE', 'DELETE', undefined],
    ])('%s drops the entry', async (_n, method, payload) => {
      const redis = new FakeRedis()
      const a = await app(redis)
      const t = await a.tokens()
      expect((await get(a, 'prod-a')).json().price).toBe(10)
      expect(redis.data.has(cacheKey('prod-a'))).toBe(true)

      const w = await a.server.inject({
        method: method as 'PATCH' | 'DELETE',
        url: '/api/v1/products/prod-a',
        headers: bearer(t.ADMIN_AAL2),
        ...(payload ? { payload } : {}),
      })
      expect(w.statusCode).toBe(200)
      expect(redis.data.has(cacheKey('prod-a'))).toBe(false)

      const after = await get(a, 'prod-a')
      if (method === 'DELETE') expect(after.statusCode).toBe(404)
      else expect(after.json()).toMatchObject(payload as object)
    })

    it('a load in flight during a write cannot write its stale result back', async () => {
      const redis = new FakeRedis()
      const a = await app(redis)
      const t = await a.tokens()
      a.products.findOneDelayMs = 50
      const slowRead = get(a, 'prod-a') // reads price 10, finishes after the write
      await new Promise((r) => setTimeout(r, 10))
      a.products.findOneDelayMs = 0
      await a.server.inject({
        method: 'PATCH',
        url: '/api/v1/products/prod-a',
        headers: bearer(t.ADMIN_AAL2),
        payload: { price: 77 },
      })
      await slowRead
      expect(redis.data.has(cacheKey('prod-a'))).toBe(false)
      expect((await get(a, 'prod-a')).json().price).toBe(77)
    })

    it('create drops any stale key for the new id', async () => {
      const redis = new FakeRedis()
      const a = await app(redis)
      const t = await a.tokens()
      redis.data.set(cacheKey('prod-new'), '{"id":"prod-new","title":"ghost"}')
      const r = await a.server.inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: bearer(t.ADMIN_AAL2),
        payload: { id: 'prod-new', title: 'Real', slug: 'real', sku: 'R-1', price: 5 },
      })
      expect(r.statusCode).toBe(201)
      expect((await get(a, 'prod-new')).json().title).toBe('Real')
    })

    it('ownership checks on writes read the store, not the cache', async () => {
      const redis = new FakeRedis()
      const a = await app(redis)
      const t = await a.tokens()
      await get(a, 'prod-b') // cached
      const r = await a.server.inject({
        method: 'PATCH',
        url: '/api/v1/products/prod-b', // owned by vendor-b; token is vendor-a
        headers: bearer(t.VENDOR),
        payload: { price: 1 },
      })
      expect(r.statusCode).toBe(404)
      expect(redis.data.has(cacheKey('prod-b'))).toBe(true)
    })
  })
})
