import type { FastifyReply } from 'fastify'
import { RedisUnavailableError } from './errors'
import { JOB_STATES } from './jobState'

/**
 * JSON schema fragments and the shared 503 helper for a service's queue
 * introspection route.
 *
 * The route must return 503 with a machine-readable `reason` when Redis is
 * unreachable — never an empty 200. An empty 200 renders in the admin as
 * "zero jobs", which is indistinguishable from a healthy but empty Redis.
 * Distinguishing "no data" from "no connection" is the entire point.
 *
 * Promoted from ms-order's queues/schemas.ts 2026-09-19 (the cache-specific
 * fragments — cacheTypeBreakdownSchema, cacheKeysQuerystringSchema,
 * cacheKeySchema — stayed in ms-order; they describe its Redis key browser,
 * not queue mechanics that a second service would need).
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
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'When queue.add() created the job. Never changes after enqueue.',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      description:
        'The most recent thing that happened to the job (finished, or started ' +
        'an attempt, or — for a job still waiting/delayed — falls back to createdAt).',
    },
    // MUST stay ['string', 'null'] — see cacheKeySchema's sizeBytes for why:
    // a plain { type: 'string' } would have Fastify's serializer coerce null
    // to "", which renders as an empty-but-present error message rather than
    // "no error" for every non-failed job.
    failedReason: {
      type: ['string', 'null'],
      description: "The thrown error's message from the job's last failed attempt. null unless status is 'failed'.",
    },
  },
  required: ['id', 'name', 'status', 'attempts', 'maxAttempts', 'createdAt', 'updatedAt', 'failedReason'],
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

export const queuesResponseSchema = {
  type: 'object',
  properties: {
    queues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          service: { type: 'string' },
          description: { type: 'string' },
          concurrency: { type: 'number' },
          attempts: { type: 'number' },
          backoff: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['exponential', 'fixed'] },
              delayMs: { type: 'number' },
            },
            required: ['type', 'delayMs'],
          },
          counts: jobStateCountsSchema,
          recentJobs: { type: 'array', items: recentJobSchema },
        },
        required: [
          'name',
          'service',
          'description',
          'concurrency',
          'attempts',
          'backoff',
          'counts',
          'recentJobs',
        ],
      },
    },
    summary: {
      type: 'object',
      properties: {
        queueCount: { type: 'number' },
        totalJobs: { type: 'number' },
        failedCount: { type: 'number' },
        activeCount: { type: 'number' },
      },
      required: ['queueCount', 'totalJobs', 'failedCount', 'activeCount'],
    },
  },
  required: ['queues', 'summary'],
} as const

export function sendUnavailable(reply: FastifyReply, err: RedisUnavailableError): FastifyReply {
  return reply.status(503).send({
    error: 'Service Unavailable',
    reason: err.reason,
    message: err.message,
    timestamp: new Date().toISOString(),
  })
}
