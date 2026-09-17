import { useMemo, useState } from 'react'
import type { ServiceItem } from '../../types'
import { StatusBadge } from '../../components/ui'
import { EmptyState } from '../../components/ui'

export default function ServicesPanel({
  services,
  lastScanned,
  onSelectService,
  onRefresh,
}: {
  services: ServiceItem[]
  lastScanned: string
  onSelectService: (svc: ServiceItem) => void
  onRefresh: () => void
}) {
  const [filter, setFilter] = useState('')

  const healthyCount = services.filter((s) => s.status === 'HEALTHY').length

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return services
    return services.filter(
      (svc) =>
        svc.name.toLowerCase().includes(q) ||
        svc.role.toLowerCase().includes(q) ||
        String(svc.port).includes(q)
    )
  }, [services, filter])

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter services by name, role or port..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <span className="chip chip-slate">Services {services.length}</span>
          <span
            className={`chip ${healthyCount === services.length ? 'chip-green' : 'chip-amber'}`}
          >
            {healthyCount} / {services.length} Healthy
          </span>
          <span className="chip chip-slate">Last Scanned {lastScanned}</span>
          <button className="btn btn-primary btn-sm" onClick={onRefresh}>
            Refresh Probes ↻
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message={`No services match "${filter}"`} />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Port</th>
                <th>Role</th>
                <th>Status</th>
                <th className="cell-right">Latency</th>
                <th>Health Probe Endpoint</th>
                <th className="cell-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((svc) => (
                <tr key={svc.id}>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`refresh-dot${svc.status === 'HEALTHY' ? '' : ' paused'}`} />
                      <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>
                        {svc.name}
                      </span>
                    </span>
                  </td>
                  <td className="mono">{svc.port}</td>
                  <td className="cell-muted">{svc.role}</td>
                  <td>
                    <StatusBadge status={svc.status} />
                  </td>
                  <td className="mono cell-right" style={{ color: 'var(--green-light)' }}>
                    {svc.latencyMs} ms
                  </td>
                  <td className="mono cell-muted" style={{ fontSize: 10 }}>
                    {svc.healthUrl}
                  </td>
                  <td className="cell-right">
                    <button className="btn btn-ghost btn-sm" onClick={() => onSelectService(svc)}>
                      Inspect Payload &rarr;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
