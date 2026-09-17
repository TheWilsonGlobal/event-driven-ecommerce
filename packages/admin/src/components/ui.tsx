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

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  noun = 'items',
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  noun?: string
}) {
  if (!total) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="pagination">
      <div className="pagination-left">
        Showing {start} to {end} of {total} {noun}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="page-btn" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          « Prev
        </button>
        <span style={{ padding: '4px 8px', fontWeight: 600, color: 'var(--text-bright)' }}>
          {page} / {totalPages}
        </span>
        <button className="page-btn" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          Next »
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
