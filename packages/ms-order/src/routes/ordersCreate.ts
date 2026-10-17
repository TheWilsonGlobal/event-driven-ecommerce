import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as crypto from 'crypto'
import { Prisma, PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { paymentMethodToProvider, paymentStatusToPaymentRowStatus } from '../seedOrders'
import { QueueManager } from '../queues'
import { stageOrderCreated, stageOrderConfirmed } from '../events'
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
            idempotencyKey: {
              type: 'string',
              description:
                'Optional dedupe key (or send the Idempotency-Key header). A repeat with the same ' +
                'key and the same order returns the original order (200) and emits no new events; ' +
                'the same key with a DIFFERENT order is a 409.',
            },
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
          200: { type: 'object', additionalProperties: true },
          201: { type: 'object', additionalProperties: true },
          409: { type: 'object', properties: { error: { type: 'string' } } },
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

      // Pattern 2 (idempotency): a retried checkout must converge on ONE order.
      // The Idempotency-Key header wins over the body field when both are sent.
      const headerKey = request.headers['idempotency-key']
      const idempotencyKey =
        (typeof headerKey === 'string' && headerKey.trim()) || body.idempotencyKey || undefined

      const replay = async (): Promise<FastifyReply | null> => {
        if (!idempotencyKey) return null
        const existing = await prisma.order.findUnique({
          where: { idempotencyKey },
          include: { items: true, payments: true },
        })
        if (!existing) return null
        if (!sameOrder(existing, body)) {
          // Same key, different content: ignoring it would silently drop the
          // caller's second order; honouring it would break the key's meaning.
          return reply.status(409).send({
            error: 'Idempotency-Key was already used for a different order',
          })
        }
        return reply.header('Idempotent-Replay', 'true').status(200).send(toOrderRecord(existing))
      }
      const replayed = await replay()
      if (replayed) return replayed

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

      // Pattern 1 (outbox): the order rows AND the events describing them commit in one
      // transaction. A crash can no longer leave an order that nobody was told about.
      let order
      try {
        order = await prisma.$transaction(
          async (tx) => {
            const created = await tx.order.create({
              data: {
                orderNumber,
                idempotencyKey: idempotencyKey ?? null,
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
                      status: paymentStatusToPaymentRowStatus(
                        paymentPreCaptured ? 'PAID' : 'PENDING'
                      ),
                    },
                  ],
                },
              },
              include: { items: true, payments: true },
            })

            await stageOrderCreated(
              tx,
              {
                orderId: created.id,
                orderNumber: created.orderNumber,
                userId: created.userId,
                customerEmail: created.customerEmail,
                status: orderStatus,
                totalAmount: Number(created.totalAmount),
                currency: created.currency,
                items: created.items.map((i) => ({
                  productId: i.productId,
                  sku: i.productSku,
                  quantity: i.quantity,
                  unitPrice: Number(i.unitPrice),
                })),
              },
              request.id
            )
            if (orderStatus === 'CONFIRMED') {
              // Confirmed at birth, so the confirmation fact belongs on the log too.
              await stageOrderConfirmed(
                tx,
                {
                  orderId: created.id,
                  orderNumber: created.orderNumber,
                  customerEmail: created.customerEmail,
                  customerName: created.customerName,
                  totalAmount: Number(created.totalAmount),
                  currency: created.currency,
                },
                request.id
              )
            }
            return created
          },
          { timeout: 20_000 }
        )
      } catch (err) {
        // Two concurrent requests with one key: the loser hits the unique index.
        if (
          idempotencyKey &&
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const raced = await replay()
          if (raced) return raced
        }
        throw err
      }

      // --- Producers -------------------------------------------------------
      // Kafka events were staged in the transaction above and are delivered by
      // the outbox relay. The BullMQ enqueues below are best-effort and stay
      // post-commit: a Redis outage must not retroactively fail the order.

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

/** True when a stored order and a (re)submitted body describe the same purchase. */
function sameOrder(
  existing: {
    customerEmail: string
    totalAmount: unknown
    items: { productId: string; quantity: number }[]
  },
  body: CreateOrderBody
): boolean {
  if (existing.customerEmail !== body.customerEmail) return false
  if (Number(existing.totalAmount) !== body.totalAmount) return false
  const key = (xs: { productId: string; quantity: number }[]) =>
    xs
      .map((i) => `${i.productId}:${i.quantity}`)
      .sort()
      .join('|')
  return key(existing.items) === key(body.items)
}
