/**
 * Row shapes for ms-inventory's Postgres tables (schema ms_inventory, created by
 * migrations/001_init.sql).
 *
 * These are the API/domain shapes, camelCase with ISO-8601 strings for
 * timestamps; src/db/store.ts maps them to and from the snake_case columns.
 * The `*Doc` names are kept from the NeDB era so handlers, routes and the
 * published response schemas did not have to change.
 */

export interface InventoryDoc {
  productId: string
  sku: string
  /** Free to be reserved. Never negative — a CHECK constraint enforces it. */
  available: number
  /** Held for an order that has not shipped or been cancelled yet. */
  reserved: number
  updatedAt: string
}

export interface ReservationItem {
  productId: string
  sku: string
  quantity: number
}

export type ReservationStatus = 'RESERVED' | 'RELEASED'

export interface ReservationDoc {
  orderId: string
  orderNumber: string
  /**
   * The eventId of the order.created that caused this reservation. Kept on the
   * row (not only in processed_events) so the reconciliation job's
   * deterministic id can be traced back to the event that scheduled it.
   */
  eventId: string
  items: ReservationItem[]
  status: ReservationStatus
  createdAt: string
  /** null while RESERVED. Set when the stock goes back. */
  releasedAt: string | null
}

/**
 * The idempotency ledger. One row per eventId this service has finished
 * handling — see handlers.ts for why a second, state-based guard exists too.
 */
export interface ProcessedEventDoc {
  eventId: string
  eventType: string
  processedAt: string
  /** What the handler decided. Useful when a duplicate shows up in the log. */
  outcome: string
}
