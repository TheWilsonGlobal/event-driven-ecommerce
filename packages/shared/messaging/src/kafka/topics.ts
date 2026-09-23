/**
 * Single source of truth for the event backbone's topics and event types.
 *
 * Mirrors the role `definitions.ts` plays for each service's BullMQ topology:
 * these consts are BOTH what producers publish to and what `GET /api/v1/events`
 * reports, so the admin panel can never drift from what is actually wired.
 *
 * ── Naming ──────────────────────────────────────────────────────────────────
 * `ecommerce.<aggregate>.v<n>`. The version lives in the TOPIC NAME, not just
 * the envelope, so a breaking payload change becomes a new topic that
 * consumers can read alongside the old one during a migration. Bumping a
 * version in-place would require every consumer to deploy in lockstep with the
 * producer, which is the coordination problem an event log exists to avoid.
 *
 * ── Partition keys ──────────────────────────────────────────────────────────
 * Kafka guarantees ordering only WITHIN a partition, and the key is what picks
 * the partition. Keying order events on `orderId` is therefore load-bearing,
 * not a detail: without it `order.cancelled` can be consumed before the
 * `order.created` it cancels, and ms-inventory would release a reservation it
 * has not yet made. Each topic's key is documented on TOPIC_DEFINITIONS below.
 */

export const TOPICS = {
  orders: 'ecommerce.orders.v1',
  payments: 'ecommerce.payments.v1',
  inventory: 'ecommerce.inventory.v1',
} as const

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS]

export const ALL_TOPICS: readonly TopicName[] = Object.values(TOPICS)

/**
 * Every event type carried on the backbone.
 *
 * `<aggregate>.<past-tense verb>` — an event is a statement that something
 * ALREADY happened and is already committed. Never name one as an instruction
 * ("reserve.inventory"); that is a command, and commands belong in BullMQ where
 * they get an owner, a retry count and a terminal failure state.
 */
export const EVENT_TYPES = {
  orderCreated: 'order.created',
  orderConfirmed: 'order.confirmed',
  orderCancelled: 'order.cancelled',

  paymentCaptured: 'payment.captured',
  paymentFailed: 'payment.failed',
  paymentRefunded: 'payment.refunded',

  inventoryReserved: 'inventory.reserved',
  inventoryReleased: 'inventory.released',
  inventoryInsufficient: 'inventory.insufficient',
} as const

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES]

export interface TopicDefinition {
  name: TopicName
  /** Which service publishes to this topic. Consumers are open-ended by design. */
  producer: string
  /** What the partition key is, and therefore what ordering is guaranteed. */
  partitionKey: string
  description: string
  eventTypes: readonly EventType[]
}

export const TOPIC_DEFINITIONS: readonly TopicDefinition[] = [
  {
    name: TOPICS.orders,
    producer: 'ms-order',
    partitionKey: 'orderId',
    description:
      'Order lifecycle facts. Keyed by orderId so every event for one order ' +
      'lands on one partition and is consumed in causal order.',
    eventTypes: [EVENT_TYPES.orderCreated, EVENT_TYPES.orderConfirmed, EVENT_TYPES.orderCancelled],
  },
  {
    name: TOPICS.payments,
    producer: 'ms-order',
    partitionKey: 'orderId',
    description:
      'Payment outcome facts. Keyed by orderId (NOT paymentId) so payment ' +
      'events share a partition with the order events they relate to.',
    eventTypes: [
      EVENT_TYPES.paymentCaptured,
      EVENT_TYPES.paymentFailed,
      EVENT_TYPES.paymentRefunded,
    ],
  },
  {
    name: TOPICS.inventory,
    producer: 'ms-inventory',
    partitionKey: 'productId',
    description:
      'Stock reservation facts. Keyed by productId — the contended resource ' +
      'here is the product, so per-product ordering is what matters.',
    eventTypes: [
      EVENT_TYPES.inventoryReserved,
      EVENT_TYPES.inventoryReleased,
      EVENT_TYPES.inventoryInsufficient,
    ],
  },
] as const

/**
 * Consumer group ids — one per SERVICE, never shared.
 *
 * Kafka splits a topic's partitions between the members of a group. Two
 * different services sharing a group id would therefore each receive roughly
 * HALF of the events and neither would see the rest — presenting as random,
 * intermittent data loss that is very hard to diagnose from the outside. The
 * sibling `message-queue` sample in this tree has the non-structural version of
 * this bug (backend and workers competing on the same BullMQ queues), so it is
 * worth being explicit rather than relying on convention.
 *
 * Each service gets its OWN copy of every event by virtue of having its own
 * group. That is what makes adding a consumer (ms-analytics) a zero-risk change
 * to the existing ones.
 */
export const CONSUMER_GROUPS = {
  inventory: 'ms-inventory-group',
  analytics: 'ms-analytics-group',
  payment: 'ms-payment-group',
} as const

export type ConsumerGroupId = (typeof CONSUMER_GROUPS)[keyof typeof CONSUMER_GROUPS]

export function getTopicDefinition(name: TopicName): TopicDefinition {
  const def = TOPIC_DEFINITIONS.find((d) => d.name === name)
  if (!def) {
    throw new Error(`Unknown topic definition: ${name}`)
  }
  return def
}
