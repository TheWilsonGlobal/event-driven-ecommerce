import { Prisma, PrismaClient } from '../node_modules/.prisma-ms-order/client'
import {
  ORDER_STATUSES,
  type Order,
  type OrderAddress,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@ecommerce/shared-types'

export { ORDER_STATUSES }

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { items: true; payments: true }
}>

// Inverse of paymentStatusToPaymentRowStatus (see src/seedOrders.ts) — must be
// kept consistent with that mapping so paymentStatus round-trips through the API.
export function paymentRowStatusToPaymentStatus(status: string): PaymentStatus {
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

export function toOrderRecord(order: OrderWithRelations): Order {
  const latestPayment = [...order.payments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0]

  const shippingAddress = JSON.parse(order.shippingAddress) as OrderAddress

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.userId,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    // order.status/payment.paymentMethod are untyped Prisma String columns —
    // this mapping is the trusted boundary where they're asserted into the
    // OrderStatus/PaymentMethod contract the rest of the app relies on.
    status: order.status as OrderStatus,
    subtotal: Number(order.subtotal),
    taxAmount: Number(order.taxAmount),
    shippingAmount: Number(order.shippingAmount),
    discountAmount: Number(order.discountAmount),
    totalAmount: Number(order.totalAmount),
    currency: order.currency,
    paymentMethod: latestPayment ? (latestPayment.paymentMethod as PaymentMethod) : 'MOCK',
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

export type { CreateOrderBody } from '@ecommerce/shared-types'

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
