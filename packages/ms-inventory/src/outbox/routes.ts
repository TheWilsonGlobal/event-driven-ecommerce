import type { FastifyInstance, FastifyReply } from 'fastify'
import { describeError, type OutboxRelay } from '@ecommerce/shared-messaging'

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const

/**
 * Registers the outbox operator routes.
 *
 *   GET  /api/v1/outbox          relay.stats(): row counts by status, the age of
 *                                the oldest unsent row, and process-lifetime
 *                                counters (reset on restart, labelled as such).
 *   POST /api/v1/outbox/requeue  puts `failed` (dead) rows back to `pending`.
 *                                An explicit operator action: dead rows are
 *                                surfaced, never retried silently.
 *
 * Both answer 503 when Postgres cannot be reached, never an empty 200 -- a
 * zero-count body is indistinguishable from a healthy, drained outbox.
 *
 * `enabled:false` (Kafka off) is a normal 200 state: rows accumulate as
 * `pending` and the relay idles until KAFKA_ENABLED=true.
 */
export function registerOutboxRoutes(server: FastifyInstance, relay: OutboxRelay): void {
  const unavailable = (reply: FastifyReply, err: unknown) =>
    reply.status(503).send({ error: `Outbox database unreachable: ${describeError(err)}` })

  server.get(
    '/api/v1/outbox',
    {
      schema: {
        tags: ['outbox'],
        description:
          'Transactional-outbox state for the inventory.* events: counts by status, age of ' +
          'the oldest unsent event, and relay counters since process start.',
        response: {
          200: {
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
              },
            },
          },
          503: errorSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        return await relay.stats()
      } catch (err) {
        return unavailable(reply, err)
      }
    }
  )

  server.post(
    '/api/v1/outbox/requeue',
    {
      schema: {
        tags: ['outbox'],
        description:
          'Moves every dead (status=failed) outbox row back to pending with a fresh attempt ' +
          'budget. Returns how many rows were requeued.',
        response: {
          200: {
            type: 'object',
            properties: { requeued: { type: 'number' } },
            required: ['requeued'],
          },
          503: errorSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        return { requeued: await relay.requeueFailed() }
      } catch (err) {
        return unavailable(reply, err)
      }
    }
  )
}
