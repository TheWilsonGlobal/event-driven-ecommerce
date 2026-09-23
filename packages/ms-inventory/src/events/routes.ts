import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  buildEventData,
  eventsResponseSchema,
  kafkaUnavailableSchema,
  sendKafkaUnavailable,
  KafkaUnavailableError,
  type EventConsumer,
} from '@ecommerce/shared-messaging'
import type { Kafka } from 'kafkajs'
import { eventProducer, kafkaAdminClient } from './producer'

/**
 * Ceiling on the cold-start reachability probe below.
 *
 * Must exist because createKafkaClient configures effectively infinite retries
 * (`retries: MAX_SAFE_INTEGER`, so the service self-heals when the broker
 * returns). The side effect is that admin.connect() against a down broker
 * neither resolves nor rejects — measured still-pending at 20s. Without a
 * deadline this route would hang rather than return the 503 it exists to
 * return, and a hanging endpoint is strictly worse than an honest error.
 */
const PROBE_BUDGET_MS = 4000

/**
 * Returns null when the broker answered, or the error to render as a 503.
 *
 * Losing the race is reported as `kafka_timeout` — a real, machine-readable
 * cause, not an assumed one. The probe is left running rather than cancelled;
 * kafkajs has no cancellation for an in-flight connect, and its eventual
 * result warms the shared health cache.
 */
async function probeBroker(kafka: Kafka): Promise<KafkaUnavailableError | null> {
  const admin = kafka.admin()
  let timer: NodeJS.Timeout | undefined

  const timeout = new Promise<KafkaUnavailableError>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          new KafkaUnavailableError(
            'kafka_timeout',
            `No Kafka broker answered within ${PROBE_BUDGET_MS}ms`
          )
        ),
      PROBE_BUDGET_MS
    )
  })

  const probe = (async (): Promise<KafkaUnavailableError | null> => {
    try {
      await admin.connect()
      await admin.listTopics()
      return null
    } catch (err) {
      return err instanceof KafkaUnavailableError
        ? err
        : new KafkaUnavailableError(
            'kafka_broker_unavailable',
            `No Kafka broker is available: ${(err as Error).message}`
          )
    } finally {
      try {
        await admin.disconnect()
      } catch {
        /* nothing to unwind */
      }
    }
  })()

  try {
    return await Promise.race([probe, timeout])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

/**
 * Registers `GET /api/v1/events`.
 *
 * Same three OUTCOMES as ms-order's, deliberately distinct, because collapsing
 * any two would hide a real operational state:
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
 * Unlike ms-order, this service passes its CONSUMER in as well. Without it the
 * `consumers` array would be empty and the admin would render ms-inventory as
 * a pure producer — hiding the group state and the lag that are the only way
 * to tell "no orders have happened" from "the consume loop is stuck".
 */
export function registerEventRoutes(server: FastifyInstance, consumer: EventConsumer): void {
  server.get(
    '/api/v1/events',
    {
      schema: {
        tags: ['events'],
        description:
          'Kafka event-backbone introspection: topics, per-topic publish counters, and this ' +
          "service's consumer-group state/lag. Returns 200 with enabled:false when Kafka is " +
          'switched off, and 503 when it is enabled but unreachable — never an empty 200.',
        response: {
          200: eventsResponseSchema,
          503: kafkaUnavailableSchema,
        },
      },
    },
    async (_request, reply: FastifyReply) => {
      // Disabled is a 200, not a 503. See the outcome table above. The
      // consumer is still passed so its (zeroed, but real) local counters and
      // its groupId/topics are reported rather than omitted.
      if (!eventProducer.enabled) {
        return buildEventData({ producer: eventProducer, consumers: [consumer] })
      }

      const data = await buildEventData({
        producer: eventProducer,
        consumers: [consumer],
        kafka: kafkaAdminClient,
      })

      // Enabled, but neither a live producer connection nor evidence the
      // broker is reachable. `connected` stays false until the first publish,
      // and this service may legitimately never have published — so a cold
      // process must not 503 unless something actually failed.
      const lastError = eventProducer.getLastError()
      if (!data.connected && lastError) {
        return sendKafkaUnavailable(reply, lastError)
      }

      // A running consumer is itself proof the broker is reachable, even with
      // a cold producer — which is this service's NORMAL steady state before
      // its first reservation. Probing anyway would 503 a perfectly healthy
      // service the moment an admin call raced a broker hiccup.
      if (!data.connected && !consumer.isRunning && kafkaAdminClient) {
        const unavailable = await probeBroker(kafkaAdminClient)
        if (unavailable) {
          return sendKafkaUnavailable(reply, unavailable)
        }
      }

      return data
    }
  )
}
