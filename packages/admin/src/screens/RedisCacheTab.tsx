import { useState } from 'react'
import { StatCard } from '../components/ui'

// Static snapshot shaped like a real `INFO` command response + key-namespace
// breakdown. This admin has no live ioredis connection (see PersistenceTab.tsx
// and ConfigTab.tsx's KV Cache / Async Task Queues cards) — the values below
// are realistic mock numbers consistent with the docker-compose `redis`
// service (redis:7-alpine, port 6379) and the BullMQ queues on the Task
// Queues tab.

interface RedisNamespace {
  prefix: string
  purpose: string
  approxKeyCount: number
}

const NAMESPACES: RedisNamespace[] = [
  {
    prefix: 'bull:order-expiration:*',
    purpose: 'BullMQ job data, state sets & events for the order-expiration queue',
    approxKeyCount: 412,
  },
  {
    prefix: 'bull:payment-retry:*',
    purpose: 'BullMQ job data, state sets & events for the payment-retry queue',
    approxKeyCount: 187,
  },
  {
    prefix: 'bull:notification-dispatch:*',
    purpose: 'BullMQ job data, state sets & events for the notification-dispatch queue',
    approxKeyCount: 264,
  },
  {
    prefix: 'bull:saga-compensation:*',
    purpose: 'BullMQ job data, state sets & events for the saga-compensation queue',
    approxKeyCount: 38,
  },
  {
    prefix: 'cache:products:*',
    purpose: 'Cache-aside entries for ms-product catalog reads (product & category lookups)',
    approxKeyCount: 1360,
  },
  {
    prefix: 'session:*',
    purpose: 'Short-lived refresh-token / session lookups issued by ms-user',
    approxKeyCount: 96,
  },
  {
    prefix: 'ratelimit:*',
    purpose: 'API gateway rate-limit counters (100 req/min window per client)',
    approxKeyCount: 54,
  },
]

interface RedisStats {
  usedMemoryMb: number
  peakMemoryMb: number
  connectedClients: number
  opsPerSec: number
  uptimeHours: number
  totalKeys: number
  hitRate: number
}

function randomStats(): RedisStats {
  return {
    usedMemoryMb: Math.round((38 + Math.random() * 6) * 10) / 10,
    peakMemoryMb: Math.round((52 + Math.random() * 4) * 10) / 10,
    connectedClients: 6 + Math.floor(Math.random() * 4),
    opsPerSec: 180 + Math.floor(Math.random() * 90),
    uptimeHours: 71,
    totalKeys: NAMESPACES.reduce((sum, n) => sum + n.approxKeyCount, 0),
    hitRate: Math.round((91 + Math.random() * 5) * 10) / 10,
  }
}

export default function RedisCacheTab() {
  const [stats, setStats] = useState<RedisStats>(randomStats)

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            Cache <span className="tag">Redis</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            Redis 7 instance backing BullMQ queues and cache-aside product reads.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setStats(randomStats())}>
            Probe Redis ↻
          </button>
        </div>
      </div>

      <div
        className="panel-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
      >
        {/* Connection Info */}
        <div className="panel">
          <h3>
            <span>Connection</span>
            <span className="chip chip-green">✓ Connected</span>
          </h3>
          <div className="panel-row">
            <span className="k">Driver</span>
            <span className="v mono">ioredis (BullMQ client)</span>
          </div>
          <div className="panel-row">
            <span className="k">Host</span>
            <span className="v mono">localhost</span>
          </div>
          <div className="panel-row">
            <span className="k">Port</span>
            <span className="v mono">6379</span>
          </div>
          <div className="panel-row">
            <span className="k">Image</span>
            <span className="v mono">redis:7-alpine</span>
          </div>
          <div className="panel-row">
            <span className="k">DB Index</span>
            <span className="v mono">0</span>
          </div>
        </div>

        {/* INFO-style stats */}
        <div className="panel" style={{ gridColumn: 'span 2' }}>
          <h3>
            <span>Server Info</span>
            <span className="chip chip-purple">INFO</span>
          </h3>
          <div className="stats-grid" style={{ marginBottom: 0 }}>
            <StatCard label="Used Memory" value={`${stats.usedMemoryMb} MB`} tone="blue" />
            <StatCard label="Peak Memory" value={`${stats.peakMemoryMb} MB`} tone="purple" />
            <StatCard label="Connected Clients" value={stats.connectedClients} tone="green" />
            <StatCard label="Ops / sec" value={stats.opsPerSec} tone="yellow" />
            <StatCard label="Uptime" value={`${stats.uptimeHours}h`} tone="blue" />
            <StatCard label="Keyspace Hit Rate" value={`${stats.hitRate}%`} tone="green" />
          </div>
        </div>
      </div>

      <div className="section-title spaced" style={{ marginBottom: 8 }}>
        Key Namespaces
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Prefix</th>
              <th>Purpose</th>
              <th className="cell-right">Approx. Keys</th>
            </tr>
          </thead>
          <tbody>
            {NAMESPACES.map((ns) => (
              <tr key={ns.prefix}>
                <td className="mono">{ns.prefix}</td>
                <td className="cell-muted">{ns.purpose}</td>
                <td className="mono cell-right">{ns.approxKeyCount.toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td className="mono" style={{ fontWeight: 700, color: 'var(--text-bright)' }}>
                Total
              </td>
              <td className="cell-muted"></td>
              <td
                className="mono cell-right"
                style={{ fontWeight: 700, color: 'var(--text-bright)' }}
              >
                {stats.totalKeys.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
