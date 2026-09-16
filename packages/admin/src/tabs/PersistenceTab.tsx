
interface RustfsHealth {
  healthy: boolean | null;
  latencyMs: number;
  endpoint: string;
  bucket: string;
  lastChecked: string;
}

interface Props {
  rustfsHealth: RustfsHealth;
  onPingRustFS: () => void;
}

export default function PersistenceTab({ rustfsHealth, onPingRustFS }: Props) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">
          Persistence &amp; Storage Engine Topology
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Active relational, document, key-value and object storage drivers</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Relational */}
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-lg">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-sm text-white">Relational Database</h3>
            <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-bold uppercase">
              PostgreSQL / SQLite
            </span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">ORM Engine</span>
              <span className="font-mono text-white">Prisma 5.22</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Active URL</span>
              <span className="font-mono text-slate-300 truncate max-w-[150px]">postgresql://***@localhost:5432</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Target Services</span>
              <span className="text-slate-300">ms-user, ms-order</span>
            </div>
          </div>
        </div>

        {/* Document */}
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-lg">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-sm text-white">Document Store</h3>
            <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-bold uppercase">
              NeDB / MongoDB
            </span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Mode</span>
              <span className="font-mono text-white">Embedded / Server</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Data Path</span>
              <span className="font-mono text-slate-300 truncate max-w-[150px]">./data/nedb</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Target Services</span>
              <span className="text-slate-300">ms-product</span>
            </div>
          </div>
        </div>

        {/* Key-Value */}
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-lg">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-sm text-white">KV Cache &amp; Queue</h3>
            <span className="text-xs bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded font-bold uppercase">
              Redis / RocksDB
            </span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Driver</span>
              <span className="font-mono text-white">Redis 7 / RocksDB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Host / Path</span>
              <span className="font-mono text-slate-300">localhost:6379</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Broker</span>
              <span className="text-slate-300">BullMQ</span>
            </div>
          </div>
        </div>

        {/* Object Storage */}
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-lg">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-sm text-white">Object Storage</h3>
            <span className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
              rustfsHealth.healthy === null
                ? 'bg-slate-600/20 text-slate-400'
                : rustfsHealth.healthy
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/20 text-rose-300'
            }`}>
              {rustfsHealth.healthy === null ? 'Probing…' : rustfsHealth.healthy ? '✓ RustFS Live' : '✗ RustFS Offline'}
            </span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Endpoint</span>
              <span className="font-mono text-white">{rustfsHealth.endpoint}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bucket</span>
              <span className="font-mono text-slate-300">{rustfsHealth.bucket}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Latency</span>
              <span className={`font-mono font-bold ${rustfsHealth.healthy ? 'text-emerald-400' : 'text-rose-400'}`}>
                {rustfsHealth.latencyMs > 0 ? `${rustfsHealth.latencyMs} ms` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Probed via</span>
              <span className="text-slate-400 font-mono">ms-product :3002</span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-slate-700">
              <a href="http://localhost:9001" target="_blank" rel="noreferrer" className="text-indigo-400 font-bold hover:underline">
                Console → Port 9001
              </a>
              <button
                onClick={onPingRustFS}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-0.5 rounded transition"
              >
                Refresh
              </button>
            </div>
            {rustfsHealth.lastChecked && (
              <div className="text-slate-600 text-right" style={{ fontSize: '10px' }}>
                Last checked: {new Date(rustfsHealth.lastChecked).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
