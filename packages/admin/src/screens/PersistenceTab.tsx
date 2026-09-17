import { useState } from 'react'
import type { RustfsHealth } from '../types'
import { type OpenSignal } from './config/parts'
import PersistencePanel from './config/PersistencePanel'
import TaskQueuesPanel from './config/TaskQueuesPanel'
import CachePanel from './config/CachePanel'
import SchemaPanel from './config/SchemaPanel'
import { SCHEMA_DATA } from './config/configSeed'
import { QUEUE_DATA } from './queues/queueSeed'

type PersistenceSubTab = 'overview' | 'queues' | 'cache' | 'schema'

export default function PersistenceTab({
  rustfsHealth,
  onPingRustFS,
}: {
  rustfsHealth: RustfsHealth
  onPingRustFS: () => void
}) {
  const [tab, setTab] = useState<PersistenceSubTab>('overview')

  const [openSignal, setOpenSignal] = useState<OpenSignal>({ open: false, nonce: 0 })
  const broadcast = (open: boolean) => setOpenSignal((prev) => ({ open, nonce: prev.nonce + 1 }))

  const hasCards = tab !== 'queues' && tab !== 'cache'

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="config-tabs">
            {(
              [
                ['overview', 'Overview'],
                ['queues', 'Task Queues'],
                ['cache', 'Cache'],
                ['schema', 'DB Schema'],
              ] as [PersistenceSubTab, string][]
            ).map(([key, label]) => {
              const count =
                key === 'schema'
                  ? SCHEMA_DATA.summary.tableCount
                  : key === 'queues'
                    ? QUEUE_DATA.summary.queueCount
                    : undefined
              return (
                <button
                  key={key}
                  className={`filter-tab${tab === key ? ' active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  {label}
                  {count !== undefined && <span className="count">{count}</span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="toolbar-right">
          {hasCards && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => broadcast(true)}>
                Expand All
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => broadcast(false)}>
                Collapse All
              </button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>

      {tab === 'overview' && (
        <PersistencePanel
          rustfsHealth={rustfsHealth}
          openSignal={openSignal}
          onPingRustFS={onPingRustFS}
        />
      )}
      {tab === 'queues' && <TaskQueuesPanel data={QUEUE_DATA} />}
      {tab === 'cache' && <CachePanel />}
      {tab === 'schema' && <SchemaPanel schema={SCHEMA_DATA} openSignal={openSignal} />}
    </>
  )
}
