import type { FastifyInstance } from 'fastify'
import type { DatabaseConfiguration } from '@ecommerce/shared-database'

/** Where the browser apps run in local development (client, admin). */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:5461', 'http://localhost:5462']

/**
 * CORS allow-list from CORS_ORIGINS (comma separated). Never `*`: a wildcard
 * is dropped if someone puts it in the variable, and an empty list falls back to
 * the two local apps rather than to "allow everything".
 */
export function resolveCorsOrigins(raw: string | undefined): string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '*')
  return origins.length > 0 ? origins : DEFAULT_CORS_ORIGINS
}

/** Redis settings for the shared rate-limit store, or null when KV is not Redis. */
export function redisForRateLimit(db: DatabaseConfiguration) {
  return db.keyValue.driver === 'redis' ? db.keyValue.redis : null
}

/**
 * Policies for routes that shared libraries register (we cannot pass `config` to
 * them): the Prometheus scrape endpoint and the route inventory.
 *
 * Call it BEFORE registerSecurity. Fastify runs onRoute hooks in registration
 * order, so this one amends the route's config first and the policy plugin then
 * records the amended policy.
 *
 *   /metrics            public. Prometheus cannot present a user token, and the
 *                       endpoint carries counters only. Keep the service port
 *                       off the public network (plan section 8).
 *   /api/v1/endpoints   operator surface, like /logs and /schema.
 */
export function applyForeignRoutePolicies(server: FastifyInstance): void {
  server.addHook('onRoute', (route) => {
    if (route.config?.policy) return
    if (route.url === '/metrics') {
      route.config = { ...(route.config ?? {}), policy: { public: true }, rateTier: 'none' }
    } else if (route.url === '/api/v1/endpoints') {
      route.config = {
        ...(route.config ?? {}),
        policy: { permission: 'ops:read', mfa: true },
        rateTier: 'expensive',
      }
    }
  })
}
