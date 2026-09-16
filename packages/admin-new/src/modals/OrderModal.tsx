import type { OrderRecord } from '../types'
import { StatusBadge } from '../components/ui'

interface Props {
  order: OrderRecord | null
  onClose: () => void
}

export default function OrderModal({ order, onClose }: Props) {
  if (!order) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="mono">{order.orderNumber}</h3>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
              Placed: {new Date(order.createdAt).toLocaleString()}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
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
              <span className="v" style={{ fontSize: 11 }}>
                {order.shippingAddress.addressLine1}, {order.shippingAddress.city},{' '}
                {order.shippingAddress.state} {order.shippingAddress.postalCode}
              </span>
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
                marginBottom: 8,
              }}
            >
              Ordered Items ({order.items.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {order.items.map((item) => (
                <div
                  key={item.sku}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {item.imageUrl && (
                      <img
                        src={item.imageUrl}
                        alt=""
                        style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }}
                      />
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{item.title}</div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                        {item.sku} × {item.quantity}
                      </div>
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{ fontWeight: 700, color: 'var(--green-light)', fontSize: 13 }}
                  >
                    ${item.totalPrice.toFixed(2)}
                  </div>
                </div>
              ))}
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
                  fontSize: 11,
                }}
              >
                Download PDF Receipt &rarr;
              </a>
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
