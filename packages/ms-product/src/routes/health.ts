import type { FastifyInstance } from 'fastify'
import { getServicePool, pgHealth } from '@ecommerce/shared-database'
import type { DatabaseConfiguration, ProductSearchClient } from '@ecommerce/shared-database'

interface HealthRouteDeps {
  dbConfig: DatabaseConfiguration
  search: ProductSearchClient
}

// ─── Health ───────────────────────────────────────────────────────────────
export function registerHealthRoutes(
  server: FastifyInstance,
  { dbConfig, search }: HealthRouteDeps
): void {
  server.get(
    '/health',
    {
      config: { policy: { public: true } },
      schema: {
        tags: ['health'],
        description: 'Service liveness/status check, including database driver.',
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
                  reachable: { type: 'boolean' },
                  schema: { type: 'string' },
                  latencyMs: { type: 'number' },
                  error: { type: 'string' },
                },
              },
              search: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean' },
                  reachable: { type: 'boolean' },
                  node: { type: 'string' },
                  index: { type: 'string' },
                  clusterStatus: { type: 'string' },
                  documents: { type: 'number' },
                  // Age of the cached probe in ms; 0 means freshly fetched.
                  cachedAgeMs: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const searchStatus = await search.ping()
      // A real SELECT 1 round trip on every call: reachability is never
      // inferred from config. Only the postgres driver has a pool to probe.
      const pg =
        dbConfig.document.driver === 'postgres' ? await pgHealth(getServicePool('product')) : null
      // Postgres is the source of truth, so unlike Elasticsearch an
      // unreachable database makes the service unhealthy (503).
      if (pg && !pg.reachable) void reply.code(503)
      return {
        status: pg && !pg.reachable ? 'unhealthy' : 'ok',
        service: 'ms-product',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.document.driver,
          ...(pg
            ? {
                reachable: pg.reachable,
                schema: pg.schema,
                ...(pg.latencyMs !== null ? { latencyMs: pg.latencyMs } : {}),
                ...(pg.error ? { error: pg.error } : {}),
              }
            : {}),
        },
        // Reported, but never allowed to change `status`: Elasticsearch is an
        // optional search accelerator, so a down cluster is a degraded feature,
        // not an unhealthy service. Flipping /health to a failure here would
        // take the service out of rotation for something it can work without.
        search: {
          enabled: search.isEnabled(),
          reachable: searchStatus.reachable,
          node: search.nodeUrl,
          index: search.indexName,
          ...(searchStatus.status ? { clusterStatus: searchStatus.status } : {}),
          ...(searchStatus.docs !== undefined ? { documents: searchStatus.docs } : {}),
          ...(searchStatus.cachedAgeMs !== undefined
            ? { cachedAgeMs: searchStatus.cachedAgeMs }
            : {}),
        },
      }
    }
  )
}
