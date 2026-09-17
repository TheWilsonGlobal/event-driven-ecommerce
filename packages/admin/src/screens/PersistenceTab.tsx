import { useMemo, useState } from 'react'
import type { RustfsHealth, UserRecord, OrderRecord } from '../types'
import { type OpenSignal } from './config/parts'
import PersistencePanel from './config/PersistencePanel'
import TaskQueuesPanel from './config/TaskQueuesPanel'
import CachePanel from './config/CachePanel'
import SchemaPanel from './config/SchemaPanel'
import { withLiveRowCounts } from './config/configSeed'
import { useCacheKeys, useCacheNamespaces, useQueueData } from '../hooks/useQueueData'

type PersistenceSubTab = 'overview' | 'queues' | 'cache' | 'schema'

export default function PersistenceTab({
  rustfsHealth,
  onPingRustFS,
  users,
  orders,
}: {
  rustfsHealth: RustfsHealth
  onPingRustFS: () => void
  users: UserRecord[]
  orders: OrderRecord[]
}) {
  const [tab, setTab] = useState<PersistenceSubTab>('overview')

  const queues = useQueueData()
  const cache = useCacheNamespaces()
  const cacheKeys = useCacheKeys()

  const [openSignal, setOpenSignal] = useState<OpenSignal>({ open: false, nonce: 0 })
  const broadcast = (open: boolean) => setOpenSignal((prev) => ({ open, nonce: prev.nonce + 1 }))

  const hasCards = tab !== 'queues' && tab !== 'cache'

  // The live sub-tabs refetch in place; the static ones have nothing to fetch,
  // so a full page reload remains the only meaningful "reload" there.
  const reloading =
    (tab === 'queues' && queues.loading) ||
    (tab === 'cache' && (cache.loading || cacheKeys.loading))
  const handleReload = () => {
    if (tab === 'queues') {
      queues.refetch()
    } else if (tab === 'cache') {
      cache.refetch()
      cacheKeys.refetch()
    } else {
      window.location.reload()
    }
  }

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
              ] as [PersistenceSubTab, string][]
            ).map(([key, label]) => {
              // Badges show a live count only when live data exists. While
              // loading, or when Redis/ms-order is unreachable, the badge is
              // omitted rather than showing a stale or invented number.
              const count =
                key === 'schema'
                  ? schemaData.summary.tableCount
                  : key === 'queues'
                    ? queues.data?.summary.queueCount
                    : key === 'cache'
                      ? cache.data?.namespaces.length
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
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleReload}
            disabled={reloading}
            aria-busy={reloading}
          >
            {reloading ? 'Reloading…' : 'Reload'}
          </button>
        </div>
      </div>

      {tab === 'overview' && (
        <PersistencePanel
          rustfsHealth={rustfsHealth}
          openSignal={openSignal}
          onPingRustFS={onPingRustFS}
          queueData={queues}
        />
      )}
      {tab === 'queues' && (
        <TaskQueuesPanel
          data={queues.data}
          loading={queues.loading}
          error={queues.error}
          onRetry={queues.refetch}
        />
      )}
      {tab === 'cache' && (
        <CachePanel
          data={cache.data}
          loading={cache.loading}
          error={cache.error}
          onRetry={cache.refetch}
          keysData={cacheKeys.data}
          keysLoading={cacheKeys.loading}
          keysError={cacheKeys.error}
          onRetryKeys={cacheKeys.refetch}
        />
      )}
      {tab === 'schema' && <SchemaPanel schema={schemaData} openSignal={openSignal} />}
    </>
  )
}
