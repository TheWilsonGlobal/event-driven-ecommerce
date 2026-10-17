import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TopProductsPanel from '../screens/analytics/TopProductsPanel'
import { setAuthBridge } from '../auth/bridge'
import type { ProductRecord } from '../types'

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ranking = (over: Record<string, unknown> = {}) => ({
  source: 'redis',
  window: '24h',
  windowApplied: '24h',
  limit: 10,
  generatedAt: '2026-10-17T00:00:00Z',
  products: [
    { rank: 1, productId: 'p-1', unitsSold: 42 },
    { rank: 2, productId: 'p-unknown', unitsSold: 7 },
  ],
  ...over,
})

const products = [{ id: 'p-1', title: 'Blue Widget' }] as unknown as ProductRecord[]

describe('TopProductsPanel', () => {
  beforeEach(() => {
    setAuthBridge({
      getToken: () => 'tok',
      refresh: async () => null,
      requestMfa: async () => false,
      onSessionExpired: () => {},
      notify: () => {},
    })
  })

  it('renders ranked rows, resolves titles, and shows the source badge', async () => {
    const fetchMock = vi.fn(async () => res(200, ranking()))
    vi.stubGlobal('fetch', fetchMock)
    render(<TopProductsPanel products={products} />)
    expect(await screen.findByText('Blue Widget')).toBeInTheDocument()
    expect(screen.getByText('p-unknown')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText(/source: redis/)).toBeInTheDocument()
    expect(screen.queryByText(/windowed ranking unavailable/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3)
    const first = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(first[0]).toContain('/api/v1/analytics/rankings/top-products?limit=10&window=24h')
  })

  it('refetches when the window changes and notes all-time fallback', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('window=7d')
        ? res(200, ranking({ window: '7d', windowApplied: 'all-time', source: 'postgres' }))
        : res(200, ranking())
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<TopProductsPanel products={products} />)
    await screen.findByText('Blue Widget')
    await userEvent.selectOptions(screen.getByLabelText(/Window/), '7d')
    expect(
      await screen.findByText(/windowed ranking unavailable, showing all-time/)
    ).toBeInTheDocument()
    expect(screen.getByText(/source: postgres/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(200, ranking({ products: [] })))
    )
    render(<TopProductsPanel products={[]} />)
    expect(await screen.findByText(/No sales recorded/)).toBeInTheDocument()
  })

  it('shows errorText with request id on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(403, { statusCode: 403, code: 'FORBIDDEN', message: 'nope', requestId: 'z1' })
      )
    )
    render(<TopProductsPanel products={[]} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Not allowed for your role\. \(ref z1\)/
    )
  })
})
