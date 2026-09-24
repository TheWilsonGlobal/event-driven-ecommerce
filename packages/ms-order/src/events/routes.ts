import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  buildEventData,
  eventsResponseSchema,
  kafkaUnavailableSchema,
  sendKafkaUnavailable,
  withKafkaAdminDeadline,
  KafkaUnavailableError,
  kafkaConfigRequestSchema,
  kafkaConfigResponseSchema,
  kafkaConfigErrorSchema,
  setKafkaEnabledInEnv,
  resolveRepoEnvPath,
  KafkaEnvWriteError,
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
export function registerEventRoutes(server: FastifyInstance, options: { repoRoot: string }): void {
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

  /**
   * `PATCH /api/v1/events/config` — persist KAFKA_ENABLED to the repo-root .env.
   *
   * ── What this does NOT do ─────────────────────────────────────────────────
   * It does not turn Kafka on. `loadKafkaSettings` reads KAFKA_ENABLED once at
   * module import time, and when it was false this process built no client, no
   * producer and no consumer — there is nothing here to start. Writing the flag
   * and reporting `enabled: true` as though the backbone were live would be the
   * same class of lie as serialising an unmeasured lag as 0.
   *
   * So the response carries THREE facts, not one: the value now persisted
   * (`enabled`), the value this process is actually running (`runtimeEnabled`),
   * and whether they disagree (`restartRequired`). The admin UI renders the
   * restart notice off that last field rather than flipping its status chip to
   * green.
   *
   * ms-order owns this route because it is the backbone's producer and already
   * owns the write side of the event contract; ms-inventory and ms-analytics
   * read the same repo-root .env at their own boot, so one write reconfigures
   * all three.
   */
  server.patch<{ Body: { enabled: boolean } }>(
    '/api/v1/events/config',
    {
      schema: {
        tags: ['events'],
        description:
          'Persists KAFKA_ENABLED to the repo-root .env. Does NOT start or stop Kafka in ' +
          'the running process — the flag is read at boot, so the response reports ' +
          'restartRequired whenever the persisted value differs from the running one.',
        body: kafkaConfigRequestSchema,
        response: {
          200: kafkaConfigResponseSchema,
          500: kafkaConfigErrorSchema,
        },
      },
    },
    async (request, reply: FastifyReply) => {
      const { enabled } = request.body
      const envPath = resolveRepoEnvPath(options.repoRoot)

      try {
        // `eventProducer.enabled` is what this process booted with, not a
        // re-read of process.env — a later dotenv call or an external edit
        // could have changed the variable without changing what was built.
        return setKafkaEnabledInEnv(envPath, enabled, eventProducer.enabled)
      } catch (err) {
        const isWriteError = err instanceof KafkaEnvWriteError
        request.log.error({ err, envPath }, 'Failed to persist KAFKA_ENABLED to the repo-root .env')
        // 500, not 200-with-a-flag: nothing was persisted, and a success shape
        // here would leave the UI showing a toggle that never took.
        return reply.status(500).send({
          error: 'Internal Server Error',
          reason: 'kafka_env_write_failed',
          message: isWriteError ? err.message : err instanceof Error ? err.message : String(err),
          envPath,
          timestamp: new Date().toISOString(),
        })
      }
    }
  )
}
