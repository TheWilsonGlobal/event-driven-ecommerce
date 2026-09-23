import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  buildEventData,
  eventsResponseSchema,
  kafkaUnavailableSchema,
  sendKafkaUnavailable,
  withKafkaAdminDeadline,
  KafkaUnavailableError,
} from '@ecommerce/shared-messaging'
import { eventProducer, kafkaAdminClient } from './producer'

/**
 * Registers `GET /api/v1/events` — the event-backbone counterpart to
 * `GET /api/v1/queues`.
 *
 * Three OUTCOMES, deliberately distinct, because collapsing any two of them
 * would hide a real operational state:
 *
 *   200 + enabled:false  Kafka is switched off (KAFKA_ENABLED != 'true'). The
 *                        repo default and a perfectly healthy configuration.
 *   200 + enabled:true   Enabled and serviceable. Live counters and lag.
 *   503                  Enabled but the broker is unreachable, with a
 *                        machine-readable `reason`.
 *
 * Never an empty 200 for the third case: zeros are indistinguishable from a
 * healthy-but-idle backbone, which is the exact defect the queue endpoints
 * were built to avoid.
 */
export function registerEventRoutes(server: FastifyInstance): void {
  server.get(
    '/api/v1/events',
    {
      schema: {
        tags: ['events'],
        description:
          'Kafka event-backbone introspection: topics published to by this service, ' +
          'per-topic counters, and consumer-group state/lag. Returns 200 with ' +
          'enabled:false when Kafka is switched off, and 503 when it is enabled but ' +
          'unreachable — never an empty 200.',
        response: {
          200: eventsResponseSchema,
          503: kafkaUnavailableSchema,
        },
      },
    },
    async (_request, reply: FastifyReply) => {
      // Disabled is a 200, not a 503. See the outcome table above.
      if (!eventProducer.enabled) {
        return buildEventData({ producer: eventProducer })
      }

      const data = await buildEventData({
        producer: eventProducer,
        kafka: kafkaAdminClient,
      })

      // Enabled, but we have neither a live producer connection nor any
      // evidence the broker is reachable. `connected` is false until the first
      // publish, so a cold-but-healthy process must not 503 — only report
      // unavailable when something has actually failed.
      const lastError = eventProducer.getLastError()
      if (!data.connected && lastError) {
        return sendKafkaUnavailable(reply, lastError)
      }

      // Enabled and cold: probe once so an unreachable broker is reported as
      // 503 rather than as a healthy-looking empty snapshot.
      if (!data.connected && kafkaAdminClient) {
        const admin = kafkaAdminClient.admin()
        // Bounded, because the shared client retries forever so consumers can
        // self-heal — a raw connect() to a dead broker never rejects and would
        // hang this request. null back means "did not answer in time", which
        // for a reachability check is the same as unreachable.
        const reached = await withKafkaAdminDeadline(async () => {
          await admin.connect()
          await admin.listTopics()
          return true
        })
        // Not awaited: disconnect() can block behind the same stuck connection.
        void admin.disconnect().catch(() => {
          /* nothing to unwind */
        })
        if (!reached) {
          return sendKafkaUnavailable(
            reply,
            new KafkaUnavailableError(
              'kafka_broker_unavailable',
              `No Kafka broker is available at ${eventProducer.brokers.join(', ')}`
            )
          )
        }
      }

      return data
    }
  )
}
