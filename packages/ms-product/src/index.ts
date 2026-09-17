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
import {
  loadDatabaseConfig,
  createRustFSClient,
  createDocumentStore,
  SEED_PRODUCTS,
  SEED_CATEGORIES,
} from '@ecommerce/shared-database'
import type { ProductDoc, CategoryDoc } from './types'

const REPO_ROOT = path.resolve(__dirname, '../../../')
dotenv.config({ path: path.join(REPO_ROOT, '.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.PRODUCT_SERVICE_PORT || '3002', 10)

// NEDB_DATA_PATH (e.g. "./data/db") is relative-by-convention to the repo
// root — same as how the .env file itself is located above — not to
// whatever directory the process happens to be launched from (pnpm/nodemon
// run this with cwd = packages/ms-product, which would otherwise silently
// nest the real data files under packages/ms-product/data/db instead of the
// intended top-level data/db/).
if (!path.isAbsolute(dbConfig.document.nedb.dataPath)) {
  dbConfig.document.nedb.dataPath = path.resolve(REPO_ROOT, dbConfig.document.nedb.dataPath)
}

// Initialise the RustFS client (singleton per process)
const rustfs = createRustFSClient(process.env)

// Real NeDB-backed document stores — one physical file per collection under
// the configured data path (e.g. data/db/products.db, data/db/categories.db).
const productsStore = createDocumentStore<ProductDoc>('products', dbConfig)
const categoriesStore = createDocumentStore<CategoryDoc>('categories', dbConfig)

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

  // ─── Self-seed (first run only) ───────────────────────────────────────────
  // Populates the real NeDB-backed stores from the shared seed data the first
  // time the service boots against an empty database. Safe to run on every
  // boot — it's a no-op once data already exists, so seeded data persists
  // across restarts instead of being re-inserted.
  {
    const existingProducts = await productsStore.find({})
    let seededProducts = 0
    if (existingProducts.length === 0) {
      for (const product of SEED_PRODUCTS) {
        await productsStore.insert(product as unknown as ProductDoc)
        seededProducts++
      }
    }

    const existingCategories = await categoriesStore.find({})
    let seededCategories = 0
    if (existingCategories.length === 0) {
      for (const category of SEED_CATEGORIES) {
        await categoriesStore.insert(category as unknown as CategoryDoc)
        seededCategories++
      }
    }

    server.log.info(
      `[Seed] products: ${seededProducts > 0 ? `inserted ${seededProducts}` : `skipped (${existingProducts.length} already present)`}, ` +
        `categories: ${seededCategories > 0 ? `inserted ${seededCategories}` : `skipped (${existingCategories.length} already present)`}`
    )
  }

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
    }
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

  // ─── Products ─────────────────────────────────────────────────────────────
  server.get<{ Querystring: { page?: string; limit?: string; category?: string; search?: string } }>(
    '/api/v1/products',
    {
      schema: {
        tags: ['products'],
        description:
          'List products (paginated). Supports ?page, ?limit, ?category (slug) and ?search (title/description).',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'string' },
            limit: { type: 'string' },
            category: { type: 'string' },
            search: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              products: { type: 'array', items: { type: 'object', additionalProperties: true } },
              total: { type: 'number' },
              page: { type: 'number' },
              limit: { type: 'number' },
            },
          },
        },
      },
    },
    async (req) => {
      const page = Math.max(parseInt(req.query.page ?? '1', 10) || 1, 1)
      const limit = Math.max(parseInt(req.query.limit ?? '20', 10) || 20, 1)
      const categorySlug = req.query.category
      const search = req.query.search?.toLowerCase().trim()

      let all = await productsStore.find({})

      if (categorySlug) {
        all = all.filter((p) => p.category?.slug === categorySlug)
      }
      if (search) {
        all = all.filter(
          (p) =>
            p.title?.toLowerCase().includes(search) || p.description?.toLowerCase().includes(search)
        )
      }

      const total = all.length
      const start = (page - 1) * limit
      const products = all.slice(start, start + limit)

      return { products, total, page, limit }
    }
  )

  server.get<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    {
      schema: {
        tags: ['products'],
        description: 'Fetch a single product by id.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          404: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (req, reply) => {
      const product = await productsStore.findOne({ id: req.params.id })
      if (!product) {
        return reply.status(404).send({ error: 'Product not found' })
      }
      return product
    }
  )

  server.post<{ Body: Partial<ProductDoc> }>(
    '/api/v1/products',
    {
      schema: {
        tags: ['products'],
        description: 'Create a new product.',
        body: { type: 'object', additionalProperties: true },
        response: {
          201: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (req, reply) => {
      const body = req.body ?? {}
      const id = (body.id as string | undefined) ?? `prod-${Date.now()}`
      const doc: ProductDoc = {
        id,
        title: body.title ?? 'Untitled Product',
        slug: body.slug ?? id,
        sku: body.sku ?? id.toUpperCase(),
        description: body.description ?? '',
        price: body.price ?? 0,
        compareAtPrice: body.compareAtPrice ?? body.price ?? 0,
        currency: body.currency ?? 'USD',
        stock: body.stock ?? 0,
        isAvailable: body.isAvailable ?? true,
        category: body.category ?? { id: '', name: '', slug: '' },
        tags: body.tags ?? [],
        images: body.images ?? [],
        attributes: body.attributes ?? [],
        ratings: body.ratings ?? { average: 0, count: 0 },
      }
      const created = await productsStore.insert(doc)
      return reply.status(201).send(created)
    }
  )

  server.patch<{ Params: { id: string }; Body: Partial<ProductDoc> }>(
    '/api/v1/products/:id',
    {
      schema: {
        tags: ['products'],
        description: 'Update fields on an existing product.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: { type: 'object', additionalProperties: true },
        response: {
          200: { type: 'object', additionalProperties: true },
          404: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (req, reply) => {
      const numUpdated = await productsStore.update({ id: req.params.id }, req.body ?? {})
      if (numUpdated === 0) {
        return reply.status(404).send({ error: 'Product not found' })
      }
      const updated = await productsStore.findOne({ id: req.params.id })
      return updated
    }
  )

  server.delete<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    {
      schema: {
        tags: ['products'],
        description: 'Delete a product by id.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: { type: 'object', properties: { success: { type: 'boolean' } } },
          404: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (req, reply) => {
      const numRemoved = await productsStore.delete({ id: req.params.id })
      if (numRemoved === 0) {
        return reply.status(404).send({ error: 'Product not found' })
      }
      return { success: true }
    }
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
                  additionalProperties: true,
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    icon: { type: 'string' },
                    description: { type: 'string' },
                    productCount: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const categories = await categoriesStore.find({})
      return { categories }
    }
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
    }
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
    }
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
