import { useState } from 'react'
import type { RustfsHealth } from '../types'
import { StatCard, EmptyState } from '../components/ui'
import { DownloadIcon } from '../components/icons'

// RustFS is a real S3-compatible object store (docker-compose `rustfs`
// service, bind-mounted at ./data/rustfs) and `rustfsHealth` above is a
// genuine live probe against ms-product's /storage/health endpoint. The
// bucket/object listing below is mock data shaped like a real
// `ListObjectsV2` response — this admin has no live S3 SDK wired in (see
// PersistenceTab.tsx's Object Storage card for the same real-probe +
// mock-detail pattern).

interface StorageObject {
  key: string
  sizeKb: number
  contentType: string
  uploadedAt: string
}

const OBJECTS: StorageObject[] = [
  {
    key: 'products/aura-pro-headphones-01.jpg',
    sizeKb: 214,
    contentType: 'image/jpeg',
    uploadedAt: '2026-09-12T09:14:00Z',
  },
  {
    key: 'products/aura-pro-headphones-02.jpg',
    sizeKb: 198,
    contentType: 'image/jpeg',
    uploadedAt: '2026-09-12T09:14:03Z',
  },
  {
    key: 'products/nimbus-laptop-stand.png',
    sizeKb: 342,
    contentType: 'image/png',
    uploadedAt: '2026-09-13T11:02:41Z',
  },
  {
    key: 'products/pulse-smartwatch-series3.webp',
    sizeKb: 176,
    contentType: 'image/webp',
    uploadedAt: '2026-09-14T15:47:12Z',
  },
  {
    key: 'products/vr-flux-headset.jpg',
    sizeKb: 288,
    contentType: 'image/jpeg',
    uploadedAt: '2026-09-15T08:23:55Z',
  },
  {
    key: 'products/quantum-mechanical-keyboard.jpg',
    sizeKb: 251,
    contentType: 'image/jpeg',
    uploadedAt: '2026-09-16T13:09:27Z',
  },
  {
    key: 'uploads/tmp/8f2c1a90-receipt-preview.png',
    sizeKb: 64,
    contentType: 'image/png',
    uploadedAt: '2026-09-17T07:41:18Z',
  },
]

interface BucketSummary {
  name: string
  region: string
  objectCount: number
  totalSizeMb: number
  createdAt: string
  purpose: string
}

const BUCKETS: BucketSummary[] = [
  {
    name: 'ecommerce-uploads',
    region: 'us-east-1',
    objectCount: OBJECTS.length,
    totalSizeMb: Math.round((OBJECTS.reduce((s, o) => s + o.sizeKb, 0) / 1024) * 100) / 100,
    createdAt: '2026-08-21T00:00:00Z',
    purpose: 'Product image uploads from the Catalog admin (ms-product /upload endpoint)',
  },
]

function formatBytes(kb: number): string {
  if (kb < 1024) return `${kb} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

/** This admin has no live S3 GetObject wired in — the download hands out
 *  a text stub describing the object's metadata instead of real bytes. */
function download(obj: StorageObject) {
  const body = [
    `Object Key: ${obj.key}`,
    `Content-Type: ${obj.contentType}`,
    `Size: ${obj.sizeKb} KB`,
    `Uploaded: ${obj.uploadedAt}`,
    `Bucket: ecommerce-uploads`,
  ].join('\n')
  const blob = new Blob([body], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = obj.key.split('/').pop() ?? obj.key
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function StorageTab({
  rustfsHealth,
  onPingRustFS,
}: {
  rustfsHealth: RustfsHealth
  onPingRustFS: () => void
}) {
  const [filter, setFilter] = useState('')

  const q = filter.trim().toLowerCase()
  const objects = q ? OBJECTS.filter((o) => o.key.toLowerCase().includes(q)) : OBJECTS

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            Storage <span className="tag">RustFS</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            S3-compatible object storage backing product image uploads.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={onPingRustFS}>
            Probe RustFS ↻
          </button>
        </div>
      </div>

      <div
        className="panel-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
      >
        {/* Connection Info */}
        <div
          className="panel"
          style={{ borderColor: rustfsHealth.healthy ? 'var(--green-border)' : 'var(--border)' }}
        >
          <h3>
            <span>Connection</span>
            <span className={`chip ${rustfsHealth.healthy ? 'chip-green' : 'chip-red'}`}>
              {rustfsHealth.healthy === null
                ? 'Probing…'
                : rustfsHealth.healthy
                  ? '✓ Online'
                  : '✗ Offline'}
            </span>
          </h3>
          <div className="panel-row">
            <span className="k">Provider</span>
            <span className="v mono">RustFS (S3-Compatible)</span>
          </div>
          <div className="panel-row">
            <span className="k">Image</span>
            <span className="v mono">rustfs/rustfs:latest</span>
          </div>
          <div className="panel-row">
            <span className="k">S3 API Port</span>
            <span className="v mono">9000</span>
          </div>
          <div className="panel-row">
            <span className="k">Console Port</span>
            <span className="v mono">9001</span>
          </div>
          <div className="panel-row">
            <span className="k">Latency</span>
            <span
              className="v mono"
              style={{ color: rustfsHealth.healthy ? 'var(--green-light)' : 'var(--red-light)' }}
            >
              {rustfsHealth.latencyMs > 0 ? `${rustfsHealth.latencyMs} ms` : '—'}
            </span>
          </div>
        </div>

        {/* Bind mount info */}
        <div className="panel">
          <h3>
            <span>Bind Mount</span>
            <span className="chip chip-slate">Host Volume</span>
          </h3>
          <div className="panel-row">
            <span className="k">Host Path</span>
            <span className="v mono" style={{ fontSize: 10 }}>
              ./data/rustfs
            </span>
          </div>
          <div className="panel-row">
            <span className="k">Container Path</span>
            <span className="v mono">/data</span>
          </div>
          <div className="panel-row">
            <span className="k">Mount Type</span>
            <span className="v mono">bind</span>
          </div>
        </div>

        {/* Bucket summary */}
        <div className="panel" style={{ gridColumn: 'span 2' }}>
          <h3>
            <span>Bucket</span>
            <span className="chip chip-purple mono">{rustfsHealth.bucket}</span>
          </h3>
          <div className="panel-row" style={{ marginBottom: 8 }}>
            <span className="cell-muted" style={{ fontSize: 11 }}>
              {BUCKETS[0].purpose}
            </span>
          </div>
          <div className="stats-grid" style={{ marginBottom: 0 }}>
            <StatCard label="Objects" value={BUCKETS[0].objectCount} tone="blue" />
            <StatCard label="Total Size" value={`${BUCKETS[0].totalSizeMb} MB`} tone="purple" />
            <StatCard label="Region" value={BUCKETS[0].region} tone="green" />
            <StatCard
              label="Created"
              value={formatDate(BUCKETS[0].createdAt).split(',')[0]}
              tone="yellow"
            />
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter objects by key..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <span className="chip chip-slate">{objects.length} objects</span>
        </div>
      </div>

      {objects.length === 0 ? (
        <EmptyState message={`No objects match "${filter}"`} />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Object Key</th>
                <th>Content Type</th>
                <th className="cell-right">Size</th>
                <th>Uploaded</th>
                <th className="cell-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((o) => (
                <tr key={o.key}>
                  <td className="mono">{o.key}</td>
                  <td className="mono cell-muted">{o.contentType}</td>
                  <td className="mono cell-right">{formatBytes(o.sizeKb)}</td>
                  <td className="cell-muted">{formatDate(o.uploadedAt)}</td>
                  <td className="cell-right">
                    <button className="btn btn-ghost btn-sm" onClick={() => download(o)}>
                      <DownloadIcon style={{ width: 12, height: 12 }} /> Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <a
          href="http://localhost:9001"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, color: 'var(--blue-light)', fontWeight: 600 }}
        >
          Open RustFS Console (Port 9001) &rarr;
        </a>
      </div>
    </>
  )
}
