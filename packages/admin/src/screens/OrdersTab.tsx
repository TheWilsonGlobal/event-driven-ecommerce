import { useState } from 'react'
import type { OrderRecord } from '../types'
import { Pagination } from '../components/ui'

interface Props {
  filteredOrders: OrderRecord[]
  orderSearch: string
  onOrderSearch: (val: string) => void
  orderStatusFilter: string
  onStatusFilter: (val: string) => void
  onSelectOrder: (order: OrderRecord) => void
  onUpdateStatus: (id: string, status: OrderRecord['status']) => void
}

export default function OrdersTab({
  filteredOrders,
  orderSearch,
  onOrderSearch,
  orderStatusFilter,
  onStatusFilter,
  onSelectOrder,
  onUpdateStatus,
}: Props) {
  const [page, setPage] = useState<number>(1)
  const pageSize = 10
  const paginated = filteredOrders.slice((page - 1) * pageSize, page * pageSize)

  const statuses: OrderRecord['status'][] = [
    'PENDING',
    'CONFIRMED',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
  ]

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          Orders & Checkout Sagas <span className="tag">{filteredOrders.length} Sagas</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Search order #, customer, email..."
            value={orderSearch}
            onChange={(e) => {
              onOrderSearch(e.target.value)
              setPage(1)
            }}
          />
          <div className="filter-tabs">
            <button
              className={`filter-tab${orderStatusFilter === 'ALL' ? ' active' : ''}`}
              onClick={() => {
                onStatusFilter('ALL')
                setPage(1)
              }}
            >
              All
            </button>
            {statuses.map((st) => (
              <button
                key={st}
                className={`filter-tab${orderStatusFilter === st ? ' active' : ''}`}
                onClick={() => {
                  onStatusFilter(st)
                  setPage(1)
                }}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Order #</th>
              <th>Customer</th>
              <th>Email</th>
              <th>Items</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Workflow Status Transition</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{ textAlign: 'center', padding: 32, color: 'var(--text-faint)' }}
                >
                  No orders found matching filter criteria.
                </td>
              </tr>
            ) : (
              paginated.map((ord) => (
                <tr key={ord.id}>
                  <td className="mono" style={{ color: 'var(--blue-light)', fontWeight: 700 }}>
                    {ord.orderNumber}
                  </td>
                  <td style={{ fontWeight: 600 }}>{ord.customerName}</td>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>
                    {ord.customerEmail}
                  </td>
                  <td className="mono">{ord.items.reduce((s, i) => s + i.quantity, 0)} items</td>
                  <td className="mono" style={{ color: 'var(--green-light)', fontWeight: 700 }}>
                    ${ord.totalAmount.toFixed(2)}
                  </td>
                  <td>
                    <span className="chip chip-blue">{ord.paymentMethod}</span>
                  </td>
                  <td>
                    <select
                      value={ord.status}
                      onChange={(e) =>
                        onUpdateStatus(ord.id, e.target.value as OrderRecord['status'])
                      }
                      style={{
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-bright)',
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 4,
                      }}
                    >
                      {statuses.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => onSelectOrder(ord)}>
                      Inspect 👁️
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <Pagination
          page={page}
          pageSize={pageSize}
          total={filteredOrders.length}
          onPage={setPage}
          noun="orders"
        />
      </div>
    </>
  )
}
