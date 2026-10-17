import type { FastifyInstance } from 'fastify'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { buildLoggerOptions, probeLokiReachable } from '@ecommerce/shared-utils'
import { buildGateway } from './app'
import { redisFromEnv, resolveCorsOrigins } from './security'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

// Checked once at boot, before the logger (and its Loki transport) is even
// constructed — an unreachable Loki then produces one quiet line here
// instead of a stack trace per log line for the life of the process.
let server: FastifyInstance

// API_GATEWAY_PORT is the name .env documents; PORT / PORT_GATEWAY stay as the
// older spellings so existing launch scripts keep working.
const PORT = parseInt(
  process.env.PORT || process.env.PORT_GATEWAY || process.env.API_GATEWAY_PORT || '5460',
  10
)
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://127.0.0.1:5463'
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://127.0.0.1:5464'
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://127.0.0.1:5465'
// Event-backbone consumers. Both are OPTIONAL services: they consume Kafka and
// serve their own read APIs, so the gateway proxies to them when they are
// running and the health rollup reports them down when they are not -- exactly
// as it already does for the other three.
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://127.0.0.1:5466'
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://127.0.0.1:5467'

// The two frontends have no proxy route (nothing here forwards traffic to
// them), so unlike the three URLs above there is no existing env var for
// their full origin -- only a bare port. Built the same way here as
// everywhere a *_PORT-only value needs to become a dialable origin.
const ADMIN_URL = `http://127.0.0.1:${process.env.ADMIN_PORT || '5461'}`
const CLIENT_URL = `http://127.0.0.1:${process.env.CLIENT_PORT || '5462'}`
// Owned by the infra-hub repo, not this one -- RUSTFS_ENDPOINT is the one
// value here this gateway does not proxy to or run itself, only reports.
const RUSTFS_ENDPOINT = process.env.RUSTFS_ENDPOINT || 'http://localhost:6380'

async function bootstrap() {
  const lokiHost = process.env.LOKI_HOST || 'http://localhost:3100'
  const lokiReachable =
    process.env.LOKI_ENABLED === 'false' ? false : await probeLokiReachable(lokiHost)

  const gateway = await buildGateway({
    logger: buildLoggerOptions({ service: 'gateway', lokiReachable }),
    port: PORT,
    upstreams: {
      user: USER_SERVICE_URL,
      product: PRODUCT_SERVICE_URL,
      order: ORDER_SERVICE_URL,
      inventory: INVENTORY_SERVICE_URL,
      analytics: ANALYTICS_SERVICE_URL,
    },
    admin: ADMIN_URL,
    client: CLIENT_URL,
    rustfs: RUSTFS_ENDPOINT,
    corsOrigins: resolveCorsOrigins(),
    // Rate-limit counters live in Redis when the KV driver is Redis, so they hold
    // across gateway replicas and restarts; otherwise a per-process memory store.
    security: { redis: redisFromEnv() },
  })
  server = gateway.server

  // The limiter owns a Redis connection; without this the process lingers on exit.
  server.addHook('onClose', async () => {
    await gateway.security.close()
  })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[API Gateway] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
