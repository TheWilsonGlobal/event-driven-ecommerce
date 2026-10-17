import type { FastifyInstance } from 'fastify'
import { checkKafkaHealth } from '@ecommerce/shared-messaging'
import type { loadDatabaseConfig } from '@ecommerce/shared-database'
import type { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { kafkaAdminClient, kafkaSettings } from '../events'

// Closed on purpose: /health is public, so only these fields can ever leave.
// The raw database error text (host names, driver messages) is logged, never sent.
export const healthResponseSchema = {
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
        queue: { type: 'string' },
        reachable: { type: 'boolean' },
        latencyMs: { type: ['number', 'null'] },
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
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const

export function registerHealthRoute(
  server: FastifyInstance,
  prisma: Pick<PrismaClient, '$queryRaw'>,
  dbConfig: ReturnType<typeof loadDatabaseConfig>
): void {
  server.get(
    '/health',
    {
      config: { policy: { public: true } },
      schema: {
        tags: ['health'],
        description: 'Service liveness/status check, including database/queue driver.',
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (request, reply) => {
      // A real round trip: reachability is never inferred from configuration.
      const dbStarted = Date.now()
      let dbReachable = true
      let dbError: string | undefined
      try {
        await prisma.$queryRaw`SELECT 1`
      } catch (err) {
        dbReachable = false
        dbError = err instanceof Error ? err.message.trim().split('\n').pop() : String(err)
      }
      if (!dbReachable) {
        reply.status(503)
        request.log.error({ dbError }, 'health: database unreachable')
      }
      return {
        status: dbReachable ? 'ok' : 'unhealthy',
        service: 'ms-order',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.relational.driver,
          queue: dbConfig.keyValue.driver,
          reachable: dbReachable,
          latencyMs: dbReachable ? Date.now() - dbStarted : null,
        },
        events: await checkKafkaHealth(
          kafkaAdminClient,
          kafkaSettings.brokers,
          kafkaSettings.enabled
        ),
      }
    }
  )
}
