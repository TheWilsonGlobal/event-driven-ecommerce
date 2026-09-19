import { useMemo, useState } from 'react'
import type { JobState, QueueData, QueueInfo, RecentJob } from './queueTypes'
import { EmptyState, OfflineBanner, Spinner } from '../../components/ui'
import { describeError, type FetchError } from '../../hooks/useQueueData'

const NO_QUEUES: QueueInfo[] = []

const STATE_CHIPS: { state: JobState; label: string; tone: string }[] = [
  { state: 'waiting', label: 'Waiting', tone: 'chip-amber' },
  { state: 'active', label: 'Active', tone: 'chip-blue' },
  { state: 'completed', label: 'Completed', tone: 'chip-green' },
  { state: 'failed', label: 'Failed', tone: 'chip-red' },
  { state: 'delayed', label: 'Delayed', tone: 'chip-purple' },
]

function stateStatus(state: JobState): string {
  switch (state) {
    case 'completed':
      return 'status-healthy'
    case 'active':
      return 'status-pending'
    case 'delayed':
      return 'status-delayed'
    case 'failed':
      return 'status-failed'
    case 'waiting':
    default:
      return 'status-warning'
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

  // Null when there is no live payload. A reducer seeded with zeroes would
  // render `Waiting 0 · Active 0 · …` beside the offline banner, which is
  // pixel-identical to a healthy, genuinely-empty Redis — the exact
  // fabricated-number defect these panels exist to avoid. No data, no number.
  const stateCounts = useMemo(
    () =>
      data
        ? allQueues.reduce(
            (acc, q) => ({
              waiting: acc.waiting + q.counts.waiting,
              active: acc.active + q.counts.active,
              completed: acc.completed + q.counts.completed,
              failed: acc.failed + q.counts.failed,
              delayed: acc.delayed + q.counts.delayed,
            }),
            { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
          )
        : null,
    [data, allQueues]
  )
  const totalCount = stateCounts
    ? stateCounts.waiting +
      stateCounts.active +
      stateCounts.completed +
      stateCounts.failed +
      stateCounts.delayed
    : null

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
          {STATE_CHIPS.map(({ state, label, tone }) => (
            <button
              key={state}
              type="button"
              className={`chip ${tone} chip-btn${statusFilter === state ? ' chip-btn-active' : ''}`}
              onClick={() => setStatusFilter((prev) => (prev === state ? null : state))}
              disabled={!stateCounts}
              aria-pressed={statusFilter === state}
            >
              {label} {stateCounts ? stateCounts[state] : '—'}
            </button>
          ))}
          <button
            type="button"
            className={`chip chip-slate chip-btn${statusFilter === null ? ' chip-btn-active' : ''}`}
            onClick={() => setStatusFilter(null)}
            disabled={totalCount === null}
            aria-pressed={statusFilter === null}
          >
            Total {totalCount ?? '—'}
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
