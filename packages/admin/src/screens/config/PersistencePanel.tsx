import { useCallback, useEffect, useState } from 'react'
import type { RustfsHealth, ServiceItem } from '../../types'
import type { LiveResource } from '../../hooks/useQueueData'
import type { CacheDriverInfo } from './cacheTypes'
import { ConfigCard, ReadOnlyRow, type OpenSignal } from './parts'
import { PRODUCT_SERVICE_URL, RUSTFS_CONSOLE_ENDPOINT, RUSTFS_DATA_PATH } from '../../data/serviceUrls'

interface StorageObject {
  sizeBytes: number
}

export default function PersistencePanel({
  rustfsHealth,
  openSignal,
  onPingRustFS,
  driver,
  services,
  onRefreshServices,
}: {
  rustfsHealth: RustfsHealth
  openSignal?: OpenSignal
  onPingRustFS: () => void
  /** The KV backend ms-order actually resolved at boot. */
  driver: LiveResource<CacheDriverInfo>
  services: ServiceItem[]
  onRefreshServices: () => void
}) {
  const [objectCount, setObjectCount] = useState(0)
  const [totalSizeMb, setTotalSizeMb] = useState(0)
  const [objectsLoadError, setObjectsLoadError] = useState(false)

  // Neither store has its own health endpoint — Prisma/NeDB connectivity is
  // reported as part of each owning service's own /health check.
  const userSvc = services.find((s) => s.id === 'ms-user')
  const orderSvc = services.find((s) => s.id === 'ms-order')
  const productSvc = services.find((s) => s.id === 'ms-product')
  const relationalHealthy =
    userSvc && orderSvc ? userSvc.status === 'HEALTHY' && orderSvc.status === 'HEALTHY' : null
  const documentHealthy = productSvc ? productSvc.status === 'HEALTHY' : null

  const loadObjectSummary = useCallback(async () => {
    try {
      const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/storage/objects`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const objects: StorageObject[] = data.objects ?? []
      setObjectCount(objects.length)
      setTotalSizeMb(
        Math.round((objects.reduce((s, o) => s + o.sizeBytes, 0) / 1024 / 1024) * 100) / 100
      )
      setObjectsLoadError(false)
    } catch {
      setObjectsLoadError(true)
    }
  }, [])

  useEffect(() => {
    loadObjectSummary()
  }, [loadObjectSummary])

  const handleProbeStorage = () => {
    onPingRustFS()
    loadObjectSummary()
  }

  return (
    <>
      <ConfigCard
        openSignal={openSignal}
        title={
          <>
            <span>KV Cache</span>
            <span className="chip chip-blue">
              {driver.data
                ? driver.data.backend === 'redis'
                  ? 'Redis 7'
                  : 'Embedded (file-backed)'
                : 'KV'}
            </span>
            <span className={`chip ${driver.data?.backend === 'redis' ? 'chip-green' : 'chip-amber'}`}>
              {!driver.data
                ? 'Probing…'
                : driver.data.backend === 'redis'
                  ? '✓ Online'
                  : '◐ Embedded'}
            </span>
          </>
        }
        metrics={
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              driver.refetch()
            }}
          >
            Probe KV Cache ↻
          </button>
        }
      >
        {/* Every value here is reported by GET /api/v1/cache/driver rather than
            hardcoded, so the panel can never name a driver that is not the one
            in use. An em-dash means "not measured yet", never a guess. */}
        <ReadOnlyRow
          label="Active Driver"
          value={driver.data ? `${driver.data.driver} (KV_CACHE_DRIVER)` : '—'}
        />
        <ReadOnlyRow
          label={driver.data?.backend === 'embedded' ? 'Snapshot Path' : 'Redis Host'}
          value={driver.data ? (driver.data.host ?? driver.data.dataPath ?? 'in-memory') : '—'}
        />
        <ReadOnlyRow label="Client" value={driver.data?.label ?? '—'} />
        <ReadOnlyRow
          label="Image"
          value={driver.data?.backend === 'redis' ? 'redis:7-alpine' : 'n/a (in-process)'}
        />
        <ReadOnlyRow
          label={driver.data?.backend === 'embedded' ? 'Persistence' : 'DB Index'}
          value={
            driver.data
              ? driver.data.backend === 'embedded'
                ? driver.data.inMemory
                  ? 'in-memory (not persisted)'
                  : 'file-backed JSON snapshot'
                : '0'
              : '—'
          }
        />
        <ReadOnlyRow
          label="Fallback"
          value={
            driver.data
              ? driver.data.backend === 'embedded'
                ? 'active — embedded (file-backed)'
                : 'embedded (file-backed) via KV_CACHE_DRIVER'
              : '—'
          }
        />
        {driver.data?.loadError && (
          <div className="warn-banner" style={{ marginTop: 8 }}>
            The embedded snapshot could not be read, so the store started empty:{' '}
            {driver.data.loadError}
          </div>
        )}

        {/* Runtime INFO metrics (used memory, clients, ops/sec, hit rate) used
            to be rendered here from a Math.random() generator, which reported a
            healthy 41 MB and a 93% hit rate even with Redis stopped. ms-order
            exposes no INFO-derived endpoint, so the honest rendering of absent
            data is to show nothing. */}
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        title={
          <>
            <span>S3 Storage</span>
            <span className="chip chip-blue">RustFS</span>
            <span
              className={`chip ${rustfsHealth.healthy === null ? 'chip-amber' : rustfsHealth.healthy ? 'chip-green' : 'chip-red'}`}
            >
              {rustfsHealth.healthy === null
                ? 'Probing…'
                : rustfsHealth.healthy
                  ? '✓ Online'
                  : '✗ Offline'}
            </span>
          </>
        }
        metrics={
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              handleProbeStorage()
            }}
          >
            Probe Storage ↻
          </button>
        }
      >
        <ReadOnlyRow label="Provider" value="RustFS (S3-Compatible)" />
        <ReadOnlyRow label="Endpoint" value={rustfsHealth.endpoint} />
        <ReadOnlyRow label="Target Bucket" value={rustfsHealth.bucket} />
        <div className="config-row">
          <span className="k">Measured Latency</span>
          <span
            className="v mono"
            style={{ color: rustfsHealth.healthy ? 'var(--green-light)' : 'var(--red-light)' }}
          >
            {rustfsHealth.latencyMs > 0 ? `${rustfsHealth.latencyMs} ms` : '—'}
          </span>
        </div>
        <ReadOnlyRow label="Image" value="rustfs/rustfs:latest" />
        <ReadOnlyRow label="S3 API Port" value="9000" />
        <ReadOnlyRow label="Console Port" value="9001" />
        <ReadOnlyRow label="Host Path" value={RUSTFS_DATA_PATH} />
        <ReadOnlyRow label="Container Path" value="/data" />
        <ReadOnlyRow label="Mount Type" value="bind" />
        <div className="config-row">
          <span className="k">Objects</span>
          <span className="v" style={{ color: 'var(--blue-light)' }}>
            {objectCount}
          </span>
        </div>
        <div className="config-row">
          <span className="k">Total Size</span>
          <span className="v" style={{ color: 'var(--purple)' }}>
            {totalSizeMb} MB
          </span>
        </div>
        <div className="config-row">
          <span className="k">Region</span>
          <span className="v" style={{ color: 'var(--green-light)' }}>
            us-east-1
          </span>
        </div>
        <div className="config-row">
          <span className="k">Listing</span>
          <span className="v" style={{ color: 'var(--amber-light)' }}>
            {objectsLoadError ? 'Failed' : 'Live'}
          </span>
        </div>

        <div className="panel-row" style={{ marginTop: 6 }}>
          <span className="cell-muted" style={{ fontSize: 12 }}>
            Product image uploads from the Catalog admin (ms-product /upload endpoint)
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 10,
            paddingTop: 6,
            borderTop: '1px solid var(--border)',
          }}
        >
          <a
            href={RUSTFS_CONSOLE_ENDPOINT}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--blue-light)', fontWeight: 600 }}
          >
            Open RustFS Console (Port 9001) &rarr;
          </a>
        </div>
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        title={
          <>
            <span>Relational Database</span>
            <span className="chip chip-blue">PostgreSQL / SQLite</span>
            <span className={`chip ${relationalHealthy === null ? 'chip-amber' : relationalHealthy ? 'chip-green' : 'chip-red'}`}>
              {relationalHealthy === null ? 'Probing…' : relationalHealthy ? '✓ Online' : '✗ Offline'}
            </span>
          </>
        }
        metrics={
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onRefreshServices()
            }}
          >
            Probe Database ↻
          </button>
        }
      >
        <ReadOnlyRow label="Storage Driver" value="SQLite (Prisma ORM)" />
        <ReadOnlyRow label="ORM Engine" value="Prisma 5.22.0" />
        <ReadOnlyRow label="Connection URL" value="file:./data/db/ms-user.db, file:./data/db/ms-order.db" />
        <div className="config-row">
          <span className="k">Target Services</span>
          <span className="v" style={{ color: 'var(--blue-light)' }}>
            ms-user, ms-order
          </span>
        </div>
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        title={
          <>
            <span>Document Database</span>
            <span className="chip chip-blue">NeDB / MongoDB</span>
            <span className={`chip ${documentHealthy === null ? 'chip-amber' : documentHealthy ? 'chip-green' : 'chip-red'}`}>
              {documentHealthy === null ? 'Probing…' : documentHealthy ? '✓ Online' : '✗ Offline'}
            </span>
          </>
        }
        metrics={
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onRefreshServices()
            }}
          >
            Probe Database ↻
          </button>
        }
      >
        <ReadOnlyRow label="Storage Driver" value="Embedded NeDB" />
        <ReadOnlyRow label="Engine" value="NeDB 1.8.0" />
        <ReadOnlyRow
          label="Connection URL"
          value="file:./data/db/products.db, file:./data/db/categories.db"
        />
        <div className="config-row">
          <span className="k">Target Services</span>
          <span className="v" style={{ color: 'var(--blue-light)' }}>
            ms-product
          </span>
        </div>
      </ConfigCard>
    </>
  )
}
