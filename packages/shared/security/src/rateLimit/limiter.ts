import type { Redis } from 'ioredis'

/**
 * Fixed-window counters with two interchangeable stores.
 *
 *  - RedisRateStore: shared by every replica and surviving restarts. One Lua
 *    script does INCR + PEXPIRE-on-first-hit + PTTL atomically, so a crash
 *    between the commands can never leave a counter without an expiry.
 *  - MemoryRateStore: per process; for dev, tests and the case where the KV
 *    driver is not Redis. Not a production control across replicas.
 *
 * A store throws when it cannot answer; the plugin then applies the per-tier
 * fail-open / fail-closed policy instead of guessing here.
 */
export interface RateHit {
  count: number
  /** Milliseconds until the window resets. */
  resetMs: number
}

export interface RateStore {
  hit(key: string, windowMs: number): Promise<RateHit>
}

export class MemoryRateStore implements RateStore {
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, windowMs: number): Promise<RateHit> {
    const t = this.now()
    let b = this.buckets.get(key)
    if (!b || b.expiresAt <= t) {
      b = { count: 0, expiresAt: t + windowMs }
      this.buckets.set(key, b)
      if (this.buckets.size > 50_000) this.sweep(t)
    }
    b.count += 1
    return { count: b.count, resetMs: Math.max(0, b.expiresAt - t) }
  }

  private sweep(t: number): void {
    for (const [k, v] of this.buckets) if (v.expiresAt <= t) this.buckets.delete(k)
  }
}

const LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {c, ttl}
`

export class RedisRateStore implements RateStore {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, windowMs: number): Promise<RateHit> {
    const res = (await this.redis.eval(LUA, 1, key, String(windowMs))) as [number, number]
    return { count: Number(res[0]), resetMs: Math.max(0, Number(res[1])) }
  }
}
