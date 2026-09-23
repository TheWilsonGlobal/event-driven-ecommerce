import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  buildEventData,
  eventsResponseSchema,
  kafkaUnavailableSchema,
  sendKafkaUnavailable,
  withKafkaAdminDeadline,
  KafkaUnavailableError,
  type EventConsumer,
} from '@ecommerce/shared-messaging'
import { eventProducer, kafkaAdminClient } from './consumer'

/**
 * Registers `GET /api/v1/events`.
 *
 * Copied deliberately from ms-order's version, including its three distinct
 * OUTCOMES — collapsing any two of them would hide a real operational state:
 *
 *   200 + enabled:false  Kafka is switched off (KAFKA_ENABLED != 'true'). The
 *                        repo default and a perfectly healthy configuration.
 *   200 + enabled:true   Enabled and serviceable. Live counters and lag.
 *   503                  Enabled but the broker is unreachable, with a
 *                        machine-readable `reason`.
 *
 * Never an empty 200 for the third case: zeros are indistinguishable from a
 * healthy-but-idle backbone.
 *
 * The one difference from ms-order is what goes into the payload. ms-order
 * passes a producer and no consumers; this service passes the producer (which
 * publishes nothing, and whose topic counters therefore honestly read 0) AND
 * its consumer, so the `consumers` array carries real consumed/failed/skipped
 * counts and real broker-side lag.
 */
export function registerEventRoutes(server: FastifyInstance, consumer: EventConsumer): void {
  server.get(
    '/api/v1/events',
    {
      schema: {
        tags: ['events'],
        description:
          'Kafka event-backbone introspection for ms-analytics: the topics it consumes, ' +
          'its consumer-group state and lag, and per-topic publish counters (always 0 — ' +
          'this service is a pure consumer and publishes nothing). Returns 200 with ' +
          'enabled:false when Kafka is switched off, and 503 when it is enabled but ' +
          'unreachable — never an empty 200.',
        response: {
          200: eventsResponseSchema,
          503: kafkaUnavailableSchema,
        },
      },
    },
    async (_request, reply: FastifyReply) => {
      // Disabled is a 200, not a 503. See the outcome table above. The
      // consumer is still passed: its counters are local and real (all zero on
      // a disabled service, because nothing ever started), and omitting it
      // would make the consumers array vanish rather than report an idle one.
      if (!eventProducer.enabled) {
        return buildEventData({ producer: eventProducer, consumers: [consumer] })
      }

      const data = await buildEventData({
        producer: eventProducer,
        consumers: [consumer],
        kafka: kafkaAdminClient,
      })

      // Enabled, but neither a live producer connection nor evidence the
      // broker is reachable. `connected` is false until the first publish —
      // and on this service there is never a publish, so it stays false
      // permanently. Only report unavailable when something actually failed.
      const lastError = eventProducer.getLastError() ?? consumer.getLastError()
      if (!data.connected && lastError) {
        return sendKafkaUnavailable(reply, lastError)
      }

      // Enabled and never-connected (the permanent state of a pure consumer's
      // producer): probe once so an unreachable broker is reported as 503
      // rather than as a healthy-looking empty snapshot.
      //
      // ⚠️ BOUNDED. A raw `admin.connect()` cannot be awaited directly here:
      // the shared client is built with `retries: MAX_SAFE_INTEGER` and
      // `restartOnFailure: () => true` so CONSUMERS self-heal after a broker
      // blip (see client.ts). Against a dead broker that connect therefore
      // never rejects, and this request would hang forever instead of
      // returning the 503 the whole outcome table exists to produce. Measured
      // 2026-09-23: this endpoint did not answer within 30s before the
      // deadline was applied. withKafkaAdminDeadline returns null on timeout.
      if (!data.connected && kafkaAdminClient) {
        const admin = kafkaAdminClient.admin()
        try {
          const reached = await withKafkaAdminDeadline(async () => {
            await admin.connect()
            await admin.listTopics()
            return true
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
        } finally {
          // Deliberately NOT awaited: with the broker down, disconnect() can
          // block behind the same stuck connection we just timed out on,
          // reintroducing the hang one line later.
          void admin.disconnect().catch(() => {
            /* nothing to unwind */
          })
        }
      }

      return data
    }
  )
}
