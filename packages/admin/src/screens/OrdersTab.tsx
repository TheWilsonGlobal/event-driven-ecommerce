import { useState } from 'react'
import type { OrderRecord } from '../types'
import { Pagination } from '../components/ui'

function fmtTime(iso: string): string {
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '—'
}

// [unit suffix, seconds per unit] — see queues/QueuesPanel.tsx's fmtAgo for
// why this is hand-rolled instead of using an Intl.RelativeTimeFormat style
// directly (none of "long"/"short"/"narrow" give a concise "2m ago").
const AGO_UNITS: [string, number][] = [
  ['y', 31536000],
  ['mo', 2592000],
  ['d', 86400],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
]

function fmtAgo(iso: string | undefined | null): string {
  const diffSeconds = (new Date(iso ?? '').getTime() - Date.now()) / 1000
  if (!Number.isFinite(diffSeconds)) return '—'
  const future = diffSeconds > 0
  const abs = Math.abs(diffSeconds)
  for (const [suffix, secondsInUnit] of AGO_UNITS) {
    if (abs >= secondsInUnit || suffix === 's') {
      const n = Math.floor(abs / secondsInUnit)
      return future ? `in ${n}${suffix}` : `${n}${suffix} ago`
    }
  }
  return '0s ago'
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const DEFAULT_PAGE_SIZE = 25

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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const changePageSize = (next: number) => {
    setPageSize(next)
    setPage(1)
  }
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
              <th title="Workflow Status Transition">Status</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  style={{ textAlign: 'center', padding: 32, color: 'var(--text-faint)' }}
                >
                  No orders found matching filter criteria.
                </td>
              </tr>
            ) : (
              paginated.map((ord) => (
                <tr
                  key={ord.id}
                  className="row-clickable"
                  onClick={() => onSelectOrder(ord)}
                  title="Click to inspect this order"
                >
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
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      value={ord.status}
                      title="Workflow Status Transition"
                      onChange={(e) =>
                        onUpdateStatus(ord.id, e.target.value as OrderRecord['status'])
                      }
                      style={{
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-bright)',
                        fontSize: 12,
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
                  <td className="cell-muted" title={fmtTime(ord.createdAt)}>
                    {fmtAgo(ord.createdAt)}
                  </td>
                  <td className="cell-muted" title={fmtTime(ord.updatedAt)}>
                    {fmtAgo(ord.updatedAt)}
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
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSize={changePageSize}
        />
      </div>
    </>
  )
}
