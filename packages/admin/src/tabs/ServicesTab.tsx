import type { ServiceItem } from '../types'

interface Props {
  services: ServiceItem[]
  lastUpdated: string
  onSelectService: (svc: ServiceItem) => void
}

export default function ServicesTab({ services, lastUpdated, onSelectService }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            Live Perimeter &amp; Microservices Registry
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time health probe aggregator across all active Fastify &amp; Next.js service
            listeners
          </p>
        </div>
        <span className="text-xs text-slate-500">Last scanned: {lastUpdated}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {services.map((svc) => (
          <div
            key={svc.id}
            onClick={() => onSelectService(svc)}
            className="bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-indigo-500/50 rounded-2xl p-5 shadow-lg transition-all cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-3 h-3 rounded-full ${svc.status === 'HEALTHY' ? 'bg-emerald-400' : 'bg-rose-500'}`}
                  />
                  <h3 className="font-bold text-base text-white group-hover:text-indigo-400 transition">
                    {svc.name}
                  </h3>
                </div>
                <span className="text-xs font-mono font-bold bg-slate-900/90 text-indigo-300 px-2 py-0.5 rounded border border-slate-700">
                  :{svc.port}
                </span>
              </div>

              <p className="text-xs text-slate-400 mt-2.5 line-clamp-2">{svc.role}</p>

              <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Status</span>
                <span className="font-bold px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {svc.status} ({svc.statusCode})
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Response Latency</span>
                <span className="font-mono text-slate-300 font-semibold">{svc.latencyMs} ms</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs">
              <a
                href={svc.healthUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Endpoint &rarr;
              </a>
              <span className="text-slate-500 group-hover:text-slate-300 transition">
                Inspect Payload 🔍
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
