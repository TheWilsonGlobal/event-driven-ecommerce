import { useMemo, useState } from 'react'
import type { RustfsHealth, UserRecord, OrderRecord } from '../types'
import { type OpenSignal } from './config/parts'
import PersistencePanel from './config/PersistencePanel'
import TaskQueuesPanel from './config/TaskQueuesPanel'
import CachePanel, { CACHE_NAMESPACE_COUNT } from './config/CachePanel'
import SchemaPanel from './config/SchemaPanel'
import StoragePanel from './config/StoragePanel'
import { withLiveRowCounts } from './config/configSeed'
import { QUEUE_DATA } from './queues/queueSeed'

type PersistenceSubTab = 'overview' | 'queues' | 'cache' | 'schema' | 'storage'

export default function PersistenceTab({
  rustfsHealth,
  onPingRustFS,
  users,
  orders,
  objectCount,
}: {
  rustfsHealth: RustfsHealth
  onPingRustFS: () => void
  users: UserRecord[]
  orders: OrderRecord[]
  objectCount: number
}) {
  const [tab, setTab] = useState<PersistenceSubTab>('overview')

  const [openSignal, setOpenSignal] = useState<OpenSignal>({ open: false, nonce: 0 })
  const broadcast = (open: boolean) => setOpenSignal((prev) => ({ open, nonce: prev.nonce + 1 }))

  const hasCards = tab !== 'queues' && tab !== 'cache' && tab !== 'storage'

  const schemaData = useMemo(
    () =>
      withLiveRowCounts({
        users: users.length,
        addresses: users.reduce((sum, u) => sum + u.addresses.length, 0),
        orders: orders.length,
        orderItems: orders.reduce((sum, o) => sum + o.items.length, 0),
        payments: orders.filter((o) => Boolean(o.transactionId)).length,
      }),
    [users, orders]
  )

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="config-tabs">
            {(
              [
                ['overview', 'Overview'],
                ['queues', 'Task Queues'],
                ['cache', 'KV Cache'],
                ['schema', 'DB Schema'],
                ['storage', 'Storage'],
              ] as [PersistenceSubTab, string][]
            ).map(([key, label]) => {
              const count =
                key === 'schema'
                  ? schemaData.summary.tableCount
                  : key === 'queues'
                    ? QUEUE_DATA.summary.queueCount
                    : key === 'cache'
                      ? CACHE_NAMESPACE_COUNT
                      : key === 'storage'
                        ? objectCount
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
      {tab === 'schema' && <SchemaPanel schema={schemaData} openSignal={openSignal} />}
    </>
  )
}
