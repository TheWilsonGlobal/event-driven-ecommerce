import { describeError } from '../describeError'

/** Thrown when Redis cannot serve a request; callers map this to HTTP 503. */
export class RedisUnavailableError extends Error {
  public readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'RedisUnavailableError'
    this.reason = reason
  }
}

/** Normalises any thrown error into a RedisUnavailableError with a reason code. */
export function toRedisUnavailable(err: unknown): RedisUnavailableError {
  if (err instanceof RedisUnavailableError) {
    return err
  }
  const message = describeError(err)

  // ioredis surfaces a dead server in a few distinct ways; give each a
  // machine-readable reason so a caller (e.g. an admin panel) can distinguish
  // them.
  if (/ECONNREFUSED/i.test(message)) {
    return new RedisUnavailableError(
      'redis_connection_refused',
      `Redis refused the connection: ${message}`
    )
  }
  if (/ETIMEDOUT|Command timed out|connect ETIMEDOUT/i.test(message)) {
    return new RedisUnavailableError('redis_timeout', `Redis command timed out: ${message}`)
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new RedisUnavailableError(
      'redis_dns_failure',
      `Redis host could not be resolved: ${message}`
    )
  }
  if (/Stream isn't writeable|enableOfflineQueue/i.test(message)) {
    return new RedisUnavailableError('redis_unavailable', `Redis is not connected: ${message}`)
  }
  if (/NOAUTH|WRONGPASS|ERR Client sent AUTH/i.test(message)) {
    return new RedisUnavailableError(
      'redis_auth_failure',
      `Redis authentication failed: ${message}`
    )
  }
  return new RedisUnavailableError('redis_error', message)
}
