import { useCallback, useEffect, useState } from 'react'
import { EmptyState, Pagination } from '../components/ui'
import { DownloadIcon } from '../components/icons'
import {
  PRODUCT_SERVICE_URL,
  RUSTFS_CONSOLE_ENDPOINT,
  RUSTFS_CONSOLE_PORT,
} from '../data/serviceUrls'
import { ApiError, apiFetch, errorText, toApiError } from '../data/apiFetch'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const DEFAULT_PAGE_SIZE = 25

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

/**
 * A navigation cannot carry the bearer token, so ask the API for the
 * pre-signed URL as JSON (authenticated) and open that instead.
 */
async function fetchDownloadUrl(key: string): Promise<string> {
  const res = await apiFetch(
    `${PRODUCT_SERVICE_URL}/api/v1/storage/download?key=${encodeURIComponent(key)}&format=json`
  )
  if (!res.ok) throw await toApiError(res)
  const data: { url?: unknown } = await res.json()
  if (typeof data.url !== 'string' || !data.url) throw new Error('Download URL missing in response')
  return data.url
}

/**
 * Runs after an await, so window.open could be swallowed by popup blockers.
 * A programmatic click on an anchor is treated as a normal navigation.
 */
function openInNewTab(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.style.display = 'none'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
  }
}

interface StorageTabProps {
  /** Toast sink (App's showToast). Errors are also shown inline. */
  onNotify?: (message: string) => void
}

export default function StorageTab({ onNotify }: StorageTabProps) {
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const download = async (key: string) => {
    setDownloading(key)
    setDownloadError(null)
    try {
      const url = await fetchDownloadUrl(key)
      openInNewTab(url)
    } catch (err) {
      const msg = `Download failed: ${errorText(err)}`
      setDownloadError(msg)
      onNotify?.(msg)
    } finally {
      setDownloading(null)
    }
  }

  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const changePageSize = (next: number) => {
    setPageSize(next)
    setPage(1)
  }
  const [allObjects, setAllObjects] = useState<StorageObject[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadObjects = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`${PRODUCT_SERVICE_URL}/api/v1/storage/objects`)
      if (!res.ok) throw await toApiError(res)
      const data = await res.json()
      setAllObjects(data.objects ?? [])
      setLoadError(null)
    } catch (err) {
      setAllObjects([])
      // 401/403/429 etc. carry a server message; only a network failure means "unreachable".
      setLoadError(
        err instanceof ApiError
          ? err.statusCode === 403
            ? `You do not have access to storage. ${errorText(err)}`
            : errorText(err)
          : 'Could not reach ms-product to list objects. Is it running?'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadObjects()
  }, [loadObjects])

  const q = filter.trim().toLowerCase()
  const objects = q ? allObjects.filter((o) => o.key.toLowerCase().includes(q)) : allObjects
  const paginated = objects.slice((page - 1) * pageSize, page * pageSize)

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
            onChange={(e) => {
              setFilter(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="toolbar-right">
          <span className="chip chip-slate">{objects.length} objects</span>
        </div>
      </div>

      {downloadError && (
        <div role="alert" className="chip chip-red" style={{ marginBottom: 10 }}>
          {downloadError}
        </div>
      )}

      {loading ? (
        <EmptyState message="Loading objects from RustFS…" />
      ) : loadError ? (
        <EmptyState message={loadError} />
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
              {paginated.map((o) => (
                <tr key={o.key}>
                  <td className="mono">{o.key}</td>
                  <td className="mono cell-muted">{guessContentType(o.key)}</td>
                  <td className="mono cell-right">{formatBytes(o.sizeBytes)}</td>
                  <td className="cell-muted">{formatDate(o.lastModified)}</td>
                  <td className="cell-right">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void download(o.key)}
                      disabled={downloading === o.key}
                      aria-label={`Download ${o.key}`}
                    >
                      <DownloadIcon style={{ width: 12, height: 12 }} />{' '}
                      {downloading === o.key ? 'Preparing…' : 'Download'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={objects.length}
            onPage={setPage}
            noun="objects"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSize={changePageSize}
          />
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <a
          href={RUSTFS_CONSOLE_ENDPOINT}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: 'var(--blue-light)', fontWeight: 600 }}
        >
          Open RustFS Console (Port {RUSTFS_CONSOLE_PORT}) &rarr;
        </a>
      </div>
    </>
  )
}
