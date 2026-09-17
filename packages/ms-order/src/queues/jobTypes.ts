/**
 * Job payload shapes for ms-order's four queues.
 *
 * Payloads intentionally carry identifiers rather than snapshots of mutable
 * state. Workers re-read the current row from Prisma before acting — a job
 * that was enqueued 15 minutes ago must not act on a 15-minute-old view of
 * the order.
 */

/** order-expiration */
export interface ExpireOrderJob {
  orderId: string
  orderNumber: string
  /** When the order was created; informational/logging only. */
  enqueuedAt: string
}

/** payment-retry */
export interface RetryCaptureJob {
  orderId: string
  orderNumber: string
  paymentId: string
  provider: string
  amount: number
  currency: string
}

/** notification-dispatch */
export interface SendConfirmationJob {
  orderId: string
  orderNumber: string
  customerEmail: string
  customerName: string
}

export interface SendReceiptJob {
  orderId: string
  orderNumber: string
  customerEmail: string
  totalAmount: number
  currency: string
}

export type NotificationJob = SendConfirmationJob | SendReceiptJob

/** saga-compensation */
export interface ReleaseInventoryJob {
  orderId: string
  orderNumber: string
  /** Which saga step failed, so the compensation is traceable. */
  failedStep: string
  reason: string
  items: { productId: string; sku: string; quantity: number }[]
}

export interface RefundPaymentJob {
  orderId: string
  orderNumber: string
  paymentId: string
  failedStep: string
  reason: string
  amount: number
  currency: string
}

export type SagaCompensationJob = ReleaseInventoryJob | RefundPaymentJob

export const JOB_NAMES = {
  expireOrder: 'expire-order',
  retryCapture: 'retry-capture',
  sendConfirmation: 'send-confirmation',
  sendReceipt: 'send-receipt',
  releaseInventory: 'release-inventory',
  refundPayment: 'refund-payment',
} as const
