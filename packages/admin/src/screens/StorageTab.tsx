import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../components/ui'
import { DownloadIcon } from '../components/icons'
import { PRODUCT_SERVICE_URL, RUSTFS_CONSOLE_ENDPOINT } from '../data/serviceUrls'

// RustFS is a real S3-compatible object store (docker-compose `rustfs`
// service, bind-mounted from the host path in RUSTFS_DATA_PATH, owned by the
// infra-hub repo). The object list below is fetched
// live from ms-product's /storage/objects (a real ListObjectsV2 call against
// the bucket) — download uses a pre-signed RustFS GET URL via
// /storage/download, so both listing and download move real bytes, not mock
// data. Connection health, bind-mount info and bucket summary now live in
// Configuration -> Persistence's "Object Storage (S3-API)" card.

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

export default function StorageTab() {
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

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            Storage <span className="tag">RustFS</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 2 }}>
            S3-compatible object storage backing product image uploads. Connection, bind-mount and
            bucket summary live in Configuration &rarr; Persistence.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={loadObjects}>
            Reload Objects ↻
          </button>
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
          href={RUSTFS_CONSOLE_ENDPOINT}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: 'var(--blue-light)', fontWeight: 600 }}
        >
          Open RustFS Console (Port 9001) &rarr;
        </a>
      </div>
    </>
  )
}
