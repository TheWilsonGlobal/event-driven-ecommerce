import type { Job } from 'bullmq'
import type { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import * as crypto from 'crypto'
import type {
  ExpireOrderJob,
  RetryCaptureJob,
  NotificationJob,
  SendConfirmationJob,
  SendReceiptJob,
  SagaCompensationJob,
  ReleaseInventoryJob,
  RefundPaymentJob,
} from './jobTypes'
import { JOB_NAMES } from './jobTypes'

/**
 * Worker processors for ms-order's four queues.
 *
 * WHAT IS REAL HERE: every database read/write, every state transition, every
 * thrown error (and therefore every BullMQ retry, backoff and failed-job
 * record). The queue mechanics are not simulated in any way.
 *
 * WHAT IS SIMULATED: the outbound side effects that need third-party
 * credentials this repo does not have — the SMTP send, the PDF render, the
 * Stripe/PayPal capture and refund API calls. Each one is marked with a
 * `SIMULATED:` comment at the exact point of substitution.
 */

/** Statuses from which an order can still legitimately expire. */
const EXPIRABLE_STATUSES = new Set(['PENDING'])

// ---------------------------------------------------------------------------
// order-expiration
// ---------------------------------------------------------------------------

/**
 * Cancels an order that is still PENDING when its expiration window elapses.
 *
 * Re-reads the order inside the worker and no-ops if it has since been paid or
 * otherwise moved on. The job payload is 15 minutes stale by construction and
 * must never be trusted as a view of current state.
 */
export function makeExpireOrderProcessor(prisma: PrismaClient) {
  return async function processExpireOrder(job: Job<ExpireOrderJob>) {
    const { orderId, orderNumber } = job.data

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    })

    if (!order) {
      // The order was deleted between enqueue and execution. Nothing to do;
      // completing (rather than failing) is correct — this is not an error.
      return { outcome: 'skipped', reason: 'order-not-found', orderId }
    }

    if (!EXPIRABLE_STATUSES.has(order.status)) {
      return {
        outcome: 'skipped',
        reason: `order-status-is-${order.status}`,
        orderId,
        orderNumber,
      }
    }

    // Belt and braces: a COMPLETED payment means the money arrived even if the
    // status transition lagged. Never cancel a paid order.
    const hasCompletedPayment = order.payments.some((p) => p.status === 'COMPLETED')
    if (hasCompletedPayment) {
      return { outcome: 'skipped', reason: 'order-already-paid', orderId, orderNumber }
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    })

    return { outcome: 'cancelled', orderId, orderNumber }
  }
}

// ---------------------------------------------------------------------------
// payment-retry
// ---------------------------------------------------------------------------

/**
 * Probability that a simulated capture attempt succeeds.
 *
 * SIMULATED: a real Stripe/PayPal capture would be an HTTP call whose outcome
 * is determined by the provider. With no credentials available, retry attempts
 * resolve against this probability instead. Everything downstream of the
 * outcome — the thrown error, BullMQ's exponential backoff, the attempt
 * counter, the FAILED payment row, the saga compensation on exhaustion — is
 * real.
 */
const SIMULATED_CAPTURE_SUCCESS_RATE = 0.5

export interface RetryCaptureDeps {
  prisma: PrismaClient
  /** Called when retries are exhausted, to enqueue a real refund compensation. */
  onRetriesExhausted: (job: Job<RetryCaptureJob>) => Promise<void>
}

export function makeRetryCaptureProcessor({ prisma, onRetriesExhausted }: RetryCaptureDeps) {
  return async function processRetryCapture(job: Job<RetryCaptureJob>) {
    const { orderId, orderNumber, paymentId } = job.data

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    if (!payment) {
      return { outcome: 'skipped', reason: 'payment-not-found', paymentId }
    }

    // Already settled by another path (e.g. an operator marked it paid).
    if (payment.status === 'COMPLETED') {
      return { outcome: 'skipped', reason: 'payment-already-completed', paymentId }
    }

    // SIMULATED: stands in for `stripe.paymentIntents.capture(...)` /
    // the PayPal capture call. No network request is made.
    const captureSucceeded = Math.random() < SIMULATED_CAPTURE_SUCCESS_RATE

    if (captureSucceeded) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'COMPLETED',
          transactionId: `ch_retry_${crypto.randomUUID()}`,
          rawResponse: JSON.stringify({
            simulated: true,
            capturedOnAttempt: job.attemptsMade + 1,
            capturedAt: new Date().toISOString(),
          }),
        },
      })

      // A recovered payment confirms the order.
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'CONFIRMED' },
      })

      return { outcome: 'captured', orderId, orderNumber, attempt: job.attemptsMade + 1 }
    }

    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

    if (isFinalAttempt) {
      // Retries exhausted: record the terminal failure and hand off to the
      // saga-compensation queue to refund/release. This is a real trigger for
      // saga-compensation, not a synthetic one.
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'FAILED',
          rawResponse: JSON.stringify({
            simulated: true,
            failedAfterAttempts: job.attemptsMade + 1,
            failedAt: new Date().toISOString(),
          }),
        },
      })
      await onRetriesExhausted(job)
    }

    // Throwing is what drives BullMQ's retry + exponential backoff. Real.
    throw new Error(
      `Payment capture failed for order ${orderNumber} (attempt ${job.attemptsMade + 1}/${
        job.opts.attempts ?? 1
      })`
    )
  }
}

// ---------------------------------------------------------------------------
// notification-dispatch
// ---------------------------------------------------------------------------

export function makeNotificationProcessor(prisma: PrismaClient) {
  return async function processNotification(job: Job<NotificationJob>) {
    if (job.name === JOB_NAMES.sendConfirmation) {
      const data = job.data as SendConfirmationJob

      const order = await prisma.order.findUnique({ where: { id: data.orderId } })
      if (!order) {
        return { outcome: 'skipped', reason: 'order-not-found', orderId: data.orderId }
      }

      // SIMULATED: stands in for the SMTP send (nodemailer via SMTP_HOST).
      // No mail leaves the process; the delay approximates the round-trip so
      // the job spends observable time in the 'active' state.
      await simulateExternalCall(120)

      return {
        outcome: 'sent',
        channel: 'email',
        template: 'order-confirmation',
        to: data.customerEmail,
        orderNumber: data.orderNumber,
        simulated: true,
      }
    }

    if (job.name === JOB_NAMES.sendReceipt) {
      const data = job.data as SendReceiptJob

      const order = await prisma.order.findUnique({
        where: { id: data.orderId },
        include: { items: true },
      })
      if (!order) {
        return { outcome: 'skipped', reason: 'order-not-found', orderId: data.orderId }
      }

      // SIMULATED: stands in for the PDFKit receipt render + SMTP send. The
      // line-item count below is read from the real order, so the job does do
      // genuine work; only the render and the mail delivery are stubbed.
      await simulateExternalCall(200)

      return {
        outcome: 'sent',
        channel: 'email',
        template: 'order-receipt',
        to: data.customerEmail,
        lineItems: order.items.length,
        orderNumber: data.orderNumber,
        simulated: true,
      }
    }

    throw new Error(`Unknown notification job name: ${job.name}`)
  }
}

// ---------------------------------------------------------------------------
// saga-compensation
// ---------------------------------------------------------------------------

export function makeSagaCompensationProcessor(prisma: PrismaClient) {
  return async function processSagaCompensation(job: Job<SagaCompensationJob>) {
    if (job.name === JOB_NAMES.releaseInventory) {
      const data = job.data as ReleaseInventoryJob

      const order = await prisma.order.findUnique({ where: { id: data.orderId } })
      if (!order) {
        return { outcome: 'skipped', reason: 'order-not-found', orderId: data.orderId }
      }

      // SIMULATED: a real implementation would call ms-product's inventory
      // endpoint (INVENTORY_SERVICE_URL) to return the reserved units. ms-product
      // exposes no stock-reservation API today, so no cross-service call is made.
      await simulateExternalCall(80)

      // REAL: the order is genuinely moved to CANCELLED as the compensating
      // outcome of the failed saga step.
      if (order.status !== 'CANCELLED') {
        await prisma.order.update({
          where: { id: data.orderId },
          data: { status: 'CANCELLED' },
        })
      }

      return {
        outcome: 'inventory-released',
        orderNumber: data.orderNumber,
        failedStep: data.failedStep,
        units: data.items.reduce((sum, i) => sum + i.quantity, 0),
        simulated: true,
      }
    }

    if (job.name === JOB_NAMES.refundPayment) {
      const data = job.data as RefundPaymentJob

      const payment = await prisma.payment.findUnique({ where: { id: data.paymentId } })
      if (!payment) {
        return { outcome: 'skipped', reason: 'payment-not-found', paymentId: data.paymentId }
      }

      // SIMULATED: stands in for `stripe.refunds.create(...)`. No network call.
      await simulateExternalCall(150)

      // REAL: the payment row is genuinely transitioned to REFUNDED and the
      // order to CANCELLED.
      await prisma.payment.update({
        where: { id: data.paymentId },
        data: {
          status: 'REFUNDED',
          rawResponse: JSON.stringify({
            simulated: true,
            refundedAt: new Date().toISOString(),
            reason: data.reason,
          }),
        },
      })
      await prisma.order.update({
        where: { id: data.orderId },
        data: { status: 'CANCELLED' },
      })

      return {
        outcome: 'payment-refunded',
        orderNumber: data.orderNumber,
        failedStep: data.failedStep,
        amount: data.amount,
        simulated: true,
      }
    }

    throw new Error(`Unknown saga-compensation job name: ${job.name}`)
  }
}

/**
 * SIMULATED: approximates the latency of an external API/SMTP round-trip so
 * jobs occupy the 'active' state for an observable moment instead of
 * completing instantaneously. Purely a timing stand-in — it never fabricates
 * a job or an outcome.
 */
function simulateExternalCall(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
