import EventsPanel from './events/EventsPanel'
import { useMergedEventData } from '../hooks/useEventData'
import { useKafkaConfig } from '../hooks/useKafkaConfig'
import { KAFKA_BROKERS } from '../data/serviceUrls'

/**
 * The Events tab: Kafka event-backbone introspection merged across ms-order
 * (publisher), ms-inventory and ms-analytics (consumers).
 *
 * Mirrors TaskQueuesTab: the tab owns the header, the reload control and the
 * hook; the panel owns rendering, including its own outcome banners. The
 * partial-failure banners live in EventsPanel rather than here (unlike
 * TaskQueuesTab) because there are three sources and each source's chip in the
 * panel's service strip needs to sit next to its own banner.
 */
export default function EventsTab() {
  const resource = useMergedEventData()
  // Owns the .env write behind the panel's Enable button. Separate from
  // `resource` because persisting the flag and observing the backbone are
  // different facts — see useKafkaConfig.
  const kafkaConfig = useKafkaConfig()
  const { loading, lastUpdated, brokers, allDisabled, refetch } = resource

  // Brokers reported by a service that answered, else the build-time config.
  // Labelled "configured" either way — this is what the backbone WOULD use,
  // and it is never evidence that a broker is actually there.
  const brokerLabel = brokers.length > 0 ? brokers.join(', ') : KAFKA_BROKERS

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            Events <span className="tag">Kafka</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 2 }}>
            Topics published by ms-order and consumed by ms-inventory and ms-analytics, with
            per-topic counters and consumer-group state and lag — read live from each
            service&rsquo;s <span className="mono">/api/v1/events</span>. Broker
            {brokers.length > 1 ? 's' : ''}: <span className="mono">{brokerLabel}</span>
            {allDisabled ? ' (configured; Kafka is currently switched off).' : '.'}
          </div>
        </div>
        <div className="header-actions">
          {lastUpdated && (
            <span
              className="cell-muted"
              style={{ fontSize: 12, marginRight: 10 }}
              title={new Date(lastUpdated).toLocaleString()}
            >
              Updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
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

      <EventsPanel resource={resource} kafkaConfig={kafkaConfig} />
    </>
  )
}
