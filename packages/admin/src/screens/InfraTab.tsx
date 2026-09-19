import { useEffect, useState } from 'react'
import type { RustfsHealth, ServiceItem } from '../types'
import { type OpenSignal } from './config/parts'
import InfraPanel from './config/InfraPanel'
import CachePanel from './config/CachePanel'
import SchemaPanel from './config/SchemaPanel'
import { useCacheDriver, useCacheNamespaces } from '../hooks/useQueueData'
import { useSchema } from '../hooks/useSchema'
import { useObservability } from '../hooks/useObservability'

type InfraSubTab = 'overview' | 'cache' | 'schema'

export default function InfraTab({
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
  const [tab, setTab] = useState<InfraSubTab>('overview')

  const cache = useCacheNamespaces()
  const driver = useCacheDriver()
  const schema = useSchema()
  const {
    prometheus,
    elasticsearch,
    loki,
    grafana,
    probeAll: probeObservability,
  } = useObservability()

  useEffect(() => {
    probeObservability()
  }, [])

  const [openSignal, setOpenSignal] = useState<OpenSignal>({ open: false, nonce: 0 })
  const broadcast = (open: boolean) => setOpenSignal((prev) => ({ open, nonce: prev.nonce + 1 }))

  const hasCards = tab !== 'cache'

  // The live sub-tabs refetch in place.
  const reloading =
    (tab === 'cache' && cache.loading) ||
    (tab === 'overview' && driver.loading) ||
    (tab === 'schema' && schema.loading)
  const handleReload = () => {
    if (tab === 'cache') {
      cache.refetch()
    } else if (tab === 'schema') {
      schema.refetch()
    } else {
      driver.refetch()
      onPingRustFS()
      onRefreshServices()
      probeObservability()
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
                ['schema', 'DB Schema'],
              ] as [InfraSubTab, string][]
            ).map(([key, label]) => {
              // Badges show a live count only when live data exists. While
              // loading, or when a service is unreachable, the badge is
              // omitted rather than showing a stale or invented number.
              const count =
                key === 'overview'
                  ? 8
                  : key === 'cache'
                    ? cache.data?.namespaces.length
                    : key === 'schema'
                      ? schema.data?.summary.tableCount
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
        <InfraPanel
          rustfsHealth={rustfsHealth}
          openSignal={openSignal}
          onPingRustFS={onPingRustFS}
          driver={driver}
          services={services}
          onRefreshServices={onRefreshServices}
          prometheus={prometheus}
          elasticsearch={elasticsearch}
          loki={loki}
          grafana={grafana}
          onProbeObservability={probeObservability}
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
      {tab === 'schema' && (
        <SchemaPanel
          data={schema.data}
          unreachable={schema.unreachable}
          loading={schema.loading}
          openSignal={openSignal}
        />
      )}
    </>
  )
}
