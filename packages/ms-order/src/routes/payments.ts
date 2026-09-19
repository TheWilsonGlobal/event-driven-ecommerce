import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { QueueManager } from '../queues'

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
      schema: {
        tags: ['payments'],
        description:
          'Attempt to capture payment for a PENDING order. On failure, enqueues a ' +
          'retry-capture job (payment-retry queue) which, once retries are exhausted, ' +
          'enqueues a refund-payment compensation (saga-compensation queue). ' +
          'The capture call itself is simulated — no payment provider is contacted.',
        params: {
          type: 'object',
          properties: { orderId: { type: 'string' } },
          required: ['orderId'],
        },
        body: {
          type: 'object',
          properties: {
            outcome: {
              type: 'string',
              enum: ['succeed', 'fail'],
              description:
                'Forces the simulated capture result. Omit for a random outcome. ' +
                'Operator/demo control — this repo has no payment credentials.',
            },
          },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          400: { type: 'object', properties: { error: { type: 'string' } } },
          404: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { orderId: string }
        Body: { outcome?: 'succeed' | 'fail' }
      }>,
      reply: FastifyReply
    ) => {
      const { orderId } = request.params

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true },
      })
      if (!order) {
        return reply.status(404).send({ error: 'Order not found' })
      }

      const pendingPayment = order.payments.find((p) => p.status === 'PENDING')
      if (!pendingPayment) {
        return reply.status(400).send({
          error: 'Order has no PENDING payment to capture',
        })
      }

      // SIMULATED: stands in for `stripe.paymentIntents.capture(...)`. No
      // network call is made. `outcome` overrides the coin flip so the failure
      // path is reproducible.
      const requested = request.body?.outcome
      const captureSucceeded = requested ? requested === 'succeed' : Math.random() < 0.5

      if (captureSucceeded) {
        await prisma.payment.update({
          where: { id: pendingPayment.id },
          data: {
            status: 'COMPLETED',
            rawResponse: JSON.stringify({ simulated: true, capturedAt: new Date().toISOString() }),
          },
        })
        await prisma.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } })

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
      schema: {
        tags: ['orders'],
        description:
          'Operator hook: report a failed order-saga step and enqueue the real compensating ' +
          'action on the saga-compensation queue. ms-order has no multi-step saga ' +
          'implementation yet, so the failure is reported rather than detected; the ' +
          'compensation it triggers operates on real order/payment rows.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            step: {
              type: 'string',
              description: 'Name of the saga step that failed, e.g. "reserve-inventory".',
            },
            compensation: {
              type: 'string',
              enum: ['release-inventory', 'refund-payment'],
              description: 'Which compensating action to run.',
            },
            reason: { type: 'string' },
          },
          required: ['step', 'compensation'],
        },
        response: {
          202: { type: 'object', additionalProperties: true },
          400: { type: 'object', properties: { error: { type: 'string' } } },
          404: { type: 'object', properties: { error: { type: 'string' } } },
          503: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string }
        Body: {
          step: string
          compensation: 'release-inventory' | 'refund-payment'
          reason?: string
        }
      }>,
      reply: FastifyReply
    ) => {
      const order = await prisma.order.findUnique({
        where: { id: request.params.id },
        include: { items: true, payments: true },
      })
      if (!order) {
        return reply.status(404).send({ error: 'Order not found' })
      }

      const { step, compensation } = request.body
      const reason = request.body.reason ?? `saga step "${step}" failed`

      let jobId: string | undefined | null

      if (compensation === 'refund-payment') {
        const capturedPayment = order.payments.find((p) => p.status === 'COMPLETED')
        if (!capturedPayment) {
          return reply.status(400).send({
            error: 'Order has no COMPLETED payment to refund',
          })
        }
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
