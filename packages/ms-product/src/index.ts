import type { FastifyInstance, FastifyRequest } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as crypto from 'crypto'
import { loadDatabaseConfig, createRustFSClient } from '@ecommerce/shared-database'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.PRODUCT_SERVICE_PORT || '3002', 10)

// Initialise the RustFS client (singleton per process)
const rustfs = createRustFSClient(process.env)

const server: FastifyInstance = fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  },
})

async function bootstrap() {
  await server.register(cors, { origin: '*' })
  await server.register(helmet)
  await server.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB max per file
    },
  })

  await server.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Product Service',
        description: 'Product catalog, category, and file storage (RustFS) service.',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      tags: [
        { name: 'health', description: 'Service health and status' },
        { name: 'storage', description: 'RustFS object storage status' },
        { name: 'products', description: 'Product catalog' },
        { name: 'categories', description: 'Product categories' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })

  // Ensure the RustFS bucket exists on startup (non-blocking)
  rustfs.ensureBucket().catch((err) => {
    server.log.warn(`[RustFS] Could not ensure bucket on startup: ${err?.message}`)
  })

  // ─── Health ───────────────────────────────────────────────────────────────
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
            },
          },
        },
      },
    },
    async () => {
      return {
        status: 'ok',
        service: 'ms-product',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.document.driver,
        },
      }
    },
  )

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
    },
  )

  // ─── Products ─────────────────────────────────────────────────────────────
  server.get(
    '/api/v1/products',
    {
      schema: {
        tags: ['products'],
        description: 'List products (paginated).',
        response: {
          200: {
            type: 'object',
            properties: {
              products: { type: 'array', items: { type: 'object' } },
              total: { type: 'number' },
              page: { type: 'number' },
              limit: { type: 'number' },
            },
          },
        },
      },
    },
    async () => {
      return {
        products: [],
        total: 0,
        page: 1,
        limit: 20,
      }
    },
  )

  server.get(
    '/api/v1/categories',
    {
      schema: {
        tags: ['categories'],
        description: 'List product categories.',
        response: {
          200: {
            type: 'object',
            properties: {
              categories: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    slug: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return {
        categories: [
          { id: '1', name: 'Electronics', slug: 'electronics' },
          { id: '2', name: 'Clothing', slug: 'clothing' },
          { id: '3', name: 'Books', slug: 'books' },
        ],
      }
    },
  )

  // ─── Product Image Upload ─────────────────────────────────────────────────
  // POST /api/v1/products/upload  (multipart/form-data, field: "image")
  // Streams the file into RustFS and returns the public URL.
  // Note: the multipart body itself is intentionally not JSON-schema-validated
  // here — @fastify/multipart streams are not plain JSON bodies, and fastify's
  // body-schema validation does not apply cleanly to them. The `consumes` hint
  // and response schema below still let Swagger UI document and drive this
  // endpoint correctly.
  server.post(
    '/api/v1/products/upload',
    {
      schema: {
        tags: ['products'],
        description:
          'Upload a product image (multipart/form-data, field name "image"). ' +
          'Streams the file into RustFS and returns its storage key and public URL.',
        consumes: ['multipart/form-data'],
        response: {
          201: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              url: { type: 'string' },
              size: { type: 'number' },
            },
          },
          400: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          415: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          500: {
            type: 'object',
            properties: { error: { type: 'string' }, detail: { type: 'string' } },
          },
        },
      },
    },
    async (req: FastifyRequest, reply) => {
      const data = await req.file()
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' })
      }

      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      if (!allowedMimes.includes(data.mimetype)) {
        return reply.status(415).send({
          error: 'Unsupported media type. Allowed: jpeg, png, webp, gif',
        })
      }

      // Collect stream into buffer
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer)
      }
      const buffer = Buffer.concat(chunks)

      const ext = data.filename.split('.').pop() ?? 'jpg'
      const uid = crypto.randomUUID()
      const key = `products/${uid}.${ext}`

      try {
        const { url } = await rustfs.uploadObject(key, buffer, data.mimetype)
        return reply.status(201).send({ key, url, size: buffer.byteLength })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        server.log.error(`[RustFS] Upload failed: ${message}`)
        return reply.status(500).send({ error: 'Storage upload failed', detail: message })
      }
    },
  )

  // ─── Receipt Upload (Order Saga) ─────────────────────────────────────────
  // POST /api/v1/receipts/upload  (multipart/form-data, field: "receipt")
  // Note: as above, the multipart body is not JSON-schema-validated; only the
  // consumes hint and response shape are documented.
  server.post(
    '/api/v1/receipts/upload',
    {
      schema: {
        tags: ['products'],
        description:
          'Upload an order receipt (multipart/form-data, field name "receipt"). ' +
          'Streams the file into RustFS as a PDF and returns its storage key and public URL.',
        consumes: ['multipart/form-data'],
        response: {
          201: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              url: { type: 'string' },
              size: { type: 'number' },
            },
          },
          400: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          500: {
            type: 'object',
            properties: { error: { type: 'string' }, detail: { type: 'string' } },
          },
        },
      },
    },
    async (req: FastifyRequest, reply) => {
      const data = await req.file()
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' })
      }

      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer)
      }
      const buffer = Buffer.concat(chunks)

      const uid = crypto.randomUUID()
      const key = `receipts/${uid}.pdf`

      try {
        const { url } = await rustfs.uploadObject(key, buffer, 'application/pdf')
        return reply.status(201).send({ key, url, size: buffer.byteLength })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return reply.status(500).send({ error: 'Receipt upload failed', detail: message })
      }
    },
  )

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Product Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
