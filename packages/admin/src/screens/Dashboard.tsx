import type { ServiceItem, OrderRecord, RustfsHealth, Tab } from '../types'
import { StatCard, StatusBadge } from '../components/ui'

interface Props {
  services: ServiceItem[]
  orders: OrderRecord[]
  productsCount: number
  usersCount: number
  rustfsHealth: RustfsHealth
  onNavigate: (tab: Tab) => void
  onSelectOrder: (order: OrderRecord) => void
}

export default function Dashboard({
  services,
  orders,
  productsCount,
  usersCount,
  rustfsHealth,
  onNavigate,
  onSelectOrder,
}: Props) {
  const healthyCount = services.filter((s) => s.status === 'HEALTHY').length
  const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0)
  const pendingOrders = orders.filter(
    (o) => o.status === 'PENDING' || o.status === 'PROCESSING'
  ).length

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          Dashboard Overview <span className="tag">Live Control Plane</span>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          label="Total Services"
          value={`${healthyCount} / ${services.length}`}
          tone={healthyCount === services.length ? 'green' : 'yellow'}
        />
        <StatCard label="Total Revenue" value={`$${totalRevenue.toFixed(2)}`} tone="green" />
        <StatCard label="Active Orders" value={orders.length} tone="blue" />
        <StatCard
          label="Pending Processing"
          value={pendingOrders}
          tone={pendingOrders > 0 ? 'yellow' : 'blue'}
        />
        <StatCard label="Catalog Products" value={productsCount} tone="purple" />
        <StatCard label="Registered Users" value={usersCount} tone="blue" />
        <StatCard
          label="RustFS Object Storage"
          value={
            rustfsHealth.healthy === null
              ? 'Probing…'
              : rustfsHealth.healthy
                ? `${rustfsHealth.latencyMs}ms`
                : 'Offline'
          }
          tone={rustfsHealth.healthy ? 'green' : 'red'}
        />
      </div>

      <div className="panel-grid">
        {/* Services Status Panel */}
        <div className="panel">
          <h3>
            <span>Microservices Perimeter</span>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('config')}>
              View All &rarr;
            </button>
          </h3>
          {services.map((svc) => (
            <div key={svc.id} className="panel-row">
              <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`refresh-dot${svc.status === 'HEALTHY' ? '' : ' paused'}`} />
                {svc.name}
              </span>
              <span className="v mono">
                {svc.port} · <StatusBadge status={svc.status} />
              </span>
            </div>
          ))}
        </div>

        {/* Persistence Overview Panel */}
        <div className="panel">
          <h3>
            <span>Persistence & Drivers</span>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('persistence')}>
              Topology &rarr;
            </button>
          </h3>
          <div className="panel-row">
            <span className="k">Relational DB</span>
            <span className="v">PostgreSQL / SQLite</span>
          </div>
          <div className="panel-row">
            <span className="k">Document Store</span>
            <span className="v">NeDB / MongoDB</span>
          </div>
          <div className="panel-row">
            <span className="k">KV Cache & BullMQ</span>
            <span className="v">Redis 7 / RocksDB</span>
          </div>
          <div className="panel-row">
            <span className="k">Object Storage</span>
            <span
              className="v"
              style={{ color: rustfsHealth.healthy ? 'var(--green-light)' : 'var(--red-light)' }}
            >
              RustFS ({rustfsHealth.healthy ? 'Online' : 'Offline'})
            </span>
          </div>
        </div>
      </div>

      {/* Recent Orders Table */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h3 style={{ border: 'none', padding: 0, margin: 0 }}>Recent Orders & Sagas</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('orders')}>
            All Orders &rarr;
          </button>
        </div>
        <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 5).map((ord) => (
                <tr key={ord.id}>
                  <td className="mono" style={{ color: 'var(--blue-light)', fontWeight: 700 }}>
                    {ord.orderNumber}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{ord.customerName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                      {ord.customerEmail}
                    </div>
                  </td>
                  <td className="mono">{ord.items.reduce((s, i) => s + i.quantity, 0)} items</td>
                  <td className="mono" style={{ color: 'var(--green-light)', fontWeight: 700 }}>
                    ${ord.totalAmount.toFixed(2)}
                  </td>
                  <td>
                    <span className="chip chip-blue">{ord.paymentMethod}</span>
                  </td>
                  <td>
                    <StatusBadge status={ord.status} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => onSelectOrder(ord)}>
                      Inspect 👁️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
