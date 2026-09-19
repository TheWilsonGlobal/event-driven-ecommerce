import { useMemo, useState } from 'react'
import type { JobState, QueueData, QueueInfo, RecentJob } from './queueTypes'
import { EmptyState, OfflineBanner, Pagination, Spinner } from '../../components/ui'
import { describeError, type FetchError } from '../../hooks/useQueueData'
import { RetryIcon, CalendarIcon, ClockIcon } from '../../components/icons'

const NO_QUEUES: QueueInfo[] = []

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const DEFAULT_PAGE_SIZE = 25

const STATE_CHIPS: { state: JobState; label: string; tone: string }[] = [
  { state: 'waiting', label: 'Waiting', tone: 'chip-amber' },
  { state: 'active', label: 'Active', tone: 'chip-blue' },
  { state: 'completed', label: 'Completed', tone: 'chip-green' },
  { state: 'failed', label: 'Failed', tone: 'chip-red' },
  { state: 'delayed', label: 'Delayed', tone: 'chip-purple' },
]

function stateStatus(state: JobState): string {
  switch (state) {
    case 'completed':
      return 'status-healthy'
    case 'active':
      return 'status-pending'
    case 'delayed':
      return 'status-delayed'
    case 'failed':
      return 'status-failed'
    case 'waiting':
    default:
      return 'status-warning'
  }
}

function fmtTime(iso: string): string {
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '—'
}

// [unit suffix, seconds per unit] — a hand-rolled table instead of
// Intl.RelativeTimeFormat's "long"/"short"/"narrow" styles because none of
// those give "2m ago" (narrow drops the "ago" entirely: "2m"); this table is
// the concise middle ground the table's row height calls for.
const AGO_UNITS: [string, number][] = [
  ['y', 31536000],
  ['mo', 2592000],
  ['d', 86400],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
]

/** "3m ago" / "in 12m" (a delayed job's createdAt is in the past, but its own "next
 * run" isn't tracked here — this only ever formats real past/near-now timestamps).
 * Guards against a missing/unparseable timestamp (e.g. a stale cached payload shape
 * from before a backend restart) — a bare NaN would otherwise render as "NaNs ago"
 * for that one cell. */
function fmtAgo(iso: string | undefined | null): string {
  const diffSeconds = (new Date(iso ?? '').getTime() - Date.now()) / 1000
  if (!Number.isFinite(diffSeconds)) return '—'
  const future = diffSeconds > 0
  const abs = Math.abs(diffSeconds)
  for (const [suffix, secondsInUnit] of AGO_UNITS) {
    if (abs >= secondsInUnit || suffix === 's') {
      const n = Math.floor(abs / secondsInUnit)
      return future ? `in ${n}${suffix}` : `${n}${suffix} ago`
    }
  }
  return '0s ago'
}

interface FlatJob extends RecentJob {
  service: string
  queue: string
}

/**
 * Splits a job id into its action prefix and the rest ("refund-2b245af3-
 * ...-1789832262923" → prefix "refund", body "2b245af3-...-1789832262923").
 * Ids aren't a rigid prefix-uuid shape (some also carry a trailing epoch-ms
 * dedupe suffix), so this only ever splits on the FIRST hyphen rather than
 * trying to parse a UUID out of the middle — good enough to get the
 * human-readable action word its own column, whatever comes after it.
 */
function splitJobId(id: string): { prefix: string; body: string } {
  const i = id.indexOf('-')
  return i === -1 ? { prefix: id, body: '' } : { prefix: id.slice(0, i), body: id.slice(i + 1) }
}

/** "2b245af3-1e84-4f22-831a-986c260e9c1c-1789832262923" -> "2b24…2923" — enough
 * of each end to spot a job at a glance without the full id crowding the row;
 * the full body is always in the title tooltip and copied verbatim on click. */
function truncateMiddle(s: string, headLen = 4, tailLen = 4): string {
  return s.length <= headLen + tailLen + 1 ? s : `${s.slice(0, headLen)}…${s.slice(-tailLen)}`
}

/** Click-to-copy job-id body. Falls back silently if the Clipboard API is
 * unavailable (e.g. non-HTTPS/non-localhost origin) — copying is a nicety,
 * never something the row's other content should be gated on. */
function CopyableId({ body }: { body: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard API unavailable or denied — no-op, nothing else to fall back to.
    }
  }

  return (
    <button
      type="button"
      className="job-id-body"
      onClick={copy}
      title={copied ? 'Copied!' : `${body} (click to copy)`}
    >
      {copied ? 'Copied!' : truncateMiddle(body)}
    </button>
  )
}

export default function QueuesPanel({
  data,
  loading = false,
  error = null,
  onRetry,
}: {
  data: QueueData | null
  loading?: boolean
  error?: FetchError | null
  onRetry?: () => void
}) {
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobState | null>(null)
  const [queueFilter, setQueueFilter] = useState<string | null>(null)
  const [taskNameFilter, setTaskNameFilter] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const allQueues = data?.queues ?? NO_QUEUES

  const queues = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return allQueues
    return allQueues.filter(
      (queue) =>
        queue.name.toLowerCase().includes(q) ||
        queue.service.toLowerCase().includes(q) ||
        queue.description.toLowerCase().includes(q)
    )
  }, [allQueues, filter])

  // Distinct queue names / task names across ALL queues (not the
  // text-filtered subset) so both dropdowns always offer every value, the
  // same way STATE_CHIPS isn't narrowed by the text filter either — only the
  // rendered job rows should shrink, not the set of things you can filter by.
  const queueNames = useMemo(
    () => [...new Set(allQueues.map((q) => q.name))].sort((a, b) => a.localeCompare(b)),
    [allQueues]
  )
  const taskNames = useMemo(
    () =>
      [...new Set(allQueues.flatMap((q) => q.recentJobs.map((j) => j.name)))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [allQueues]
  )

  const jobs: FlatJob[] = useMemo(
    () =>
      queues
        .flatMap((queue: QueueInfo) =>
          queue.recentJobs.map((job) => ({ ...job, service: queue.service, queue: queue.name }))
        )
        .filter((job) => !statusFilter || job.status === statusFilter)
        .filter((job) => !queueFilter || job.queue === queueFilter)
        .filter((job) => !taskNameFilter || job.name === taskNameFilter)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [queues, statusFilter, queueFilter, taskNameFilter]
  )

  const pagedJobs = jobs.slice((page - 1) * pageSize, page * pageSize)

  // A narrower filter/status/queue/task-name/page-size can leave `page`
  // pointing past the new result set — reset to page 1 whenever any of them
  // change, same as KvKeysPanel does for its own filters.
  const changeFilter = (next: string) => {
    setFilter(next)
    setPage(1)
  }
  const changeStatusFilter = (next: JobState | null) => {
    setStatusFilter(next)
    setPage(1)
  }
  const changeQueueFilter = (next: string | null) => {
    setQueueFilter(next)
    setPage(1)
  }
  const changeTaskNameFilter = (next: string | null) => {
    setTaskNameFilter(next)
    setPage(1)
  }
  const changePageSize = (next: number) => {
    setPageSize(next)
    setPage(1)
  }

  // Null when there is no live payload. A reducer seeded with zeroes would
  // render `Waiting 0 · Active 0 · …` beside the offline banner, which is
  // pixel-identical to a healthy, genuinely-empty Redis — the exact
  // fabricated-number defect these panels exist to avoid. No data, no number.
  const stateCounts = useMemo(
    () =>
      data
        ? allQueues.reduce(
            (acc, q) => ({
              waiting: acc.waiting + q.counts.waiting,
              active: acc.active + q.counts.active,
              completed: acc.completed + q.counts.completed,
              failed: acc.failed + q.counts.failed,
              delayed: acc.delayed + q.counts.delayed,
            }),
            { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
          )
        : null,
    [data, allQueues]
  )
  const totalCount = stateCounts
    ? stateCounts.waiting +
      stateCounts.active +
      stateCounts.completed +
      stateCounts.failed +
      stateCounts.delayed
    : null

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter queues by name, service or description..."
            value={filter}
            onChange={(e) => changeFilter(e.target.value)}
          />
          <select
            value={queueFilter ?? ''}
            onChange={(e) => changeQueueFilter(e.target.value || null)}
            disabled={queueNames.length === 0}
            title="Filter by queue"
          >
            <option value="">All queues ({queueNames.length})</option>
            {queueNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={taskNameFilter ?? ''}
            onChange={(e) => changeTaskNameFilter(e.target.value || null)}
            disabled={taskNames.length === 0}
            title="Filter by task name"
          >
            <option value="">All task names ({taskNames.length})</option>
            {taskNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {STATE_CHIPS.map(({ state, label, tone }) => (
            <button
              key={state}
              type="button"
              className={`chip ${tone} chip-btn${statusFilter === state ? ' chip-btn-active' : ''}`}
              onClick={() => changeStatusFilter(statusFilter === state ? null : state)}
              disabled={!stateCounts}
              aria-pressed={statusFilter === state}
            >
              {label} {stateCounts ? stateCounts[state] : '—'}
            </button>
          ))}
          <button
            type="button"
            className={`chip chip-slate chip-btn${statusFilter === null ? ' chip-btn-active' : ''}`}
            onClick={() => changeStatusFilter(null)}
            disabled={totalCount === null}
            aria-pressed={statusFilter === null}
          >
            Total {totalCount ?? '—'}
          </button>
        </div>
      </div>

      {error ? (
        <OfflineBanner
          title={`Queue data unavailable — ${describeError(error)}`}
          detail={error.message}
          reason={error.reason ?? (error.status ? `HTTP ${error.status}` : 'network_error')}
          onRetry={onRetry}
          retrying={loading}
        />
      ) : loading && !data ? (
        <Spinner label="Loading live queue data…" />
      ) : !data ? (
        <EmptyState message="No queue data loaded yet." />
      ) : allQueues.length === 0 ? (
        <EmptyState message="ms-order reports no registered queues." />
      ) : queues.length === 0 ? (
        <EmptyState message={`No queues match "${filter}"`} />
      ) : jobs.length === 0 ? (
        <EmptyState
          message={
            statusFilter || queueFilter || taskNameFilter
              ? [
                  statusFilter && `status "${statusFilter}"`,
                  queueFilter && `queue "${queueFilter}"`,
                  taskNameFilter && `task "${taskNameFilter}"`,
                ]
                  .filter(Boolean)
                  .join(' and ')
                  .replace(/^/, 'No jobs match ')
              : 'Queues are registered but hold no recent jobs.'
          }
        />
      ) : (
        <div className="table-wrapper">
          <table className="queues-table">
            <colgroup>
              <col style={{ width: 90 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 56 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Service</th>
                <th>Queue</th>
                <th>Task Name</th>
                <th title="Action prefix (e.g. refund, retry, release)">Job</th>
                <th title="Click to copy the full job id">Job ID</th>
                <th>Status</th>
                <th className="cell-right" title="Attempts">
                  <RetryIcon style={{ width: 14, height: 14 }} />
                </th>
                <th className="cell-right" title="Created — when queue.add() created the job">
                  <CalendarIcon style={{ width: 14, height: 14 }} />
                </th>
                <th
                  className="cell-right"
                  title="Updated — finished, or last attempt started, or falls back to Created"
                >
                  <ClockIcon style={{ width: 14, height: 14 }} />
                </th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {pagedJobs.map((job) => {
                const { prefix, body } = splitJobId(job.id)
                return (
                  <tr key={`${job.queue}-${job.id}`}>
                    <td>
                      <span className="chip chip-blue">{job.service}</span>
                    </td>
                    <td className="mono cell-muted">{job.queue}</td>
                    <td className="mono cell-muted">{job.name}</td>
                    <td className="mono cell-muted">{prefix}</td>
                    <td className="mono">
                      <CopyableId body={body} />
                    </td>
                    <td>
                      <span className={`status ${stateStatus(job.status)}`}>{job.status}</span>
                    </td>
                    <td className="mono cell-right cell-muted">
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td className="cell-right cell-muted" title={fmtTime(job.createdAt)}>
                      {fmtAgo(job.createdAt)}
                    </td>
                    <td className="cell-right cell-muted" title={fmtTime(job.updatedAt)}>
                      {fmtAgo(job.updatedAt)}
                    </td>
                    <td className="job-note-cell" title={job.failedReason ?? undefined}>
                      {job.status === 'failed' && job.failedReason && (
                        <span className="mono job-error-message">{job.failedReason}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={jobs.length}
            onPage={setPage}
            noun="jobs"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSize={changePageSize}
          />
        </div>
      )}
    </>
  )
}
