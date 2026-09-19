import { useMemo, useState } from 'react'
import type { ServiceItem } from '../../types'
import { StatusBadge, StatChip } from '../../components/ui'
import { EmptyState, Pagination } from '../../components/ui'
import type { GatewayServicesResource } from '../../hooks/useGatewayServices'

const PAGE_SIZE = 25

export default function ServicesPanel({
  services,
  lastScanned,
  onSelectService,
  onRefresh,
  gatewayServices,
}: {
  services: ServiceItem[]
  lastScanned: string
  onSelectService: (svc: ServiceItem) => void
  onRefresh: () => void
  gatewayServices: GatewayServicesResource
}) {
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)

  const healthyCount = services.filter((s) => s.status === 'HEALTHY').length

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q
      ? services.filter(
          (svc) =>
            svc.name.toLowerCase().includes(q) ||
            svc.role.toLowerCase().includes(q) ||
            String(svc.port).includes(q)
        )
      : services
    return [...list].sort((a, b) => a.port - b.port)
  }, [services, filter])

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter services by name, role or port..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="toolbar-right">
          <StatChip value={services.length} label="Services" />
          <StatChip
            value={`${healthyCount} / ${services.length}`}
            label="Healthy"
            variant={healthyCount === services.length ? 'green' : 'amber'}
          />
          <StatChip value={lastScanned} label="Last Scanned" />
          <button className="btn btn-primary btn-sm" onClick={onRefresh}>
            Refresh Probes ↻
          </button>
        </div>
      </div>

      <div className="table-wrapper" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th colSpan={4}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  As Seen By The Gateway
                  <span className="chip chip-blue">server-side</span>
                </span>
              </th>
            </tr>
            <tr>
              <th>Service</th>
              <th>Status</th>
              <th className="cell-right">Latency</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {gatewayServices.unreachable ? (
              <tr>
                <td colSpan={4} className="cell-muted">
                  Gateway unreachable — {gatewayServices.unreachable}
                </td>
              </tr>
            ) : gatewayServices.loading && !gatewayServices.data ? (
              <tr>
                <td colSpan={4} className="cell-muted">
                  Loading…
                </td>
              </tr>
            ) : gatewayServices.data ? (
              gatewayServices.data.services.map((svc) => (
                <tr key={svc.name}>
                  <td style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{svc.name}</td>
                  <td>
                    <StatusBadge status={svc.status} />
                  </td>
                  <td className="mono cell-right" style={{ color: 'var(--green-light)' }}>
                    {svc.latencyMs} ms
                  </td>
                  <td className="cell-muted mono" style={{ fontSize: 12 }}>
                    {svc.error ?? svc.url}
                  </td>
                </tr>
              ))
            ) : null}
          </tbody>
        </table>
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
              {paginated.map((svc) => (
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
                  <td className="mono cell-muted" style={{ fontSize: 12 }}>
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
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onPage={setPage}
            noun="services"
          />
        </div>
      )}
    </>
  )
}
