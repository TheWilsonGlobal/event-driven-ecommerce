import { randomUUID } from 'crypto'
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
 *
 * Cross-replica race: the generation guard is per process. Replica B may have read
 * the OLD document just before replica A's write and SET it just after A's DEL.
 * Products carry no version/updatedAt to compare-and-set on, so the simplest correct
 * fix is a second, delayed DEL (DELAYED_DEL_MS, default 2 s, unref'd) which removes
 * any such late write-back. Price-critical readers (service identities such as
 * ms-order's PriceVerifier) never use the cache at all; see the route.
 *
 * Lock release is owned: the lock value is a per-flight token and is only DELeted
 * if it still holds that token (GET + compare + DEL; the residual window is
 * microseconds against a 5 s lock), so a slow flight cannot free a newer flight's lock.
 */

export const CACHE_TTL_BASE_SECONDS = 3600
export const CACHE_TTL_JITTER_SECONDS = 300
export const LOCK_TTL_SECONDS = 5
const LOCK_POLL_MS = 25
const LOCK_WAIT_MS = 1000
export const DELAYED_DEL_MS = 2000
/** Max ids remembered in the invalidation-generation map. */
export const GENERATION_CAP = 10_000

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
  /** Delay of the second DEL after an invalidation; injectable for tests. */
  delayedDelMs?: number | undefined
  /** Injectable for tests. */
  generationCap?: number | undefined
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
  /**
   * id -> sequence number of its last invalidation (LRU ordered, capped). A load
   * records `seq` when it starts and writes back only if no invalidation of its id
   * happened since. Evicted entries raise `evictedFloor`, so an id that fell out of
   * the map is treated conservatively (no write-back for loads that began before
   * the eviction), never as "never invalidated".
   */
  private readonly generation = new Map<string, number>()
  private seq = 0
  private evictedFloor = 0
  private readonly delayedDelMs: number
  private readonly generationCap: number
  private readonly timers = new Set<NodeJS.Timeout>()
  private degraded = false

  constructor(opts: ProductCacheOptions) {
    this.redis = opts.redis
    this.counter = opts.counter
    this.log = opts.log
    this.random = opts.random ?? Math.random
    this.delayedDelMs = opts.delayedDelMs ?? DELAYED_DEL_MS
    this.generationCap = opts.generationCap ?? GENERATION_CAP
  }

  /** Number of ids tracked in the generation map (test visibility). */
  get generationSize(): number {
    return this.generation.size
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
    this.bumpGeneration(id)
    // Orphan the in-flight load: the next miss starts its own flight instead of
    // awaiting one that is reading pre-write data.
    this.inflight.delete(id)
    if (!this.redis) return
    try {
      // The orphaned flight may still hold the fetch lock; free it so the next miss
      // does not poll for LOCK_WAIT_MS behind a flight whose result is discarded.
      await this.redis.del(cacheKey(id), lockKey(id))
      this.recovered()
    } catch (err) {
      this.failed(`DEL ${cacheKey(id)} failed; entry may stay stale until its TTL: ${err}`)
    }
    this.scheduleDelayedDel(id)
  }

  private bumpGeneration(id: string): void {
    this.generation.delete(id) // re-insert at the recent end (LRU)
    this.generation.set(id, ++this.seq)
    while (this.generation.size > this.generationCap) {
      const oldest = this.generation.entries().next().value as [string, number]
      this.generation.delete(oldest[0])
      this.evictedFloor = Math.max(this.evictedFloor, oldest[1])
    }
  }

  private scheduleDelayedDel(id: string): void {
    const redis = this.redis
    if (!redis) return
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      this.bumpGeneration(id)
      redis.del(cacheKey(id)).catch((err) => {
        this.failed(`delayed DEL ${cacheKey(id)} failed: ${err}`)
      })
    }, this.delayedDelMs)
    timer.unref()
    this.timers.add(timer)
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    try {
      await this.redis?.quit?.()
    } catch {
      /* closing a dead connection is not an error worth surfacing */
    }
  }

  private async fill(id: string, load: () => Promise<T | null>): Promise<T | null> {
    const startSeq = this.seq
    const token = randomUUID()
    let locked = false

    if (this.redis) {
      try {
        locked = (await this.redis.set(lockKey(id), token, 'EX', LOCK_TTL_SECONDS, 'NX')) === 'OK'
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
      if (value && this.redis && (this.generation.get(id) ?? this.evictedFloor) <= startSeq) {
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
          // Owned release: only free the lock if it is still ours.
          if ((await this.redis.get(lockKey(id))) === token) await this.redis.del(lockKey(id))
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
