import fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import httpProxy from '@fastify/http-proxy'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import {
  registerSecurity,
  securityServerOptions,
  type RateTier,
  type RegisterSecurityOptions,
  type RoutePolicy,
  type SecurityHandle,
} from '@ecommerce/shared-security'
import {
  registerMetrics,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import { registerLogRoutes, registerServicesRoute, registerTopologyRoute } from './diagnostics'
import {
  GATEWAY_CSP,
  proxyMounts,
  registerRequestGuards,
  relaxUpgradeInsecure,
  forwardHeaders,
  type Upstreams,
} from './security'

export interface GatewayOptions {
  logger: Exclude<FastifyServerOptions['logger'], undefined>
  port: number
  upstreams: Upstreams
  /** Origins of the frontends and RustFS, for the topology/services routes. */
  admin: string
  client: string
  rustfs: string
  corsOrigins: string[]
  /** Passed to registerSecurity; tests inject a key set, a store and config. */
  security: Omit<RegisterSecurityOptions, 'service'>
  /** Environment for server options (TRUST_PROXY, BODY_LIMIT_BYTES, ...). */
  env?: NodeJS.ProcessEnv
}

export interface Gateway {
  server: FastifyInstance
  security: SecurityHandle
}

/** Route config for the routes shared-utils installs (see the hook in buildGateway). */
const SHARED_ROUTE_CONFIG: Record<string, { policy: RoutePolicy; rateTier?: RateTier }> = {
  '/metrics': { policy: { public: true }, rateTier: 'none' },
  '/api/v1/endpoints': { policy: { permission: 'ops:read', mfa: true } },
}

/**
 * Builds (does not start) the gateway, so the same wiring is used by index.ts and
 * by the tests. Plugin order is part of the contract:
 *
 *   cors, helmet   first, so even a 401/429 rejection carries CORS and security
 *                  headers (a browser cannot read an error response without them)
 *   registerSecurity  before any route: rate limit -> authenticate -> policy
 *   request guards    path traversal and proxied body size
 *   routes            gateway-native, then the proxies
 */
export async function buildGateway(opts: GatewayOptions): Promise<Gateway> {
  const server = fastify({
    ...securityServerOptions(opts.env ?? process.env),
    logger: opts.logger,
  })

  // Before the routes below: onRoute only fires for routes registered after it.
  const routeRegistry = createRouteRegistry(server)

  await server.register(cors, {
    // An explicit allow-list. Returning false (rather than passing the array)
    // switches CORS off for the request, so an Origin outside the list gets none
    // of the Access-Control-* headers, `Allow-Credentials` included.
    origin: (origin, cb) => cb(null, origin !== undefined && opts.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: [
      'retry-after',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
      'x-correlation-id',
    ],
    maxAge: 600,
  })

  await server.register(helmet, { contentSecurityPolicy: GATEWAY_CSP })

  // /metrics and /api/v1/endpoints are registered by shared-utils, which cannot
  // carry a policy of its own, so they get one here. /metrics is public (a
  // Prometheus scraper holds no user token) and outside the rate limiter. Must be
  // attached BEFORE registerSecurity's own onRoute hook, which records the policy
  // as it sees the route.
  server.addHook('onRoute', (route) => {
    const injected = SHARED_ROUTE_CONFIG[route.url]
    if (injected) route.config = { ...(route.config ?? {}), ...injected }
  })

  const security = await registerSecurity(server, { service: 'gateway', ...opts.security })

  registerMetrics(server, { service: 'gateway' })
  registerRequestGuards(server)

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
      servers: [{ url: `http://localhost:${opts.port}` }],
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
    // Helmet's CSP is "load nothing", which would blank the UI. The plugin's own
    // policy ('self' + hashes of its inline bits) replaces it on these routes only.
    staticCSP: true,
    transformStaticCSP: relaxUpgradeInsecure,
  })

  // NOTE on proxy routes: they are forwarded upstream via @fastify/http-proxy
  // (registered below). They are not declared as local Fastify routes
  // (server.get/post/etc.), so @fastify/swagger cannot introspect a schema for
  // them — there is no local route object to attach one to, and fabricating a
  // schema here would describe a contract this service does not itself implement
  // or validate. Each upstream service registers its own swagger/swagger-ui and
  // is the source of truth for its routes' request/response schemas.

  server.get(
    '/health',
    {
      config: { policy: { public: true } },
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
          users: opts.upstreams.user,
          products: opts.upstreams.product,
          orders: opts.upstreams.order,
          inventory: opts.upstreams.inventory,
          analytics: opts.upstreams.analytics,
        },
      }
    }
  )

  registerLogRoutes(server)

  registerServicesRoute(server, [
    { name: 'ms-user', url: opts.upstreams.user },
    { name: 'ms-product', url: opts.upstreams.product },
    { name: 'ms-order', url: opts.upstreams.order },
    { name: 'ms-inventory', url: opts.upstreams.inventory },
    { name: 'ms-analytics', url: opts.upstreams.analytics },
  ])

  registerTopologyRoute(server, [
    { name: 'gateway', url: `http://127.0.0.1:${String(opts.port)}` },
    { name: 'admin', url: opts.admin },
    { name: 'client', url: opts.client },
    { name: 'ms-user', url: opts.upstreams.user },
    { name: 'ms-product', url: opts.upstreams.product },
    { name: 'ms-order', url: opts.upstreams.order },
    { name: 'ms-inventory', url: opts.upstreams.inventory },
    { name: 'ms-analytics', url: opts.upstreams.analytics },
    { name: 'rustfs', url: opts.rustfs },
  ])

  // Proxies. Each prefix is mounted once per rule (reads / writes) because the
  // route `config` (policy, rate tier, body cap) is per registration, not per
  // method. The caller's Authorization header is forwarded untouched; identity
  // headers a client invented are dropped.
  for (const mount of proxyMounts(opts.upstreams)) {
    for (const rule of mount.rules) {
      await server.register(httpProxy, {
        upstream: mount.upstream,
        prefix: mount.prefix,
        rewritePrefix: mount.prefix,
        httpMethods: rule.methods,
        replyOptions: {
          rewriteRequestHeaders: (req, headers) =>
            forwardHeaders(req as unknown as FastifyRequest, headers),
        },
        config: {
          policy: rule.policy,
          proxyBodyLimit: rule.bodyLimit,
          ...(rule.rateTier ? { rateTier: rule.rateTier } : {}),
        },
      })
    }
  }

  registerEndpointsRoute(server, routeRegistry, 'gateway')

  return { server, security }
}
