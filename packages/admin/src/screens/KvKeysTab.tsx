import KvKeysPanel from './cache/KvKeysPanel'
import { useCacheKeys } from '../hooks/useQueueData'

export default function KvKeysTab() {
  const { data, loading, error, refetch } = useCacheKeys()

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            KV Cache <span className="tag">Redis</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 2 }}>
            Every individual key in the key-value store, with its type, TTL and size — read live
            with SCAN (never KEYS). Namespace totals live in Persistence &rarr; KV Cache.
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={refetch}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Reloading…' : 'Reload ↻'}
          </button>
        </div>
      </div>

      <KvKeysPanel data={data} loading={loading} error={error} onRetry={refetch} />
    </>
  )
}
