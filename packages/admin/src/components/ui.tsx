import type { ReactNode } from 'react'

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  return <span className={`status status-${s}`}>{status}</span>
}

export function Chip({
  label,
  variant = 'blue',
}: {
  label: string
  variant?: 'blue' | 'green' | 'purple' | 'amber'
}) {
  return <span className={`chip chip-${variant}`}>{label}</span>
}

/**
 * A toolbar summary chip: value stacked above its label (e.g. "8" over
 * "Tables"), rather than run together as inline text. Used for the header
 * count strips atop the Config sub-tab panels (DB Schema, APIs, Services,
 * Task Queues, Logs).
 */
export function StatChip({
  value,
  label,
  variant = 'slate',
}: {
  value: ReactNode
  label: string
  variant?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'purple'
}) {
  return (
    <span className={`chip chip-stat chip-${variant}`}>
      <span className="chip-stat-value">{value}</span>
      <span className="chip-stat-label">{label}</span>
    </span>
  )
}

export function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: ReactNode
  tone?: 'blue' | 'green' | 'yellow' | 'red' | 'purple'
}) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className={`value${tone ? ` ${tone}` : ''}`}>{value}</div>
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '32px 20px',
        justifyContent: 'center',
      }}
    >
      <div className="spinner sm" />
      {label && <span className="boot-text">{label}</span>}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        gap: 8,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ cursor: 'pointer', width: 16, height: 16, accentColor: 'var(--blue)' }}
      />
    </label>
  )
}

/**
 * The page-number buttons to render around the current page: always page 1
 * and the last page, always `page` itself and one neighbour on each side,
 * with a `'…'` gap marker wherever that leaves a hole — the standard
 * "1 … 4 5 6 … 42" windowing so a big result set doesn't render one button
 * per page.
 */
function pageWindow(page: number, totalPages: number): (number | '…')[] {
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…')
    out.push(sorted[i])
  }
  return out
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  noun = 'items',
  pageSizeOptions,
  onPageSize,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  noun?: string
  /** Renders a page-size <select> when provided (e.g. [10, 25, 50, 100]). */
  pageSizeOptions?: number[]
  onPageSize?: (pageSize: number) => void
}) {
  if (!total) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="pagination">
      <div className="pagination-left">
        Showing {start} to {end} of {total} {noun}
        {pageSizeOptions && onPageSize && (
          <label style={{ marginLeft: 12 }}>
            {' '}
            per page:{' '}
            <select
              className="page-size-select"
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="page-btn" onClick={() => onPage(1)} disabled={page <= 1}>
          « First
        </button>
        <button className="page-btn" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          ‹ Prev
        </button>
        {pageWindow(page, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="page-gap">
              …
            </span>
          ) : (
            <button
              key={p}
              className={`page-btn${p === page ? ' active' : ''}`}
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}
        <button className="page-btn" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          Next ›
        </button>
        <button
          className="page-btn"
          onClick={() => onPage(totalPages)}
          disabled={page >= totalPages}
        >
          Last »
        </button>
      </div>
    </div>
  )
}

/**
 * Shown when a live panel could not load its data (Redis down, ms-order down,
 * unexpected status). Deliberately replaces the data rather than decorating a
 * fallback: no numbers are rendered alongside it.
 */
export function OfflineBanner({
  title,
  detail,
  reason,
  onRetry,
  retrying,
}: {
  title: string
  detail?: string
  reason?: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div className="warn-banner" role="alert">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong>{title}</strong>
        {reason && <span className="chip chip-mono chip-slate">{reason}</span>}
        {onRetry && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRetry}
            disabled={retrying}
            style={{ marginLeft: 'auto' }}
          >
            {retrying ? 'Retrying…' : 'Retry ↻'}
          </button>
        )}
      </div>
      {detail && (
        <div className="mono" style={{ marginTop: 6, opacity: 0.85, wordBreak: 'break-word' }}>
          {detail}
        </div>
      )}
    </div>
  )
}
