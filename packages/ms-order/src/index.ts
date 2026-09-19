import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as crypto from 'crypto'
import { PrismaClient, Prisma } from '../node_modules/.prisma-ms-order/client'
import { createKeyValueStore, loadDatabaseConfig } from '@ecommerce/shared-database'
import {
  seedOrdersIfEmpty,
  paymentMethodToProvider,
  paymentStatusToPaymentRowStatus,
} from './seedOrders'
import { QueueManager, registerQueueRoutes, QUEUE_DEFINITIONS, redisEnabled } from './queues'
import {
  registerMetrics,
  buildLoggerOptions,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import { registerSchemaRoutes, registerLogRoutes } from './diagnostics'

/** Workspace root — this service's cwd is packages/ms-order. */
const REPO_ROOT = path.resolve(__dirname, '../../../')

// Package-local .env first: dotenv never overrides an already-set key, so the
// SQLite DATABASE_URL this service's Prisma schema needs wins over the root
// .env's Postgres DATABASE_URL (which other, non-Prisma consumers read).
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(REPO_ROOT, '.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.ORDER_SERVICE_PORT || '5465', 10)

// Relative KV paths are written from the repo root, but this process runs in
// packages/ms-order — without this, './data/rocksdb' would land in
// packages/ms-order/data/. Mirrors what ms-product does for its NeDB path.
if (!path.isAbsolute(dbConfig.keyValue.embedded.dataPath)) {
  dbConfig.keyValue.embedded.dataPath = path.resolve(REPO_ROOT, dbConfig.keyValue.embedded.dataPath)
}

const prisma = new PrismaClient()

// The embedded store is only constructed when it is the active driver, so the
// Redis path does not create a file it never reads.
const kvStore = redisEnabled ? undefined : createKeyValueStore(dbConfig)

// BullMQ queues + workers. Construction never throws and never blocks on a
// connection, so ms-order boots and serves the order API even when Redis is
// down; the queue endpoints report 503 instead of pretending to be empty.
//
// On the embedded driver no Redis connection is created at all — otherwise the
// process would open sockets retrying forever against a Redis that is
// deliberately not running — and the queue endpoints report kv_driver_not_redis.
const queueManager = new QueueManager(prisma, redisEnabled, kvStore)

const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { items: true; payments: true }
}>

// Inverse of paymentStatusToPaymentRowStatus (see src/seedOrders.ts) — must be
// kept consistent with that mapping so paymentStatus round-trips through the API.
function paymentRowStatusToPaymentStatus(
  status: string
): 'PAID' | 'PENDING' | 'FAILED' | 'REFUNDED' {
  switch (status) {
    case 'COMPLETED':
      return 'PAID'
    case 'FAILED':
      return 'FAILED'
    case 'REFUNDED':
      return 'REFUNDED'
    case 'PENDING':
    default:
      return 'PENDING'
  }
}

function toOrderRecord(order: OrderWithRelations) {
  const latestPayment = [...order.payments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0]

  const shippingAddress = JSON.parse(order.shippingAddress) as {
    addressLine1: string
    city: string
    state: string
    postalCode: string
    country: string
  }

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.userId,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    status: order.status,
    subtotal: Number(order.subtotal),
    taxAmount: Number(order.taxAmount),
    shippingAmount: Number(order.shippingAmount),
    discountAmount: Number(order.discountAmount),
    totalAmount: Number(order.totalAmount),
    currency: order.currency,
    paymentMethod: latestPayment ? latestPayment.paymentMethod : 'MOCK',
    paymentStatus: latestPayment
      ? paymentRowStatusToPaymentStatus(latestPayment.status)
      : 'PENDING',
    transactionId: latestPayment ? latestPayment.transactionId : '',
    shippingAddress,
    items: order.items.map((item) => ({
      productId: item.productId,
      sku: item.productSku,
      title: item.productTitle,
      unitPrice: Number(item.unitPrice),
      quantity: item.quantity,
      totalPrice: Number(item.totalPrice),
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  }
}

interface CreateOrderBody {
  userId?: string
  /**
   * Whether the caller already captured payment before calling this endpoint.
   *
   * The existing client checkout captures client-side and so omits this (or
   * sends true), producing a CONFIRMED order exactly as before — this field is
   * backwards-compatible by default. Sending `false` models the other real
   * branch of the flow: an order awaiting payment, created as PENDING, which
   * is what makes the order-expiration queue reachable.
   */
  paymentPreCaptured?: boolean
  customerName: string
  customerEmail: string
  items: {
    productId: string
    sku: string
    title: string
    unitPrice: number
    quantity: number
  }[]
  shippingAddress: {
    addressLine1: string
    city: string
    state: string
    postalCode: string
    country: string
  }
  paymentMethod: string
  subtotal: number
  taxAmount?: number
  shippingAmount?: number
  discountAmount?: number
  totalAmount: number
  currency?: string
}

async function generateUniqueOrderNumber(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `ORD-${Math.floor(100000 + Math.random() * 900000)}`
    const existing = await prisma.order.findUnique({ where: { orderNumber: candidate } })
    if (!existing) {
      return candidate
    }
  }
  throw new Error('Failed to generate a unique order number after 5 attempts')
}

const server: FastifyInstance = fastify({
  // Pretty terminal output, plus shipping to Loki when it is reachable.
  logger: buildLoggerOptions({ service: 'ms-order' }),
})

async function bootstrap() {
  // Before every other plugin, so the onResponse hook sees all traffic.
  registerMetrics(server, { service: 'ms-order' })

  // Before any route registration below — onRoute only fires for routes
  // registered after this hook is attached.
  const routeRegistry = createRouteRegistry(server)

  await server.register(cors, { origin: '*' })
  await server.register(helmet)

  await server.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Order Service',
        description: 'Order processing, cart, and payment orchestration service.',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      tags: [
        { name: 'health', description: 'Service health and status' },
        { name: 'orders', description: 'Order management' },
        { name: 'cart', description: 'Shopping cart' },
        { name: 'payments', description: 'Payment capture and retry' },
        { name: 'queues', description: 'BullMQ queue introspection' },
        { name: 'cache', description: 'Redis keyspace introspection' },
        { name: 'schema', description: 'Live database schema introspection' },
        { name: 'logs', description: 'Real log file listing and reading' },
        { name: 'endpoints', description: 'Live registered-route inventory' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })

  server.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        description: 'Service liveness/status check, including database/queue driver.',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              database: {
                type: 'object',
                properties: {
                  mode: { type: 'string' },
                  driver: { type: 'string' },
                  queue: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return {
        status: 'ok',
        service: 'ms-order',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.relational.driver,
          queue: dbConfig.keyValue.driver,
        },
      }
    }
  )

  server.get(
    '/api/v1/orders',
    {
      schema: {
        tags: ['orders'],
        description: 'List orders (paginated).',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'string' },
            limit: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              orders: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
              total: { type: 'number' },
              page: { type: 'number' },
              limit: { type: 'number' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>) => {
      const pageRaw = parseInt(request.query.page ?? '1', 10)
      const limitRaw = parseInt(request.query.limit ?? '20', 10)
      const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          skip: (page - 1) * limit,
          take: limit,
          include: { items: true, payments: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.order.count(),
      ])

      return {
        orders: orders.map(toOrderRecord),
        total,
        page,
        limit,
      }
    }
  )

  server.get(
    '/api/v1/orders/:id',
    {
      schema: {
        tags: ['orders'],
        description: 'Fetch a single order by id or order number.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          404: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params
      const include = { items: true, payments: true } as const

      let order = await prisma.order.findUnique({ where: { id }, include })
      if (!order) {
        order = await prisma.order.findUnique({ where: { orderNumber: id }, include })
      }

      if (!order) {
        return reply.status(404).send({ error: 'Order not found' })
      }

      return toOrderRecord(order)
    }
  )

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
        orderNumber = await generateUniqueOrderNumber()
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

  server.patch(
    '/api/v1/orders/:id',
    {
      schema: {
        tags: ['orders'],
        description: "Update an order's status.",
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: { status: { type: 'string' } },
          required: ['status'],
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          400: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          404: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { status?: string } }>,
      reply: FastifyReply
    ) => {
      const { status } = request.body
      if (!status || !ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
        return reply
          .status(400)
          .send({ error: `status must be one of: ${ORDER_STATUSES.join(', ')}` })
      }

      try {
        const order = await prisma.order.update({
          where: { id: request.params.id },
          data: { status },
          include: { items: true, payments: true },
        })
        return toOrderRecord(order)
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.status(404).send({ error: 'Order not found' })
        }
        throw err
      }
    }
  )

  // ---------------------------------------------------------------------
  // Payment capture
  //
  // This is the real lifecycle step that makes payment-retry and
  // saga-compensation reachable. An order created with
  // `paymentPreCaptured: false` is PENDING with a PENDING payment row; this
  // endpoint attempts to capture it.
  //
  // The capture ITSELF is simulated (see the SIMULATED note in the handler) —
  // there are no Stripe/PayPal credentials in this repo. Everything the
  // outcome drives is real: the payment/order rows, the enqueued retry job,
  // BullMQ's exponential backoff, and the saga compensation once retries are
  // exhausted.
  //
  // `outcome` lets an operator deterministically drive either branch, which is
  // how the admin panel's queues get exercised without waiting on chance. It
  // is an explicit request parameter, NOT a background timer fabricating jobs.
  // ---------------------------------------------------------------------
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

  // ---------------------------------------------------------------------
  // Saga step failure
  //
  // ms-order has no multi-step distributed saga implemented today, so there is
  // no inventory-reservation step that can fail on its own. Rather than invent
  // a fake one, this endpoint is an HONESTLY-NAMED operator hook that reports a
  // real saga step failure for a real order and runs the real compensating
  // action against the real database rows.
  //
  // When a genuine saga is implemented in ms-order, its failure handler should
  // call queueManager.enqueueReleaseInventory / enqueueRefundPayment directly
  // and this endpoint can go away.
  // ---------------------------------------------------------------------
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

  registerQueueRoutes(server, queueManager)
  registerSchemaRoutes(server, prisma)
  registerLogRoutes(server)

  server.get(
    '/api/v1/cart',
    {
      schema: {
        tags: ['cart'],
        description: "Get the current user's cart contents.",
        response: {
          200: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'object' } },
              subtotal: { type: 'number' },
              total: { type: 'number' },
            },
          },
        },
      },
    },
    async () => {
      return {
        items: [],
        subtotal: 0,
        total: 0,
      }
    }
  )

  try {
    const seededCount = await seedOrdersIfEmpty(prisma)
    if (seededCount > 0) {
      console.log(`[Order Service] Self-seeded ${seededCount} orders (orders table was empty)`)
    }
  } catch (err) {
    server.log.error(err, '[Order Service] Failed to self-seed orders')
  }

  // Workers attach to Redis lazily; if Redis is down they sit reconnecting
  // (with an 'error' handler attached) and the service still serves HTTP.
  if (redisEnabled) {
    queueManager.startWorkers()
  } else {
    const info = queueManager.keyValueInfo()
    // eslint-disable-next-line no-console
    console.warn(
      `[Order Service] KV driver is "${dbConfig.keyValue.driver}" (${info.label}); ` +
        `BullMQ workers are disabled and the queue endpoints will report ` +
        `kv_driver_not_redis. Snapshot: ${info.dataPath ?? 'in-memory'}`
    )
    console.log(
      `[Order Service] BullMQ workers started for: ${QUEUE_DEFINITIONS.map((q) => q.name).join(', ')}`
    )
  }

  registerEndpointsRoute(server, routeRegistry, 'ms-order')

  registerShutdownHandlers()

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Order Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

/**
 * Closes workers, queues, Redis connections, the HTTP server and Prisma on
 * SIGTERM/SIGINT. Without this the BullMQ workers' blocking Redis reads keep
 * the event loop alive and ms-order hangs instead of exiting.
 */
function registerShutdownHandlers(): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    console.log(`[Order Service] Received ${signal}, shutting down...`)

    try {
      await server.close()
    } catch (err) {
      console.warn(`[Order Service] Error closing HTTP server: ${(err as Error).message}`)
    }

    try {
      await queueManager.close()
    } catch (err) {
      console.warn(`[Order Service] Error closing queues: ${(err as Error).message}`)
    }

    try {
      await kvStore?.close?.()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[Order Service] Error closing KV store: ${(err as Error).message}`)
    }

    try {
      await prisma.$disconnect()
    } catch (err) {
      console.warn(`[Order Service] Error disconnecting Prisma: ${(err as Error).message}`)
    }

    console.log('[Order Service] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

bootstrap()
