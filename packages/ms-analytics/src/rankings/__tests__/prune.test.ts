import type { EventContext, EventEnvelope } from '@ecommerce/shared-messaging'
import type { AnalyticsStore } from '../../aggregates/store'
import { handleOrderCreated } from '../../events/handlers'
import { RankingEngine, type RankingSink } from '../engine'
import { registerShutdownHandlers } from '../../shutdown'
import { FakeRedis } from './fakeRedis'

function stubStore(): AnalyticsStore & { sql: string[] } {
  const sql: string[] = []
  const query = async (text: string) => {
    sql.push(text)
    return { rows: [], rowCount: 1 }
  }
  return {
    schema: 'ms_analytics',
    db: { schema: 'ms_analytics', query },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ schema: 'ms_analytics', query }),
    sql,
  } as unknown as AnalyticsStore & { sql: string[] }
}
const prunes = (s: { sql: string[] }) =>
  s.sql.filter((q) => /DELETE FROM ms_analytics\.sales_lines/.test(q)).length

describe('sales_lines prune timer', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('prunes hourly without any rebuild, and stops when stopped', async () => {
    const store = stubStore()
    const engine = new RankingEngine(new FakeRedis(), store)
    engine.startPruning()
    engine.startPruning() // idempotent: still one timer
    expect(prunes(store)).toBe(0)
    await jest.advanceTimersByTimeAsync(3_600_000)
    expect(prunes(store)).toBe(1)
    await jest.advanceTimersByTimeAsync(3_600_000)
    expect(prunes(store)).toBe(2)
    engine.stopPruning()
    await jest.advanceTimersByTimeAsync(3 * 3_600_000)
    expect(prunes(store)).toBe(2)
  })

  it('the timer is unref d and a failing prune is logged, not thrown', async () => {
    const store = stubStore()
    store.db.query = async () => {
      throw new Error('db down')
    }
    const logs: string[] = []
    const engine = new RankingEngine(new FakeRedis(), store, { log: (m) => logs.push(m) })
    engine.startPruning(1000)
    await jest.advanceTimersByTimeAsync(1000)
    expect(logs.join()).toMatch(/prune failed: db down/)
    expect((engine as unknown as { pruneTimer: { hasRef(): boolean } }).pruneTimer.hasRef()).toBe(
      false
    )
    await engine.close()
  })

  it('rebuild still prunes', async () => {
    const store = stubStore()
    await new RankingEngine(new FakeRedis(), store).rebuild()
    expect(prunes(store)).toBe(1)
  })

  it('shutdown stops the prune timer', () => {
    const stopPruning = jest.fn()
    const on = jest.spyOn(process, 'on').mockImplementation(() => process)
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    registerShutdownHandlers({
      server: { close: async () => undefined } as never,
      consumer: { close: async () => undefined } as never,
      producer: { close: async () => undefined } as never,
      security: { close: async () => undefined } as never,
      rankings: { close: async () => undefined, stopPruning },
    })
    const handler = on.mock.calls.find(([sig]) => sig === 'SIGTERM')?.[1] as () => void
    handler()
    return jest
      .requireActual<typeof import('timers/promises')>('timers/promises')
      .setImmediate()
      .then(() => {
        expect(stopPruning).toHaveBeenCalled()
        on.mockRestore()
        exit.mockRestore()
      })
  })
})

describe('order.created retried transaction does not double count', () => {
  it('records each line once even when the transaction callback runs twice', async () => {
    const base = stubStore()
    const store = {
      ...base,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = { schema: 'ms_analytics', query: base.db.query }
        await fn(tx) // first attempt (rolled back / retried)
        return fn(tx)
      },
    } as unknown as AnalyticsStore
    const recorded: { quantity: number }[][] = []
    const rankings: RankingSink = {
      recordOrder: async ({ lines }) => void recorded.push(lines),
    }
    const envelope = {
      eventId: 'e1',
      eventType: 'order.created',
      eventVersion: 1,
      occurredAt: '2026-10-17T12:00:00.000Z',
      producer: 'test',
      correlationId: 'c',
      payload: {
        orderId: 'o1',
        orderNumber: 'ORD-1',
        userId: 'u',
        customerEmail: 'a@example.com',
        status: 'PENDING',
        totalAmount: 10,
        currency: 'USD',
        items: [{ productId: 'p1', sku: 's', quantity: 2, unitPrice: 5, categoryId: 'c1' }],
      },
    } as unknown as EventEnvelope
    const ctx: EventContext = { topic: 't', partition: 0, offset: '1' }
    await handleOrderCreated({ store, log: () => undefined, rankings }, envelope, ctx)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toEqual([{ productId: 'p1', categoryId: 'c1', quantity: 2 }])
  })
})
