import type { Queue, JobType } from 'bullmq'
import { JOB_STATES, type QueueDefinition } from './jobState'
import { toRecentJobView, type RecentJobView } from './jobView'
import { toRedisUnavailable, RedisUnavailableError } from './errors'

/**
 * Matches (comfortably exceeds) the retention ceiling every queue sets via
 * `removeOnComplete: { count: 200 }` / `removeOnFail: { count: 200 }`
 * (queueManager.ts) — so "recent jobs" is effectively "every job BullMQ is
 * still retaining", not an arbitrary extra truncation on top of that. Was 10;
 * raised so the admin's job table can show the full history instead of a
 * fixed slice, with client-side pagination (QueuesPanel.tsx) handling the
 * display in pages of 10/25/50/100 instead.
 */
const MAX_RECENT_JOBS = 500

/** BullMQ job types we ask for when building the recentJobs list. */
const RECENT_JOB_TYPES: JobType[] = ['active', 'waiting', 'delayed', 'completed', 'failed']

/**
 * States that must survive the final slice below even when they're
 * low-frequency, because they're what an operator is most likely to be
 * looking for. 'failed' in particular: a single failed job can otherwise be
 * pushed out of a pure-recency top-10 by a burst of newer completed/delayed
 * jobs from an unrelated high-volume queue — the admin's Failed filter chip
 * would then show a real nonzero count with nothing behind it to inspect.
 */
const PRIORITY_STATES = new Set<string>(['failed', 'active'])

export interface QueueSnapshotCounts extends Record<(typeof JOB_STATES)[number], number> {}

export interface QueueInfoView {
  name: string
  service: string
  description: string
  concurrency: number
  attempts: number
  backoff: { type: 'exponential' | 'fixed'; delayMs: number }
  counts: QueueSnapshotCounts
  recentJobs: RecentJobView[]
}

export interface QueueDataView {
  queues: QueueInfoView[]
  summary: {
    queueCount: number
    totalJobs: number
    failedCount: number
    activeCount: number
  }
}

/**
 * Builds the full QueueData payload from live Redis state.
 *
 * Throws RedisUnavailableError when Redis cannot be reached — the caller
 * turns that into a 503. It must never degrade to zeros, because zeros are
 * indistinguishable from a genuinely empty queue.
 *
 * Promoted from ms-order's queues/introspection.ts 2026-09-19 — ms-product
 * needed the identical GET /api/v1/queues payload shape for its own queue.
 */
export async function buildQueueData<Name extends string>(
  definitions: readonly QueueDefinition<Name>[],
  queueFor: (name: Name) => Queue,
  closed: boolean
): Promise<QueueDataView> {
  if (closed) {
    throw new RedisUnavailableError('queues_closed', 'Queue manager has been shut down')
  }

  const queues: QueueInfoView[] = []

  try {
    for (const def of definitions) {
      queues.push(await getQueueInfo(def, queueFor(def.name)))
    }
  } catch (err) {
    throw toRedisUnavailable(err)
  }

  let totalJobs = 0
  let failedCount = 0
  let activeCount = 0
  for (const q of queues) {
    for (const state of JOB_STATES) {
      totalJobs += q.counts[state]
    }
    failedCount += q.counts.failed
    activeCount += q.counts.active
  }

  return {
    queues,
    summary: {
      queueCount: queues.length,
      totalJobs,
      failedCount,
      activeCount,
    },
  }
}

async function getQueueInfo<Name extends string>(
  def: QueueDefinition<Name>,
  queue: Queue
): Promise<QueueInfoView> {
  const [rawCounts, jobs] = await Promise.all([
    queue.getJobCounts(),
    queue.getJobs(RECENT_JOB_TYPES, 0, MAX_RECENT_JOBS - 1, false),
  ])

  // getJobCounts() also returns 'paused', 'waiting-children' and
  // 'prioritized'. The contract is exactly the five JobStates, and every one
  // of them must be present as a number even when zero.
  const counts = JOB_STATES.reduce((acc, state) => {
    const value = rawCounts[state]
    acc[state] = typeof value === 'number' ? value : 0
    return acc
  }, {} as QueueSnapshotCounts)

  const recentJobs: RecentJobView[] = []
  for (const job of jobs) {
    if (!job) {
      continue
    }
    const view = await toRecentJobView(job, def.attempts)
    if (view) {
      recentJobs.push(view)
    }
  }

  recentJobs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return {
    name: def.name,
    service: def.service,
    description: def.description,
    concurrency: def.concurrency,
    attempts: def.attempts,
    backoff: def.backoff,
    counts,
    recentJobs: pickRecentJobs(recentJobs),
  }
}

/**
 * Slices the merged, recency-sorted job list down to MAX_RECENT_JOBS without
 * silently dropping a priority state (see PRIORITY_STATES) that a pure
 * recency cut would otherwise squeeze out — e.g. one failed job among 200+
 * completed ones. Priority-state jobs (already recency-sorted among
 * themselves) are kept in full, up to the cap; the remaining slots are
 * filled with the most recent jobs of any other state.
 */
function pickRecentJobs(sorted: RecentJobView[]): RecentJobView[] {
  if (sorted.length <= MAX_RECENT_JOBS) {
    return sorted
  }

  const priority = sorted.filter((j) => PRIORITY_STATES.has(j.status))
  const rest = sorted.filter((j) => !PRIORITY_STATES.has(j.status))

  const kept = [...priority.slice(0, MAX_RECENT_JOBS), ...rest].slice(0, MAX_RECENT_JOBS)
  kept.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  return kept
}
