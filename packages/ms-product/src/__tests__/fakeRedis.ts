import type { CacheRedis } from '../cache/productCache'

/** In-memory stand-in for the four Redis calls the product cache makes. TTLs are recorded, not enforced. */
export class FakeRedis implements CacheRedis {
  data = new Map<string, string>()
  ttls = new Map<string, number>()
  calls: string[] = []
  /** When set, every command rejects like a down Redis. */
  down = false
  /** Artificial latency per command, so concurrent callers interleave. */
  latencyMs = 0

  private async gate(op: string): Promise<void> {
    this.calls.push(op)
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs))
    if (this.down) throw new Error('Connection is closed')
  }

  async get(key: string) {
    await this.gate(`GET ${key}`)
    return this.data.get(key) ?? null
  }

  async set(key: string, value: string, _mode: 'EX', seconds: number, flag?: 'NX') {
    await this.gate(`SET ${key}${flag ? ' NX' : ''}`)
    if (flag === 'NX' && this.data.has(key)) return null
    this.data.set(key, value)
    this.ttls.set(key, seconds)
    return 'OK' as const
  }

  async del(...keys: string[]) {
    await this.gate(`DEL ${keys.join(' ')}`)
    let n = 0
    for (const k of keys) if (this.data.delete(k)) n += 1
    return n
  }
}
