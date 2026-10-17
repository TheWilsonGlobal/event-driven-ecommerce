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
  createServiceDocumentStore,
  createSearchClient,
  type DocumentDatabaseAdapter,
} from '@ecommerce/shared-database'
import {
  assertPolicyCoverage,
  registerSecurity,
  securityServerOptions,
} from '@ecommerce/shared-security'
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
import { Counter } from 'prom-client'
import { ProductCache, createCacheRedis } from './cache/productCache'
import { QueueManager, registerQueueRoutes } from './queues'
import {
  SERVICE_CSP,
  applySharedRoutePolicies,
  corsOriginCheck,
  relaxUpgradeInsecure,
  resolveCorsOrigins,
  searchConstraint,
} from './security'
import { MULTIPART_LIMITS } from './routes/uploads'
import { registerShutdownHandlers } from './shutdown'

const REPO_ROOT = path.resolve(__dirname, '../../../')
dotenv.config({ path: path.join(REPO_ROOT, '.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.PRODUCT_SERVICE_PORT || '5464', 10)

// Initialise the RustFS client (singleton per process)
const rustfs = createRustFSClient(process.env)

// Elasticsearch search index. Postgres below stays the source of truth — this
// only answers ?search=. It fails soft when the cluster is down (it sits behind
// a compose profile in infra-hub), so search degrades to a substring scan
// rather than erroring.
const search = createSearchClient(process.env)

// Postgres-backed document stores in schema ms_product (tables "products" and
// "categories", created on first use by the shared jsonb shim). The factory
// falls back to the embedded NeDB store only while DOCUMENT_DB_DRIVER=nedb,
// which the plan removes at cutover.
const productsStore = createServiceDocumentStore<ProductDoc>('product', 'products', dbConfig)
const categoriesStore = createServiceDocumentStore<CategoryDoc>('product', 'categories', dbConfig)

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
    // Body/request limits, timeouts and trustProxy (TRUST_PROXY) come from the
    // shared defaults; the upload routes raise their own bodyLimit explicitly.
    ...securityServerOptions(),
    // Lets GET /products?search= resolve to its own, stricter rate-limit tier.
    constraints: { hasSearch: searchConstraint },
    logger: buildLoggerOptions({ service: 'ms-product', lokiReachable }),
  })

  // Before any route registration below — onRoute only fires for routes
  // registered after this hook is attached.
  const routeRegistry = createRouteRegistry(server)

  // CORS and helmet first, so even a 401/429 rejection carries their headers.
  await server.register(cors, {
    origin: corsOriginCheck(resolveCorsOrigins()),
    credentials: true,
    exposedHeaders: [
      'retry-after',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
    maxAge: 600,
  })
  await server.register(helmet, { contentSecurityPolicy: SERVICE_CSP })

  // Policies for the routes shared-utils installs (/metrics, /api/v1/endpoints);
  // before registerSecurity so its onRoute hook records them.
  applySharedRoutePolicies(server)

  // Error shape, strict validation, rate limit, JWT verification and the policy
  // hook. Rate-limit counters live in Redis when the KV driver is Redis (shared
  // across replicas); otherwise a per-process memory store.
  const security = await registerSecurity(server, {
    service: 'ms-product',
    redis: dbConfig.keyValue.driver === 'redis' ? dbConfig.keyValue.redis : null,
  })
  server.addHook('onClose', async () => {
    await security.close()
  })

  // After registerSecurity so the metrics hook sits behind the rate limiter's.
  const metrics = registerMetrics(server, { service: 'ms-product' })

  // Cache-aside for GET /products/:id. Redis only when the KV driver is Redis; any
  // other driver (embedded/rocksdb) means direct reads with the single-flight map.
  const cacheResults = new Counter({
    name: 'product_cache_requests_total',
    help: 'GET /products/:id lookups by cache outcome (hit, miss, coalesced, bypass).',
    labelNames: ['result'],
    registers: [metrics.registry],
  })
  for (const result of ['hit', 'miss', 'coalesced', 'bypass']) cacheResults.inc({ result }, 0)
  const cacheLog = { warn: (m: string) => server.log.warn(m) }
  const productCache = new ProductCache<ProductDoc>({
    redis:
      dbConfig.keyValue.driver === 'redis'
        ? createCacheRedis(dbConfig.keyValue.redis, cacheLog)
        : null,
    counter: cacheResults,
    log: cacheLog,
  })
  server.addHook('onClose', async () => {
    await productCache.close()
  })

  await server.register(multipart, { limits: MULTIPART_LIMITS })

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
        { name: 'queues', description: 'Live BullMQ queue introspection' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    // The service-wide CSP loads nothing; the UI's static routes get the plugin's
    // own policy ('self' plus hashes of its inline bits) instead.
    staticCSP: true,
    transformStaticCSP: relaxUpgradeInsecure,
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
  registerProductRoutes(server, { productsStore, search, queueManager, cache: productCache })
  registerCategoryRoutes(server, { categoriesStore })
  registerUploadRoutes(server, { rustfs })
  registerQueueRoutes(server, queueManager)

  // Started after routes are registered, same ordering ms-order uses: the
  // worker begins pulling jobs only once the service is otherwise ready.
  queueManager.startWorker(productsStore, search)

  registerSchemaRoutes(
    server,
    [
      {
        name: 'products',
        store: productsStore as unknown as DocumentDatabaseAdapter<Record<string, unknown>>,
      },
      {
        name: 'categories',
        store: categoriesStore as unknown as DocumentDatabaseAdapter<Record<string, unknown>>,
      },
    ],
    dbConfig.document.driver === 'postgres' ? 'PostgreSQL (jsonb)' : 'Embedded NeDB'
  )
  registerLogRoutes(server)
  registerEndpointsRoute(server, routeRegistry, 'ms-product')

  // Default deny: refuse to boot (outside production) if any route above was
  // added without a `config.policy`.
  if (!security.config.production) assertPolicyCoverage(server)

  registerShutdownHandlers({
    server,
    queueManager,
    closeDatabase: dbConfig.document.driver === 'postgres',
  })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Product Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
