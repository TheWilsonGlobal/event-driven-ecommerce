import { useMemo, useState } from 'react'
import type { CacheData, CacheKeysData, CacheKeyType, CacheKeyView } from './cacheTypes'
import type { FetchError } from '../../hooks/useQueueData'
import { describeError } from '../../hooks/useQueueData'
import { EmptyState, OfflineBanner, Pagination, Spinner } from '../../components/ui'

// A truncated count is a lower bound (the SCAN hit its cap), so it is rendered
// with a "≥" prefix rather than as an exact figure.
function fmtCount(count: number, truncated: boolean): string {
  return `${truncated ? '≥' : ''}${count.toLocaleString()}`
}

// Redis TTL conventions: -1 = the key has no expiry, -2 = the key is gone (it
// expired between the SCAN and the TTL read). Neither is a duration, so
// neither is formatted as one.
function fmtTtl(ttlSeconds: number): string {
  if (ttlSeconds === -1) return 'no expiry'
  if (ttlSeconds < 0) return '—'
  if (ttlSeconds < 60) return `${ttlSeconds}s`
  if (ttlSeconds < 3600) return `${Math.round(ttlSeconds / 60)}m`
  return `${Math.round(ttlSeconds / 3600)}h`
}

// null means "could not be measured" and must not render as 0 B — a zero here
// would read as a real measurement of an empty key.
function fmtBytes(sizeBytes: number | null): string {
  if (sizeBytes === null) return '—'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
}

// Stable empty array: `keysData?.keys ?? NO_KEYS` must not hand useMemo a fresh
// [] on every render, or the filter memo recomputes constantly.
const NO_KEYS: CacheKeyView[] = []

const KEYS_PAGE_SIZE = 10

export default function CachePanel({
  data,
  loading,
  error,
  onRetry,
  keysData,
  keysLoading,
  keysError,
  onRetryKeys,
}: {
  data: CacheData | null
  loading: boolean
  error: FetchError | null
  onRetry: () => void
  keysData: CacheKeysData | null
  keysLoading: boolean
  keysError: FetchError | null
  onRetryKeys: () => void
}) {
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<CacheKeyType | null>(null)
  const [page, setPage] = useState(1)

  const allKeys = keysData?.keys ?? NO_KEYS

  // Null (not an empty object) while there is no data, so the chips can render
  // an em-dash instead of a plausible-looking zero.
  const typeCounts = useMemo(() => {
    if (!keysData) return null
    const counts: Partial<Record<CacheKeyType, number>> = {}
    for (const entry of allKeys) {
      counts[entry.type] = (counts[entry.type] ?? 0) + 1
    }
    return counts
  }, [keysData, allKeys])

  const filteredKeys = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return allKeys.filter(
      (entry) =>
        (!needle || entry.key.toLowerCase().includes(needle)) &&
        (!typeFilter || entry.type === typeFilter)
    )
  }, [allKeys, filter, typeFilter])

  const paginatedKeys = filteredKeys.slice((page - 1) * KEYS_PAGE_SIZE, page * KEYS_PAGE_SIZE)

  // Any filter change resets to page 1 — otherwise a narrowed result set can
  // leave the view stranded on a page that no longer exists.
  const changeFilter = (next: string) => {
    setFilter(next)
    setPage(1)
  }
  const toggleType = (next: CacheKeyType) => {
    setTypeFilter((prev) => (prev === next ? null : next))
    setPage(1)
  }

  const presentTypes = typeCounts
    ? (Object.keys(typeCounts) as CacheKeyType[]).sort((a, b) => a.localeCompare(b))
    : []

  return (
    <>
      <div className="section-title spaced" style={{ marginBottom: 8 }}>
        Key Namespaces
      </div>

      {data?.truncated && (
        <div className="warn-banner">
          The Redis SCAN hit its cap, so counts marked with &ldquo;≥&rdquo; are lower bounds, not
          exact totals.
        </div>
      )}

      {/* Each table owns its own loading/error cascade so one failing fetch
          cannot hide the other's data. Early returns would have made the key
          browser unreachable whenever the namespace scan failed. */}
      {error ? (
        <OfflineBanner
          title={`KV cache unavailable — ${describeError(error)}`}
          detail={error.message}
          reason={error.reason ?? (error.status ? `HTTP ${error.status}` : 'network_error')}
          onRetry={onRetry}
          retrying={loading}
        />
      ) : loading && !data ? (
        <Spinner label="Scanning Redis key namespaces…" />
      ) : !data ? (
        <EmptyState message="No cache data loaded yet." />
      ) : data.namespaces.length === 0 ? (
        <EmptyState message="Redis is reachable but holds no keys in any known namespace." />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Prefix</th>
                <th>Purpose</th>
                <th className="cell-right">Keys</th>
              </tr>
            </thead>
            <tbody>
              {data.namespaces.map((ns) => (
                <tr key={ns.prefix}>
                  <td className="mono">{ns.prefix}</td>
                  <td className="cell-muted">{ns.purpose}</td>
                  <td
                    className="mono cell-right"
                    title={ns.truncated ? 'SCAN cap reached — at least this many keys' : undefined}
                  >
                    {fmtCount(ns.keyCount, ns.truncated)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="mono" style={{ fontWeight: 700, color: 'var(--text-bright)' }}>
                  Total
                </td>
                <td className="cell-muted"></td>
                <td
                  className="mono cell-right"
                  style={{ fontWeight: 700, color: 'var(--text-bright)' }}
                  title={data.truncated ? 'SCAN cap reached — at least this many keys' : undefined}
                >
                  {fmtCount(data.totalKeys, data.truncated)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
          Scanned {new Date(data.scannedAt).toLocaleString()} · live from ms-order
        </div>
      )}

      <div className="section-title spaced" style={{ marginTop: 20, marginBottom: 8 }}>
        Keys
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter keys by name..."
            value={filter}
            onChange={(e) => changeFilter(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <span className="chip chip-slate">Keys {keysData ? keysData.totalKeys : '—'}</span>
          {presentTypes.map((type) => (
            <button
              key={type}
              type="button"
              className={`chip chip-slate chip-btn${typeFilter === type ? ' chip-btn-active' : ''}`}
              onClick={() => toggleType(type)}
              aria-pressed={typeFilter === type}
            >
              {type} {typeCounts?.[type] ?? 0}
            </button>
          ))}
          {typeFilter && (
            <button
              type="button"
              className="chip chip-slate chip-btn"
              onClick={() => {
                setTypeFilter(null)
                setPage(1)
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {keysData?.truncated && (
        <div className="warn-banner">
          Only the first {keysData.totalKeys.toLocaleString()} keys are listed — the scan hit its
          cap and more keys exist.
        </div>
      )}

      {keysError ? (
        <OfflineBanner
          title={`Key listing unavailable — ${describeError(keysError)}`}
          detail={keysError.message}
          reason={
            keysError.reason ?? (keysError.status ? `HTTP ${keysError.status}` : 'network_error')
          }
          onRetry={onRetryKeys}
          retrying={keysLoading}
        />
      ) : keysLoading && !keysData ? (
        <Spinner label="Listing Redis keys…" />
      ) : !keysData ? (
        <EmptyState message="No key data loaded yet." />
      ) : allKeys.length === 0 ? (
        <EmptyState message="Redis is reachable but holds no keys." />
      ) : filteredKeys.length === 0 ? (
        <EmptyState message={`No keys match "${filter}"`} />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th className="cell-center">Type</th>
                <th className="cell-right">TTL</th>
                <th
                  className="cell-right"
                  title={
                    keysData.sizeApproximate
                      ? 'Approximate — MEMORY USAGE with a bounded sample count'
                      : undefined
                  }
                >
                  Size{keysData.sizeApproximate ? ' ≈' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedKeys.map((entry) => (
                <tr key={entry.key}>
                  <td className="mono" title={entry.key}>
                    {entry.key}
                  </td>
                  <td className="cell-center">
                    <span className="chip chip-slate">{entry.type}</span>
                  </td>
                  <td className="mono cell-right cell-muted">{fmtTtl(entry.ttlSeconds)}</td>
                  <td className="mono cell-right cell-muted">{fmtBytes(entry.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={KEYS_PAGE_SIZE}
            total={filteredKeys.length}
            onPage={setPage}
            noun="keys"
          />
        </div>
      )}
    </>
  )
}
