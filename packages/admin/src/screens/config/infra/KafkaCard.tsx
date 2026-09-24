import type { MergedEventResource } from '../../../hooks/useEventData'
import type { KafkaConfigResource } from '../../../hooks/useKafkaConfig'
import { describeEventSourceError } from '../../../hooks/useEventData'
import { ConfigCard, ReadOnlyRow, type OpenSignal } from '../parts'
import { Toggle } from '../../../components/ui'
import { KAFKA_BROKERS, REDPANDA_CONSOLE_URL } from '../../../data/serviceUrls'

/**
 * The Kafka event-backbone group in Infra → Overview.
 *
 * ── Why the header chip reads the RUNTIME flag, never the toggle ────────────
 * KAFKA_ENABLED is read at module import time on every service. Flipping the
 * toggle writes .env; it cannot start a client that was never constructed. So
 * the chip is derived from what the services actually REPORT over
 * /api/v1/events, and the persisted-but-not-yet-live value appears only in the
 * restart notice. A chip that turned green on click would be the same defect
 * as rendering an unmeasured lag as 0 — the most reassuring possible rendering
 * of a state nobody verified.
 *
 * ── Three header states, matching the endpoint's three outcomes ─────────────
 *   Disabled     every answering service reports enabled:false. Configured,
 *                the repo default, NOT an outage — so slate, not red.
 *   Online       enabled and at least one service holds a live connection.
 *   Unreachable  enabled but the broker did not answer. A real outage — red.
 *   Unknown      nothing answered. Never guessed at.
 */

/** Unmeasured, never zero. Same symbol and same rule as EventsPanel. */
const UNMEASURED = '—'

type KafkaHeaderState = 'disabled' | 'online' | 'cold' | 'unreachable' | 'unknown'

function deriveState(resource: MergedEventResource): KafkaHeaderState {
  const answered = resource.sources.filter((s) => s.data !== null)
  // Nothing answered: we cannot claim disabled, online OR down.
  if (answered.length === 0) {
    return 'unknown'
  }
  if (resource.allDisabled) {
    return 'disabled'
  }
  // Enabled somewhere and a source 503'd — the broker is the suspect.
  if (resource.sources.some((s) => s.error !== null)) {
    return 'unreachable'
  }
  return resource.anyConnected ? 'online' : 'cold'
}

const STATE_CHIP: Record<KafkaHeaderState, { className: string; label: string; title: string }> = {
  disabled: {
    className: 'chip-slate',
    label: '✗ Disabled',
    title:
      'KAFKA_ENABLED=false on every service that answered. This is the repo default and a ' +
      'healthy configuration, not an outage — services run fully without the event backbone.',
  },
  online: {
    className: 'chip-green',
    label: '✓ Online',
    title: 'Enabled, and at least one service holds a live producer connection to the broker.',
  },
  cold: {
    className: 'chip-amber',
    label: '◷ Cold',
    title:
      'Enabled and reachable, but no service has connected yet. Producers connect lazily on ' +
      'first publish, so this is the normal state before any order flows through.',
  },
  unreachable: {
    className: 'chip-red',
    label: '✗ Unreachable',
    title: 'Enabled, but at least one service could not reach the broker.',
  },
  unknown: {
    className: 'chip-amber',
    label: 'Probing…',
    title: 'No service has answered /api/v1/events yet. Status is unmeasured, not off.',
  },
}

export function KafkaCard({
  resource,
  config,
  openSignal,
}: {
  resource: MergedEventResource
  config: KafkaConfigResource
  openSignal?: OpenSignal
}) {
  const state = deriveState(resource)
  const chip = STATE_CHIP[state]
  const { result, saving, error } = config

  // What the operator sees in the switch. Before any write this is the live
  // runtime value; after a write it is what was persisted, so the switch holds
  // the position they just set while the notice explains it is not live yet.
  const runtimeEnabled = state === 'unknown' ? null : !resource.allDisabled
  const toggleValue = result ? result.enabled : (runtimeEnabled ?? false)

  const brokerLabel = resource.brokers.length > 0 ? resource.brokers.join(', ') : KAFKA_BROKERS
  const failed = resource.sources.filter((s) => s.error !== null)

  return (
    <ConfigCard
      openSignal={openSignal}
      count={6}
      title={
        <>
          <span>Event Backbone</span>
          <span className="chip chip-blue">Kafka</span>
          <span className={`chip ${chip.className}`} title={chip.title}>
            {chip.label}
          </span>
        </>
      }
      metrics={
        <a
          href={REDPANDA_CONSOLE_URL}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-sm"
          onClick={(e) => e.stopPropagation()}
          title={`Open Redpanda Console at ${REDPANDA_CONSOLE_URL}`}
        >
          Redpanda Console ↗
        </a>
      }
    >
      {/* ── The toggle ──────────────────────────────────────────────────────
          Writes KAFKA_ENABLED to the repo-root .env via ms-order. It does not
          and cannot start Kafka in the running services; the notice below says
          so in the same breath, so the control is never mistaken for a switch
          that took effect. */}
      <div className="config-row">
        <span className="k">Enabled</span>
        <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Toggle
            checked={toggleValue}
            disabled={saving}
            onChange={(next) => {
              void config.setEnabled(next)
            }}
          />
          <span className={toggleValue ? 'bool-true' : 'bool-false'}>
            {toggleValue ? 'Enabled' : 'Disabled'}
          </span>
          <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            KAFKA_ENABLED
          </span>
          {saving && (
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Writing .env…</span>
          )}
        </span>
      </div>

      {/* Persisted, but the running services still hold the old value. This is
          the whole reason `enabled` and `runtimeEnabled` are separate fields. */}
      {result?.restartRequired && (
        <div className="warn-banner" style={{ marginTop: 8 }}>
          <strong>Restart required.</strong>{' '}
          <span className="mono">KAFKA_ENABLED={String(result.enabled)}</span> was written to{' '}
          <span className="mono">{result.envPath}</span>, but the running services still have{' '}
          <span className="mono">KAFKA_ENABLED={String(result.runtimeEnabled)}</span> — the flag is
          read once at boot. Restart ms-order, ms-inventory and ms-analytics for this to take effect
          {result.enabled
            ? ', and start the broker first: cd ../../infra-hub && docker compose --profile kafka up -d'
            : '.'}
        </div>
      )}

      {/* Written, and it matches what the process is already running — nothing
          outstanding. Said explicitly so a no-op toggle is not silent. */}
      {result && !result.restartRequired && (
        <div className="cell-muted" style={{ fontSize: 12, marginTop: 8 }}>
          <span className="mono">KAFKA_ENABLED={String(result.enabled)}</span> written to{' '}
          <span className="mono">{result.envPath}</span> — already matches what the services are
          running, so no restart is needed.
        </div>
      )}

      {error && (
        <div className="warn-banner" style={{ marginTop: 8 }}>
          <strong>Could not write .env.</strong> {error.message} — KAFKA_ENABLED was{' '}
          <strong>not</strong> changed.
        </div>
      )}

      <ReadOnlyRow label="Configured Brokers" value={brokerLabel} />
      <ReadOnlyRow
        label="Runtime State"
        value={
          runtimeEnabled === null
            ? 'Unmeasured — no service has answered /api/v1/events yet'
            : runtimeEnabled
              ? `Enabled · ${resource.anyConnected ? 'a producer holds a live connection' : 'no live producer connection yet (cold)'}`
              : 'Disabled — no Kafka client is constructed in any service'
        }
      />

      {/* Per-service roll-call. Answers "one service or the whole backbone?"
          without leaving the Infra tab. */}
      <div className="config-row">
        <span className="k">Services</span>
        <span className="v" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {resource.sources.map((source) => (
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
                        : `${source.service}: enabled, no live producer connection yet`
              }
            >
              {source.service} · {source.role}
              {source.error
                ? ' · offline'
                : source.data === null
                  ? ' · unknown'
                  : !source.data.enabled
                    ? ' · disabled'
                    : source.data.connected
                      ? ' · connected'
                      : ' · cold'}
            </span>
          ))}
        </span>
      </div>

      {/* Counters stay unmeasured rather than zero when nothing answered — a
          row of zeros beside an outage reads as a healthy idle backbone. */}
      <div className="config-row">
        <span className="k">Live Counters</span>
        <span className="v mono">
          {resource.summary
            ? `${resource.summary.topicCount} topics · ${resource.summary.published.toLocaleString()} published · ${resource.summary.consumed.toLocaleString()} consumed`
            : `${UNMEASURED} — no service answered`}
          {resource.summary && resource.countersAreProcessLifetime && (
            <span style={{ color: 'var(--text-faint)' }}> (process-lifetime)</span>
          )}
        </span>
      </div>

      {failed.map((source) => (
        <div key={source.service} className="warn-banner" style={{ marginTop: 8 }}>
          {source.service} — {describeEventSourceError(source)}
        </div>
      ))}
    </ConfigCard>
  )
}
