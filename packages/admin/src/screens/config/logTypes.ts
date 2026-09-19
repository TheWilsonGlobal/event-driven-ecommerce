// Shape of GET /api/v1/logs and GET /api/v1/logs/:filename, served by every
// service directly from the real NDJSON files its own pino logger writes to
// <repo-root>/logs/ (see shared-utils/logFiles.ts). No in-memory buffer, no
// mock entries — restarting a service does not lose history.

export interface LogFileSummary {
  filename: string
  service: string
  sizeBytes: number
  mtime: string
  birthtime: string
  level: 'error' | 'warn' | 'info'
}

export interface LogFilesResponse {
  files: LogFileSummary[]
  total: number
}

export interface LogFileContent {
  filename: string
  sizeBytes: number
  content: string
}
