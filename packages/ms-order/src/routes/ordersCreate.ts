import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as crypto from 'crypto'
import { AppError, correlationHeaders } from '@ecommerce/shared-security'
import { Prisma, PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { paymentMethodToProvider, paymentStatusToPaymentRowStatus } from '../seedOrders'
import { QueueManager } from '../queues'
import { stageOrderCreated, stageOrderConfirmed } from '../events'
import { toOrderRecord, generateUniqueOrderNumber } from '../orderMapping'
import {
  checkOrderPrices,
  ProductUnavailableError,
  type PriceVerifier,
} from '../pricing/PriceVerifier'
import {
  CreateOrderBodySchema,
  CreateOrderHeaders,
  ErrorResponse,
  OrderOut,
  type CreateOrderBodyT,
} from './schemas'

export interface OrdersCreateRouteDeps {
  prisma: PrismaClient
  queueManager: QueueManager
  priceVerifier?: PriceVerifier
}

/** Registers `POST /api/v1/orders` (checkout / order creation). */
export function registerOrderCreateRoute(
  server: FastifyInstance,
  { prisma, queueManager, priceVerifier }: OrdersCreateRouteDeps
): void {
  server.post(
    '/api/v1/orders',
    {
      config: { policy: { permission: 'orders:create' }, rateTier: 'write' },
      schema: {
        tags: ['orders'],
        description:
          'Create a new order (checkout). Authenticated only: the owner is the token subject ' +
          '(a body `userId` is rejected). Prices are verified against ms-product (PRICE_CHECK). ' +
          'Idempotency: send the Idempotency-Key header (or body idempotencyKey); a repeat with ' +
          'the same key and the same order returns the original order (200) and emits no new ' +
          'events; the same key with a DIFFERENT order is a 409. `paymentPreCaptured` defaults ' +
          'to true (the web checkout captures payment client-side, yielding a CONFIRMED order); ' +
          'false creates a PENDING order awaiting payment and enqueues a delayed expire-order job.',
        headers: CreateOrderHeaders,
        body: CreateOrderBodySchema,
        response: {
          200: OrderOut,
          201: OrderOut,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
          422: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateOrderBodyT }>, reply: FastifyReply) => {
      const body = request.body

      // The strict body schema has already bounded and typed everything above.
      // Ownership comes ONLY from the verified token. `request.auth` is null
      // solely in AUTH_ENFORCE=report (the policy hook would have refused it in
      // enforce), where the pre-auth 'guest' placeholder keeps checkout working
      // while the would-be denial is logged.
      const userId = request.auth?.userId ?? 'guest'

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
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Idempotency-Key was already used for a different order'
          )
        }
        return reply.header('Idempotent-Replay', 'true').status(200).send(toOrderRecord(existing))
      }
      const replayed = await replay()
      if (replayed) return replayed

      const taxAmount = body.taxAmount ?? 0
      const shippingAmount = body.shippingAmount ?? 0
      const discountAmount = body.discountAmount ?? 0
      const currency = body.currency ?? 'USD'

      // Plan 4.3: the client's prices are claims, not facts. After the replay
      // check (an old order must stay replayable after a price change) and before
      // any write.
      const catalogue = priceVerifier
        ? await verifyPrices(request, priceVerifier, {
            items: body.items,
            subtotal: body.subtotal,
            taxAmount,
            shippingAmount,
            discountAmount,
            totalAmount: body.totalAmount,
            currency,
          })
        : null

      // First non-empty categoryId per product id (the order line body is
      // optional-categoryId; the DB keeps no category column).
      const categoryByProduct = new Map<string, string>()
      for (const item of body.items) {
        if (item.categoryId && !categoryByProduct.has(item.productId)) {
          categoryByProduct.set(item.productId, item.categoryId)
        }
      }

      let orderNumber: string
      try {
        orderNumber = await generateUniqueOrderNumber(prisma)
      } catch (err) {
        server.log.error(err)
        throw new AppError(500, 'ORDER_NUMBER_FAILED', 'Failed to generate order number')
      }

      const itemsWithComputedTotals = body.items.map((item) => {
        // Enforce mode stores the catalogue's sku/title: they travel on the
        // order events, so a client must not be able to rename a product.
        const authoritative =
          priceVerifier?.mode === 'enforce' ? catalogue?.get(item.productId) : undefined
        return {
          productId: item.productId,
          productSku: authoritative?.sku ?? item.sku,
          productTitle: authoritative?.title ?? item.title,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          totalPrice: Math.round(item.unitPrice * item.quantity * 100) / 100,
        }
      })

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

            const categoryFor = (productId: string): { categoryId?: string } => {
              const categoryId = categoryByProduct.get(productId)
              return categoryId ? { categoryId } : {}
            }

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
                  // Not stored on order_items: forwarded from the request so
                  // ms-analytics can rank categories. Matched by product id.
                  ...categoryFor(i.productId),
                })),
              },
              request.correlationId
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
                request.correlationId
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
  body: CreateOrderBodyT
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

/**
 * Runs the catalogue check and applies PRICE_CHECK. Returns the catalogue
 * entries it resolved (for authoritative sku/title), or null when the check
 * could not run in report mode.
 */
async function verifyPrices(
  request: FastifyRequest,
  verifier: PriceVerifier,
  input: Parameters<typeof checkOrderPrices>[1]
): Promise<Map<string, { sku: string | null; title: string | null }> | null> {
  const enforce = verifier.mode === 'enforce'
  try {
    const { mismatches, products } = await checkOrderPrices(
      verifier.client,
      input,
      correlationHeaders(request)
    )
    if (mismatches.length === 0) return products
    request.log.warn(
      {
        priceCheck: {
          code: 'PRICE_MISMATCH',
          enforced: enforce,
          mismatches: mismatches.slice(0, 20),
        },
      },
      'order prices differ from the catalogue'
    )
    if (enforce) {
      throw new AppError(422, 'PRICE_MISMATCH', 'Order prices do not match the catalogue', {
        mismatches: mismatches.slice(0, 20),
      })
    }
    return products
  } catch (err) {
    if (!(err instanceof ProductUnavailableError)) throw err
    request.log.warn({ err: err.message, enforced: enforce }, 'price verification unavailable')
    if (enforce) {
      throw new AppError(
        503,
        'PRICE_CHECK_UNAVAILABLE',
        'Prices cannot be verified right now, please retry shortly',
        {},
        { 'retry-after': '5' }
      )
    }
    return null
  }
}
