import { useMemo, useState } from 'react'
import type { ApiEndpointData } from './configTypes'
import { ConfigCard, type OpenSignal } from './parts'
import { EmptyState } from '../../components/ui'
import { ExternalLinkIcon } from '../../components/icons'

/** GET/POST/PUT/DELETE first (the common cases), then anything else. */
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY']

function orderMethods(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts).sort(([a], [b]) => {
    const ia = METHOD_ORDER.indexOf(a)
    const ib = METHOD_ORDER.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })
}

export default function ApiPanel({ data, openSignal }: { data: ApiEndpointData | null; openSignal?: OpenSignal }) {
  const [filter, setFilter] = useState('')

  const groups = useMemo(() => {
    if (!data) return []
    const q = filter.trim().toLowerCase()
    if (!q) return data.groups
    return data.groups
      .map((g) => ({
        ...g,
        endpoints: g.name.toLowerCase().includes(q)
          ? g.endpoints
          : g.endpoints.filter((e) => e.path.toLowerCase().includes(q) || e.method.toLowerCase().includes(q))
      }))
      .filter((g) => g.endpoints.length > 0)
  }, [data, filter])

  if (!data) return <EmptyState message="Endpoint inventory unavailable." />

  const undocumented = data.summary.endpointCount - data.summary.documentedCount

  return (
    <>
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
          <span className="chip chip-slate">Services {groups.length}</span>
          {orderMethods(data.summary.methodCounts).map(([method, count]) => (
            <span key={method} className={`chip method-chip method-${method}`}>
              {method} {count}
            </span>
          ))}
          {undocumented > 0 && <span className="chip chip-slate">Undoc {undocumented}</span>}
          <span className="chip chip-slate">Routes {data.summary.endpointCount}</span>
        </div>
      </div>

      {undocumented > 0 && (
        <div className="warn-banner">
          {undocumented} of {data.summary.endpointCount} routes are gateway-proxied passthroughs, documented in each
          upstream service's own Swagger UI rather than the gateway's.
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState message={`No endpoints match "${filter}"`} />
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
                <>
                  <span className="mono">{group.name}</span>
                  <span className="chip chip-slate" style={{ marginLeft: 8 }}>
                    :{group.port}
                  </span>
                </>
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
              {group.docsUrl && (
                <div className="config-row">
                  <span className="k">Swagger / OpenAPI docs</span>
                  <span className="config-control">
                    <a className="btn btn-ghost btn-sm" href={group.docsUrl} target="_blank" rel="noreferrer">
                      Open /api-docs <ExternalLinkIcon style={{ width: 12, height: 12 }} />
                    </a>
                  </span>
                </div>
              )}
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
