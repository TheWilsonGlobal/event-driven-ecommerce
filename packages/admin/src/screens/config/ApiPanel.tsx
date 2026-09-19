import { useMemo, useState } from 'react'
import type { ApiDocsData, ApiDocsUnreachable } from '../../hooks/useApiDocs'
import { ConfigCard, type OpenSignal } from './parts'
import { EmptyState, Spinner, StatChip } from '../../components/ui'
import { ExternalLinkIcon } from '../../components/icons'

/** GET/POST/PUT/DELETE first (the common cases), then anything else. OPTIONS
 *  is shown as its own summary chip next to Services rather than mixed in
 *  here, since it is CORS-preflight plumbing rather than an API verb an
 *  operator calls directly. */
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY']

export default function ApiPanel({
  data,
  unreachable,
  loading,
  openSignal,
}: {
  data: ApiDocsData | null
  unreachable: ApiDocsUnreachable[]
  loading: boolean
  openSignal?: OpenSignal
}) {
  const [filter, setFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState<string | null>(null)
  const [undocOnly, setUndocOnly] = useState(false)

  const toggleMethodFilter = (m: string) => setMethodFilter((prev) => (prev === m ? null : m))
  const toggleUndocOnly = () => setUndocOnly((prev) => !prev)
  const clearHeaderFilters = () => {
    setMethodFilter(null)
    setUndocOnly(false)
  }

  const groups = useMemo(() => {
    if (!data) return []
    const q = filter.trim().toLowerCase()
    return data.groups
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter((e) => {
          if (methodFilter && e.method !== methodFilter) return false
          if (undocOnly && e.documented) return false
          if (!q) return true
          if (g.name.toLowerCase().includes(q)) return true
          return e.path.toLowerCase().includes(q) || e.method.toLowerCase().includes(q)
        }),
      }))
      .filter((g) => g.endpoints.length > 0)
  }, [data, filter, methodFilter, undocOnly])

  if (loading && !data) return <Spinner label="Fetching live OpenAPI docs from each service…" />
  if (!data) return <EmptyState message="No service is currently reachable for endpoint inventory." />

  const undocumented = data.summary.endpointCount - data.summary.documentedCount

  return (
    <>
      {undocumented > 0 && (
        <div className="warn-banner">
          {undocumented} of {data.summary.endpointCount} routes carry no route-level description —
          mostly the gateway's proxy routes and Swagger's own static UI routes, which have no schema
          of their own to describe them, documented in each upstream service's own Swagger UI instead.
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter services, paths or methods..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <StatChip value={groups.length} label="Services" />
          {data.summary.methodCounts.OPTIONS > 0 && (
            <span
              className={`chip chip-stat chip-btn method-chip method-OPTIONS${methodFilter === 'OPTIONS' ? ' chip-btn-active' : ''}`}
              onClick={() => toggleMethodFilter('OPTIONS')}
              title="Filter to OPTIONS routes"
            >
              <span className="chip-stat-value">{data.summary.methodCounts.OPTIONS}</span>
              <span className="chip-stat-label">OPTIONS</span>
            </span>
          )}
          {/* Same column widths/gap/order as each group row's metrics below
              (.config-metrics, shared with ConfigCard's own metrics slot), so
              this summary lines up as the header of one shared table rather
              than being an independently-sized row. The 14px right padding
              matches .config-card-head's own padding — without it this row's
              right edge sits 14px further right than every card's, since the
              toolbar has no padding of its own to eat into. Each column also
              doubles as a filter trigger for the endpoint list below. */}
          <span className="config-metrics clickable" style={{ paddingRight: 14 }}>
            {METHOD_ORDER.map((m) => {
              const count = data.summary.methodCounts[m] ?? 0
              return (
                <span
                  key={m}
                  className={`${count ? '' : 'metric-empty'} ${methodFilter === m ? 'metric-active' : ''}`.trim()}
                  onClick={count > 0 ? () => toggleMethodFilter(m) : undefined}
                  title={count > 0 ? `Filter to ${m} routes` : undefined}
                >
                  {count > 0 && (
                    <>
                      <b>{count}</b> {m}
                    </>
                  )}
                </span>
              )
            })}
            <span
              className={`${undocumented > 0 ? '' : 'metric-empty'} ${undocOnly ? 'metric-active' : ''}`.trim()}
              onClick={undocumented > 0 ? toggleUndocOnly : undefined}
              title={undocumented > 0 ? 'Filter to undocumented routes' : undefined}
            >
              {undocumented > 0 && (
                <>
                  <b>{undocumented}</b> undoc
                </>
              )}
            </span>
            <span onClick={clearHeaderFilters} title="Clear header filters">
              <b>{data.summary.endpointCount}</b> routes
            </span>
          </span>
        </div>
      </div>

      {unreachable.length > 0 && (
        <div className="warn-banner">
          {unreachable.map((u) => u.service).join(', ')}{' '}
          {unreachable.length === 1 ? 'is' : 'are'} unreachable — its live route inventory could not
          be fetched, so its routes are omitted below rather than shown from a stale copy.
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState
          message={
            filter
              ? `No endpoints match "${filter}"`
              : 'No endpoints match the active header filter.'
          }
        />
      ) : (
        groups.map((group) => {
          const counts: Record<string, number> = {}
          let undoc = 0
          for (const e of group.endpoints) {
            counts[e.method] = (counts[e.method] ?? 0) + 1
            if (!e.documented) undoc++
          }
          return (
            <ConfigCard
              key={group.name}
              openSignal={openSignal}
              title={
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="mono" style={{ display: 'inline-block', width: 90 }}>
                    {group.name}
                  </span>
                  <span
                    className="chip chip-slate"
                    style={{ width: 50, textAlign: 'center', marginRight: 8 }}
                  >
                    {group.port}
                  </span>
                  <a
                    href={group.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--blue-light)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.docsUrl} <ExternalLinkIcon style={{ width: 10, height: 10 }} />
                  </a>
                </span>
              }
              defaultOpen={false}
              metrics={
                <>
                  {METHOD_ORDER.map((m) => (
                    <span key={m} className={counts[m] ? undefined : 'metric-empty'}>
                      {counts[m] ? (
                        <>
                          <b>{counts[m]}</b> {m}
                        </>
                      ) : (
                        ''
                      )}
                    </span>
                  ))}
                  <span className={undoc > 0 ? undefined : 'metric-empty'}>
                    {undoc > 0 ? (
                      <>
                        <b>{undoc}</b> undoc
                      </>
                    ) : (
                      ''
                    )}
                  </span>
                  <span>
                    <b>{group.endpoints.length}</b> routes
                  </span>
                </>
              }
            >
              {group.endpoints.map((e) => (
                <div key={`${e.method} ${e.path}`} className="endpoint-row">
                  <span className={`method-chip method-${e.method}`}>{e.method}</span>
                  <span className="endpoint-path">{e.path}</span>
                  {e.summary && <span className="endpoint-summary grow">{e.summary}</span>}
                  {!e.documented && <span className="undoc-tag">proxied</span>}
                </div>
              ))}
            </ConfigCard>
          )
        })
      )}
    </>
  )
}
