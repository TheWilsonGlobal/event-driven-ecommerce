import type { HourBucketDoc, ProductCounterDoc } from '../types'
import {
  hourKeyOf,
  readFunnel,
  readPaymentOutcomes,
  readProgress,
  type AnalyticsStore,
} from './store'

/**
 * The read side: turns stored aggregates into the shapes the HTTP routes
 * return.
 *
 * ── One rule governs this whole file ────────────────────────────────────────
 * A value that was never measured is null, never 0. Every derived quantity
 * here is a ratio or an average, and every one of them has a denominator that
 * can legitimately be zero — a service that has consumed nothing, an hour with
 * no orders, a product with no priced lines. Dividing anyway yields NaN, which
 * `JSON.stringify` renders as `null` by accident and Fastify's serializer
 * coerces to 0 outright under a plain `{ type: 'number' }` schema. Both are
 * worse than useless: 0% conversion is an alarming, actionable-looking number,
 * and it would be a complete fabrication.
 *
 * So: `ratio()` returns null on a zero denominator, and every field it feeds
 * is typed `['number', 'null']` in schemas.ts.
 */

/**
 * a / b, or null when b is zero or either input is unusable.
 *
 * Rounded to four decimal places because these are proportions read by humans
 * and a raw float would surface floating-point noise (0.30000000000000004) as
 * though it were precision.
 */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null
  }
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

/** Money rounded to cents. Kept out of the accumulators so stored sums stay exact-ish. */
function money(value: number): number {
  return Math.round(value * 100) / 100
}

export interface ProgressView {
  /** Events APPLIED, duplicates excluded. 0 with lastEventAt null means "nothing yet". */
  eventsProcessed: number
  duplicatesSkipped: number
  /** occurredAt of the newest applied event. null until the first one lands. */
  lastEventAt: string | null
  lastProcessedAt: string | null
}

/**
 * Progress, defaulted for a service that has never applied anything.
 *
 * The zeroes here are honest: they are accompanied by `lastEventAt: null`,
 * which is what tells a caller the counts are "nothing has happened" rather
 * than "everything measured to zero". That pairing is why every response in
 * this service carries both.
 */
export async function progressView(store: AnalyticsStore): Promise<ProgressView> {
  const progress = await readProgress(store)
  return {
    eventsProcessed: progress?.eventsProcessed ?? 0,
    duplicatesSkipped: progress?.duplicatesSkipped ?? 0,
    lastEventAt: progress?.lastEventAt ?? null,
    lastProcessedAt: progress?.lastProcessedAt ?? null,
  }
}

export interface SummaryView extends ProgressView {
  orders: number
  confirmed: number
  cancelled: number
  revenue: number
  /** null when no priced event has ever been observed — see HourBucketDoc. */
  currency: string | null
  /** revenue / orders. null when no orders, not 0. */
  averageOrderValue: number | null
  payments: {
    captured: number
    failed: number
    refunded: number
    capturedAmount: number
    refundedAmount: number
    /** captured / (captured + failed). null when neither has occurred. */
    successRate: number | null
  }
  /** Oldest / newest hour bucket that exists. Both null before the first event. */
  windowStart: string | null
  windowEnd: string | null
}

export async function summaryView(store: AnalyticsStore): Promise<SummaryView> {
  const [buckets, outcomes, progress] = await Promise.all([
    store.hourBuckets.find({}),
    readPaymentOutcomes(store),
    progressView(store),
  ])

  const sorted = sortBuckets(buckets)

  let orders = 0
  let confirmed = 0
  let cancelled = 0
  let revenue = 0
  let currency: string | null = null

  for (const bucket of sorted) {
    orders += bucket.orders
    confirmed += bucket.confirmed
    cancelled += bucket.cancelled
    revenue += bucket.revenue
    currency = currency ?? bucket.currency
  }

  const captured = outcomes?.captured ?? 0
  const failed = outcomes?.failed ?? 0
  const attempted = captured + failed

  return {
    ...progress,
    orders,
    confirmed,
    cancelled,
    revenue: money(revenue),
    currency,
    // Average over ALL orders, including any whose totalAmount was unusable.
    // That makes this a lower bound rather than a mean of the priced subset —
    // deliberate, because the alternative needs a separate "orders that
    // contributed revenue" counter to be honest, and silently averaging over
    // the priced subset while labelling it "average order value" is the kind
    // of quiet overstatement this repo keeps removing.
    averageOrderValue: ratio(money(revenue), orders),
    payments: {
      captured,
      failed,
      refunded: outcomes?.refunded ?? 0,
      capturedAmount: money(outcomes?.capturedAmount ?? 0),
      refundedAmount: money(outcomes?.refundedAmount ?? 0),
      // Null when nothing was ever attempted. A payment success rate of 0 on a
      // service that has taken no payments reads as total failure.
      successRate: ratio(captured, attempted),
    },
    // The window is the real extent of the data, not the requested range.
    windowStart: sorted[0]?.hourKey ?? null,
    windowEnd: sorted[sorted.length - 1]?.hourKey ?? null,
  }
}

export interface RevenuePoint {
  hourKey: string
  orders: number
  confirmed: number
  cancelled: number
  revenue: number
  currency: string | null
}

export interface RevenueView extends ProgressView {
  hours: number
  windowStart: string | null
  windowEnd: string | null
  /**
   * Only hours that actually have a bucket. Absent hours are NOT filled with
   * zero rows: "no orders in that hour" and "this service was not running in
   * that hour" are different claims, and a zero-filled series asserts the
   * first while the store only supports the second.
   */
  series: RevenuePoint[]
  totalRevenue: number
  totalOrders: number
}

export async function revenueView(store: AnalyticsStore, hours: number): Promise<RevenueView> {
  const [buckets, progress] = await Promise.all([store.hourBuckets.find({}), progressView(store)])

  // The window is anchored to NOW, so an idle service's window slides forward
  // and eventually contains nothing. That is correct: "no revenue in the last
  // 24 hours" is a real answer, distinguishable from "nothing ever processed"
  // by the eventsProcessed / lastEventAt pair travelling with it.
  const cutoffKey = hourKeyOf(new Date(Date.now() - hours * 3_600_000).toISOString())
  const sorted = sortBuckets(buckets).filter((b) => !cutoffKey || b.hourKey >= cutoffKey)

  const series: RevenuePoint[] = sorted.map((bucket) => ({
    hourKey: bucket.hourKey,
    orders: bucket.orders,
    confirmed: bucket.confirmed,
    cancelled: bucket.cancelled,
    revenue: money(bucket.revenue),
    currency: bucket.currency,
  }))

  return {
    ...progress,
    hours,
    windowStart: series[0]?.hourKey ?? null,
    windowEnd: series[series.length - 1]?.hourKey ?? null,
    series,
    totalRevenue: money(series.reduce((sum, p) => sum + p.revenue, 0)),
    totalOrders: series.reduce((sum, p) => sum + p.orders, 0),
  }
}

export interface TopProductView {
  productId: string
  sku: string
  unitsOrdered: number
  timesOrdered: number
  revenue: number
  /** revenue / unitsOrdered. null when no units were counted, not 0. */
  averageUnitPrice: number | null
}

export interface TopProductsView extends ProgressView {
  limit: number
  /** How many products have any counter at all, before the limit was applied. */
  totalProducts: number
  products: TopProductView[]
}

export async function topProductsView(
  store: AnalyticsStore,
  limit: number
): Promise<TopProductsView> {
  const [counters, progress] = await Promise.all([
    store.productCounters.find({}),
    progressView(store),
  ])

  // Ranked by units, tie-broken by revenue then productId. The final tiebreak
  // is what makes the ordering STABLE across requests — without it two
  // products with identical counters can swap places between calls, which
  // reads as data churning when nothing changed.
  const ranked = [...counters].sort(
    (a: ProductCounterDoc, b: ProductCounterDoc) =>
      b.unitsOrdered - a.unitsOrdered ||
      b.revenue - a.revenue ||
      a.productId.localeCompare(b.productId)
  )

  return {
    ...progress,
    limit,
    totalProducts: counters.length,
    products: ranked.slice(0, limit).map((c) => ({
      productId: c.productId,
      sku: c.sku,
      unitsOrdered: c.unitsOrdered,
      timesOrdered: c.timesOrdered,
      revenue: money(c.revenue),
      averageUnitPrice: ratio(money(c.revenue), c.unitsOrdered),
    })),
  }
}

export interface FunnelView extends ProgressView {
  created: number
  confirmed: number
  cancelled: number
  reserved: number
  insufficient: number
  conversion: {
    /** confirmed / created. null when nothing was created. */
    createdToConfirmed: number | null
    /** cancelled / created. null when nothing was created. */
    createdToCancelled: number | null
    /** reserved / created. null when nothing was created. */
    createdToReserved: number | null
    /**
     * insufficient / (reserved + insufficient) — the share of reservation
     * ATTEMPTS that could not be fulfilled. null when no attempt was made.
     *
     * Denominated on attempts rather than on `created`, because an order can
     * be created without a reservation ever being attempted (ms-inventory
     * down, or not running at all), and dividing by created would then report
     * a falsely healthy shortfall rate.
     */
    reservationShortfallRate: number | null
  }
}

export async function funnelView(store: AnalyticsStore): Promise<FunnelView> {
  const [funnel, progress] = await Promise.all([readFunnel(store), progressView(store)])

  const created = funnel?.created ?? 0
  const confirmed = funnel?.confirmed ?? 0
  const cancelled = funnel?.cancelled ?? 0
  const reserved = funnel?.reserved ?? 0
  const insufficient = funnel?.insufficient ?? 0
  const attempts = reserved + insufficient

  return {
    ...progress,
    created,
    confirmed,
    cancelled,
    reserved,
    insufficient,
    conversion: {
      createdToConfirmed: ratio(confirmed, created),
      createdToCancelled: ratio(cancelled, created),
      createdToReserved: ratio(reserved, created),
      reservationShortfallRate: ratio(insufficient, attempts),
    },
  }
}

/** Ascending by hourKey. The key is ISO-prefixed, so lexical order IS chronological. */
function sortBuckets(buckets: HourBucketDoc[]): HourBucketDoc[] {
  return [...buckets].sort((a, b) => a.hourKey.localeCompare(b.hourKey))
}
