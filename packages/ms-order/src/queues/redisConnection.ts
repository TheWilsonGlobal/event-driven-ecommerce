import IORedis from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { loadDatabaseConfig } from '@ecommerce/shared-database'

/**
 * Redis connection management for ms-order's BullMQ queues.
 *
 * Design constraints this module exists to satisfy:
 *
 *  1. ms-order MUST boot and serve the order API even when Redis is down.
 *     Nothing here throws at import/construction time; failures surface as a
 *     503 from the queue/cache endpoints instead.
 *  2. An unhandled 'error' event on an ioredis client is an unhandled
 *     exception that kills the process. EVERY connection created here gets an
 *     'error' handler attached before it can emit.
 *  3. A down Redis must make the introspection endpoints fail FAST, not hang.
 *     `enableOfflineQueue: false` makes commands reject immediately rather
 *     than buffering until a reconnect that may never come, and the bounded
 *     `retryStrategy` stops the reconnect loop from becoming a storm.
 */

const dbConfig = loadDatabaseConfig(process.env)

/** Max reconnect attempts before ioredis gives up on a dead Redis. */
const MAX_RECONNECT_ATTEMPTS = 10

/** Command timeout — keeps the 503 path fast when Redis is unreachable. */
const COMMAND_TIMEOUT_MS = 2000

export type RedisRole = 'queue' | 'worker' | 'scan'

/**
 * Base connection options derived from `loadDatabaseConfig()`.
 *
 * NOTE on `password`: shared-database sets `password: env.REDIS_PASSWORD ?? undefined`,
 * and the root .env sets REDIS_PASSWORD to an EMPTY STRING — which is not
 * nullish, so it survives as ''. Passing `password: ''` to ioredis makes it
 * issue `AUTH ''` against an auth-less Redis, which fails with
 * "ERR Client sent AUTH, but no password is set". We therefore only include
 * the key at all when the value is truthy.
 */
function baseOptions(): RedisOptions {
  const { host, port, password, db } = dbConfig.keyValue.redis

  const options: RedisOptions = {
    host,
    port,
    db,
    // Fail fast instead of buffering commands while Redis is unreachable.
    enableOfflineQueue: false,
    connectTimeout: COMMAND_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    // Bounded reconnection: back off, then stop retrying so a dead Redis does
    // not produce an endless reconnect storm in the logs.
    retryStrategy(times: number) {
      if (times > MAX_RECONNECT_ATTEMPTS) {
        return null
      }
      return Math.min(times * 200, 3000)
    },
    lazyConnect: false,
  }

  // Only send AUTH when a non-empty password is configured. See note above.
  if (password) {
    options.password = password
  }

  return options
}

/**
 * Options for a connection that a BullMQ Worker will use.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on Worker connections: the
 * worker issues long-running blocking commands (BRPOPLPUSH/BZPOPMIN) and
 * ioredis' default `maxRetriesPerRequest: 20` would abort them. BullMQ throws
 * at Worker construction if this is not set.
 *
 * Blocking commands also mean a Worker connection must NOT have a
 * `commandTimeout` — the blocking read legitimately outlives it — and must
 * keep its offline queue so it can resume after a reconnect.
 */
function workerOptions(): RedisOptions {
  const options = baseOptions()
  delete options.commandTimeout
  return {
    ...options,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  }
}

/** Every connection this module hands out, for graceful shutdown. */
const connections: IORedis[] = []

/** Most recent connection error per role — surfaced in the 503 reason. */
let lastError: Error | null = null

export function getLastRedisError(): Error | null {
  return lastError
}

/**
 * Creates an ioredis client with an 'error' handler already attached.
 *
 * `role` selects the option profile: 'worker' connections get BullMQ's
 * required blocking-command settings, everything else gets the fail-fast
 * profile.
 */
export function createRedisConnection(role: RedisRole, label: string): IORedis {
  const options = role === 'worker' ? workerOptions() : baseOptions()
  const client = new IORedis(options)

  // CRITICAL: without this listener an 'error' event is an unhandled
  // exception and takes the whole ms-order process down when Redis is absent.
  client.on('error', (err: Error) => {
    lastError = err
    // Connection-refused spam while Redis is down is expected and already
    // reflected in the endpoints' 503; log at debug volume via console.warn
    // once per distinct message rather than on every retry tick.
    logConnectionErrorOnce(label, err)
  })

  connections.push(client)
  return client
}

const seenErrorMessages = new Set<string>()

function logConnectionErrorOnce(label: string, err: Error): void {
  const key = `${label}:${err.message}`
  if (seenErrorMessages.has(key)) {
    return
  }
  seenErrorMessages.add(key)
  // eslint-disable-next-line no-console
  console.warn(`[Order Service] Redis connection "${label}" error: ${err.message}`)
}

/**
 * True when the shared connection is in a state where a command can be issued.
 * ioredis statuses: 'connecting' | 'connect' | 'ready' | 'close' | 'reconnecting' | 'end'
 */
export function isConnectionUsable(client: IORedis): boolean {
  return client.status === 'ready' || client.status === 'connect'
}

/** Closes every connection created through this module. */
export async function closeAllRedisConnections(): Promise<void> {
  await Promise.all(
    connections.map(async (client) => {
      try {
        // quit() sends QUIT and waits; if the socket is already dead it can
        // hang, so fall back to an immediate disconnect.
        if (client.status === 'end') {
          return
        }
        await client.quit()
      } catch {
        client.disconnect()
      }
    })
  )
  connections.length = 0
}

export const redisSettings = dbConfig.keyValue.redis
export const keyValueDriver = dbConfig.keyValue.driver
