export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'

export type BackoffType = 'exponential' | 'fixed'

export interface RecentJob {
  id: string
  name: string
  status: JobState
  attempts: number
  maxAttempts: number
  /** When the job was enqueued. Never changes after that. */
  createdAt: string
  /** Finished, or last attempt started, or falls back to createdAt if neither has happened yet. */
  updatedAt: string
  /** The thrown error's message from the job's last failed attempt. null unless status is 'failed'. */
  failedReason: string | null
}

export interface QueueInfo {
  name: string
  service: string
  description: string
  concurrency: number
  attempts: number
  backoff: {
    type: BackoffType
    delayMs: number
  }
  counts: Record<JobState, number>
  recentJobs: RecentJob[]
}

export interface QueueData {
  queues: QueueInfo[]
  summary: {
    queueCount: number
    totalJobs: number
    failedCount: number
    activeCount: number
  }
}
