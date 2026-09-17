import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as crypto from 'crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import { loadDatabaseConfig } from '@ecommerce/shared-database'
import {
  seedOrdersIfEmpty,
  paymentMethodToProvider,
  paymentStatusToPaymentRowStatus,
} from './seedOrders'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.ORDER_SERVICE_PORT || '3003', 10)

const prisma = new PrismaClient()

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
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  },
})

async function bootstrap() {
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

      const order = await prisma.order.create({
        data: {
          orderNumber,
          userId,
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          // Checkout only reaches this endpoint after payment has already
          // been captured client-side (this is a demo payment flow), so the
          // order is created directly as CONFIRMED rather than PENDING.
          status: 'CONFIRMED',
          subtotal: body.subtotal,
          taxAmount,
          shippingAmount,
          discountAmount,
          totalAmount: body.totalAmount,
          currency: body.currency ?? 'USD',
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
                currency: body.currency ?? 'USD',
                status: paymentStatusToPaymentRowStatus('PAID'),
              },
            ],
          },
        },
        include: { items: true, payments: true },
      })

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

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Order Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
