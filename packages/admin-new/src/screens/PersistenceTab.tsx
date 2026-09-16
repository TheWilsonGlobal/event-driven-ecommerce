import type { RustfsHealth } from '../types'

interface Props {
  rustfsHealth: RustfsHealth
  onPingRustFS: () => void
}

export default function PersistenceTab({ rustfsHealth, onPingRustFS }: Props) {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            Persistence & Storage Topology <span className="tag">Hybrid Storage</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            Active relational, document, key-value and S3-compatible RustFS object storage drivers.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={onPingRustFS}>
            Probe Storage ↻
          </button>
        </div>
      </div>

      <div
        className="panel-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
      >
        {/* Relational Database */}
        <div className="panel">
          <h3>
            <span>Relational Database</span>
            <span className="chip chip-blue">PostgreSQL / SQLite</span>
          </h3>
          <div className="panel-row">
            <span className="k">ORM Engine</span>
            <span className="v mono">Prisma 5.22.0</span>
          </div>
          <div className="panel-row">
            <span className="k">Connection URL</span>
            <span className="v mono" style={{ fontSize: 10 }}>
              postgresql://***@localhost:5432
            </span>
          </div>
          <div className="panel-row">
            <span className="k">Target Services</span>
            <span className="v">ms-user, ms-order</span>
          </div>
        </div>

        {/* Document Store */}
        <div className="panel">
          <h3>
            <span>Document Database</span>
            <span className="chip chip-green">NeDB / MongoDB</span>
          </h3>
          <div className="panel-row">
            <span className="k">Storage Driver</span>
            <span className="v mono">Embedded NeDB</span>
          </div>
          <div className="panel-row">
            <span className="k">Local Data Path</span>
            <span className="v mono" style={{ fontSize: 10 }}>
              ./data/nedb
            </span>
          </div>
          <div className="panel-row">
            <span className="k">Target Services</span>
            <span className="v">ms-product</span>
          </div>
        </div>

        {/* Key-Value Cache & Queue */}
        <div className="panel">
          <h3>
            <span>KV Cache & Queues</span>
            <span className="chip chip-purple">Redis 7 / RocksDB</span>
          </h3>
          <div className="panel-row">
            <span className="k">Queue Driver</span>
            <span className="v mono">BullMQ over Redis</span>
          </div>
          <div className="panel-row">
            <span className="k">Redis Host</span>
            <span className="v mono">localhost:6379</span>
          </div>
          <div className="panel-row">
            <span className="k">Worker Concurrency</span>
            <span className="v mono">10 workers</span>
          </div>
        </div>

        {/* Object Storage */}
        <div
          className="panel"
          style={{ borderColor: rustfsHealth.healthy ? 'var(--green-border)' : 'var(--border)' }}
        >
          <h3>
            <span>Object Storage (S3-API)</span>
            <span className={`chip ${rustfsHealth.healthy ? 'chip-green' : 'chip-red'}`}>
              {rustfsHealth.healthy === null
                ? 'Probing…'
                : rustfsHealth.healthy
                  ? '✓ RustFS Online'
                  : '✗ Offline'}
            </span>
          </h3>
          <div className="panel-row">
            <span className="k">Provider</span>
            <span className="v mono" style={{ color: 'var(--blue-light)' }}>
              RustFS (S3-Compatible)
            </span>
          </div>
          <div className="panel-row">
            <span className="k">Endpoint</span>
            <span className="v mono" style={{ fontSize: 10 }}>
              {rustfsHealth.endpoint}
            </span>
          </div>
          <div className="panel-row">
            <span className="k">Target Bucket</span>
            <span className="v mono">{rustfsHealth.bucket}</span>
          </div>
          <div className="panel-row">
            <span className="k">Measured Latency</span>
            <span
              className="v mono"
              style={{ color: rustfsHealth.healthy ? 'var(--green-light)' : 'var(--red-light)' }}
            >
              {rustfsHealth.latencyMs > 0 ? `${rustfsHealth.latencyMs} ms` : '—'}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid var(--border)',
            }}
          >
            <a
              href="http://localhost:9001"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--blue-light)', fontWeight: 600 }}
            >
              Open RustFS Console (Port 9001) &rarr;
            </a>
            <button className="btn btn-ghost btn-sm" onClick={onPingRustFS}>
              Ping
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
