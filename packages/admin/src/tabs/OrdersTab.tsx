import type { OrderRecord } from '../types';

interface Props {
  filteredOrders: OrderRecord[];
  orders: OrderRecord[];
  orderSearch: string;
  onOrderSearch: (v: string) => void;
  orderStatusFilter: string;
  onStatusFilter: (v: string) => void;
  onSelectOrder: (o: OrderRecord) => void;
  onUpdateStatus: (id: string, status: string) => void;
}

export default function OrdersTab({
  filteredOrders,
  orders,
  orderSearch,
  onOrderSearch,
  orderStatusFilter,
  onStatusFilter,
  onSelectOrder,
  onUpdateStatus,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search order #, customer..."
            value={orderSearch}
            onChange={(e) => onOrderSearch(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 outline-none focus:border-indigo-500 w-64"
          />
          <select
            value={orderStatusFilter}
            onChange={(e) => onStatusFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Order States</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PROCESSING">Processing</option>
            <option value="SHIPPED">Shipped</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <div className="text-xs text-slate-400">
          Total Orders: <b className="text-white">{orders.length}</b> · Revenue: <b className="text-emerald-400">${orders.reduce((a, b) => a + b.totalAmount, 0).toFixed(2)}</b>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900/90 text-slate-400 uppercase font-bold border-b border-slate-700">
            <tr>
              <th className="p-4">Order #</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Items</th>
              <th className="p-4">Total</th>
              <th className="p-4">Payment</th>
              <th className="p-4">Status Transition</th>
              <th className="p-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60 font-medium">
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">No orders found matching filter.</td>
              </tr>
            ) : (
              filteredOrders.map((ord) => (
                <tr key={ord.id} className="hover:bg-slate-800 transition">
                  <td className="p-4 font-mono font-bold text-indigo-400">
                    {ord.orderNumber}
                  </td>
                  <td className="p-4">
                    <span className="font-bold text-white block">{ord.customerName}</span>
                    <span className="text-slate-400 text-[11px]">{ord.customerEmail}</span>
                  </td>
                  <td className="p-4">
                    <span className="bg-slate-900 px-2 py-0.5 rounded text-[11px] font-bold text-slate-300">
                      {ord.items.reduce((a, b) => a + b.quantity, 0)} items
                    </span>
                  </td>
                  <td className="p-4 font-bold text-emerald-400">
                    ${ord.totalAmount.toFixed(2)}
                  </td>
                  <td className="p-4">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                      {ord.paymentMethod} ({ord.paymentStatus})
                    </span>
                  </td>
                  <td className="p-4">
                    <select
                      value={ord.status}
                      onChange={(e) => onUpdateStatus(ord.id, e.target.value)}
                      className="bg-slate-900 border border-slate-700 text-xs font-bold rounded-lg px-2 py-1 outline-none text-indigo-300 focus:border-indigo-500"
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="CONFIRMED">CONFIRMED</option>
                      <option value="PROCESSING">PROCESSING</option>
                      <option value="SHIPPED">SHIPPED</option>
                      <option value="DELIVERED">DELIVERED</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                  </td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => onSelectOrder(ord)}
                      className="bg-indigo-600/40 hover:bg-indigo-600 text-indigo-200 hover:text-white text-xs px-3 py-1 rounded-lg transition font-semibold"
                    >
                      Inspect 👁️
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
