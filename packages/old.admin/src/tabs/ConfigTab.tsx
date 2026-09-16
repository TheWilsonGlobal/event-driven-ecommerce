export default function ConfigTab() {
  return (
    <div className="space-y-6">
      <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">
          System Runtime Configuration Matrix
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Centralized environment policies, ports, queue concurrency, and security parameters
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5">
          <h3 className="font-bold text-sm text-indigo-300 mb-3">🌐 Network Ports</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">API Gateway</span>
              <span className="font-mono font-bold text-white">:3000</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">User Service</span>
              <span className="font-mono font-bold text-white">:3001</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Product Service</span>
              <span className="font-mono font-bold text-white">:3002</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Order Service</span>
              <span className="font-mono font-bold text-white">:3003</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Customer Client</span>
              <span className="font-mono font-bold text-white">:3004</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Admin Cockpit</span>
              <span className="font-mono font-bold text-white">:3005</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5">
          <h3 className="font-bold text-sm text-purple-300 mb-3">🔐 Security &amp; Auth</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">JWT Expiry</span>
              <span className="font-mono text-white">7d</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Refresh Token Expiry</span>
              <span className="font-mono text-white">30d</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bcrypt Salt Rounds</span>
              <span className="font-mono text-white">12</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Prisma Validation</span>
              <span className="font-bold text-emerald-400">Active</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5">
          <h3 className="font-bold text-sm text-emerald-300 mb-3">⚡ Task Queues &amp; Workers</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Broker</span>
              <span className="text-white">BullMQ over Redis 7</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Worker Concurrency</span>
              <span className="font-mono text-white">10</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Order Expiry</span>
              <span className="font-mono text-white">15m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Max Sagas Retries</span>
              <span className="font-mono text-white">5</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
