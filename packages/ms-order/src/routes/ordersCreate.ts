import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as crypto from 'crypto'
import { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { paymentMethodToProvider, paymentStatusToPaymentRowStatus } from '../seedOrders'
import { QueueManager } from '../queues'
import { publishOrderCreated, publishOrderConfirmed } from '../events'
import { toOrderRecord, generateUniqueOrderNumber, CreateOrderBody } from '../orderMapping'

export interface OrdersCreateRouteDeps {
  prisma: PrismaClient
  queueManager: QueueManager
}

/** Registers `POST /api/v1/orders` (checkout / order creation). */
export function registerOrderCreateRoute(
  server: FastifyInstance,
  { prisma, queueManager }: OrdersCreateRouteDeps
): void {
  server.post(
    '/api/v1/orders',
    {
      schema: {
        tags: ['orders'],
        description: 'Create a new order (checkout).',
        body: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            paymentPreCaptured: {
              type: 'boolean',
              description:
                'Defaults to true (existing client checkout captures payment client-side, ' +
                'yielding a CONFIRMED order). Send false to create a PENDING order awaiting ' +
                'payment, which enqueues a delayed expire-order job.',
            },
            customerName: { type: 'string' },
            customerEmail: { type: 'string' },
            items: { type: 'array', items: { type: 'object' } },
            shippingAddress: { type: 'object' },
            paymentMethod: { type: 'string' },
            subtotal: { type: 'number' },
            taxAmount: { type: 'number' },
            shippingAmount: { type: 'number' },
            discountAmount: { type: 'number' },
            totalAmount: { type: 'number' },
            currency: { type: 'string' },
          },
          required: [
            'customerName',
            'customerEmail',
            'items',
            'shippingAddress',
            'paymentMethod',
            'subtotal',
            'totalAmount',
          ],
        },
        response: {
          201: { type: 'object', additionalProperties: true },
          400: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateOrderBody }>, reply: FastifyReply) => {
      const body = request.body

      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Request body is required' })
      }
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return reply.status(400).send({ error: 'items must be a non-empty array' })
      }
      if (!body.customerName || !body.customerEmail) {
        return reply.status(400).send({ error: 'customerName and customerEmail are required' })
      }
      if (
        !body.shippingAddress ||
        !body.shippingAddress.addressLine1 ||
        !body.shippingAddress.city ||
        !body.shippingAddress.state ||
        !body.shippingAddress.postalCode ||
        !body.shippingAddress.country
      ) {
        return reply.status(400).send({ error: 'shippingAddress is missing required fields' })
      }
      if (!body.paymentMethod) {
        return reply.status(400).send({ error: 'paymentMethod is required' })
      }
      if (typeof body.subtotal !== 'number' || typeof body.totalAmount !== 'number') {
        return reply.status(400).send({ error: 'subtotal and totalAmount must be numbers' })
      }

      let orderNumber: string
      try {
        orderNumber = await generateUniqueOrderNumber(prisma)
      } catch (err) {
        server.log.error(err)
        return reply.status(500).send({ error: 'Failed to generate order number' })
      }

      // No authenticated user context is wired into ms-order yet (no auth
      // middleware on this service), so unauthenticated/guest checkouts are
      // accepted and stored with a 'guest' placeholder userId rather than
      // rejected outright.
      const userId = body.userId ?? 'guest'

      const itemsWithComputedTotals = body.items.map((item) => ({
        productId: item.productId,
        productSku: item.sku,
        productTitle: item.title,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        totalPrice: Math.round(item.unitPrice * item.quantity * 100) / 100,
      }))

      const taxAmount = body.taxAmount ?? 0
      const shippingAmount = body.shippingAmount ?? 0
      const discountAmount = body.discountAmount ?? 0

      // Payment state at creation drives BOTH the order status and which
      // queues are triggered.
      //
      // The original behaviour (and still the default, so the existing client
      // checkout is unaffected) is that the caller captured payment
      // client-side, so the order is created CONFIRMED with a COMPLETED
      // payment row. An order created that way is already paid and MUST NOT
      // get an expiration job — enqueueing one would be dead work against a
      // condition that can never hold.
      //
      // Sending `paymentPreCaptured: false` models the other genuine branch:
      // the order is awaiting payment, so it is created PENDING with a PENDING
      // payment row, and a delayed expire-order job is enqueued. That is the
      // real condition order-expiration exists to handle.
      const paymentPreCaptured = body.paymentPreCaptured !== false
      const orderStatus = paymentPreCaptured ? 'CONFIRMED' : 'PENDING'
      const currency = body.currency ?? 'USD'

      const order = await prisma.order.create({
        data: {
          orderNumber,
          userId,
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          status: orderStatus,
          subtotal: body.subtotal,
          taxAmount,
          shippingAmount,
          discountAmount,
          totalAmount: body.totalAmount,
          currency,
          shippingAddress: JSON.stringify(body.shippingAddress),
          billingAddress: JSON.stringify(body.shippingAddress),
          items: { create: itemsWithComputedTotals },
          payments: {
            create: [
              {
                provider: paymentMethodToProvider(body.paymentMethod),
                transactionId: `ch_${crypto.randomUUID()}`,
                paymentMethod: body.paymentMethod,
                amount: body.totalAmount,
                currency,
                status: paymentStatusToPaymentRowStatus(paymentPreCaptured ? 'PAID' : 'PENDING'),
              },
            ],
          },
        },
        include: { items: true, payments: true },
      })

      // --- Producers -------------------------------------------------------
      // Enqueue failures are logged and swallowed: the order is already
      // committed to the database and a Redis outage must not retroactively
      // fail it.

      // Kafka first: order.created is a FACT about a row that now exists, and
      // it is what ms-inventory and ms-analytics consume. Publishing is
      // additive — the BullMQ enqueues below are unchanged, so an unreachable
      // broker changes nothing about how checkout behaves today.
      //
      // Published for BOTH branches: a CONFIRMED order still needs its stock
      // reserved and still belongs in the analytics funnel. `status` on the
      // payload is what lets a consumer tell the two apart.
      await publishOrderCreated(
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: order.userId,
          customerEmail: order.customerEmail,
          status: orderStatus,
          totalAmount: Number(order.totalAmount),
          currency: order.currency,
          items: order.items.map((i) => ({
            productId: i.productId,
            sku: i.productSku,
            quantity: i.quantity,
            unitPrice: Number(i.unitPrice),
          })),
        },
        request.id
      )

      if (orderStatus === 'PENDING') {
        // order-expiration: only reachable for an order that is genuinely
        // awaiting payment.
        await queueManager.tryEnqueue('expire-order', () =>
          queueManager.enqueueExpireOrder({
            orderId: order.id,
            orderNumber: order.orderNumber,
            enqueuedAt: order.createdAt.toISOString(),
          })
        )
      } else {
        // An order created with payment already captured is confirmed at
        // birth, so the confirmation fact belongs on the log too.
        await publishOrderConfirmed(
          {
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerEmail: order.customerEmail,
            customerName: order.customerName,
            totalAmount: Number(order.totalAmount),
            currency: order.currency,
          },
          request.id
        )

        // notification-dispatch: a confirmed order really does warrant a
        // confirmation email and a receipt.
        //
        // These stay in-process deliberately. They COULD move behind an
        // order.confirmed consumer, and the plan notes that as the one
        // existing trigger worth relocating — but doing it in the same change
        // that introduces the backbone would put checkout's emails behind an
        // optional, default-off broker. They move once a consumer for them
        // exists and is proven.
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
      }

      return reply.status(201).send(toOrderRecord(order))
    }
  )
}
