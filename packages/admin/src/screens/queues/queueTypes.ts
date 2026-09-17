export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'

export type BackoffType = 'exponential' | 'fixed'

export interface RecentJob {
  id: string
  name: string
  status: JobState
  attempts: number
  maxAttempts: number
  timestamp: string
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
