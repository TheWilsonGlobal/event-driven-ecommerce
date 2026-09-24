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
import { loadDatabaseConfig } from '@ecommerce/shared-database'
import {
  registerMetrics,
  buildLoggerOptions,
  probeLokiReachable,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import { createAnalyticsStore } from './aggregates/store'
import {
  createAnalyticsConsumer,
  eventProducer,
  kafkaAdminClient,
  kafkaSettings,
  registerEventRoutes,
} from './events'
import { registerKafkaMetrics } from '@ecommerce/shared-messaging'
import { registerAnalyticsRoutes, registerHealthRoutes } from './routes'
import { registerShutdownHandlers } from './shutdown'

/**
 * ms-analytics — the PURE CONSUMER that demonstrates fan-out.
 *
 * ── What makes this service the proof ───────────────────────────────────────
 * It consumes all three topics, writes only to its own NeDB collections, and
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
 * still answers from NeDB — reporting empty aggregates with
 * `eventsProcessed: 0` and `lastEventAt: null`, which says "nothing processed"
 * rather than "all values are zero". Nothing here throws at construction.
 */

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.ANALYTICS_SERVICE_PORT || '5467', 10)

// NEDB_DATA_PATH (e.g. "./data/db") is relative-by-convention to the repo
// root — same as how the .env file itself is located above — not to whatever
// directory the process happens to be launched from. Without this, pnpm/nodemon
// running with cwd = packages/ms-analytics would silently nest the real data
// files under packages/ms-analytics/data/db. Same fix ms-product applies.
if (!path.isAbsolute(dbConfig.document.nedb.dataPath)) {
  dbConfig.document.nedb.dataPath = path.resolve(REPO_ROOT, dbConfig.document.nedb.dataPath)
}

// The six aggregate collections. File-backed, loaded lazily on first access,
// and owned exclusively by this service — nothing else reads or writes them.
const store = createAnalyticsStore(dbConfig)

// Consumer construction opens nothing and never throws; with KAFKA_ENABLED
// unset it does not even build a Kafka client. start() is called at the end of
// bootstrap, after the HTTP server is listening.
const consumer = createAnalyticsConsumer(store)

let server: FastifyInstance

async function bootstrap() {
  const lokiHost = process.env.LOKI_HOST || 'http://localhost:3100'
  // Checked once at boot, before the logger (and its Loki transport) is even
  // constructed — an unreachable Loki then produces one quiet line here
  // instead of a stack trace per log line for the life of the process.
  const lokiReachable =
    process.env.LOKI_ENABLED === 'false' ? false : await probeLokiReachable(lokiHost)

  server = fastify({
    logger: buildLoggerOptions({ service: 'ms-analytics', lokiReachable }),
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

  await server.register(cors, { origin: '*' })
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

  registerHealthRoutes(server, { dbConfig, consumer })
  registerAnalyticsRoutes(server, { store })
  registerEventRoutes(server, consumer)
  registerEndpointsRoute(server, routeRegistry, 'ms-analytics')

  registerShutdownHandlers({ server, consumer, producer: eventProducer })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Analytics Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }

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
