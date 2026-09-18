import { useState, useEffect, useCallback } from 'react'
import type { QueueData } from '../screens/queues/queueTypes'
import type { CacheData, CacheKeysData, CacheDriverInfo } from '../screens/config/cacheTypes'
import { ORDER_SERVICE_AUTHORITY, ORDER_SERVICE_URL } from '../data/serviceUrls'

// Live queue + KV-cache introspection, served by ms-order directly (the API
// gateway does not proxy these routes).
//
// Deliberate non-goal: there is no fallback data of any kind. When the fetch
// fails — network error, non-2xx, or the backend's explicit 503 for an
// unreachable Redis — `data` stays null and `error` is populated. Rendering a
// plausible-looking number that nobody measured is the exact defect these
// panels used to have, so an unreachable Redis must look unreachable.

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

/** GET /api/v1/queues — live BullMQ counts, config and recent jobs. */
export function useQueueData(): LiveResource<QueueData> {
  return useLiveResource<QueueData>(`${ORDER_SERVICE_URL}/api/v1/queues`)
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

/** Short operator-facing label for the failure, used in banners. */
export function describeError(error: FetchError): string {
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
      return 'Queues are closed on ms-order'
    case 'kv_driver_not_redis':
      return 'ms-order is not configured with a Redis KV driver'
    default:
      return error.kind === 'network'
        ? `ms-order (${ORDER_SERVICE_AUTHORITY}) is unreachable`
        : `Request failed${error.status ? ` (HTTP ${error.status})` : ''}`
  }
}
