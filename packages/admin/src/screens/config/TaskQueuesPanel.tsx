import { useMemo, useState } from 'react'
import type { QueueData } from '../queues/queueTypes'
import { EmptyState } from '../../components/ui'
import { WorkersIcon, RetryIcon, BackoffIcon, DelayIcon } from '../../components/icons'

export default function TaskQueuesPanel({ data }: { data: QueueData }) {
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

  const stateCounts = useMemo(
    () =>
      data.queues.reduce(
        (acc, q) => ({
          waiting: acc.waiting + q.counts.waiting,
          active: acc.active + q.counts.active,
          completed: acc.completed + q.counts.completed,
          failed: acc.failed + q.counts.failed,
          delayed: acc.delayed + q.counts.delayed,
        }),
        { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
      ),
    [data]
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
          <span className="chip chip-slate">Queues {data.summary.queueCount}</span>
          <span className="chip chip-red">Waiting {stateCounts.waiting}</span>
          <span className="chip chip-blue">Active {stateCounts.active}</span>
          <span className="chip chip-green">Completed {stateCounts.completed}</span>
          <span className={`chip ${stateCounts.failed > 0 ? 'chip-amber' : 'chip-slate'}`}>
            Failed {stateCounts.failed}
          </span>
          <span className="chip chip-purple">Delayed {stateCounts.delayed}</span>
          <span className="chip chip-slate">Total {totalCount}</span>
        </div>
      </div>

      {queues.length === 0 ? (
        <EmptyState message={`No queues match "${filter}"`} />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Queue Name</th>
                <th>Description</th>
                <th className="cell-right" title="Worker Concurrency">
                  <WorkersIcon style={{ width: 14, height: 14 }} />
                </th>
                <th className="cell-right" title="Retry Attempts">
                  <RetryIcon style={{ width: 14, height: 14 }} />
                </th>
                <th className="cell-center" title="Backoff">
                  <BackoffIcon style={{ width: 14, height: 14 }} />
                </th>
                <th className="cell-right" title="Base Delay">
                  <DelayIcon style={{ width: 14, height: 14 }} />
                </th>
                <th className="cell-right" style={{ color: 'var(--red-light)' }}>
                  Waiting
                </th>
                <th className="cell-right" style={{ color: 'var(--blue-light)' }}>
                  Active
                </th>
                <th className="cell-right" style={{ color: 'var(--green-light)' }}>
                  Completed
                </th>
                <th className="cell-right" style={{ color: 'var(--amber-light)' }}>
                  Failed
                </th>
                <th className="cell-right" style={{ color: 'var(--purple)' }}>
                  Delayed
                </th>
                <th className="cell-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((queue) => {
                const total =
                  queue.counts.waiting +
                  queue.counts.active +
                  queue.counts.completed +
                  queue.counts.failed +
                  queue.counts.delayed
                return (
                  <tr key={queue.name}>
                    <td>
                      <span className="chip chip-blue">{queue.service.replace(/^ms-/, '')}</span>
                    </td>
                    <td className="mono">{queue.name}</td>
                    <td className="cell-muted">{queue.description}</td>
                    <td
                      className="mono cell-right cell-muted"
                      title={`${queue.concurrency} workers`}
                    >
                      {queue.concurrency}
                    </td>
                    <td className="mono cell-right cell-muted" title={`${queue.attempts} attempts`}>
                      {queue.attempts}
                    </td>
                    <td className="cell-center" title={`${queue.backoff.type} backoff`}>
                      <span
                        className={`chip ${queue.backoff.type === 'exponential' ? 'chip-purple' : 'chip-slate'}`}
                      >
                        {queue.backoff.type === 'exponential' ? 'exp' : 'fixed'}
                      </span>
                    </td>
                    <td
                      className="mono cell-right cell-muted"
                      title={`${queue.backoff.delayMs.toLocaleString()} ms base delay`}
                    >
                      {queue.backoff.delayMs.toLocaleString()}
                    </td>
                    <td className="mono cell-right" style={{ color: 'var(--red-light)' }}>
                      {queue.counts.waiting}
                    </td>
                    <td className="mono cell-right" style={{ color: 'var(--blue-light)' }}>
                      {queue.counts.active}
                    </td>
                    <td className="mono cell-right" style={{ color: 'var(--green-light)' }}>
                      {queue.counts.completed}
                    </td>
                    <td
                      className="mono cell-right"
                      style={{
                        color: queue.counts.failed > 0 ? 'var(--amber-light)' : 'var(--text-faint)',
                      }}
                    >
                      {queue.counts.failed}
                    </td>
                    <td className="mono cell-right" style={{ color: 'var(--purple)' }}>
                      {queue.counts.delayed}
                    </td>
                    <td className="mono cell-right" style={{ fontWeight: 700 }}>
                      {total}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
