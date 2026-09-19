import { useCallback, useEffect, useState } from 'react'
import type { ApiEndpointsResponse, ApiServiceGroup } from '../screens/config/apiTypes'
import {
  GATEWAY_URL,
  GATEWAY_PORT,
  USER_SERVICE_URL,
  USER_SERVICE_PORT,
  PRODUCT_SERVICE_URL,
  PRODUCT_SERVICE_PORT,
  ORDER_SERVICE_URL,
  ORDER_SERVICE_PORT,
} from '../data/serviceUrls'

// Each service serves GET /api/v1/endpoints, built from the routes it
// actually registered (an onRoute hook, not the OpenAPI doc — see
// shared-utils/routeRegistry.ts) — so the admin fetches all four directly
// rather than hand-maintaining a copy of the route table that can drift from
// the code.

const REQUEST_TIMEOUT_MS = 5000

const SERVICES: { name: string; port: number; url: string }[] = [
  { name: 'gateway', port: Number(GATEWAY_PORT), url: GATEWAY_URL },
  { name: 'ms-user', port: Number(USER_SERVICE_PORT), url: USER_SERVICE_URL },
  { name: 'ms-product', port: Number(PRODUCT_SERVICE_PORT), url: PRODUCT_SERVICE_URL },
  { name: 'ms-order', port: Number(ORDER_SERVICE_PORT), url: ORDER_SERVICE_URL },
]

export interface ApiDocsSummary {
  endpointCount: number
  documentedCount: number
  methodCounts: Record<string, number>
}

export interface ApiDocsData {
  groups: ApiServiceGroup[]
  summary: ApiDocsSummary
}

export interface ApiDocsUnreachable {
  service: string
  message: string
}

export interface ApiDocsResource {
  data: ApiDocsData | null
  /** Services that could not be reached — the rest of `data` still renders. */
  unreachable: ApiDocsUnreachable[]
  loading: boolean
  refetch: () => void
}

async function fetchEndpoints(url: string): Promise<ApiEndpointsResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${url}/api/v1/endpoints`, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as ApiEndpointsResponse
  } finally {
    clearTimeout(timeoutId)
  }
}

export function useApiDocs(): ApiDocsResource {
  const [data, setData] = useState<ApiDocsData | null>(null)
  const [unreachable, setUnreachable] = useState<ApiDocsUnreachable[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled(
      SERVICES.map((s) => fetchEndpoints(s.url).then((res) => ({ service: s, res })))
    )

    const groups: ApiServiceGroup[] = []
    const failures: ApiDocsUnreachable[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const svc = SERVICES[i]
      if (result.status === 'fulfilled') {
        const { service, res } = result.value
        groups.push({
          name: service.name,
          title: res.service,
          port: service.port,
          docsUrl: `${service.url}/api-docs`,
          endpoints: res.endpoints,
        })
      } else {
        failures.push({
          service: svc.name,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    }

    let endpointCount = 0
    let documentedCount = 0
    const methodCounts: Record<string, number> = {}
    for (const g of groups) {
      for (const e of g.endpoints) {
        endpointCount++
        if (e.documented) documentedCount++
        methodCounts[e.method] = (methodCounts[e.method] ?? 0) + 1
      }
    }

    setData(
      groups.length > 0
        ? { groups, summary: { endpointCount, documentedCount, methodCounts } }
        : null
    )
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
