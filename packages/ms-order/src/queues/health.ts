import type IORedis from 'ioredis'
import { getLastRedisError, isConnectionUsable, keyValueDriver } from './redisConnection'
import { RedisUnavailableError, toRedisUnavailable } from './errors'

/**
 * Live ping used by the routes to fail fast before doing real work.
 * Returns null when healthy, or a RedisUnavailableError when not.
 */
export async function checkRedis(
  closed: boolean,
  redisEnabled: boolean,
  producerConnection: IORedis | undefined
): Promise<RedisUnavailableError | null> {
  if (closed) {
    return new RedisUnavailableError('queues_closed', 'Queue manager has been shut down')
  }
  if (!redisEnabled || !producerConnection) {
    return new RedisUnavailableError(
      'kv_driver_not_redis',
      `ms-order is configured with KV_CACHE_DRIVER=${keyValueDriver}; BullMQ requires Redis.`
    )
  }
  if (!isConnectionUsable(producerConnection)) {
    const last = getLastRedisError()
    // Classify via the last connection error where we have one, so the
    // reason code is specific (redis_connection_refused) rather than the
    // generic redis_unavailable.
    if (last) {
      return toRedisUnavailable(last)
    }
    return new RedisUnavailableError(
      'redis_unavailable',
      `Redis is unreachable (connection status: ${producerConnection.status})`
    )
  }
  try {
    await producerConnection.ping()
    return null
  } catch (err) {
    return toRedisUnavailable(err)
  }
}

/**
 * Readiness gate for the CACHE endpoints, as distinct from checkRedis().
 *
 * The embedded store is always reachable, so cache introspection stays
 * available on that driver even though the queue endpoints do not.
 */
export async function checkKeyspace(
  closed: boolean,
  redisEnabled: boolean,
  producerConnection: IORedis | undefined
): Promise<RedisUnavailableError | null> {
  if (closed) {
    return new RedisUnavailableError('queues_closed', 'Queue manager has been shut down')
  }
  if (!redisEnabled) {
    return null
  }
  return checkRedis(closed, redisEnabled, producerConnection)
}
