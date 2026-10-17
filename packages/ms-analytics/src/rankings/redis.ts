import { Redis } from 'ioredis'
import type { RankRedis } from './engine'

export interface RankRedisConfig {
  host: string
  port: number
  password?: string | undefined
  db?: number | undefined
}

/**
 * The rank engine's Redis client. Same fail-fast settings as the rate limiter's
 * (shared-security register.ts): with Redis down a command rejects within
 * ~200 ms instead of queueing, so the endpoints fall back to Postgres at once
 * and the consumer's post-commit write fails quickly rather than stalling Kafka.
 */
export function createRankRedis(config: RankRedisConfig): RankRedis & { disconnect(): void } {
  const client = new Redis({
    host: config.host,
    port: config.port,
    ...(config.password ? { password: config.password } : {}),
    db: config.db ?? 0,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    connectTimeout: 1_000,
    retryStrategy: (n) => Math.min(n * 500, 5_000),
  })
  client.on('error', () => undefined) // surfaced through each command's rejection
  client.connect().catch(() => undefined)
  return client as unknown as RankRedis & { disconnect(): void }
}
