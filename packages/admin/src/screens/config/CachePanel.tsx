import { Fragment, useState } from 'react'
import type { CacheData, CacheTypeBreakdown } from './cacheTypes'
import type { FetchError } from '../../hooks/useQueueData'
import { describeError } from '../../hooks/useQueueData'
import { EmptyState, OfflineBanner, Pagination, Spinner } from '../../components/ui'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const DEFAULT_PAGE_SIZE = 25

// A truncated count is a lower bound (the SCAN hit its cap), so it is rendered
// with a "≥" prefix rather than as an exact figure.
function fmtCount(count: number, truncated: boolean): string {
  return `${truncated ? '≥' : ''}${count.toLocaleString()}`
}

/** Columns broken out of the per-namespace type breakdown, in display order. */
const TYPE_COLUMNS = ['hash', 'stream', 'string', 'zset'] as const

// A zero is real data here, not missing data — so it renders as 0, just muted
// so the populated cells carry the eye.
function typeCell(value: number) {
  return (
    <td
      className="mono cell-right"
      style={value === 0 ? { color: 'var(--text-faint)' } : undefined}
    >
      {value}
    </td>
  )
}

/** True when a namespace holds a type outside the broken-out columns. */
function hasOther(types: CacheTypeBreakdown): boolean {
  return types.other > 0
}

export default function CachePanel({
  data,
  loading,
  error,
  onRetry,
}: {
  data: CacheData | null
  loading: boolean
  error: FetchError | null
  onRetry: () => void
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const changePageSize = (next: number) => {
    setPageSize(next)
    setPage(1)
  }

  // The `other` column only appears when a type outside the broken-out set is
  // actually present — an always-zero column is noise.
  const showOther = Boolean(
    data && (hasOther(data.types) || data.namespaces.some((ns) => hasOther(ns.types)))
  )
  // The Total row below sums ALL namespaces regardless of page, so it must
  // never be part of the paginated slice — it stays pinned as the table's
  // last row on every page.
  const paginated = data ? data.namespaces.slice((page - 1) * pageSize, page * pageSize) : []

  return (
    <>
      <div
        className="section-title spaced"
        style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <span>Key Namespaces</span>
        {data && (
          <span className="chip chip-slate">
            {data.backend === 'redis' ? 'redis' : 'embedded (file-backed)'}
          </span>
        )}
      </div>

      {/* Without this, seven namespaces reading zero looks like a bug rather
          than the truth: BullMQ does not run on the embedded driver, so no
          bull:* keys can exist. */}
      {data?.backend === 'embedded' && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>
          Queue namespaces are empty because BullMQ is not running on this driver — it requires
          Redis.
        </div>
      )}

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
                {TYPE_COLUMNS.map((type) => (
                  <th key={type} className="cell-right">
                    {type}
                  </th>
                ))}
                {showOther && <th className="cell-right">other</th>}
                <th className="cell-right">Keys</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((ns) => (
                <tr key={ns.prefix}>
                  <td className="mono">{ns.prefix}</td>
                  <td className="cell-muted">{ns.purpose}</td>
                  {TYPE_COLUMNS.map((type) => (
                    <Fragment key={type}>{typeCell(ns.types[type])}</Fragment>
                  ))}
                  {showOther && typeCell(ns.types.other)}
                  <td
                    className="mono cell-right"
                    title={
                      ns.typesPartial
                        ? 'Type breakdown covers only the first probed keys'
                        : ns.truncated
                          ? 'SCAN cap reached — at least this many keys'
                          : undefined
                    }
                  >
                    {fmtCount(ns.keyCount, ns.truncated)}
                    {ns.typesPartial ? ' *' : ''}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="mono" style={{ fontWeight: 700, color: 'var(--text-bright)' }}>
                  Total
                </td>
                <td className="cell-muted"></td>
                {TYPE_COLUMNS.map((type) => (
                  <td
                    key={type}
                    className="mono cell-right"
                    style={{ fontWeight: 700, color: 'var(--text-bright)' }}
                  >
                    {data.types[type]}
                  </td>
                ))}
                {showOther && (
                  <td
                    className="mono cell-right"
                    style={{ fontWeight: 700, color: 'var(--text-bright)' }}
                  >
                    {data.types.other}
                  </td>
                )}
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
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.namespaces.length}
            onPage={setPage}
            noun="namespaces"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSize={changePageSize}
          />
        </div>
      )}

      {data?.typesPartial && (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
          * Rows marked with an asterisk hold more keys than were type-probed, so their per-type
          columns cover only the probed subset and do not sum to the key count.
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
