import { useState } from 'react'
import type { OpenSignal } from './config/parts'
import QueuesPanel from './queues/QueuesPanel'
import { QUEUE_DATA } from './queues/queueSeed'

export default function TaskQueuesTab() {
  // Broadcast to every ConfigCard, same pattern as ConfigTab.tsx.
  const [openSignal, setOpenSignal] = useState<OpenSignal>({ open: false, nonce: 0 })
  const broadcast = (open: boolean) => setOpenSignal((prev) => ({ open, nonce: prev.nonce + 1 }))

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            Task Queues <span className="tag">BullMQ</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            Async job queues backing order expiration, payment retries, notifications and saga
            compensation — driven by BullMQ over Redis (see Persistence &rarr; KV Cache & Queues).
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => broadcast(true)}>
            Expand All
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => broadcast(false)}>
            Collapse All
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
            Reload ↻
          </button>
        </div>
      </div>

      <QueuesPanel data={QUEUE_DATA} openSignal={openSignal} />
    </>
  )
}
