import type { FastifyInstance, FastifyRequest } from 'fastify'
import { notFound, requireOwnerOrAny, type Static } from '@ecommerce/shared-security'
import { PrismaClient, Prisma } from '../../node_modules/.prisma-ms-order/client'
import { QueueManager } from '../queues'
import { toOrderRecord } from '../orderMapping'
import { stageOrderCancelled } from '../events'
import { can, requireCapability } from '../security'
import { registerOrderCreateRoute } from './ordersCreate'
import type { PriceVerifier } from '../pricing/PriceVerifier'
import {
  ErrorResponse,
  OrderListOut,
  OrderListQuery,
  OrderOut,
  OrderRefParams,
  OrderStatusBody,
} from './schemas'

export interface OrdersRouteDeps {
  prisma: PrismaClient
  queueManager: QueueManager
  /** Server-side price verification (plan 4.3). Absent = not checked (bare test servers). */
  priceVerifier?: PriceVerifier
}

/** Registers the `/api/v1/orders` list/get/create/update routes. */
export function registerOrderRoutes(
  server: FastifyInstance,
  { prisma, queueManager, priceVerifier }: OrdersRouteDeps
): void {
  server.get(
    '/api/v1/orders',
    {
      config: { policy: { permission: 'orders:read' } },
      schema: {
        tags: ['orders'],
        description:
          'List orders (paginated). A caller without orders:read:any sees only their own orders.',
        querystring: OrderListQuery,
        response: {
          200: OrderListOut,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: Static<typeof OrderListQuery> }>) => {
      const { page, limit } = request.query

      // The ownership filter lives IN the query, not after it: filtering a page
      // afterwards would leak totals and return short or empty pages.
      // An anonymous caller only reaches this line in AUTH_ENFORCE=report, whose
      // contract is "log the would-be denial, change nothing".
      const seesAll = !request.auth || can(request, 'orders:read:any')
      const where: Prisma.OrderWhereInput = seesAll ? {} : { userId: request.auth?.userId ?? '' }

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: { items: true, payments: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.order.count({ where }),
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
      config: { policy: { permission: 'orders:read' } },
      schema: {
        tags: ['orders'],
        description:
          "Fetch a single order by id or order number. Another user's order is a 404, not a 403.",
        params: OrderRefParams,
        response: {
          200: OrderOut,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Params: Static<typeof OrderRefParams> }>) => {
      const { id } = request.params
      const include = { items: true, payments: true } as const

      let order = await prisma.order.findUnique({ where: { id }, include })
      if (!order) {
        order = await prisma.order.findUnique({ where: { orderNumber: id }, include })
      }

      if (!order) throw notFound()
      requireOwnerOrAny(request, order.userId, 'orders:read')

      return toOrderRecord(order)
    }
  )

  registerOrderCreateRoute(server, {
    prisma,
    queueManager,
    ...(priceVerifier ? { priceVerifier } : {}),
  })

  server.patch(
    '/api/v1/orders/:id',
    {
      config: { policy: { permission: 'orders:update' } },
      schema: {
        tags: ['orders'],
        description:
          "Update an order's status. The owner may only cancel (status CANCELLED); any other " +
          'status needs orders:update:any.',
        params: OrderRefParams,
        body: OrderStatusBody,
        response: {
          200: OrderOut,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: Static<typeof OrderRefParams>
        Body: Static<typeof OrderStatusBody>
      }>
    ) => {
      const { status } = request.body

      const existing = await prisma.order.findUnique({
        where: { id: request.params.id },
        select: { id: true, userId: true },
      })
      if (!existing) throw notFound()

      // Ownership first (404 for a stranger), then what the caller may do to it (403).
      requireOwnerOrAny(request, existing.userId, 'orders:update')
      if (status !== 'CANCELLED') {
        requireCapability(
          request,
          'orders:update:any',
          'Customers can only cancel their own orders'
        )
      }

      try {
        // Status change and the cancellation event commit together (outbox).
        // The fact is staged only on the transition INTO CANCELLED; the other
        // status values have no consumer today.
        const order = await prisma.$transaction(async (tx) => {
          const updated = await tx.order.update({
            where: { id: request.params.id },
            data: { status },
            include: { items: true, payments: true },
          })
          if (status === 'CANCELLED') {
            await stageOrderCancelled(
              tx,
              {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                reason: 'status-updated-to-cancelled',
                items: updated.items.map((i) => ({
                  productId: i.productId,
                  sku: i.productSku,
                  quantity: i.quantity,
                  unitPrice: Number(i.unitPrice),
                })),
              },
              request.id
            )
          }
          return updated
        })

        return toOrderRecord(order)
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw notFound()
        }
        throw err
      }
    }
  )
}
