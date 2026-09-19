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
  // Neither store has its own health endpoint — Prisma/NeDB connectivity is
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
            <span className="chip chip-blue">SQLite</span>
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
        <ReadOnlyRow label="Storage Driver" value="SQLite (Prisma ORM)" />
        <ReadOnlyRow label="ORM Engine" value="Prisma ^5.10.2" />
        <ReadOnlyRow
          label="Connection URL"
          value="file:./data/db/ms-user.db, file:./data/db/ms-order.db"
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
            <span className="chip chip-blue">NeDB</span>
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
        <ReadOnlyRow label="Storage Driver" value="Embedded NeDB" />
        <ReadOnlyRow label="Engine" value="NeDB 1.8.0" />
        <ReadOnlyRow
          label="Connection URL"
          value="file:./data/db/products.db, file:./data/db/categories.db"
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
