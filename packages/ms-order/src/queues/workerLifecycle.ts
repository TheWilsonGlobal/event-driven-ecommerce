import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { QUEUE_DEFINITIONS, type QueueName } from './definitions'
import type { RefundPaymentJob } from './jobTypes'
import { createRedisConnection } from './redisConnection'
import { describeError } from './describeError'
import {
  makeExpireOrderProcessor,
  makeRetryCaptureProcessor,
  makeNotificationProcessor,
  makeSagaCompensationProcessor,
} from './workers'

/**
 * Starts one Worker per queue, each on its own dedicated connection.
 *
 * `enqueueRefundPayment` is passed in rather than closing over a QueueManager
 * instance so this stays a plain function: the retry-capture processor's
 * exhausted-retries hand-off enqueues a real refund compensation job on the
 * saga-compensation queue.
 */
export function startWorkers(
  prisma: PrismaClient,
  enqueueRefundPayment: (data: RefundPaymentJob) => Promise<string | undefined>
): Worker[] {
  const workers: Worker[] = []

  const expireOrder = makeExpireOrderProcessor(prisma)
  const retryCapture = makeRetryCaptureProcessor({
    prisma,
    onRetriesExhausted: async (job) => {
      // Real hand-off: an exhausted capture triggers a real refund
      // compensation on the saga-compensation queue.
      await enqueueRefundPayment({
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
  const notification = makeNotificationProcessor(prisma)
  const sagaCompensation = makeSagaCompensationProcessor(prisma)

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

    workers.push(worker)
  }

  return workers
}
