import * as path from 'path'
import { getServicePool, withTransaction, type ServicePool } from '@ecommerce/shared-database'
import type { InventoryDoc, ReservationDoc, ReservationItem, ReservationStatus } from '../types'

/**
 * ms-inventory's repositories over Postgres (schema ms_inventory), created by
 * migrations/001_init.sql.
 *
 * ── Writes take a transaction, reads take the store ─────────────────────────
 * Every function that writes takes a `Tx` and must be called from inside
 * `store.transaction(...)`: the ledger claim, the stock movement, the
 * reservation and the outbox rows for one event commit together or not at all
 * (see events/handlers.ts). Reads take the store and run as plain autocommit
 * queries.
 *
 * ── Every table reference is schema-qualified ───────────────────────────────
 * The transaction pooler does not preserve `search_path`, so SQL here always
 * says `${schema}.table`. `schema` is a service constant or a test-controlled
 * name checked against a strict identifier pattern, never request input.
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

export interface InventoryStore {
  readonly schema: string
  /** Autocommit queries, for the read views and the outbox relay. */
  readonly db: Tx
  /** Runs `fn` in one BEGIN/COMMIT; any throw rolls the whole thing back. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** Store over an explicit pool and schema. Tests pass a throwaway schema here. */
export function createInventoryStoreOn(pool: ServicePool['pool'], schema: string): InventoryStore {
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

/** The production store: the inventory pool, schema ms_inventory. */
export function createInventoryStore(): InventoryStore {
  const sp = getServicePool('inventory')
  return createInventoryStoreOn(sp.pool, sp.schema)
}

function iso(value: Date | string): string {
  return new Date(value).toISOString()
}

interface InventoryRow {
  product_id: string
  sku: string | null
  available: number
  reserved: number
  updated_at: Date | string
}

function toInventoryDoc(r: InventoryRow): InventoryDoc {
  return {
    productId: r.product_id,
    sku: r.sku ?? '',
    available: r.available,
    reserved: r.reserved,
    updatedAt: iso(r.updated_at),
  }
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export async function listInventory(store: InventoryStore): Promise<InventoryDoc[]> {
  const { rows } = await store.db.query(
    `SELECT product_id, sku, available, reserved, updated_at
       FROM ${store.schema}.inventory
      ORDER BY product_id`
  )
  return rows.map(toInventoryDoc)
}

export async function getInventory(
  store: InventoryStore,
  productId: string
): Promise<InventoryDoc | null> {
  const { rows } = await store.db.query(
    `SELECT product_id, sku, available, reserved, updated_at
       FROM ${store.schema}.inventory
      WHERE product_id = $1`,
    [productId]
  )
  return rows[0] ? toInventoryDoc(rows[0]) : null
}

/** Newest first, optionally narrowed to one order. */
export async function listReservations(
  store: InventoryStore,
  orderId?: string
): Promise<ReservationDoc[]> {
  const { rows } = await store.db.query(
    `SELECT order_id, order_number, event_id, items, status, created_at, released_at
       FROM ${store.schema}.reservations
      WHERE ($1::text IS NULL OR order_id = $1)
      ORDER BY created_at DESC, order_id`,
    [orderId ?? null]
  )
  return rows.map((r) => ({
    orderId: r.order_id as string,
    orderNumber: (r.order_number as string | null) ?? '',
    eventId: (r.event_id as string | null) ?? '',
    items: r.items as ReservationItem[],
    status: r.status as ReservationStatus,
    createdAt: iso(r.created_at),
    releasedAt: r.released_at ? iso(r.released_at) : null,
  }))
}

// ─── Seed ──────────────────────────────────────────────────────────────────

/**
 * Inserts the products that have no row yet; returns how many were inserted.
 *
 * ON CONFLICT DO NOTHING per product is what keeps a restart from re-inflating
 * the stock of a product whose units are currently reserved, and it is a single
 * statement, so two replicas booting together cannot both seed the same row.
 */
export async function seedInventory(
  store: InventoryStore,
  products: readonly { productId: string; sku: string; stock: number }[]
): Promise<number> {
  if (products.length === 0) return 0
  const result = await store.db.query(
    `INSERT INTO ${store.schema}.inventory (product_id, sku, available, reserved)
     SELECT product_id, sku, available, 0
       FROM unnest($1::text[], $2::text[], $3::int[]) AS s(product_id, sku, available)
     ON CONFLICT (product_id) DO NOTHING`,
    [products.map((p) => p.productId), products.map((p) => p.sku), products.map((p) => p.stock)]
  )
  return result.rowCount ?? 0
}

// ─── Writes (call inside store.transaction) ────────────────────────────────

/**
 * Guard 1. Records that `eventId` is being handled; false when it already was.
 *
 * It must be the FIRST statement of the event's transaction. The primary key
 * makes check-and-claim one atomic statement, so two concurrent deliveries of
 * one event cannot both win: the loser blocks on the winner's uncommitted row,
 * then sees the conflict once it commits (rowCount 0). If the winner rolls
 * back instead, the loser's insert succeeds and it applies the event itself.
 *
 * `outcome` is left NULL here and set by `setOutcome` before COMMIT, because
 * the decision is only known once the handler has looked at the stock.
 */
export async function claimEvent(tx: Tx, eventId: string, eventType: string): Promise<boolean> {
  const result = await tx.query(
    `INSERT INTO ${tx.schema}.processed_events (event_id, event_type)
     VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType]
  )
  return result.rowCount === 1
}

export async function setOutcome(tx: Tx, eventId: string, outcome: string): Promise<void> {
  await tx.query(`UPDATE ${tx.schema}.processed_events SET outcome = $2 WHERE event_id = $1`, [
    eventId,
    outcome,
  ])
}

export interface LockedStock {
  sku: string
  available: number
  reserved: number
}

/**
 * Batch-reads and ROW-LOCKS the stock rows for `productIds`.
 *
 * ORDER BY product_id is the deadlock guard: every transaction that locks
 * several product rows takes them in the same order, so two orders with
 * overlapping lines queue behind each other instead of waiting on each other in
 * a cycle. Products with no row are simply absent from the map.
 */
export async function lockStock(
  tx: Tx,
  productIds: readonly string[]
): Promise<Map<string, LockedStock>> {
  const { rows } = await tx.query(
    `SELECT product_id, sku, available, reserved
       FROM ${tx.schema}.inventory
      WHERE product_id = ANY($1::text[])
      ORDER BY product_id
        FOR UPDATE`,
    [[...productIds]]
  )
  return new Map(
    rows.map((r) => [
      r.product_id as string,
      { sku: (r.sku as string | null) ?? '', available: r.available, reserved: r.reserved },
    ])
  )
}

/**
 * Moves `quantity` per product from available to reserved. The caller has
 * already locked these rows via `lockStock` and checked availability; the CHECK
 * constraints are the backstop if it did not.
 */
export async function reserveStock(tx: Tx, items: readonly ReservationItem[]): Promise<void> {
  if (items.length === 0) return
  await tx.query(
    `UPDATE ${tx.schema}.inventory AS i
        SET available = i.available - u.qty,
            reserved  = i.reserved  + u.qty,
            updated_at = now()
       FROM unnest($1::text[], $2::int[]) AS u(product_id, qty)
      WHERE i.product_id = u.product_id`,
    [items.map((i) => i.productId), items.map((i) => i.quantity)]
  )
}

/**
 * Credits `quantity` per product back to available. A product row that vanished
 * is skipped (the join matches nothing) rather than recreated: recreating it
 * would invent a stock level out of an event that only knows how many units to
 * give BACK.
 *
 * `reserved` is clamped at 0: it can only sit below the held quantity after an
 * external edit, and a negative count would be a fabricated number (and would
 * violate the CHECK, failing the whole release).
 */
export async function creditStock(tx: Tx, items: readonly ReservationItem[]): Promise<void> {
  if (items.length === 0) return
  await tx.query(
    `UPDATE ${tx.schema}.inventory AS i
        SET available = i.available + u.qty,
            reserved  = GREATEST(0, i.reserved - u.qty),
            updated_at = now()
       FROM unnest($1::text[], $2::int[]) AS u(product_id, qty)
      WHERE i.product_id = u.product_id`,
    [items.map((i) => i.productId), items.map((i) => i.quantity)]
  )
}

/**
 * Guard 2, reserve side. Claims the order: true when THIS transaction created
 * the reservation, false when one already exists (under any other eventId).
 *
 * order_id is the primary key, so this is one atomic statement. A concurrent
 * insert for the same order blocks on this transaction's uncommitted row and
 * then conflicts -- or, if this transaction deletes the row again (see
 * `deleteReservation`) or rolls back, proceeds as if it had never been there.
 */
export async function insertReservation(
  tx: Tx,
  reservation: { orderId: string; orderNumber: string; eventId: string; items: ReservationItem[] }
): Promise<boolean> {
  const result = await tx.query(
    `INSERT INTO ${tx.schema}.reservations (order_id, order_number, event_id, items, status)
     VALUES ($1, $2, $3, $4::jsonb, 'RESERVED')
     ON CONFLICT (order_id) DO NOTHING`,
    [
      reservation.orderId,
      reservation.orderNumber,
      reservation.eventId,
      JSON.stringify(reservation.items),
    ]
  )
  return result.rowCount === 1
}

/** Withdraws the reservation this same transaction just inserted (short stock). */
export async function deleteReservation(tx: Tx, orderId: string): Promise<void> {
  await tx.query(`DELETE FROM ${tx.schema}.reservations WHERE order_id = $1`, [orderId])
}

export async function getReservationState(
  tx: Tx,
  orderId: string
): Promise<{ status: ReservationStatus; eventId: string } | null> {
  const { rows } = await tx.query(
    `SELECT status, event_id FROM ${tx.schema}.reservations WHERE order_id = $1`,
    [orderId]
  )
  const r = rows[0]
  return r ? { status: r.status as ReservationStatus, eventId: (r.event_id as string) ?? '' } : null
}

/**
 * Guard 2, release side. Flips RESERVED -> RELEASED and returns the held items,
 * or null when there was nothing to flip.
 *
 * The status predicate IS the guard: of two concurrent releases the second
 * blocks on the first's row lock, re-evaluates `status = 'RESERVED'` after it
 * commits, matches nothing and returns null -- so stock is credited once.
 */
export async function markReleased(
  tx: Tx,
  orderId: string
): Promise<{ orderNumber: string; items: ReservationItem[] } | null> {
  const { rows } = await tx.query(
    `UPDATE ${tx.schema}.reservations
        SET status = 'RELEASED', released_at = now()
      WHERE order_id = $1 AND status = 'RESERVED'
  RETURNING order_number, items`,
    [orderId]
  )
  const r = rows[0]
  return r
    ? { orderNumber: (r.order_number as string | null) ?? '', items: r.items as ReservationItem[] }
    : null
}
