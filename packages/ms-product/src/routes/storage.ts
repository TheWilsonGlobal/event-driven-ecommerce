import type { FastifyInstance } from 'fastify'
import type { RustFSStorageClient } from '@ecommerce/shared-database'
import { ErrorResponse, Strict, Type, notFound } from '@ecommerce/shared-security'
import { DownloadQuery } from '../schemas'

interface StorageRouteDeps {
  rustfs: Pick<RustFSStorageClient, 'healthCheck' | 'listObjects' | 'getSignedDownloadUrl'>
}

// The whole storage surface is back-office: `storage:read` (ADMIN, VENDOR) and the
// expensive tier, since each call goes out to the object store.
const STORAGE_CONFIG = {
  policy: { permission: 'storage:read' },
  rateTier: 'expensive',
} as const

const HealthResponse = Strict({
  provider: Type.String(),
  healthy: Type.Boolean(),
  latencyMs: Type.Number(),
  endpoint: Type.String(),
  bucket: Type.String(),
  timestamp: Type.String({ format: 'date-time' }),
})

const ObjectsResponse = Strict({
  bucket: Type.String(),
  objects: Type.Array(
    Strict({
      key: Type.String(),
      sizeBytes: Type.Number(),
      lastModified: Type.String(),
    })
  ),
})

export function registerStorageRoutes(server: FastifyInstance, { rustfs }: StorageRouteDeps): void {
  // ─── Storage Health ───────────────────────────────────────────────────────
  // GET /api/v1/storage/health  → probe RustFS and return live status
  server.get(
    '/api/v1/storage/health',
    {
      config: STORAGE_CONFIG,
      schema: {
        tags: ['storage'],
        description: 'Probe the RustFS object storage backend and report live health.',
        response: { 200: HealthResponse, 503: HealthResponse },
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
      config: STORAGE_CONFIG,
      schema: {
        tags: ['storage'],
        description: 'List objects currently stored in the RustFS bucket.',
        response: { 200: ObjectsResponse },
      },
    },
    async () => {
      const objects = await rustfs.listObjects()
      return { bucket: process.env.RUSTFS_BUCKET || 'ecommerce-uploads', objects }
    }
  )

  // GET /api/v1/storage/download?key=... → redirect to a pre-signed RustFS GET URL
  server.get<{ Querystring: { key: string } }>(
    '/api/v1/storage/download',
    {
      config: STORAGE_CONFIG,
      schema: {
        tags: ['storage'],
        description:
          'Redirect to a pre-signed download URL for the given object key. The key must be ' +
          'one of the generated `products/<id>.<ext>` / `receipts/<id>.<ext>` keys: path ' +
          'traversal and any other prefix are refused with 400.',
        // The key is client input that ends up inside a signed URL and a
        // Content-Disposition header, so it is validated against a strict pattern
        // (see OBJECT_KEY_PATTERN) before the handler runs.
        querystring: DownloadQuery,
        response: { 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const key = req.query.key
      try {
        const filename = key.split('/').pop() ?? key
        const url = await rustfs.getSignedDownloadUrl(key, 3600, filename)
        return reply.redirect(url)
      } catch (err) {
        server.log.warn(`[RustFS] Could not sign download URL for ${key}: ${err}`)
        throw notFound('Object not found')
      }
    }
  )
}
