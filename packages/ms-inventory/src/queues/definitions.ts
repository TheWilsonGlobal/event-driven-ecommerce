/**
 * Single source of truth for ms-inventory's BullMQ queue topology.
 *
 * Mirrors ms-product's definitions.ts. One queue today.
 */

import { JOB_STATES, type JobState, type BackoffType } from '@ecommerce/shared-messaging'

export { JOB_STATES, type JobState, type BackoffType }

export type QueueName = 'inventory-reconciliation'

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
    name: 'inventory-reconciliation',
    service: 'ms-inventory',
    description:
      'Releases a reservation that is still RESERVED after its TTL. Stock held for an ' +
      'order that never confirmed and never cancelled would otherwise be unsellable ' +
      'forever, because no event is ever going to arrive to free it.',
    concurrency: 3,
    attempts: 3,
    backoff: { type: 'exponential', delayMs: 5000 },
  },
] as const

export function getQueueDefinition(name: QueueName): QueueDefinition {
  const def = QUEUE_DEFINITIONS.find((d) => d.name === name)
  if (!def) {
    throw new Error(`Unknown queue definition: ${name}`)
  }
  return def
}
