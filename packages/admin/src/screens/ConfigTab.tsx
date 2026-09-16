export default function ConfigTab() {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            System Runtime Configuration <span className="tag">Matrix</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            Centralized environment policies, ports, queue concurrency, and security parameters.
          </div>
        </div>
      </div>

      <div className="panel-grid">
        <div className="panel">
          <h3>
            <span>🌐 Network Service Ports</span>
            <span className="chip chip-blue">Ports</span>
          </h3>
          <div className="panel-row">
            <span className="k">API Gateway Ingress</span>
            <span className="v mono">:3000</span>
          </div>
          <div className="panel-row">
            <span className="k">User Microservice</span>
            <span className="v mono">:3001</span>
          </div>
          <div className="panel-row">
            <span className="k">Product Microservice</span>
            <span className="v mono">:3002</span>
          </div>
          <div className="panel-row">
            <span className="k">Order Microservice</span>
            <span className="v mono">:3003</span>
          </div>
          <div className="panel-row">
            <span className="k">Customer Storefront (Next.js)</span>
            <span className="v mono">:3004</span>
          </div>
          <div className="panel-row">
            <span className="k">Admin Cockpit Classic</span>
            <span className="v mono">:3005</span>
          </div>
          <div className="panel-row">
            <span className="k">Admin Cockpit v2 (Active)</span>
            <span className="v mono" style={{ color: 'var(--blue-light)' }}>
              :3006
            </span>
          </div>
        </div>

        <div className="panel">
          <h3>
            <span>🔐 Security & JWT Policies</span>
            <span className="chip chip-purple">Auth</span>
          </h3>
          <div className="panel-row">
            <span className="k">JWT Token Expiry</span>
            <span className="v mono">7 days</span>
          </div>
          <div className="panel-row">
            <span className="k">Refresh Token Lifetime</span>
            <span className="v mono">30 days</span>
          </div>
          <div className="panel-row">
            <span className="k">Password Hashing</span>
            <span className="v mono">Bcrypt (12 rounds)</span>
          </div>
          <div className="panel-row">
            <span className="k">Prisma Schema Validation</span>
            <span className="v mono" style={{ color: 'var(--green-light)' }}>
              Enabled
            </span>
          </div>
        </div>

        <div className="panel">
          <h3>
            <span>⚡ Async Task Queues</span>
            <span className="chip chip-amber">BullMQ</span>
          </h3>
          <div className="panel-row">
            <span className="k">Message Broker</span>
            <span className="v">Redis 7 / BullMQ</span>
          </div>
          <div className="panel-row">
            <span className="k">Worker Concurrency</span>
            <span className="v mono">10 workers</span>
          </div>
          <div className="panel-row">
            <span className="k">Order Expiration Timeout</span>
            <span className="v mono">15 minutes</span>
          </div>
          <div className="panel-row">
            <span className="k">Saga Max Retries</span>
            <span className="v mono">5 attempts</span>
          </div>
        </div>
      </div>
    </>
  )
}
