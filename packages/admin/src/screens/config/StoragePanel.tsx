import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../../components/ui'
import { DownloadIcon } from '../../components/icons'

// Same live RustFS object list as the standalone Storage (RustFS) screen —
// fetched from ms-product's /storage/objects (a real ListObjectsV2 call),
// shown here too so Persistence's Task Queues / KV Cache / DB Schema / Storage
// sub-tabs are symmetric (each with its own inline table).

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

export default function StoragePanel() {
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
          <button className="btn btn-ghost btn-sm" onClick={loadObjects}>
            Reload ↻
          </button>
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
          style={{ fontSize: 12, color: 'var(--blue-light)', fontWeight: 600 }}
        >
          Open RustFS Console (Port 9001) &rarr;
        </a>
      </div>
    </>
  )
}
