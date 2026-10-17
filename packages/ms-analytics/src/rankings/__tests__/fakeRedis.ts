import type { RankPipeline, RankRedis } from '../engine'

/**
 * In-memory stand-in for the slice of ioredis the rank engine uses: sorted sets
 * with ZINCRBY / ZADD / ZUNIONSTORE / ZREVRANGE, string keys, absolute expiry,
 * DEL, EXISTS and SCAN. `failing` makes every call reject, like a dead Redis.
 */
export class FakeRedis implements RankRedis {
  zsets = new Map<string, Map<string, number>>()
  strings = new Map<string, string>()
  expireAt = new Map<string, number>()
  failing = false
  execCount = 0

  private checkAlive(): void {
    if (this.failing)
      throw new Error("Stream isn't writeable and enableOfflineQueue options is false")
  }

  has(key: string): boolean {
    return this.zsets.has(key) || this.strings.has(key)
  }

  keys(): string[] {
    return [...this.zsets.keys(), ...this.strings.keys()]
  }

  multi(): RankPipeline {
    const ops: (() => unknown)[] = []
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    const pipe: RankPipeline = {
      zincrby(key, inc, member) {
        ops.push(() => {
          const z = self.zsets.get(key) ?? new Map<string, number>()
          z.set(member, (z.get(member) ?? 0) + inc)
          self.zsets.set(key, z)
          return String(z.get(member))
        })
        return pipe
      },
      pexpireat(key, ms) {
        ops.push(() => {
          self.expireAt.set(key, ms)
          return 1
        })
        return pipe
      },
      pexpire(key, ms) {
        ops.push(() => {
          self.expireAt.set(key, Date.now() + ms)
          return 1
        })
        return pipe
      },
      del(...keys) {
        ops.push(() => {
          let n = 0
          for (const k of keys) {
            if (self.zsets.delete(k) || self.strings.delete(k)) n += 1
            self.expireAt.delete(k)
          }
          return n
        })
        return pipe
      },
      zadd(key, score, member) {
        ops.push(() => {
          const z = self.zsets.get(key) ?? new Map<string, number>()
          z.set(member, score)
          self.zsets.set(key, z)
          return 1
        })
        return pipe
      },
      set(key, value) {
        ops.push(() => {
          self.strings.set(key, value)
          return 'OK'
        })
        return pipe
      },
      zunionstore(dest, _n, ...keys) {
        ops.push(() => {
          const out = new Map<string, number>()
          for (const k of keys) {
            for (const [m, s] of self.zsets.get(k) ?? []) out.set(m, (out.get(m) ?? 0) + s)
          }
          if (out.size === 0) self.zsets.delete(dest)
          else self.zsets.set(dest, out)
          return out.size
        })
        return pipe
      },
      zrevrange(key, start, stop) {
        ops.push(() => {
          const z = [...(self.zsets.get(key) ?? [])].sort(
            (a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)
          )
          return z.slice(start, stop + 1).flatMap(([m, s]) => [m, String(s)])
        })
        return pipe
      },
      async exec() {
        self.execCount += 1
        self.checkAlive()
        return ops.map((op) => [null, op()] as [Error | null, unknown])
      },
    }
    return pipe
  }

  async exists(key: string): Promise<number> {
    this.checkAlive()
    return this.has(key) ? 1 : 0
  }

  async scan(_cursor: string, _m: 'MATCH', pattern: string): Promise<[string, string[]]> {
    this.checkAlive()
    const prefix = pattern.replace(/\*$/, '')
    return ['0', this.keys().filter((k) => k.startsWith(prefix))]
  }

  async quit(): Promise<string> {
    return 'OK'
  }

  /** Simulates FLUSHALL. */
  flush(): void {
    this.zsets.clear()
    this.strings.clear()
    this.expireAt.clear()
  }
}
