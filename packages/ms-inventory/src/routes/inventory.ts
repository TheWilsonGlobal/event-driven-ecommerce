import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  EntityId,
  ErrorResponse,
  Strict,
  Type,
  notFound,
  type Static,
} from '@ecommerce/shared-security'
import { getInventory, listInventory, listReservations, type InventoryStore } from '../db/store'

export interface InventoryRouteDeps {
  store: InventoryStore
}

const closed = { additionalProperties: false }

// ── Requests ────────────────────────────────────────────────────────────────

const ProductParams = Strict({ productId: EntityId })

// Defaults to the largest page (100) rather than the shared 20: this listing
// used to return every row, and a smaller default would silently truncate it.
const PageQuery = {
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 100 }),
  offset: Type.Integer({ minimum: 0, maximum: 100_000, default: 0 }),
}

const InventoryQuery = Strict({ ...PageQuery })
const ReservationsQuery = Strict({ orderId: Type.Optional(EntityId), ...PageQuery })

// ── Responses ───────────────────────────────────────────────────────────────

const InventoryRowOut = Type.Object(
  {
    productId: Type.String(),
    sku: Type.String(),
    available: Type.Number({ description: 'Units free to be reserved.' }),
    reserved: Type.Number({
      description: 'Units held for an order that has neither shipped nor been cancelled.',
    }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  closed
)

const ReservationOut = Type.Object(
  {
    orderId: Type.String(),
    orderNumber: Type.String(),
    eventId: Type.String({
      description: 'The order.created eventId this reservation was made in response to.',
    }),
    items: Type.Array(
      Type.Object({ productId: Type.String(), sku: Type.String(), quantity: Type.Number() }, closed)
    ),
    status: Type.Unsafe<'RESERVED' | 'RELEASED'>({
      type: 'string',
      enum: ['RESERVED', 'RELEASED'],
    }),
    createdAt: Type.String({ format: 'date-time' }),
    // Nullable, and it must stay ['string','null']: under a plain
    // { type: 'string' } Fastify's serializer coerces null to "", which would
    // render as a present-but-blank release timestamp on a reservation that
    // was never released.
    releasedAt: Type.Unsafe<string | null>({ type: ['string', 'null'], format: 'date-time' }),
  },
  closed
)

const InventoryListOut = Type.Object(
  { count: Type.Integer(), items: Type.Array(InventoryRowOut) },
  closed
)
const ReservationListOut = Type.Object(
  { count: Type.Integer(), items: Type.Array(ReservationOut) },
  closed
)

/**
 * Read-only views over the stock ledger.
 *
 * There is deliberately no write endpoint. Every stock movement in this
 * service originates from a consumed order event, so a POST /reserve would be
 * a second, unordered path to the same state — one with none of the
 * idempotency guarantees the event path has, and one whose writes would be
 * invisible on the inventory topic.
 *
 * Stock levels and reservations are back-office data (VENDOR, ADMIN and the
 * SERVICE identity hold inventory:read); a customer has no business here.
 */
export function registerInventoryRoutes(
  server: FastifyInstance,
  { store }: InventoryRouteDeps
): void {
  server.get(
    '/api/v1/inventory',
    {
      config: { policy: { permission: 'inventory:read' } },
      schema: {
        tags: ['inventory'],
        description: 'Current stock levels for the products this service tracks (paginated).',
        querystring: InventoryQuery,
        response: {
          200: InventoryListOut,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: Static<typeof InventoryQuery> }>) => {
      const { limit, offset } = request.query
      const rows = await listInventory(store, { limit, offset })
      return { count: rows.length, items: rows }
    }
  )

  server.get(
    '/api/v1/inventory/:productId',
    {
      config: { policy: { permission: 'inventory:read' } },
      schema: {
        tags: ['inventory'],
        description: 'Current stock level for one product.',
        params: ProductParams,
        response: {
          200: InventoryRowOut,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Params: Static<typeof ProductParams> }>) => {
      const row = await getInventory(store, request.params.productId)
      // 404, not a zeroed row: this service does not own the catalogue, so
      // "no stock record" means "unknown to inventory", which is a different
      // fact from "in stock, zero units".
      if (!row) throw notFound('No inventory record for that product')
      return row
    }
  )

  server.get(
    '/api/v1/reservations',
    {
      config: { policy: { permission: 'inventory:read' } },
      schema: {
        tags: ['reservations'],
        description:
          'Stock reservations, newest first (paginated). Optionally filtered to one order. A ' +
          'row exists only for an order whose stock was actually reserved — an order that ' +
          'was short produced an inventory.insufficient event and no row.',
        querystring: ReservationsQuery,
        response: {
          200: ReservationListOut,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: Static<typeof ReservationsQuery> }>) => {
      const { orderId, limit, offset } = request.query
      const rows = await listReservations(store, orderId, { limit, offset })
      return { count: rows.length, items: rows }
    }
  )
}
