import type { EnforceMode } from './types'

/**
 * Everything the security layer reads from the environment, in one place.
 *
 * Nothing here has a "convenient" insecure default: an unset SUPABASE_URL does
 * not disable authentication, it makes every presented token fail with
 * `auth_not_configured`, and the policy hook then answers 401 in enforce mode.
 * The only permissive default is AUTH_ENFORCE=report, which is the documented
 * rollout mode (decisions are logged, nothing is blocked).
 */
export interface SecurityConfig {
  authMode: EnforceMode
  rateLimitMode: EnforceMode
  supabaseUrl: string | null
  issuer: string | null
  jwksUrl: string | null
  audience: string
  /** HS256 secret for internal service-to-service tokens; null disables them. */
  serviceAuthSecret: string | null
  corsOrigins: string[]
  trustProxy: boolean | number | string
  production: boolean
  limits: {
    ipPerMin: number
    authIpPerMin: number
    authEmailPerMin: number
    userReadPerMin: number
    userWritePerMin: number
    expensivePerMin: number
    adminPerMin: number
  }
}

function mode(raw: string | undefined, fallback: EnforceMode): EnforceMode {
  const v = raw?.trim().toLowerCase()
  return v === 'enforce' || v === 'report' ? v : fallback
}

function int(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function trustProxy(raw: string | undefined): boolean | number | string {
  const v = raw?.trim()
  if (!v || v === 'false') return false
  if (v === 'true') return true
  if (/^\d+$/.test(v)) return parseInt(v, 10)
  return v // a CIDR / list, passed to Fastify as-is
}

export function loadSecurityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  const base = env.SUPABASE_URL?.trim().replace(/\/+$/, '') || null
  return {
    authMode: mode(env.AUTH_ENFORCE, 'report'),
    rateLimitMode: mode(env.RATE_LIMIT_ENFORCE, 'report'),
    supabaseUrl: base,
    issuer: base ? `${base}/auth/v1` : null,
    jwksUrl: base ? `${base}/auth/v1/.well-known/jwks.json` : null,
    audience: env.AUTH_AUDIENCE?.trim() || 'authenticated',
    serviceAuthSecret: env.SERVICE_AUTH_SECRET?.trim() || null,
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: trustProxy(env.TRUST_PROXY),
    production: env.NODE_ENV === 'production',
    limits: {
      ipPerMin: int(env.RATE_LIMIT_IP_PER_MIN, 300),
      authIpPerMin: int(env.RATE_LIMIT_AUTH_IP_PER_MIN, 20),
      authEmailPerMin: int(env.RATE_LIMIT_AUTH_EMAIL_PER_MIN, 5),
      userReadPerMin: int(env.RATE_LIMIT_USER_READ_PER_MIN, 120),
      userWritePerMin: int(env.RATE_LIMIT_USER_WRITE_PER_MIN, 30),
      expensivePerMin: int(env.RATE_LIMIT_EXPENSIVE_PER_MIN, 20),
      adminPerMin: int(env.RATE_LIMIT_ADMIN_PER_MIN, 10),
    },
  }
}
