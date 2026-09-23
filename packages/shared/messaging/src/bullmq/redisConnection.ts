import IORedis from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { describeError } from '../describeError'

/**
 * Redis connection management for a service's BullMQ queues.
 *
 * Design constraints this module exists to satisfy (originally worked out in
 * ms-order, promoted here 2026-09-19 so ms-product and any future consumer
 * share the same connection behaviour rather than re-deriving it):
 *
 *  1. A service MUST boot and serve its API even when Redis is down. Nothing
 *     here throws at import/construction time; failures surface as a 503 from
 *     the queue/cache endpoints instead.
 *  2. An unhandled 'error' event on an ioredis client is an unhandled
 *     exception that kills the process. EVERY connection created here gets an
 *     'error' handler attached before it can emit.
 *  3. A down Redis must make readiness checks fail FAST, not hang.
 *     `enableOfflineQueue: false` makes commands reject immediately rather
 *     than buffering until a reconnect that may never come.
 *  4. The service must SELF-HEAL when Redis comes back, without a restart.
 *     The `retryStrategy` therefore backs off to a ceiling but never gives up.
 */

export interface RedisKeyValueSettings {
  host: string
  port: number
  password?: string | undefined
  db: number
}

/**
 * Ceiling on the reconnect backoff.
 *
 * The retry strategy deliberately never gives up (never returns null). An
 * earlier version (in ms-order, before this was shared) capped the attempts,
 * which meant that after ~10 failures ioredis stopped reconnecting
 * permanently — so once Redis came back, the queue endpoints stayed at 503
 * until the service was manually restarted. Needing a restart to recover from
 * a Redis blip is worse than a noisy log. Instead we retry indefinitely with
 * the interval backing off to this ceiling, which avoids a reconnection storm
 * while still self-healing.
 */
const MAX_RECONNECT_DELAY_MS = 5000

/** Command timeout — keeps the fail-fast path fast when Redis is unreachable. */
const COMMAND_TIMEOUT_MS = 2000

export type RedisRole = 'queue' | 'worker' | 'scan'

/**
 * Base connection options.
 *
 * NOTE on `password`: callers typically derive `settings` from
 * `loadDatabaseConfig()`, which sets `password: env.REDIS_PASSWORD ?? undefined`;
 * the root .env sets REDIS_PASSWORD to an EMPTY STRING — which is not
 * nullish, so it survives as ''. Passing `password: ''` to ioredis makes it
 * issue `AUTH ''` against an auth-less Redis, which fails with
 * "ERR Client sent AUTH, but no password is set". We therefore only include
 * the key at all when the value is truthy.
 */
function baseOptions(settings: RedisKeyValueSettings): RedisOptions {
  const { host, port, password, db } = settings

  const options: RedisOptions = {
    host,
    port,
    db,
    // Fail fast instead of buffering commands while Redis is unreachable.
    enableOfflineQueue: false,
    connectTimeout: COMMAND_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    // Backs off to a ceiling but never gives up, so the service self-heals
    // when Redis returns. See MAX_RECONNECT_DELAY_MS.
    retryStrategy(times: number) {
      return Math.min(times * 200, MAX_RECONNECT_DELAY_MS)
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
function workerOptions(settings: RedisKeyValueSettings): RedisOptions {
  const options = baseOptions(settings)
  delete options.commandTimeout
  return {
    ...options,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  }
}

/**
 * Per-service connection registry.
 *
 * Keyed by an arbitrary `namespace` string (each service passes its own,
 * e.g. 'ms-order', 'ms-product') so two services running in the same test
 * process — or a future consumer that instantiates more than one — don't
 * close or misattribute each other's connections.
 */
class RedisConnectionRegistry {
  private readonly connections: IORedis[] = []
  private lastError: Error | null = null
  private readonly seenErrorMessages = new Set<string>()

  constructor(private readonly logPrefix: string) {}

  getLastError(): Error | null {
    return this.lastError
  }

  /**
   * Creates an ioredis client with an 'error' handler already attached.
   *
   * `role` selects the option profile: 'worker' connections get BullMQ's
   * required blocking-command settings, everything else gets the fail-fast
   * profile.
   */
  create(settings: RedisKeyValueSettings, role: RedisRole, label: string): IORedis {
    const options = role === 'worker' ? workerOptions(settings) : baseOptions(settings)
    const client = new IORedis(options)

    // CRITICAL: without this listener an 'error' event is an unhandled
    // exception and takes the whole process down when Redis is absent.
    client.on('error', (err: Error) => {
      this.lastError = err
      // Connection-refused spam while Redis is down is expected and already
      // reflected in the endpoints' 503; log at debug volume once per distinct
      // message rather than on every retry tick.
      this.logConnectionErrorOnce(label, err)
    })

    this.connections.push(client)
    return client
  }

  private logConnectionErrorOnce(label: string, err: Error): void {
    const description = describeError(err)
    const key = `${label}:${description}`
    if (this.seenErrorMessages.has(key)) {
      return
    }
    this.seenErrorMessages.add(key)
    // eslint-disable-next-line no-console
    console.warn(`${this.logPrefix} Redis connection "${label}" error: ${description}`)
  }

  /** Closes every connection created through this registry. */
  async closeAll(): Promise<void> {
    await Promise.all(
      this.connections.map(async (client) => {
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
    this.connections.length = 0
  }
}

/**
 * Creates a per-service Redis connection registry.
 *
 * `logPrefix` is prepended to warning logs, e.g. `[Order Service]` or
 * `[Product Service]` — pass the same bracketed style used elsewhere in that
 * service's own logging so a grep for the service name catches everything.
 */
export function createRedisConnectionRegistry(logPrefix: string): RedisConnectionRegistry {
  return new RedisConnectionRegistry(logPrefix)
}

export type { RedisConnectionRegistry }

/**
 * True when the shared connection is in a state where a command can be issued.
 * ioredis statuses: 'connecting' | 'connect' | 'ready' | 'close' | 'reconnecting' | 'end'
 */
export function isConnectionUsable(client: IORedis): boolean {
  return client.status === 'ready' || client.status === 'connect'
}
