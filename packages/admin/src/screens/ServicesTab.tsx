import type { ServiceItem } from '../types'
import { StatusBadge } from '../components/ui'

interface Props {
  services: ServiceItem[]
  lastScanned: string
  onSelectService: (svc: ServiceItem) => void
  onRefresh: () => void
}

export default function ServicesTab({ services, lastScanned, onSelectService, onRefresh }: Props) {
  const healthyCount = services.filter((s) => s.status === 'HEALTHY').length

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            Microservices Registry{' '}
            <span className="tag">
              {healthyCount} / {services.length} Healthy
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            Real-time health probe aggregator across Fastify microservices and Next.js listeners.
            Last scanned: {lastScanned}
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={onRefresh}>
            Refresh Probes ↻
          </button>
        </div>
      </div>

      <div
        className="panel-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
      >
        {services.map((svc) => (
          <div
            key={svc.id}
            className="panel"
            style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}
            onClick={() => onSelectService(svc)}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border)',
                paddingBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`refresh-dot${svc.status === 'HEALTHY' ? '' : ' paused'}`} />
                <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: 14 }}>
                  {svc.name}
                </span>
              </div>
              <span className="chip chip-blue mono">:{svc.port}</span>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-dim)', minHeight: 36, lineHeight: 1.4 }}>
              {svc.role}
            </div>

            <div className="panel-row">
              <span className="k">HTTP Health Status</span>
              <span className="v">
                <StatusBadge status={svc.status} />
              </span>
            </div>
            <div className="panel-row">
              <span className="k">Latency</span>
              <span className="v mono" style={{ color: 'var(--green-light)' }}>
                {svc.latencyMs} ms
              </span>
            </div>
            <div className="panel-row">
              <span className="k">Health Probe Endpoint</span>
              <span className="v mono" style={{ fontSize: 10, color: 'var(--blue-light)' }}>
                {svc.healthUrl}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 6,
                paddingTop: 6,
                borderTop: '1px solid var(--border)',
              }}
            >
              <button className="btn btn-ghost btn-sm">Inspect Payload &rarr;</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
