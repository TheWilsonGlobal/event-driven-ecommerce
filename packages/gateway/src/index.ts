import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import httpProxy from '@fastify/http-proxy'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import * as dotenv from 'dotenv'
import * as path from 'path'
import {
  registerMetrics,
  buildLoggerOptions,
  probeLokiReachable,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import { registerLogRoutes, registerServicesRoute, registerTopologyRoute } from './diagnostics'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

// Checked once at boot, before the logger (and its Loki transport) is even
// constructed — an unreachable Loki then produces one quiet line here
// instead of a stack trace per log line for the life of the process.
let server: FastifyInstance

const PORT = parseInt(process.env.API_GATEWAY_PORT || process.env.PORT || '5460', 10)
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://127.0.0.1:5463'
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://127.0.0.1:5464'
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://127.0.0.1:5465'

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

  server = fastify({
    logger: buildLoggerOptions({ service: 'gateway', lokiReachable }),
  })

  // Before every other plugin, so the onResponse hook sees all traffic.
  registerMetrics(server, { service: 'gateway' })

  // Before any route registration below — onRoute only fires for routes
  // registered after this hook is attached, and this must see the proxy
  // routes @fastify/http-proxy installs further down too.
  const routeRegistry = createRouteRegistry(server)

  await server.register(cors, {
    origin: '*',
  })

  await server.register(helmet, {
    contentSecurityPolicy: false,
  })

  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  await server.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'API Gateway',
        description:
          'Reverse proxy entry point for the e-commerce microservices. ' +
          'Routes under /api/v1/* are forwarded to ms-user, ms-product, and ms-order ' +
          'and are NOT listed individually here (see note below) — browse each upstream ' +
          "service's own /api-docs for the full contract of the routes it exposes.",
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      tags: [
        { name: 'health', description: 'Gateway health and status' },
        { name: 'logs', description: 'Real log file listing and reading' },
        { name: 'services', description: 'Server-side health rollup of upstream services' },
        { name: 'endpoints', description: 'Live registered-route inventory' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })

  // NOTE on proxy routes: /api/v1/auth, /api/v1/users, /api/v1/products,
  // /api/v1/categories, /api/v1/orders, /api/v1/cart, and /api/v1/payments are
  // forwarded upstream via @fastify/http-proxy (registered below). They are not
  // declared as local Fastify routes (server.get/post/etc.), so @fastify/swagger
  // cannot introspect a schema for them — there is no local route object to
  // attach one to, and fabricating a schema here would describe a contract this
  // service does not itself implement or validate. Each upstream service
  // (ms-user, ms-product, ms-order) registers its own swagger/swagger-ui and is
  // the source of truth for its routes' request/response schemas.

  server.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        description: 'Gateway liveness/status check, including configured upstream URLs.',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              routes: {
                type: 'object',
                properties: {
                  users: { type: 'string' },
                  products: { type: 'string' },
                  orders: { type: 'string' },
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
        service: 'api-gateway',
        timestamp: new Date().toISOString(),
        routes: {
          users: USER_SERVICE_URL,
          products: PRODUCT_SERVICE_URL,
          orders: ORDER_SERVICE_URL,
        },
      }
    }
  )

  registerLogRoutes(server)

  registerServicesRoute(server, [
    { name: 'ms-user', url: USER_SERVICE_URL },
    { name: 'ms-product', url: PRODUCT_SERVICE_URL },
    { name: 'ms-order', url: ORDER_SERVICE_URL },
  ])

  registerTopologyRoute(server, [
    { name: 'gateway', url: `http://127.0.0.1:${String(PORT)}` },
    { name: 'admin', url: ADMIN_URL },
    { name: 'client', url: CLIENT_URL },
    { name: 'ms-user', url: USER_SERVICE_URL },
    { name: 'ms-product', url: PRODUCT_SERVICE_URL },
    { name: 'ms-order', url: ORDER_SERVICE_URL },
    { name: 'rustfs', url: RUSTFS_ENDPOINT },
  ])

  // Proxy user and auth routes
  await server.register(httpProxy, {
    upstream: USER_SERVICE_URL,
    prefix: '/api/v1/auth',
    rewritePrefix: '/api/v1/auth',
  })

  await server.register(httpProxy, {
    upstream: USER_SERVICE_URL,
    prefix: '/api/v1/users',
    rewritePrefix: '/api/v1/users',
  })

  // Proxy product routes
  await server.register(httpProxy, {
    upstream: PRODUCT_SERVICE_URL,
    prefix: '/api/v1/products',
    rewritePrefix: '/api/v1/products',
  })

  await server.register(httpProxy, {
    upstream: PRODUCT_SERVICE_URL,
    prefix: '/api/v1/categories',
    rewritePrefix: '/api/v1/categories',
  })

  // Proxy order and payment routes
  await server.register(httpProxy, {
    upstream: ORDER_SERVICE_URL,
    prefix: '/api/v1/orders',
    rewritePrefix: '/api/v1/orders',
  })

  await server.register(httpProxy, {
    upstream: ORDER_SERVICE_URL,
    prefix: '/api/v1/cart',
    rewritePrefix: '/api/v1/cart',
  })

  await server.register(httpProxy, {
    upstream: ORDER_SERVICE_URL,
    prefix: '/api/v1/payments',
    rewritePrefix: '/api/v1/payments',
  })

  registerEndpointsRoute(server, routeRegistry, 'gateway')

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[API Gateway] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
