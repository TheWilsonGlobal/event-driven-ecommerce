import { Queue, Worker } from 'bullmq'
import type IORedis from 'ioredis'
import {
  loadDatabaseConfig,
  type DocumentDatabaseAdapter,
  type ProductSearchClient,
} from '@ecommerce/shared-database'
import {
  createRedisConnectionRegistry,
  describeError,
  isConnectionUsable,
  RedisUnavailableError,
  toRedisUnavailable,
  type RedisConnectionRegistry,
} from '@ecommerce/shared-messaging'
import { QUEUE_DEFINITIONS, type QueueName } from './definitions'
import { JOB_NAMES, type ReindexProductJob, type RemoveProductFromIndexJob } from './jobTypes'
import { makeReindexSearchProcessor } from './workers'
import type { ProductDoc } from '../types'

/**
 * Constructs and owns ms-product's reindex-search queue and its worker.
 *
 * Follows the same connection topology as ms-order's QueueManager (see
 * packages/ms-order/src/queues/queueManager.ts): one shared connection for
 * producers, one dedicated connection per worker (BullMQ requires this —
 * workers hold blocking commands open). ms-product has only one queue today,
 * so there is only one of each, but the same shape scales if a second queue
 * (e.g. image processing) is added later.
 *
 * Nothing in here throws when Redis is unreachable. Construction is
 * synchronous; enqueue failures are caught and logged by `tryEnqueue` so a
 * down Redis can never fail a product write that NeDB already committed.
 */
export class QueueManager {
  private readonly queue: Queue<ReindexProductJob | RemoveProductFromIndexJob> | undefined
  private worker: Worker | undefined
  private readonly producerConnection: IORedis | undefined
  private readonly registry: RedisConnectionRegistry
  private closed = false

  /**
   * @param redisEnabled false when KV_CACHE_DRIVER selects the embedded
   *   store (the repo's default, DB_MODE=embedded). No Redis connection and
   *   no BullMQ queue are constructed in that case — otherwise ms-product
   *   would open sockets that retry forever against a Redis that is
   *   deliberately not running. Product writes still succeed; they just skip
   *   the background reindex (the write route falls back to indexing inline,
   *   see routes/products.ts).
   */
  constructor(
    private readonly redisEnabled: boolean = loadDatabaseConfig().keyValue.driver === 'redis'
  ) {
    this.registry = createRedisConnectionRegistry('[Product Service]')

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
  queueFor(name: QueueName): Queue<ReindexProductJob | RemoveProductFromIndexJob> {
    if (name !== QUEUE_DEFINITIONS[0].name) {
      throw new Error(`Unknown queue definition: ${name}`)
    }
    return this.requireQueue()
  }

  /**
   * Live ping used by the queue route to fail fast before doing real work.
   * Returns null when healthy, or a RedisUnavailableError when not. Mirrors
   * ms-order's checkRedis (queues/health.ts).
   */
  async checkRedis(): Promise<RedisUnavailableError | null> {
    if (this.closed) {
      return new RedisUnavailableError('queues_closed', 'Queue manager has been shut down')
    }
    if (!this.redisEnabled || !this.producerConnection) {
      return new RedisUnavailableError(
        'kv_driver_not_redis',
        'ms-product is not configured with a Redis KV driver; BullMQ requires Redis.'
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

  /** Starts the reindex-search worker on its own dedicated connection. */
  startWorker(
    productsStore: DocumentDatabaseAdapter<ProductDoc>,
    search: ProductSearchClient
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

    const processor = makeReindexSearchProcessor(productsStore, search)
    this.worker = new Worker(def.name, processor, {
      connection,
      concurrency: def.concurrency,
    })

    // A Worker emits 'error' for connection-level problems. Without a
    // listener this is an unhandled 'error' event on an EventEmitter, which
    // is a process-killing exception — the exact failure mode we must avoid
    // when Redis is down.
    this.worker.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.warn(`[Product Service] Worker "${def.name}" error: ${describeError(err)}`)
    })

    this.worker.on('failed', (job, err) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[Product Service] Job ${job?.id ?? '?'} on "${def.name}" failed ` +
          `(attempt ${job?.attemptsMade ?? 0}/${def.attempts}): ${err.message}`
      )
    })
  }

  private requireQueue(): Queue<ReindexProductJob | RemoveProductFromIndexJob> {
    if (!this.queue) {
      throw new Error('Queue not constructed: reindex-search (Redis disabled)')
    }
    return this.queue
  }

  // -------------------------------------------------------------------------
  // Producers
  // -------------------------------------------------------------------------

  async enqueueReindexProduct(data: ReindexProductJob): Promise<string | undefined> {
    const job = await this.requireQueue().add(JOB_NAMES.reindexProduct, data, {
      // Idempotent per product: a burst of edits to the same product cannot
      // stack up duplicate reindex jobs — BullMQ ignores an add() with a
      // jobId already present among waiting/delayed jobs.
      jobId: `reindex-${data.productId}`,
    })
    return job.id
  }

  async enqueueRemoveFromIndex(data: RemoveProductFromIndexJob): Promise<string | undefined> {
    const job = await this.requireQueue().add(JOB_NAMES.removeFromIndex, data, {
      jobId: `remove-${data.productId}`,
    })
    return job.id
  }

  /**
   * Fire-and-forget enqueue used by the HTTP routes.
   *
   * A Redis outage (or the embedded KV driver being active) must not fail a
   * product write that was already committed to NeDB. The enqueue failure is
   * logged and swallowed; the write stands.
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
      console.warn(`[Product Service] Failed to enqueue ${label}: ${describeError(err)}`)
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
