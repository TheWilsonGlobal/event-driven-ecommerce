import {
  EventProducer,
  createKafkaClient,
  loadKafkaSettings,
  type KafkaSettings,
} from '@ecommerce/shared-messaging'
import type { Kafka } from 'kafkajs'

/**
 * ms-inventory's single EventProducer, plus the admin client used only for
 * introspection (partition counts and consumer lag on GET /api/v1/events).
 *
 * Same construction contract as ms-order's producer: never throws, opens
 * nothing when disabled, and a broker outage can never fail work that is
 * already committed to NeDB. KAFKA_ENABLED defaults to false, so a developer
 * who has not started Redpanda gets a service that boots and serves the
 * inventory API with the event endpoint honestly reporting `enabled: false`.
 *
 * Note this service is BOTH a producer and a consumer. The two hold separate
 * connections by design — a stalled consume loop must not be able to block a
 * publish, and vice versa.
 */

const LOG_PREFIX = '[Inventory Service]'

export const kafkaSettings: KafkaSettings = loadKafkaSettings('ms-inventory')

export const eventProducer = new EventProducer('ms-inventory', LOG_PREFIX, kafkaSettings)

/**
 * Admin-only client for introspection. Separate from the producer's own
 * connection so a long metadata/lag walk never sits in front of a publish.
 *
 * undefined when Kafka is disabled, so nothing is constructed.
 */
export const kafkaAdminClient: Kafka | undefined = kafkaSettings.enabled
  ? createKafkaClient(kafkaSettings, LOG_PREFIX)
  : undefined

export { LOG_PREFIX }
