import type { PrismaClient } from '../node_modules/.prisma-ms-order/client'
import { SEED_ORDERS } from '@ecommerce/shared-database'

// Maps our external "payment status" vocabulary (used by SEED_ORDERS and the
// OrderRecord API shape) to the internal Payment.status column vocabulary.
// This mapping MUST stay identical to the inverse mapping used when reading
// orders back out in src/index.ts (toOrderRecord), so paymentStatus round-trips.
export function paymentStatusToPaymentRowStatus(status: string): string {
  switch (status) {
    case 'PAID':
      return 'COMPLETED'
    case 'PENDING':
      return 'PENDING'
    case 'FAILED':
      return 'FAILED'
    case 'REFUNDED':
      return 'REFUNDED'
    default:
      return 'PENDING'
  }
}

export function paymentMethodToProvider(paymentMethod: string): string {
  switch (paymentMethod) {
    case 'STRIPE':
      return 'stripe'
    case 'PAYPAL':
      return 'paypal'
    case 'MOCK':
    default:
      return 'mock'
  }
}

/**
 * Inserts SEED_ORDERS (from @ecommerce/shared-database) into the ms-order
 * database, but only if the orders table is currently empty. Used both by
 * the standalone `prisma/seed.ts` script (via `prisma db seed`) and by
 * bootstrap() in src/index.ts on server startup, so the two never drift.
 *
 * Returns the number of orders inserted (0 if the table already had rows).
 */
export async function seedOrdersIfEmpty(prisma: PrismaClient): Promise<number> {
  const existingCount = await prisma.order.count()
  if (existingCount > 0) {
    return 0
  }

  for (const order of SEED_ORDERS) {
    await prisma.order.create({
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        status: order.status,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        shippingAmount: order.shippingAmount,
        discountAmount: order.discountAmount,
        totalAmount: order.totalAmount,
        currency: order.currency,
        shippingAddress: JSON.stringify(order.shippingAddress),
        billingAddress: JSON.stringify(order.shippingAddress),
        createdAt: new Date(order.createdAt),
        updatedAt: new Date(order.updatedAt),
        items: {
          create: order.items.map((item) => ({
            productId: item.productId,
            productSku: item.sku,
            productTitle: item.title,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
          })),
        },
        payments: {
          create: [
            {
              provider: paymentMethodToProvider(order.paymentMethod),
              transactionId: order.transactionId,
              paymentMethod: order.paymentMethod,
              amount: order.totalAmount,
              currency: order.currency,
              status: paymentStatusToPaymentRowStatus(order.paymentStatus),
              createdAt: new Date(order.createdAt),
              updatedAt: new Date(order.updatedAt),
            },
          ],
        },
      },
    })
  }

  return SEED_ORDERS.length
}
