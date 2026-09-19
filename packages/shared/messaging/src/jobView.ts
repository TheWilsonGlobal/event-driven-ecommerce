import type { Job } from 'bullmq'
import { JOB_STATES, isContractJobState, type JobState } from './jobState'

export interface RecentJobView {
  id: string
  name: string
  status: JobState
  attempts: number
  maxAttempts: number
  timestamp: string
}

/**
 * Maps a BullMQ Job onto the admin's RecentJob shape.
 *
 * `job.getState()` is the authoritative state; anything outside the 5-state
 * contract (e.g. 'waiting-children', 'prioritized', 'unknown') is dropped
 * rather than coerced into a lie.
 *
 * Promoted from ms-order's queues/jobView.ts 2026-09-19 — ms-product needed
 * the identical mapping for its own /api/v1/queues route.
 */
export async function toRecentJobView(
  job: Job,
  maxAttempts: number
): Promise<RecentJobView | null> {
  let state: string
  try {
    state = await job.getState()
  } catch {
    return null
  }

  if (!isContractJobState(state)) {
    return null
  }

  // processedOn/finishedOn are more meaningful than enqueue time for jobs that
  // have run; fall back to the enqueue timestamp for waiting/delayed jobs.
  const ts = job.finishedOn ?? job.processedOn ?? job.timestamp

  return {
    id: String(job.id ?? ''),
    name: job.name,
    status: state,
    attempts: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? maxAttempts,
    timestamp: new Date(ts).toISOString(),
  }
}

export { JOB_STATES }
