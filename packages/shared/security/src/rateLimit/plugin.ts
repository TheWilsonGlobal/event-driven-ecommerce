import { createHash } from 'crypto'
import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { SecurityConfig } from '../config'
import { AppError } from '../errors'
import { audit } from '../audit'
import type { RateTier } from '../rbac/policy'
import type { EnforceMode } from '../types'
import type { RateStore } from './limiter'

/**
 * Rate limiting in two stages, matching the plan's request pipeline:
 *
 *   onRequest     per-IP bucket for everything (cheap, before any auth work)
 *   preValidation per-tier bucket keyed by USER id once identity is known (IP
 *                 for anonymous callers); `auth` routes also get a bucket per
 *                 normalised e-mail, which is what stops credential stuffing
 *                 spread across many IPs.
 *
 * The key is never taken from a header the client controls: it is the verified
 * user id, or `request.ip`, which is only the real client address when the
 * server was created with the correct `trustProxy`.
 *
 * ── When the store is down ──────────────────────────────────────────────────
 * Per tier: reads FAIL OPEN (an outage of Redis must not take the catalogue
 * down) but `auth` and `admin` FAIL CLOSED with a 503 (an attacker must not get
 * unlimited password guesses by knocking over Redis). Fail-open events are
 * counted and logged, never silent.
 */

interface TierRule {
  max: number
  windowMs: number
  failOpen: boolean
}

export interface RateLimitStats {
  allowed: number
  limited: number
  failOpen: number
  failClosed: number
}

declare module 'fastify' {
  interface FastifyInstance {
    rateLimitStats: RateLimitStats
  }
}

export interface RateLimitOptions {
  store: RateStore
  mode: EnforceMode
  service: string
  limits: SecurityConfig['limits']
}

const MINUTE = 60_000

export function tierRules(limits: SecurityConfig['limits']): Record<Exclude<RateTier, 'none'>, TierRule> {
  return {
    read: { max: limits.userReadPerMin, windowMs: MINUTE, failOpen: true },
    write: { max: limits.userWritePerMin, windowMs: MINUTE, failOpen: true },
    expensive: { max: limits.expensivePerMin, windowMs: MINUTE, failOpen: true },
    auth: { max: limits.authIpPerMin, windowMs: MINUTE, failOpen: false },
    admin: { max: limits.adminPerMin, windowMs: MINUTE, failOpen: false },
  }
}

function tierOf(request: FastifyRequest): RateTier {
  const explicit = request.routeOptions?.config?.rateTier
  if (explicit) return explicit
  if (request.url === '/health' || request.url.startsWith('/health?')) return 'none'
  return request.method === 'GET' || request.method === 'HEAD' ? 'read' : 'write'
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24)

function emailOf(request: FastifyRequest): string | null {
  const body = request.body as Record<string, unknown> | undefined
  const raw = body && typeof body === 'object' ? body.email : undefined
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 320 ? raw.trim().toLowerCase() : null
}

export const rateLimitPlugin = fp<RateLimitOptions>(
  async (server: FastifyInstance, opts) => {
    const rules = tierRules(opts.limits)
    const stats: RateLimitStats = { allowed: 0, limited: 0, failOpen: 0, failClosed: 0 }
    server.decorate('rateLimitStats', stats)

    async function check(
      request: FastifyRequest,
      reply: FastifyReply,
      bucket: string,
      rule: { max: number; windowMs: number },
      failOpen: boolean,
      label: string
    ): Promise<void> {
      let hit
      try {
        hit = await opts.store.hit(`rl:${opts.service}:${bucket}`, rule.windowMs)
      } catch (err) {
        if (failOpen) {
          stats.failOpen += 1
          audit(request, 'rate_limit.unavailable', { bucket: label, policy: 'fail-open', reason: String(err) })
          return
        }
        stats.failClosed += 1
        audit(request, 'rate_limit.unavailable', { bucket: label, policy: 'fail-closed', reason: String(err) })
        if (opts.mode === 'enforce') {
          throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Service temporarily unavailable', {}, { 'retry-after': '5' })
        }
        return
      }

      const remaining = Math.max(0, rule.max - hit.count)
      const retryAfter = Math.max(1, Math.ceil(hit.resetMs / 1000))
      reply.header('x-ratelimit-limit', String(rule.max))
      reply.header('x-ratelimit-remaining', String(remaining))
      reply.header('x-ratelimit-reset', String(retryAfter))

      if (hit.count > rule.max) {
        stats.limited += 1
        audit(request, 'rate_limit.exceeded', { bucket: label, limit: rule.max, enforced: opts.mode === 'enforce' })
        if (opts.mode === 'enforce') {
          throw new AppError(429, 'RATE_LIMITED', 'Too many requests', { retryAfterSeconds: retryAfter }, {
            'retry-after': String(retryAfter),
          })
        }
        return
      }
      stats.allowed += 1
    }

    // Stage 1: per-IP, before authentication.
    server.addHook('onRequest', async (request, reply) => {
      if (request.method === 'OPTIONS' || tierOf(request) === 'none') return
      await check(
        request,
        reply,
        `ip:${request.ip}`,
        { max: opts.limits.ipPerMin, windowMs: MINUTE },
        true,
        'ip'
      )
    })

    // Stage 2: per user (or IP) by tier, plus the per-email bucket on auth routes.
    server.addHook('preValidation', async (request, reply) => {
      if (request.method === 'OPTIONS') return
      const tier = tierOf(request)
      if (tier === 'none') return
      const rule = rules[tier]
      const subject = request.auth ? `u:${request.auth.userId}` : `ip:${request.ip}`
      const route = request.routeOptions?.url ?? 'unknown'

      await check(request, reply, `${tier}:${route}:${subject}`, rule, rule.failOpen, tier)

      if (tier === 'auth') {
        const email = emailOf(request)
        if (email) {
          await check(
            request,
            reply,
            `authemail:${sha(email)}`,
            { max: opts.limits.authEmailPerMin, windowMs: MINUTE },
            false,
            'auth-email'
          )
        }
      }
    })
  },
  { name: 'shared-security-ratelimit' }
)
