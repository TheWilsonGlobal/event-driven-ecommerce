/**
 * Non-secret security tunables. Env vars of the same names as before
 * (RATE_LIMIT_*_PER_MIN, AUTH_AUDIENCE) still override these.
 * AUTH_ENFORCE / RATE_LIMIT_ENFORCE are rollout switches and stay in .env.
 */
export const RATE_LIMIT_DEFAULTS = {
  /** RATE_LIMIT_IP_PER_MIN: every request, per client IP. */
  ipPerMin: 300,
  /** RATE_LIMIT_AUTH_IP_PER_MIN: auth endpoints, per IP. */
  authIpPerMin: 20,
  /** RATE_LIMIT_AUTH_EMAIL_PER_MIN: auth endpoints, per email. */
  authEmailPerMin: 5,
  /** RATE_LIMIT_USER_READ_PER_MIN: authenticated reads, per user. */
  userReadPerMin: 120,
  /** RATE_LIMIT_USER_WRITE_PER_MIN: authenticated writes, per user. */
  userWritePerMin: 30,
  /** RATE_LIMIT_EXPENSIVE_PER_MIN: costly endpoints, per user. */
  expensivePerMin: 20,
  /** RATE_LIMIT_ADMIN_PER_MIN: operator endpoints. */
  adminPerMin: 10,
} as const

/** Expected JWT `aud` claim unless AUTH_AUDIENCE overrides it. */
export const AUTH_AUDIENCE_DEFAULT = 'authenticated'
