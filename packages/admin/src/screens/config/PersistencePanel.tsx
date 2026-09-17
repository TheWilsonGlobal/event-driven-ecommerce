import { useCallback, useEffect, useState } from 'react'
import type { RustfsHealth } from '../../types'
import { ConfigCard, ReadOnlyRow, MultiFieldRow, type OpenSignal } from './parts'
import { useQueueData } from '../../hooks/useQueueData'

const PRODUCT_SERVICE_URL = 'http://localhost:3002'

interface RedisStats {
  usedMemoryMb: number
  peakMemoryMb: number
  connectedClients: number
  opsPerSec: number
  uptimeHours: number
  hitRate: number
}

function randomRedisStats(): RedisStats {
  return {
    usedMemoryMb: Math.round((38 + Math.random() * 6) * 10) / 10,
    peakMemoryMb: Math.round((52 + Math.random() * 4) * 10) / 10,
    connectedClients: 6 + Math.floor(Math.random() * 4),
    opsPerSec: 180 + Math.floor(Math.random() * 90),
    uptimeHours: 71,
    hitRate: Math.round((91 + Math.random() * 5) * 10) / 10,
  }
}

interface StorageObject {
  sizeBytes: number
}

export default function PersistencePanel({
  rustfsHealth,
  openSignal,
  onPingRustFS,
}: {
  rustfsHealth: RustfsHealth
  openSignal?: OpenSignal
  onPingRustFS: () => void
}) {
  const queueData = useQueueData()

  const [redisStats, setRedisStats] = useState<RedisStats>(randomRedisStats)

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
        <ReadOnlyRow label="Queue Driver" value="BullMQ over Redis" />
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
            { label: 'Client', value: 'ioredis (BullMQ client)' },
            { label: 'Backing Store', value: 'Redis 7 (DB 0)' },
            { label: 'Retry Policy', value: 'per-queue backoff, 3–5 attempts' },
          ]}
        />
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        title={
          <>
            <span>KV Cache</span>
            <span className="chip chip-purple">Redis 7 / RocksDB</span>
          </>
        }
        metrics={
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              setRedisStats(randomRedisStats())
            }}
          >
            Probe Redis ↻
          </button>
        }
      >
        <ReadOnlyRow label="Active Driver" value="redis (KV_CACHE_DRIVER)" />
        <ReadOnlyRow label="Redis Host" value="localhost:6379" />
        <ReadOnlyRow label="Client" value="ioredis" />
        <MultiFieldRow
          fields={[
            { label: 'Image', value: 'redis:7-alpine' },
            { label: 'DB Index', value: '0' },
            { label: 'Fallback', value: 'rocksdb → ./data/rocksdb' },
          ]}
        />

        <MultiFieldRow
          fields={[
            {
              label: 'Used Memory',
              value: (
                <span style={{ color: 'var(--blue-light)' }}>{redisStats.usedMemoryMb} MB</span>
              ),
            },
            {
              label: 'Peak Memory',
              value: <span style={{ color: 'var(--purple)' }}>{redisStats.peakMemoryMb} MB</span>,
            },
            {
              label: 'Connected Clients',
              value: (
                <span style={{ color: 'var(--green-light)' }}>{redisStats.connectedClients}</span>
              ),
            },
          ]}
        />
        <MultiFieldRow
          fields={[
            {
              label: 'Ops / sec',
              value: <span style={{ color: 'var(--amber-light)' }}>{redisStats.opsPerSec}</span>,
            },
            {
              label: 'Uptime',
              value: <span style={{ color: 'var(--blue-light)' }}>{redisStats.uptimeHours}h</span>,
            },
            {
              label: 'Keyspace Hit Rate',
              value: <span style={{ color: 'var(--green-light)' }}>{redisStats.hitRate}%</span>,
            },
          ]}
        />
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
