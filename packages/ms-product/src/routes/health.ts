import type { FastifyInstance } from 'fastify'
import type { DatabaseConfiguration } from '@ecommerce/shared-database'
import type { ProductSearchClient } from '@ecommerce/shared-database'

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
    async () => {
      const searchStatus = await search.ping()
      return {
        status: 'ok',
        service: 'ms-product',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.document.driver,
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
