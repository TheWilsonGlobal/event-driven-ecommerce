import { useCallback, useEffect, useState } from 'react'
import type { RustfsHealth } from '../types'
import { StatCard, EmptyState } from '../components/ui'
import { DownloadIcon } from '../components/icons'

// RustFS is a real S3-compatible object store (docker-compose `rustfs`
// service, bind-mounted at ./data/rustfs). `rustfsHealth` is a genuine live
// probe against ms-product's /storage/health endpoint, and the object list
// below is fetched live from ms-product's /storage/objects (a real
// ListObjectsV2 call against the bucket) — download uses a pre-signed
// RustFS GET URL via /storage/download, so both listing and download move
// real bytes, not mock data.

const PRODUCT_SERVICE_URL = 'http://localhost:3002'

interface StorageObject {
  key: string
  sizeBytes: number
  lastModified: string
}

function guessContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'pdf':
      return 'application/pdf'
    default:
      return 'application/octet-stream'
  }
}

function formatBytes(bytes: number): string {
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function download(key: string) {
  const url = `${PRODUCT_SERVICE_URL}/api/v1/storage/download?key=${encodeURIComponent(key)}`
  window.location.href = url
}

export default function StorageTab({
  rustfsHealth,
  onPingRustFS,
}: {
  rustfsHealth: RustfsHealth
  onPingRustFS: () => void
}) {
  const [filter, setFilter] = useState('')
  const [allObjects, setAllObjects] = useState<StorageObject[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const loadObjects = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/storage/objects`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setAllObjects(data.objects ?? [])
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadObjects()
  }, [loadObjects])

  const q = filter.trim().toLowerCase()
  const objects = q ? allObjects.filter((o) => o.key.toLowerCase().includes(q)) : allObjects
  const totalSizeMb =
    Math.round((allObjects.reduce((s, o) => s + o.sizeBytes, 0) / 1024 / 1024) * 100) / 100

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
          <button
            className="btn btn-primary"
            onClick={() => {
              onPingRustFS()
              loadObjects()
            }}
          >
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
              Product image uploads from the Catalog admin (ms-product /upload endpoint)
            </span>
          </div>
          <div className="stats-grid" style={{ marginBottom: 0 }}>
            <StatCard label="Objects" value={allObjects.length} tone="blue" />
            <StatCard label="Total Size" value={`${totalSizeMb} MB`} tone="purple" />
            <StatCard label="Region" value="us-east-1" tone="green" />
            <StatCard label="Listing" value={loadError ? 'Failed' : 'Live'} tone="yellow" />
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

      {loading ? (
        <EmptyState message="Loading objects from RustFS…" />
      ) : loadError ? (
        <EmptyState message="Could not reach ms-product to list objects. Is it running?" />
      ) : objects.length === 0 ? (
        <EmptyState
          message={
            q
              ? `No objects match "${filter}"`
              : 'Bucket is empty — upload a product image to see it here.'
          }
        />
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
                  <td className="mono cell-muted">{guessContentType(o.key)}</td>
                  <td className="mono cell-right">{formatBytes(o.sizeBytes)}</td>
                  <td className="cell-muted">{formatDate(o.lastModified)}</td>
                  <td className="cell-right">
                    <button className="btn btn-ghost btn-sm" onClick={() => download(o.key)}>
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
