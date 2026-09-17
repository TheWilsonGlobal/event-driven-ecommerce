import { Queue, Worker } from 'bullmq'
import type { Job, JobType } from 'bullmq'
import type IORedis from 'ioredis'
import type { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import {
  QUEUE_DEFINITIONS,
  JOB_STATES,
  orderExpirationDelayMs,
  type JobState,
  type QueueName,
  type QueueDefinition,
} from './definitions'
import {
  JOB_NAMES,
  type ExpireOrderJob,
  type RetryCaptureJob,
  type SendConfirmationJob,
  type SendReceiptJob,
  type ReleaseInventoryJob,
  type RefundPaymentJob,
} from './jobTypes'
import {
  createRedisConnection,
  closeAllRedisConnections,
  getLastRedisError,
  isConnectionUsable,
} from './redisConnection'
import { describeError } from './describeError'
import {
  makeExpireOrderProcessor,
  makeRetryCaptureProcessor,
  makeNotificationProcessor,
  makeSagaCompensationProcessor,
} from './workers'

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

export interface QueueSnapshotCounts extends Record<JobState, number> {}

export interface RecentJobView {
  id: string
  name: string
  status: JobState
  attempts: number
  maxAttempts: number
  timestamp: string
}

export interface QueueInfoView {
  name: string
  service: string
  description: string
  concurrency: number
  attempts: number
  backoff: { type: 'exponential' | 'fixed'; delayMs: number }
  counts: QueueSnapshotCounts
  recentJobs: RecentJobView[]
}

export interface QueueDataView {
  queues: QueueInfoView[]
  summary: {
    queueCount: number
    totalJobs: number
    failedCount: number
    activeCount: number
  }
}

/** Thrown when Redis cannot serve a request; mapped to HTTP 503 by the routes. */
export class RedisUnavailableError extends Error {
  public readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'RedisUnavailableError'
    this.reason = reason
  }
}

const MAX_RECENT_JOBS = 10

/** BullMQ job types we ask for when building the recentJobs list. */
const RECENT_JOB_TYPES: JobType[] = ['active', 'waiting', 'delayed', 'completed', 'failed']

export class QueueManager {
  private readonly queues = new Map<QueueName, Queue>()
  private readonly workers: Worker[] = []
  private readonly producerConnection: IORedis
  private readonly scanConnection: IORedis
  private closed = false

  constructor(private readonly prisma: PrismaClient) {
    this.producerConnection = createRedisConnection('queue', 'bullmq-producers')
    this.scanConnection = createRedisConnection('scan', 'cache-scan')

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
    return this.scanConnection
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
    const expireOrder = makeExpireOrderProcessor(this.prisma)
    const retryCapture = makeRetryCaptureProcessor({
      prisma: this.prisma,
      onRetriesExhausted: async (job) => {
        // Real hand-off: an exhausted capture triggers a real refund
        // compensation on the saga-compensation queue.
        await this.enqueueRefundPayment({
          orderId: job.data.orderId,
          orderNumber: job.data.orderNumber,
          paymentId: job.data.paymentId,
          failedStep: 'payment-capture',
          reason: `capture failed after ${job.opts.attempts ?? 1} attempts`,
          amount: job.data.amount,
          currency: job.data.currency,
        })
      },
    })
    const notification = makeNotificationProcessor(this.prisma)
    const sagaCompensation = makeSagaCompensationProcessor(this.prisma)

    const processors: Record<QueueName, (job: Job) => Promise<unknown>> = {
      'order-expiration': expireOrder as (job: Job) => Promise<unknown>,
      'payment-retry': retryCapture as (job: Job) => Promise<unknown>,
      'notification-dispatch': notification as (job: Job) => Promise<unknown>,
      'saga-compensation': sagaCompensation as (job: Job) => Promise<unknown>,
    }

    for (const def of QUEUE_DEFINITIONS) {
      // Dedicated connection per worker: blocking commands must not share.
      const connection = createRedisConnection('worker', `bullmq-worker-${def.name}`)

      const worker = new Worker(def.name, processors[def.name], {
        connection,
        concurrency: def.concurrency,
      })

      // A Worker emits 'error' for connection-level problems. Without a
      // listener this is an unhandled 'error' event on an EventEmitter, which
      // is a process-killing exception — the exact failure mode we must avoid
      // when Redis is down.
      worker.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.warn(`[Order Service] Worker "${def.name}" error: ${describeError(err)}`)
      })

      worker.on('failed', (job, err) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[Order Service] Job ${job?.id ?? '?'} on "${def.name}" failed ` +
            `(attempt ${job?.attemptsMade ?? 0}/${def.attempts}): ${err.message}`
        )
      })

      this.workers.push(worker)
    }
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
    if (this.closed) {
      throw new RedisUnavailableError('queues_closed', 'Queue manager has been shut down')
    }

    const queues: QueueInfoView[] = []

    try {
      for (const def of QUEUE_DEFINITIONS) {
        queues.push(await this.getQueueInfo(def))
      }
    } catch (err) {
      throw toRedisUnavailable(err)
    }

    let totalJobs = 0
    let failedCount = 0
    let activeCount = 0
    for (const q of queues) {
      for (const state of JOB_STATES) {
        totalJobs += q.counts[state]
      }
      failedCount += q.counts.failed
      activeCount += q.counts.active
    }

    return {
      queues,
      summary: {
        queueCount: queues.length,
        totalJobs,
        failedCount,
        activeCount,
      },
    }
  }

  private async getQueueInfo(def: QueueDefinition): Promise<QueueInfoView> {
    const queue = this.queue(def.name)

    const [rawCounts, jobs] = await Promise.all([
      queue.getJobCounts(),
      queue.getJobs(RECENT_JOB_TYPES, 0, MAX_RECENT_JOBS - 1, false),
    ])

    // getJobCounts() also returns 'paused', 'waiting-children' and
    // 'prioritized'. The admin contract is exactly the five JobStates, and
    // every one of them must be present as a number even when zero.
    const counts = JOB_STATES.reduce((acc, state) => {
      const value = rawCounts[state]
      acc[state] = typeof value === 'number' ? value : 0
      return acc
    }, {} as QueueSnapshotCounts)

    const recentJobs: RecentJobView[] = []
    for (const job of jobs) {
      if (!job) {
        continue
      }
      const view = await toRecentJobView(job, def.attempts)
      if (view) {
        recentJobs.push(view)
      }
    }

    recentJobs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return {
      name: def.name,
      service: def.service,
      description: def.description,
      concurrency: def.concurrency,
      attempts: def.attempts,
      backoff: def.backoff,
      counts,
      recentJobs: recentJobs.slice(0, MAX_RECENT_JOBS),
    }
  }

  /**
   * Live ping used by the routes to fail fast before doing real work.
   * Returns null when healthy, or a RedisUnavailableError when not.
   */
  async checkRedis(): Promise<RedisUnavailableError | null> {
    if (this.closed) {
      return new RedisUnavailableError('queues_closed', 'Queue manager has been shut down')
    }
    if (!isConnectionUsable(this.producerConnection)) {
      const last = getLastRedisError()
      // Classify via the last connection error where we have one, so the
      // reason code is specific (redis_connection_refused) rather than the
      // generic redis_unavailable.
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

/**
 * Maps a BullMQ Job onto the admin's RecentJob shape.
 * `job.getState()` is the authoritative state; anything outside the contract's
 * five states (e.g. 'waiting-children', 'prioritized', 'unknown') is dropped
 * rather than coerced into a lie.
 */
async function toRecentJobView(job: Job, maxAttempts: number): Promise<RecentJobView | null> {
  let state: string
  try {
    state = await job.getState()
  } catch {
    return null
  }

  if (!isContractJobState(state)) {
    return null
  }

  // processedOn/finishedOn are more meaningful than enqueue time for jobs that
  // have run; fall back to the enqueue timestamp for waiting/delayed jobs.
  const ts = job.finishedOn ?? job.processedOn ?? job.timestamp

  return {
    id: String(job.id ?? ''),
    name: job.name,
    status: state,
    attempts: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? maxAttempts,
    timestamp: new Date(ts).toISOString(),
  }
}

function isContractJobState(state: string): state is JobState {
  return (JOB_STATES as readonly string[]).includes(state)
}

/** Normalises any thrown error into a RedisUnavailableError with a reason code. */
export function toRedisUnavailable(err: unknown): RedisUnavailableError {
  if (err instanceof RedisUnavailableError) {
    return err
  }
  const message = describeError(err)

  // ioredis surfaces a dead server in a few distinct ways; give each a
  // machine-readable reason so the admin can distinguish them.
  if (/ECONNREFUSED/i.test(message)) {
    return new RedisUnavailableError(
      'redis_connection_refused',
      `Redis refused the connection: ${message}`
    )
  }
  if (/ETIMEDOUT|Command timed out|connect ETIMEDOUT/i.test(message)) {
    return new RedisUnavailableError('redis_timeout', `Redis command timed out: ${message}`)
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new RedisUnavailableError(
      'redis_dns_failure',
      `Redis host could not be resolved: ${message}`
    )
  }
  if (/Stream isn't writeable|enableOfflineQueue/i.test(message)) {
    return new RedisUnavailableError('redis_unavailable', `Redis is not connected: ${message}`)
  }
  if (/NOAUTH|WRONGPASS|ERR Client sent AUTH/i.test(message)) {
    return new RedisUnavailableError(
      'redis_auth_failure',
      `Redis authentication failed: ${message}`
    )
  }
  return new RedisUnavailableError('redis_error', message)
}
