import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import { loadSecurityConfig, type RateTier, type RoutePolicy } from '@ecommerce/shared-security'

// ─── CORS ───────────────────────────────────────────────────────────────────

/** The admin SPA and the storefront, as dev defaults when CORS_ORIGINS is unset. */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:5461', 'http://localhost:5462']

/** A wildcard is dropped: `*` combined with credentials is the mistake being avoided. */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = loadSecurityConfig(env).corsOrigins.filter((o) => o !== '*')
  return configured.length > 0 ? configured : DEFAULT_CORS_ORIGINS
}

/**
 * @fastify/cors `origin` option: an Origin outside the allow-list gets NO
 * Access-Control-* headers (returning false switches CORS off for the request,
 * so `Allow-Credentials` is not sent either).
 */
export const corsOriginCheck =
  (allowed: string[]) =>
  (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void): void =>
    cb(null, origin !== undefined && allowed.includes(origin))

// ─── Content-Security-Policy ────────────────────────────────────────────────

/**
 * This service returns JSON and redirects, never a page: load nothing, cannot be
 * framed. `useDefaults: false` drops helmet's `upgrade-insecure-requests`, which
 * rewrites plain-http localhost links to https. Swagger UI's static routes carry
 * the plugin's own policy (`staticCSP: true`), which replaces this one there.
 */
export const SERVICE_CSP = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
    frameAncestors: ["'none'"],
  },
}

export const relaxUpgradeInsecure = (header: unknown): string =>
  String(header)
    .replace(/\s*upgrade-insecure-requests;?/i, '')
    .trim()

// ─── Routes installed by shared code ────────────────────────────────────────

/**
 * /metrics and /api/v1/endpoints come from @ecommerce/shared-utils, which cannot
 * carry a policy of its own. Metrics is public (a Prometheus scraper holds no
 * user token) and outside the rate limiter; the route inventory is operator-only.
 * Attach this BEFORE registerSecurity so its onRoute hook records the policy.
 */
const SHARED_ROUTE_CONFIG: Record<string, { policy: RoutePolicy; rateTier?: RateTier }> = {
  '/metrics': { policy: { public: true }, rateTier: 'none' },
  '/api/v1/endpoints': { policy: { permission: 'ops:read', mfa: true } },
}

export function applySharedRoutePolicies(server: FastifyInstance): void {
  server.addHook('onRoute', (route) => {
    const injected = SHARED_ROUTE_CONFIG[route.url]
    if (injected) route.config = { ...(route.config ?? {}), ...injected }
  })
}

/** The operator surface: logs, schema, queues. Second factor required. */
export const OPS_POLICY: RoutePolicy = { permission: 'ops:read', mfa: true }

// ─── "Is this a search?" as a routing constraint ────────────────────────────

/**
 * The rate tier is a static per-route setting, but `GET /products?search=` is far
 * costlier than a plain listing (Elasticsearch, or a full scan of the catalogue
 * when it is down). A custom find-my-way constraint lets the SAME path resolve to
 * two route definitions, one tagged `expensive`, chosen per request. The term is
 * read with URLSearchParams, not a regex over the raw URL, so `s%65arch=x` cannot
 * dodge the stricter tier.
 */
export function hasSearchTerm(rawUrl: string | undefined): boolean {
  const query = (rawUrl ?? '').split('?', 2)[1]
  if (!query) return false
  return (new URLSearchParams(query).get('search') ?? '').trim().length > 0
}

type Strategy = NonNullable<FastifyServerOptions['constraints']>[string]
type RouteHandler = Parameters<ReturnType<Strategy['storage']>['set']>[1]

export const searchConstraint: Strategy = {
  name: 'hasSearch',
  storage() {
    const handlers = new Map<string, RouteHandler>()
    return {
      get: (value: string) => handlers.get(value) ?? null,
      set: (value: string, handler: RouteHandler) => {
        handlers.set(value, handler)
      },
    }
  },
  validate(value: unknown) {
    if (value !== 'yes' && value !== 'no') throw new Error('hasSearch must be "yes" or "no"')
  },
  deriveConstraint: (req: { url?: string | undefined }) => (hasSearchTerm(req.url) ? 'yes' : 'no'),
  // A request with no matching constrained route falls through to the plain one.
  mustMatchWhenDerived: false,
}
