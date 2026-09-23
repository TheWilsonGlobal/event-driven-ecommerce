import type { FastifyReply } from 'fastify'
import type { KafkaUnavailableError } from './errors'

/**
 * JSON schema fragments and the 503 helper for GET /api/v1/events.
 *
 * Parallel to the BullMQ schemas.ts, and governed by the same rule: an
 * unreachable broker returns 503 with a machine-readable `reason`, never an
 * empty 200, because an empty 200 renders as "zero events" — indistinguishable
 * from a healthy but idle backbone.
 *
 * ⚠️ NULLABLE NUMBERS. `lag` and `partitions` are `['number', 'null']` and MUST
 * stay that way. Under a plain `{ type: 'number' }` Fastify's serializer
 * coerces null to 0, so "we could not measure the lag" would serialize as
 * "lag is zero" — the most reassuring possible rendering of an unknown. This is
 * the same trap recentJobSchema.failedReason documents for strings, where null
 * would coerce to "" and render as an empty-but-present error message.
 */

const nullableString = {
  type: ['string', 'null'],
} as const

export const topicViewSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    producer: { type: 'string', description: 'The service that publishes to this topic.' },
    partitionKey: {
      type: 'string',
      description:
        'The message key. All events sharing a key land on one partition and are ' +
        'therefore consumed in order.',
    },
    description: { type: 'string' },
    eventTypes: { type: 'array', items: { type: 'string' } },
    partitions: {
      type: ['number', 'null'],
      description:
        'Live partition count from the broker. null when it could not be measured — ' +
        'including the normal cold-start case where nothing has been published yet, ' +
        'so the topic does not exist on the broker. Never 0 as a fallback.',
    },
    published: {
      type: 'number',
      description:
        'Events published to this topic by THIS PROCESS since it started. ' +
        'Resets on restart; not a durable lifetime total.',
    },
    publishFailures: {
      type: 'number',
      description:
        'Publishes that failed since this process started. Non-zero means events ' +
        'were LOST — delivery is at-most-once, with no outbox. Process-lifetime.',
    },
    lastPublishedAt: { ...nullableString, format: 'date-time' },
    lastFailureAt: { ...nullableString, format: 'date-time' },
    lastFailureReason: nullableString,
  },
  required: [
    'name',
    'producer',
    'partitionKey',
    'description',
    'eventTypes',
    'partitions',
    'published',
    'publishFailures',
    'lastPublishedAt',
    'lastFailureAt',
    'lastFailureReason',
  ],
} as const

export const consumerViewSchema = {
  type: 'object',
  properties: {
    groupId: {
      type: 'string',
      description: 'One group per service, never shared — see CONSUMER_GROUPS in topics.ts.',
    },
    topics: { type: 'array', items: { type: 'string' } },
    state: {
      ...nullableString,
      description: "Kafka group state ('Stable', 'Empty', ...). null when not measurable.",
    },
    lag: {
      type: ['number', 'null'],
      description:
        'Total uncommitted offsets across partitions. null means the lag could NOT ' +
        'be measured — never conflate that with 0, which means fully caught up.',
    },
    running: { type: 'boolean' },
    consumed: {
      type: 'number',
      description: 'Handler invocations that succeeded. Process-lifetime.',
    },
    failed: {
      type: 'number',
      description:
        'Handler invocations that threw. The offset still advanced (a failing handler ' +
        'must not wedge the partition), so these events were NOT retried.',
    },
    skipped: {
      type: 'number',
      description:
        'Messages with no registered handler, or that could not be parsed. Normal: a ' +
        'consumer subscribes to whole topics and sees event types it ignores.',
    },
    lastConsumedAt: { ...nullableString, format: 'date-time' },
    lastFailureAt: { ...nullableString, format: 'date-time' },
    lastFailureReason: nullableString,
  },
  required: [
    'groupId',
    'topics',
    'state',
    'lag',
    'running',
    'consumed',
    'failed',
    'skipped',
    'lastConsumedAt',
    'lastFailureAt',
    'lastFailureReason',
  ],
} as const

export const eventsResponseSchema = {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      description:
        'False when KAFKA_ENABLED is not "true" — the repo default. A healthy ' +
        'configured state, returned as 200, NOT as an error.',
    },
    connected: { type: 'boolean' },
    brokers: { type: 'array', items: { type: 'string' } },
    topics: { type: 'array', items: topicViewSchema },
    consumers: { type: 'array', items: consumerViewSchema },
    summary: {
      type: 'object',
      properties: {
        topicCount: { type: 'number' },
        published: { type: 'number' },
        publishFailures: { type: 'number' },
        consumed: { type: 'number' },
        consumerFailures: { type: 'number' },
      },
      required: ['topicCount', 'published', 'publishFailures', 'consumed', 'consumerFailures'],
    },
    countersAreProcessLifetime: {
      type: 'boolean',
      description:
        'True when published/consumed counters reset on restart, so the UI can label ' +
        'them rather than implying a durable total.',
    },
  },
  required: [
    'enabled',
    'connected',
    'brokers',
    'topics',
    'consumers',
    'summary',
    'countersAreProcessLifetime',
  ],
} as const

export const kafkaUnavailableSchema = {
  type: 'object',
  description: 'Kafka is enabled but unreachable. Never returned as an empty 200.',
  properties: {
    error: { type: 'string' },
    reason: {
      type: 'string',
      description:
        'Machine-readable cause: kafka_connection_refused | kafka_timeout | ' +
        'kafka_broker_unavailable | kafka_dns_failure | kafka_auth_failure | ' +
        'kafka_error | kafka_producer_disconnected',
    },
    message: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
  },
  required: ['error', 'reason', 'message', 'timestamp'],
} as const

export function sendKafkaUnavailable(
  reply: FastifyReply,
  err: KafkaUnavailableError
): FastifyReply {
  return reply.status(503).send({
    error: 'Service Unavailable',
    reason: err.reason,
    message: err.message,
    timestamp: new Date().toISOString(),
  })
}
