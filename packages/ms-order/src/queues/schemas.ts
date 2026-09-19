import type { FastifyReply } from 'fastify'
import { RedisUnavailableError } from './errors'
import { MAX_KEYS_RETURNED } from './cacheKeys'
import { JOB_STATES } from './definitions'

/**
 * JSON schema fragments and the shared 503 helper for the queue and cache
 * introspection routes.
 *
 * Both endpoints return 503 with a machine-readable `reason` when Redis is
 * unreachable — never an empty 200. An empty 200 renders in the admin as
 * "zero keys / zero jobs", which is indistinguishable from a healthy but empty
 * Redis. Distinguishing "no data" from "no connection" is the entire point.
 */

export const jobStateCountsSchema = {
  type: 'object',
  description: 'Job counts for exactly the five contract states; every key is always present.',
  properties: Object.fromEntries(JOB_STATES.map((s) => [s, { type: 'number' }])),
  required: [...JOB_STATES],
  additionalProperties: false,
} as const

export const recentJobSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    status: { type: 'string', enum: [...JOB_STATES] },
    attempts: { type: 'number' },
    maxAttempts: { type: 'number' },
    timestamp: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'name', 'status', 'attempts', 'maxAttempts', 'timestamp'],
} as const

export const serviceUnavailableSchema = {
  type: 'object',
  description: 'Redis is unreachable. Never returned as an empty 200.',
  properties: {
    error: { type: 'string' },
    reason: {
      type: 'string',
      description:
        'Machine-readable cause: redis_connection_refused | redis_timeout | ' +
        'redis_dns_failure | redis_auth_failure | redis_unavailable | ' +
        'redis_error | queues_closed | kv_driver_not_redis',
    },
    message: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
  },
  required: ['error', 'reason', 'message', 'timestamp'],
} as const

export const cacheTypeBreakdownSchema = {
  type: 'object',
  description: 'Key counts by Redis type; types outside the broken-out set fold into `other`.',
  properties: {
    hash: { type: 'number' },
    stream: { type: 'number' },
    string: { type: 'number' },
    zset: { type: 'number' },
    other: { type: 'number' },
  },
  required: ['hash', 'stream', 'string', 'zset', 'other'],
  additionalProperties: false,
} as const

export const cacheKeysQuerystringSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      maxLength: 200,
      default: '*',
      description: 'Redis glob passed to SCAN MATCH (e.g. "bull:order-expiration:*").',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_KEYS_RETURNED,
      default: MAX_KEYS_RETURNED,
    },
  },
  additionalProperties: false,
} as const

export const cacheKeySchema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    type: { type: 'string' },
    ttlSeconds: {
      type: 'number',
      description: 'Seconds to expiry; -1 = no expiry, -2 = key absent.',
    },
    // MUST stay ['number', 'null']. Under a plain { type: 'number' } Fastify's
    // serializer coerces null to 0, which renders in the admin as a measured
    // "0 B" for a key whose size could not be read — a fabricated number, which
    // is the exact defect these endpoints exist to eliminate.
    sizeBytes: {
      type: ['number', 'null'],
      description: 'Approximate bytes (MEMORY USAGE, sampled). null = not measurable.',
    },
  },
  required: ['key', 'type', 'ttlSeconds', 'sizeBytes'],
} as const

export function sendUnavailable(reply: FastifyReply, err: RedisUnavailableError): FastifyReply {
  return reply.status(503).send({
    error: 'Service Unavailable',
    reason: err.reason,
    message: err.message,
    timestamp: new Date().toISOString(),
  })
}
