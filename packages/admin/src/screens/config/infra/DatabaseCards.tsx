import type { ServiceItem } from '../../../types'
import { ConfigCard, ReadOnlyRow, type OpenSignal } from '../parts'

export function DatabaseCards({
  services,
  openSignal,
  onRefreshServices,
}: {
  services: ServiceItem[]
  openSignal?: OpenSignal
  onRefreshServices: () => void
}) {
  // Neither store has its own health endpoint — Postgres connectivity is
  // reported as part of each owning service's own /health check.
  const userSvc = services.find((s) => s.id === 'ms-user')
  const orderSvc = services.find((s) => s.id === 'ms-order')
  const productSvc = services.find((s) => s.id === 'ms-product')
  const relationalHealthy =
    userSvc && orderSvc ? userSvc.status === 'HEALTHY' && orderSvc.status === 'HEALTHY' : null
  const documentHealthy = productSvc ? productSvc.status === 'HEALTHY' : null

  return (
    <>
      <ConfigCard
        openSignal={openSignal}
        count={4}
        title={
          <>
            <span>Relational Database</span>
            <span className="chip chip-blue">PostgreSQL</span>
            <span
              className={`chip ${relationalHealthy === null ? 'chip-amber' : relationalHealthy ? 'chip-green' : 'chip-red'}`}
            >
              {relationalHealthy === null
                ? 'Probing…'
                : relationalHealthy
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
              onRefreshServices()
            }}
          >
            ↻ Probe
          </button>
        }
      >
        <ReadOnlyRow label="Storage Driver" value="PostgreSQL / Supabase (Prisma ORM)" />
        <ReadOnlyRow label="ORM Engine" value="Prisma ^5.10.2" />
        <ReadOnlyRow
          label="Connection URL"
          value="Supabase Postgres, schemas ms_user and ms_order"
        />
        <div className="config-row">
          <span className="k">Target Services</span>
          <span className="v" style={{ color: 'var(--blue-light)' }}>
            ms-user, ms-order
          </span>
        </div>
      </ConfigCard>

      <ConfigCard
        openSignal={openSignal}
        count={4}
        title={
          <>
            <span>Document Database</span>
            <span className="chip chip-blue">PostgreSQL</span>
            <span
              className={`chip ${documentHealthy === null ? 'chip-amber' : documentHealthy ? 'chip-green' : 'chip-red'}`}
            >
              {documentHealthy === null ? 'Probing…' : documentHealthy ? '✓ Online' : '✗ Offline'}
            </span>
          </>
        }
        metrics={
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onRefreshServices()
            }}
          >
            ↻ Probe
          </button>
        }
      >
        <ReadOnlyRow label="Storage Driver" value="PostgreSQL / Supabase (jsonb)" />
        <ReadOnlyRow label="Engine" value="PostgreSQL 17" />
        <ReadOnlyRow
          label="Connection URL"
          value="Supabase Postgres, schema ms_product"
        />
        <div className="config-row">
          <span className="k">Target Services</span>
          <span className="v" style={{ color: 'var(--blue-light)' }}>
            ms-product
          </span>
        </div>
      </ConfigCard>
    </>
  )
}
