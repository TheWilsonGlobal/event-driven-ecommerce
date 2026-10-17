import IORedis from 'ioredis'

/**
 * Cache-aside for GET /api/v1/products/:id (plan: 03-system-design-patterns, Feature 6).
 *
 *   hit   -> Redis `cache:product:{id}` holds the JSON product; return it.
 *   miss  -> single-flight: concurrent misses for one id share ONE store read.
 *            Inside a process that is a promise map; across processes a short
 *            Redis lock `lock:fetch:product:{id}` (SET NX EX) makes the other
 *            replicas poll the cache instead of reading the store.
 *   fill  -> SET with a jittered TTL (3600 + random 0..300 s) so keys written
 *            together do not expire together.
 *   write -> every product write/delete/stock change DELs the key (`invalidate`).
 *
 * Only found products are cached; a 404 is never stored. Nothing user specific is
 * ever cached: the route is public and the value is the product document itself.
 *
 * Redis is an optimisation, never a dependency: every Redis call is wrapped, and
 * any failure degrades to a direct store read (counted as `bypass`). With no
 * Redis configured (`redis: null`) the single-flight map still coalesces.
 *
 * Staleness bound: an invalidation DEL runs after the store write commits and
 * also bumps an in-process generation, so a load that was already in flight when
 * the write landed cannot write its (older) result back. If the DEL itself fails
 * (Redis blip) the stale entry lives until its TTL (<= 3900 s); that is logged.
 */

export const CACHE_TTL_BASE_SECONDS = 3600
export const CACHE_TTL_JITTER_SECONDS = 300
export const LOCK_TTL_SECONDS = 5
const LOCK_POLL_MS = 25
const LOCK_WAIT_MS = 1000

/** The slice of ioredis this cache uses; a fake implements the same four calls. */
export interface CacheRedis {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: 'EX', seconds: number, flag?: 'NX'): Promise<'OK' | null>
  del(...keys: string[]): Promise<number>
  quit?(): Promise<unknown>
}

export type CacheResult = 'hit' | 'miss' | 'coalesced' | 'bypass'

export interface CacheCounter {
  inc(labels: { result: CacheResult }): void
}

export interface CacheLogger {
  warn(msg: string): void
}

export interface ProductCacheOptions {
  redis: CacheRedis | null
  counter?: CacheCounter | undefined
  log?: CacheLogger | undefined
  /** Injectable for tests; returns [0,1). */
  random?: (() => number) | undefined
}

export const cacheKey = (id: string): string => `cache:product:${id}`
export const lockKey = (id: string): string => `lock:fetch:product:${id}`

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class ProductCache<T extends object> {
  private readonly redis: CacheRedis | null
  private readonly counter: CacheCounter | undefined
  private readonly log: CacheLogger | undefined
  private readonly random: () => number
  private readonly inflight = new Map<string, Promise<T | null>>()
  /** Bumped by invalidate(); a load only writes back if it did not change. */
  private readonly generation = new Map<string, number>()
  private degraded = false

  constructor(opts: ProductCacheOptions) {
    this.redis = opts.redis
    this.counter = opts.counter
    this.log = opts.log
    this.random = opts.random ?? Math.random
  }

  /** TTL in seconds for one write-back: 3600 + random(0, 300). */
  ttlSeconds(): number {
    return CACHE_TTL_BASE_SECONDS + Math.floor(this.random() * (CACHE_TTL_JITTER_SECONDS + 1))
  }

  /** Returns the product, from cache if present, else `load()` (once per id at a time). */
  async getOrLoad(id: string, load: () => Promise<T | null>): Promise<T | null> {
    const cached = await this.readCache(id)
    if (cached) {
      this.counter?.inc({ result: 'hit' })
      return cached
    }

    const existing = this.inflight.get(id)
    if (existing) {
      this.counter?.inc({ result: 'coalesced' })
      return existing
    }

    const flight = this.fill(id, load).finally(() => {
      if (this.inflight.get(id) === flight) this.inflight.delete(id)
    })
    this.inflight.set(id, flight)
    return flight
  }

  /** Drop the cached entry (and orphan any in-flight load) after a write. Never throws. */
  async invalidate(id: string): Promise<void> {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1)
    this.inflight.delete(id)
    if (!this.redis) return
    try {
      await this.redis.del(cacheKey(id))
      this.recovered()
    } catch (err) {
      this.failed(`DEL ${cacheKey(id)} failed; entry may stay stale until its TTL: ${err}`)
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis?.quit?.()
    } catch {
      /* closing a dead connection is not an error worth surfacing */
    }
  }

  private async fill(id: string, load: () => Promise<T | null>): Promise<T | null> {
    const startGen = this.generation.get(id) ?? 0
    let locked = false

    if (this.redis) {
      try {
        locked = (await this.redis.set(lockKey(id), '1', 'EX', LOCK_TTL_SECONDS, 'NX')) === 'OK'
        this.recovered()
        if (!locked) {
          // Another replica is loading this id: give it a moment to fill the cache.
          const deadline = Date.now() + LOCK_WAIT_MS
          while (Date.now() < deadline) {
            await sleep(LOCK_POLL_MS)
            const filled = await this.readCache(id)
            if (filled) {
              this.counter?.inc({ result: 'coalesced' })
              return filled
            }
          }
        }
      } catch (err) {
        this.failed(`lock/poll for product ${id} failed: ${err}`)
      }
    }

    try {
      this.counter?.inc({ result: this.redis && !this.degraded ? 'miss' : 'bypass' })
      const value = await load()
      if (value && this.redis && (this.generation.get(id) ?? 0) === startGen) {
        try {
          await this.redis.set(cacheKey(id), JSON.stringify(value), 'EX', this.ttlSeconds())
        } catch (err) {
          this.failed(`SET ${cacheKey(id)} failed: ${err}`)
        }
      }
      return value
    } finally {
      if (locked && this.redis) {
        try {
          await this.redis.del(lockKey(id))
        } catch {
          /* the lock expires on its own after LOCK_TTL_SECONDS */
        }
      }
    }
  }

  private async readCache(id: string): Promise<T | null> {
    if (!this.redis) return null
    try {
      const raw = await this.redis.get(cacheKey(id))
      this.recovered()
      if (raw === null) return null
      return JSON.parse(raw) as T
    } catch (err) {
      // Unreachable Redis or an unparseable value: treat as a miss and read the store.
      this.failed(`GET ${cacheKey(id)} failed: ${err}`)
      return null
    }
  }

  private failed(msg: string): void {
    if (!this.degraded) this.log?.warn(`[ProductCache] ${msg}; falling back to direct reads`)
    this.degraded = true
  }

  private recovered(): void {
    this.degraded = false
  }
}

/** Fail-fast ioredis client for the cache: commands reject at once while Redis is down. */
export function createCacheRedis(
  settings: { host: string; port: number; password?: string | undefined; db: number },
  log?: CacheLogger
): CacheRedis {
  const client = new IORedis({
    host: settings.host,
    port: settings.port,
    db: settings.db,
    ...(settings.password ? { password: settings.password } : {}),
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  })
  // An unhandled 'error' event on an ioredis client would kill the process.
  client.on('error', (err) => log?.warn(`[ProductCache] redis: ${err.message}`))
  return client as unknown as CacheRedis
}
