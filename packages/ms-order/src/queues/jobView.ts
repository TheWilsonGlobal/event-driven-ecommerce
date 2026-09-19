import type { Job } from 'bullmq'
import { JOB_STATES, type JobState } from './definitions'

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
 * `job.getState()` is the authoritative state; anything outside the contract's
 * five states (e.g. 'waiting-children', 'prioritized', 'unknown') is dropped
 * rather than coerced into a lie.
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

export function isContractJobState(state: string): state is JobState {
  return (JOB_STATES as readonly string[]).includes(state)
}
