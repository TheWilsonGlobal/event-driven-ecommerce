import type { FastifyInstance, HTTPMethods } from 'fastify'
import {
  AppError,
  CORRELATION_HEADER,
  TRACEPARENT_HEADER,
  correlationHeaders,
  loadSecurityConfig,
  type RateTier,
  type RoutePolicy,
} from '@ecommerce/shared-security'

/** Per-route cap on a proxied request body, read by the onRequest guard below. */
declare module 'fastify' {
  interface FastifyContextConfig {
    proxyBodyLimit?: number
  }
}

// ─── CORS ───────────────────────────────────────────────────────────────────

/** The two frontends (admin SPA, storefront) as dev defaults when CORS_ORIGINS is unset. */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:5461', 'http://localhost:5462']

/**
 * The browser origins allowed to call the gateway with credentials. A wildcard
 * is never honoured: `*` together with credentials is exactly the misconfiguration
 * this allow-list exists to prevent, so it is dropped rather than passed on.
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = loadSecurityConfig(env).corsOrigins.filter((o) => o !== '*')
  return configured.length > 0 ? configured : DEFAULT_CORS_ORIGINS
}

// ─── Redis for the shared rate-limit store ──────────────────────────────────

/**
 * The same decision shared-database's loadDatabaseConfig makes (KV_CACHE_DRIVER,
 * defaulting to redis unless DB_MODE=embedded), repeated here because the
 * gateway has no database dependency and should not gain one for four lines.
 */
export function redisFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.KV_CACHE_DRIVER?.toLowerCase()
  const known = raw === 'redis' || raw === 'rocksdb' || raw === 'embedded'
  const driver = known ? raw : env.DB_MODE?.toLowerCase() === 'embedded' ? 'rocksdb' : 'redis'
  if (driver !== 'redis') return null
  return {
    host: env.REDIS_HOST ?? 'localhost',
    port: parseInt(env.REDIS_PORT ?? '6379', 10),
    password: env.REDIS_PASSWORD || undefined,
    db: parseInt(env.REDIS_DB ?? '0', 10),
  }
}

// ─── Content-Security-Policy ────────────────────────────────────────────────

/**
 * The gateway serves JSON, never a page, so the policy is "load nothing":
 *   default-src 'none'      no script, style, image, frame, font or fetch target
 *   base-uri 'none'         no <base> rewriting
 *   form-action 'none'      nothing here submits forms
 *   frame-ancestors 'none'  cannot be framed (clickjacking); replaces X-Frame-Options
 * `useDefaults: false` so helmet's `upgrade-insecure-requests` is not added: on
 * plain-http localhost it makes browsers rewrite the API's own links to https.
 *
 * The Swagger UI is the one HTML surface. Its static routes get the plugin's own
 * policy (`staticCSP: true`: 'self' plus hashes of the plugin's inline bits)
 * which replaces this header on those responses only.
 */
export const GATEWAY_CSP = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
    frameAncestors: ["'none'"],
  },
}

/** Drops `upgrade-insecure-requests` from swagger-ui's CSP (see GATEWAY_CSP). */
export const relaxUpgradeInsecure = (header: unknown): string =>
  String(header)
    .replace(/\s*upgrade-insecure-requests;?/i, '')
    .trim()

// ─── Identity headers ───────────────────────────────────────────────────────

/**
 * Headers a client could use to claim an identity. Services take identity ONLY
 * from the verified bearer token, but a service (or a future one) that logs or
 * trusts such a header must never see a forged one arrive through the gateway.
 * Prefix match on purpose: `x-user-id`, `x-user-role`, `x-userid`, `x-user-email`.
 */
const IDENTITY_HEADER_PREFIXES = ['x-user', 'x-service', 'x-auth', 'x-internal', 'x-forwarded-user']
const IDENTITY_HEADERS = new Set(['x-role', 'x-roles', 'x-admin', 'x-tenant-id'])

export function isIdentityHeader(name: string): boolean {
  const n = name.toLowerCase()
  return IDENTITY_HEADERS.has(n) || IDENTITY_HEADER_PREFIXES.some((p) => n.startsWith(p))
}

/**
 * reply-from hook: the outgoing header set. `authorization` passes through
 * unchanged (the upstream re-verifies the token itself); identity headers are
 * dropped.
 */
export function stripIdentityHeaders(
  _request: unknown,
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!isIdentityHeader(name)) out[name] = value
  }
  return out
}

/**
 * The outgoing header set for a proxied call: identity headers dropped, and the
 * trace headers REPLACED by the values the correlation plugin validated (so a
 * malformed inbound `x-correlation-id` / `traceparent` is never forwarded, and
 * every upstream log line shares the id the gateway echoes to the caller).
 */
export function forwardHeaders(
  request: { correlationId: string; traceparent: string | null },
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const out = stripIdentityHeaders(request, headers)
  delete out[CORRELATION_HEADER]
  delete out[TRACEPARENT_HEADER]
  return { ...out, ...correlationHeaders(request) }
}

// ─── Request guards ─────────────────────────────────────────────────────────

/**
 * Rejects `.`/`..` path segments (also percent-encoded) and encoded separators.
 * The proxy builds the upstream URL with `new URL(path, base)`, which collapses
 * `..`: `/api/v1/orders/../queues` would otherwise be authorised as an orders
 * route here and arrive at the upstream as `/api/v1/queues`.
 */
export function hasTraversal(rawUrl: string): boolean {
  const path = rawUrl.split('?', 1)[0] ?? ''
  for (const segment of path.split('/')) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return true // malformed percent-encoding is never a legitimate path
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      return true
    }
  }
  return false
}

export function registerRequestGuards(server: FastifyInstance): void {
  server.addHook('onRequest', async (request) => {
    if (hasTraversal(request.raw.url ?? '')) {
      throw new AppError(400, 'INVALID_PATH', 'Invalid request path')
    }

    // @fastify/http-proxy hands the body through as a raw stream, so Fastify's
    // own bodyLimit never sees it. Enforce the cap on the declared length, and
    // refuse chunked bodies (no length to check) on the routes that proxy one.
    const limit = request.routeOptions?.config?.proxyBodyLimit
    if (limit === undefined) return
    if (request.headers['transfer-encoding'] !== undefined) {
      throw new AppError(411, 'LENGTH_REQUIRED', 'Content-Length is required')
    }
    const declared = Number(request.headers['content-length'] ?? 0)
    if (!Number.isFinite(declared) || declared > limit) {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')
    }
  })
}

// ─── Proxy policy table ─────────────────────────────────────────────────────

const READ_METHODS: HTTPMethods[] = ['GET', 'HEAD', 'OPTIONS']
const WRITE_METHODS: HTTPMethods[] = ['DELETE', 'PATCH', 'POST', 'PUT']

const JSON_BODY_LIMIT = 100 * 1024
/** 10 MB image + multipart framing; matches ms-product's upload route. */
export const UPLOAD_BODY_LIMIT = 10 * 1024 * 1024 + 64 * 1024

export interface ProxyRule {
  methods: HTTPMethods[]
  policy: RoutePolicy
  rateTier?: RateTier
  bodyLimit: number
}

export interface ProxyMount {
  prefix: string
  upstream: string
  rules: ProxyRule[]
}

export interface Upstreams {
  user: string
  product: string
  order: string
  inventory: string
  analytics: string
}

const read = (policy: RoutePolicy, rateTier?: RateTier): ProxyRule => ({
  methods: READ_METHODS,
  policy,
  ...(rateTier ? { rateTier } : {}),
  bodyLimit: JSON_BODY_LIMIT,
})
const write = (policy: RoutePolicy, rateTier?: RateTier): ProxyRule => ({
  methods: WRITE_METHODS,
  policy,
  ...(rateTier ? { rateTier } : {}),
  bodyLimit: JSON_BODY_LIMIT,
})

/**
 * The COARSE gateway policy, one rule set per proxied prefix. It rejects the
 * obviously wrong caller early (no token, wrong role) and applies the rate tier;
 * the services re-verify the token and decide authoritatively, so nothing here
 * ever grants more than the service would.
 *
 * Operator prefixes (/events, /outbox, /queues, /cache, /logs, /schema,
 * /storage) are deliberately NOT proxied: they are reached on each service, and
 * the traversal guard stops them being reached through an authorised prefix.
 */
export function proxyMounts(u: Upstreams): ProxyMount[] {
  return [
    {
      // Login/register: public by nature, so the strict `auth` tier is the defence.
      prefix: '/api/v1/auth',
      upstream: u.user,
      rules: [read({ public: true }), write({ public: true }, 'auth')],
    },
    {
      prefix: '/api/v1/users',
      upstream: u.user,
      rules: [read({}), write({})],
    },
    {
      // The most specific mount: uploads need a larger body and the expensive tier.
      prefix: '/api/v1/products/upload',
      upstream: u.product,
      rules: [
        {
          methods: ['POST'],
          policy: { permission: 'uploads:write' },
          rateTier: 'expensive',
          bodyLimit: UPLOAD_BODY_LIMIT,
        },
      ],
    },
    {
      prefix: '/api/v1/products',
      upstream: u.product,
      rules: [read({ public: true }), write({ permission: 'products:write' })],
    },
    {
      prefix: '/api/v1/categories',
      upstream: u.product,
      rules: [read({ public: true }), write({ permission: 'categories:write' })],
    },
    { prefix: '/api/v1/orders', upstream: u.order, rules: [read({}), write({})] },
    { prefix: '/api/v1/cart', upstream: u.order, rules: [read({}), write({})] },
    { prefix: '/api/v1/payments', upstream: u.order, rules: [read({}), write({})] },
    {
      prefix: '/api/v1/inventory',
      upstream: u.inventory,
      rules: [read({ permission: 'inventory:read' }), write({ permission: 'inventory:read' })],
    },
    {
      prefix: '/api/v1/reservations',
      upstream: u.inventory,
      rules: [read({ permission: 'inventory:read' }), write({ permission: 'inventory:read' })],
    },
    {
      prefix: '/api/v1/analytics',
      upstream: u.analytics,
      rules: [read({ permission: 'analytics:read' }), write({ permission: 'analytics:read' })],
    },
  ]
}
