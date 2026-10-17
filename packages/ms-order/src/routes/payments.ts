import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AppError, notFound, requireOwnerOrAny, type Static } from '@ecommerce/shared-security'
import { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { QueueManager } from '../queues'
import {
  stageOrderConfirmed,
  stagePaymentCaptured,
  stagePaymentFailed,
  stagePaymentRefunded,
} from '../events'
import { requireCapability } from '../security'
import {
  CaptureBody,
  CaptureOut,
  CaptureParams,
  ErrorResponse,
  SagaFailureBody,
  SagaFailureOut,
  OrderRefParams,
} from './schemas'

export interface PaymentsRouteDeps {
  prisma: PrismaClient
  queueManager: QueueManager
}

/**
 * Registers payment-capture and saga-failure routes.
 *
 * ---------------------------------------------------------------------
 * Payment capture
 *
 * This is the real lifecycle step that makes payment-retry and
 * saga-compensation reachable. An order created with
 * `paymentPreCaptured: false` is PENDING with a PENDING payment row; this
 * endpoint attempts to capture it.
 *
 * The capture ITSELF is simulated (see the SIMULATED note in the handler) —
 * there are no Stripe/PayPal credentials in this repo. Everything the
 * outcome drives is real: the payment/order rows, the enqueued retry job,
 * BullMQ's exponential backoff, and the saga compensation once retries are
 * exhausted.
 *
 * `outcome` lets an operator deterministically drive either branch, which is
 * how the admin panel's queues get exercised without waiting on chance. It
 * is an explicit request parameter, NOT a background timer fabricating jobs.
 * ---------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------
 * Saga step failure
 *
 * ms-order has no multi-step distributed saga implemented today, so there is
 * no inventory-reservation step that can fail on its own. Rather than invent
 * a fake one, this endpoint is an HONESTLY-NAMED operator hook that reports a
 * real saga step failure for a real order and runs the real compensating
 * action against the real database rows.
 *
 * When a genuine saga is implemented in ms-order, its failure handler should
 * call queueManager.enqueueReleaseInventory / enqueueRefundPayment directly
 * and this endpoint can go away.
 * ---------------------------------------------------------------------
 */
export function registerPaymentRoutes(
  server: FastifyInstance,
  { prisma, queueManager }: PaymentsRouteDeps
): void {
  server.post(
    '/api/v1/payments/:orderId/capture',
    {
      config: { policy: { permission: 'payments:capture' }, rateTier: 'write' },
      schema: {
        tags: ['payments'],
        description:
          'Attempt to capture payment for a PENDING order (the owner, or payments:capture:any). ' +
          'On failure, enqueues a retry-capture job (payment-retry queue) which, once retries ' +
          'are exhausted, enqueues a refund-payment compensation (saga-compensation queue). ' +
          'The capture call itself is simulated: no payment provider is contacted. `outcome` ' +
          'forces the simulated result and is an operator control (payments:capture:any only).',
        params: CaptureParams,
        body: CaptureBody,
        response: {
          200: CaptureOut,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: Static<typeof CaptureParams>
        Body: Static<typeof CaptureBody>
      }>
    ) => {
      const { orderId } = request.params

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true },
      })
      if (!order) throw notFound()
      requireOwnerOrAny(request, order.userId, 'payments:capture')

      const pendingPayment = order.payments.find((p) => p.status === 'PENDING')
      if (!pendingPayment) {
        throw new AppError(400, 'NO_PENDING_PAYMENT', 'Order has no PENDING payment to capture')
      }

      // SIMULATED: stands in for `stripe.paymentIntents.capture(...)`. No
      // network call is made. `outcome` overrides the coin flip so the failure
      // path is reproducible.
      const requested = request.body?.outcome
      // Forcing the outcome would let a customer mark their own payment as
      // captured: only the operator role may steer the simulation.
      if (requested) {
        requireCapability(
          request,
          'payments:capture:any',
          'Forcing the capture outcome is an operator control'
        )
      }
      const captureSucceeded = requested ? requested === 'succeed' : Math.random() < 0.5

      if (captureSucceeded) {
        // Pattern 1 + 2: payment, order status and BOTH events commit together,
        // under a row lock on the order. Two concurrent captures serialise on
        // the lock; the loser re-reads, finds no PENDING payment and gets a 409
        // instead of a second payment.captured.
        //
        // payment.captured is the money event; order.confirmed is the lifecycle
        // event. Separate topics, different audiences: analytics wants both,
        // inventory only cares about the order reaching a terminal paid state.
        const captured = await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "orders" WHERE id = ${orderId} FOR UPDATE`
            const payment = await tx.payment.findUnique({ where: { id: pendingPayment.id } })
            if (!payment || payment.status !== 'PENDING') return null

            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: 'COMPLETED',
                rawResponse: JSON.stringify({
                  simulated: true,
                  capturedAt: new Date().toISOString(),
                }),
              },
            })
            await tx.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } })

            await stagePaymentCaptured(
              tx,
              {
                orderId: order.id,
                orderNumber: order.orderNumber,
                paymentId: payment.id,
                provider: payment.provider,
                amount: Number(payment.amount),
                currency: payment.currency,
              },
              request.correlationId
            )
            await stageOrderConfirmed(
              tx,
              {
                orderId: order.id,
                orderNumber: order.orderNumber,
                customerEmail: order.customerEmail,
                customerName: order.customerName,
                totalAmount: Number(order.totalAmount),
                currency: order.currency,
              },
              request.correlationId
            )
            return payment.id
          },
          { timeout: 20_000 }
        )
        if (captured === null) {
          throw new AppError(
            409,
            'ALREADY_CAPTURED',
            'Payment was already captured by a concurrent request'
          )
        }

        // A now-confirmed order genuinely warrants its confirmation + receipt.
        await queueManager.tryEnqueue('send-confirmation', () =>
          queueManager.enqueueSendConfirmation({
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerEmail: order.customerEmail,
            customerName: order.customerName,
          })
        )
        await queueManager.tryEnqueue('send-receipt', () =>
          queueManager.enqueueSendReceipt({
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerEmail: order.customerEmail,
            totalAmount: Number(order.totalAmount),
            currency: order.currency,
          })
        )

        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          captured: true,
          orderStatus: 'CONFIRMED',
          simulated: true,
        }
      }

      // Capture failed: this is the genuine trigger for payment-retry.
      //
      // payment.failed is staged in the outbox as a FACT for analytics. The retry itself
      // stays on BullMQ and is NOT moved behind Kafka: a retry is work with one
      // owner, an attempt counter and a terminal failure state, none of which
      // Kafka provides. This is the split the whole design rests on.
      await stagePaymentFailed(
        prisma,
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
          paymentId: pendingPayment.id,
          provider: pendingPayment.provider,
          amount: Number(pendingPayment.amount),
          currency: pendingPayment.currency,
          reason: 'simulated-capture-declined',
          // First attempt: the BullMQ retries that follow are counted by the
          // job's own attemptsMade, not here.
          attempt: 1,
        },
        request.correlationId
      )

      const retryJobId = await queueManager.tryEnqueue('retry-capture', () =>
        queueManager.enqueueRetryCapture({
          orderId: order.id,
          orderNumber: order.orderNumber,
          paymentId: pendingPayment.id,
          provider: pendingPayment.provider,
          amount: Number(pendingPayment.amount),
          currency: pendingPayment.currency,
        })
      )

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        captured: false,
        orderStatus: order.status,
        retryJobId: retryJobId ?? null,
        retryEnqueued: retryJobId != null,
        simulated: true,
      }
    }
  )

  server.post(
    '/api/v1/orders/:id/saga-failure',
    {
      config: { policy: { permission: 'saga:report', mfa: true, audit: true } },
      schema: {
        tags: ['orders'],
        description:
          'Operator hook (ADMIN with a second factor, or a SERVICE token): report a failed ' +
          'order-saga step and enqueue the real compensating action on the saga-compensation ' +
          'queue. ms-order has no multi-step saga implementation yet, so the failure is ' +
          'reported rather than detected; the compensation it triggers operates on real ' +
          'order/payment rows.',
        params: OrderRefParams,
        body: SagaFailureBody,
        response: {
          202: SagaFailureOut,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          503: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: Static<typeof OrderRefParams>
        Body: Static<typeof SagaFailureBody>
      }>,
      reply: FastifyReply
    ) => {
      const order = await prisma.order.findUnique({
        where: { id: request.params.id },
        include: { items: true, payments: true },
      })
      if (!order) throw notFound()

      const { step, compensation } = request.body
      const reason = request.body.reason ?? `saga step "${step}" failed`

      let jobId: string | undefined | null

      if (compensation === 'refund-payment') {
        const capturedPayment = order.payments.find((p) => p.status === 'COMPLETED')
        if (!capturedPayment) {
          throw new AppError(
            400,
            'NO_COMPLETED_PAYMENT',
            'Order has no COMPLETED payment to refund'
          )
        }
        // The refund is COMPENSATION WORK, so it goes on BullMQ. The fact
        // that a refund was initiated is published for analytics. Note the
        // ordering: publish describes an intent that the queue then carries
        // out, so a consumer must treat this as "refund started", not
        // "refund settled".
        await stagePaymentRefunded(
          prisma,
          {
            orderId: order.id,
            orderNumber: order.orderNumber,
            paymentId: capturedPayment.id,
            amount: Number(capturedPayment.amount),
            currency: capturedPayment.currency,
            reason,
          },
          request.correlationId
        )

        jobId = await queueManager.tryEnqueue('refund-payment', () =>
          queueManager.enqueueRefundPayment({
            orderId: order.id,
            orderNumber: order.orderNumber,
            paymentId: capturedPayment.id,
            failedStep: step,
            reason,
            amount: Number(capturedPayment.amount),
            currency: capturedPayment.currency,
          })
        )
      } else {
        jobId = await queueManager.tryEnqueue('release-inventory', () =>
          queueManager.enqueueReleaseInventory({
            orderId: order.id,
            orderNumber: order.orderNumber,
            failedStep: step,
            reason,
            items: order.items.map((i) => ({
              productId: i.productId,
              sku: i.productSku,
              quantity: i.quantity,
            })),
          })
        )
      }

      if (jobId == null) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          reason: 'redis_unavailable',
          message: 'Compensation could not be enqueued because Redis is unreachable',
          timestamp: new Date().toISOString(),
        })
      }

      return reply.status(202).send({
        orderId: order.id,
        orderNumber: order.orderNumber,
        failedStep: step,
        compensation,
        jobId,
      })
    }
  )
}
