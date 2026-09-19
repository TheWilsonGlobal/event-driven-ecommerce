/**
 * The 5-state BullMQ job contract shared by every service's queue reporting.
 *
 * BullMQ's own `getJobCounts()` also returns `paused`, `waiting-children` and
 * `prioritized`. No service in this repo uses those features, and admin-facing
 * consumers should only ever see these five — never coerce an out-of-contract
 * state into one of these, drop it instead (see `isContractJobState`).
 */
export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'

export type BackoffType = 'exponential' | 'fixed'

/** The five states, in display order. */
export const JOB_STATES: readonly JobState[] = [
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
] as const

export function isContractJobState(state: string): state is JobState {
  return (JOB_STATES as readonly string[]).includes(state)
}

/** Generic per-queue definition shape. Services extend this with their own QueueName union. */
export interface QueueDefinition<Name extends string = string> {
  name: Name
  service: string
  description: string
  concurrency: number
  attempts: number
  backoff: { type: BackoffType; delayMs: number }
}
