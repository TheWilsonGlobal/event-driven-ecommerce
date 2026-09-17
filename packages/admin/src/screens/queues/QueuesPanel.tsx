import { useMemo, useState } from 'react'
import type { JobState, QueueData } from './queueTypes'
import { ConfigCard, type OpenSignal } from '../config/parts'
import { EmptyState } from '../../components/ui'

const STATE_ORDER: JobState[] = ['waiting', 'active', 'completed', 'failed', 'delayed']

const STATE_LABEL: Record<JobState, string> = {
  waiting: 'Waiting',
  active: 'Active',
  completed: 'Completed',
  failed: 'Failed',
  delayed: 'Delayed',
}

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

export default function QueuesPanel({
  data,
  openSignal,
}: {
  data: QueueData
  openSignal?: OpenSignal
}) {
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
      ) : (
        queues.map((queue) => {
          const total = STATE_ORDER.reduce((sum, s) => sum + queue.counts[s], 0)
          return (
            <ConfigCard
              key={queue.name}
              openSignal={openSignal}
              title={
                <>
                  <span className="chip chip-blue">{queue.service}</span>
                  <span className="mono">{queue.name}</span>
                </>
              }
              defaultOpen={false}
              metrics={
                <>
                  {STATE_ORDER.map((s) => (
                    <span key={s} className={queue.counts[s] ? undefined : 'metric-empty'}>
                      {queue.counts[s] ? (
                        <>
                          <b>{queue.counts[s]}</b> {s}
                        </>
                      ) : (
                        ''
                      )}
                    </span>
                  ))}
                  <span>
                    <b>{total}</b> total
                  </span>
                </>
              }
            >
              <div className="config-row">
                <span className="k">Description</span>
                <span className="v" style={{ fontWeight: 400, color: 'var(--text-dim)' }}>
                  {queue.description}
                </span>
              </div>
              <div className="config-row">
                <span className="k">Worker Concurrency</span>
                <span className="v mono">{queue.concurrency} workers</span>
              </div>
              <div className="config-row">
                <span className="k">Retry Policy</span>
                <span className="v mono">
                  {queue.attempts} attempts, {queue.backoff.type} backoff (
                  {queue.backoff.delayMs.toLocaleString()} ms base delay)
                </span>
              </div>

              <div className="section-title spaced">Job Counts by State</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                {STATE_ORDER.map((s) => (
                  <div
                    key={s}
                    className="stat-card"
                    style={{ padding: '8px 10px', gap: 2, boxShadow: 'none' }}
                  >
                    <div className="label">{STATE_LABEL[s]}</div>
                    <div
                      className={`value ${
                        s === 'failed'
                          ? 'red'
                          : s === 'completed'
                            ? 'green'
                            : s === 'delayed'
                              ? 'yellow'
                              : 'blue'
                      }`}
                      style={{ fontSize: 18 }}
                    >
                      {queue.counts[s]}
                    </div>
                  </div>
                ))}
              </div>

              <div className="section-title spaced">Recent Jobs</div>
              <div className="table-wrapper" style={{ marginTop: 4 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Job ID</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.recentJobs.map((job) => (
                      <tr key={job.id}>
                        <td className="mono">{job.id}</td>
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
            </ConfigCard>
          )
        })
      )}
    </>
  )
}
