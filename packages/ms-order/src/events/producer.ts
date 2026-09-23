import {
  EventProducer,
  createKafkaClient,
  loadKafkaSettings,
  type KafkaSettings,
} from '@ecommerce/shared-messaging'
import type { Kafka } from 'kafkajs'

/**
 * ms-order's single EventProducer, plus the admin client used only for
 * introspection (partition counts and consumer lag on GET /api/v1/events).
 *
 * Constructed exactly like QueueManager: never throws, opens nothing when
 * disabled, and a broker outage can never fail a request. KAFKA_ENABLED
 * defaults to false, so a developer who has not started Redpanda gets a
 * service that boots and works with the event endpoint honestly reporting
 * `enabled: false`.
 */

const LOG_PREFIX = '[Order Service]'

export const kafkaSettings: KafkaSettings = loadKafkaSettings('ms-order')

export const eventProducer = new EventProducer('ms-order', LOG_PREFIX, kafkaSettings)

/**
 * Admin-only client for introspection. Separate from the producer's own
 * connection so a long metadata/lag walk never sits in front of a publish —
 * the same reasoning QueueManager gives for its dedicated SCAN connection.
 *
 * undefined when Kafka is disabled, so nothing is constructed.
 */
export const kafkaAdminClient: Kafka | undefined = kafkaSettings.enabled
  ? createKafkaClient(kafkaSettings, LOG_PREFIX)
  : undefined
