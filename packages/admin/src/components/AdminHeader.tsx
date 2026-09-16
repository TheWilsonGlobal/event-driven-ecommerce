import type { ServiceItem } from '../types'

interface Props {
  activeTab: 'services' | 'users' | 'products' | 'orders' | 'persistence' | 'config'
  setActiveTab: (
    tab: 'services' | 'users' | 'products' | 'orders' | 'persistence' | 'config'
  ) => void
  services: ServiceItem[]
  usersCount: number
  productsCount: number
  ordersCount: number
  autoRefresh: boolean
  setAutoRefresh: (val: boolean) => void
  onRefresh: () => void
}

export default function AdminHeader({
  activeTab,
  setActiveTab,
  services,
  usersCount,
  productsCount,
  ordersCount,
  autoRefresh,
  setAutoRefresh,
  onRefresh,
}: Props) {
  const onlineCount = services.filter((s) => s.status === 'HEALTHY').length

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center font-black text-xl text-white shadow-lg shadow-indigo-500/30">
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-white">ADMIN COCKPIT</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                Control Plane v2.0
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Microservices Architecture, Catalog, Customers &amp; Sagas
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <span
              className={`w-2.5 h-2.5 rounded-full ${onlineCount === services.length && services.length > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}
            />
            <span className="font-semibold text-slate-300">
              Services:{' '}
              <b className="text-white">
                {onlineCount}/{services.length} Healthy
              </b>
            </span>
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-lg font-semibold border transition ${
              autoRefresh
                ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/50'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {autoRefresh ? '⟳ Auto (5s)' : '⏸ Paused'}
          </button>

          <button
            onClick={onRefresh}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 font-semibold transition"
          >
            Refresh ↻
          </button>

          <a
            href="http://localhost:3004"
            target="_blank"
            rel="noreferrer"
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-bold shadow-sm transition flex items-center gap-1"
          >
            <span>Storefront</span>
            <span>&rarr;</span>
          </a>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-2 border-t border-slate-800/60 pt-2 pb-2 overflow-x-auto scrollbar-none">
        {[
          { id: 'services', label: '🖥️ Services Registry', count: services.length },
          { id: 'users', label: '👥 Users & Roles', count: usersCount },
          { id: 'products', label: '📦 Product Catalog', count: productsCount },
          { id: 'orders', label: '🛒 Orders & Sagas', count: ordersCount },
          { id: 'persistence', label: '💾 Persistence Topology' },
          { id: 'config', label: '⚙️ Configuration Matrix' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                  activeTab === tab.id
                    ? 'bg-indigo-900/80 text-indigo-200'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </header>
  )
}
