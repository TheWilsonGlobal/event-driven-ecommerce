import { Prisma, PrismaClient } from '../node_modules/.prisma-ms-order/client'

export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { items: true; payments: true }
}>

// Inverse of paymentStatusToPaymentRowStatus (see src/seedOrders.ts) — must be
// kept consistent with that mapping so paymentStatus round-trips through the API.
export function paymentRowStatusToPaymentStatus(
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

export function toOrderRecord(order: OrderWithRelations) {
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

export interface CreateOrderBody {
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

export async function generateUniqueOrderNumber(prisma: PrismaClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `ORD-${Math.floor(100000 + Math.random() * 900000)}`
    const existing = await prisma.order.findUnique({ where: { orderNumber: candidate } })
    if (!existing) {
      return candidate
    }
  }
  throw new Error('Failed to generate a unique order number after 5 attempts')
}
