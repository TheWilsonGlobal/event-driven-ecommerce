import type { FastifyInstance } from 'fastify'
import type { DatabaseConfiguration } from '@ecommerce/shared-database'
import { checkKafkaHealth } from '@ecommerce/shared-messaging'
import type { EventConsumer } from '@ecommerce/shared-messaging'
import { kafkaAdminClient, kafkaSettings } from '../events'

export interface HealthRouteDeps {
  dbConfig: DatabaseConfiguration
  consumer: EventConsumer
}

/**
 * `GET /health`.
 *
 * The `events` block is the same one ms-order returns, from the same ~10s
 * cached probe — a liveness check must never block on an unreachable broker.
 * `enabled:false, reachable:false` is the repo default and a healthy state.
 *
 * Kafka being down does NOT flip `status`. This service can still serve every
 * analytics route from NeDB; a broker outage means the view stops advancing,
 * which is degraded, not dead. Failing /health here would take a
 * still-useful service out of rotation — the same call ms-product makes about
 * Elasticsearch.
 */
export function registerHealthRoutes(
  server: FastifyInstance,
  { dbConfig, consumer }: HealthRouteDeps
): void {
  server.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        description:
          'Service liveness/status check, including the document driver and the ' +
          'event-backbone reachability probe.',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              database: {
                type: 'object',
                properties: {
                  mode: { type: 'string' },
                  driver: { type: 'string' },
                },
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
                },
              },
              // Whether the consume loop is actually running, separate from
              // whether the broker is reachable: a reachable broker with a
              // stopped consumer is the state where aggregates silently stop
              // advancing while everything else looks fine.
              consumer: {
                type: 'object',
                properties: {
                  groupId: { type: 'string' },
                  topics: { type: 'array', items: { type: 'string' } },
                  running: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return {
        status: 'ok',
        service: 'ms-analytics',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.document.driver,
        },
        events: await checkKafkaHealth(
          kafkaAdminClient,
          kafkaSettings.brokers,
          kafkaSettings.enabled
        ),
        consumer: {
          groupId: consumer.groupId,
          topics: consumer.topics,
          running: consumer.isRunning,
        },
      }
    }
  )
}
