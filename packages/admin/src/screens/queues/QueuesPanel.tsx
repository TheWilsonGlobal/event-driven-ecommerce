import { useMemo, useState } from 'react'
import type { JobState, QueueData, QueueInfo, RecentJob } from './queueTypes'
import { EmptyState } from '../../components/ui'

function stateStatus(state: JobState): string {
  switch (state) {
    case 'completed':
      return 'status-healthy'
    case 'active':
      return 'status-pending'
    case 'delayed':
      return 'status-warning'
    case 'failed':
      return 'status-failed'
    case 'waiting':
    default:
      return 'status-offline'
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

interface FlatJob extends RecentJob {
  service: string
  queue: string
}

export default function QueuesPanel({ data }: { data: QueueData }) {
  const [filter, setFilter] = useState('')

  const queues = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return data.queues
    return data.queues.filter(
      (queue) =>
        queue.name.toLowerCase().includes(q) ||
        queue.service.toLowerCase().includes(q) ||
        queue.description.toLowerCase().includes(q)
    )
  }, [data, filter])

  const jobs: FlatJob[] = useMemo(
    () =>
      queues
        .flatMap((queue: QueueInfo) =>
          queue.recentJobs.map((job) => ({ ...job, service: queue.service, queue: queue.name }))
        )
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [queues]
  )

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
          <span className="chip chip-slate">Queues {data.summary.queueCount}</span>
          <span className="chip chip-blue">Total Jobs {data.summary.totalJobs}</span>
          <span className="chip chip-purple">Active {data.summary.activeCount}</span>
          <span className={`chip ${data.summary.failedCount > 0 ? 'chip-amber' : 'chip-slate'}`}>
            Failed {data.summary.failedCount}
          </span>
        </div>
      </div>

      {queues.length === 0 ? (
        <EmptyState message={`No queues match "${filter}"`} />
      ) : jobs.length === 0 ? (
        <EmptyState message="No recent jobs for the current filter." />
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
