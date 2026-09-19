/**
 * RedisUnavailableError / toRedisUnavailable moved to @ecommerce/shared-messaging
 * 2026-09-19 — ms-product needed the same 503-mapping contract for its own
 * queue. Re-exported here so existing imports from './errors' keep working
 * unchanged.
 */
export { RedisUnavailableError, toRedisUnavailable } from '@ecommerce/shared-messaging'
