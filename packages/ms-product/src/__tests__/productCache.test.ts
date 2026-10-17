import type { FastifyInstance } from 'fastify'
import { signServiceToken } from '@ecommerce/shared-security'
import { TEST_SERVICE_SECRET, bearer, buildApp, type TestApp } from './testApp'
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

describe('service identities bypass the cache', () => {
  const svcGet = async (a: TestApp, id: string) =>
    a.server.inject({
      url: `/api/v1/products/${id}`,
      headers: {
        authorization: `Bearer ${await signServiceToken(TEST_SERVICE_SECRET, 'ms-order')}`,
      },
    })

  it('never reads a stale cached price and never writes back', async () => {
    const redis = new FakeRedis()
    const a = await app(redis)
    expect((await get(a, 'prod-a')).statusCode).toBe(200) // fills the cache at price 10
    a.products.docs[1]!.price = 77 // store changed; cache still holds 10
    const svc = await svcGet(a, 'prod-a')
    expect(svc.json().price).toBe(77)
    expect((await get(a, 'prod-a')).json().price).toBe(10) // shoppers still hit the cache
    // and a service read on a cold key does not populate it
    redis.data.clear()
    redis.calls.length = 0
    expect((await svcGet(a, 'prod-a')).statusCode).toBe(200)
    expect(redis.data.has(cacheKey('prod-a'))).toBe(false)
    expect(redis.calls).toEqual([])
  })
})

describe('ProductCache internals', () => {
  const flush = () => new Promise((r) => setTimeout(r, 5))

  it('a late cross-replica write-back is removed by the delayed DEL', async () => {
    const redis = new FakeRedis()
    const c = new ProductCache<{ v: number }>({ redis, delayedDelMs: 20 })
    await c.invalidate('p')
    redis.data.set(cacheKey('p'), JSON.stringify({ v: 'stale' })) // peer SETs after our DEL
    await new Promise((r) => setTimeout(r, 40))
    expect(redis.data.has(cacheKey('p'))).toBe(false)
    await c.close()
  })

  it('close() cancels pending delayed DELs', async () => {
    const redis = new FakeRedis()
    const c = new ProductCache<{ v: number }>({ redis, delayedDelMs: 20 })
    await c.invalidate('p')
    await c.close()
    redis.data.set(cacheKey('p'), '{}')
    await new Promise((r) => setTimeout(r, 40))
    expect(redis.data.has(cacheKey('p'))).toBe(true)
  })

  it('lock release is owned: a foreign token is not deleted', async () => {
    const redis = new FakeRedis()
    const c = new ProductCache<{ v: number }>({ redis, delayedDelMs: 1000 })
    const p = c.getOrLoad('p', async () => {
      redis.data.set(lockKey('p'), 'someone-elses-token') // our lock expired, a peer took it
      return { v: 1 }
    })
    await p
    expect(redis.data.get(lockKey('p'))).toBe('someone-elses-token')
    await c.close()
  })

  it('lock release deletes our own token', async () => {
    const redis = new FakeRedis()
    const c = new ProductCache<{ v: number }>({ redis })
    await c.getOrLoad('p', async () => ({ v: 1 }))
    expect(redis.data.has(lockKey('p'))).toBe(false)
  })

  it('generation map is capped (LRU) and eviction stays conservative', async () => {
    const redis = new FakeRedis()
    const c = new ProductCache<{ v: number }>({ redis, generationCap: 3, delayedDelMs: 1000 })
    let release!: (v: { v: number }) => void
    const slow = c.getOrLoad('a', () => new Promise((r) => (release = r)))
    await flush()
    await c.invalidate('a') // a is now invalidated mid-load
    for (const id of ['b', 'c', 'd', 'e']) await c.invalidate(id) // evicts a
    expect(c.generationSize).toBe(3)
    release({ v: 1 })
    await slow
    expect(redis.data.has(cacheKey('a'))).toBe(false) // stale load must not be written back
    await c.close()
  })

  it('invalidate orphans the in-flight load: the next miss does not wait on it', async () => {
    const redis = new FakeRedis()
    const c = new ProductCache<{ v: number }>({ redis, delayedDelMs: 1000 })
    let release!: (v: { v: number }) => void
    const old = c.getOrLoad('p', () => new Promise((r) => (release = r)))
    await flush()
    expect(redis.data.has(lockKey('p'))).toBe(true)
    await c.invalidate('p')
    expect(redis.data.has(lockKey('p'))).toBe(false) // orphan's lock freed
    const t0 = Date.now()
    const fresh = await c.getOrLoad('p', async () => ({ v: 2 }))
    expect(fresh).toEqual({ v: 2 })
    expect(Date.now() - t0).toBeLessThan(500)
    release({ v: 1 })
    expect(await old).toEqual({ v: 1 }) // caller of the old flight still gets an answer
    expect(JSON.parse(redis.data.get(cacheKey('p')) as string)).toEqual({ v: 2 })
    await c.close()
  })
})
