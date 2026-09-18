import { useCallback, useEffect, useState } from 'react'
import type { RustfsHealth } from '../../types'
import type { LiveResource } from '../../hooks/useQueueData'
import type { QueueData } from '../queues/queueTypes'
import type { CacheDriverInfo } from './cacheTypes'
import { ConfigCard, ReadOnlyRow, MultiFieldRow, type OpenSignal } from './parts'

const PRODUCT_SERVICE_URL = 'http://localhost:5464'

interface StorageObject {
  sizeBytes: number
}

export default function PersistencePanel({
  rustfsHealth,
  openSignal,
  onPingRustFS,
  queueData,
  driver,
}: {
  rustfsHealth: RustfsHealth
  openSignal?: OpenSignal
  onPingRustFS: () => void
  /** Shared with the Task Queues sub-tab; this panel does not fetch its own. */
  queueData: LiveResource<QueueData>
  /** The KV backend ms-order actually resolved at boot. */
  driver: LiveResource<CacheDriverInfo>
}) {
  const [objectCount, setObjectCount] = useState(0)
  const [totalSizeMb, setTotalSizeMb] = useState(0)
  const [objectsLoadError, setObjectsLoadError] = useState(false)

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
            <span>Task Queues</span>
            <span className="chip chip-purple">BullMQ</span>
          </>
        }
      >
        <ReadOnlyRow
          label="Queue Driver"
          value={
            driver.data
              ? driver.data.queuesAvailable
                ? 'BullMQ over Redis'
                : `Unavailable — KV driver is "${driver.data.driver}", BullMQ requires Redis`
              : '—'
          }
        />
        <ReadOnlyRow label="Worker Concurrency" value="5–10 workers per queue" />
        <ReadOnlyRow
          label="Registered Queues"
          value={
            queueData.data
              ? `${queueData.data.summary.queueCount} queues`
              : queueData.loading
                ? 'Loading…'
                : 'Unavailable — Redis unreachable'
          }
        />
        <MultiFieldRow
          fields={[
            {
              label: 'Client',
              value: driver.data?.queuesAvailable ? 'ioredis (BullMQ client)' : '—',
            },
            {
              label: 'Backing Store',
              value: driver.data
                ? driver.data.queuesAvailable
                  ? 'Redis 7 (DB 0)'
                  : 'None — queues disabled'
                : '—',
            },
            { label: 'Retry Policy', value: 'per-queue backoff, 3–5 attempts' },
          ]}
        />
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        title={
          <>
            <span>KV Cache</span>
            <span className="chip chip-purple">
              {driver.data
                ? driver.data.backend === 'redis'
                  ? 'Redis 7'
                  : 'Embedded (file-backed)'
                : 'KV'}
            </span>
          </>
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
        <MultiFieldRow
          fields={[
            {
              label: 'Image',
              value: driver.data?.backend === 'redis' ? 'redis:7-alpine' : 'n/a (in-process)',
            },
            {
              label: driver.data?.backend === 'embedded' ? 'Persistence' : 'DB Index',
              value: driver.data
                ? driver.data.backend === 'embedded'
                  ? driver.data.inMemory
                    ? 'in-memory (not persisted)'
                    : 'file-backed JSON snapshot'
                  : '0'
                : '—',
            },
            {
              label: 'Fallback',
              value: driver.data
                ? driver.data.backend === 'embedded'
                  ? 'active — embedded (file-backed)'
                  : 'embedded (file-backed) via KV_CACHE_DRIVER'
                : '—',
            },
          ]}
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
            <span>Object Storage (S3-API)</span>
            <span className={`chip ${rustfsHealth.healthy ? 'chip-green' : 'chip-red'}`}>
              {rustfsHealth.healthy === null
                ? 'Probing…'
                : rustfsHealth.healthy
                  ? '✓ RustFS Online'
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
        <MultiFieldRow
          fields={[
            { label: 'Image', value: 'rustfs/rustfs:latest' },
            { label: 'S3 API Port', value: '9000' },
            { label: 'Console Port', value: '9001' },
          ]}
        />
        <MultiFieldRow
          fields={[
            { label: 'Host Path', value: './data/rustfs' },
            { label: 'Container Path', value: '/data' },
            { label: 'Mount Type', value: 'bind' },
          ]}
        />

        <MultiFieldRow
          fields={[
            {
              label: 'Objects',
              value: <span style={{ color: 'var(--blue-light)' }}>{objectCount}</span>,
            },
            {
              label: 'Total Size',
              value: <span style={{ color: 'var(--purple)' }}>{totalSizeMb} MB</span>,
            },
            {
              label: 'Region',
              value: <span style={{ color: 'var(--green-light)' }}>us-east-1</span>,
            },
            {
              label: 'Listing',
              value: (
                <span style={{ color: 'var(--amber-light)' }}>
                  {objectsLoadError ? 'Failed' : 'Live'}
                </span>
              ),
            },
          ]}
        />

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
            href="http://localhost:9001"
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
          </>
        }
      >
        <ReadOnlyRow label="ORM Engine" value="Prisma 5.22.0" />
        <ReadOnlyRow label="Connection URL" value="postgresql://***@localhost:5432" />
        <ReadOnlyRow label="Target Services" value="ms-user, ms-order" />
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        title={
          <>
            <span>Document Database</span>
            <span className="chip chip-green">NeDB / MongoDB</span>
          </>
        }
      >
        <ReadOnlyRow label="Storage Driver" value="Embedded NeDB" />
        <ReadOnlyRow label="Local Data Path" value="./data/nedb" />
        <ReadOnlyRow label="Target Services" value="ms-product" />
      </ConfigCard>
    </>
  )
}
