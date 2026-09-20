import { useMemo, useState } from 'react'
import type { LogFileSummary } from './logTypes'
import type { LogFilesUnreachable } from '../../hooks/useLogFiles'
import { fetchLogFileContent } from '../../hooks/useLogFiles'
import { EmptyState, Pagination, Spinner, StatChip } from '../../components/ui'
import { DownloadIcon, FileIcon } from '../../components/icons'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const DEFAULT_PAGE_SIZE = 25

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const LEVEL_CLASS: Record<LogFileSummary['level'], string> = {
  info: 'chip-green',
  warn: 'chip-amber',
  error: 'chip-red',
}

export default function SystemLogsPanel({
  files,
  unreachable,
  loading,
}: {
  files: LogFileSummary[]
  unreachable: LogFilesUnreachable[]
  loading: boolean
}) {
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const changePageSize = (next: number) => {
    setPageSize(next)
    setPage(1)
  }
  const [viewing, setViewing] = useState<LogFileSummary | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentError, setContentError] = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return files
    return files.filter(
      (f) => f.filename.toLowerCase().includes(q) || f.service.toLowerCase().includes(q)
    )
  }, [files, filter])

  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  const openFile = async (file: LogFileSummary) => {
    setViewing(file)
    setContent(null)
    setContentError(null)
    setContentLoading(true)
    try {
      const res = await fetchLogFileContent(file.service, file.filename)
      setContent(res.content)
    } catch (err) {
      setContentError(err instanceof Error ? err.message : String(err))
    } finally {
      setContentLoading(false)
    }
  }

  const downloadFile = async (file: LogFileSummary) => {
    const res = await fetchLogFileContent(file.service, file.filename)
    const blob = new Blob([res.content], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && files.length === 0) return <Spinner label="Listing real log files on disk…" />

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter by filename or service..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="toolbar-right">
          <StatChip value={files.length} label="Files" />
          <StatChip value={formatBytes(totalBytes)} label="Total" />
        </div>
      </div>

      {unreachable.length > 0 && (
        <div className="warn-banner">
          {unreachable.map((u) => u.service).join(', ')} {unreachable.length === 1 ? 'is' : 'are'}{' '}
          unreachable — its log files are omitted below.
        </div>
      )}

      {viewing && (
        <div className="config-card" style={{ marginBottom: 12 }}>
          <div className="config-card-head" style={{ cursor: 'default' }}>
            <span className="title">
              <span className="mono">{viewing.filename}</span>
              <span className="count-badge">{viewing.service}</span>
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => setViewing(null)}>
              Close ✕
            </button>
          </div>
          <div className="config-card-body">
            {contentLoading && <Spinner label="Reading file…" />}
            {contentError && <div className="warn-banner">Could not read file: {contentError}</div>}
            {content !== null && (
              <pre
                className="mono"
                style={{
                  fontSize: 11,
                  maxHeight: 400,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  margin: 0,
                }}
              >
                {content}
              </pre>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          message={files.length === 0 ? 'No log files on disk yet.' : `No files match "${filter}"`}
        />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Service</th>
                <th>Level</th>
                <th>Size</th>
                <th>Last Modified</th>
                <th>Created</th>
                <th className="cell-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((f) => (
                <tr key={`${f.service}/${f.filename}`}>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileIcon style={{ width: 14, height: 14 }} />
                      <span className="mono">{f.filename}</span>
                    </span>
                  </td>
                  <td>
                    <span className="chip chip-blue">{f.service}</span>
                  </td>
                  <td>
                    <span className={`chip ${LEVEL_CLASS[f.level]}`}>{f.level.toUpperCase()}</span>
                  </td>
                  <td className="mono cell-muted">{formatBytes(f.sizeBytes)}</td>
                  <td className="cell-muted">{new Date(f.mtime).toLocaleString()}</td>
                  <td className="cell-muted">{new Date(f.birthtime).toLocaleString()}</td>
                  <td className="cell-right">
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openFile(f)}>
                        View
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => downloadFile(f)}>
                        <DownloadIcon style={{ width: 12, height: 12 }} /> Download
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPage={setPage}
            noun="files"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSize={changePageSize}
          />
        </div>
      )}
    </>
  )
}
