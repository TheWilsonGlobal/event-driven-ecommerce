import QueuesPanel from './queues/QueuesPanel'
import { useQueueData } from '../hooks/useQueueData'

export default function TaskQueuesTab() {
  const { data, loading, error, refetch } = useQueueData()

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

      <QueuesPanel data={data} loading={loading} error={error} onRetry={refetch} />
    </>
  )
}
