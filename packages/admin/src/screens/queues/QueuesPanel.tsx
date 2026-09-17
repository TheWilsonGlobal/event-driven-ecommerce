import { useMemo, useState } from 'react'
import type { JobState, QueueData, QueueInfo, RecentJob } from './queueTypes'
import { EmptyState, OfflineBanner, Spinner } from '../../components/ui'
import { describeError, type FetchError } from '../../hooks/useQueueData'

const NO_QUEUES: QueueInfo[] = []

function stateStatus(state: JobState): string {
  switch (state) {
    case 'completed':
      return 'status-healthy'
    case 'active':
      return 'status-pending'
    case 'delayed':
      return 'status-delayed'
    case 'failed':
      return 'status-warning'
    case 'waiting':
    default:
      return 'status-waiting'
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

interface FlatJob extends RecentJob {
  service: string
  queue: string
}

export default function QueuesPanel({
  data,
  loading = false,
  error = null,
  onRetry,
}: {
  data: QueueData | null
  loading?: boolean
  error?: FetchError | null
  onRetry?: () => void
}) {
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobState | null>(null)

  // No fallback numbers: when there is no live payload the derived counts are
  // genuinely zero and the table is replaced by an explicit banner below.
  const allQueues = data?.queues ?? NO_QUEUES

  const queues = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return allQueues
    return allQueues.filter(
      (queue) =>
        queue.name.toLowerCase().includes(q) ||
        queue.service.toLowerCase().includes(q) ||
        queue.description.toLowerCase().includes(q)
    )
  }, [allQueues, filter])

  const jobs: FlatJob[] = useMemo(
    () =>
      queues
        .flatMap((queue: QueueInfo) =>
          queue.recentJobs.map((job) => ({ ...job, service: queue.service, queue: queue.name }))
        )
        .filter((job) => !statusFilter || job.status === statusFilter)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [queues, statusFilter]
  )

  const stateCounts = useMemo(
    () =>
      allQueues.reduce(
        (acc, q) => ({
          waiting: acc.waiting + q.counts.waiting,
          active: acc.active + q.counts.active,
          completed: acc.completed + q.counts.completed,
          failed: acc.failed + q.counts.failed,
          delayed: acc.delayed + q.counts.delayed,
        }),
        { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
      ),
    [allQueues]
  )
  const totalCount =
    stateCounts.waiting +
    stateCounts.active +
    stateCounts.completed +
    stateCounts.failed +
    stateCounts.delayed

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter queues by name, service or description..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <span className="chip chip-slate">Queues {data ? data.summary.queueCount : '—'}</span>
          <button
            type="button"
            className={`chip chip-red chip-btn${statusFilter === 'waiting' ? ' chip-btn-active' : ''}`}
            onClick={() => setStatusFilter((prev) => (prev === 'waiting' ? null : 'waiting'))}
          >
            Waiting {stateCounts.waiting}
          </button>
          <button
            type="button"
            className={`chip chip-blue chip-btn${statusFilter === 'active' ? ' chip-btn-active' : ''}`}
            onClick={() => setStatusFilter((prev) => (prev === 'active' ? null : 'active'))}
          >
            Active {stateCounts.active}
          </button>
          <button
            type="button"
            className={`chip chip-green chip-btn${statusFilter === 'completed' ? ' chip-btn-active' : ''}`}
            onClick={() => setStatusFilter((prev) => (prev === 'completed' ? null : 'completed'))}
          >
            Completed {stateCounts.completed}
          </button>
          <button
            type="button"
            className={`chip ${stateCounts.failed > 0 ? 'chip-amber' : 'chip-slate'} chip-btn${statusFilter === 'failed' ? ' chip-btn-active' : ''}`}
            onClick={() => setStatusFilter((prev) => (prev === 'failed' ? null : 'failed'))}
          >
            Failed {stateCounts.failed}
          </button>
          <button
            type="button"
            className={`chip chip-purple chip-btn${statusFilter === 'delayed' ? ' chip-btn-active' : ''}`}
            onClick={() => setStatusFilter((prev) => (prev === 'delayed' ? null : 'delayed'))}
          >
            Delayed {stateCounts.delayed}
          </button>
          <button
            type="button"
            className={`chip chip-slate chip-btn${statusFilter === null ? ' chip-btn-active' : ''}`}
            onClick={() => setStatusFilter(null)}
          >
            Total {totalCount}
          </button>
        </div>
      </div>

      {error ? (
        <OfflineBanner
          title={`Queue data unavailable — ${describeError(error)}`}
          detail={error.message}
          reason={error.reason ?? (error.status ? `HTTP ${error.status}` : 'network_error')}
          onRetry={onRetry}
          retrying={loading}
        />
      ) : loading && !data ? (
        <Spinner label="Loading live queue data…" />
      ) : !data ? (
        <EmptyState message="No queue data loaded yet." />
      ) : allQueues.length === 0 ? (
        <EmptyState message="ms-order reports no registered queues." />
      ) : queues.length === 0 ? (
        <EmptyState message={`No queues match "${filter}"`} />
      ) : jobs.length === 0 ? (
        <EmptyState
          message={
            statusFilter
              ? `No ${statusFilter} jobs right now.`
              : 'Queues are registered but hold no recent jobs.'
          }
        />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Service</th>
                <th>Queue</th>
                <th>Task Name</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={`${job.queue}-${job.id}`}>
                  <td className="mono">{job.id}</td>
                  <td>
                    <span className="chip chip-blue">{job.service}</span>
                  </td>
                  <td className="mono cell-muted">{job.queue}</td>
                  <td className="mono cell-muted">{job.name}</td>
                  <td>
                    <span className={`status ${stateStatus(job.status)}`}>{job.status}</span>
                  </td>
                  <td className="mono cell-muted">
                    {job.attempts}/{job.maxAttempts}
                  </td>
                  <td className="cell-muted">{fmtTime(job.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
