import QueuesPanel from './queues/QueuesPanel'
import { useMergedQueueData, describeSourceError } from '../hooks/useQueueData'
import { OfflineBanner } from '../components/ui'

export default function TaskQueuesTab() {
  const { data, loading, sources, refetch } = useMergedQueueData()

  // All-failed is reported the same way the single-source view always has:
  // QueuesPanel's own OfflineBanner, driven by the first source's error (any
  // one is representative when every source is down). A PARTIAL failure —
  // one service up, one down — is reported separately below instead, so the
  // reachable service's queues are never hidden behind a full-page banner.
  const failed = sources.filter((s) => s.error)
  const allFailed = data === null && failed.length > 0
  const partialFailure = data !== null && failed.length > 0

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          Task Queues <span className="tag">BullMQ</span>
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

      {partialFailure &&
        failed.map((source) => (
          <OfflineBanner
            key={source.service}
            title={`${source.service} queue data unavailable — ${describeSourceError(source)}`}
            detail={source.error?.message}
            reason={source.error?.reason ?? (source.error?.status ? `HTTP ${source.error.status}` : 'network_error')}
            onRetry={refetch}
            retrying={loading}
          />
        ))}

      <QueuesPanel
        data={data}
        loading={loading}
        error={allFailed ? failed[0]?.error ?? null : null}
        onRetry={refetch}
      />
    </>
  )
}
