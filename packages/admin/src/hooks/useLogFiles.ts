import { useCallback, useEffect, useState } from 'react'
import type { LogFilesResponse, LogFileSummary } from '../screens/config/logTypes'
import {
  GATEWAY_URL,
  USER_SERVICE_URL,
  PRODUCT_SERVICE_URL,
  ORDER_SERVICE_URL,
} from '../data/serviceUrls'

// Each service serves GET /api/v1/logs off the real NDJSON files its own
// pino logger writes to <repo-root>/logs/ — the admin fetches all four
// directly and merges the listings, same pattern as useApiDocs/useSchema.

const REQUEST_TIMEOUT_MS = 5000

const SERVICES: { name: string; url: string }[] = [
  { name: 'gateway', url: GATEWAY_URL },
  { name: 'ms-user', url: USER_SERVICE_URL },
  { name: 'ms-product', url: PRODUCT_SERVICE_URL },
  { name: 'ms-order', url: ORDER_SERVICE_URL },
]

const URL_BY_SERVICE = new Map(SERVICES.map((s) => [s.name, s.url]))

export interface LogFilesUnreachable {
  service: string
  message: string
}

export interface LogFilesData {
  files: LogFileSummary[]
  total: number
}

export interface LogFilesResource {
  data: LogFilesData | null
  unreachable: LogFilesUnreachable[]
  loading: boolean
  refetch: () => void
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timeoutId)
  }
}

export function useLogFiles(): LogFilesResource {
  const [data, setData] = useState<LogFilesData | null>(null)
  const [unreachable, setUnreachable] = useState<LogFilesUnreachable[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled(
      SERVICES.map((s) => fetchJson<LogFilesResponse>(`${s.url}/api/v1/logs`))
    )

    const files: LogFileSummary[] = []
    const failures: LogFilesUnreachable[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const svc = SERVICES[i]
      if (result.status === 'fulfilled') {
        files.push(...result.value.files)
      } else {
        failures.push({
          service: svc.name,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    }

    files.sort((a, b) => b.mtime.localeCompare(a.mtime))

    setData(files.length > 0 || failures.length < SERVICES.length ? { files, total: files.length } : null)
    setUnreachable(failures)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refetch = useCallback(() => {
    void load()
  }, [load])

  return { data, unreachable, loading, refetch }
}

/** Fetches one real log file's content by service + filename, on demand. */
export async function fetchLogFileContent(
  service: string,
  filename: string
): Promise<{ filename: string; sizeBytes: number; content: string }> {
  const base = URL_BY_SERVICE.get(service)
  if (!base) throw new Error(`Unknown service: ${service}`)
  return fetchJson(`${base}/api/v1/logs/${encodeURIComponent(filename)}`)
}
