import QueuesPanel from './queues/QueuesPanel'
import { QUEUE_DATA } from './queues/queueSeed'

export default function TaskQueuesTab() {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            Task Queues <span className="tag">BullMQ</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 2 }}>
            Async job queues backing order expiration, payment retries, notifications and saga
            compensation — driven by BullMQ over Redis (see Persistence &rarr; Overview &rarr; Task
            Queues). Queue definitions (description, concurrency, retry policy) live in Persistence
            &rarr; Task Queues.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
            Reload ↻
          </button>
        </div>
      </div>

      <QueuesPanel data={QUEUE_DATA} />
    </>
  )
}
