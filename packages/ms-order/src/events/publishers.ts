import {
  EVENT_TYPES,
  TOPICS,
  type OrderCancelledPayload,
  type OrderConfirmedPayload,
  type OrderCreatedPayload,
  type PaymentCapturedPayload,
  type PaymentFailedPayload,
  type PaymentRefundedPayload,
} from '@ecommerce/shared-messaging'
import { eventProducer } from './producer'

/**
 * Typed publish helpers for ms-order's events.
 *
 * Every one of these uses `tryPublish`, so a broker outage is logged, counted
 * and swallowed — it can never retroactively fail an order already committed
 * to the database. This is the same contract QueueManager.tryEnqueue states
 * for BullMQ, and it carries the same known consequence: a crash between the
 * commit and the publish loses the event (at-most-once, no outbox). The lost
 * publish shows up in `publishFailures` on GET /api/v1/events.
 *
 * ── The partition key is not a detail ───────────────────────────────────────
 * Order and payment events are both keyed on `orderId`, never paymentId. That
 * puts every event about one order on one partition, which is the only thing
 * that guarantees a consumer sees order.created before order.cancelled. Keying
 * payments separately would let a cancellation overtake the creation it
 * cancels, and ms-inventory would release a reservation it had not yet made.
 */

export async function publishOrderCreated(
  payload: OrderCreatedPayload,
  correlationId?: string
): Promise<string | null> {
  const envelope = await eventProducer.tryPublish({
    topic: TOPICS.orders,
    eventType: EVENT_TYPES.orderCreated,
    key: payload.orderId,
    payload,
    correlationId,
  })
  return envelope?.eventId ?? null
}

export async function publishOrderConfirmed(
  payload: OrderConfirmedPayload,
  correlationId?: string
): Promise<string | null> {
  const envelope = await eventProducer.tryPublish({
    topic: TOPICS.orders,
    eventType: EVENT_TYPES.orderConfirmed,
    key: payload.orderId,
    payload,
    correlationId,
  })
  return envelope?.eventId ?? null
}

export async function publishOrderCancelled(
  payload: OrderCancelledPayload,
  correlationId?: string
): Promise<string | null> {
  const envelope = await eventProducer.tryPublish({
    topic: TOPICS.orders,
    eventType: EVENT_TYPES.orderCancelled,
    key: payload.orderId,
    payload,
    correlationId,
  })
  return envelope?.eventId ?? null
}

export async function publishPaymentCaptured(
  payload: PaymentCapturedPayload,
  correlationId?: string
): Promise<string | null> {
  const envelope = await eventProducer.tryPublish({
    topic: TOPICS.payments,
    // Keyed on orderId, NOT paymentId — see the note above.
    eventType: EVENT_TYPES.paymentCaptured,
    key: payload.orderId,
    payload,
    correlationId,
  })
  return envelope?.eventId ?? null
}

export async function publishPaymentFailed(
  payload: PaymentFailedPayload,
  correlationId?: string
): Promise<string | null> {
  const envelope = await eventProducer.tryPublish({
    topic: TOPICS.payments,
    eventType: EVENT_TYPES.paymentFailed,
    key: payload.orderId,
    payload,
    correlationId,
  })
  return envelope?.eventId ?? null
}

export async function publishPaymentRefunded(
  payload: PaymentRefundedPayload,
  correlationId?: string
): Promise<string | null> {
  const envelope = await eventProducer.tryPublish({
    topic: TOPICS.payments,
    eventType: EVENT_TYPES.paymentRefunded,
    key: payload.orderId,
    payload,
    correlationId,
  })
  return envelope?.eventId ?? null
}
