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

/** Closed shape of OutboxRelay.stats(): nothing outside it can leak. */
const outboxStatsSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean', description: 'False while Kafka is switched off.' },
    running: { type: 'boolean' },
    workerId: { type: 'string' },
    counts: {
      type: 'object',
      properties: {
        pending: { type: 'number' },
        processing: { type: 'number' },
        sent: { type: 'number' },
        failed: { type: 'number' },
      },
      required: ['pending', 'processing', 'sent', 'failed'],
      additionalProperties: false,
    },
    oldestPendingAgeMs: { type: ['number', 'null'] },
    sinceStart: {
      type: 'object',
      properties: {
        sent: { type: 'number' },
        failedAttempts: { type: 'number' },
        lastError: { type: ['string', 'null'] },
        lastTickAt: { type: ['string', 'null'] },
      },
      required: ['sent', 'failedAttempts', 'lastError', 'lastTickAt'],
      additionalProperties: false,
    },
  },
  required: ['enabled', 'running', 'workerId', 'counts', 'oldestPendingAgeMs', 'sinceStart'],
  additionalProperties: false,
} as const

export function registerOutboxRoutes(server: FastifyInstance, relay: OutboxRelay): void {
  server.get(
    '/api/v1/outbox',
    {
      config: { policy: { permission: 'ops:read', mfa: true } },
      schema: {
        tags: ['events'],
        description:
          'Transactional outbox state: rows by status, age of the oldest undelivered row, and ' +
          'process-lifetime counters (reset on restart). failed > 0 means events were given up on.',
        response: { 200: outboxStatsSchema },
      },
    },
    async () => relay.stats()
  )

  server.post(
    '/api/v1/outbox/requeue',
    {
      config: { policy: { permission: 'ops:write', mfa: true, audit: true }, rateTier: 'admin' },
      schema: {
        tags: ['events'],
        description: 'Operator action: put failed (dead) outbox rows back in the queue.',
        response: {
          200: {
            type: 'object',
            properties: { requeued: { type: 'number' } },
            required: ['requeued'],
            additionalProperties: false,
          },
        },
      },
    },
    async () => ({ requeued: await relay.requeueFailed() })
  )
}
