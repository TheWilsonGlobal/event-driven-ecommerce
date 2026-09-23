import type { Job } from 'bullmq'
import { JOB_STATES, isContractJobState, type JobState } from './jobState'

export interface RecentJobView {
  id: string
  name: string
  status: JobState
  attempts: number
  maxAttempts: number
  /** When queue.add() created the job. Never changes after enqueue. */
  createdAt: string
  /**
   * The most recent thing that happened to the job: finishedOn (reached
   * completed/failed) if set, else processedOn (a worker started an attempt)
   * if set, else falls back to createdAt for a job still waiting/delayed
   * that a worker hasn't touched yet. Distinct from createdAt so a retried
   * job's row reflects its latest attempt, not its original enqueue time.
   */
  updatedAt: string
  /**
   * The thrown error's message from the job's last failed attempt —
   * job.failedReason, BullMQ's own field. null for every status except
   * 'failed' (a job that's still retrying has attemptsMade > 0 but isn't
   * status 'failed' yet, so this stays null until the final attempt is
   * actually exhausted).
   */
  failedReason: string | null
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

  const updatedTs = job.finishedOn ?? job.processedOn ?? job.timestamp

  return {
    id: String(job.id ?? ''),
    name: job.name,
    status: state,
    attempts: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? maxAttempts,
    createdAt: new Date(job.timestamp).toISOString(),
    updatedAt: new Date(updatedTs).toISOString(),
    failedReason: state === 'failed' ? (job.failedReason ?? null) : null,
  }
}

export { JOB_STATES }
