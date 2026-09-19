import { useState } from 'react'
import {
  ADMIN_PORT,
  CLIENT_PORT,
  GATEWAY_PORT,
  ORDER_SERVICE_PORT,
  PRODUCT_SERVICE_PORT,
  USER_SERVICE_PORT,
} from '../data/serviceUrls'
import type { ServiceItem } from '../types'
import { ConfigCard, ReadOnlyRow, MultiFieldRow, type OpenSignal } from './config/parts'
import ServicesPanel from './config/ServicesPanel'
import TaskQueuesPanel from './config/TaskQueuesPanel'
import ApiPanel from './config/ApiPanel'
import SystemLogsPanel from './config/SystemLogsPanel'
import { useCacheDriver, useMergedQueueData, describeSourceError } from '../hooks/useQueueData'
import { OfflineBanner } from '../components/ui'
import { useApiDocs } from '../hooks/useApiDocs'
import { useLogFiles } from '../hooks/useLogFiles'

type ConfigSubTab = 'general' | 'services' | 'queues' | 'api' | 'logs'

export default function ConfigTab({
  services,
  lastScanned,
  onSelectService,
  onRefreshServices,
}: {
  services: ServiceItem[]
  lastScanned: string
  onSelectService: (svc: ServiceItem) => void
  onRefreshServices: () => void
}) {
  const [tab, setTab] = useState<ConfigSubTab>('general')

  const queueData = useMergedQueueData()
  const driver = useCacheDriver()
  const apiDocs = useApiDocs()
  const logFiles = useLogFiles()

  // Broadcast to every ConfigCard on the active tab. The nonce is what the
  // cards react to, so pressing the same button twice still re-applies after
  // individual cards have been toggled by hand.
  const [openSignal, setOpenSignal] = useState<OpenSignal>({ open: false, nonce: 0 })
  const broadcast = (open: boolean) => setOpenSignal((prev) => ({ open, nonce: prev.nonce + 1 }))

  // The services, queues and logs tabs own a plain table, not collapsible
  // cards, so the expand/collapse pair would be inert there.
  const hasCards = tab !== 'services' && tab !== 'queues' && tab !== 'logs'

  const reloading =
    (tab === 'queues' && queueData.loading) ||
    (tab === 'general' && driver.loading) ||
    (tab === 'api' && apiDocs.loading) ||
    (tab === 'logs' && logFiles.loading)
  const handleReload = () => {
    if (tab === 'queues') {
      queueData.refetch()
    } else if (tab === 'general') {
      driver.refetch()
      queueData.refetch()
    } else if (tab === 'services') {
      onRefreshServices()
    } else if (tab === 'api') {
      apiDocs.refetch()
    } else if (tab === 'logs') {
      logFiles.refetch()
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="config-tabs">
            {(
              [
                ['general', 'General'],
                ['services', 'Services'],
                ['queues', 'Task Queues'],
                ['api', 'APIs'],
                ['logs', 'Logs'],
              ] as [ConfigSubTab, string][]
            ).map(([key, label]) => {
              const count =
                key === 'general'
                  ? 3
                  : key === 'services'
                    ? services.length
                    : key === 'queues'
                      ? queueData.data?.summary.queueCount
                      : key === 'api'
                        ? apiDocs.data?.summary.endpointCount
                        : key === 'logs'
                          ? logFiles.data?.total
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
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleReload}
            disabled={reloading}
            aria-busy={reloading}
          >
            {reloading ? 'Reloading…' : 'Reload'}
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
            count={6}
            openSignal={openSignal}
          >
            <ReadOnlyRow label="API Gateway Ingress" value={GATEWAY_PORT} />
            <div className="config-row">
              <span className="k">Admin Cockpit (Active)</span>
              <span className="v" style={{ color: 'var(--blue-light)' }}>
                {ADMIN_PORT}
              </span>
            </div>
            <ReadOnlyRow label="Customer Storefront (Next.js)" value={CLIENT_PORT} />
            <ReadOnlyRow label="User Microservice" value={USER_SERVICE_PORT} />
            <ReadOnlyRow label="Product Microservice" value={PRODUCT_SERVICE_PORT} />
            <ReadOnlyRow label="Order Microservice" value={ORDER_SERVICE_PORT} />
          </ConfigCard>

          <ConfigCard
            title={
              <>
                <span>🔐 Auth (Demo Mode)</span>
                <span className="chip chip-purple" style={{ marginLeft: 8 }}>
                  Auth
                </span>
              </>
            }
            count={3}
            openSignal={openSignal}
          >
            <ReadOnlyRow label="Password Hashing" value="Bcrypt (10 rounds)" />
            <ReadOnlyRow label="Login Token" value="Static demo token — no JWT is issued" />
            <div className="config-row">
              <span className="k">Password Verification on Login</span>
              <span className="v bool-false">
                Not enforced — existence + active-status check only
              </span>
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
            count={6}
            openSignal={openSignal}
          >
            <ReadOnlyRow
              label="Queue Driver"
              value={
                driver.data
                  ? driver.data.queuesAvailable
                    ? 'BullMQ over Redis'
                    : `Unavailable — KV driver is "${driver.data.driver}", BullMQ requires Redis`
                  : '—'
              }
            />
            <ReadOnlyRow label="Worker Concurrency" value="5–10 workers per queue" />
            <ReadOnlyRow
              label="Registered Queues"
              value={
                queueData.data
                  ? `${queueData.data.summary.queueCount} queues`
                  : queueData.loading
                    ? 'Loading…'
                    : 'Unavailable — Redis unreachable'
              }
            />
            <ReadOnlyRow label="Order Expiration Timeout" value="15 minutes" />
            <ReadOnlyRow label="Saga Max Retries" value="5 attempts" />
            <MultiFieldRow
              fields={[
                {
                  label: 'Client',
                  value: driver.data?.queuesAvailable ? 'ioredis (BullMQ client)' : '—',
                },
                {
                  label: 'Backing Store',
                  value: driver.data
                    ? driver.data.queuesAvailable
                      ? 'Redis 7 (DB 0)'
                      : 'None — queues disabled'
                    : '—',
                },
                { label: 'Retry Policy', value: 'per-queue backoff, 3–5 attempts' },
              ]}
            />
          </ConfigCard>
        </>
      )}

      {tab === 'services' && (
        <ServicesPanel
          services={services}
          lastScanned={lastScanned}
          onSelectService={onSelectService}
          onRefresh={onRefreshServices}
        />
      )}
      {tab === 'queues' && (
        <>
          {queueData.data !== null &&
            queueData.sources
              .filter((s) => s.error)
              .map((source) => (
                <OfflineBanner
                  key={source.service}
                  title={`${source.service} queue data unavailable — ${describeSourceError(source)}`}
                  detail={source.error?.message}
                  reason={
                    source.error?.reason ??
                    (source.error?.status ? `HTTP ${source.error.status}` : 'network_error')
                  }
                  onRetry={queueData.refetch}
                  retrying={queueData.loading}
                />
              ))}
          <TaskQueuesPanel
            data={queueData.data}
            loading={queueData.loading}
            error={
              queueData.data === null
                ? (queueData.sources.find((s) => s.error)?.error ?? null)
                : null
            }
            onRetry={queueData.refetch}
          />
        </>
      )}
      {tab === 'api' && (
        <ApiPanel
          data={apiDocs.data}
          unreachable={apiDocs.unreachable}
          loading={apiDocs.loading}
          openSignal={openSignal}
        />
      )}
      {tab === 'logs' && (
        <SystemLogsPanel
          files={logFiles.data?.files ?? []}
          unreachable={logFiles.unreachable}
          loading={logFiles.loading}
        />
      )}
    </>
  )
}
