import type { FastifyInstance, FastifyReply } from 'fastify'
import { QueueManager, RedisUnavailableError, toRedisUnavailable } from './queueManager'
import { getCacheNamespaceData } from './cacheNamespaces'
import { getCacheKeyData, MAX_KEYS_RETURNED } from './cacheKeys'
import { keyValueDriver, redisSettings } from './redisConnection'
import { JOB_STATES } from './definitions'

/**
 * Queue and cache introspection routes.
 *
 * Both endpoints return 503 with a machine-readable `reason` when Redis is
 * unreachable — never an empty 200. An empty 200 renders in the admin as
 * "zero keys / zero jobs", which is indistinguishable from a healthy but empty
 * Redis. Distinguishing "no data" from "no connection" is the entire point.
 */

const jobStateCountsSchema = {
  type: 'object',
  description: 'Job counts for exactly the five contract states; every key is always present.',
  properties: Object.fromEntries(JOB_STATES.map((s) => [s, { type: 'number' }])),
  required: [...JOB_STATES],
  additionalProperties: false,
} as const

const recentJobSchema = {
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

const serviceUnavailableSchema = {
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

const cacheTypeBreakdownSchema = {
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

const cacheKeysQuerystringSchema = {
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

const cacheKeySchema = {
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

function sendUnavailable(reply: FastifyReply, err: RedisUnavailableError): FastifyReply {
  return reply.status(503).send({
    error: 'Service Unavailable',
    reason: err.reason,
    message: err.message,
    timestamp: new Date().toISOString(),
  })
}

export function registerQueueRoutes(server: FastifyInstance, queueManager: QueueManager): void {
  server.get(
    '/api/v1/queues',
    {
      schema: {
        tags: ['queues'],
        description:
          'Live BullMQ queue introspection: per-queue configuration, job counts by state, ' +
          'and recent jobs. Returns 503 when Redis is unreachable.',
        response: {
          200: {
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
          },
          503: serviceUnavailableSchema,
        },
      },
    },
    async (_request, reply) => {
      const unavailable = await queueManager.checkRedis()
      if (unavailable) {
        return sendUnavailable(reply, unavailable)
      }

      try {
        return await queueManager.getQueueData()
      } catch (err) {
        return sendUnavailable(reply, toRedisUnavailable(err))
      }
    }
  )

  server.get(
    '/api/v1/cache/namespaces',
    {
      schema: {
        tags: ['cache'],
        description:
          'Real Redis key counts per namespace prefix, gathered with SCAN (never KEYS). ' +
          'Returns 503 when Redis is unreachable.',
        response: {
          200: {
            type: 'object',
            properties: {
              namespaces: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    prefix: { type: 'string' },
                    purpose: { type: 'string' },
                    keyCount: { type: 'number' },
                    truncated: {
                      type: 'boolean',
                      description:
                        'True when the SCAN hit its iteration ceiling; keyCount is then a floor.',
                    },
                    types: cacheTypeBreakdownSchema,
                    typesPartial: {
                      type: 'boolean',
                      description:
                        'True when only the first N keys were TYPE-probed, so the breakdown ' +
                        'covers a subset and does not sum to keyCount.',
                    },
                  },
                  required: [
                    'prefix',
                    'purpose',
                    'keyCount',
                    'truncated',
                    'types',
                    'typesPartial',
                  ],
                },
              },
              totalKeys: { type: 'number' },
              truncated: { type: 'boolean' },
              types: cacheTypeBreakdownSchema,
              typesPartial: { type: 'boolean' },
              backend: { type: 'string', enum: ['redis', 'embedded'] },
              scannedAt: { type: 'string', format: 'date-time' },
            },
            required: [
              'namespaces',
              'totalKeys',
              'truncated',
              'types',
              'typesPartial',
              'backend',
              'scannedAt',
            ],
          },
          503: serviceUnavailableSchema,
        },
      },
    },
    async (_request, reply) => {
      // checkKeyspace, not checkRedis: cache introspection is available on the
      // embedded driver too, whereas the queue endpoints genuinely are not.
      const unavailable = await queueManager.checkKeyspace()
      if (unavailable) {
        return sendUnavailable(reply, unavailable)
      }

      try {
        return await getCacheNamespaceData(queueManager.keyspaceInspector)
      } catch (err) {
        return sendUnavailable(reply, toRedisUnavailable(err))
      }
    }
  )

  server.get(
    '/api/v1/cache/keys',
    {
      schema: {
        tags: ['cache'],
        description:
          'Individual Redis keys with type, TTL and approximate size, gathered with SCAN ' +
          '(never KEYS) plus a pipelined TYPE/TTL/MEMORY USAGE per key. Sizes are sampled, ' +
          'so `sizeApproximate` is true whenever any size was measured; `sizeBytes` is null ' +
          'for a key whose size could not be read. Returns 503 when Redis is unreachable.',
        querystring: cacheKeysQuerystringSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              keys: { type: 'array', items: cacheKeySchema },
              totalKeys: { type: 'number' },
              truncated: {
                type: 'boolean',
                description: 'True when more keys exist than were returned.',
              },
              sizeApproximate: { type: 'boolean' },
              backend: { type: 'string', enum: ['redis', 'embedded'] },
              scannedAt: { type: 'string', format: 'date-time' },
            },
            required: ['keys', 'totalKeys', 'truncated', 'sizeApproximate', 'backend', 'scannedAt'],
          },
          503: serviceUnavailableSchema,
        },
      },
    },
    async (request, reply) => {
      const unavailable = await queueManager.checkKeyspace()
      if (unavailable) {
        return sendUnavailable(reply, unavailable)
      }

      const { pattern, limit } = request.query as { pattern?: string; limit?: number }

      try {
        return await getCacheKeyData(queueManager.keyspaceInspector, { pattern, limit })
      } catch (err) {
        return sendUnavailable(reply, toRedisUnavailable(err))
      }
    }
  )

  server.get(
    '/api/v1/cache/driver',
    {
      schema: {
        tags: ['cache'],
        description:
          'The key-value driver this process actually resolved at boot. Deliberately has no ' +
          '503 branch: it answers even when Redis is down, because "which driver is active" ' +
          'is exactly what an operator needs when the other endpoints are failing. Lets the ' +
          'admin report the real driver instead of hardcoding one.',
        response: {
          200: {
            type: 'object',
            properties: {
              driver: { type: 'string', enum: ['redis', 'rocksdb', 'embedded'] },
              backend: { type: 'string', enum: ['redis', 'embedded'] },
              label: { type: 'string' },
              host: { type: ['string', 'null'] },
              dataPath: { type: ['string', 'null'] },
              inMemory: { type: 'boolean' },
              queuesAvailable: {
                type: 'boolean',
                description: 'False on the embedded driver: BullMQ requires real Redis.',
              },
              loadError: { type: ['string', 'null'] },
            },
            required: [
              'driver',
              'backend',
              'label',
              'host',
              'dataPath',
              'inMemory',
              'queuesAvailable',
              'loadError',
            ],
          },
        },
      },
    },
    async () => {
      const info = queueManager.keyValueInfo()
      return {
        driver: keyValueDriver,
        backend: queueManager.keyspaceInspector.backend,
        label: info.label,
        host: info.backend === 'redis' ? `${redisSettings.host}:${redisSettings.port}` : null,
        dataPath: info.dataPath,
        inMemory: info.inMemory,
        queuesAvailable: queueManager.queuesAvailable,
        loadError: info.loadError,
      }
    }
  )
}
