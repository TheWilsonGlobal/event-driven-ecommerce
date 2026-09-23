import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import type { InventoryDoc, ReservationDoc } from '../types'

export interface InventoryRouteDeps {
  inventoryStore: DocumentDatabaseAdapter<InventoryDoc>
  reservationsStore: DocumentDatabaseAdapter<ReservationDoc>
}

const inventoryRowSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    sku: { type: 'string' },
    available: { type: 'number', description: 'Units free to be reserved.' },
    reserved: {
      type: 'number',
      description: 'Units held for an order that has neither shipped nor been cancelled.',
    },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['productId', 'sku', 'available', 'reserved', 'updatedAt'],
} as const

const reservationSchema = {
  type: 'object',
  properties: {
    orderId: { type: 'string' },
    orderNumber: { type: 'string' },
    eventId: {
      type: 'string',
      description: 'The order.created eventId this reservation was made in response to.',
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          sku: { type: 'string' },
          quantity: { type: 'number' },
        },
        required: ['productId', 'sku', 'quantity'],
      },
    },
    status: { type: 'string', enum: ['RESERVED', 'RELEASED'] },
    createdAt: { type: 'string', format: 'date-time' },
    // Nullable, and it must stay ['string','null']: under a plain
    // { type: 'string' } Fastify's serializer coerces null to "", which would
    // render as a present-but-blank release timestamp on a reservation that
    // was never released.
    releasedAt: { type: ['string', 'null'], format: 'date-time' },
  },
  required: ['orderId', 'orderNumber', 'eventId', 'items', 'status', 'createdAt', 'releasedAt'],
} as const

/**
 * Read-only views over the stock ledger.
 *
 * There is deliberately no write endpoint. Every stock movement in this
 * service originates from a consumed order event, so a POST /reserve would be
 * a second, unordered path to the same state — one with none of the
 * idempotency guarantees the event path has, and one whose writes would be
 * invisible on the inventory topic.
 */
export function registerInventoryRoutes(
  server: FastifyInstance,
  { inventoryStore, reservationsStore }: InventoryRouteDeps
): void {
  server.get(
    '/api/v1/inventory',
    {
      schema: {
        tags: ['inventory'],
        description: 'Current stock levels for every product this service tracks.',
        response: {
          200: {
            type: 'object',
            properties: {
              count: { type: 'number' },
              items: { type: 'array', items: inventoryRowSchema },
            },
            required: ['count', 'items'],
          },
        },
      },
    },
    async () => {
      const rows = await inventoryStore.find({})
      rows.sort((a, b) => a.productId.localeCompare(b.productId))
      return { count: rows.length, items: rows }
    }
  )

  server.get(
    '/api/v1/inventory/:productId',
    {
      schema: {
        tags: ['inventory'],
        description: 'Current stock level for one product.',
        params: {
          type: 'object',
          properties: { productId: { type: 'string' } },
          required: ['productId'],
        },
        response: {
          200: inventoryRowSchema,
          404: {
            type: 'object',
            properties: { error: { type: 'string' } },
            required: ['error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { productId: string } }>, reply: FastifyReply) => {
      const row = await inventoryStore.findOne({ productId: request.params.productId })
      if (!row) {
        // 404, not a zeroed row: this service does not own the catalogue, so
        // "no stock record" means "unknown to inventory", which is a different
        // fact from "in stock, zero units".
        return reply.status(404).send({ error: 'No inventory record for that product' })
      }
      return row
    }
  )

  server.get(
    '/api/v1/reservations',
    {
      schema: {
        tags: ['reservations'],
        description:
          'Stock reservations, newest first. Optionally filtered to one order. A row ' +
          'exists only for an order whose stock was actually reserved — an order that ' +
          'was short produced an inventory.insufficient event and no row.',
        querystring: {
          type: 'object',
          properties: { orderId: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              count: { type: 'number' },
              items: { type: 'array', items: reservationSchema },
            },
            required: ['count', 'items'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { orderId?: string } }>) => {
      const { orderId } = request.query
      const rows = await reservationsStore.find(orderId ? { orderId } : {})
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return { count: rows.length, items: rows }
    }
  )
}
