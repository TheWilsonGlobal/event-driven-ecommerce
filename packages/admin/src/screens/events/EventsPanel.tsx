import { useMemo, useState, type ReactNode } from 'react'
import { EmptyState, OfflineBanner, Pagination, Spinner, StatChip } from '../../components/ui'
import { ExternalLinkIcon, ClockIcon } from '../../components/icons'
import { isWedgedConsumer } from './eventTypes'
import {
  describeEventSourceError,
  type ConsumerRow,
  type MergedEventResource,
  type TopicRow,
} from '../../hooks/useEventData'
import { KAFKA_BROKERS, REDPANDA_CONSOLE_URL } from '../../data/serviceUrls'
import type { KafkaConfigResource } from '../../hooks/useKafkaConfig'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const DEFAULT_PAGE_SIZE = 25

/**
 * The single most important symbol in this file.
 *
 * Every nullable field on the wire (`lag`, `partitions`, `state`) means
 * UNMEASURED, not zero and not empty. Rendering a 0 for an unmeasured lag
 * would read as "perfectly caught up" — the most reassuring possible
 * rendering of a state nobody observed, and the exact class of defect the
 * backend's `['number','null']` schemas exist to prevent. Everything that
 * touches a nullable goes through here.
 */
const UNMEASURED = '—'

/** Renders a nullable number as itself, or as the unmeasured dash. Never `?? 0`. */
function measured(value: number | null): ReactNode {
  return value === null ? (
    <span className="cell-muted" title="Unmeasured — the broker could not be queried">
      {UNMEASURED}
    </span>
  ) : (
    value.toLocaleString()
  )
}

function fmtTime(iso: string | null): string {
  if (!iso) return UNMEASURED
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : UNMEASURED
}

// [unit suffix, seconds per unit] — same concise table QueuesPanel uses, for
// the same reason: Intl.RelativeTimeFormat has no style that yields "2m ago".
const AGO_UNITS: [string, number][] = [
  ['y', 31536000],
  ['mo', 2592000],
  ['d', 86400],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
]

/** "3m ago", or the unmeasured dash for a null/unparseable timestamp. */
function fmtAgo(iso: string | null): string {
  if (!iso) return UNMEASURED
  const diffSeconds = (new Date(iso).getTime() - Date.now()) / 1000
  if (!Number.isFinite(diffSeconds)) return UNMEASURED
  const abs = Math.abs(diffSeconds)
  for (const [suffix, secondsInUnit] of AGO_UNITS) {
    if (abs >= secondsInUnit || suffix === 's') {
      const n = Math.floor(abs / secondsInUnit)
      return diffSeconds > 0 ? `in ${n}${suffix}` : `${n}${suffix} ago`
    }
  }
  return '0s ago'
}

/**
 * Consumer-group state chip.
 *
 * `state: null` gets its own neutral "unknown" treatment rather than being
 * blanked or coerced to "Empty" — an unmeasured group state is a distinct
 * fact from a measured empty one, and only the broker can tell them apart.
 */
function GroupStateChip({ state }: { state: string | null }) {
  if (state === null) {
    return (
      <span className="status status-unknown" title="Group state was not measured">
        unknown
      </span>
    )
  }
  const tone =
    state === 'Stable'
      ? 'status-healthy'
      : state === 'Empty' || state === 'Dead'
        ? 'status-warning'
        : 'status-pending'
  return <span className={`status ${tone}`}>{state}</span>
}

/** Sub-view selector. Topics and consumer groups are different shapes, not one table. */
type View = 'topics' | 'consumers'

export default function EventsPanel({
  resource,
  kafkaConfig,
}: {
  resource: MergedEventResource
  /** Drives the Enable button below. Same hook the Infra Kafka card uses. */
  kafkaConfig: KafkaConfigResource
}) {
  const {
    sources,
    topics,
    consumers,
    summary,
    allDisabled,
    anyConnected,
    brokers,
    countersAreProcessLifetime,
    loading,
    refetch,
  } = resource

  const [view, setView] = useState<View>('topics')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const changeView = (next: View) => {
    setView(next)
    setPage(1)
  }
  const changeFilter = (next: string) => {
    setFilter(next)
    setPage(1)
  }
  const changePageSize = (next: number) => {
    setPageSize(next)
    setPage(1)
  }

  const failed = sources.filter((s) => s.error)
  const allFailed = topics === null && failed.length > 0

  const filteredTopics = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!topics) return []
    if (!q) return topics
    return topics.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.producer.toLowerCase().includes(q) ||
        t.reportedBy.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.eventTypes.some((e) => e.toLowerCase().includes(q))
    )
  }, [topics, filter])

  const filteredConsumers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!consumers) return []
    if (!q) return consumers
    return consumers.filter(
      (c) =>
        c.groupId.toLowerCase().includes(q) ||
        c.service.toLowerCase().includes(q) ||
        c.topics.some((t) => t.toLowerCase().includes(q))
    )
  }, [consumers, filter])

  const rowCount = view === 'topics' ? filteredTopics.length : filteredConsumers.length
  const pagedTopics = filteredTopics.slice((page - 1) * pageSize, page * pageSize)
  const pagedConsumers = filteredConsumers.slice((page - 1) * pageSize, page * pageSize)

  // Wedged: running, measurably behind, and has processed nothing. Counted
  // only over consumers we actually have data for — never inferred for a
  // service that did not answer.
  const wedgedCount = consumers ? consumers.filter(isWedgedConsumer).length : null

  // `summary` is null when nothing answered, and every chip below falls back
  // to the unmeasured dash rather than a zero. A row of zeros next to an
  // outage banner is indistinguishable from a healthy idle backbone.
  const chips = (
    <div className="toolbar-right">
      <StatChip value={summary?.topicCount ?? UNMEASURED} label="Topics" />
      <StatChip value={consumers ? consumers.length : UNMEASURED} label="Groups" />
      <StatChip
        value={summary?.published?.toLocaleString() ?? UNMEASURED}
        label="Published"
        variant="blue"
      />
      <StatChip
        value={summary?.consumed?.toLocaleString() ?? UNMEASURED}
        label="Consumed"
        variant="green"
      />
      <StatChip
        value={
          summary
            ? (summary.publishFailures + summary.consumerFailures).toLocaleString()
            : UNMEASURED
        }
        label="Failures"
        variant={
          summary && summary.publishFailures + summary.consumerFailures > 0 ? 'red' : 'slate'
        }
      />
      <StatChip
        value={wedgedCount ?? UNMEASURED}
        label="Wedged"
        variant={wedgedCount ? 'red' : 'slate'}
      />
    </div>
  )

  return (
    <>
      {/* ── Outcome 1: enabled:false on every service that answered ──────────
          A 200 that says Kafka is switched off. This is KAFKA_ENABLED=false,
          the repo default, and a healthy CONFIGURED state — so it renders as a
          neutral informational panel with the broker it WOULD use, not as an
          OfflineBanner. Using the amber warn-banner here would make a working
          default look like an incident on every fresh clone. */}
      {allDisabled && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3>
            Kafka is switched off{' '}
            <span className="chip chip-mono chip-slate">KAFKA_ENABLED=false</span>
          </h3>
          <div className="panel-row">
            <span className="k">Status</span>
            <span className="v">
              <span className="status status-unknown">disabled</span> — the repo default. Services
              run fully without the event backbone; this is a configuration, not an outage.
            </span>
          </div>
          <div className="panel-row">
            <span className="k">Configured brokers</span>
            <span className="v mono">
              {brokers.length > 0 ? brokers.join(', ') : KAFKA_BROKERS}
            </span>
          </div>
          <div className="panel-row">
            <span className="k">To enable</span>
            <span className="v">
              Start infra-hub&rsquo;s <span className="mono">kafka</span> profile, set{' '}
              <span className="mono">KAFKA_ENABLED=true</span> in the repo-root{' '}
              <span className="mono">.env</span>, and restart the services.
            </span>
          </div>
          {/* The button writes the .env line only. It deliberately does NOT
              flip the banner above to "enabled": the flag is read at boot, so
              until the services restart this panel is still telling the truth
              about a backbone that is switched off. */}
          <div className="panel-row">
            <span className="k" />
            <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  void kafkaConfig.setEnabled(true)
                }}
                disabled={kafkaConfig.saving || kafkaConfig.result?.enabled === true}
                aria-busy={kafkaConfig.saving}
                title={
                  kafkaConfig.result?.enabled === true
                    ? 'Already written to .env — restart the services for it to take effect'
                    : 'Write KAFKA_ENABLED=true to the repo-root .env. Does not start Kafka in the running services.'
                }
              >
                {kafkaConfig.saving
                  ? 'Writing .env…'
                  : kafkaConfig.result?.enabled === true
                    ? 'Written to .env ✓'
                    : 'Enable Kafka'}
              </button>
              <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                Writes the flag only — the services read it at boot, so a restart is still required.
              </span>
            </span>
          </div>
          {kafkaConfig.result?.restartRequired && (
            <div className="warn-banner" style={{ marginTop: 8 }}>
              <strong>Restart required.</strong>{' '}
              <span className="mono">KAFKA_ENABLED={String(kafkaConfig.result.enabled)}</span> was
              written to <span className="mono">{kafkaConfig.result.envPath}</span>. The running
              services still have{' '}
              <span className="mono">
                KAFKA_ENABLED={String(kafkaConfig.result.runtimeEnabled)}
              </span>
              , so everything below is still unmeasured. Start the broker (&nbsp;
              <span className="mono">
                cd ../../infra-hub &amp;&amp; docker compose --profile kafka up -d
              </span>
              &nbsp;) and restart ms-order, ms-inventory and ms-analytics.
            </div>
          )}
          {kafkaConfig.error && (
            <div className="warn-banner" style={{ marginTop: 8 }}>
              <strong>Could not write .env.</strong> {kafkaConfig.error.message} — KAFKA_ENABLED was{' '}
              <strong>not</strong> changed.
            </div>
          )}
          <div className="panel-row">
            <span className="k">Topic definitions</span>
            <span className="v">
              Still listed below — they are static wiring, published from{' '}
              <span className="mono">TOPIC_DEFINITIONS</span>. Every live number is{' '}
              <span className="mono">{UNMEASURED}</span> because nothing has been measured.
            </span>
          </div>
        </div>
      )}

      {/* ── Outcome 3: 503 on one or more services ──────────────────────────
          Enabled, but the broker is unreachable. Rendered as a real outage.
          One banner per failed source, so a partial failure names the service
          that is actually down instead of blaming the backbone as a whole. */}
      {failed.map((source) => (
        <OfflineBanner
          key={source.service}
          title={`${source.service} event data unavailable — ${describeEventSourceError(source)}`}
          detail={source.error?.message}
          reason={
            source.error?.reason ??
            (source.error?.status ? `HTTP ${source.error.status}` : 'network_error')
          }
          onRetry={refetch}
          retrying={loading}
        />
      ))}

      {/* Per-service strip: role, whether Kafka is on, and whether the producer
          holds a live connection. Answers "is this one service or the whole
          backbone?" before the operator reads a single number. */}
      {!allFailed && (
        <div className="toolbar">
          <div className="toolbar-left">
            {sources.map((source) => (
              <span
                key={source.service}
                className={`chip ${
                  source.error
                    ? 'chip-red'
                    : source.data === null
                      ? 'chip-slate'
                      : !source.data.enabled
                        ? 'chip-slate'
                        : source.data.connected
                          ? 'chip-green'
                          : 'chip-amber'
                }`}
                title={
                  source.error
                    ? `${source.service} (${source.authority}): ${describeEventSourceError(source)}`
                    : source.data === null
                      ? `${source.service}: not loaded yet`
                      : !source.data.enabled
                        ? `${source.service}: Kafka disabled — configured, not faulty`
                        : source.data.connected
                          ? `${source.service}: connected to ${source.data.brokers.join(', ')}`
                          : `${source.service}: enabled, no live producer connection yet (cold start)`
                }
              >
                {source.service} · {source.role}
                {source.error
                  ? ' · offline'
                  : source.data === null
                    ? ''
                    : !source.data.enabled
                      ? ' · disabled'
                      : source.data.connected
                        ? ' · connected'
                        : ' · cold'}
              </span>
            ))}
          </div>
          <div className="toolbar-right">
            <a
              href={REDPANDA_CONSOLE_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ textDecoration: 'none', gap: 6 }}
              title={`Open Redpanda Console at ${REDPANDA_CONSOLE_URL} — browse topics, partitions and consumer offsets directly on the broker`}
            >
              <ExternalLinkIcon style={{ width: 14, height: 14 }} />
              <span>Redpanda Console</span>
            </a>
          </div>
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar-left">
          <div className="filter-tabs">
            <button
              type="button"
              className={`filter-tab${view === 'topics' ? ' active' : ''}`}
              onClick={() => changeView('topics')}
              aria-pressed={view === 'topics'}
            >
              Topics <span className="count">{topics ? topics.length : UNMEASURED}</span>
            </button>
            <button
              type="button"
              className={`filter-tab${view === 'consumers' ? ' active' : ''}`}
              onClick={() => changeView('consumers')}
              aria-pressed={view === 'consumers'}
            >
              Consumer Groups{' '}
              <span className="count">{consumers ? consumers.length : UNMEASURED}</span>
            </button>
          </div>
          <input
            type="text"
            placeholder={
              view === 'topics'
                ? 'Filter topics by name, producer or event type...'
                : 'Filter groups by id, service or topic...'
            }
            value={filter}
            onChange={(e) => changeFilter(e.target.value)}
            aria-label={view === 'topics' ? 'Filter topics' : 'Filter consumer groups'}
          />
        </div>
        {chips}
      </div>

      {/* Counters are process-lifetime, not durable totals. Saying so beside
          them is the difference between "3 events published" meaning "ever"
          and meaning "since this process started". */}
      {countersAreProcessLifetime && !allFailed && (
        <div
          className="cell-muted"
          style={{ fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <ClockIcon style={{ width: 13, height: 13 }} />
          <span>
            Published / consumed / failed counters are <strong>process-lifetime</strong> — they
            reset when a service restarts, and are not durable topic totals. Broker-side offsets
            live in Redpanda Console.
          </span>
        </div>
      )}

      {allFailed ? (
        // Every source failed. The per-source banners above already say why;
        // no table, and above all no numbers, are rendered underneath them.
        <EmptyState message="No event data could be loaded from any service on the backbone." />
      ) : loading && topics === null ? (
        <Spinner label="Loading live event-backbone data…" />
      ) : topics === null || consumers === null ? (
        <EmptyState message="No event data loaded yet." />
      ) : view === 'topics' ? (
        filteredTopics.length === 0 ? (
          <EmptyState
            message={
              filter.trim()
                ? `No topics match "${filter}"`
                : 'No topics are defined on the event backbone.'
            }
          />
        ) : (
          <div className="table-wrapper">
            <table className="queues-table">
              <colgroup>
                <col style={{ width: 200 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 100 }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Topic</th>
                  <th scope="col">Producer</th>
                  <th scope="col" title="The service whose counters this row carries">
                    Reported by
                  </th>
                  <th scope="col" title="Kafka guarantees ordering only within a partition">
                    Partition key
                  </th>
                  <th
                    scope="col"
                    className="cell-right"
                    title="Live partition count from the broker. — means unmeasured, not zero."
                  >
                    Partitions
                  </th>
                  <th scope="col" className="cell-right" title="Published this process lifetime">
                    Published
                  </th>
                  <th scope="col" className="cell-right" title="Last successful publish">
                    Last publish
                  </th>
                  <th scope="col">Event types / failures</th>
                </tr>
              </thead>
              <tbody>
                {pagedTopics.map((topic: TopicRow) => (
                  <tr key={`${topic.reportedBy}-${topic.name}`}>
                    <td className="mono" title={topic.description}>
                      {topic.name}
                    </td>
                    <td>
                      <span className="chip chip-blue">{topic.producer}</span>
                    </td>
                    <td className="mono cell-muted">{topic.reportedBy}</td>
                    <td className="mono cell-muted">{topic.partitionKey}</td>
                    <td className="mono cell-right">{measured(topic.partitions)}</td>
                    <td className="mono cell-right">{topic.published.toLocaleString()}</td>
                    <td className="cell-right cell-muted" title={fmtTime(topic.lastPublishedAt)}>
                      {fmtAgo(topic.lastPublishedAt)}
                    </td>
                    <td className="job-note-cell">
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {topic.eventTypes.map((eventType) => (
                          <span key={eventType} className="chip chip-slate chip-mono">
                            {eventType}
                          </span>
                        ))}
                        {topic.publishFailures > 0 && (
                          <span
                            className="chip chip-red"
                            title={
                              topic.lastFailureReason ??
                              `${topic.publishFailures} publish failure(s)`
                            }
                          >
                            {topic.publishFailures} publish failure
                            {topic.publishFailures === 1 ? '' : 's'}
                            {topic.lastFailureAt ? ` · ${fmtAgo(topic.lastFailureAt)}` : ''}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={rowCount}
              onPage={setPage}
              noun="topics"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSize={changePageSize}
            />
          </div>
        )
      ) : filteredConsumers.length === 0 ? (
        <EmptyState
          message={
            filter.trim()
              ? `No consumer groups match "${filter}"`
              : 'No services on the backbone register a consumer group.'
          }
        />
      ) : (
        <div className="table-wrapper">
          <table className="queues-table">
            <colgroup>
              <col style={{ width: 190 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 100 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Service</th>
                <th scope="col" title="kafkajs group state. unknown = not measured.">
                  State
                </th>
                <th scope="col">Running</th>
                <th
                  scope="col"
                  className="cell-right"
                  title="Total lag across partitions. — means unmeasured, NOT caught up."
                >
                  Lag
                </th>
                <th scope="col" className="cell-right" title="Consumed this process lifetime">
                  Consumed
                </th>
                <th scope="col" className="cell-right">
                  Failed
                </th>
                <th scope="col" className="cell-right" title="Events skipped (unknown type, etc.)">
                  Skipped
                </th>
                <th scope="col" className="cell-right">
                  Last consume
                </th>
                <th scope="col">Topics / diagnosis</th>
              </tr>
            </thead>
            <tbody>
              {pagedConsumers.map((consumer: ConsumerRow) => {
                // ── The wedged-consumer signature ────────────────────────
                // running:true + lag>0 + consumed:0. The group joined, was
                // assigned partitions, is demonstrably behind, and has
                // processed nothing. In a naive table this is byte-identical
                // to a healthy idle consumer (also running:true, also
                // consumed:0) — so it gets its own row treatment: a red
                // outline, a red lag value, and an explicit WEDGED chip
                // naming the diagnosis.
                const wedged = isWedgedConsumer(consumer)
                return (
                  <tr
                    key={`${consumer.service}-${consumer.groupId}`}
                    style={
                      wedged
                        ? {
                            background: 'var(--red-bg)',
                            boxShadow: 'inset 3px 0 0 var(--red-light)',
                          }
                        : undefined
                    }
                  >
                    <td className="mono">{consumer.groupId}</td>
                    <td>
                      <span className="chip chip-blue">{consumer.service}</span>
                    </td>
                    <td>
                      <GroupStateChip state={consumer.state} />
                    </td>
                    <td>
                      <span
                        className={`status ${consumer.running ? 'status-healthy' : 'status-offline'}`}
                      >
                        {consumer.running ? 'running' : 'stopped'}
                      </span>
                    </td>
                    <td
                      className="mono cell-right"
                      style={wedged ? { color: 'var(--red-light)', fontWeight: 700 } : undefined}
                    >
                      {measured(consumer.lag)}
                    </td>
                    <td className="mono cell-right">{consumer.consumed.toLocaleString()}</td>
                    <td
                      className="mono cell-right"
                      style={consumer.failed > 0 ? { color: 'var(--red-light)' } : undefined}
                    >
                      {consumer.failed.toLocaleString()}
                    </td>
                    <td className="mono cell-right cell-muted">
                      {consumer.skipped.toLocaleString()}
                    </td>
                    <td className="cell-right cell-muted" title={fmtTime(consumer.lastConsumedAt)}>
                      {fmtAgo(consumer.lastConsumedAt)}
                    </td>
                    <td className="job-note-cell">
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {consumer.topics.map((topic) => (
                          <span key={topic} className="chip chip-slate chip-mono">
                            {topic}
                          </span>
                        ))}
                        {wedged && (
                          <span
                            className="chip chip-red"
                            title={`Running with ${consumer.lag} events of lag but 0 consumed this process lifetime. The group holds its partition assignment and is not draining it — check the consumer's handler for a hang, a poison message, or a deserialisation loop. This is NOT an idle consumer.`}
                          >
                            WEDGED · {consumer.lag} behind, 0 consumed
                          </span>
                        )}
                        {consumer.failed > 0 && consumer.lastFailureReason && (
                          <span
                            className="mono job-error-message"
                            title={consumer.lastFailureReason}
                          >
                            {consumer.lastFailureReason}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={rowCount}
            onPage={setPage}
            noun="consumer groups"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSize={changePageSize}
          />
        </div>
      )}

      {/* Enabled, reachable, but nothing has published yet. Said explicitly so
          a cold backbone is not mistaken for a broken one. */}
      {!allDisabled && !allFailed && summary?.published === 0 && !anyConnected && (
        <div className="cell-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Kafka is enabled and no service reports a live producer connection yet. Producers connect
          lazily on first publish, so this is the normal cold state before any order flows through.
        </div>
      )}
    </>
  )
}
