import type { FastifyInstance } from 'fastify'
import { Redis } from 'ioredis'
import { createJwks, TokenVerifier } from './auth/verifier'
import { authPlugin } from './auth/plugin'
import { loadSecurityConfig, type SecurityConfig } from './config'
import { registerStrictValidation } from './contracts/validator'
import { registerErrorHandling } from './errors'
import { MemoryRateStore, RedisRateStore, type RateStore } from './rateLimit/limiter'
import { rateLimitPlugin } from './rateLimit/plugin'
import { policyPlugin } from './rbac/policy'
import type { AuthIdentity } from './types'

export interface RegisterSecurityOptions {
  /** e.g. 'ms-order'. Scopes rate-limit keys and tags audit lines. */
  service: string
  /**
   * Redis for the shared rate-limit store. Without it (KV driver is not Redis,
   * or in tests) a per-process memory store is used, which is NOT an effective
   * limit across replicas.
   */
  redis?: {
    host: string
    port: number
    password?: string | undefined
    db?: number | undefined
  } | null
  /** Tests may inject a key set / store / config instead of the network ones. */
  overrides?: {
    config?: Partial<SecurityConfig>
    jwks?: import('jose').JWTVerifyGetKey
    store?: RateStore
    isRevoked?: (identity: AuthIdentity) => Promise<boolean>
  }
}

export interface SecurityHandle {
  config: SecurityConfig
  close(): Promise<void>
}

/**
 * Wires pillars 1-4 into a Fastify instance. Call it ONCE, after the instance
 * is created and BEFORE any route is registered (the policy hook only sees
 * routes added after it, the same constraint as createRouteRegistry).
 *
 * Hook order, which is the request pipeline from the plan:
 *   onRequest      per-IP rate limit  ->  verify bearer token
 *   preValidation  per-user rate limit ->  policy (authN required? permission? MFA?)
 *   (Fastify)      strict schema validation
 *   handler        ownership check via requireOwnerOrAny
 * So an anonymous caller of a protected route gets 401 before the schema is ever
 * consulted and learns nothing about the body shape.
 */
export async function registerSecurity(
  server: FastifyInstance,
  options: RegisterSecurityOptions
): Promise<SecurityHandle> {
  const config: SecurityConfig = { ...loadSecurityConfig(), ...(options.overrides?.config ?? {}) }

  registerErrorHandling(server)
  registerStrictValidation(server)

  let redisClient: Redis | null = null
  let store: RateStore
  if (options.overrides?.store) {
    store = options.overrides.store
  } else if (options.redis) {
    // Fail fast: when Redis is down a limiter call must reject within ~200 ms so
    // the per-tier fail-open / fail-closed policy runs, not hang the request.
    redisClient = new Redis({
      host: options.redis.host,
      port: options.redis.port,
      ...(options.redis.password ? { password: options.redis.password } : {}),
      db: options.redis.db ?? 0,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 200,
      connectTimeout: 1_000,
      retryStrategy: (n) => Math.min(n * 500, 5_000),
    })
    redisClient.on('error', () => undefined) // surfaced through the limiter's own error path
    redisClient.connect().catch(() => undefined)
    store = new RedisRateStore(redisClient)
  } else {
    store = new MemoryRateStore()
  }

  await server.register(rateLimitPlugin, {
    store,
    mode: config.rateLimitMode,
    service: options.service,
    limits: config.limits,
  })

  const jwks = options.overrides?.jwks ?? (config.jwksUrl ? createJwks(config.jwksUrl) : null)
  const verifier =
    jwks && config.issuer
      ? new TokenVerifier({
          issuer: config.issuer,
          audience: config.audience,
          jwks,
          serviceSecret: config.serviceAuthSecret,
        })
      : null
  await server.register(authPlugin, { verifier, isRevoked: options.overrides?.isRevoked })

  server.decorate('securityMode', config.authMode)
  await server.register(policyPlugin, {
    mode: config.authMode,
    service: options.service,
    docsPublic: !config.production,
  })

  return {
    config,
    close: async () => {
      if (redisClient) await redisClient.quit().catch(() => redisClient?.disconnect())
    },
  }
}
