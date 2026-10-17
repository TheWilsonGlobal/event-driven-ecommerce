import type { FastifyInstance } from 'fastify'
import { getServicePool } from '@ecommerce/shared-database'
import {
  KafkaUnavailableError,
  OutboxRelay,
  loadOutboxEnv,
  type EventProducer,
} from '@ecommerce/shared-messaging'

/**
 * Wires the outbox relay for ms-order.
 *
 * The relay talks to Postgres through the `pg` pool (raw SQL: SKIP LOCKED and
 * the lease cannot be expressed in Prisma), while the rows themselves are
 * written through Prisma inside the business transactions. Same table, two
 * access paths, which is why the migration owns the DDL.
 *
 * `isEnabled` follows KAFKA_ENABLED: with Kafka off the relay idles and events
 * WAIT in the table (visible on GET /api/v1/outbox) instead of being dropped as
 * the old tryPublish did. They are delivered, in order, once Kafka is enabled.
 */
export function createOrderRelay(eventProducer: EventProducer): OutboxRelay {
  const sp = getServicePool('order')
  const cfg = loadOutboxEnv()
  return new OutboxRelay({
    db: sp.pool,
    schema: sp.schema,
    logPrefix: '[Order Service]',
    publish: async (row) => {
      await eventProducer.publishEnvelope(row.topic, row.partitionKey, row.envelope)
    },
    isEnabled: () => eventProducer.enabled,
    isBrokerDown: (err) => err instanceof KafkaUnavailableError,
    pollMs: cfg.pollMs,
    batch: cfg.batch,
    leaseMs: cfg.leaseMs,
    sendTimeoutMs: cfg.sendTimeoutMs,
  })
}

export function registerOutboxRoutes(server: FastifyInstance, relay: OutboxRelay): void {
  server.get(
    '/api/v1/outbox',
    {
      schema: {
        tags: ['events'],
        description:
          'Transactional outbox state: rows by status, age of the oldest undelivered row, and ' +
          'process-lifetime counters (reset on restart). failed > 0 means events were given up on.',
        response: { 200: { type: 'object', additionalProperties: true } },
      },
    },
    async () => relay.stats()
  )

  server.post(
    '/api/v1/outbox/requeue',
    {
      schema: {
        tags: ['events'],
        description: 'Operator action: put failed (dead) outbox rows back in the queue.',
        response: { 200: { type: 'object', additionalProperties: true } },
      },
    },
    async () => ({ requeued: await relay.requeueFailed() })
  )
}
