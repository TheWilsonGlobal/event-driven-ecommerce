import { describeError } from '../describeError'

/**
 * Thrown when Kafka cannot serve a request; callers map this to HTTP 503.
 *
 * Deliberately parallel to RedisUnavailableError (errors.ts) — same shape, same
 * `reason` discipline, so the admin's error rendering works identically for
 * both backends and an operator learns one vocabulary, not two.
 */
export class KafkaUnavailableError extends Error {
  public readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'KafkaUnavailableError'
    this.reason = reason
  }
}

/**
 * The reason codes this module can emit.
 *
 * `kafka_disabled` is NOT an error state and must never be returned as a 503 —
 * it means KAFKA_ENABLED=false, which is this repo's default and a perfectly
 * healthy configuration. It is in this union because the admin renders it, and
 * the route layer returns it as a 200 with `enabled: false`. Collapsing
 * "switched off" into "unreachable" would make a working default look broken.
 */
export type KafkaUnavailableReason =
  | 'kafka_disabled'
  | 'kafka_connection_refused'
  | 'kafka_timeout'
  | 'kafka_broker_unavailable'
  | 'kafka_dns_failure'
  | 'kafka_auth_failure'
  | 'kafka_error'
  | 'kafka_producer_disconnected'

/** Normalises any thrown error into a KafkaUnavailableError with a reason code. */
export function toKafkaUnavailable(err: unknown): KafkaUnavailableError {
  if (err instanceof KafkaUnavailableError) {
    return err
  }
  const message = describeError(err)

  if (/ECONNREFUSED/i.test(message)) {
    return new KafkaUnavailableError(
      'kafka_connection_refused',
      `Kafka refused the connection: ${message}`
    )
  }
  if (/ETIMEDOUT|timed out|Connection timeout|Request timed out/i.test(message)) {
    return new KafkaUnavailableError('kafka_timeout', `Kafka request timed out: ${message}`)
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return new KafkaUnavailableError(
      'kafka_dns_failure',
      `Kafka broker host could not be resolved: ${message}`
    )
  }
  // kafkajs' own broker-pool errors when no broker in the seed list answers, or
  // when the cluster is reachable but has no leader for a partition yet.
  if (
    /There is no leader|Broker not connected|KafkaJSNumberOfRetriesExceeded|no brokers|Connection error/i.test(
      message
    )
  ) {
    return new KafkaUnavailableError(
      'kafka_broker_unavailable',
      `No Kafka broker is available: ${message}`
    )
  }
  if (/SASL|Authentication|authoriz/i.test(message)) {
    return new KafkaUnavailableError(
      'kafka_auth_failure',
      `Kafka authentication failed: ${message}`
    )
  }
  return new KafkaUnavailableError('kafka_error', message)
}
