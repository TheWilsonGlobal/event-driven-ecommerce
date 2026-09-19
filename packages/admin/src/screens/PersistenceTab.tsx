import { useState } from 'react'
import type { RustfsHealth, ServiceItem } from '../types'
import { type OpenSignal } from './config/parts'
import PersistencePanel from './config/PersistencePanel'
import CachePanel from './config/CachePanel'
import { useCacheDriver, useCacheNamespaces } from '../hooks/useQueueData'

type PersistenceSubTab = 'overview' | 'cache'

export default function PersistenceTab({
  rustfsHealth,
  onPingRustFS,
  services,
  onRefreshServices,
}: {
  rustfsHealth: RustfsHealth
  onPingRustFS: () => void
  services: ServiceItem[]
  onRefreshServices: () => void
}) {
  const [tab, setTab] = useState<PersistenceSubTab>('overview')

  const cache = useCacheNamespaces()
  const driver = useCacheDriver()

  const [openSignal, setOpenSignal] = useState<OpenSignal>({ open: false, nonce: 0 })
  const broadcast = (open: boolean) => setOpenSignal((prev) => ({ open, nonce: prev.nonce + 1 }))

  const hasCards = tab !== 'cache'

  // The live sub-tabs refetch in place.
  const reloading = (tab === 'cache' && cache.loading) || (tab === 'overview' && driver.loading)
  const handleReload = () => {
    if (tab === 'cache') {
      cache.refetch()
    } else {
      driver.refetch()
      onPingRustFS()
      onRefreshServices()
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="config-tabs">
            {(
              [
                ['overview', 'Overview'],
                ['cache', 'KV Cache'],
              ] as [PersistenceSubTab, string][]
            ).map(([key, label]) => {
              // Badges show a live count only when live data exists. While
              // loading, or when Redis/ms-order is unreachable, the badge is
              // omitted rather than showing a stale or invented number.
              const count = key === 'cache' ? cache.data?.namespaces.length : undefined
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
          driver={driver}
          services={services}
          onRefreshServices={onRefreshServices}
        />
      )}
      {tab === 'cache' && (
        <CachePanel
          data={cache.data}
          loading={cache.loading}
          error={cache.error}
          onRetry={cache.refetch}
        />
      )}
    </>
  )
}
