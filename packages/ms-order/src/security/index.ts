import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  audit,
  forbidden,
  identityHas,
  registerSecurity,
  type EnforceMode,
  type Permission,
  type SecurityHandle,
} from '@ecommerce/shared-security'

/**
 * ms-order's wiring of @ecommerce/shared-security.
 *
 * Kept out of index.ts so a test can build the same server (same hooks, same
 * order) as production with a local key set instead of Supabase's JWKS.
 */

/**
 * Routes this service gets from shared-utils (`/metrics`, `/api/v1/endpoints`)
 * are registered without a `config.policy`, and that package is not ours to
 * edit. This hook stamps one on them as they are registered. It MUST be added
 * before registerSecurity: onRoute hooks run in registration order, and the
 * policy plugin snapshots `route.config.policy` when its own hook runs.
 */
export function stampInfrastructurePolicies(server: FastifyInstance): void {
  server.addHook('onRoute', (route) => {
    if (route.config?.policy) return
    if (route.url === '/metrics') {
      // Prometheus scrapes without a token. Exposure is bounded by network
      // isolation (plan section 8), not by a credential the scraper cannot hold.
      route.config = { ...(route.config ?? {}), policy: { public: true } }
    } else if (route.url === '/api/v1/endpoints') {
      route.config = { ...(route.config ?? {}), policy: { permission: 'ops:read', mfa: true } }
    }
  })
}

export interface OrderSecurityOptions {
  /** Redis for the shared rate-limit store; null = per-process memory store. */
  redis: {
    host: string
    port: number
    password?: string | undefined
    db?: number | undefined
  } | null
  /** Tests inject a local key set / config instead of Supabase's. */
  overrides?: Parameters<typeof registerSecurity>[1]['overrides']
}

export async function registerOrderSecurity(
  server: FastifyInstance,
  { redis, overrides }: OrderSecurityOptions
): Promise<SecurityHandle> {
  stampInfrastructurePolicies(server)
  return registerSecurity(server, {
    service: 'ms-order',
    redis,
    ...(overrides ? { overrides } : {}),
  })
}

/** The enforcement mode, defaulting to report on a bare server (no security registered). */
export function modeOf(request: FastifyRequest): EnforceMode {
  return request.server.securityMode ?? 'report'
}

/** Does the caller hold the permission? False for an anonymous caller. */
export function can(request: FastifyRequest, permission: Permission): boolean {
  return identityHas(request.auth ?? null, permission)
}

/**
 * A handler-level permission check (the route policy only knew the bare
 * permission). Enforce: 403. Report: logged as a would-be denial, then allowed,
 * which is the rollout contract of AUTH_ENFORCE=report.
 */
export function requireCapability(
  request: FastifyRequest,
  permission: Permission,
  message: string
): void {
  if (can(request, permission)) return
  audit(request, 'access.denied', {
    code: 'FORBIDDEN',
    status: 403,
    permission,
    enforced: modeOf(request) === 'enforce',
  })
  if (modeOf(request) === 'enforce') throw forbidden('FORBIDDEN', message)
}
