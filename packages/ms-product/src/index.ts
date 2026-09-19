import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import * as dotenv from 'dotenv'
import * as path from 'path'
import {
  loadDatabaseConfig,
  createRustFSClient,
  createDocumentStore,
  createSearchClient,
  type DocumentDatabaseAdapter,
} from '@ecommerce/shared-database'
import {
  registerMetrics,
  buildLoggerOptions,
  probeLokiReachable,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import type { ProductDoc, CategoryDoc } from './types'
import { registerSchemaRoutes, registerLogRoutes } from './diagnostics'
import {
  registerHealthRoutes,
  registerStorageRoutes,
  registerProductRoutes,
  registerCategoryRoutes,
  registerUploadRoutes,
} from './routes'
import { seedAndIndex } from './seed'
import { QueueManager } from './queues'
import { registerShutdownHandlers } from './shutdown'

const REPO_ROOT = path.resolve(__dirname, '../../../')
dotenv.config({ path: path.join(REPO_ROOT, '.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.PRODUCT_SERVICE_PORT || '5464', 10)

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

// Elasticsearch search index. NeDB below stays the source of truth — this only
// answers ?search=. It fails soft when the cluster is down (it sits behind a
// compose profile in infra-hub), so search degrades to a substring scan rather
// than erroring.
const search = createSearchClient(process.env)

// Real NeDB-backed document stores — one physical file per collection under
// the configured data path (e.g. data/db/products.db, data/db/categories.db).
const productsStore = createDocumentStore<ProductDoc>('products', dbConfig)
const categoriesStore = createDocumentStore<CategoryDoc>('categories', dbConfig)

// BullMQ reindex-search queue. Constructs no Redis connection at all when
// KV_CACHE_DRIVER selects the embedded store (this repo's default,
// DB_MODE=embedded) — see QueueManager's constructor doc.
const queueManager = new QueueManager()

// Checked once at boot, before the logger (and its Loki transport) is even
// constructed — an unreachable Loki then produces one quiet line here
// instead of a stack trace per log line for the life of the process.
let server: FastifyInstance

async function bootstrap() {
  const lokiHost = process.env.LOKI_HOST || 'http://localhost:3100'
  const lokiReachable =
    process.env.LOKI_ENABLED === 'false' ? false : await probeLokiReachable(lokiHost)

  server = fastify({
    logger: buildLoggerOptions({ service: 'ms-product', lokiReachable }),
  })

  // Before every other plugin, so the onResponse hook sees all traffic.
  registerMetrics(server, { service: 'ms-product' })

  // Before any route registration below — onRoute only fires for routes
  // registered after this hook is attached.
  const routeRegistry = createRouteRegistry(server)

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
        { name: 'schema', description: 'Live database schema introspection' },
        { name: 'logs', description: 'Real log file listing and reading' },
        { name: 'endpoints', description: 'Live registered-route inventory' },
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

  // Self-seed (first run only) and search-index backfill — see seed.ts for
  // the rationale behind running both unconditionally on every boot.
  await seedAndIndex(server, { productsStore, categoriesStore, search })

  registerHealthRoutes(server, { dbConfig, search })
  registerStorageRoutes(server, { rustfs })
  registerProductRoutes(server, { productsStore, search, queueManager })
  registerCategoryRoutes(server, { categoriesStore })
  registerUploadRoutes(server, { rustfs })

  // Started after routes are registered, same ordering ms-order uses: the
  // worker begins pulling jobs only once the service is otherwise ready.
  queueManager.startWorker(productsStore, search)

  registerSchemaRoutes(server, [
    {
      name: 'products',
      store: productsStore as unknown as DocumentDatabaseAdapter<Record<string, unknown>>,
    },
    {
      name: 'categories',
      store: categoriesStore as unknown as DocumentDatabaseAdapter<Record<string, unknown>>,
    },
  ])
  registerLogRoutes(server)
  registerEndpointsRoute(server, routeRegistry, 'ms-product')

  registerShutdownHandlers({ server, queueManager })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Product Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
