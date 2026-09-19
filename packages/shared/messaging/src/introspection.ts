import type { Queue, JobType } from 'bullmq'
import { JOB_STATES, type QueueDefinition } from './jobState'
import { toRecentJobView, type RecentJobView } from './jobView'
import { toRedisUnavailable, RedisUnavailableError } from './errors'

const MAX_RECENT_JOBS = 10

/** BullMQ job types we ask for when building the recentJobs list. */
const RECENT_JOB_TYPES: JobType[] = ['active', 'waiting', 'delayed', 'completed', 'failed']

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

  recentJobs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return {
    name: def.name,
    service: def.service,
    description: def.description,
    concurrency: def.concurrency,
    attempts: def.attempts,
    backoff: def.backoff,
    counts,
    recentJobs: recentJobs.slice(0, MAX_RECENT_JOBS),
  }
}
