/**
 * Single source of truth for ms-product's BullMQ queue topology.
 *
 * Mirrors the pattern established in ms-order's queues/definitions.ts. One
 * queue today — reindex-search — with room to add more (e.g. image
 * processing) the same way.
 */

import { JOB_STATES, type JobState, type BackoffType } from '@ecommerce/shared-messaging'

export { JOB_STATES, type JobState, type BackoffType }

export type QueueName = 'reindex-search'

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
    name: 'reindex-search',
    service: 'ms-product',
    description:
      'Mirrors a product create/update/delete into Elasticsearch in the background, ' +
      'with retry, instead of the inline best-effort call the write route used to make.',
    concurrency: 5,
    attempts: 5,
    backoff: { type: 'exponential', delayMs: 3000 },
  },
] as const

export function getQueueDefinition(name: QueueName): QueueDefinition {
  const def = QUEUE_DEFINITIONS.find((d) => d.name === name)
  if (!def) {
    throw new Error(`Unknown queue definition: ${name}`)
  }
  return def
}
