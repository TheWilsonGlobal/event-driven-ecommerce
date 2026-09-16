import type { OrderRecord } from '../types'

interface Props {
  order: OrderRecord | null
  onClose: () => void
}

export default function OrderModal({ order, onClose }: Props) {
  if (!order) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4 mb-4">
          <div>
            <h3 className="font-black text-lg text-white font-mono">{order.orderNumber}</h3>
            <span className="text-xs text-slate-400">
              {new Date(order.createdAt).toLocaleString()}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div>
              <span className="text-slate-500 block mb-1">Customer</span>
              <span className="font-bold text-white block">{order.customerName}</span>
              <span className="text-slate-400">{order.customerEmail}</span>
            </div>
            <div>
              <span className="text-slate-500 block mb-1">Shipping Destination</span>
              <span className="text-slate-300 block">{order.shippingAddress.addressLine1}</span>
              <span className="text-slate-300 block">
                {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
                {order.shippingAddress.postalCode}
              </span>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-slate-300 mb-2 uppercase text-[11px] tracking-wider">
              Line Items
            </h4>
            <div className="space-y-2">
              {order.items.map((item) => (
                <div
                  key={item.sku}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800"
                >
                  <div className="flex items-center gap-3">
                    {item.imageUrl && (
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="w-10 h-10 rounded-lg object-cover bg-slate-800"
                      />
                    )}
                    <div>
                      <span className="font-bold text-white block">{item.title}</span>
                      <span className="text-slate-400 text-[11px] font-mono">
                        {item.sku} × {item.quantity}
                      </span>
                    </div>
                  </div>
                  <span className="font-bold font-mono text-emerald-400">
                    ${item.totalPrice.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5 font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal</span>
              <span>${order.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Sales Tax</span>
              <span>${order.taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Shipping</span>
              <span>${order.shippingAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-white font-bold text-sm pt-2 border-t border-slate-800">
              <span>Total Amount</span>
              <span className="text-emerald-400">${order.totalAmount.toFixed(2)}</span>
            </div>
          </div>

          {order.receiptUrl && (
            <div className="flex justify-between items-center bg-indigo-950/40 border border-indigo-500/30 p-3 rounded-xl">
              <span className="text-indigo-300">RustFS Invoice Archive:</span>
              <a
                href={order.receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-indigo-400 hover:underline"
              >
                Download PDF &rarr;
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
