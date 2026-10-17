import {
  EVENT_TYPES,
  TOPICS,
  buildOutboxEvent,
  type EventType,
  type OrderCancelledPayload,
  type OrderConfirmedPayload,
  type OrderCreatedPayload,
  type PaymentCapturedPayload,
  type PaymentFailedPayload,
  type PaymentRefundedPayload,
  type TopicName,
} from '@ecommerce/shared-messaging'
import type { Prisma } from '../../node_modules/.prisma-ms-order/client'

/**
 * Transactional-outbox staging for ms-order's events.
 *
 * ── Why these are "stage", not "publish" ────────────────────────────────────
 * The old helpers published to Kafka AFTER the database commit and swallowed
 * failures, so a crash between the two lost the event (at-most-once, no
 * outbox). Each function here instead INSERTS the event into `outbox_events`
 * through the SAME Prisma transaction client as the state change it describes:
 * both commit or neither does. OutboxRelay (outbox/relay.ts) drains the table
 * to Kafka afterwards, at-least-once, re-sending the stored envelope — so the
 * eventId is minted once, here, and is identical on every retry.
 *
 * Pass the `tx` from `prisma.$transaction(async (tx) => ...)`. Passing the
 * bare `prisma` client still works but writes the row in its own transaction,
 * which is only correct when there is no other write to be atomic with.
 *
 * ── The partition key is not a detail ───────────────────────────────────────
 * Order and payment events are both keyed on `orderId`, never paymentId. That
 * puts every event about one order on one partition, which is the only thing
 * that guarantees a consumer sees order.created before order.cancelled. The
 * relay preserves insert order per key (it never has two events of one key in
 * flight), so the guarantee survives the outbox.
 */

/** A Prisma transaction client — or the root client — exposing the outbox table. */
export type OutboxTx = Pick<Prisma.TransactionClient, 'outboxEvent'>

async function stage<T>(
  tx: OutboxTx,
  topic: TopicName,
  eventType: EventType,
  key: string,
  payload: T,
  correlationId?: string
): Promise<string> {
  const row = buildOutboxEvent({
    producer: 'ms-order',
    topic,
    eventType,
    key,
    payload,
    correlationId,
  })
  await tx.outboxEvent.create({
    data: {
      eventId: row.eventId,
      topic: row.topic,
      partitionKey: row.partitionKey,
      eventType: row.eventType,
      envelope: row.envelope as unknown as Prisma.InputJsonValue,
      maxAttempts: row.maxAttempts,
    },
  })
  return row.eventId
}

export const stageOrderCreated = (tx: OutboxTx, p: OrderCreatedPayload, c?: string) =>
  stage(tx, TOPICS.orders, EVENT_TYPES.orderCreated, p.orderId, p, c)

export const stageOrderConfirmed = (tx: OutboxTx, p: OrderConfirmedPayload, c?: string) =>
  stage(tx, TOPICS.orders, EVENT_TYPES.orderConfirmed, p.orderId, p, c)

export const stageOrderCancelled = (tx: OutboxTx, p: OrderCancelledPayload, c?: string) =>
  stage(tx, TOPICS.orders, EVENT_TYPES.orderCancelled, p.orderId, p, c)

export const stagePaymentCaptured = (tx: OutboxTx, p: PaymentCapturedPayload, c?: string) =>
  stage(tx, TOPICS.payments, EVENT_TYPES.paymentCaptured, p.orderId, p, c)

export const stagePaymentFailed = (tx: OutboxTx, p: PaymentFailedPayload, c?: string) =>
  stage(tx, TOPICS.payments, EVENT_TYPES.paymentFailed, p.orderId, p, c)

export const stagePaymentRefunded = (tx: OutboxTx, p: PaymentRefundedPayload, c?: string) =>
  stage(tx, TOPICS.payments, EVENT_TYPES.paymentRefunded, p.orderId, p, c)
