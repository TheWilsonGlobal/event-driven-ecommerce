import { useState } from 'react'
import { EmptyState } from '../../components/ui'
import type { ProductRecord } from '../../types'
import { useTopProducts, type RankWindow } from '../../hooks/useTopProducts'

const WINDOWS: RankWindow[] = ['1h', '24h', '7d']

export default function TopProductsPanel({ products }: { products: ProductRecord[] }) {
  const [window, setWindow] = useState<RankWindow>('24h')
  const { data, loading, error, refetch } = useTopProducts(window)
  const titles = new Map(products.map((p) => [p.id, p.title]))

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h3 style={{ border: 'none', padding: 0, margin: 0 }}>
          Top products {data && <span className="chip chip-blue">source: {data.source}</span>}
        </h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>
            Window{' '}
            <select
              className="page-size-select"
              value={window}
              onChange={(e) => setWindow(e.target.value as RankWindow)}
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void refetch()}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Loading…' : 'Refresh ↻'}
          </button>
        </div>
      </div>

      {data?.windowApplied === 'all-time' && (
        <div className="cell-muted" role="note" style={{ padding: '8px 16px', fontSize: 12 }}>
          windowed ranking unavailable, showing all-time
        </div>
      )}

      {loading && !data && !error ? (
        <EmptyState message="Loading top products…" />
      ) : error ? (
        <div role="alert">
          <EmptyState message={error} />
        </div>
      ) : !data || data.products.length === 0 ? (
        <EmptyState message="No sales recorded for this window yet." />
      ) : (
        <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Product</th>
                <th scope="col" className="cell-right">
                  Units sold
                </th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => {
                const title = titles.get(p.productId)
                return (
                  <tr key={p.productId}>
                    <td className="mono">{p.rank}</td>
                    <td>
                      {title ? (
                        <>
                          <div style={{ fontWeight: 600 }}>{title}</div>
                          <div className="mono cell-muted" style={{ fontSize: 12 }}>
                            {p.productId}
                          </div>
                        </>
                      ) : (
                        <span className="mono">{p.productId}</span>
                      )}
                    </td>
                    <td className="mono cell-right">{p.unitsSold}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
