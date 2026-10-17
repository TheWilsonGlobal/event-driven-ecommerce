import { useCallback, useEffect, useRef, useState } from 'react'
import { ANALYTICS_SERVICE_URL } from '../data/serviceUrls'
import { apiFetchJson, errorText } from '../data/apiFetch'

export type RankWindow = '1h' | '24h' | '7d'

export interface TopProductsResult {
  source: 'redis' | 'postgres'
  window: RankWindow
  windowApplied: RankWindow | 'all-time'
  limit: number
  generatedAt: string
  products: { rank: number; productId: string; unitsSold: number }[]
}

export const TOP_PRODUCTS_LIMIT = 10
const POLL_MS = 30_000

/**
 * Leaderboard from ms-analytics. No fallback data: an error clears the previous result.
 * Only the most recent request may apply its result: a new request aborts the previous
 * one and a sequence check discards anything that still resolves late.
 */
export function useTopProducts(window: RankWindow, autoRefresh = true) {
  const [data, setData] = useState<TopProductsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const controller = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    controller.current?.abort()
    const ctl = new AbortController()
    controller.current = ctl
    const mine = ++seq.current
    const isCurrent = () => mine === seq.current && !ctl.signal.aborted
    setLoading(true)
    try {
      const result = await apiFetchJson<TopProductsResult>(
        `${ANALYTICS_SERVICE_URL}/api/v1/analytics/rankings/top-products?limit=${TOP_PRODUCTS_LIMIT}&window=${window}`,
        { signal: ctl.signal }
      )
      if (!isCurrent()) return
      setData(result)
      setError(null)
    } catch (err) {
      if (!isCurrent()) return
      setData(null)
      setError(errorText(err, 'Could not reach ms-analytics.'))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [window])

  useEffect(() => {
    void load()
    const t = autoRefresh ? setInterval(() => void load(), POLL_MS) : undefined
    return () => {
      if (t) clearInterval(t)
      // Invalidate in-flight work on window change / unmount.
      seq.current++
      controller.current?.abort()
    }
  }, [load, autoRefresh])

  return { data, loading, error, refetch: load }
}
