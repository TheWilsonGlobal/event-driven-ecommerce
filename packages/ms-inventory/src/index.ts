// MUST be first: loads .env before any module below reads process.env.
// See loadEnv.ts — import hoisting means no statement in this file's body
// can run before these imports, so the dotenv calls have to live in one.
import './loadEnv'
import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { loadDatabaseConfig, runMigrations } from '@ecommerce/shared-database'
import {
  registerMetrics,
  buildLoggerOptions,
  probeLokiReachable,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import { describeError, registerKafkaMetrics } from '@ecommerce/shared-messaging'
import { MIGRATIONS_DIR, createInventoryStore } from './db/store'
import { createInventoryOutboxRelay } from './outbox'
import { registerServiceRoutes } from './routes'
import { seedInventoryIfMissing } from './seed'
import { QueueManager, QUEUE_DEFINITIONS } from './queues'
import { createInventoryConsumer, eventProducer, kafkaAdminClient, kafkaSettings } from './events'
import { registerShutdownHandlers } from './shutdown'
import {
  assertPolicyCoverage,
  securityServerOptions,
  type SecurityHandle,
} from '@ecommerce/shared-security'
import { registerInventorySecurity } from './security'

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.INVENTORY_SERVICE_PORT || '5466', 10)

// Postgres is the only supported store: the one-transaction-per-event design
// (ledger + stock + reservation + outbox commit together) has no NeDB
// equivalent. Refuse to boot on a contradictory driver instead of quietly
// constructing a pool that cannot exist.
if (dbConfig.document.driver !== 'postgres') {
  throw new Error(
    `ms-inventory requires DOCUMENT_DB_DRIVER=postgres (got ${dbConfig.document.driver}).`
  )
}

// The inventory, reservations, processed_events and outbox_events tables in
// schema ms_inventory, owned exclusively by this service. Creating the store
// opens no connection; the pool connects lazily.
const store = createInventoryStore()

// Drains ms_inventory.outbox_events to Kafka. Constructed here (it validates
// the OUTBOX_* config and so fails fast on a bad lease/timeout pair) but only
// STARTED after the server is listening.
const outboxRelay = createInventoryOutboxRelay(store, eventProducer)

// BullMQ inventory-reconciliation queue. Constructs no Redis connection at all
// when KV_CACHE_DRIVER selects the embedded store — see QueueManager's
// constructor doc.
const queueManager = new QueueManager()

// The Kafka consumer. Constructed unconditionally because the constructor
// itself builds no client when KAFKA_ENABLED is not 'true' (see
// EventConsumer), and GET /api/v1/events still reports its groupId, topics and
// local counters in that state rather than pretending this service has no
// consumer.
const eventConsumer = createInventoryConsumer({ store, queueManager })

let server: FastifyInstance
let security: SecurityHandle

async function bootstrap() {
  // Schema before anything that can write to it. Awaited before the server
  // listens and, above all, before the consumer and the outbox relay start:
  // the first consumed event must find its tables. A failure is fatal -- a
  // consumer that cannot persist would otherwise ack events it drops.
  try {
    const migrated = await runMigrations('inventory', MIGRATIONS_DIR)
    console.log(
      `[Inventory Service] Migrations: applied [${migrated.applied.join(', ')}], ` +
        `already applied [${migrated.skipped.join(', ')}]`
    )
  } catch (err) {
    console.error(`[Inventory Service] Migration failed: ${(err as Error).message}`)
    process.exit(1)
  }

  const lokiHost = process.env.LOKI_HOST || 'http://localhost:3100'
  const lokiReachable =
    process.env.LOKI_ENABLED === 'false' ? false : await probeLokiReachable(lokiHost)

  server = fastify({
    ...securityServerOptions(),
    logger: buildLoggerOptions({ service: 'ms-inventory', lokiReachable }),
  })

  // FIRST, before any plugin or route: the policy hook only sees routes
  // registered after it, and the strict validator / error handler must be in
  // place for every route. Redis backs the rate limiter only when the KV driver
  // is Redis; otherwise a per-process store is used (not shared across replicas).
  security = await registerInventorySecurity(server, {
    redis: dbConfig.keyValue.driver === 'redis' ? dbConfig.keyValue.redis : null,
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

  // An allow-list from CORS_ORIGINS; empty means no cross-origin access at all
  // (never '*'). Bearer tokens travel in a header, so no credentials mode.
  await server.register(cors, {
    origin: security.config.corsOrigins.length > 0 ? security.config.corsOrigins : false,
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  })
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
        { name: 'outbox', description: 'Transactional outbox state and operator actions' },
        { name: 'queues', description: 'Live BullMQ queue introspection' },
        { name: 'endpoints', description: 'Live registered-route inventory' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })

  const seeded = await seedInventoryIfMissing(store)
  if (seeded > 0) {
    console.log(`[Inventory Service] Self-seeded stock for ${seeded} product(s)`)
  }

  registerServiceRoutes(server, { store, queueManager, eventConsumer, outboxRelay, dbConfig })
  registerEndpointsRoute(server, routeRegistry, 'ms-inventory')

  // Default deny, checked at boot outside production: a route someone adds
  // without a policy stops the service from starting instead of silently
  // answering 403 (or, in report mode, 200) to everyone.
  if (!security.config.production) assertPolicyCoverage(server)

  // Started after routes are registered, same ordering ms-product and ms-order
  // use: the worker begins pulling jobs only once the service is otherwise
  // ready.
  if (queueManager.queuesAvailable) {
    queueManager.startWorker(store)
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

  registerShutdownHandlers({
    server,
    queueManager,
    eventProducer,
    eventConsumer,
    outboxRelay,
    security,
  })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Inventory Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }

  // The relay starts after migrations (its table exists) and after listen()
  // (the API is up before any background work). start() only schedules a timer:
  // with Kafka disabled it idles and rows wait in `pending`; with the broker
  // down it backs off without spending the rows' attempt budget.
  outboxRelay.start()
  console.log(
    `[Inventory Service] Outbox relay started on ${store.schema}.outbox_events ` +
      `(${eventProducer.enabled ? 'Kafka enabled' : 'idle until KAFKA_ENABLED=true'})`
  )

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
