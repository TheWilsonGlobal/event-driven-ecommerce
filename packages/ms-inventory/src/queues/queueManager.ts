import { Queue, Worker } from 'bullmq'
import type IORedis from 'ioredis'
import { loadDatabaseConfig, type DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import {
  createRedisConnectionRegistry,
  describeError,
  isConnectionUsable,
  RedisUnavailableError,
  toRedisUnavailable,
  type RedisConnectionRegistry,
} from '@ecommerce/shared-messaging'
import { QUEUE_DEFINITIONS, type QueueName } from './definitions'
import { JOB_NAMES, type ReleaseExpiredReservationJob } from './jobTypes'
import { makeReconciliationProcessor } from './workers'
import type { InventoryDoc, ReservationDoc } from '../types'

/**
 * How long a reservation may sit RESERVED before the reconciliation worker
 * releases it.
 *
 * SIMULATED: ten minutes is a demo-friendly number, not a real fulfilment
 * policy. A real one would be tied to the payment window the checkout actually
 * grants and would be configuration, not a constant.
 */
const RESERVATION_TTL_MS = 10 * 60 * 1000

/**
 * Constructs and owns ms-inventory's inventory-reconciliation queue and its
 * worker.
 *
 * Same connection topology as ms-product's QueueManager: one shared connection
 * for producers, one dedicated connection per worker (BullMQ requires this —
 * workers hold blocking commands open).
 *
 * Nothing in here throws when Redis is unreachable. Construction is
 * synchronous; enqueue failures are caught and logged by `tryEnqueue`, so a
 * down Redis can never fail a stock movement that NeDB already committed. The
 * consequence is stated plainly rather than hidden: with Redis down, a
 * reservation gets no expiry timer and will only be released by an explicit
 * order.cancelled.
 */
export class QueueManager {
  private readonly queue: Queue<ReleaseExpiredReservationJob> | undefined
  private worker: Worker | undefined
  private readonly producerConnection: IORedis | undefined
  private readonly registry: RedisConnectionRegistry
  private closed = false

  /**
   * @param redisEnabled false when KV_CACHE_DRIVER selects the embedded store
   *   (the repo's default, DB_MODE=embedded). No Redis connection and no
   *   BullMQ queue are constructed in that case — otherwise ms-inventory would
   *   open sockets that retry forever against a Redis that is deliberately not
   *   running. Reservations still work; they just get no expiry timer.
   */
  constructor(
    private readonly redisEnabled: boolean = loadDatabaseConfig().keyValue.driver === 'redis'
  ) {
    this.registry = createRedisConnectionRegistry('[Inventory Service]')

    if (!this.redisEnabled) {
      return
    }

    const dbConfig = loadDatabaseConfig()
    this.producerConnection = this.registry.create(
      dbConfig.keyValue.redis,
      'queue',
      'bullmq-producers'
    )

    const def = QUEUE_DEFINITIONS[0]
    this.queue = new Queue(def.name, {
      connection: this.producerConnection,
      defaultJobOptions: {
        attempts: def.attempts,
        backoff: { type: def.backoff.type, delay: def.backoff.delayMs },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    })
  }

  /** False when BullMQ is unavailable because the KV driver is not Redis. */
  get queuesAvailable(): boolean {
    return this.redisEnabled
  }

  /** True once close() has run — introspection must not read a torn-down queue. */
  get isClosed(): boolean {
    return this.closed
  }

  /** The one queue this manager owns, for introspection. Throws if Redis is disabled. */
  queueFor(name: QueueName): Queue<ReleaseExpiredReservationJob> {
    if (name !== QUEUE_DEFINITIONS[0].name) {
      throw new Error(`Unknown queue definition: ${name}`)
    }
    return this.requireQueue()
  }

  /**
   * Live ping used by the queue route to fail fast before doing real work.
   * Returns null when healthy, or a RedisUnavailableError when not.
   */
  async checkRedis(): Promise<RedisUnavailableError | null> {
    if (this.closed) {
      return new RedisUnavailableError('queues_closed', 'Queue manager has been shut down')
    }
    if (!this.redisEnabled || !this.producerConnection) {
      return new RedisUnavailableError(
        'kv_driver_not_redis',
        'ms-inventory is not configured with a Redis KV driver; BullMQ requires Redis.'
      )
    }
    if (!isConnectionUsable(this.producerConnection)) {
      const last = this.registry.getLastError()
      if (last) {
        return toRedisUnavailable(last)
      }
      return new RedisUnavailableError(
        'redis_unavailable',
        `Redis is unreachable (connection status: ${this.producerConnection.status})`
      )
    }
    try {
      await this.producerConnection.ping()
      return null
    } catch (err) {
      return toRedisUnavailable(err)
    }
  }

  /** Starts the reconciliation worker on its own dedicated connection. */
  startWorker(
    inventoryStore: DocumentDatabaseAdapter<InventoryDoc>,
    reservationsStore: DocumentDatabaseAdapter<ReservationDoc>
  ): void {
    if (!this.redisEnabled) {
      return
    }

    const def = QUEUE_DEFINITIONS[0]
    const connection = this.registry.create(
      loadDatabaseConfig().keyValue.redis,
      'worker',
      `bullmq-worker-${def.name}`
    )

    const processor = makeReconciliationProcessor(inventoryStore, reservationsStore)
    this.worker = new Worker(def.name, processor, {
      connection,
      concurrency: def.concurrency,
    })

    // A Worker emits 'error' for connection-level problems. Without a listener
    // this is an unhandled 'error' event on an EventEmitter, which is a
    // process-killing exception — the exact failure mode we must avoid when
    // Redis is down.
    this.worker.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.warn(`[Inventory Service] Worker "${def.name}" error: ${describeError(err)}`)
    })

    this.worker.on('failed', (job, err) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[Inventory Service] Job ${job?.id ?? '?'} on "${def.name}" failed ` +
          `(attempt ${job?.attemptsMade ?? 0}/${def.attempts}): ${err.message}`
      )
    })
  }

  private requireQueue(): Queue<ReleaseExpiredReservationJob> {
    if (!this.queue) {
      throw new Error('Queue not constructed: inventory-reconciliation (Redis disabled)')
    }
    return this.queue
  }

  // -------------------------------------------------------------------------
  // Producers
  // -------------------------------------------------------------------------

  /**
   * Schedules the TTL sweep for one reservation.
   *
   * The jobId is derived from the EVENT id, not the order id, and that choice
   * is deliberate. Kafka redelivers, so this enqueue can genuinely be reached
   * twice for the same message; a deterministic jobId makes BullMQ ignore the
   * second add() outright, so a redelivery cannot stack two timers that would
   * each try to release the same stock. (The handler's own guards should stop
   * a redelivery well before here — this is the belt to their braces, and it
   * is the mechanism the consumer's docblock names explicitly.)
   */
  async enqueueReleaseExpired(data: ReleaseExpiredReservationJob): Promise<string | undefined> {
    const job = await this.requireQueue().add(JOB_NAMES.releaseExpired, data, {
      jobId: `release-expired-${data.eventId}`,
      delay: RESERVATION_TTL_MS,
    })
    return job.id
  }

  /**
   * Fire-and-forget enqueue used by the event handlers.
   *
   * A Redis outage (or the embedded KV driver being active) must not fail a
   * reservation that was already committed to NeDB. The enqueue failure is
   * logged and swallowed; the reservation stands, without an expiry timer.
   */
  async tryEnqueue<T>(
    label: string,
    fn: () => Promise<T | undefined>
  ): Promise<T | undefined | null> {
    if (!this.redisEnabled) {
      return null
    }
    try {
      return await fn()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[Inventory Service] Failed to enqueue ${label}: ${describeError(err)}`)
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true

    if (this.worker) {
      try {
        await this.worker.close()
      } catch {
        /* already down — nothing to unwind */
      }
    }

    if (this.queue) {
      try {
        await this.queue.close()
      } catch {
        /* already down */
      }
    }

    await this.registry.closeAll()
  }
}

export type { QueueName }
export { RESERVATION_TTL_MS }
