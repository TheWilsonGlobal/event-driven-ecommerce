import type { FastifyInstance } from 'fastify'
import type { DatabaseConfiguration } from '@ecommerce/shared-database'

/** Minimal Prisma surface the health check needs — a real round trip, never a config echo. */
export interface PingablePrisma {
  $queryRaw: (query: TemplateStringsArray) => Promise<unknown>
}

export function registerHealthRoute(
  server: FastifyInstance,
  dbConfig: DatabaseConfiguration,
  prisma: PingablePrisma
) {
  server.get(
    '/health',
    {
      // Public and unmetered: load balancers and Docker probe it constantly.
      config: { policy: { public: true }, rateTier: 'none' },
      schema: {
        tags: ['health'],
        description: 'Service liveness/status check, including database mode/driver.',
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              database: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  mode: { type: 'string' },
                  driver: { type: 'string' },
                  reachable: { type: 'boolean' },
                  latencyMs: { type: ['number', 'null'] },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const started = Date.now()
      let reachable = true
      let error: string | undefined
      try {
        await prisma.$queryRaw`SELECT 1`
      } catch (err) {
        reachable = false
        error = err instanceof Error ? err.message.trim().split('\n').pop() : String(err)
      }
      if (!reachable) reply.status(503)
      return {
        status: reachable ? 'ok' : 'unhealthy',
        service: 'ms-user',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.relational.driver,
          reachable,
          latencyMs: reachable ? Date.now() - started : null,
          ...(error ? { error } : {}),
        },
      }
    }
  )
}
