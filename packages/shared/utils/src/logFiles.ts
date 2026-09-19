/**
 * Real log file listing/reading, shared by every service's GET /api/v1/logs
 * and GET /api/v1/logs/:filename routes.
 *
 * Every service writes NDJSON (pino's default) to `<repo-root>/logs/<service>-<date>.log`
 * via `buildLoggerOptions` (see logger.ts). This module reads those same real
 * files back — no in-memory log buffer, no mock entries.
 */

import * as fsp from 'fs/promises'
import * as path from 'path'
import { getLogsDir } from './logger'

export interface LogFileSummary {
  filename: string
  service: string
  sizeBytes: number
  mtime: string
  birthtime: string
  /** Highest-severity pino level literally found in the file's JSON lines. */
  level: 'error' | 'warn' | 'info'
}

export type LogFileNotFoundReason = 'not_found' | 'invalid_filename'

export interface LogFileContent {
  filename: string
  sizeBytes: number
  content: string
}

/** Pino numeric levels: 50 = error, 40 = warn. Everything else folds into "info". */
function inferHighestLevel(content: string): 'error' | 'warn' | 'info' {
  if (/"level":50\b/.test(content)) return 'error'
  if (/"level":40\b/.test(content)) return 'warn'
  return 'info'
}

/**
 * Lists real log files for one service (filename prefix `${service}-`) in the
 * shared logs directory. Returns an empty array if the directory does not
 * exist yet (e.g. the service has not logged anything since `logs/` was
 * introduced) rather than throwing.
 *
 * Uses the async fs.promises API throughout: a service under active traffic
 * (e.g. ms-order, whose file grows continuously from request logging) can
 * have a multi-hundred-KB file here, and the sync equivalents used to block
 * Fastify's single event loop for the duration of the read — long enough,
 * under load, to blow past the admin panel's 5s client-side fetch timeout
 * and surface as a false "unreachable".
 */
export async function listLogFiles(service: string): Promise<LogFileSummary[]> {
  const dir = getLogsDir()
  try {
    await fsp.access(dir)
  } catch {
    return []
  }

  const prefix = `${service}-`
  const names = (await fsp.readdir(dir)).filter(
    (name) => name.startsWith(prefix) && name.endsWith('.log')
  )

  const summaries = await Promise.all(
    names.map(async (filename) => {
      const fullPath = path.join(dir, filename)
      const [stat, content] = await Promise.all([
        fsp.stat(fullPath),
        fsp.readFile(fullPath, 'utf8'),
      ])
      return {
        filename,
        service,
        sizeBytes: stat.size,
        mtime: stat.mtime.toISOString(),
        birthtime: stat.birthtime.toISOString(),
        level: inferHighestLevel(content),
      }
    })
  )

  return summaries.sort((a, b) => b.mtime.localeCompare(a.mtime))
}

/**
 * Reads one real log file's content by filename, scoped to a single service.
 *
 * The filename is validated against the REAL directory listing for that
 * service (not just a regex) before any file read happens, so a request can
 * never escape `logs/` or read another service's file: `..`, `/` and `\` are
 * rejected outright, and anything not already present in `listLogFiles`
 * (which itself only returns `${service}-*.log` entries) is a 404.
 */
export async function readLogFile(
  service: string,
  filename: string
): Promise<{ ok: true; data: LogFileContent } | { ok: false; reason: LogFileNotFoundReason }> {
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    path.basename(filename) !== filename
  ) {
    return { ok: false, reason: 'invalid_filename' }
  }

  const known = (await listLogFiles(service)).find((f) => f.filename === filename)
  if (!known) {
    return { ok: false, reason: 'not_found' }
  }

  const fullPath = path.join(getLogsDir(), filename)
  const content = await fsp.readFile(fullPath, 'utf8')
  return {
    ok: true,
    data: { filename, sizeBytes: known.sizeBytes, content },
  }
}
