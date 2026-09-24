// MUST be first: loads .env before any module below reads process.env.
// See loadEnv.ts — import hoisting means no statement in this file's body
// can run before these imports, so the dotenv calls have to live in one.
import { REPO_ROOT } from './loadEnv'
import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import * as path from 'path'
import { loadDatabaseConfig, createDocumentStore } from '@ecommerce/shared-database'
import {
  registerMetrics,
  buildLoggerOptions,
  probeLokiReachable,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import {
  checkKafkaHealth,
  describeError,
  registerKafkaMetrics,
  type KafkaHealth,
} from '@ecommerce/shared-messaging'
import type { InventoryDoc, ProcessedEventDoc, ReservationDoc } from './types'
import { registerInventoryRoutes } from './routes/inventory'
import { seedInventoryIfMissing } from './seed'
import { QueueManager, registerQueueRoutes, QUEUE_DEFINITIONS } from './queues'
import {
  createInventoryConsumer,
  registerEventRoutes,
  eventProducer,
  kafkaAdminClient,
  kafkaSettings,
} from './events'
import { registerShutdownHandlers } from './shutdown'

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.INVENTORY_SERVICE_PORT || '5466', 10)

// NEDB_DATA_PATH (e.g. "./data/db") is relative-by-convention to the repo root
// — same as how the .env file itself is located above — not to whatever
// directory the process happens to be launched from (pnpm/nodemon run this
// with cwd = packages/ms-inventory, which would otherwise silently nest the
// real data files under packages/ms-inventory/data/db). Same fix ms-product
// applies for the same reason.
if (!path.isAbsolute(dbConfig.document.nedb.dataPath)) {
  dbConfig.document.nedb.dataPath = path.resolve(REPO_ROOT, dbConfig.document.nedb.dataPath)
}

// Real NeDB-backed document stores — one physical file per collection under
// the configured data path (data/db/inventory.db, reservations.db,
// processed_events.db). NeDB rather than Prisma deliberately: a Prisma client
// would need a package-local .env holding its own DATABASE_URL, which is
// gitignored and is repeatedly lost when directories move.
const inventoryStore = createDocumentStore<InventoryDoc>('inventory', dbConfig)
const reservationsStore = createDocumentStore<ReservationDoc>('reservations', dbConfig)
const processedEventsStore = createDocumentStore<ProcessedEventDoc>('processed_events', dbConfig)

// BullMQ inventory-reconciliation queue. Constructs no Redis connection at all
// when KV_CACHE_DRIVER selects the embedded store — see QueueManager's
// constructor doc.
const queueManager = new QueueManager()

// The Kafka consumer. Constructed unconditionally because the constructor
// itself builds no client when KAFKA_ENABLED is not 'true' (see
// EventConsumer), and GET /api/v1/events still reports its groupId, topics and
// local counters in that state rather than pretending this service has no
// consumer.
const eventConsumer = createInventoryConsumer({
  inventoryStore,
  reservationsStore,
  processedEventsStore,
  queueManager,
})

/**
 * Ceiling on how long /health will wait for a Kafka reading.
 *
 * Slightly above the client's 3s connectionTimeout, so a broker that is merely
 * slow still gets to answer and produce a real cached reading.
 */
const HEALTH_PROBE_BUDGET_MS = 4000

/**
 * checkKafkaHealth with a hard deadline.
 *
 * The shared helper caches for ~10s and collapses concurrent probes, which is
 * what keeps a steady-state /health fast. What it does not do is bound the
 * FIRST probe: it awaits admin.connect(), and createKafkaClient configures
 * effectively infinite retries (`retries: MAX_SAFE_INTEGER`) so that the
 * service self-heals when the broker returns. Against a broker that is down,
 * that connect neither resolves nor rejects — measured still-pending at 20s —
 * so the first /health after boot would hang indefinitely.
 *
 * That is precisely the failure ms-product's Elasticsearch incident warns
 * about, in its worst form: a liveness probe blocking makes a
 * degraded-but-serving service look dead to whatever is probing it. So the
 * probe races a timer, and losing the race reports `reachable: false` with
 * reason `kafka_timeout` — which is the honest reading. It is NOT claimed as a
 * measured success, and the underlying probe is left running so its result
 * populates the shared cache for the next call.
 */
async function kafkaHealthBounded(): Promise<KafkaHealth> {
  const fallback: KafkaHealth = {
    enabled: kafkaSettings.enabled,
    reachable: false,
    brokers: kafkaSettings.brokers,
    reason: 'kafka_timeout',
    cachedAgeMs: 0,
  }

  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      checkKafkaHealth(kafkaAdminClient, kafkaSettings.brokers, kafkaSettings.enabled),
      new Promise<KafkaHealth>((resolve) => {
        timer = setTimeout(() => resolve(fallback), HEALTH_PROBE_BUDGET_MS)
      }),
    ])
  } finally {
    // Otherwise the pending timer keeps the event loop alive and delays
    // shutdown by up to the budget on every /health that won the race.
    if (timer) {
      clearTimeout(timer)
    }
  }
}

let server: FastifyInstance

async function bootstrap() {
  const lokiHost = process.env.LOKI_HOST || 'http://localhost:3100'
  const lokiReachable =
    process.env.LOKI_ENABLED === 'false' ? false : await probeLokiReachable(lokiHost)

  server = fastify({
    logger: buildLoggerOptions({ service: 'ms-inventory', lokiReachable }),
  })

  // Before every other plugin, so the onResponse hook sees all traffic.
  const metrics = registerMetrics(server, { service: 'ms-inventory' })

  // Event-backbone series on the SAME registry, so one scrape of /metrics
  // carries both. This is the service whose consumer lag was observable but
  // unalerted (§6.6 of the implementation report) — the gauge is ABSENT rather
  // than 0 when lag cannot be measured, so `absent()` is alertable.
  registerKafkaMetrics({
    registry: metrics.registry,
    service: 'ms-inventory',
    producer: eventProducer,
    consumers: [eventConsumer],
    kafka: kafkaAdminClient,
  })

  // Before any route registration below — onRoute only fires for routes
  // registered after this hook is attached.
  const routeRegistry = createRouteRegistry(server)

  await server.register(cors, { origin: '*' })
  await server.register(helmet)

  await server.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Inventory Service',
        description:
          'Stock reservation service. Consumes order events from the Kafka backbone, ' +
          'reserves and releases stock all-or-nothing, and publishes inventory facts ' +
          'keyed per product.',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      tags: [
        { name: 'health', description: 'Service health and status' },
        { name: 'inventory', description: 'Stock levels' },
        { name: 'reservations', description: 'Per-order stock holds' },
        { name: 'events', description: 'Kafka event-backbone introspection' },
        { name: 'queues', description: 'Live BullMQ queue introspection' },
        { name: 'endpoints', description: 'Live registered-route inventory' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })

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
                  // The consume loop's own state, which broker reachability
                  // does not imply: a reachable broker with a consumer that
                  // failed to start is exactly the silent-stall case /health
                  // needs to expose.
                  consumerRunning: { type: 'boolean' },
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
        service: 'ms-inventory',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.document.driver,
          queue: dbConfig.keyValue.driver,
        },
        events: {
          ...(await kafkaHealthBounded()),
          consumerRunning: eventConsumer.isRunning,
        },
      }
    }
  )

  const seeded = await seedInventoryIfMissing(inventoryStore)
  if (seeded > 0) {
    console.log(`[Inventory Service] Self-seeded stock for ${seeded} product(s)`)
  }

  registerInventoryRoutes(server, { inventoryStore, reservationsStore })
  registerQueueRoutes(server, queueManager)
  registerEventRoutes(server, eventConsumer)
  registerEndpointsRoute(server, routeRegistry, 'ms-inventory')

  // Started after routes are registered, same ordering ms-product and ms-order
  // use: the worker begins pulling jobs only once the service is otherwise
  // ready.
  if (queueManager.queuesAvailable) {
    queueManager.startWorker(inventoryStore, reservationsStore)
    console.log(
      `[Inventory Service] BullMQ workers started for: ${QUEUE_DEFINITIONS.map((q) => q.name).join(', ')}`
    )
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[Inventory Service] KV driver is "${dbConfig.keyValue.driver}"; BullMQ workers are ` +
        `disabled and the queue endpoints will report kv_driver_not_redis. Reservations ` +
        `still work, but they get no expiry timer.`
    )
  }

  registerShutdownHandlers({ server, queueManager, eventProducer, eventConsumer })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Inventory Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }

  // Kafka last, AFTER listen(), and deliberately NOT awaited.
  //
  // start() is documented as never throwing on an unreachable broker, and it
  // does not — but it also never RESOLVES against one. createKafkaClient sets
  // `retries: Number.MAX_SAFE_INTEGER` with `restartOnFailure: () => true` so
  // the consumer self-heals when the broker returns; the cost of that choice
  // is that the underlying consumer.connect() retries forever rather than
  // rejecting. Measured against a dead broker: still pending after 30s, with
  // no rejection.
  //
  // Awaiting it therefore parks this function permanently, and everything that
  // shares the kafkajs broker pool — including /health's own admin probe —
  // queues behind that retry chain. That is how a liveness check on a
  // degraded-but-serving service ended up hanging past 35s instead of
  // answering in ~3ms from checkKafkaHealth's cache. Firing it and letting it
  // resolve whenever the broker comes back is the behaviour the retry config
  // was designed for.
  if (kafkaSettings.enabled) {
    void eventConsumer
      .start()
      .then((started) => {
        if (started) {
          console.log(
            `[Inventory Service] Kafka consumer "${eventConsumer.groupId}" running on ` +
              `${eventConsumer.topics.join(', ')} -> ${kafkaSettings.brokers.join(', ')}`
          )
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[Inventory Service] Kafka consumer failed to start; retrying in the ` +
              `background. GET /api/v1/events reports the live state.`
          )
        }
      })
      .catch((err: unknown) => {
        // start() catches its own errors, so this is belt-and-braces only.
        // eslint-disable-next-line no-console
        console.warn(`[Inventory Service] Kafka consumer start rejected: ${describeError(err)}`)
      })
    console.log(
      `[Inventory Service] Kafka ENABLED -> ${kafkaSettings.brokers.join(', ')}; consumer ` +
        `"${eventConsumer.groupId}" connecting in the background`
    )
  } else {
    console.log(
      '[Inventory Service] Kafka DISABLED (set KAFKA_ENABLED=true to enable); no consumer ' +
        'is running and GET /api/v1/events reports enabled:false'
    )
  }
}

bootstrap()
