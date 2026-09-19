import { useState, useEffect, useCallback } from 'react'
import type { ServiceItem, RustfsHealth } from '../types'
import { SERVICE_REGISTRY } from '../data/serviceRegistry'
import { PRODUCT_SERVICE_URL, RUSTFS_BUCKET, RUSTFS_ENDPOINT } from '../data/serviceUrls'

export function useServiceProbes(autoPolling: boolean) {
  const [services, setServices] = useState<ServiceItem[]>(SERVICE_REGISTRY)
  const [lastScanned, setLastScanned] = useState<string>('')

  const [rustfsHealth, setRustfsHealth] = useState<RustfsHealth>({
    healthy: null,
    latencyMs: 0,
    endpoint: RUSTFS_ENDPOINT,
    bucket: RUSTFS_BUCKET,
    lastChecked: '',
  })

  const pingRustFS = useCallback(async () => {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2000)
      const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/storage/health`, {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (res.ok) {
        const data = await res.json()
        setRustfsHealth({
          healthy: data.healthy ?? true,
          latencyMs: data.latencyMs ?? Date.now() - start,
          endpoint: data.endpoint ?? RUSTFS_ENDPOINT,
          bucket: data.bucket ?? RUSTFS_BUCKET,
          lastChecked: new Date().toISOString(),
        })
      } else {
        setRustfsHealth((prev) => ({
          ...prev,
          healthy: false,
          latencyMs: Date.now() - start,
          lastChecked: new Date().toISOString(),
        }))
      }
    } catch {
      setRustfsHealth((prev) => ({
        ...prev,
        healthy: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
      }))
    }
  }, [])

  const pingServices = useCallback(async () => {
    try {
      const updated = await Promise.all(
        services.map(async (svc) => {
          const startTime = Date.now()
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 1200)
          try {
            const res = await fetch(svc.healthUrl, { signal: controller.signal })
            clearTimeout(timeoutId)
            const latencyMs = Date.now() - startTime
            let details: Record<string, unknown> | undefined
            try {
              details = await res.clone().json()
            } catch {
              // non-JSON body (e.g. the frontend dev servers) — leave details unset
            }
            return {
              ...svc,
              status: res.ok ? ('HEALTHY' as const) : ('DEGRADED' as const),
              statusCode: res.status,
              latencyMs,
              details,
              error: res.ok ? undefined : `HTTP ${res.status}`,
              lastChecked: new Date().toISOString(),
            }
          } catch (err) {
            clearTimeout(timeoutId)
            return {
              ...svc,
              status: 'OFFLINE' as const,
              statusCode: 0,
              latencyMs: Date.now() - startTime,
              details: undefined,
              error: err instanceof Error ? err.message : 'Unreachable',
              lastChecked: new Date().toISOString(),
            }
          }
        })
      )
      setServices(updated)
      setLastScanned(new Date().toLocaleTimeString())
    } catch {
      setLastScanned(new Date().toLocaleTimeString())
    }
  }, [services])

  useEffect(() => {
    setLastScanned(new Date().toLocaleTimeString())
    pingRustFS()
    if (!autoPolling) return
    const sInt = setInterval(pingServices, 5000)
    const rInt = setInterval(pingRustFS, 10000)
    return () => {
      clearInterval(sInt)
      clearInterval(rInt)
    }
  }, [pingServices, pingRustFS, autoPolling])

  return {
    services,
    setServices,
    lastScanned,
    rustfsHealth,
    pingRustFS,
    pingServices,
  }
}
