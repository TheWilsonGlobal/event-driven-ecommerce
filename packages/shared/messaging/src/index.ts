/**
 * @ecommerce/shared-messaging — the two messaging systems this repo uses.
 *
 *   bullmq/   WORK  — a task with ONE owner, a delay, an attempt counter and a
 *                     terminal failure state. Runs on Redis.
 *   kafka/    FACTS — a statement that something already happened, with MANY
 *                     independent readers each holding their own offset.
 *   describeError.ts  shared by both, which is why it stays at the root: it
 *                     unwraps Node's AggregateError, a problem neither backend
 *                     owns.
 *
 * Neither half replaces the other, and nothing in `kafka/` imports from
 * `bullmq/` or vice versa — the only shared module is describeError. A consumer
 * of a fact typically enqueues its own work in response, which is why one
 * package holds both rather than two packages holding one each.
 *
 * Everything is re-exported from this barrel. No consumer deep-imports a
 * subpath (verified at the time of the 2026-09-23 reorganisation), so these
 * directories can be rearranged without touching a single call site.
 */

export { describeError } from './describeError'
export { RedisUnavailableError, toRedisUnavailable } from './bullmq/errors'
export {
  JOB_STATES,
  isContractJobState,
  type JobState,
  type BackoffType,
  type QueueDefinition,
} from './bullmq/jobState'
export {
  createRedisConnectionRegistry,
  isConnectionUsable,
  type RedisConnectionRegistry,
  type RedisKeyValueSettings,
  type RedisRole,
} from './bullmq/redisConnection'
export { toRecentJobView, type RecentJobView } from './bullmq/jobView'
export {
  buildQueueData,
  type QueueSnapshotCounts,
  type QueueInfoView,
  type QueueDataView,
} from './bullmq/introspection'
export {
  jobStateCountsSchema,
  recentJobSchema,
  serviceUnavailableSchema,
  queuesResponseSchema,
  sendUnavailable,
} from './bullmq/schemas'

// ---------------------------------------------------------------------------
// Kafka event backbone
//
// The BullMQ exports above carry WORK: a task with one owner, a delay, an
// attempt counter and a terminal failure state. The Kafka exports below carry
// FACTS: statements that something already happened, with many independent
// readers each holding their own position in the log.
//
// Neither replaces the other. A consumer of a fact typically enqueues its own
// work in response — which is exactly why this package holds both halves.
// ---------------------------------------------------------------------------

export { createKafkaClient, loadKafkaSettings, type KafkaSettings } from './kafka/client'
export {
  makeEnvelope,
  parseEnvelope,
  type EventEnvelope,
  type MakeEnvelopeInput,
} from './kafka/envelope'
export {
  KafkaUnavailableError,
  toKafkaUnavailable,
  type KafkaUnavailableReason,
} from './kafka/errors'
export {
  TOPICS,
  ALL_TOPICS,
  EVENT_TYPES,
  TOPIC_DEFINITIONS,
  CONSUMER_GROUPS,
  getTopicDefinition,
  type TopicName,
  type EventType,
  type TopicDefinition,
  type ConsumerGroupId,
} from './kafka/topics'
export type {
  OrderLineItem,
  OrderCreatedPayload,
  OrderConfirmedPayload,
  OrderCancelledPayload,
  PaymentCapturedPayload,
  PaymentFailedPayload,
  PaymentRefundedPayload,
  InventoryReservedPayload,
  InventoryReleasedPayload,
  InventoryInsufficientPayload,
} from './kafka/events'
export { EventProducer, type PublishInput, type TopicCounters } from './kafka/producer'
export {
  EventConsumer,
  type EventHandler,
  type EventContext,
  type EventConsumerOptions,
  type ConsumerCounters,
} from './kafka/consumer'
export {
  buildEventData,
  type EventDataView,
  type TopicView,
  type ConsumerView,
} from './kafka/introspection'
export {
  checkKafkaHealth,
  withKafkaAdminDeadline,
  classifyKafkaState,
  resetKafkaHealthCache,
  type KafkaHealth,
} from './kafka/health'
export {
  topicViewSchema,
  consumerViewSchema,
  eventsResponseSchema,
  kafkaUnavailableSchema,
  sendKafkaUnavailable,
} from './kafka/schemas'
export { registerKafkaMetrics, type KafkaMetricsOptions } from './kafka/metrics'
