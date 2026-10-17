/**
 * @ecommerce/shared-security: the four API defense pillars, implemented once.
 *
 *   1. Input validation   contracts/  strict Ajv compiler, TypeBox helpers, one error shape
 *   2. Rate limiting      rateLimit/  Redis-backed tiers, per-user / per-email buckets
 *   3. Authentication     auth/       Supabase JWT verified against the project's JWKS
 *   4. Authorization      rbac/       roles, permissions, route policies, ownership
 *
 * Services call `registerSecurity` once before registering routes, then declare
 * `config: { policy: { ... } }` on every route (default deny).
 */
export * from './types'
export * from './config'
export * from './errors'
export * from './audit'
export * from './auth/verifier'
export * from './auth/plugin'
export * from './rbac/roles'
export * from './rbac/policy'
export * from './rateLimit/limiter'
export * from './rateLimit/plugin'
export * from './contracts/common'
export * from './contracts/validator'
export * from './register'
export * from './testing'
