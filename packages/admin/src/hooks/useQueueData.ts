import { useState, useEffect, useCallback } from 'react'
import type { QueueData, QueueInfo } from '../screens/queues/queueTypes'
import type { CacheData, CacheKeysData, CacheDriverInfo } from '../screens/config/cacheTypes'
import {
  ORDER_SERVICE_AUTHORITY,
  ORDER_SERVICE_URL,
  PRODUCT_SERVICE_AUTHORITY,
  PRODUCT_SERVICE_URL,
} from '../data/serviceUrls'

// Live queue + KV-cache introspection, served by ms-order and ms-product
// directly (the API gateway does not proxy these routes).
//
// Deliberate non-goal: there is no fallback data of any kind. When a fetch
// fails — network error, non-2xx, or a backend's explicit 503 for an
// unreachable Redis — that source's data stays null and its error is
// populated. Rendering a plausible-looking number that nobody measured is the
// exact defect these panels used to have, so an unreachable Redis must look
// unreachable.

const REQUEST_TIMEOUT_MS = 5000

/** Machine-readable cause from the backend's 503 body. */
export type UnavailableReason =
  | 'redis_connection_refused'
  | 'redis_timeout'
  | 'redis_dns_failure'
  | 'redis_auth_failure'
  | 'redis_unavailable'
  | 'redis_error'
  | 'queues_closed'
  // Emitted when KV_CACHE_DRIVER selects the embedded store: ms-order then
  // constructs no Redis connection and no BullMQ queues, so the QUEUE
  // endpoints 503 with this reason while the CACHE endpoints keep working
  // against the embedded store.
  | 'kv_driver_not_redis'

export interface FetchError {
  /** 'unavailable' = backend answered 503; 'network' = never reached it. */
  kind: 'unavailable' | 'network' | 'bad_response'
  /** `reason` from the 503 body when present. */
  reason?: UnavailableReason | string
  /** Operator-facing detail: the backend's `message`, or the thrown error. */
  message: string
  status?: number
}

export interface LiveResource<T> {
  data: T | null
  loading: boolean
  error: FetchError | null
  /** Set once a fetch has settled, so panels can tell "not yet" from "empty". */
  lastUpdated: string | null
  refetch: () => void
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { signal: controller.signal })
  } catch (err) {
    // Service down, DNS/connection refused, CORS, or our own timeout abort.
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    const failure: FetchError = {
      kind: 'network',
      message: aborted
        ? `No response from ${url} within ${REQUEST_TIMEOUT_MS}ms.`
        : `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`,
    }
    throw failure
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    // The 503 body carries `reason`/`message`; other errors may carry nothing.
    let body: { reason?: string; message?: string } | null = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    const failure: FetchError = {
      kind: res.status === 503 ? 'unavailable' : 'bad_response',
      reason: body?.reason,
      message: body?.message ?? `${url} responded ${res.status} ${res.statusText}`,
      status: res.status,
    }
    throw failure
  }

  return (await res.json()) as T
}

function isFetchError(value: unknown): value is FetchError {
  return typeof value === 'object' && value !== null && 'kind' in value && 'message' in value
}

function useLiveResource<T>(url: string): LiveResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FetchError | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchJson<T>(url)
      setData(next)
      setError(null)
    } catch (err) {
      // Drop any previously-loaded data: a stale snapshot shown without
      // qualification is just a slower kind of fabricated number.
      setData(null)
      setError(
        isFetchError(err)
          ? err
          : { kind: 'network', message: err instanceof Error ? err.message : String(err) }
      )
    } finally {
      setLastUpdated(new Date().toISOString())
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    let cancelled = false
    // `load` owns its own state writes; the flag just avoids a stray set after
    // unmount when the URL changes mid-flight.
    void (async () => {
      if (cancelled) return
      await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const refetch = useCallback(() => {
    void load()
  }, [load])

  return { data, loading, error, lastUpdated, refetch }
}

/** GET /api/v1/queues — live BullMQ counts, config and recent jobs, ms-order only. */
export function useQueueData(): LiveResource<QueueData> {
  return useLiveResource<QueueData>(`${ORDER_SERVICE_URL}/api/v1/queues`)
}

/** One source's slice of the merged result — which service, and its raw fetch outcome. */
export interface QueueSource {
  service: string
  data: QueueData | null
  error: FetchError | null
}

export interface MergedQueueResource {
  /** Merged queues[] + resummed summary from every source that answered. Null only if ALL failed. */
  data: QueueData | null
  loading: boolean
  /** Per-source outcome, so a partial failure can be reported without hiding the other source's data. */
  sources: QueueSource[]
  lastUpdated: string | null
  refetch: () => void
}

const EMPTY_SUMMARY = { queueCount: 0, totalJobs: 0, failedCount: 0, activeCount: 0 }

function mergeQueueData(payloads: (QueueData | null)[]): QueueData | null {
  const present = payloads.filter((p): p is QueueData => p !== null)
  if (present.length === 0) {
    return null
  }
  const queues: QueueInfo[] = present.flatMap((p) => p.queues)
  const summary = present.reduce(
    (acc, p) => ({
      queueCount: acc.queueCount + p.summary.queueCount,
      totalJobs: acc.totalJobs + p.summary.totalJobs,
      failedCount: acc.failedCount + p.summary.failedCount,
      activeCount: acc.activeCount + p.summary.activeCount,
    }),
    { ...EMPTY_SUMMARY }
  )
  return { queues, summary }
}

/**
 * Every service that registers BullMQ queues, fetched in parallel and merged
 * into one QueueData for the Task Queues tab.
 *
 * Partial-failure policy: if one service's fetch fails, the other's queues
 * still render — `data` carries whatever succeeded, and the failed source is
 * reported separately via `sources` so the tab can show an inline banner
 * naming which service is unreachable and why, rather than either hiding
 * good data or fabricating a full-page outage that isn't real. `data` is
 * null only when every source failed.
 */
const QUEUE_SOURCES = [
  {
    service: 'ms-order',
    url: `${ORDER_SERVICE_URL}/api/v1/queues`,
    authority: ORDER_SERVICE_AUTHORITY,
  },
  {
    service: 'ms-product',
    url: `${PRODUCT_SERVICE_URL}/api/v1/queues`,
    authority: PRODUCT_SERVICE_AUTHORITY,
  },
] as const

/** describeError() for one entry of a MergedQueueResource's `sources`. */
export function describeSourceError(source: QueueSource): string {
  const meta = QUEUE_SOURCES.find((s) => s.service === source.service)
  if (!source.error) {
    return ''
  }
  return describeError(source.error, source.service, meta?.authority ?? source.service)
}

export function useMergedQueueData(): MergedQueueResource {
  const [sources, setSources] = useState<QueueSource[]>(
    QUEUE_SOURCES.map(({ service }) => ({ service, data: null, error: null }))
  )
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.all(
      QUEUE_SOURCES.map(async ({ service, url }): Promise<QueueSource> => {
        try {
          const data = await fetchJson<QueueData>(url)
          return { service, data, error: null }
        } catch (err) {
          return {
            service,
            data: null,
            error: isFetchError(err)
              ? err
              : { kind: 'network', message: err instanceof Error ? err.message : String(err) },
          }
        }
      })
    )
    setSources(results)
    setLastUpdated(new Date().toISOString())
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const refetch = useCallback(() => {
    void load()
  }, [load])

  const data = mergeQueueData(sources.map((s) => s.data))

  return { data, loading, sources, lastUpdated, refetch }
}

/** GET /api/v1/cache/namespaces — live Redis key-namespace scan. */
export function useCacheNamespaces(): LiveResource<CacheData> {
  return useLiveResource<CacheData>(`${ORDER_SERVICE_URL}/api/v1/cache/namespaces`)
}

/** GET /api/v1/cache/keys — live listing of individual Redis keys. */
export function useCacheKeys(): LiveResource<CacheKeysData> {
  return useLiveResource<CacheKeysData>(`${ORDER_SERVICE_URL}/api/v1/cache/keys`)
}

/** GET /api/v1/cache/driver — which KV backend ms-order actually resolved. */
export function useCacheDriver(): LiveResource<CacheDriverInfo> {
  return useLiveResource<CacheDriverInfo>(`${ORDER_SERVICE_URL}/api/v1/cache/driver`)
}

/**
 * Short operator-facing label for the failure, used in banners.
 *
 * `service`/`authority` default to ms-order's own, since every existing call
 * site (single-source hooks above) is ms-order-specific. The merged queue
 * view passes the actual failing service so a ms-product outage is never
 * mislabeled as ms-order's.
 */
export function describeError(
  error: FetchError,
  service: string = 'ms-order',
  authority: string = ORDER_SERVICE_AUTHORITY
): string {
  switch (error.reason) {
    case 'redis_connection_refused':
      return 'Redis refused the connection'
    case 'redis_timeout':
      return 'Redis timed out'
    case 'redis_dns_failure':
      return 'Redis host could not be resolved'
    case 'redis_auth_failure':
      return 'Redis rejected our credentials'
    case 'redis_unavailable':
      return 'Redis is unavailable'
    case 'redis_error':
      return 'Redis returned an error'
    case 'queues_closed':
      return `Queues are closed on ${service}`
    case 'kv_driver_not_redis':
      return `${service} is not configured with a Redis KV driver`
    default:
      return error.kind === 'network'
        ? `${service} (${authority}) is unreachable`
        : `Request failed${error.status ? ` (HTTP ${error.status})` : ''}`
  }
}
