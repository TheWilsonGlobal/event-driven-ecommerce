import type { ObservabilityTarget } from '../../../hooks/useObservability'
import { ConfigCard, ReadOnlyRow, type OpenSignal } from '../parts'
import { Toggle } from '../../../components/ui'

/**
 * The Enabled/Disabled switch for a toggleable target, rendered as its own
 * row in the card body rather than a status chip in the header — the header
 * chips are all read-only facts (name, kind, live health), while this one is
 * an control the operator can act on, so it gets its own row with a label
 * to make clear it is interactive.
 */
function EnabledRow({
  enabled,
  onChange,
  envVar,
}: {
  enabled: boolean
  onChange: (next: boolean) => void
  envVar: string
}) {
  return (
    <div className="config-row">
      <span className="k">Enabled</span>
      <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Toggle checked={enabled} onChange={onChange} />
        <span className={enabled ? 'bool-true' : 'bool-false'}>
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
          — defaults to {envVar} on next full restart; use Save Changes to keep this override for
          the session
        </span>
      </span>
    </div>
  )
}

export function ObservabilityCards({
  prometheus,
  elasticsearch,
  loki,
  grafana,
  openSignal,
  onProbeObservability,
  onSetElasticsearchEnabled,
  onSetLokiEnabled,
}: {
  prometheus: ObservabilityTarget
  elasticsearch: ObservabilityTarget
  loki: ObservabilityTarget
  grafana: ObservabilityTarget
  openSignal?: OpenSignal
  onProbeObservability: () => void
  onSetElasticsearchEnabled: (enabled: boolean) => void
  onSetLokiEnabled: (enabled: boolean) => void
}) {
  return (
    <>
      {/* Observability backends — none of these run in this repo's own
          docker-compose (Prometheus/Loki are provisioned by the infra-hub
          repo; Elasticsearch is optional and falls back to an in-memory
          scan when unreachable). Each card probes its own real health
          route rather than assuming a status, same as every card above. */}
      <ConfigCard
        openSignal={openSignal}
        count={3}
        title={
          <>
            <span>Prometheus</span>
            <span className="chip chip-blue">Metrics</span>
            <span
              className={`chip ${prometheus.healthy === null ? 'chip-amber' : prometheus.healthy ? 'chip-green' : 'chip-red'}`}
            >
              {prometheus.healthy === null
                ? 'Probing…'
                : prometheus.healthy
                  ? '✓ Online'
                  : '✗ Offline'}
            </span>
          </>
        }
        metrics={
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onProbeObservability()
            }}
          >
            ↻ Probe
          </button>
        }
      >
        <ReadOnlyRow label="Health Endpoint" value={`${prometheus.endpoint}/-/healthy`} />
        <ReadOnlyRow
          label="Scrape Targets"
          value="GET /metrics on every service (gateway, ms-user, ms-product, ms-order)"
        />
        <div className="config-row">
          <span className="k">Measured Latency</span>
          <span
            className="v mono"
            style={{ color: prometheus.healthy ? 'var(--green-light)' : 'var(--red-light)' }}
          >
            {prometheus.latencyMs > 0 ? `${prometheus.latencyMs} ms` : '—'}
          </span>
        </div>
        {prometheus.error && !prometheus.healthy && (
          <div className="warn-banner" style={{ marginTop: 8 }}>
            {prometheus.error} — not part of this repo's own docker-compose; provisioned by
            infra-hub.
          </div>
        )}
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        count={4}
        title={
          <>
            <span>Elasticsearch</span>
            <span className="chip chip-blue">Product Search</span>
            <span
              className={`chip ${elasticsearch.healthy === null ? 'chip-amber' : elasticsearch.healthy ? 'chip-green' : 'chip-red'}`}
            >
              {elasticsearch.healthy === null
                ? 'Probing…'
                : elasticsearch.healthy
                  ? '✓ Online'
                  : '✗ Offline'}
            </span>
          </>
        }
        metrics={
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onProbeObservability()
            }}
          >
            ↻ Probe
          </button>
        }
      >
        <EnabledRow
          enabled={elasticsearch.enabled}
          onChange={onSetElasticsearchEnabled}
          envVar="ELASTICSEARCH_ENABLED"
        />
        <ReadOnlyRow label="Health Endpoint" value={`${elasticsearch.endpoint}/_cluster/health`} />
        <ReadOnlyRow label="Index" value="products" />
        <ReadOnlyRow
          label="Fallback Behavior"
          value="Unreachable or disabled → ms-product substring-scans NeDB in memory"
        />
        <div className="config-row">
          <span className="k">Measured Latency</span>
          <span
            className="v mono"
            style={{ color: elasticsearch.healthy ? 'var(--green-light)' : 'var(--red-light)' }}
          >
            {elasticsearch.latencyMs > 0 ? `${elasticsearch.latencyMs} ms` : '—'}
          </span>
        </div>
        {elasticsearch.error && !elasticsearch.healthy && (
          <div className="warn-banner" style={{ marginTop: 8 }}>
            {elasticsearch.error} — search still works via the in-memory fallback.
          </div>
        )}
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        count={4}
        title={
          <>
            <span>Loki</span>
            <span className="chip chip-blue">Log Shipping</span>
            <span
              className={`chip ${loki.healthy === null ? 'chip-amber' : loki.healthy ? 'chip-green' : 'chip-red'}`}
            >
              {loki.healthy === null ? 'Probing…' : loki.healthy ? '✓ Online' : '✗ Offline'}
            </span>
          </>
        }
        metrics={
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onProbeObservability()
            }}
          >
            ↻ Probe
          </button>
        }
      >
        <EnabledRow enabled={loki.enabled} onChange={onSetLokiEnabled} envVar="LOKI_ENABLED" />
        <ReadOnlyRow label="Health Endpoint" value={`${loki.endpoint}/ready`} />
        <ReadOnlyRow
          label="Shipped By"
          value="pino-loki transport in every service (gateway, ms-user, ms-product, ms-order)"
        />
        <ReadOnlyRow
          label="Fallback Behavior"
          value="Unreachable → shipping fails silently to stderr; console + file logs unaffected"
        />
        <div className="config-row">
          <span className="k">Measured Latency</span>
          <span
            className="v mono"
            style={{ color: loki.healthy ? 'var(--green-light)' : 'var(--red-light)' }}
          >
            {loki.latencyMs > 0 ? `${loki.latencyMs} ms` : '—'}
          </span>
        </div>
        {loki.error && !loki.healthy && (
          <div className="warn-banner" style={{ marginTop: 8 }}>
            {loki.error} — not part of this repo's own docker-compose; provisioned by infra-hub. Set
            LOKI_ENABLED=false in .env to silence shipping errors until it's running.
          </div>
        )}
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        count={4}
        title={
          <>
            <span>Grafana</span>
            <span className="chip chip-blue">Dashboards</span>
            <span
              className={`chip ${grafana.healthy === null ? 'chip-amber' : grafana.healthy ? 'chip-green' : 'chip-red'}`}
            >
              {grafana.healthy === null ? 'Probing…' : grafana.healthy ? '✓ Online' : '✗ Offline'}
            </span>
          </>
        }
        metrics={
          <a
            href={grafana.endpoint}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
            onClick={(e) => e.stopPropagation()}
          >
            Open Grafana ↗
          </a>
        }
      >
        <ReadOnlyRow label="Health Endpoint" value={`${grafana.endpoint}/api/health`} />
        <ReadOnlyRow
          label="Datasources"
          value="Prometheus, Loki, Elasticsearch — provisioned automatically on start"
        />
        <ReadOnlyRow
          label="Provisioned By"
          value="infra-hub (docker compose --profile monitoring)"
        />
        <div className="config-row">
          <span className="k">Measured Latency</span>
          <span
            className="v mono"
            style={{ color: grafana.healthy ? 'var(--green-light)' : 'var(--red-light)' }}
          >
            {grafana.latencyMs > 0 ? `${grafana.latencyMs} ms` : '—'}
          </span>
        </div>
        {grafana.error && !grafana.healthy && (
          <div className="warn-banner" style={{ marginTop: 8 }}>
            {grafana.error} — not part of this repo's own docker-compose. Start it with: cd
            ../infra-hub &amp;&amp; docker compose --profile monitoring up -d
          </div>
        )}
      </ConfigCard>
    </>
  )
}
