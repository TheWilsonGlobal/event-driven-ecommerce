import type { ServiceItem } from '../types'

interface Props {
  service: ServiceItem | null
  onClose: () => void
}

export default function ServiceModal({ service, onClose }: Props) {
  if (!service) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
          <h3 className="font-bold text-base text-white flex items-center gap-2">
            <span>{service.name}</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-indigo-400">
              :{service.port}
            </span>
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
          >
            ✕
          </button>
        </div>
        <pre className="bg-slate-950 p-4 rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto max-h-96 border border-slate-800">
          {JSON.stringify(service.details || { status: 'healthy', port: service.port }, null, 2)}
        </pre>
      </div>
    </div>
  )
}
