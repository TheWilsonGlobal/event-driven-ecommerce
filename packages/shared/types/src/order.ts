import type { OrderAddress } from './address'

export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

export type PaymentMethod = 'STRIPE' | 'PAYPAL' | 'MOCK'

export type PaymentStatus = 'PAID' | 'PENDING' | 'FAILED' | 'REFUNDED'

/**
 * A denormalized product snapshot as it appears on an order line item — the
 * price/title/sku *at the time of purchase*, not a live reference to the
 * current `Product`. Deliberately its own type rather than `Pick<Product, ...>`
 * plus `quantity`, since `unitPrice`/`totalPrice` here are the order's
 * historical record and must not silently track catalog price changes.
 */
export interface OrderItem {
  productId: string
  sku: string
  title: string
  unitPrice: number
  quantity: number
  totalPrice: number
  imageUrl?: string
}

/**
 * The order shape returned by ms-order's API and rendered by admin/client.
 */
export interface Order {
  id: string
  orderNumber: string
  customerId: string
  customerName: string
  customerEmail: string
  status: OrderStatus
  subtotal: number
  taxAmount: number
  shippingAmount: number
  discountAmount: number
  totalAmount: number
  currency: string
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  transactionId: string
  shippingAddress: OrderAddress
  items: OrderItem[]
  createdAt: string
  updatedAt: string
  receiptUrl?: string
}

/**
 * The request body for `POST /api/v1/orders`, shared by ms-order (which
 * validates/consumes it) and client (which should build its checkout request
 * against this type instead of an untyped object literal).
 *
 * NOTE: today every numeric field here — `items[].unitPrice`, `subtotal`,
 * `taxAmount`, `totalAmount`, etc. — is trusted verbatim from the caller with
 * no server-side recomputation against ms-product's authoritative prices.
 * Adopting this shared type does not fix that; it only stops the request
 * contract itself from drifting between client and ms-order.
 */
export interface CreateOrderBody {
  userId?: string
  /**
   * Whether the caller already captured payment before calling this endpoint.
   * Omitted (or `true`) produces a CONFIRMED order as before; `false` models
   * an order awaiting payment, created as PENDING.
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
  shippingAddress: OrderAddress
  paymentMethod: string
  subtotal: number
  taxAmount?: number
  shippingAmount?: number
  discountAmount?: number
  totalAmount: number
  currency?: string
}
