import type { FastifyInstance } from 'fastify'
import { getServicePool, pgHealth, type loadDatabaseConfig } from '@ecommerce/shared-database'
import { checkKafkaHealth, type EventConsumer, type KafkaHealth } from '@ecommerce/shared-messaging'
import { kafkaAdminClient, kafkaSettings } from '../events'

// Closed on purpose: /health is public, so only these fields can ever leave.
const healthResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    service: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    // Postgres is the only store, so `reachable` comes from a real
    // SELECT 1 on every call (never from configuration) and an
    // unreachable database answers 503.
    database: {
      type: 'object',
      properties: {
        mode: { type: 'string' },
        driver: { type: 'string' },
        queue: { type: 'string' },
        reachable: { type: 'boolean' },
        schema: { type: 'string' },
        latencyMs: { type: 'number' },
      },
      additionalProperties: false,
    },
    // Read from a ~10s cache so a liveness probe never blocks on an
    // unreachable broker -- the lesson ms-product learned when an
    // uncached Elasticsearch probe took ~2.5s during an outage.
    // `reachable:false` with `enabled:false` is a healthy default,
    // not an outage.
    events: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        reachable: { type: 'boolean' },
        brokers: { type: 'array', items: { type: 'string' } },
        reason: { type: ['string', 'null'] },
        cachedAgeMs: { type: 'number' },
        // The consume loop's own state, which broker reachability
        // does not imply: a reachable broker with a consumer that
        // failed to start is exactly the silent-stall case /health
        // needs to expose.
        consumerRunning: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const

/**
 * Ceiling on how long /health will wait for a Kafka reading.
 *
 * Slightly above the client's 3s connectionTimeout, so a broker that is merely
 * slow still gets to answer and produce a real cached reading.
 */
const HEALTH_PROBE_BUDGET_MS = 4000

/**
 * checkKafkaHealth with a hard deadline.
 *
 * The shared helper caches for ~10s and collapses concurrent probes, which is
 * what keeps a steady-state /health fast. What it does not do is bound the
 * FIRST probe: it awaits admin.connect(), and createKafkaClient configures
 * effectively infinite retries (`retries: MAX_SAFE_INTEGER`) so that the
 * service self-heals when the broker returns. Against a broker that is down,
 * that connect neither resolves nor rejects — measured still-pending at 20s —
 * so the first /health after boot would hang indefinitely.
 *
 * That is precisely the failure ms-product's Elasticsearch incident warns
 * about, in its worst form: a liveness probe blocking makes a
 * degraded-but-serving service look dead to whatever is probing it. So the
 * probe races a timer, and losing the race reports `reachable: false` with
 * reason `kafka_timeout` — which is the honest reading. It is NOT claimed as a
 * measured success, and the underlying probe is left running so its result
 * populates the shared cache for the next call.
 */
async function kafkaHealthBounded(): Promise<KafkaHealth> {
  const fallback: KafkaHealth = {
    enabled: kafkaSettings.enabled,
    reachable: false,
    brokers: kafkaSettings.brokers,
    reason: 'kafka_timeout',
    cachedAgeMs: 0,
  }

  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      checkKafkaHealth(kafkaAdminClient, kafkaSettings.brokers, kafkaSettings.enabled),
      new Promise<KafkaHealth>((resolve) => {
        timer = setTimeout(() => resolve(fallback), HEALTH_PROBE_BUDGET_MS)
      }),
    ])
  } finally {
    // Otherwise the pending timer keeps the event loop alive and delays
    // shutdown by up to the budget on every /health that won the race.
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export interface HealthDeps {
  dbConfig: ReturnType<typeof loadDatabaseConfig>
  eventConsumer: Pick<EventConsumer, 'isRunning'>
  /** Overridable so tests need no database. */
  probe?: () => ReturnType<typeof pgHealth>
}

export function registerHealthRoute(
  server: FastifyInstance,
  { dbConfig, eventConsumer, probe = () => pgHealth(getServicePool('inventory')) }: HealthDeps
): void {
  server.get(
    '/health',
    {
      config: { policy: { public: true } },
      schema: {
        tags: ['health'],
        description:
          'Service liveness/status check, including a real Postgres round trip and the ' +
          'queue driver. Answers 503 (status "unhealthy") when Postgres is unreachable.',
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (request, reply) => {
      const pg = await probe()
      if (!pg.reachable) {
        void reply.code(503)
        // Logged, never sent: the raw driver error can carry host names.
        request.log.error({ dbError: pg.error }, 'health: database unreachable')
      }
      return {
        status: pg.reachable ? 'ok' : 'unhealthy',
        service: 'ms-inventory',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.document.driver,
          queue: dbConfig.keyValue.driver,
          reachable: pg.reachable,
          schema: pg.schema,
          ...(pg.latencyMs !== null ? { latencyMs: pg.latencyMs } : {}),
        },
        events: {
          ...(await kafkaHealthBounded()),
          consumerRunning: eventConsumer.isRunning,
        },
      }
    }
  )
}
