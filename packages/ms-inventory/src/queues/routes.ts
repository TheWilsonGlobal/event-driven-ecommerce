import type { FastifyInstance } from 'fastify'
import { QueueManager } from './queueManager'
import { QUEUE_DEFINITIONS, type QueueName } from './definitions'
import {
  buildQueueData,
  toRedisUnavailable,
  queuesResponseSchema,
  serviceUnavailableSchema,
  sendUnavailable,
} from '@ecommerce/shared-messaging'

/**
 * Queue introspection route, identical in shape to ms-product's and
 * ms-order's so the admin panel renders all three from one code path.
 *
 * Returns 503 with a machine-readable `reason` when Redis is unreachable —
 * never an empty 200. An empty 200 renders in the admin as "zero jobs", which
 * is indistinguishable from a healthy but empty Redis.
 */
export function registerQueueRoutes(server: FastifyInstance, queueManager: QueueManager): void {
  server.get(
    '/api/v1/queues',
    {
      schema: {
        tags: ['queues'],
        description:
          'Live BullMQ queue introspection: per-queue configuration, job counts by state, ' +
          'and recent jobs. Returns 503 when Redis is unreachable.',
        response: {
          200: queuesResponseSchema,
          503: serviceUnavailableSchema,
        },
      },
    },
    async (_request, reply) => {
      const unavailable = await queueManager.checkRedis()
      if (unavailable) {
        return sendUnavailable(reply, unavailable)
      }

      try {
        return await buildQueueData<QueueName>(
          QUEUE_DEFINITIONS,
          (name) => queueManager.queueFor(name),
          queueManager.isClosed
        )
      } catch (err) {
        return sendUnavailable(reply, toRedisUnavailable(err))
      }
    }
  )
}
