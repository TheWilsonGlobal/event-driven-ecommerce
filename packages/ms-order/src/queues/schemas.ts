import { MAX_KEYS_RETURNED } from './cacheKeys'

/**
 * JSON schema fragments and the shared 503 helper for the queue and cache
 * introspection routes.
 *
 * Both endpoints return 503 with a machine-readable `reason` when Redis is
 * unreachable — never an empty 200. An empty 200 renders in the admin as
 * "zero keys / zero jobs", which is indistinguishable from a healthy but empty
 * Redis. Distinguishing "no data" from "no connection" is the entire point.
 *
 * jobStateCountsSchema/recentJobSchema/serviceUnavailableSchema/
 * sendUnavailable moved to @ecommerce/shared-messaging 2026-09-19 — ms-product
 * needed the identical fragments for its own queue route. The cache-specific
 * fragments below (ms-order's Redis key browser, not queue mechanics) stayed
 * here.
 */
export {
  jobStateCountsSchema,
  recentJobSchema,
  serviceUnavailableSchema,
  sendUnavailable,
} from '@ecommerce/shared-messaging'

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
