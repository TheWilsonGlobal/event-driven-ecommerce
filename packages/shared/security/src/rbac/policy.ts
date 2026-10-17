import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { AppError, notFound } from '../errors'
import type { AuthIdentity, EnforceMode } from '../types'
import { anyVariant, identityHas, type Permission } from './roles'
import { audit } from '../audit'

/**
 * Per-route access policy, declared in the route options:
 *
 *     server.get('/api/v1/orders/:id', {
 *       config: { policy: { permission: 'orders:read' } },
 *       schema: { ... },
 *     }, handler)
 *
 * DEFAULT DENY: a route with no policy is refused (and the startup assertion
 * `assertPolicyCoverage` fails the build). To expose a route to everyone you
 * must write `policy: { public: true }`: an explicit, reviewable decision.
 */
export interface RoutePolicy {
  /** Anyone may call it, no token needed (health, public catalogue reads, login). */
  public?: boolean
  /** The permission the caller's role must hold. */
  permission?: Permission
  /** Require a second factor (aal2). Operator and role-changing routes. */
  mfa?: boolean
  /** Always write an audit record, not only on denial. */
  audit?: boolean
}

export type RateTier = 'none' | 'read' | 'write' | 'auth' | 'expensive' | 'admin'

declare module 'fastify' {
  interface FastifyContextConfig {
    policy?: RoutePolicy
    /** Overrides the rate-limit tier derived from the HTTP method. */
    rateTier?: RateTier
  }
}

export interface PolicyDecision {
  allowed: boolean
  status: 200 | 401 | 403
  code: string
  message: string
}

const ALLOW: PolicyDecision = { allowed: true, status: 200, code: 'OK', message: 'ok' }

/** Pure: the whole authorization rule, so it can be table-tested without a server. */
export function decide(
  policy: RoutePolicy | undefined,
  identity: AuthIdentity | null,
  authError: string | null
): PolicyDecision {
  if (!policy) {
    return {
      allowed: false,
      status: 403,
      code: 'POLICY_MISSING',
      message: 'Route has no access policy',
    }
  }
  if (policy.public) return ALLOW

  if (!identity) {
    return authError
      ? { allowed: false, status: 401, code: 'TOKEN_INVALID', message: 'Invalid or expired token' }
      : {
          allowed: false,
          status: 401,
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
        }
  }
  if (!policy.permission) {
    // Authenticated-only route (no specific permission): any signed-in identity.
    return ALLOW
  }
  const own = identityHas(identity, policy.permission)
  const anyPerm = anyVariant(policy.permission)
  const any = anyPerm ? identityHas(identity, anyPerm) : false
  if (!own && !any) {
    return {
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'You do not have permission to do this',
    }
  }
  if (policy.mfa && identity.kind === 'user' && identity.aal !== 'aal2') {
    return {
      allowed: false,
      status: 403,
      code: 'MFA_REQUIRED',
      message: 'A second factor is required for this action',
    }
  }
  return ALLOW
}

export interface RegisteredRoute {
  method: string
  url: string
  policy: RoutePolicy | undefined
}

declare module 'fastify' {
  interface FastifyInstance {
    routePolicies: RegisteredRoute[]
  }
}

export interface PolicyPluginOptions {
  mode: EnforceMode
  service: string
  /** Swagger UI is public in development; in production it needs ops:read. */
  docsPublic: boolean
}

const DOCS_PREFIXES = ['/api-docs', '/documentation']

export const policyPlugin = fp<PolicyPluginOptions>(
  async (server: FastifyInstance, opts) => {
    server.decorate('routePolicies', [] as RegisteredRoute[])

    server.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method]
      const isDocs = DOCS_PREFIXES.some((p) => route.url === p || route.url.startsWith(`${p}/`))
      if (isDocs && !route.config?.policy) {
        route.config = {
          ...(route.config ?? {}),
          policy: opts.docsPublic ? { public: true } : { permission: 'ops:read' },
        }
      }
      for (const method of methods) {
        if (method === 'HEAD' || method === 'OPTIONS') continue
        server.routePolicies.push({ method, url: route.url, policy: route.config?.policy })
      }
    })

    server.addHook('preValidation', async (request) => {
      if (request.method === 'OPTIONS') return // CORS preflight carries no credentials
      if (request.is404) return // unknown route: the standard 404 handler answers, not 'policy missing'

      const policy = request.routeOptions?.config?.policy
      const decision = decide(policy, request.auth, request.authError)

      if (!decision.allowed) {
        audit(request, 'access.denied', {
          service: opts.service,
          code: decision.code,
          status: decision.status,
          enforced: opts.mode === 'enforce',
          permission: policy?.permission ?? null,
        })
        if (opts.mode === 'enforce') {
          throw new AppError(decision.status, decision.code, decision.message)
        }
        return // report mode: logged, not blocked
      }

      if (policy?.audit) {
        audit(request, 'access.granted', {
          service: opts.service,
          permission: policy.permission ?? null,
        })
      }
    })
  },
  { name: 'shared-security-policy' }
)

/**
 * Object-level authorization (BOLA / IDOR).
 *
 * Call it after loading a record: the owner always passes; anyone else needs the
 * `:any` permission. Failure is a 404, not a 403, so a caller cannot probe which
 * ids exist. In report mode the violation is logged and allowed.
 */
export function requireOwnerOrAny(
  request: FastifyRequest,
  ownerUserId: string | null | undefined,
  permission: Permission,
  mode: EnforceMode = enforceModeOf(request)
): void {
  const identity = request.auth
  if (!identity) return // route policy already handled unauthenticated callers
  if (ownerUserId && identity.userId === ownerUserId) return
  const anyPerm = anyVariant(permission)
  if (anyPerm && identityHas(identity, anyPerm)) return

  audit(request, 'access.denied', {
    code: 'NOT_OWNER',
    status: 404,
    enforced: mode === 'enforce',
    permission,
  })
  if (mode === 'enforce') throw notFound()
}

/** The mode the policy plugin was registered with, attached to the instance. */
declare module 'fastify' {
  interface FastifyInstance {
    securityMode: EnforceMode
  }
}

function enforceModeOf(request: FastifyRequest): EnforceMode {
  return request.server.securityMode ?? 'enforce'
}

/**
 * Fails when any registered route has no policy. Run it in a test and (outside
 * production) at boot, after all routes are registered.
 */
export function assertPolicyCoverage(
  server: FastifyInstance,
  allowUnpolicied: string[] = []
): void {
  const missing = server.routePolicies
    .filter((r) => !r.policy && !allowUnpolicied.includes(r.url))
    .map((r) => `${r.method} ${r.url}`)
  if (missing.length > 0) {
    throw new Error(`Routes without an access policy (default deny):\n  ${missing.join('\n  ')}`)
  }
}

/** The policy table, for documentation and the generated matrix test. */
export function describePolicies(server: FastifyInstance): RegisteredRoute[] {
  return [...server.routePolicies].sort((a, b) =>
    (a.url + a.method).localeCompare(b.url + b.method)
  )
}
