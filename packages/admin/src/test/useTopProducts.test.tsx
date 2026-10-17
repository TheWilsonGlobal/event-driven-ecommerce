import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTopProducts, type RankWindow, type TopProductsResult } from '../hooks/useTopProducts'
import { setAuthBridge } from '../auth/bridge'

function body(window: RankWindow): TopProductsResult {
  return {
    source: 'redis',
    window,
    windowApplied: window,
    limit: 10,
    generatedAt: '2026-01-01T00:00:00Z',
    products: [{ rank: 1, productId: `p-${window}`, unitsSold: 1 }],
  }
}

function json(b: unknown) {
  return new Response(JSON.stringify(b), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('useTopProducts out-of-order responses', () => {
  beforeEach(() => {
    setAuthBridge({
      getToken: () => 't',
      refresh: async () => null,
      requestMfa: async () => false,
      onSessionExpired: () => {},
      notify: () => {},
    })
  })

  it('ignores a slow 24h response that resolves after the newer 1h one', async () => {
    const pending: Record<string, (r: Response) => void> = {}
    const signals: Record<string, AbortSignal | undefined> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string, init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            const w = /window=(\w+)/.exec(String(url))![1]
            pending[w] = resolve
            signals[w] = init?.signal ?? undefined
          })
      )
    )

    const { result, rerender } = renderHook(({ w }) => useTopProducts(w, false), {
      initialProps: { w: '24h' as RankWindow },
    })
    await waitFor(() => expect(pending['24h']).toBeDefined())
    rerender({ w: '1h' })
    await waitFor(() => expect(pending['1h']).toBeDefined())
    expect(signals['24h']?.aborted).toBe(true)

    // Newer (1h) lands first, then the stale 24h response arrives (mock ignores abort).
    await act(async () => pending['1h'](json(body('1h'))))
    await waitFor(() => expect(result.current.data?.window).toBe('1h'))
    await act(async () => pending['24h'](json(body('24h'))))

    expect(result.current.data?.window).toBe('1h')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('does not apply a response after unmount', async () => {
    let resolve!: (r: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (resolve = r)))
    )
    const { result, unmount } = renderHook(() => useTopProducts('24h', false))
    await waitFor(() => expect(resolve).toBeDefined())
    unmount()
    await act(async () => resolve(json(body('24h'))))
    expect(result.current.data).toBeNull()
  })
})
