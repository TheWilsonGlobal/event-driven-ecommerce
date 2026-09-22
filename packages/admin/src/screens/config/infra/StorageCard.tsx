import { useCallback, useEffect, useState } from 'react'
import type { RustfsHealth } from '../../../types'
import { ConfigCard, ReadOnlyRow, type OpenSignal } from '../parts'
import {
  PRODUCT_SERVICE_URL,
  RUSTFS_CONSOLE_ENDPOINT,
  RUSTFS_CONSOLE_PORT,
  RUSTFS_DATA_PATH,
  RUSTFS_PORT,
} from '../../../data/serviceUrls'

interface StorageObject {
  sizeBytes: number
}

export function StorageCard({
  rustfsHealth,
  openSignal,
  onPingRustFS,
}: {
  rustfsHealth: RustfsHealth
  openSignal?: OpenSignal
  onPingRustFS: () => void
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
    <ConfigCard
      openSignal={openSignal}
      count={14}
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
          ↻ Probe
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
      {/* Derived from the real endpoint URLs rather than hand-typed, so a
          future host-port move (like 9000/9001 -> 6380/6381 on 2026-09-22)
          cannot leave this label describing the old port. */}
      <ReadOnlyRow label="S3 API Port" value={RUSTFS_PORT} />
      <ReadOnlyRow label="Console Port" value={RUSTFS_CONSOLE_PORT} />
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
          Open RustFS Console (Port {RUSTFS_CONSOLE_PORT}) &rarr;
        </a>
      </div>
    </ConfigCard>
  )
}
