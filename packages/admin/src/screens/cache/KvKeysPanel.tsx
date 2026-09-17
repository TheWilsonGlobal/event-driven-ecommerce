import { useMemo, useState } from 'react'
import type { CacheKeysData, CacheKeyType, CacheKeyView } from '../config/cacheTypes'
import type { FetchError } from '../../hooks/useQueueData'
import { describeError } from '../../hooks/useQueueData'
import { EmptyState, OfflineBanner, Pagination, Spinner } from '../../components/ui'

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

// Stable empty array: `data?.keys ?? NO_KEYS` must not hand useMemo a fresh []
// on every render, or the filter memo recomputes constantly.
const NO_KEYS: CacheKeyView[] = []

const PAGE_SIZE = 10

export default function KvKeysPanel({
  data,
  loading,
  error,
  onRetry,
}: {
  data: CacheKeysData | null
  loading: boolean
  error: FetchError | null
  onRetry: () => void
}) {
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<CacheKeyType | null>(null)
  const [page, setPage] = useState(1)

  const allKeys = data?.keys ?? NO_KEYS

  // Null (not an empty object) while there is no data, so the chips can render
  // an em-dash instead of a plausible-looking zero.
  const typeCounts = useMemo(() => {
    if (!data) return null
    const counts: Partial<Record<CacheKeyType, number>> = {}
    for (const entry of allKeys) {
      counts[entry.type] = (counts[entry.type] ?? 0) + 1
    }
    return counts
  }, [data, allKeys])

  const filteredKeys = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return allKeys.filter(
      (entry) =>
        (!needle || entry.key.toLowerCase().includes(needle)) &&
        (!typeFilter || entry.type === typeFilter)
    )
  }, [allKeys, filter, typeFilter])

  const paginatedKeys = filteredKeys.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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

  const hasFilters = filter.trim().length > 0 || typeFilter !== null
  const clearFilters = () => {
    setFilter('')
    setTypeFilter(null)
    setPage(1)
  }

  const presentTypes = typeCounts
    ? (Object.keys(typeCounts) as CacheKeyType[]).sort((a, b) => a.localeCompare(b))
    : []

  return (
    <>
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
          {data && (
            <span className="chip chip-purple">
              {data.backend === 'redis' ? 'redis' : 'embedded (file-backed)'}
            </span>
          )}
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
          {/* Total chip doubles as the reset, mirroring QueuesPanel's "Total"
              chip: it is active precisely when no narrowing is applied, so a
              separate Clear button would be redundant. */}
          <button
            type="button"
            className={`chip chip-slate chip-btn${!hasFilters ? ' chip-btn-active' : ''}`}
            onClick={clearFilters}
            disabled={!data}
            aria-pressed={!hasFilters}
            title={hasFilters ? 'Clear filters' : 'Showing all keys'}
          >
            Keys {data ? data.totalKeys : '—'}
          </button>
        </div>
      </div>

      {data?.truncated && (
        <div className="warn-banner">
          Only the first {data.totalKeys.toLocaleString()} keys are listed — the scan hit its cap
          and more keys exist.
        </div>
      )}

      {error ? (
        <OfflineBanner
          title={`Key listing unavailable — ${describeError(error)}`}
          detail={error.message}
          reason={error.reason ?? (error.status ? `HTTP ${error.status}` : 'network_error')}
          onRetry={onRetry}
          retrying={loading}
        />
      ) : loading && !data ? (
        <Spinner label="Listing keys…" />
      ) : !data ? (
        <EmptyState message="No key data loaded yet." />
      ) : allKeys.length === 0 ? (
        <EmptyState message="The key-value store is reachable but holds no keys." />
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
                    data.sizeApproximate
                      ? 'Approximate — MEMORY USAGE with a bounded sample count'
                      : 'Exact byte length of the stored value'
                  }
                >
                  Size{data.sizeApproximate ? ' ≈' : ''}
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
            pageSize={PAGE_SIZE}
            total={filteredKeys.length}
            onPage={setPage}
            noun="keys"
          />
        </div>
      )}

      {data && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
          Scanned {new Date(data.scannedAt).toLocaleString()} · live from ms-order
        </div>
      )}
    </>
  )
}
