import { useState } from 'react'
import { ConfigCard, ReadOnlyRow, type OpenSignal } from './config/parts'
import SchemaPanel from './config/SchemaPanel'
import ApiPanel from './config/ApiPanel'
import SystemLogsPanel from './config/SystemLogsPanel'
import { SCHEMA_DATA, API_ENDPOINT_DATA, LOG_FILES } from './config/configSeed'

type ConfigSubTab = 'general' | 'schema' | 'api' | 'logs'

export default function ConfigTab() {
  const [tab, setTab] = useState<ConfigSubTab>('general')

  // Broadcast to every ConfigCard on the active tab. The nonce is what the
  // cards react to, so pressing the same button twice still re-applies after
  // individual cards have been toggled by hand.
  const [openSignal, setOpenSignal] = useState<OpenSignal>({ open: false, nonce: 0 })
  const broadcast = (open: boolean) => setOpenSignal((prev) => ({ open, nonce: prev.nonce + 1 }))

  // The logs tab owns a plain table, not collapsible cards, so the
  // expand/collapse pair would be inert there.
  const hasCards = tab !== 'logs'

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="config-tabs">
            {(
              [
                ['general', 'General'],
                ['schema', 'DB Schema'],
                ['api', 'API Endpoints'],
                ['logs', 'System Logs'],
              ] as [ConfigSubTab, string][]
            ).map(([key, label]) => {
              const count =
                key === 'schema'
                  ? SCHEMA_DATA.summary.tableCount
                  : key === 'api'
                    ? API_ENDPOINT_DATA.summary.endpointCount
                    : key === 'logs'
                      ? LOG_FILES.length
                      : undefined
              return (
                <button
                  key={key}
                  className={`filter-tab${tab === key ? ' active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  {label}
                  {count !== undefined && <span className="count">{count}</span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="toolbar-right">
          {hasCards && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => broadcast(true)}>
                Expand All
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => broadcast(false)}>
                Collapse All
              </button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>

      {tab === 'general' && (
        <>
          <ConfigCard
            title={
              <>
                <span>🌐 Network Service Ports</span>
                <span className="chip chip-blue" style={{ marginLeft: 8 }}>
                  Ports
                </span>
              </>
            }
            count={7}
            openSignal={openSignal}
          >
            <ReadOnlyRow label="API Gateway Ingress" value=":3000" />
            <ReadOnlyRow label="User Microservice" value=":3001" />
            <ReadOnlyRow label="Product Microservice" value=":3002" />
            <ReadOnlyRow label="Order Microservice" value=":3003" />
            <ReadOnlyRow label="Customer Storefront (Next.js)" value=":3004" />
            <ReadOnlyRow label="Admin Cockpit Classic" value=":3005" />
            <div className="config-row">
              <span className="k">Admin Cockpit v2 (Active)</span>
              <span className="v" style={{ color: 'var(--blue-light)' }}>
                :3006
              </span>
            </div>
          </ConfigCard>

          <ConfigCard
            title={
              <>
                <span>🔐 Security & JWT Policies</span>
                <span className="chip chip-purple" style={{ marginLeft: 8 }}>
                  Auth
                </span>
              </>
            }
            count={4}
            openSignal={openSignal}
          >
            <ReadOnlyRow label="JWT Token Expiry" value="7 days" />
            <ReadOnlyRow label="Refresh Token Lifetime" value="30 days" />
            <ReadOnlyRow label="Password Hashing" value="Bcrypt (12 rounds)" />
            <div className="config-row">
              <span className="k">Prisma Schema Validation</span>
              <span className="v bool-true">Enabled</span>
            </div>
          </ConfigCard>

          <ConfigCard
            title={
              <>
                <span>⚡ Async Task Queues</span>
                <span className="chip chip-amber" style={{ marginLeft: 8 }}>
                  BullMQ
                </span>
              </>
            }
            count={4}
            openSignal={openSignal}
          >
            <ReadOnlyRow label="Message Broker" value="Redis 7 / BullMQ" />
            <ReadOnlyRow label="Worker Concurrency" value="10 workers" />
            <ReadOnlyRow label="Order Expiration Timeout" value="15 minutes" />
            <ReadOnlyRow label="Saga Max Retries" value="5 attempts" />
          </ConfigCard>
        </>
      )}

      {tab === 'schema' && <SchemaPanel schema={SCHEMA_DATA} openSignal={openSignal} />}
      {tab === 'api' && <ApiPanel data={API_ENDPOINT_DATA} openSignal={openSignal} />}
      {tab === 'logs' && <SystemLogsPanel files={LOG_FILES} />}
    </>
  )
}
