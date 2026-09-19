import { useState } from 'react'
import type { OrderRecord } from '../types'
import { StatusBadge } from '../components/ui'

interface Props {
  order: OrderRecord | null
  onClose: () => void
}

type OrderModalTab = 'details' | 'items'

export default function OrderModal({ order, onClose }: Props) {
  const [tab, setTab] = useState<OrderModalTab>('details')

  if (!order) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="mono">{order.orderNumber}</h3>
            <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 2 }}>
              Placed: {new Date(order.createdAt).toLocaleString()}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="config-tabs" style={{ padding: '0 20px', marginTop: 4 }}>
          {(
            [
              ['details', 'Details'],
              ['items', `Items (${order.items.length})`],
            ] as [OrderModalTab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`filter-tab${tab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab === 'details' && (
            <>
              <div className="panel" style={{ padding: 12 }}>
                <div className="panel-row">
                  <span className="k">Customer</span>
                  <span className="v">
                    {order.customerName} ({order.customerEmail})
                  </span>
                </div>
                <div className="panel-row">
                  <span className="k">Order Status</span>
                  <span className="v">
                    <StatusBadge status={order.status} />
                  </span>
                </div>
                <div className="panel-row">
                  <span className="k">Payment Method</span>
                  <span className="v">
                    {order.paymentMethod} ({order.paymentStatus})
                  </span>
                </div>
                <div className="panel-row">
                  <span className="k">Shipping Address</span>
                  <span className="v" style={{ fontSize: 12 }}>
                    {order.shippingAddress.addressLine1}, {order.shippingAddress.city},{' '}
                    {order.shippingAddress.state} {order.shippingAddress.postalCode}
                  </span>
                </div>
              </div>

              <div className="panel" style={{ padding: 12 }}>
                <div className="panel-row">
                  <span className="k">Subtotal</span>
                  <span className="v mono">${order.subtotal.toFixed(2)}</span>
                </div>
                <div className="panel-row">
                  <span className="k">Tax</span>
                  <span className="v mono">${order.taxAmount.toFixed(2)}</span>
                </div>
                <div className="panel-row">
                  <span className="k">Shipping</span>
                  <span className="v mono">${order.shippingAmount.toFixed(2)}</span>
                </div>
                <div
                  className="panel-row"
                  style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}
                >
                  <span className="k" style={{ fontWeight: 700, color: 'var(--text-bright)' }}>
                    Total
                  </span>
                  <span
                    className="v mono"
                    style={{ fontSize: 15, color: 'var(--green-light)', fontWeight: 800 }}
                  >
                    ${order.totalAmount.toFixed(2)}
                  </span>
                </div>
              </div>

              {order.receiptUrl && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'var(--blue-bg)',
                    border: '1px solid var(--blue-border)',
                    padding: '8px 14px',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: 'var(--blue-light)', fontWeight: 600 }}>
                    RustFS Object Invoice Archive:
                  </span>
                  <a
                    href={order.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: '#ffffff',
                      fontWeight: 700,
                      textDecoration: 'underline',
                      fontSize: 12,
                    }}
                  >
                    Download PDF Receipt &rarr;
                  </a>
                </div>
              )}
            </>
          )}

          {tab === 'items' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {order.items.map((item) => (
                <div
                  key={item.sku}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 4,
                          objectFit: 'cover',
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 4,
                          background: 'var(--panel-alt)',
                          border: '1px solid var(--border)',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{item.title}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        SKU {item.sku} · Product {item.productId}
                      </div>
                      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        ${item.unitPrice.toFixed(2)} × {item.quantity}
                      </div>
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontWeight: 700,
                      color: 'var(--green-light)',
                      fontSize: 14,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ${item.totalPrice.toFixed(2)}
                  </div>
                </div>
              ))}

              <div
                className="panel"
                style={{ padding: 12, marginTop: 4, display: 'flex', flexDirection: 'column' }}
              >
                <div className="panel-row">
                  <span className="k">Items</span>
                  <span className="v mono">
                    {order.items.reduce((sum, i) => sum + i.quantity, 0)} unit
                    {order.items.reduce((sum, i) => sum + i.quantity, 0) === 1 ? '' : 's'} across{' '}
                    {order.items.length} line{order.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div
                  className="panel-row"
                  style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}
                >
                  <span className="k" style={{ fontWeight: 700, color: 'var(--text-bright)' }}>
                    Items Subtotal
                  </span>
                  <span
                    className="v mono"
                    style={{ fontSize: 14, color: 'var(--green-light)', fontWeight: 800 }}
                  >
                    ${order.items.reduce((sum, i) => sum + i.totalPrice, 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
