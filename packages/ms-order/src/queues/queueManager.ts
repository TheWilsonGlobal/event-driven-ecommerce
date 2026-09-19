import { Queue } from 'bullmq'
import type { Worker } from 'bullmq'
import type IORedis from 'ioredis'
import type { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { QUEUE_DEFINITIONS, orderExpirationDelayMs, type QueueName } from './definitions'
import {
  JOB_NAMES,
  type ExpireOrderJob,
  type RetryCaptureJob,
  type SendConfirmationJob,
  type SendReceiptJob,
  type ReleaseInventoryJob,
  type RefundPaymentJob,
} from './jobTypes'
import type { KeyValueStoreAdapter } from '@ecommerce/shared-database'
import type { KeyspaceInspector } from './keyspaceInspector'
import { EmbeddedKeyspaceInspector, RedisKeyspaceInspector } from './keyspaceInspector'
import { createRedisConnection, closeAllRedisConnections } from './redisConnection'
import { describeError } from './describeError'
import { startWorkers as startWorkerPool } from './workerLifecycle'
import type { RedisUnavailableError } from './errors'
import {
  checkRedis as checkRedisConnection,
  checkKeyspace as checkKeyspaceReadiness,
} from './health'
import { buildQueueData } from './introspection'
import { describeKeyValueBackend, type KeyValueInfo } from './driverInfo'
import type { QueueDataView } from './queueViews'

export type { QueueSnapshotCounts, QueueInfoView, QueueDataView } from './queueViews'

/**
 * Constructs and owns ms-order's four BullMQ queues and their workers.
 *
 * Connection topology (BullMQ v4 guidance):
 *  - ONE shared connection for all four Queue (producer) instances. Producers
 *    issue only short, non-blocking commands, so sharing is safe and keeps the
 *    connection count down.
 *  - ONE DEDICATED connection PER Worker. Workers issue blocking commands
 *    (BZPOPMIN/BRPOPLPUSH) that monopolise a connection for the duration of the
 *    block, so they must not share with producers or with each other.
 *  - ONE separate connection for SCAN-based cache introspection, so a long
 *    cursor walk never sits in front of a producer's enqueue.
 *
 * Nothing in here throws when Redis is unreachable. Construction is
 * synchronous and lazy at the protocol level; commands fail later and are
 * translated into a 503 by the route layer.
 */

export class QueueManager {
  private readonly queues = new Map<QueueName, Queue>()
  private readonly workers: Worker[] = []
  /** Undefined when this process is not backed by Redis. */
  private readonly producerConnection: IORedis | undefined
  private readonly scanConnection: IORedis | undefined
  private readonly inspector: KeyspaceInspector
  private readonly kvStore: KeyValueStoreAdapter | undefined
  private closed = false

  /**
   * @param redisEnabled false when KV_CACHE_DRIVER selects the embedded store.
   *   No Redis connections and no BullMQ queues are constructed in that case —
   *   otherwise ms-order would open sockets that retry forever against a Redis
   *   that is deliberately not running.
   * @param kvStore the embedded store, required when redisEnabled is false.
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redisEnabled: boolean = true,
    kvStore?: KeyValueStoreAdapter | undefined
  ) {
    if (!redisEnabled) {
      if (!kvStore) {
        throw new Error('QueueManager requires a key-value store when Redis is disabled')
      }
      this.kvStore = kvStore
      this.inspector = new EmbeddedKeyspaceInspector(kvStore)
      return
    }

    this.producerConnection = createRedisConnection('queue', 'bullmq-producers')
    this.scanConnection = createRedisConnection('scan', 'cache-scan')
    this.inspector = new RedisKeyspaceInspector(this.scanConnection)

    for (const def of QUEUE_DEFINITIONS) {
      this.queues.set(
        def.name,
        new Queue(def.name, {
          connection: this.producerConnection,
          defaultJobOptions: {
            attempts: def.attempts,
            backoff: { type: def.backoff.type, delay: def.backoff.delayMs },
            // Keep a bounded history so the admin panel has real recent jobs to
            // show without the keyspace growing without limit.
            removeOnComplete: { count: 200 },
            removeOnFail: { count: 200 },
          },
        })
      )
    }
  }

  /** The Redis client used for cache-namespace SCANs. */
  get scanClient(): IORedis {
    if (!this.scanConnection) {
      throw new Error('No Redis scan connection: ms-order is running on the embedded KV driver')
    }
    return this.scanConnection
  }

  /**
   * Backend-agnostic keyspace reader for the cache endpoints. Works on both
   * drivers, unlike scanClient.
   */
  get keyspaceInspector(): KeyspaceInspector {
    return this.inspector
  }

  /** False when BullMQ is unavailable because the KV driver is not Redis. */
  get queuesAvailable(): boolean {
    return this.redisEnabled
  }

  /**
   * Describes the active key-value backend for the driver endpoint.
   *
   * Reports what this process actually resolved at boot rather than what the
   * environment requested, so the admin can never show a driver that is not
   * the one in use.
   */
  keyValueInfo(): KeyValueInfo {
    return describeKeyValueBackend(this.redisEnabled, this.kvStore)
  }

  private queue(name: QueueName): Queue {
    const q = this.queues.get(name)
    if (!q) {
      throw new Error(`Queue not constructed: ${name}`)
    }
    return q
  }

  /** Starts one Worker per queue, each on its own dedicated connection. */
  startWorkers(): void {
    const started = startWorkerPool(this.prisma, (data) => this.enqueueRefundPayment(data))
    this.workers.push(...started)
  }

  // -------------------------------------------------------------------------
  // Producers
  // -------------------------------------------------------------------------

  /**
   * Enqueues a delayed `expire-order` job. Called ONLY when an order is
   * actually created with status PENDING — see the producer note in
   * src/index.ts. An order created CONFIRMED never gets one.
   */
  async enqueueExpireOrder(data: ExpireOrderJob): Promise<string | undefined> {
    const job = await this.queue('order-expiration').add(JOB_NAMES.expireOrder, data, {
      delay: orderExpirationDelayMs(),
      // Idempotent per order: re-submitting the same order cannot stack up
      // duplicate expirations.
      jobId: `expire-${data.orderId}`,
    })
    return job.id
  }

  async enqueueRetryCapture(data: RetryCaptureJob): Promise<string | undefined> {
    const job = await this.queue('payment-retry').add(JOB_NAMES.retryCapture, data)
    return job.id
  }

  async enqueueSendConfirmation(data: SendConfirmationJob): Promise<string | undefined> {
    const job = await this.queue('notification-dispatch').add(JOB_NAMES.sendConfirmation, data)
    return job.id
  }

  async enqueueSendReceipt(data: SendReceiptJob): Promise<string | undefined> {
    const job = await this.queue('notification-dispatch').add(JOB_NAMES.sendReceipt, data)
    return job.id
  }

  async enqueueReleaseInventory(data: ReleaseInventoryJob): Promise<string | undefined> {
    const job = await this.queue('saga-compensation').add(JOB_NAMES.releaseInventory, data)
    return job.id
  }

  async enqueueRefundPayment(data: RefundPaymentJob): Promise<string | undefined> {
    const job = await this.queue('saga-compensation').add(JOB_NAMES.refundPayment, data)
    return job.id
  }

  /**
   * Fire-and-forget enqueue used by the HTTP routes.
   *
   * A Redis outage must NOT fail an order that was already committed to the
   * relational database. The enqueue failure is logged and swallowed; the
   * order stands. Returns the job id on success, null on failure, so callers
   * can report honestly.
   */
  async tryEnqueue<T>(
    label: string,
    fn: () => Promise<T | undefined>
  ): Promise<T | undefined | null> {
    try {
      return await fn()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[Order Service] Failed to enqueue ${label}: ${describeError(err)}`)
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /**
   * Builds the full QueueData payload from live Redis state.
   *
   * Throws RedisUnavailableError when Redis cannot be reached — the caller
   * turns that into a 503. It must never degrade to zeros, because zeros are
   * indistinguishable from a genuinely empty queue.
   */
  async getQueueData(): Promise<QueueDataView> {
    return buildQueueData(QUEUE_DEFINITIONS, (name) => this.queue(name), this.closed)
  }

  /**
   * Live ping used by the routes to fail fast before doing real work.
   * Returns null when healthy, or a RedisUnavailableError when not.
   */
  async checkRedis(): Promise<RedisUnavailableError | null> {
    return checkRedisConnection(this.closed, this.redisEnabled, this.producerConnection)
  }

  /**
   * Readiness gate for the CACHE endpoints, as distinct from checkRedis().
   *
   * The embedded store is always reachable, so cache introspection stays
   * available on that driver even though the queue endpoints do not.
   */
  async checkKeyspace(): Promise<RedisUnavailableError | null> {
    return checkKeyspaceReadiness(this.closed, this.redisEnabled, this.producerConnection)
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true

    // Workers first so nothing picks up new jobs mid-teardown.
    await Promise.all(
      this.workers.map(async (w) => {
        try {
          await w.close()
        } catch {
          /* already down — nothing to unwind */
        }
      })
    )

    await Promise.all(
      [...this.queues.values()].map(async (q) => {
        try {
          await q.close()
        } catch {
          /* already down */
        }
      })
    )

    await closeAllRedisConnections()
  }
}
