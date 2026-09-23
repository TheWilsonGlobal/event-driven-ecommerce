import type { DocumentDatabaseAdapter, DatabaseConfiguration } from '@ecommerce/shared-database'
import { createDocumentStore } from '@ecommerce/shared-database'
import type {
  FunnelDoc,
  HourBucketDoc,
  PaymentOutcomeDoc,
  ProcessedEventDoc,
  ProductCounterDoc,
  ProgressDoc,
} from '../types'

/**
 * The analytics write model: six NeDB collections this service owns outright.
 *
 * ── Why upsert-by-natural-key, and why it is not a race ─────────────────────
 * Every mutation here is read-modify-write, which is not atomic. That is safe
 * only because ONE consumer loop applies events sequentially — kafkajs'
 * `eachMessage` awaits each handler before pulling the next message. There is
 * exactly one writer in this process, and no other service writes these files.
 * If a second writer ever appeared (a second replica of ms-analytics sharing a
 * data path) these increments would start losing updates; the fix then is
 * nedb's $inc, not a lock. Stated here because the safety is structural rather
 * than obvious from any single function below.
 *
 * ── Singletons are real documents, not implicit zeroes ──────────────────────
 * The funnel, payment-outcome and progress documents are created lazily on
 * first write. A missing document therefore means "nothing has ever been
 * applied", which the read layer renders distinctly from "all counters are
 * genuinely zero". Seeding them with zeroes at boot would throw that
 * distinction away before the first request ever arrived.
 */

export const COLLECTIONS = {
  processedEvents: 'analytics_processed_events',
  hourBuckets: 'analytics_hour_buckets',
  productCounters: 'analytics_product_counters',
  paymentOutcomes: 'analytics_payment_outcomes',
  funnel: 'analytics_funnel',
  progress: 'analytics_progress',
} as const

/** Fixed id for the three singleton documents. */
const SINGLETON_ID = 'singleton'

export interface AnalyticsStore {
  processedEvents: DocumentDatabaseAdapter<ProcessedEventDoc>
  hourBuckets: DocumentDatabaseAdapter<HourBucketDoc>
  productCounters: DocumentDatabaseAdapter<ProductCounterDoc>
  paymentOutcomes: DocumentDatabaseAdapter<PaymentOutcomeDoc>
  funnel: DocumentDatabaseAdapter<FunnelDoc>
  progress: DocumentDatabaseAdapter<ProgressDoc>
}

export function createAnalyticsStore(config: DatabaseConfiguration): AnalyticsStore {
  return {
    processedEvents: createDocumentStore<ProcessedEventDoc>(COLLECTIONS.processedEvents, config),
    hourBuckets: createDocumentStore<HourBucketDoc>(COLLECTIONS.hourBuckets, config),
    productCounters: createDocumentStore<ProductCounterDoc>(COLLECTIONS.productCounters, config),
    paymentOutcomes: createDocumentStore<PaymentOutcomeDoc>(COLLECTIONS.paymentOutcomes, config),
    funnel: createDocumentStore<FunnelDoc>(COLLECTIONS.funnel, config),
    progress: createDocumentStore<ProgressDoc>(COLLECTIONS.progress, config),
  }
}

/**
 * The hour a fact belongs to, in UTC — e.g. 2026-09-23T04.
 *
 * UTC rather than local time because the bucket key has to be stable across
 * the machines that write it and the ones that read it. A local-time key would
 * silently re-bucket the same event set when the service moved zone, and would
 * produce a duplicated or a missing hour twice a year at each DST boundary.
 *
 * Returns null for an unparseable timestamp. The caller then skips the hourly
 * contribution rather than filing the fact under the CURRENT hour, which would
 * attribute it to a time it demonstrably did not happen.
 */
export function hourKeyOf(isoTimestamp: string): string | null {
  const parsed = Date.parse(isoTimestamp)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return new Date(parsed).toISOString().slice(0, 13)
}

/**
 * Records that `eventId` has been applied.
 *
 * Returns false when it was ALREADY applied, and the caller must then make no
 * contribution whatsoever. This is the load-bearing half of the idempotency
 * contract; see handlers.ts for why an aggregate needs it more than a state
 * machine does.
 *
 * Check-then-insert rather than insert-then-catch, because the adapter's
 * `insert` surfaces a duplicate-key failure as a generic Error we cannot
 * reliably distinguish from a disk failure. The window that would make
 * check-then-insert wrong requires two concurrent writers, which the
 * single-consumer-loop property above rules out.
 */
export async function claimEvent(
  store: AnalyticsStore,
  doc: ProcessedEventDoc & { id: string }
): Promise<boolean> {
  const existing = await store.processedEvents.findOne({ id: doc.id })
  if (existing) {
    return false
  }
  await store.processedEvents.insert(doc)
  return true
}

/** Reads a singleton, or null when it has never been written. */
async function readSingleton<T>(adapter: DocumentDatabaseAdapter<T>): Promise<T | null> {
  return adapter.findOne({ id: SINGLETON_ID })
}

export async function readFunnel(store: AnalyticsStore): Promise<FunnelDoc | null> {
  return readSingleton(store.funnel)
}

export async function readPaymentOutcomes(
  store: AnalyticsStore
): Promise<PaymentOutcomeDoc | null> {
  return readSingleton(store.paymentOutcomes)
}

export async function readProgress(store: AnalyticsStore): Promise<ProgressDoc | null> {
  return readSingleton(store.progress)
}

/**
 * Increments named counters on the funnel singleton, creating it on first use.
 *
 * `deltas` is partial: a handler contributes only the counts it actually
 * observed. Omitting a key and passing 0 are equivalent HERE, because these are
 * counts of occurrences — unlike money, where an absent amount means "this
 * event did not carry one" and must never become a 0 contribution.
 */
export async function bumpFunnel(
  store: AnalyticsStore,
  deltas: Partial<Record<keyof Omit<FunnelDoc, 'id' | '_id'>, number>>
): Promise<void> {
  const current: FunnelDoc = (await readFunnel(store)) ?? {
    id: SINGLETON_ID,
    created: 0,
    confirmed: 0,
    cancelled: 0,
    reserved: 0,
    insufficient: 0,
  }

  await upsertSingleton(store.funnel, {
    ...current,
    created: current.created + (deltas.created ?? 0),
    confirmed: current.confirmed + (deltas.confirmed ?? 0),
    cancelled: current.cancelled + (deltas.cancelled ?? 0),
    reserved: current.reserved + (deltas.reserved ?? 0),
    insufficient: current.insufficient + (deltas.insufficient ?? 0),
  })
}

export async function bumpPaymentOutcomes(
  store: AnalyticsStore,
  deltas: Partial<Record<keyof Omit<PaymentOutcomeDoc, 'id' | '_id'>, number>>
): Promise<void> {
  const current: PaymentOutcomeDoc = (await readPaymentOutcomes(store)) ?? {
    id: SINGLETON_ID,
    captured: 0,
    failed: 0,
    refunded: 0,
    capturedAmount: 0,
    refundedAmount: 0,
  }

  await upsertSingleton(store.paymentOutcomes, {
    ...current,
    captured: current.captured + (deltas.captured ?? 0),
    failed: current.failed + (deltas.failed ?? 0),
    refunded: current.refunded + (deltas.refunded ?? 0),
    capturedAmount: current.capturedAmount + (deltas.capturedAmount ?? 0),
    refundedAmount: current.refundedAmount + (deltas.refundedAmount ?? 0),
  })
}

export interface HourDeltas {
  orders?: number | undefined
  confirmed?: number | undefined
  cancelled?: number | undefined
  revenue?: number | undefined
  /** Supplied only alongside a revenue contribution — see HourBucketDoc. */
  currency?: string | undefined
}

export async function bumpHourBucket(
  store: AnalyticsStore,
  hourKey: string,
  deltas: HourDeltas
): Promise<void> {
  const current: HourBucketDoc = (await store.hourBuckets.findOne({ id: hourKey })) ?? {
    id: hourKey,
    hourKey,
    orders: 0,
    confirmed: 0,
    cancelled: 0,
    revenue: 0,
    currency: null,
  }

  await upsert(store.hourBuckets, hourKey, {
    ...current,
    orders: current.orders + (deltas.orders ?? 0),
    confirmed: current.confirmed + (deltas.confirmed ?? 0),
    cancelled: current.cancelled + (deltas.cancelled ?? 0),
    revenue: current.revenue + (deltas.revenue ?? 0),
    // First observed currency wins and is never overwritten. A second currency
    // arriving in the same hour is a real modelling limit of a single float
    // `revenue`; it is left visible (the label stays the first one observed)
    // rather than papered over with an exchange rate this service cannot know.
    currency: current.currency ?? deltas.currency ?? null,
  })
}

export interface ProductDeltas {
  sku: string
  unitsOrdered?: number | undefined
  timesOrdered?: number | undefined
  revenue?: number | undefined
}

export async function bumpProductCounter(
  store: AnalyticsStore,
  productId: string,
  deltas: ProductDeltas
): Promise<void> {
  const current: ProductCounterDoc = (await store.productCounters.findOne({ id: productId })) ?? {
    id: productId,
    productId,
    sku: deltas.sku,
    unitsOrdered: 0,
    timesOrdered: 0,
    revenue: 0,
  }

  await upsert(store.productCounters, productId, {
    ...current,
    // A later event carrying a real sku replaces a placeholder empty one; a
    // later EMPTY sku never erases a value we already learned.
    sku: deltas.sku || current.sku,
    unitsOrdered: current.unitsOrdered + (deltas.unitsOrdered ?? 0),
    timesOrdered: current.timesOrdered + (deltas.timesOrdered ?? 0),
    revenue: current.revenue + (deltas.revenue ?? 0),
  })
}

/**
 * Records progress after an event was APPLIED.
 *
 * `occurredAt` only ever moves lastEventAt FORWARD. Kafka guarantees ordering
 * within a partition, not across them, so an event consumed later can legally
 * carry an earlier timestamp; letting it win would make lastEventAt jump
 * backwards and read as though the service had regressed.
 */
export async function recordProgress(
  store: AnalyticsStore,
  occurredAt: string | null
): Promise<void> {
  const current = await readOrInitProgress(store)

  await upsertSingleton(store.progress, {
    ...current,
    eventsProcessed: current.eventsProcessed + 1,
    lastEventAt: pickLatest(current.lastEventAt, occurredAt),
    lastProcessedAt: new Date().toISOString(),
  })
}

/**
 * Counts a redelivery the idempotency check rejected.
 *
 * Surfaced on every response rather than merely logged: a non-zero value is
 * the only positive evidence that deduplication is actually firing, as opposed
 * to being present but never exercised.
 */
export async function recordDuplicate(store: AnalyticsStore): Promise<void> {
  const current = await readOrInitProgress(store)

  await upsertSingleton(store.progress, {
    ...current,
    duplicatesSkipped: current.duplicatesSkipped + 1,
  })
}

async function readOrInitProgress(store: AnalyticsStore): Promise<ProgressDoc> {
  return (
    (await readProgress(store)) ?? {
      id: SINGLETON_ID,
      eventsProcessed: 0,
      duplicatesSkipped: 0,
      lastEventAt: null,
      lastProcessedAt: null,
    }
  )
}

function pickLatest(a: string | null, b: string | null): string | null {
  if (!b) return a
  if (!a) return b
  return Date.parse(b) > Date.parse(a) ? b : a
}

async function upsertSingleton<T extends { id?: string | undefined }>(
  adapter: DocumentDatabaseAdapter<T>,
  doc: T
): Promise<void> {
  await upsert(adapter, SINGLETON_ID, { ...doc, id: SINGLETON_ID })
}

/**
 * update-then-insert-if-it-did-not-exist.
 *
 * The adapter's `update` is a `$set` with no upsert option, so it returns 0
 * when the document is absent. That return value is the only signal available,
 * and handling it here keeps every caller above free of a create/update branch.
 */
async function upsert<T extends { id?: string | undefined }>(
  adapter: DocumentDatabaseAdapter<T>,
  id: string,
  doc: T
): Promise<void> {
  const affected = await adapter.update({ id }, doc)
  if (affected === 0) {
    await adapter.insert({ ...doc, id })
  }
}
