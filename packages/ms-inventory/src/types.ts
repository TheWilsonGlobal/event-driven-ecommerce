/**
 * NeDB document shapes for ms-inventory.
 *
 * `id`/`_id` are optional on every doc because EmbeddedDocumentStore generates
 * them on insert and mirrors one into the other (see document.ts) — the same
 * reason ms-product's ProductDoc carries both.
 */

export interface InventoryDoc {
  id?: string
  _id?: string
  productId: string
  sku: string
  /** Free to be reserved. Never negative — the reserve path is all-or-nothing. */
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
  id?: string
  _id?: string
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
  id?: string
  _id?: string
  eventId: string
  eventType: string
  processedAt: string
  /** What the handler decided. Useful when a duplicate shows up in the log. */
  outcome: string
}
