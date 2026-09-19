import { useMemo, useState } from 'react'
import type { SchemaData, SchemaUnreachable } from '../../hooks/useSchema'
import { ConfigCard, type OpenSignal } from './parts'
import { EmptyState, Spinner, StatChip } from '../../components/ui'

export default function SchemaPanel({
  data,
  unreachable,
  loading,
  openSignal,
}: {
  data: SchemaData | null
  unreachable: SchemaUnreachable[]
  loading: boolean
  openSignal?: OpenSignal
}) {
  const [filter, setFilter] = useState('')

  const tables = useMemo(() => {
    if (!data) return []
    const q = filter.trim().toLowerCase()
    if (!q) return data.tables
    return data.tables.filter(
      (t) => t.name.toLowerCase().includes(q) || t.service.toLowerCase().includes(q)
    )
  }, [data, filter])

  if (loading && !data) return <Spinner label="Introspecting live database schema…" />
  if (!data) return <EmptyState message="No service is currently reachable for schema introspection." />

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter tables by name or service..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <StatChip value={data.summary.tableCount} label="Tables" />
          <StatChip value={data.summary.columnCount} label="Columns" />
          <StatChip value={data.summary.indexCount} label="Indexes" />
          <StatChip value={data.summary.totalRows} label="Rows" variant="blue" />
        </div>
      </div>

      {unreachable.length > 0 && (
        <div className="warn-banner">
          {unreachable.map((u) => u.service).join(', ')}{' '}
          {unreachable.length === 1 ? 'is' : 'are'} unreachable — its tables are omitted below
          rather than shown from a stale copy.
        </div>
      )}

      {tables.length === 0 ? (
        <EmptyState message={`No tables match "${filter}"`} />
      ) : (
        tables.map((table) => (
          <ConfigCard
            key={`${table.service}.${table.name}`}
            openSignal={openSignal}
            title={
              <>
                <span className="mono">{table.name}</span>
                <span className="chip chip-slate" style={{ marginLeft: 8 }}>
                  {table.service}
                </span>
                <span className="chip chip-purple" style={{ marginLeft: 8 }}>
                  {table.driver}
                </span>
              </>
            }
            defaultOpen={false}
            metrics={
              <>
                <span>
                  <b>{table.columns.length}</b> columns
                </span>
                <span className={table.indexes.length ? undefined : 'metric-empty'}>
                  {table.indexes.length ? (
                    <>
                      <b>{table.indexes.length}</b> indexes
                    </>
                  ) : (
                    ''
                  )}
                </span>
                <span>
                  <b>{table.rowCount}</b> rows
                </span>
              </>
            }
          >
            {table.note && <div className="warn-banner">{table.note}</div>}
            {table.columns.length > 0 && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Nullable</th>
                      <th>Flags</th>
                      <th>Default</th>
                      <th>References</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.columns.map((col) => (
                      <tr key={col.name}>
                        <td className="mono">{col.name}</td>
                        <td className="mono cell-muted">{col.type}</td>
                        <td>
                          {col.nullable === undefined ? (
                            <span className="cell-muted">n/a</span>
                          ) : (
                            <span className={col.nullable ? 'v bool-false' : 'v bool-true'}>
                              {col.nullable ? 'yes' : 'no'}
                            </span>
                          )}
                        </td>
                        <td>
                          {col.isPrimaryKey && <span className="chip chip-blue">PK</span>}
                          {col.isUnique && !col.isPrimaryKey && (
                            <span className="chip chip-purple" style={{ marginLeft: 4 }}>
                              UNIQUE
                            </span>
                          )}
                        </td>
                        <td className="mono cell-muted">{col.default ?? '—'}</td>
                        <td className="mono cell-muted">{col.references ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {table.indexes.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {table.indexes.map((idx) => (
                  <div key={idx.name} className="config-row">
                    <span className="k mono">{idx.name}</span>
                    <span className="v mono cell-muted">{idx.definition}</span>
                  </div>
                ))}
              </div>
            )}
          </ConfigCard>
        ))
      )}
    </>
  )
}
