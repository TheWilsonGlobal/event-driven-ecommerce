import * as path from 'path'
import { getServicePool, withTransaction, type ServicePool } from '@ecommerce/shared-database'
import type {
  FunnelDoc,
  HourBucketDoc,
  PaymentOutcomeDoc,
  ProcessedEventDoc,
  ProductCounterDoc,
  ProgressDoc,
} from '../types'

/**
 * The analytics write model: six Postgres tables in schema ms_analytics, created
 * by migrations/001_init.sql.
 *
 * ── Why counters are atomic now ─────────────────────────────────────────────
 * Every bump is one `INSERT ... ON CONFLICT (key) DO UPDATE SET n = t.n +
 * EXCLUDED.n`, evaluated by the database. The NeDB version read a document,
 * added in JS and wrote it back, which was safe only while exactly ONE consumer
 * loop in ONE process wrote the files. Two replicas (or a replica plus a replay)
 * now serialise on the row lock instead of silently losing updates.
 *
 * ── Writes take a transaction, reads take the store ─────────────────────────
 * Every `bump*`, `claimEvent` and `record*` function takes a `Tx` and must be
 * called from inside `store.transaction(...)`: the ledger insert and all the
 * counter bumps for one event commit together or not at all (see handlers.ts).
 * Reads (`read*`) take the store and run as plain autocommit queries.
 *
 * ── Every table reference is schema-qualified ───────────────────────────────
 * The transaction pooler does not preserve `search_path`, so SQL here always
 * says `${schema}.table`. `schema` is a service constant or a test-controlled
 * name checked against a strict identifier pattern, never request input.
 *
 * ── Singletons are real rows, not implicit zeroes ───────────────────────────
 * The funnel, payment_outcomes and progress rows are created lazily by the
 * first upsert. A missing row therefore means "nothing has ever been applied",
 * which the read layer renders distinctly from "all counters are genuinely
 * zero". Seeding them with zeroes at boot would throw that distinction away
 * before the first request ever arrived. The readers below return null for it.
 */

/**
 * Directory holding the SQL migrations. Resolved from this file so it is the
 * same package-root folder whether we run from src (ts-node) or dist (tsc
 * output): both sit exactly two levels below the package root.
 */
export const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations')

/** The slice of a pg client/pool this module needs (and a fake can implement). */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>
}

/** A Queryable bound to one schema. Inside `transaction` it is ONE connection. */
export interface Tx extends Queryable {
  readonly schema: string
}

export interface AnalyticsStore {
  readonly schema: string
  /** Autocommit queries, for the read views. */
  readonly db: Tx
  /** Runs `fn` in one BEGIN/COMMIT; any throw rolls the whole thing back. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** Store over an explicit pool and schema. Tests pass a throwaway schema here. */
export function createAnalyticsStoreOn(pool: ServicePool['pool'], schema: string): AnalyticsStore {
  if (!IDENTIFIER.test(schema)) throw new Error(`bad schema name: ${schema}`)
  return {
    schema,
    db: { schema, query: (text, params) => pool.query(text, params) },
    transaction: (fn) =>
      withTransaction(pool, (client) =>
        fn({ schema, query: (text, params) => client.query(text, params) })
      ),
  }
}

/** The production store: the analytics pool, schema ms_analytics. */
export function createAnalyticsStore(): AnalyticsStore {
  const sp = getServicePool('analytics')
  return createAnalyticsStoreOn(sp.pool, sp.schema)
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
 * Records that `doc.id` (the eventId) has been applied.
 *
 * Returns false when it was ALREADY applied, and the caller must then make no
 * contribution whatsoever. This is the load-bearing half of the idempotency
 * contract; see handlers.ts for why an aggregate needs it more than a state
 * machine does.
 *
 * It must be the FIRST statement of the event's transaction. The primary key
 * makes the check-and-claim a single atomic statement, so two concurrent
 * deliveries of one event cannot both win: the loser blocks on the winner's
 * uncommitted row, then sees the conflict once it commits (rowCount 0).
 */
export async function claimEvent(tx: Tx, doc: ProcessedEventDoc): Promise<boolean> {
  const result = await tx.query(
    `INSERT INTO ${tx.schema}.processed_events
       (event_id, event_type, occurred_at, topic, partition, kafka_offset)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_id) DO NOTHING`,
    [doc.id, doc.eventType, doc.occurredAt, doc.topic, doc.partition, doc.offset]
  )
  return result.rowCount === 1
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/** numeric and bigint arrive as strings from pg; the API contract is number. */
function num(value: unknown): number {
  return Number(value)
}

/** Reads a singleton, or null when its row has never been written. */
export async function readFunnel(store: AnalyticsStore): Promise<FunnelDoc | null> {
  const { rows } = await store.db.query(
    `SELECT created, confirmed, cancelled, reserved, insufficient
       FROM ${store.schema}.funnel`
  )
  const r = rows[0]
  return r
    ? {
        created: num(r.created),
        confirmed: num(r.confirmed),
        cancelled: num(r.cancelled),
        reserved: num(r.reserved),
        insufficient: num(r.insufficient),
      }
    : null
}

export async function readPaymentOutcomes(
  store: AnalyticsStore
): Promise<PaymentOutcomeDoc | null> {
  const { rows } = await store.db.query(
    `SELECT captured, failed, refunded, captured_amount, refunded_amount
       FROM ${store.schema}.payment_outcomes`
  )
  const r = rows[0]
  return r
    ? {
        captured: num(r.captured),
        failed: num(r.failed),
        refunded: num(r.refunded),
        capturedAmount: num(r.captured_amount),
        refundedAmount: num(r.refunded_amount),
      }
    : null
}

export async function readProgress(store: AnalyticsStore): Promise<ProgressDoc | null> {
  const { rows } = await store.db.query(
    `SELECT events_processed, duplicates_skipped, last_event_at, last_processed_at
       FROM ${store.schema}.progress`
  )
  const r = rows[0]
  return r
    ? {
        eventsProcessed: num(r.events_processed),
        duplicatesSkipped: num(r.duplicates_skipped),
        lastEventAt: r.last_event_at ? new Date(r.last_event_at).toISOString() : null,
        lastProcessedAt: r.last_processed_at ? new Date(r.last_processed_at).toISOString() : null,
      }
    : null
}

/** Every hour bucket, ascending by hour_key (ISO-prefixed, so text order is chronological). */
export async function readHourBuckets(store: AnalyticsStore): Promise<HourBucketDoc[]> {
  const { rows } = await store.db.query(
    `SELECT hour_key, orders, confirmed, cancelled, revenue, currency
       FROM ${store.schema}.hour_buckets
      ORDER BY hour_key`
  )
  return rows.map((r) => ({
    hourKey: r.hour_key as string,
    orders: num(r.orders),
    confirmed: num(r.confirmed),
    cancelled: num(r.cancelled),
    revenue: num(r.revenue),
    currency: (r.currency as string | null) ?? null,
  }))
}

export async function readProductCounters(store: AnalyticsStore): Promise<ProductCounterDoc[]> {
  const { rows } = await store.db.query(
    `SELECT product_id, sku, units_ordered, times_ordered, revenue
       FROM ${store.schema}.product_counters`
  )
  return rows.map((r) => ({
    productId: r.product_id as string,
    sku: r.sku as string,
    unitsOrdered: num(r.units_ordered),
    timesOrdered: num(r.times_ordered),
    revenue: num(r.revenue),
  }))
}

// ─── Writes (call inside store.transaction) ────────────────────────────────

/**
 * Increments named counters on the funnel singleton, creating it on first use.
 *
 * `deltas` is partial: a handler contributes only the counts it actually
 * observed. Omitting a key and passing 0 are equivalent HERE, because these are
 * counts of occurrences — unlike money, where an absent amount means "this
 * event did not carry one" and must never become a 0 contribution.
 */
export async function bumpFunnel(
  tx: Tx,
  deltas: Partial<Record<keyof FunnelDoc, number>>
): Promise<void> {
  await tx.query(
    `INSERT INTO ${tx.schema}.funnel AS t (id, created, confirmed, cancelled, reserved, insufficient)
     VALUES (true, $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       created      = t.created      + EXCLUDED.created,
       confirmed    = t.confirmed    + EXCLUDED.confirmed,
       cancelled    = t.cancelled    + EXCLUDED.cancelled,
       reserved     = t.reserved     + EXCLUDED.reserved,
       insufficient = t.insufficient + EXCLUDED.insufficient`,
    [
      deltas.created ?? 0,
      deltas.confirmed ?? 0,
      deltas.cancelled ?? 0,
      deltas.reserved ?? 0,
      deltas.insufficient ?? 0,
    ]
  )
}

export async function bumpPaymentOutcomes(
  tx: Tx,
  deltas: Partial<Record<keyof PaymentOutcomeDoc, number>>
): Promise<void> {
  await tx.query(
    `INSERT INTO ${tx.schema}.payment_outcomes AS t
       (id, captured, failed, refunded, captured_amount, refunded_amount)
     VALUES (true, $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       captured        = t.captured        + EXCLUDED.captured,
       failed          = t.failed          + EXCLUDED.failed,
       refunded        = t.refunded        + EXCLUDED.refunded,
       captured_amount = t.captured_amount + EXCLUDED.captured_amount,
       refunded_amount = t.refunded_amount + EXCLUDED.refunded_amount`,
    [
      deltas.captured ?? 0,
      deltas.failed ?? 0,
      deltas.refunded ?? 0,
      deltas.capturedAmount ?? 0,
      deltas.refundedAmount ?? 0,
    ]
  )
}

export interface HourDeltas {
  orders?: number | undefined
  confirmed?: number | undefined
  cancelled?: number | undefined
  revenue?: number | undefined
  /** Supplied only alongside a revenue contribution — see HourBucketDoc. */
  currency?: string | undefined
}

export async function bumpHourBucket(tx: Tx, hourKey: string, deltas: HourDeltas): Promise<void> {
  await tx.query(
    `INSERT INTO ${tx.schema}.hour_buckets AS t (hour_key, orders, confirmed, cancelled, revenue, currency)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (hour_key) DO UPDATE SET
       orders    = t.orders    + EXCLUDED.orders,
       confirmed = t.confirmed + EXCLUDED.confirmed,
       cancelled = t.cancelled + EXCLUDED.cancelled,
       revenue   = t.revenue   + EXCLUDED.revenue,
       -- First observed currency wins and is never overwritten. A second
       -- currency arriving in the same hour is a real modelling limit of a
       -- single revenue column; it is left visible (the label stays the first
       -- one observed) rather than papered over with an exchange rate this
       -- service cannot know.
       currency  = COALESCE(t.currency, EXCLUDED.currency)`,
    [
      hourKey,
      deltas.orders ?? 0,
      deltas.confirmed ?? 0,
      deltas.cancelled ?? 0,
      deltas.revenue ?? 0,
      deltas.currency ?? null,
    ]
  )
}

export interface ProductDeltas {
  sku: string
  unitsOrdered?: number | undefined
  timesOrdered?: number | undefined
  revenue?: number | undefined
}

export async function bumpProductCounter(
  tx: Tx,
  productId: string,
  deltas: ProductDeltas
): Promise<void> {
  await tx.query(
    `INSERT INTO ${tx.schema}.product_counters AS t
       (product_id, sku, units_ordered, times_ordered, revenue)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id) DO UPDATE SET
       -- A later event carrying a real sku replaces a placeholder empty one; a
       -- later EMPTY sku never erases a value we already learned.
       sku           = COALESCE(NULLIF(EXCLUDED.sku, ''), t.sku),
       units_ordered = t.units_ordered + EXCLUDED.units_ordered,
       times_ordered = t.times_ordered + EXCLUDED.times_ordered,
       revenue       = t.revenue       + EXCLUDED.revenue`,
    [productId, deltas.sku, deltas.unitsOrdered ?? 0, deltas.timesOrdered ?? 0, deltas.revenue ?? 0]
  )
}

/**
 * Records progress after an event was APPLIED.
 *
 * `occurredAt` only ever moves lastEventAt FORWARD (GREATEST ignores NULLs).
 * Kafka guarantees ordering within a partition, not across them, so an event
 * consumed later can legally carry an earlier timestamp; letting it win would
 * make lastEventAt jump backwards and read as though the service had regressed.
 * An unparseable occurredAt is passed as NULL and so never moves it at all.
 */
export async function recordProgress(tx: Tx, occurredAt: string | null): Promise<void> {
  const parsed = occurredAt !== null ? Date.parse(occurredAt) : Number.NaN
  await tx.query(
    `INSERT INTO ${tx.schema}.progress AS t
       (id, events_processed, duplicates_skipped, last_event_at, last_processed_at)
     VALUES (true, 1, 0, $1::timestamptz, now())
     ON CONFLICT (id) DO UPDATE SET
       events_processed  = t.events_processed + 1,
       last_event_at     = GREATEST(t.last_event_at, EXCLUDED.last_event_at),
       last_processed_at = now()`,
    [Number.isFinite(parsed) ? new Date(parsed).toISOString() : null]
  )
}

/**
 * Counts a redelivery the idempotency check rejected.
 *
 * Surfaced on every response rather than merely logged: a non-zero value is
 * the only positive evidence that deduplication is actually firing, as opposed
 * to being present but never exercised. It is an atomic increment on the
 * progress row, not an aggregate contribution, so it does not violate "a
 * duplicate touches no counters".
 */
export async function recordDuplicate(tx: Tx): Promise<void> {
  await tx.query(
    `INSERT INTO ${tx.schema}.progress AS t (id, events_processed, duplicates_skipped)
     VALUES (true, 0, 1)
     ON CONFLICT (id) DO UPDATE SET duplicates_skipped = t.duplicates_skipped + 1`
  )
}

// ─── Sales lines (windowed rankings) ───────────────────────────────────────

export interface SalesLine {
  productId: string
  categoryId: string | null
  quantity: number
}

/**
 * Persists the order lines behind the windowed rankings. Call inside the
 * event's transaction, after the claim: a redelivery never reaches this.
 * One row per (event, product); the caller has already merged duplicate lines.
 */
export async function recordSalesLines(
  tx: Tx,
  eventId: string,
  occurredAt: Date,
  lines: SalesLine[]
): Promise<void> {
  for (const line of lines) {
    await tx.query(
      `INSERT INTO ${tx.schema}.sales_lines (event_id, product_id, category_id, quantity, occurred_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id, product_id) DO NOTHING`,
      [eventId, line.productId, line.categoryId, line.quantity, occurredAt.toISOString()]
    )
  }
}

export interface SalesBucketRow {
  productId: string
  categoryId: string | null
  /** floor(epoch_ms / bucketMs) */
  bucket: number
  units: number
}

/**
 * Units per (product, category, time bucket) since `since`. The bucketing is
 * done by the database so a rebuild moves one row per bucket, not one per line.
 * `bucketMs` is a service constant, never request input.
 */
export async function readSalesBuckets(
  store: AnalyticsStore,
  since: Date,
  bucketMs: number
): Promise<SalesBucketRow[]> {
  const { rows } = await store.db.query(
    `SELECT product_id, category_id,
            floor(extract(epoch from occurred_at) * 1000 / $2)::bigint AS bucket,
            sum(quantity) AS units
       FROM ${store.schema}.sales_lines
      WHERE occurred_at >= $1
      GROUP BY product_id, category_id, bucket`,
    [since.toISOString(), bucketMs]
  )
  return rows.map((r) => ({
    productId: r.product_id as string,
    categoryId: (r.category_id as string | null) ?? null,
    bucket: num(r.bucket),
    units: num(r.units),
  }))
}

/** Units per product since `since`, optionally for one category, best first. */
export async function readSalesTotals(
  store: AnalyticsStore,
  since: Date,
  categoryId: string | null,
  limit: number
): Promise<{ productId: string; units: number }[]> {
  const { rows } = await store.db.query(
    `SELECT product_id, sum(quantity) AS units
       FROM ${store.schema}.sales_lines
      WHERE occurred_at >= $1 AND ($2::text IS NULL OR category_id = $2)
      GROUP BY product_id
      ORDER BY units DESC, product_id ASC
      LIMIT $3`,
    [since.toISOString(), categoryId, limit]
  )
  return rows.map((r) => ({ productId: r.product_id as string, units: num(r.units) }))
}

/** Drops lines older than `before`. Returns how many were removed. */
export async function pruneSalesLines(store: AnalyticsStore, before: Date): Promise<number> {
  const result = await store.db.query(
    `DELETE FROM ${store.schema}.sales_lines WHERE occurred_at < $1`,
    [before.toISOString()]
  )
  return result.rowCount ?? 0
}
