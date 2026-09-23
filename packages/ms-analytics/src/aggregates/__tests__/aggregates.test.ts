import type { DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import type { EventContext, EventEnvelope } from '@ecommerce/shared-messaging'
import type {
  FunnelDoc,
  HourBucketDoc,
  PaymentOutcomeDoc,
  ProcessedEventDoc,
  ProductCounterDoc,
  ProgressDoc,
} from '../../types'
import {
  claimEvent,
  hourKeyOf,
  readFunnel,
  readPaymentOutcomes,
  type AnalyticsStore,
} from '../store'
import { funnelView, ratio, revenueView, summaryView } from '../views'
import {
  handleInventoryInsufficient,
  handleInventoryReserved,
  handleOrderCancelled,
  handleOrderConfirmed,
  handleOrderCreated,
  handlePaymentCaptured,
  handlePaymentFailed,
  handlePaymentRefunded,
  type HandlerDeps,
} from '../../events/handlers'

/**
 * Unit tests for ms-analytics' aggregation core.
 *
 * An aggregate has no self-correcting property: `revenue += 49.99` applied
 * twice yields a perfectly plausible 99.98 that nothing downstream can detect
 * as wrong. Every assertion below therefore pins a rule whose violation would
 * produce a NUMBER THAT LIES rather than an error — the double counts, the
 * phantom money and the fabricated zeroes that the source's docblocks call out
 * by name.
 *
 * No Kafka, no NeDB: the six collections are in-memory arrays behind the same
 * DocumentDatabaseAdapter surface, and the handlers read back what they wrote,
 * so an arithmetic regression has nowhere to hide.
 */

// ─── In-memory stand-in for the six collections ────────────────────────────

function makeStore<T extends object>(): DocumentDatabaseAdapter<T> & { docs: T[] } {
  const docs: T[] = []
  const matches = (doc: T, query: Record<string, unknown>): boolean =>
    Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v)

  return {
    docs,
    async findOne(query) {
      return docs.find((d) => matches(d, query)) ?? null
    },
    async find(query) {
      return docs.filter((d) => matches(d, query))
    },
    async insert(doc) {
      docs.push({ ...doc })
      return doc
    },
    async update(query, updateDoc) {
      let affected = 0
      for (const doc of docs) {
        if (matches(doc, query)) {
          Object.assign(doc, updateDoc)
          affected += 1
        }
      }
      return affected
    },
    async delete(query) {
      const before = docs.length
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        const doc = docs[i]
        if (doc && matches(doc, query)) docs.splice(i, 1)
      }
      return before - docs.length
    },
  }
}

interface Harness {
  store: AnalyticsStore
  deps: HandlerDeps
  logs: string[]
  hourBuckets: { docs: HourBucketDoc[] }
  productCounters: { docs: ProductCounterDoc[] }
  processedEvents: { docs: ProcessedEventDoc[] }
  progress: { docs: ProgressDoc[] }
}

function harness(): Harness {
  const hourBuckets = makeStore<HourBucketDoc>()
  const productCounters = makeStore<ProductCounterDoc>()
  const processedEvents = makeStore<ProcessedEventDoc>()
  const progress = makeStore<ProgressDoc>()

  const store: AnalyticsStore = {
    processedEvents,
    hourBuckets,
    productCounters,
    paymentOutcomes: makeStore<PaymentOutcomeDoc>(),
    funnel: makeStore<FunnelDoc>(),
    progress,
  }

  const logs: string[] = []
  return {
    store,
    logs,
    hourBuckets,
    productCounters,
    processedEvents,
    progress,
    deps: { store, log: (m: string) => logs.push(m) },
  }
}

const CONTEXT: EventContext = { topic: 'ecommerce.orders.v1', partition: 0, offset: '17' }

function envelope(eventType: string, occurredAt: string, payload: unknown, id?: string) {
  return {
    eventId: id ?? `evt-${eventType}-${occurredAt}`,
    eventType,
    eventVersion: 1,
    occurredAt,
    producer: 'test',
    correlationId: 'corr-1',
    payload,
  } as unknown as EventEnvelope
}

// ─── hourKeyOf ─────────────────────────────────────────────────────────────

describe('hourKeyOf', () => {
  /**
   * UTC, not local time. A local-time key silently re-buckets the same event
   * set when the service changes zone, and produces a duplicated or a missing
   * hour twice a year at each DST boundary. This machine's zone is UTC+7, so
   * a naive local formatter would answer '2026-09-23T11' here.
   */
  it('buckets in UTC, not in the local zone', () => {
    expect(hourKeyOf('2026-09-23T04:59:59.999Z')).toBe('2026-09-23T04')
    expect(hourKeyOf('2026-09-23T05:00:00.000Z')).toBe('2026-09-23T05')
  })

  /** An offset timestamp is normalised to the same UTC hour, not taken at face value. */
  it('normalises an offset timestamp to its UTC hour', () => {
    // 11:30+07:00 is 04:30Z — the SAME bucket as the plain-Z case above.
    expect(hourKeyOf('2026-09-23T11:30:00+07:00')).toBe('2026-09-23T04')
  })

  /**
   * null, not "now". Filing a fact under the CURRENT hour attributes it to a
   * time it demonstrably did not happen — and unlike a missing bucket, that
   * fabrication is invisible in the output.
   */
  it.each([
    ['an empty string', ''],
    ['free text', 'yesterday'],
    ['a truncated ISO string', '2026-13-45T99'],
    ['the literal word Invalid Date', 'Invalid Date'],
  ])('returns null for %s', (_label, value) => {
    expect(hourKeyOf(value)).toBeNull()
  })

  /** Lexical order IS chronological — sortBuckets in views.ts depends on it. */
  it('produces keys whose lexical order is chronological', () => {
    const keys = [
      hourKeyOf('2026-09-23T23:00:00.000Z'),
      hourKeyOf('2026-09-24T00:00:00.000Z'),
      hourKeyOf('2026-09-23T09:00:00.000Z'),
    ]
    expect([...keys].sort()).toEqual(['2026-09-23T09', '2026-09-23T23', '2026-09-24T00'])
  })
})

describe('the caller SKIPS the hourly contribution when hourKeyOf returns null', () => {
  /**
   * The half that matters. hourKeyOf returning null is only useful if the
   * handler then files NOTHING — a fallback to the current hour would be
   * undetectable in the stored data.
   */
  it('order.created with an unparseable occurredAt creates no hour bucket at all', async () => {
    const h = harness()

    await handleOrderCreated(
      h.deps,
      envelope('order.created', 'not-a-timestamp', {
        orderId: 'o1',
        totalAmount: 100,
        currency: 'USD',
        items: [],
      }),
      CONTEXT
    )

    expect(h.hourBuckets.docs).toHaveLength(0)
    // The funnel still counts it: we KNOW the order happened, we just do not
    // know when. Losing the count too would understate the funnel.
    expect((await readFunnel(h.store))?.created).toBe(1)
    expect(h.logs.some((m) => m.includes('unparseable occurredAt'))).toBe(true)
  })

  it.each([
    ['order.confirmed', handleOrderConfirmed],
    ['order.cancelled', handleOrderCancelled],
  ])('%s with an unparseable occurredAt creates no hour bucket', async (type, handler) => {
    const h = harness()
    await handler(h.deps, envelope(type, 'garbage', { orderId: 'o1' }), CONTEXT)
    expect(h.hourBuckets.docs).toHaveLength(0)
  })
})

// ─── claimEvent ────────────────────────────────────────────────────────────

describe('claimEvent', () => {
  const doc = (id: string): ProcessedEventDoc & { id: string } => ({
    id,
    eventType: 'order.created',
    occurredAt: '2026-09-23T04:00:00.000Z',
    processedAt: '2026-09-23T04:00:01.000Z',
    topic: 'ecommerce.orders.v1',
    partition: 0,
    offset: '1',
  })

  it('returns true for a new id and records it', async () => {
    const h = harness()
    expect(await claimEvent(h.store, doc('evt-1'))).toBe(true)
    expect(h.processedEvents.docs).toHaveLength(1)
  })

  /**
   * False for an id already applied. This is the only thing standing between
   * a Kafka rebalance and a permanently inflated revenue figure.
   */
  it('returns false for an already-applied id and inserts nothing further', async () => {
    const h = harness()
    await claimEvent(h.store, doc('evt-1'))

    expect(await claimEvent(h.store, doc('evt-1'))).toBe(false)
    expect(h.processedEvents.docs).toHaveLength(1)
  })

  it('treats distinct ids as independent claims', async () => {
    const h = harness()
    expect(await claimEvent(h.store, doc('evt-1'))).toBe(true)
    expect(await claimEvent(h.store, doc('evt-2'))).toBe(true)
    expect(h.processedEvents.docs.map((d) => d.id)).toEqual(['evt-1', 'evt-2'])
  })

  /**
   * End to end through a handler: a redelivered order.created contributes
   * nothing a second time, and the skip is COUNTED rather than silently
   * dropped — duplicatesSkipped is the only positive evidence that dedupe is
   * firing at all, as opposed to being present but never exercised.
   */
  it('makes a redelivered order.created contribute nothing, and counts the skip', async () => {
    const h = harness()
    const env = envelope(
      'order.created',
      '2026-09-23T04:15:00.000Z',
      { orderId: 'o1', totalAmount: 49.99, currency: 'USD', items: [] },
      'evt-dup'
    )

    await handleOrderCreated(h.deps, env, CONTEXT)
    await handleOrderCreated(h.deps, env, CONTEXT)

    // 49.99, not 99.98.
    expect(h.hourBuckets.docs[0]?.revenue).toBeCloseTo(49.99, 5)
    expect(h.hourBuckets.docs[0]?.orders).toBe(1)
    expect((await readFunnel(h.store))?.created).toBe(1)
    expect(h.progress.docs[0]?.eventsProcessed).toBe(1)
    expect(h.progress.docs[0]?.duplicatesSkipped).toBe(1)
  })
})

// ─── §3.5 design call: payment.failed carries no money ─────────────────────

describe('payment.failed contributes NO money', () => {
  /**
   * A failure carries the amount that was ATTEMPTED, not one that moved.
   * Accumulating it would put value into a money total that nobody was ever
   * charged — the figure stays plausible, so nothing downstream catches it.
   */
  it('counts the failure but adds nothing to capturedAmount or refundedAmount', async () => {
    const h = harness()

    await handlePaymentFailed(
      h.deps,
      envelope('payment.failed', '2026-09-23T04:00:00.000Z', {
        paymentId: 'p1',
        orderId: 'o1',
        amount: 500,
        currency: 'USD',
        reason: 'card_declined',
      }),
      CONTEXT
    )

    const outcomes = await readPaymentOutcomes(h.store)
    expect(outcomes?.failed).toBe(1)
    expect(outcomes?.capturedAmount).toBe(0)
    expect(outcomes?.refundedAmount).toBe(0)
    expect(outcomes?.captured).toBe(0)
  })

  /** And it never lands in the hour buckets either — revenue is orders + captures only. */
  it('puts no revenue into any hour bucket', async () => {
    const h = harness()

    await handlePaymentFailed(
      h.deps,
      envelope('payment.failed', '2026-09-23T04:00:00.000Z', { amount: 500 }),
      CONTEXT
    )

    expect(h.hourBuckets.docs).toHaveLength(0)
  })

  /**
   * successRate is captured/(captured+failed) and must be null — not 0 —
   * before anything was attempted. "0% payment success" on a service that has
   * taken no payments reads as a total outage.
   */
  it('leaves successRate null until something has actually been attempted', async () => {
    const h = harness()
    expect((await summaryView(h.store)).payments.successRate).toBeNull()

    await handlePaymentFailed(
      h.deps,
      envelope('payment.failed', '2026-09-23T04:00:00.000Z', {}),
      CONTEXT
    )
    // One failure, no captures: a REAL 0, distinguishable from the null above.
    expect((await summaryView(h.store)).payments.successRate).toBe(0)
  })
})

// ─── §3.5 design call: refunds are NOT netted against captures ─────────────

describe('refundedAmount is not netted against capturedAmount', () => {
  /**
   * Netting destroys the difference between "captured 100, refunded 40" and
   * "captured 60". The two are the same net position and completely different
   * businesses, and once netted the evidence of which is which is gone.
   */
  it('keeps captured 100 / refunded 40 distinct from a bare capture of 60', async () => {
    const h = harness()

    await handlePaymentCaptured(
      h.deps,
      envelope('payment.captured', '2026-09-23T04:00:00.000Z', { amount: 100 }, 'cap-1'),
      CONTEXT
    )
    await handlePaymentRefunded(
      h.deps,
      envelope('payment.refunded', '2026-09-23T05:00:00.000Z', { amount: 40 }, 'ref-1'),
      CONTEXT
    )

    const outcomes = await readPaymentOutcomes(h.store)
    expect(outcomes?.capturedAmount).toBe(100)
    expect(outcomes?.refundedAmount).toBe(40)

    const view = await summaryView(h.store)
    expect(view.payments.capturedAmount).toBe(100)
    expect(view.payments.refundedAmount).toBe(40)
    expect(view.payments.captured).toBe(1)
    expect(view.payments.refunded).toBe(1)
  })

  /** A refund is also not a negative capture: it never reduces the capture count. */
  it('does not decrement the capture count or the capture total', async () => {
    const h = harness()
    await handlePaymentCaptured(
      h.deps,
      envelope('payment.captured', '2026-09-23T04:00:00.000Z', { amount: 100 }, 'cap-1'),
      CONTEXT
    )
    await handlePaymentRefunded(
      h.deps,
      envelope('payment.refunded', '2026-09-23T05:00:00.000Z', { amount: 100 }, 'ref-1'),
      CONTEXT
    )

    const outcomes = await readPaymentOutcomes(h.store)
    expect(outcomes?.captured).toBe(1)
    expect(outcomes?.capturedAmount).toBe(100)
  })

  /**
   * A NEGATIVE amount is rejected outright: a refund is its own event type,
   * not a negative capture, and letting one through would net the totals by
   * the back door.
   */
  it.each([
    ['a negative amount', -50],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '100'],
    ['a missing amount', undefined],
  ])('contributes nothing for %s rather than corrupting the total', async (_label, amount) => {
    const h = harness()
    await handlePaymentCaptured(
      h.deps,
      envelope('payment.captured', '2026-09-23T04:00:00.000Z', { amount }),
      CONTEXT
    )

    const outcomes = await readPaymentOutcomes(h.store)
    // The capture COUNT still rises — the event happened. Only the money is
    // withheld, because we do not know what it was.
    expect(outcomes?.captured).toBe(1)
    expect(outcomes?.capturedAmount).toBe(0)
    expect(Number.isFinite(outcomes?.capturedAmount)).toBe(true)
  })
})

// ─── §3.5 design call: order.confirmed adds no revenue ─────────────────────

describe('order.confirmed adds NO revenue', () => {
  /**
   * order.created already banked this order's totalAmount. The confirmation
   * legitimately carries a totalAmount field that looks perfectly usable —
   * which is exactly why this is the single easiest way to double every
   * confirmed order's revenue contribution.
   */
  it('counts the confirmation but leaves the hour revenue at the created amount', async () => {
    const h = harness()
    const hour = '2026-09-23T04:15:00.000Z'

    await handleOrderCreated(
      h.deps,
      envelope('order.created', hour, {
        orderId: 'o1',
        totalAmount: 100,
        currency: 'USD',
        items: [],
      }),
      CONTEXT
    )
    await handleOrderConfirmed(
      h.deps,
      envelope('order.confirmed', hour, { orderId: 'o1', totalAmount: 100, currency: 'USD' }),
      CONTEXT
    )

    const bucket = h.hourBuckets.docs[0]
    // 100, not 200.
    expect(bucket?.revenue).toBe(100)
    expect(bucket?.orders).toBe(1)
    expect(bucket?.confirmed).toBe(1)
    expect((await summaryView(h.store)).revenue).toBe(100)
  })

  /** A confirmation arriving with no prior created event adds revenue of exactly 0. */
  it('adds zero revenue even when it is the only event in its hour', async () => {
    const h = harness()

    await handleOrderConfirmed(
      h.deps,
      envelope('order.confirmed', '2026-09-23T06:00:00.000Z', {
        orderId: 'o1',
        totalAmount: 999,
        currency: 'USD',
      }),
      CONTEXT
    )

    expect(h.hourBuckets.docs[0]?.revenue).toBe(0)
    expect(h.hourBuckets.docs[0]?.confirmed).toBe(1)
    expect(h.hourBuckets.docs[0]?.orders).toBe(0)
    // No priced event landed, so the bucket carries no currency label.
    expect(h.hourBuckets.docs[0]?.currency).toBeNull()
  })

  /**
   * Cancellation does not SUBTRACT revenue either. The hour in which an order
   * was created genuinely saw it created; subtracting would rewrite history
   * and could drive a bucket negative.
   */
  it('order.cancelled does not decrement the revenue of the hour it lands in', async () => {
    const h = harness()
    const hour = '2026-09-23T04:15:00.000Z'

    await handleOrderCreated(
      h.deps,
      envelope('order.created', hour, {
        orderId: 'o1',
        totalAmount: 100,
        currency: 'USD',
        items: [],
      }),
      CONTEXT
    )
    await handleOrderCancelled(
      h.deps,
      envelope('order.cancelled', hour, { orderId: 'o1', reason: 'user' }),
      CONTEXT
    )

    expect(h.hourBuckets.docs[0]?.revenue).toBe(100)
    expect(h.hourBuckets.docs[0]?.cancelled).toBe(1)
  })
})

// ─── §3.5 design call: shortfall rate is denominated on ATTEMPTS ───────────

describe('reservationShortfallRate is denominated on reservation ATTEMPTS', () => {
  async function reserveAndShortfall(h: Harness, reserved: number, insufficient: number) {
    for (let i = 0; i < reserved; i += 1) {
      await handleInventoryReserved(
        h.deps,
        envelope(
          'inventory.reserved',
          '2026-09-23T04:00:00.000Z',
          { orderId: `r${i}` },
          `res-${i}`
        ),
        CONTEXT
      )
    }
    for (let i = 0; i < insufficient; i += 1) {
      await handleInventoryInsufficient(
        h.deps,
        envelope(
          'inventory.insufficient',
          '2026-09-23T04:00:00.000Z',
          { orderId: `s${i}`, shortfalls: [{ productId: 'p1' }] },
          `ins-${i}`
        ),
        CONTEXT
      )
    }
  }

  /**
   * insufficient / (reserved + insufficient), NOT insufficient / created.
   * An order can be created with no reservation ever attempted (ms-inventory
   * down, or simply not running), and dividing by `created` then reports a
   * falsely healthy shortfall rate while the service is failing every attempt.
   */
  it('divides by reserved+insufficient, not by created', async () => {
    const h = harness()

    // 10 orders created, but only 4 reservation attempts ever reached
    // ms-inventory — 1 succeeded, 3 were short.
    for (let i = 0; i < 10; i += 1) {
      await handleOrderCreated(
        h.deps,
        envelope(
          'order.created',
          '2026-09-23T04:00:00.000Z',
          { orderId: `o${i}`, totalAmount: 10, currency: 'USD', items: [] },
          `crt-${i}`
        ),
        CONTEXT
      )
    }
    await reserveAndShortfall(h, 1, 3)

    const view = await funnelView(h.store)
    expect(view.created).toBe(10)
    expect(view.reserved).toBe(1)
    expect(view.insufficient).toBe(3)
    // 3/4 = 0.75. Denominated on created it would read 3/10 = 0.3 — a
    // service failing 75% of attempts reported as failing 30%.
    expect(view.conversion.reservationShortfallRate).toBe(0.75)
    expect(view.conversion.createdToReserved).toBe(0.1)
  })

  /**
   * Null, not 0, when no attempt was ever made. A 0% shortfall rate on a
   * service that has attempted nothing is an actionable-looking fabrication.
   */
  it('is null when no reservation was ever attempted', async () => {
    const h = harness()
    await handleOrderCreated(
      h.deps,
      envelope('order.created', '2026-09-23T04:00:00.000Z', {
        orderId: 'o1',
        totalAmount: 10,
        currency: 'USD',
        items: [],
      }),
      CONTEXT
    )

    const view = await funnelView(h.store)
    expect(view.created).toBe(1)
    expect(view.conversion.reservationShortfallRate).toBeNull()
    // The created-denominated ratios ARE defined here — which is exactly why
    // the shortfall rate needs its own denominator.
    expect(view.conversion.createdToReserved).toBe(0)
  })

  /** ratio() itself: null on a zero denominator, never NaN and never 0. */
  it.each([
    [1, 0],
    [0, 0],
    [Number.NaN, 5],
    [5, Number.NaN],
    [5, Number.POSITIVE_INFINITY],
  ])('ratio(%p, %p) is null rather than NaN or a fabricated 0', (n, d) => {
    expect(ratio(n, d)).toBeNull()
  })
})

// ─── §3.5 design call: no zero-filled hours ────────────────────────────────

describe('hours with no data are ABSENT from the revenue series', () => {
  /**
   * "No orders in that hour" and "this service was not running in that hour"
   * are different claims. The store only supports the second, so a zero-filled
   * series would assert the first on evidence it does not have.
   */
  it('returns only the hours that actually have a bucket, with the gap left out', async () => {
    const h = harness()
    const now = Date.now()
    const hourAgo = (n: number) => new Date(now - n * 3_600_000).toISOString()

    // Two orders three hours apart — the two hours between them saw nothing.
    await handleOrderCreated(
      h.deps,
      envelope(
        'order.created',
        hourAgo(3),
        { orderId: 'o1', totalAmount: 10, currency: 'USD', items: [] },
        'e1'
      ),
      CONTEXT
    )
    await handleOrderCreated(
      h.deps,
      envelope(
        'order.created',
        hourAgo(0),
        { orderId: 'o2', totalAmount: 20, currency: 'USD', items: [] },
        'e2'
      ),
      CONTEXT
    )

    const view = await revenueView(h.store, 24)

    // Exactly two points for a 24-hour window, not 24 and not 4.
    expect(view.series).toHaveLength(2)
    expect(view.series.map((p) => p.revenue)).toEqual([10, 20])
    expect(view.hours).toBe(24)
    expect(view.totalRevenue).toBe(30)
    expect(view.totalOrders).toBe(2)
    // The window reflects the real extent of the DATA, not the request.
    expect(view.windowStart).toBe(view.series[0]?.hourKey)
    expect(view.windowEnd).toBe(view.series[1]?.hourKey)
  })

  /**
   * An empty series is empty — not 24 zero rows. Its "nothing has happened"
   * status is carried by eventsProcessed/lastEventAt travelling alongside.
   */
  it('returns an empty series, not zero rows, for a service that consumed nothing', async () => {
    const h = harness()
    const view = await revenueView(h.store, 24)

    expect(view.series).toEqual([])
    expect(view.windowStart).toBeNull()
    expect(view.windowEnd).toBeNull()
    expect(view.totalRevenue).toBe(0)
    expect(view.eventsProcessed).toBe(0)
    expect(view.lastEventAt).toBeNull()
  })

  /**
   * A bucket with orders but no usable money has revenue 0 — a MEASURED zero,
   * present in the series. That is the opposite case to the absent hour above,
   * and the distinction is only readable because absent hours stay absent.
   */
  it('keeps a real bucket whose revenue is a measured zero', async () => {
    const h = harness()

    await handleOrderCreated(
      h.deps,
      envelope('order.created', new Date().toISOString(), {
        orderId: 'o1',
        totalAmount: 'not a number',
        currency: 'USD',
        items: [],
      }),
      CONTEXT
    )

    const view = await revenueView(h.store, 24)
    expect(view.series).toHaveLength(1)
    expect(view.series[0]?.orders).toBe(1)
    expect(view.series[0]?.revenue).toBe(0)
    // No usable amount means no currency label either — the two move together.
    expect(view.series[0]?.currency).toBeNull()
  })

  /** Buckets older than the requested window are excluded, not zeroed. */
  it('excludes buckets older than the requested window', async () => {
    const h = harness()
    const old = new Date(Date.now() - 50 * 3_600_000).toISOString()

    await handleOrderCreated(
      h.deps,
      envelope('order.created', old, {
        orderId: 'o1',
        totalAmount: 10,
        currency: 'USD',
        items: [],
      }),
      CONTEXT
    )

    expect((await revenueView(h.store, 24)).series).toHaveLength(0)
    expect((await revenueView(h.store, 72)).series).toHaveLength(1)
  })
})

// ─── averageOrderValue: null rather than a fabricated 0 ────────────────────

describe('averageOrderValue', () => {
  /** Zero orders means the average is unmeasured, not zero. */
  it('is null when no order has been counted', async () => {
    const h = harness()
    expect((await summaryView(h.store)).averageOrderValue).toBeNull()
  })

  it('is revenue/orders once orders exist', async () => {
    const h = harness()
    for (const [i, amount] of [100, 50].entries()) {
      await handleOrderCreated(
        h.deps,
        envelope(
          'order.created',
          '2026-09-23T04:00:00.000Z',
          { orderId: `o${i}`, totalAmount: amount, currency: 'USD', items: [] },
          `e${i}`
        ),
        CONTEXT
      )
    }
    const view = await summaryView(h.store)
    expect(view.revenue).toBe(150)
    expect(view.averageOrderValue).toBe(75)
  })
})
