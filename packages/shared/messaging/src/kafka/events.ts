/**
 * Payload shapes for every event on the backbone.
 *
 * See `envelope.ts` for the identifiers-not-snapshots rule these follow. The
 * values carried here are either (a) identifiers a consumer needs to re-read
 * current state, or (b) genuinely immutable historical fact — the amount that
 * was charged, the quantity that was ordered. Never a copy of something the
 * producer can still change.
 */

/** Line item as it stood AT ORDER TIME. Immutable history, safe to carry. */
export interface OrderLineItem {
  productId: string
  sku: string
  quantity: number
  unitPrice: number
}

/** order.created — an order row exists and is committed. */
export interface OrderCreatedPayload {
  orderId: string
  orderNumber: string
  userId: string
  customerEmail: string
  /** 'PENDING' (awaiting payment) or 'CONFIRMED' (payment pre-captured). */
  status: string
  totalAmount: number
  currency: string
  items: OrderLineItem[]
}

/** order.confirmed — payment settled, the order is going to be fulfilled. */
export interface OrderConfirmedPayload {
  orderId: string
  orderNumber: string
  customerEmail: string
  customerName: string
  totalAmount: number
  currency: string
}

/** order.cancelled — terminal. Whatever was reserved for it must be released. */
export interface OrderCancelledPayload {
  orderId: string
  orderNumber: string
  /** e.g. 'expired-unpaid', 'payment-failed', 'operator-cancelled'. */
  reason: string
  items: OrderLineItem[]
}

export interface PaymentCapturedPayload {
  orderId: string
  orderNumber: string
  paymentId: string
  provider: string
  amount: number
  currency: string
}

export interface PaymentFailedPayload {
  orderId: string
  orderNumber: string
  paymentId: string
  provider: string
  amount: number
  currency: string
  reason: string
  /** Which capture attempt this was. Lets a consumer distinguish first from final. */
  attempt: number
}

export interface PaymentRefundedPayload {
  orderId: string
  orderNumber: string
  paymentId: string
  amount: number
  currency: string
  reason: string
}

export interface InventoryReservedPayload {
  orderId: string
  orderNumber: string
  reservations: { productId: string; sku: string; quantity: number }[]
}

export interface InventoryReleasedPayload {
  orderId: string
  orderNumber: string
  reason: string
  releases: { productId: string; sku: string; quantity: number }[]
}

/**
 * inventory.insufficient — the reservation could NOT be made in full.
 *
 * Carries what was short so the order side can decide what to do without a
 * round-trip. Nothing consumes this to auto-cancel today; it is published so
 * the fact is on the log and visible in analytics.
 */
export interface InventoryInsufficientPayload {
  orderId: string
  orderNumber: string
  shortfalls: { productId: string; sku: string; requested: number; available: number }[]
}
