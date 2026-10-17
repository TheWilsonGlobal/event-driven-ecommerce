/**
 * Non-secret database defaults. The env vars named in each comment still
 * override them. Credentials, hosts and endpoints are NOT here; they stay in .env.
 */

/** DB_POOL_MAX: connections per service (5 services x this must stay under the project cap). */
export const DB_POOL_MAX_DEFAULT = 3

/** REDIS_DB: Redis logical database index. */
export const REDIS_DB_DEFAULT = 0
