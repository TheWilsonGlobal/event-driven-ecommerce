import { useCallback, useEffect, useState } from 'react'
import { GATEWAY_URL } from '../data/serviceUrls'

// The gateway serves GET /api/v1/services — its own server-side health
// rollup of ms-user/ms-product/ms-order, probed by the gateway process
// itself rather than the browser (see gateway/src/diagnostics/servicesRoutes.ts).
// This is a second, independent source of truth alongside useServiceProbes'
// client-side pings: the two can legitimately disagree (e.g. a service
// reachable from the browser's network path but not the gateway's, or vice
// versa), and that disagreement is itself useful, so this hook does not
// replace useServiceProbes — it feeds a separate "as seen by the gateway"
// view.

const REQUEST_TIMEOUT_MS = 5000

export interface GatewayServiceHealth {
  name: string
  url: string
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE'
  statusCode: number | null
  latencyMs: number
  error: string | null
}

export interface GatewayServicesResponse {
  services: GatewayServiceHealth[]
  summary: {
    serviceCount: number
    healthyCount: number
    checkedAt: string
  }
}

export interface GatewayServicesResource {
  data: GatewayServicesResponse | null
  unreachable: string | null
  loading: boolean
  refetch: () => void
}

async function fetchGatewayServices(): Promise<GatewayServicesResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${GATEWAY_URL}/api/v1/services`, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as GatewayServicesResponse
  } finally {
    clearTimeout(timeoutId)
  }
}

export function useGatewayServices(): GatewayServicesResource {
  const [data, setData] = useState<GatewayServicesResponse | null>(null)
  const [unreachable, setUnreachable] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchGatewayServices()
      setData(res)
      setUnreachable(null)
    } catch (err) {
      setUnreachable(err instanceof Error ? err.message : 'Unreachable')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refetch = useCallback(() => {
    void load()
  }, [load])

  return { data, unreachable, loading, refetch }
}
