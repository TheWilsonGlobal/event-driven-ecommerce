import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient, Prisma } from '../../node_modules/.prisma-ms-order/client'
import { QueueManager } from '../queues'
import { ORDER_STATUSES, toOrderRecord } from '../orderMapping'
import { publishOrderCancelled } from '../events'
import { registerOrderCreateRoute } from './ordersCreate'

export interface OrdersRouteDeps {
  prisma: PrismaClient
  queueManager: QueueManager
}

/** Registers the `/api/v1/orders` list/get/create/update routes. */
export function registerOrderRoutes(
  server: FastifyInstance,
  { prisma, queueManager }: OrdersRouteDeps
): void {
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

  registerOrderCreateRoute(server, { prisma, queueManager })

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

        // A cancellation is the fact ms-inventory needs in order to release
        // whatever it reserved. Published only on the transition INTO
        // CANCELLED; the other status values have no consumer today and
        // publishing them would put events on the log that nothing reads.
        if (status === 'CANCELLED') {
          await publishOrderCancelled(
            {
              orderId: order.id,
              orderNumber: order.orderNumber,
              reason: 'status-updated-to-cancelled',
              items: order.items.map((i) => ({
                productId: i.productId,
                sku: i.productSku,
                quantity: i.quantity,
                unitPrice: Number(i.unitPrice),
              })),
            },
            request.id
          )
        }

        return toOrderRecord(order)
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.status(404).send({ error: 'Order not found' })
        }
        throw err
      }
    }
  )
}
