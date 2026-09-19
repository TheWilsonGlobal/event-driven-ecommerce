import { useCallback, useState } from 'react'
import {
  PROMETHEUS_URL,
  ELASTICSEARCH_HOST,
  ELASTICSEARCH_ENABLED,
  LOKI_HOST,
  LOKI_ENABLED,
  GRAFANA_URL,
} from '../data/serviceUrls'

export interface ObservabilityTarget {
  /** Whether this repo's own config even wants this backend used (the
   *  *_ENABLED flags in .env) — independent of whether it's reachable. */
  enabled: boolean
  healthy: boolean | null
  latencyMs: number
  endpoint: string
  lastChecked: string
  error?: string
}

const REQUEST_TIMEOUT_MS = 2000

async function probe(url: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)
    return { ok: res.ok, latencyMs: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` }
  } catch (err) {
    clearTimeout(timeoutId)
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unreachable',
    }
  }
}

// None of Prometheus, Elasticsearch or Loki run in this repo's own
// docker-compose — they're provisioned by the infra-hub repo (or not running
// at all in a given session). Rather than assume a status, each is probed
// against its own real health route, same as every other card in Infra.
export function useObservability() {
  const [prometheus, setPrometheus] = useState<ObservabilityTarget>({
    enabled: true,
    healthy: null,
    latencyMs: 0,
    endpoint: PROMETHEUS_URL,
    lastChecked: '',
  })
  const [elasticsearch, setElasticsearch] = useState<ObservabilityTarget>({
    enabled: ELASTICSEARCH_ENABLED,
    healthy: null,
    latencyMs: 0,
    endpoint: ELASTICSEARCH_HOST,
    lastChecked: '',
  })
  const [loki, setLoki] = useState<ObservabilityTarget>({
    enabled: LOKI_ENABLED,
    healthy: null,
    latencyMs: 0,
    endpoint: LOKI_HOST,
    lastChecked: '',
  })
  const [grafana, setGrafana] = useState<ObservabilityTarget>({
    enabled: true,
    healthy: null,
    latencyMs: 0,
    endpoint: GRAFANA_URL,
    lastChecked: '',
  })

  const probeAll = useCallback(async () => {
    const [prom, es, lk, gf] = await Promise.all([
      probe(`${PROMETHEUS_URL}/-/healthy`),
      probe(`${ELASTICSEARCH_HOST}/_cluster/health`),
      probe(`${LOKI_HOST}/ready`),
      probe(`${GRAFANA_URL}/api/health`),
    ])
    const now = new Date().toISOString()
    setPrometheus((prev) => ({
      ...prev,
      healthy: prom.ok,
      latencyMs: prom.latencyMs,
      error: prom.error,
      lastChecked: now,
    }))
    setElasticsearch((prev) => ({
      ...prev,
      healthy: es.ok,
      latencyMs: es.latencyMs,
      error: es.error,
      lastChecked: now,
    }))
    setLoki((prev) => ({
      ...prev,
      healthy: lk.ok,
      latencyMs: lk.latencyMs,
      error: lk.error,
      lastChecked: now,
    }))
    setGrafana((prev) => ({
      ...prev,
      healthy: gf.ok,
      latencyMs: gf.latencyMs,
      error: gf.error,
      lastChecked: now,
    }))
  }, [])

  return { prometheus, elasticsearch, loki, grafana, probeAll }
}
