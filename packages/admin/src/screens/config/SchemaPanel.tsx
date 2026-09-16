import { useMemo, useState } from 'react'
import type { SchemaColumn, SchemaData } from './configTypes'
import { ConfigCard, type OpenSignal } from './parts'
import { EmptyState } from '../../components/ui'

/** Keys first, then FKs, then required, then the optional tail. */
function sortColumns(columns: SchemaColumn[]): SchemaColumn[] {
  const rank = (c: SchemaColumn) => {
    if (c.isPrimaryKey) return 0
    if (c.references) return 1
    if (!c.nullable) return 2
    return 3
  }
  return [...columns].sort((a, b) => rank(a) - rank(b))
}

export default function SchemaPanel({ schema, openSignal }: { schema: SchemaData | null; openSignal?: OpenSignal }) {
  const [filter, setFilter] = useState('')

  const tables = useMemo(() => {
    if (!schema) return []
    const q = filter.trim().toLowerCase()
    if (!q) return schema.tables
    return schema.tables.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.service.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
    )
  }, [schema, filter])

  if (!schema) return <EmptyState message="Schema unavailable." />

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter tables, services or columns..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <span className="chip chip-slate">Tables {schema.summary.tableCount}</span>
          <span className="chip chip-slate">Columns {schema.summary.columnCount}</span>
          <span className="chip chip-slate">Indexes {schema.summary.indexCount}</span>
          <span className="chip chip-slate">Rows {schema.summary.totalRows.toLocaleString()}</span>
        </div>
      </div>

      {tables.length === 0 ? (
        <EmptyState message={`No tables match "${filter}"`} />
      ) : (
        tables.map((table) => (
          <ConfigCard
            key={table.name}
            openSignal={openSignal}
            title={
              <>
                <span className="chip chip-blue">{table.service}</span>
                <span className="mono">{table.name}</span>
              </>
            }
            defaultOpen={false}
            metrics={
              <>
                <span>
                  <b>{table.columns.length}</b> cols
                </span>
                <span>
                  <b>{table.columns.filter((c) => c.references).length}</b> fks
                </span>
                <span>
                  <b>{table.indexes.length}</b> idx
                </span>
                <span>
                  <b>{table.rowCount === null ? 'n/a' : table.rowCount.toLocaleString()}</b> rows
                </span>
              </>
            }
          >
            <table className="schema-table">
              <colgroup>
                <col className="c-column" />
                <col className="c-type" />
                <col className="c-key" />
                <col className="c-refs" />
                <col className="c-null" />
                <col className="c-default" />
              </colgroup>
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Key</th>
                  <th>References</th>
                  <th>Nullable</th>
                  <th>Default</th>
                </tr>
              </thead>
              <tbody>
                {sortColumns(table.columns).map((c) => (
                  <tr key={c.name}>
                    <td className="mono">{c.name}</td>
                    <td className="mono cell-muted">{c.type}</td>
                    <td>
                      {c.isPrimaryKey && <span className="chip chip-amber">PK</span>}
                      {c.isUnique && <span className="chip chip-purple">UQ</span>}
                      {!c.isPrimaryKey && !c.isUnique && <span className="cell-muted">—</span>}
                    </td>
                    <td>
                      {c.references ? (
                        <span className="chip chip-blue chip-mono">{c.references}</span>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>
                    <td className={c.nullable ? 'cell-muted' : ''}>{c.nullable ? 'yes' : 'no'}</td>
                    <td className="mono cell-muted">{c.default ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {table.indexes.length > 0 && (
              <>
                <div className="section-title spaced">Indexes</div>
                {table.indexes.map((idx) => (
                  <div key={idx.name} className="schema-index">
                    <span className="k">{idx.name}</span>
                    <span className="v">{idx.definition}</span>
                  </div>
                ))}
              </>
            )}
          </ConfigCard>
        ))
      )}
    </>
  )
}
