import type { Queue, JobType } from 'bullmq'
import { JOB_STATES, type QueueName, type QueueDefinition } from './definitions'
import { toRecentJobView, type RecentJobView } from './jobView'
import { toRedisUnavailable, RedisUnavailableError } from './errors'
import type { QueueSnapshotCounts, QueueInfoView, QueueDataView } from './queueViews'

const MAX_RECENT_JOBS = 10

/** BullMQ job types we ask for when building the recentJobs list. */
const RECENT_JOB_TYPES: JobType[] = ['active', 'waiting', 'delayed', 'completed', 'failed']

/**
 * Builds the full QueueData payload from live Redis state.
 *
 * Throws RedisUnavailableError when Redis cannot be reached — the caller
 * turns that into a 503. It must never degrade to zeros, because zeros are
 * indistinguishable from a genuinely empty queue.
 */
export async function buildQueueData(
  definitions: readonly QueueDefinition[],
  queueFor: (name: QueueName) => Queue,
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

async function getQueueInfo(def: QueueDefinition, queue: Queue): Promise<QueueInfoView> {
  const [rawCounts, jobs] = await Promise.all([
    queue.getJobCounts(),
    queue.getJobs(RECENT_JOB_TYPES, 0, MAX_RECENT_JOBS - 1, false),
  ])

  // getJobCounts() also returns 'paused', 'waiting-children' and
  // 'prioritized'. The admin contract is exactly the five JobStates, and
  // every one of them must be present as a number even when zero.
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
