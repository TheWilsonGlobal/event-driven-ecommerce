import { useMemo, useState } from 'react'
import type { LogFile } from './configTypes'
import { EmptyState } from '../../components/ui'
import { FileIcon } from '../../components/icons'

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

export default function SystemLogsPanel({ files }: { files: LogFile[] }) {
  const [filter, setFilter] = useState('')

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return files
    return files.filter((f) => f.filename.toLowerCase().includes(q) || f.service.toLowerCase().includes(q))
  }, [files, filter])

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Filter by filename or service..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="toolbar-right">
          <span className="chip chip-slate">Files {files.length}</span>
          <span className="chip chip-slate">
            Total {fmtSize(files.reduce((sum, f) => sum + f.size, 0))}
          </span>
        </div>
      </div>

      <div className="table-wrapper">
        {rows.length === 0 ? (
          <EmptyState message={filter ? `No log files match "${filter}"` : 'No log files found.'} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Service</th>
                <th>Level</th>
                <th>Size</th>
                <th>Last Modified</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.filename}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={f.filename}>
                      <FileIcon style={{ width: 14, height: 14 }} />
                      <span className="mono">{f.filename}</span>
                    </span>
                  </td>
                  <td>
                    <span className="chip chip-blue">{f.service}</span>
                  </td>
                  <td>
                    <span
                      className={`status status-${f.level === 'error' ? 'offline' : f.level === 'warn' ? 'warning' : 'healthy'}`}
                    >
                      {f.level}
                    </span>
                  </td>
                  <td className="mono cell-muted">{fmtSize(f.size)}</td>
                  <td className="cell-muted">{fmtTime(f.modified)}</td>
                  <td className="cell-muted">{fmtTime(f.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
