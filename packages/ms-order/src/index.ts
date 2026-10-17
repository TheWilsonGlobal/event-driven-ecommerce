// MUST be first: loads .env before any module below reads process.env.
// See loadEnv.ts — import hoisting means no statement in this file's body
// can run before these imports, so the dotenv calls have to live in one.
import { REPO_ROOT } from './loadEnv'
import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import * as path from 'path'
import { PrismaClient } from '../node_modules/.prisma-ms-order/client'
import { createKeyValueStore, loadDatabaseConfig } from '@ecommerce/shared-database'
import { seedOrdersIfEmpty } from './seedOrders'
import { QueueManager, registerQueueRoutes, QUEUE_DEFINITIONS, redisEnabled } from './queues'
import {
  registerMetrics,
  buildLoggerOptions,
  probeLokiReachable,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import { registerSchemaRoutes, registerLogRoutes } from './diagnostics'
import { registerSwagger } from './bootstrap/swagger'
import { registerOrderRoutes } from './routes/orders'
import { registerPaymentRoutes } from './routes/payments'
import { registerCartRoutes } from './routes/cart'
import { registerShutdownHandlers } from './shutdown'
import { createOrderRelay, registerOutboxRoutes } from './outbox'
import { checkKafkaHealth, registerKafkaMetrics } from '@ecommerce/shared-messaging'
import {
  eventProducer,
  kafkaAdminClient,
  kafkaSettings,
  registerEventRoutes,
  stageOrderCancelled,
} from './events'

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.ORDER_SERVICE_PORT || '5465', 10)

// Relative KV paths are written from the repo root, but this process runs in
// packages/ms-order — without this, './data/rocksdb' would land in
// packages/ms-order/data/. Mirrors what ms-product does for its NeDB path.
if (!path.isAbsolute(dbConfig.keyValue.embedded.dataPath)) {
  dbConfig.keyValue.embedded.dataPath = path.resolve(REPO_ROOT, dbConfig.keyValue.embedded.dataPath)
}

const prisma = new PrismaClient()

// Drains outbox_events to Kafka (pattern 1) with SKIP LOCKED + a lease (pattern 3).
// Constructed here so a bad OUTBOX_* config fails the boot, started after listen.
const outboxRelay = createOrderRelay(eventProducer)

// The embedded store is only constructed when it is the active driver, so the
// Redis path does not create a file it never reads.
const kvStore = redisEnabled ? undefined : createKeyValueStore(dbConfig)

// BullMQ queues + workers. Construction never throws and never blocks on a
// connection, so ms-order boots and serves the order API even when Redis is
// down; the queue endpoints report 503 instead of pretending to be empty.
//
// On the embedded driver no Redis connection is created at all — otherwise the
// process would open sockets retrying forever against a Redis that is
// deliberately not running — and the queue endpoints report kv_driver_not_redis.
const queueManager = new QueueManager(prisma, redisEnabled, kvStore)

// Checked once at boot, before the logger (and its Loki transport) is even
// constructed — an unreachable Loki then produces one quiet line here
// instead of a stack trace per log line for the life of the process.
let server: FastifyInstance

async function bootstrap() {
  const lokiHost = process.env.LOKI_HOST || 'http://localhost:3100'
  const lokiReachable =
    process.env.LOKI_ENABLED === 'false' ? false : await probeLokiReachable(lokiHost)

  server = fastify({
    logger: buildLoggerOptions({ service: 'ms-order', lokiReachable }),
  })

  await seedOrdersIfEmpty(prisma)

  // Before every other plugin, so the onResponse hook sees all traffic.
  const metrics = registerMetrics(server, { service: 'ms-order' })

  // Event-backbone series on the SAME registry, so one scrape of /metrics
  // carries both. ms-order publishes but does not consume, so this contributes
  // topic counters and partition counts; the lag series come from the two
  // consumer services. See §6.6 of the implementation report.
  registerKafkaMetrics({
    registry: metrics.registry,
    service: 'ms-order',
    producer: eventProducer,
    kafka: kafkaAdminClient,
  })

  // Before any route registration below — onRoute only fires for routes
  // registered after this hook is attached.
  const routeRegistry = createRouteRegistry(server)

  await server.register(cors, { origin: '*' })
  await server.register(helmet)

  await registerSwagger(server, PORT)

  server.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        description: 'Service liveness/status check, including database/queue driver.',
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
                  queue: { type: 'string' },
                  reachable: { type: 'boolean' },
                  latencyMs: { type: ['number', 'null'] },
                  error: { type: 'string' },
                },
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
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
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
      if (!dbReachable) reply.status(503)
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
          ...(dbError ? { error: dbError } : {}),
        },
        events: await checkKafkaHealth(
          kafkaAdminClient,
          kafkaSettings.brokers,
          kafkaSettings.enabled
        ),
      }
    }
  )

  registerOrderRoutes(server, { prisma, queueManager })
  registerPaymentRoutes(server, { prisma, queueManager })

  registerQueueRoutes(server, queueManager)
  registerEventRoutes(server, { repoRoot: REPO_ROOT })
  registerOutboxRoutes(server, outboxRelay)
  registerSchemaRoutes(server, prisma)
  registerLogRoutes(server)

  registerCartRoutes(server)

  try {
    const seededCount = await seedOrdersIfEmpty(prisma)
    if (seededCount > 0) {
      console.log(`[Order Service] Self-seeded ${seededCount} orders (orders table was empty)`)
    }
  } catch (err) {
    server.log.error(err, '[Order Service] Failed to self-seed orders')
  }

  // Workers attach to Redis lazily; if Redis is down they sit reconnecting
  // (with an 'error' handler attached) and the service still serves HTTP.
  if (redisEnabled) {
    queueManager.startWorkers({
      // An expiry that actually cancels an order stages the fact in the same
      // transaction, so ms-inventory can release what it reserved.
      onOrderCancelled: async (tx, data) => {
        await stageOrderCancelled(tx, data)
      },
    })
    console.log(
      `[Order Service] BullMQ workers started for: ${QUEUE_DEFINITIONS.map((q) => q.name).join(', ')}`
    )
  } else {
    const info = queueManager.keyValueInfo()
    // eslint-disable-next-line no-console
    console.warn(
      `[Order Service] KV driver is "${dbConfig.keyValue.driver}" (${info.label}); ` +
        `BullMQ workers are disabled and the queue endpoints will report ` +
        `kv_driver_not_redis. Snapshot: ${info.dataPath ?? 'in-memory'}`
    )
  }

  // Kafka is OPTIONAL and off by default. Say which state we are in at boot,
  // so "no events are appearing" is diagnosable from the log alone.
  if (kafkaSettings.enabled) {
    console.log(
      `[Order Service] Kafka event publishing ENABLED -> ${kafkaSettings.brokers.join(', ')}`
    )
  } else {
    console.log(
      '[Order Service] Kafka event publishing DISABLED (set KAFKA_ENABLED=true to enable); ' +
        'GET /api/v1/events reports enabled:false'
    )
  }

  registerEndpointsRoute(server, routeRegistry, 'ms-order')

  registerShutdownHandlers({ server, queueManager, kvStore, prisma, eventProducer, outboxRelay })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Order Service] Listening on http://localhost:${PORT}`)
    outboxRelay.start()
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
