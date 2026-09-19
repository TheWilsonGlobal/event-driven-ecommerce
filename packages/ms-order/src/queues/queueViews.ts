import type { JobState } from './definitions'
import type { RecentJobView } from './jobView'

export interface QueueSnapshotCounts extends Record<JobState, number> {}

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
