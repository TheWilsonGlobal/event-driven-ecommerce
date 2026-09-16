// Building blocks shared by the Configuration tabs.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRightIcon } from '../../components/icons'

/**
 * A broadcast from an Expand All / Collapse All button.
 *
 * `nonce` carries the signal rather than `open` alone: after a card is toggled
 * by hand, pressing the SAME button again must still re-apply — and a bare
 * boolean would not have changed, so the effect would not re-run.
 */
export interface OpenSignal {
  open: boolean
  nonce: number
}

export function ConfigCard({
  title,
  count,
  metrics,
  defaultOpen = true,
  openSignal,
  children,
}: {
  title: ReactNode
  count?: number
  metrics?: ReactNode
  defaultOpen?: boolean
  openSignal?: OpenSignal
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  // Applied in a layout effect rather than during render: React 18
  // StrictMode replays a render function to check purity, and that replay
  // sees this ref already mutated by the first pass while `open` state has
  // not yet committed — the re-check then finds nonce === appliedNonce.current
  // and skips setOpen, so the broadcast silently loses on every other click.
  // A layout effect only fires once the commit is real, and still runs
  // before the browser paints, so there is no visible flash of the old
  // state. Each nonce is consumed once: without the ref the broadcast would
  // re-apply on every later re-render and the card could not be toggled by
  // hand afterwards.
  const appliedNonce = useRef(0)
  useLayoutEffect(() => {
    if (openSignal && openSignal.nonce !== appliedNonce.current) {
      appliedNonce.current = openSignal.nonce
      setOpen(openSignal.open)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal])

  return (
    <div className="config-card">
      <div className="config-card-head" onClick={() => setOpen((o) => !o)}>
        <ChevronRightIcon className={`chevron${open ? ' open' : ''}`} />
        <span className="title">
          {title}
          {count !== undefined && <span className="count-badge">{count}</span>}
        </span>
        <span className="spacer" />
        {/* Metrics stay visible while collapsed — the figures are the reason
            to open the card, so hiding them defeats the summary. */}
        {metrics && <span className="config-metrics">{metrics}</span>}
      </div>
      {open && <div className="config-card-body">{children}</div>}
    </div>
  )
}

/** A read-only key/value row. Booleans are colour-coded. */
export function ReadOnlyRow({ label, value }: { label: string; value: unknown }) {
  const isBool = typeof value === 'boolean'
  const text =
    value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return (
    <div className="config-row">
      <span className="k">{label}</span>
      <span className={`v${isBool ? (value ? ' bool-true' : ' bool-false') : ''}`}>{text}</span>
    </div>
  )
}
