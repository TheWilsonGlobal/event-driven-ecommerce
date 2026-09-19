import type { FastifyInstance } from 'fastify'
import type { RustFSStorageClient } from '@ecommerce/shared-database'

interface StorageRouteDeps {
  rustfs: RustFSStorageClient
}

export function registerStorageRoutes(server: FastifyInstance, { rustfs }: StorageRouteDeps): void {
  // ─── Storage Health ───────────────────────────────────────────────────────
  // GET /api/v1/storage/health  → probe RustFS and return live status
  server.get(
    '/api/v1/storage/health',
    {
      schema: {
        tags: ['storage'],
        description: 'Probe the RustFS object storage backend and report live health.',
        response: {
          200: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              healthy: { type: 'boolean' },
              latencyMs: { type: 'number' },
              endpoint: { type: 'string' },
              bucket: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
          503: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              healthy: { type: 'boolean' },
              latencyMs: { type: 'number' },
              endpoint: { type: 'string' },
              bucket: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const result = await rustfs.healthCheck()
      reply.status(result.healthy ? 200 : 503)
      return {
        provider: 'rustfs',
        healthy: result.healthy,
        latencyMs: result.latencyMs,
        endpoint: result.endpoint,
        bucket: process.env.RUSTFS_BUCKET || 'ecommerce-uploads',
        timestamp: new Date().toISOString(),
      }
    }
  )

  // GET /api/v1/storage/objects  → list objects currently in the bucket
  server.get(
    '/api/v1/storage/objects',
    {
      schema: {
        tags: ['storage'],
        description: 'List objects currently stored in the RustFS bucket.',
        response: {
          200: {
            type: 'object',
            properties: {
              bucket: { type: 'string' },
              objects: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    sizeBytes: { type: 'number' },
                    lastModified: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const objects = await rustfs.listObjects()
      return { bucket: process.env.RUSTFS_BUCKET || 'ecommerce-uploads', objects }
    }
  )

  // GET /api/v1/storage/download?key=... → redirect to a pre-signed RustFS GET URL
  server.get<{ Querystring: { key?: string } }>(
    '/api/v1/storage/download',
    {
      schema: {
        tags: ['storage'],
        description: 'Redirect to a pre-signed download URL for the given object key.',
        querystring: {
          type: 'object',
          properties: { key: { type: 'string' } },
          required: ['key'],
        },
      },
    },
    async (req, reply) => {
      const key = req.query.key
      if (!key) {
        return reply.status(400).send({ error: 'Object key is required' })
      }
      try {
        const filename = key.split('/').pop() ?? key
        const url = await rustfs.getSignedDownloadUrl(key, 3600, filename)
        return reply.redirect(url)
      } catch (err) {
        server.log.warn(`[RustFS] Could not sign download URL for ${key}: ${err}`)
        return reply.status(404).send({ error: 'Object not found' })
      }
    }
  )
}
