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
import { MIGRATIONS_DIR, createAnalyticsStore } from './aggregates/store'
import { createAnalyticsConsumer, eventProducer, kafkaAdminClient, kafkaSettings } from './events'
import { registerKafkaMetrics } from '@ecommerce/shared-messaging'
import { registerServiceRoutes } from './routes'
import { registerShutdownHandlers } from './shutdown'
import {
  assertPolicyCoverage,
  securityServerOptions,
  type SecurityHandle,
} from '@ecommerce/shared-security'
import { registerAnalyticsSecurity } from './security'
import { RankingEngine } from './rankings/engine'
import { createRankRedis } from './rankings/redis'

/**
 * ms-analytics — the PURE CONSUMER that demonstrates fan-out.
 *
 * ── What makes this service the proof ───────────────────────────────────────
 * It consumes all three topics, writes only to its own Postgres schema (ms_analytics), and
 * publishes NOTHING. No other service reads what it writes; no other service
 * knows it exists. It has no BullMQ queue, because it does no deferred work —
 * an aggregate update is cheap, synchronous and idempotent, so there is
 * nothing to defer and nothing to retry.
 *
 * That combination is why adding it is a ZERO-RISK change to every existing
 * service. It joins on its own consumer group (CONSUMER_GROUPS.analytics), so
 * Kafka hands it its own full copy of every event rather than splitting the
 * partitions with ms-inventory. ms-order's publish path is untouched: it
 * already published these events, to a log that does not care how many readers
 * it has. Nothing upstream got a new dependency, a new failure mode, or even a
 * new line of code. If ms-analytics crashes, falls behind, or is deleted
 * outright, the only thing that changes is that these aggregates stop
 * advancing — checkout, payment and stock are structurally unaffected.
 *
 * That is the property the event backbone exists to buy, and this service is
 * the smallest honest demonstration of it.
 *
 * ── Boots with Kafka down ───────────────────────────────────────────────────
 * KAFKA_ENABLED defaults to false. In that state no Kafka client is
 * constructed at all, the consumer never starts, and every analytics route
 * still answers from Postgres — reporting empty aggregates with
 * `eventsProcessed: 0` and `lastEventAt: null`, which says "nothing processed"
 * rather than "all values are zero". Nothing here throws at construction.
 */

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.ANALYTICS_SERVICE_PORT || '5467', 10)

// Postgres is the only supported store: the transactional idempotency design
// (one transaction per event) has no NeDB equivalent. Refuse to boot on a
// contradictory driver instead of quietly constructing a pool that cannot exist.
if (dbConfig.document.driver !== 'postgres') {
  throw new Error(
    `ms-analytics requires DOCUMENT_DB_DRIVER=postgres (got ${dbConfig.document.driver}).`
  )
}

// The six aggregate tables in schema ms_analytics, owned exclusively by this
// service. Creating the store opens no connection; the pool connects lazily.
const store = createAnalyticsStore()

// Consumer construction opens nothing and never throws; with KAFKA_ENABLED
// unset it does not even build a Kafka client. start() is called at the end of
// bootstrap, after the HTTP server is listening.
// Real-time sales rank engine: only when the KV driver is Redis. Otherwise the
// rankings endpoints answer from Postgres and say so (source: postgres).
const rankings =
  dbConfig.keyValue.driver === 'redis'
    ? new RankingEngine(createRankRedis(dbConfig.keyValue.redis), store, {
        log: (m) => console.log(`[Analytics Service] ${m}`),
      })
    : undefined
const consumer = createAnalyticsConsumer(store, rankings)

let server: FastifyInstance
let security: SecurityHandle

async function bootstrap() {
  // Schema before anything that can write to it. Awaited before the server
  // listens and, above all, before consumer.start() below: the first consumed
  // event must find its tables. A failure is fatal — a consumer that cannot
  // persist would otherwise ack events it drops.
  try {
    const migrated = await runMigrations('analytics', MIGRATIONS_DIR)
    console.log(
      `[Analytics Service] Migrations: applied [${migrated.applied.join(', ')}], ` +
        `already applied [${migrated.skipped.join(', ')}]`
    )
  } catch (err) {
    console.error(`[Analytics Service] Migration failed: ${(err as Error).message}`)
    process.exit(1)
  }

  const lokiHost = process.env.LOKI_HOST || 'http://localhost:3100'
  // Checked once at boot, before the logger (and its Loki transport) is even
  // constructed — an unreachable Loki then produces one quiet line here
  // instead of a stack trace per log line for the life of the process.
  const lokiReachable =
    process.env.LOKI_ENABLED === 'false' ? false : await probeLokiReachable(lokiHost)

  server = fastify({
    ...securityServerOptions(),
    logger: buildLoggerOptions({ service: 'ms-analytics', lokiReachable }),
  })

  // FIRST, before any plugin or route: the policy hook only sees routes
  // registered after it, and the strict validator / error handler must be in
  // place for every route. Redis backs the rate limiter only when the KV driver
  // is Redis; otherwise a per-process store is used (not shared across replicas).
  security = await registerAnalyticsSecurity(server, {
    redis: dbConfig.keyValue.driver === 'redis' ? dbConfig.keyValue.redis : null,
  })

  // Before every other plugin, so the onResponse hook sees all traffic.
  const metrics = registerMetrics(server, { service: 'ms-analytics' })

  // Event-backbone series on the SAME registry, so one scrape of /metrics
  // carries both. This service publishes nothing, so its contribution is
  // entirely consumer-side: group state, counters, and the lag gauge that
  // §6.6 of the implementation report called out as unalerted.
  registerKafkaMetrics({
    registry: metrics.registry,
    service: 'ms-analytics',
    producer: eventProducer,
    consumers: [consumer],
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
        title: 'Analytics Service',
        description:
          'Read-only aggregation over the Kafka event backbone. Consumes orders, ' +
          'payments and inventory events; publishes nothing.',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      tags: [
        { name: 'health', description: 'Service health and status' },
        { name: 'analytics', description: 'Aggregated order, revenue and funnel views' },
        { name: 'events', description: 'Kafka event-backbone introspection' },
        { name: 'endpoints', description: 'Live registered-route inventory' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })

  registerServiceRoutes(server, { dbConfig, consumer, store, rankings })
  registerEndpointsRoute(server, routeRegistry, 'ms-analytics')

  // Default deny, checked at boot outside production: a route someone adds
  // without a policy stops the service from starting instead of silently
  // answering 403 (or, in report mode, 200) to everyone.
  if (!security.config.production) assertPolicyCoverage(server)

  registerShutdownHandlers({ server, consumer, producer: eventProducer, security, rankings })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Analytics Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }

  // Warm the rank ZSETs (rebuilds from Postgres when the keys are missing).
  // Background and non-fatal: the endpoints fall back to Postgres meanwhile.
  void rankings?.ensureReady().catch((err: Error) => {
    console.warn(`[Analytics Service] Rank warm-up failed: ${err.message}`)
  })

  // Started only AFTER the server is listening. start() never throws and
  // returns false when the broker is unreachable, so an outage costs this
  // service a stale view — not its HTTP surface. kafkajs then reconnects in
  // the background and the loop self-heals without a restart.
  if (kafkaSettings.enabled) {
    const started = await consumer.start()
    if (started) {
      console.log(
        `[Analytics Service] Consuming ${consumer.topics.join(', ')} ` +
          `as group "${consumer.groupId}" (fromBeginning on first run)`
      )
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[Analytics Service] Kafka is ENABLED but the consumer could not start ` +
          `(${kafkaSettings.brokers.join(', ')}). Analytics routes still serve the ` +
          `aggregates built so far; GET /api/v1/events reports the failure.`
      )
    }
  } else {
    console.log(
      '[Analytics Service] Kafka event consumption DISABLED (set KAFKA_ENABLED=true ' +
        'to enable); GET /api/v1/events reports enabled:false and the aggregates ' +
        'will not advance'
    )
  }
}

bootstrap()
