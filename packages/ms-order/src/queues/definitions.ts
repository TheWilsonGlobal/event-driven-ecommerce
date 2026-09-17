/**
 * Single source of truth for ms-order's BullMQ queue topology.
 *
 * These values are BOTH the settings the queues/workers actually run with AND
 * the values reported by GET /api/v1/queues. The admin panel previously
 * hardcoded its own copy of this table; it should now read it from the API so
 * the two cannot drift.
 */

export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'

export type BackoffType = 'exponential' | 'fixed'

/** The five states the admin contract enumerates, in display order. */
export const JOB_STATES: readonly JobState[] = [
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
] as const

export type QueueName =
  | 'order-expiration'
  | 'payment-retry'
  | 'notification-dispatch'
  | 'saga-compensation'

export interface QueueDefinition {
  name: QueueName
  service: string
  description: string
  concurrency: number
  attempts: number
  backoff: { type: BackoffType; delayMs: number }
}

export const QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: 'order-expiration',
    service: 'ms-order',
    description: 'Cancels PENDING orders that were never paid within the expiration window.',
    concurrency: 10,
    attempts: 3,
    backoff: { type: 'exponential', delayMs: 5000 },
  },
  {
    name: 'payment-retry',
    service: 'ms-order',
    description: 'Retries failed Stripe/PayPal payment captures with backoff before refunding.',
    concurrency: 5,
    attempts: 5,
    backoff: { type: 'exponential', delayMs: 10000 },
  },
  {
    name: 'notification-dispatch',
    service: 'ms-order',
    description: 'Sends order confirmation / receipt emails and generates PDF receipts.',
    concurrency: 10,
    attempts: 4,
    backoff: { type: 'fixed', delayMs: 3000 },
  },
  {
    name: 'saga-compensation',
    service: 'ms-order',
    description:
      'Runs compensating actions (release inventory, refund payment) when an order saga step fails.',
    concurrency: 5,
    attempts: 5,
    backoff: { type: 'exponential', delayMs: 8000 },
  },
] as const

export function getQueueDefinition(name: QueueName): QueueDefinition {
  const def = QUEUE_DEFINITIONS.find((d) => d.name === name)
  if (!def) {
    throw new Error(`Unknown queue definition: ${name}`)
  }
  return def
}

/**
 * Delay applied to `expire-order` jobs, from BULLMQ_ORDER_EXPIRATION_MINUTES
 * (root .env, default 15 minutes).
 */
export function orderExpirationDelayMs(): number {
  const minutes = parseInt(process.env.BULLMQ_ORDER_EXPIRATION_MINUTES ?? '15', 10)
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 15
  return safeMinutes * 60 * 1000
}

/**
 * Redis key prefixes reported by GET /api/v1/cache/namespaces.
 *
 * The four `bull:*` prefixes are real keyspaces owned by the queues above. The
 * remaining three are namespaces other services own (ms-product cache-aside,
 * ms-user sessions, gateway rate-limit counters). They are scanned for real:
 * if those services are not writing to Redis the count is honestly 0, which is
 * the point — an empty namespace must read as empty, not as a fabricated number.
 *
 * `purpose` strings are carried over verbatim from the admin CachePanel so the
 * UI copy survives the move from mock to API.
 */
export interface CacheNamespaceDefinition {
  prefix: string
  purpose: string
}

export const CACHE_NAMESPACES: readonly CacheNamespaceDefinition[] = [
  {
    prefix: 'bull:order-expiration:*',
    purpose: 'BullMQ job data, state sets & events for the order-expiration queue',
  },
  {
    prefix: 'bull:payment-retry:*',
    purpose: 'BullMQ job data, state sets & events for the payment-retry queue',
  },
  {
    prefix: 'bull:notification-dispatch:*',
    purpose: 'BullMQ job data, state sets & events for the notification-dispatch queue',
  },
  {
    prefix: 'bull:saga-compensation:*',
    purpose: 'BullMQ job data, state sets & events for the saga-compensation queue',
  },
  {
    prefix: 'cache:products:*',
    purpose: 'Cache-aside entries for ms-product catalog reads (product & category lookups)',
  },
  {
    prefix: 'session:*',
    purpose: 'Short-lived refresh-token / session lookups issued by ms-user',
  },
  {
    prefix: 'ratelimit:*',
    purpose: 'API gateway rate-limit counters (100 req/min window per client)',
  },
] as const
