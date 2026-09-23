import type { Kafka } from 'kafkajs'
import {
  CONSUMER_GROUPS,
  EVENT_TYPES,
  EventConsumer,
  EventProducer,
  TOPICS,
  createKafkaClient,
  loadKafkaSettings,
  type KafkaSettings,
  type TopicName,
} from '@ecommerce/shared-messaging'
import type { AnalyticsStore } from '../aggregates/store'
import {
  handleInventoryInsufficient,
  handleInventoryReleased,
  handleInventoryReserved,
  handleOrderCancelled,
  handleOrderConfirmed,
  handleOrderCreated,
  handlePaymentCaptured,
  handlePaymentFailed,
  handlePaymentRefunded,
  type HandlerDeps,
} from './handlers'

/**
 * ms-analytics' Kafka wiring: one consumer, one (never-used) producer, one
 * admin client.
 *
 * Constructed exactly the way ms-order constructs its producer — nothing
 * connects, nothing throws, and with KAFKA_ENABLED unset (the repo default) no
 * client object is built at all.
 */

const LOG_PREFIX = '[Analytics Service]'

export const kafkaSettings: KafkaSettings = loadKafkaSettings('ms-analytics')

/**
 * This service publishes NOTHING. The producer exists only so that
 * `buildEventData` — which takes an EventProducer as its source of broker
 * settings, connection state and per-topic counters — can be called at all,
 * giving GET /api/v1/events the identical response shape here that it has in
 * ms-order. An admin panel that had to special-case consumer-only services
 * would be the alternative.
 *
 * Constructing it is free: the EventProducer connects lazily on first publish
 * and there is never a first publish, so no socket is ever opened on its
 * behalf. Its per-topic counters therefore read a truthful `published: 0`
 * forever — which is exactly the right statement about a pure consumer, and is
 * measured rather than hardcoded.
 */
export const eventProducer = new EventProducer('ms-analytics', LOG_PREFIX, kafkaSettings)

/**
 * Admin-only client, used for partition counts and consumer lag on
 * GET /api/v1/events and for the cached /health probe. Separate from the
 * consumer's own connection so a slow metadata walk never sits in front of the
 * consume loop. undefined when Kafka is disabled, so nothing is constructed.
 */
export const kafkaAdminClient: Kafka | undefined = kafkaSettings.enabled
  ? createKafkaClient(kafkaSettings, LOG_PREFIX)
  : undefined

const SUBSCRIBED_TOPICS: TopicName[] = [TOPICS.orders, TOPICS.payments, TOPICS.inventory]

/**
 * Builds the consumer and registers every handler.
 *
 * ── fromBeginning: true, and what that does and does not mean ───────────────
 * This service is an AGGREGATE OVER ALL HISTORY, not a reactor to live
 * traffic. A revenue total that begins at whatever happened to be on the
 * broker when the process first started is not a revenue total, it is an
 * arbitrary suffix of one. So on its very first run the group reads each topic
 * from offset 0 and builds the view from everything that ever happened.
 *
 * That is also why resetting this group's offsets is a legitimate recovery
 * action: wipe the analytics collections, reset the group, and the entire view
 * rebuilds from the log. ms-inventory deliberately sets this FALSE for the
 * mirror-image reason — replaying months of old order.created events would
 * reserve stock for orders shipped long ago.
 *
 * ⚠️ `fromBeginning` applies ONLY on a group's FIRST run, when it has no
 * committed offsets. Once this group has committed anything the flag is inert:
 * a restart resumes from the committed offset regardless of its value. It is
 * not a replay switch. Replaying requires deleting the group's offsets
 * (`rpk group delete ms-analytics-group`), and the aggregates must be cleared
 * in the same operation or the replay double-counts everything — the
 * idempotency ledger would otherwise reject the whole replay as duplicates,
 * which is a correct outcome but not the one someone resetting offsets wants.
 */
export function createAnalyticsConsumer(store: AnalyticsStore): EventConsumer {
  const deps: HandlerDeps = {
    store,
    // eslint-disable-next-line no-console
    log: (message: string) => console.log(`${LOG_PREFIX} ${message}`),
  }

  const consumer = new EventConsumer(
    {
      // One group per SERVICE, never shared — sharing would split the
      // partitions between services and each would see only part of the log.
      groupId: CONSUMER_GROUPS.analytics,
      topics: SUBSCRIBED_TOPICS,
      fromBeginning: true,
      logPrefix: LOG_PREFIX,
      clientId: 'ms-analytics',
    },
    kafkaSettings
  )

  consumer
    .on(EVENT_TYPES.orderCreated, (envelope, context) =>
      handleOrderCreated(deps, envelope, context)
    )
    .on(EVENT_TYPES.orderConfirmed, (envelope, context) =>
      handleOrderConfirmed(deps, envelope, context)
    )
    .on(EVENT_TYPES.orderCancelled, (envelope, context) =>
      handleOrderCancelled(deps, envelope, context)
    )
    .on(EVENT_TYPES.paymentCaptured, (envelope, context) =>
      handlePaymentCaptured(deps, envelope, context)
    )
    .on(EVENT_TYPES.paymentFailed, (envelope, context) =>
      handlePaymentFailed(deps, envelope, context)
    )
    .on(EVENT_TYPES.paymentRefunded, (envelope, context) =>
      handlePaymentRefunded(deps, envelope, context)
    )
    .on(EVENT_TYPES.inventoryReserved, (envelope, context) =>
      handleInventoryReserved(deps, envelope, context)
    )
    .on(EVENT_TYPES.inventoryReleased, (envelope, context) =>
      handleInventoryReleased(deps, envelope, context)
    )
    .on(EVENT_TYPES.inventoryInsufficient, (envelope, context) =>
      handleInventoryInsufficient(deps, envelope, context)
    )

  return consumer
}
