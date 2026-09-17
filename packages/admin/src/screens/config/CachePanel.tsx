import type { CacheData } from './cacheTypes'
import type { FetchError } from '../../hooks/useQueueData'
import { describeError } from '../../hooks/useQueueData'
import { EmptyState, OfflineBanner, Spinner } from '../../components/ui'

// A truncated count is a lower bound (the SCAN hit its cap), so it is rendered
// with a "≥" prefix rather than as an exact figure.
function fmtCount(count: number, truncated: boolean): string {
  return `${truncated ? '≥' : ''}${count.toLocaleString()}`
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
  if (loading && !data) {
    return <Spinner label="Scanning Redis key namespaces…" />
  }

  if (error) {
    return (
      <OfflineBanner
        title={`KV cache unavailable — ${describeError(error)}`}
        detail={error.message}
        reason={error.reason ?? (error.status ? `HTTP ${error.status}` : 'network_error')}
        onRetry={onRetry}
        retrying={loading}
      />
    )
  }

  if (!data) {
    return <EmptyState message="No cache data loaded yet." />
  }

  const { namespaces, totalKeys, truncated, scannedAt } = data

  return (
    <>
      <div className="section-title spaced" style={{ marginBottom: 8 }}>
        Key Namespaces
      </div>

      {truncated && (
        <div className="warn-banner">
          The Redis SCAN hit its cap, so counts marked with &ldquo;≥&rdquo; are lower bounds, not
          exact totals.
        </div>
      )}

      {namespaces.length === 0 ? (
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
              {namespaces.map((ns) => (
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
                  title={truncated ? 'SCAN cap reached — at least this many keys' : undefined}
                >
                  {fmtCount(totalKeys, truncated)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
        Scanned {new Date(scannedAt).toLocaleString()} · live from ms-order
      </div>
    </>
  )
}
