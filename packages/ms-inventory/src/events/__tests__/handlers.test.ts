import * as crypto from 'crypto'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { closeServicePools, getServicePool } from '@ecommerce/shared-database'
import { OutboxRelay, TOPICS, type EventEnvelope } from '@ecommerce/shared-messaging'
import {
  MIGRATIONS_DIR,
  createInventoryStoreOn,
  listReservations,
  type InventoryStore,
} from '../../db/store'
import { makeReconciliationProcessor } from '../../queues/workers'
import type { QueueManager } from '../../queues'
import { handleOrderCancelled, handleOrderCreated, type HandlerDeps } from '../handlers'

/**
 * Tests for ms-inventory's stock-movement handlers.
 *
 * These pin the invariants named in handlers.ts's own docblock — the ones
 * whose failure corrupts stock SILENTLY, producing a number that is wrong but
 * entirely plausible.
 *
 * ── Real Postgres, throwaway schema ─────────────────────────────────────────
 * The behaviour under test (one transaction per event, the ledger and
 * reservation primary keys, FOR UPDATE row locks, the CHECK constraints) lives
 * in the database, so a fake would only test the fake. The suite runs against
 * the real database from the root .env, inside a schema named
 * test_inventory_<random> that is created from the real migration file and
 * DROPPED afterwards. It never touches ms_inventory. Without
 * INVENTORY_DATABASE_URL the whole suite is skipped (visibly, in the jest
 * summary). No Kafka and no Redis.
 */

dotenv.config({ path: path.resolve(__dirname, '../../../../../.env') })
jest.setTimeout(60_000)

const HAS_DB = Boolean(process.env.INVENTORY_DATABASE_URL)
const dbDescribe = HAS_DB ? describe : describe.skip

const TEST_SCHEMA = `test_inventory_${crypto.randomBytes(6).toString('hex')}`
const TABLES = ['inventory', 'reservations', 'processed_events', 'outbox_events']

let store: InventoryStore

beforeAll(async () => {
  if (!HAS_DB) return
  const pool = getServicePool('inventory').pool
  const sql = fs
    .readFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), 'utf8')
    .replace(/\{\{schema\}\}/g, TEST_SCHEMA)
  await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`)
  await pool.query(sql)
  store = createInventoryStoreOn(pool, TEST_SCHEMA)
})

afterAll(async () => {
  if (HAS_DB) {
    await getServicePool('inventory')
      .pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
      .catch(() => undefined)
  }
  await closeServicePools()
})

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  if (!store) return
  await store.db.query(
    `TRUNCATE ${TABLES.map((t) => `${TEST_SCHEMA}.${t}`).join(', ')} RESTART IDENTITY`
  )
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── Helpers ───────────────────────────────────────────────────────────────

interface Line {
  productId: string
  sku: string
  quantity: number
}

function line(productId: string, quantity: number): Line {
  return { productId, sku: `SKU-${productId}`, quantity }
}

function orderCreated(eventId: string, orderId: string, items: Line[]): EventEnvelope {
  return {
    eventId,
    eventType: 'order.created',
    eventVersion: 1,
    occurredAt: '2026-09-23T04:15:00.000Z',
    producer: 'ms-order',
    correlationId: `corr-${eventId}`,
    payload: { orderId, orderNumber: `ORD-${orderId}`, items },
  } as unknown as EventEnvelope
}

function orderCancelled(eventId: string, orderId: string, reason = 'user-cancelled') {
  return {
    eventId,
    eventType: 'order.cancelled',
    eventVersion: 1,
    occurredAt: '2026-09-23T05:15:00.000Z',
    producer: 'ms-order',
    correlationId: `corr-${eventId}`,
    payload: { orderId, orderNumber: `ORD-${orderId}`, reason },
  } as unknown as EventEnvelope
}

/** tryEnqueue is the only QueueManager surface the handlers touch. */
function makeDeps(s: InventoryStore = store) {
  const tryEnqueue = jest.fn(async (_name: string, run: () => Promise<unknown>) => {
    await run()
    return undefined
  })
  const queueManager = {
    tryEnqueue,
    enqueueReleaseExpired: jest.fn(async () => 'job-1'),
  } as unknown as QueueManager
  const deps: HandlerDeps = { store: s, queueManager }
  return { deps, tryEnqueue }
}

async function seedStock(rows: { productId: string; available: number; reserved?: number }[]) {
  for (const r of rows) {
    await store.db.query(
      `INSERT INTO ${TEST_SCHEMA}.inventory (product_id, sku, available, reserved)
       VALUES ($1, $2, $3, $4)`,
      [r.productId, `SKU-${r.productId}`, r.available, r.reserved ?? 0]
    )
  }
}

async function stock(): Promise<Record<string, { available: number; reserved: number }>> {
  const { rows } = await store.db.query(
    `SELECT product_id, available, reserved FROM ${TEST_SCHEMA}.inventory ORDER BY product_id`
  )
  return Object.fromEntries(
    rows.map((r) => [r.product_id, { available: r.available, reserved: r.reserved }])
  )
}

async function ledger(): Promise<{ eventId: string; outcome: string | null }[]> {
  const { rows } = await store.db.query(
    `SELECT event_id, outcome FROM ${TEST_SCHEMA}.processed_events ORDER BY processed_at, event_id`
  )
  return rows.map((r) => ({ eventId: r.event_id, outcome: r.outcome }))
}

async function outcomes(): Promise<(string | null)[]> {
  const { rows } = await store.db.query(
    `SELECT outcome FROM ${TEST_SCHEMA}.processed_events ORDER BY processed_at, event_id`
  )
  return rows.map((r) => r.outcome)
}

async function outbox() {
  const { rows } = await store.db.query(
    `SELECT seq, event_id::text AS event_id, topic, partition_key, event_type, envelope, status
       FROM ${TEST_SCHEMA}.outbox_events ORDER BY seq`
  )
  return rows as {
    seq: string
    event_id: string
    topic: string
    partition_key: string
    event_type: string
    envelope: { eventId: string; eventType: string; payload: Record<string, unknown> }
    status: string
  }[]
}

async function counts() {
  const n = async (t: string) =>
    Number((await store.db.query(`SELECT count(*)::int AS n FROM ${TEST_SCHEMA}.${t}`)).rows[0].n)
  return {
    reservations: await n('reservations'),
    ledger: await n('processed_events'),
    outbox: await n('outbox_events'),
  }
}

/**
 * A store whose transactions throw right AFTER a statement matching `pattern`
 * has run -- i.e. after that write, before COMMIT. Nothing is added to the
 * production code for this: the failure is injected at the Tx boundary.
 */
function failingAfter(pattern: RegExp): InventoryStore {
  return {
    ...store,
    transaction: (fn) =>
      store.transaction((tx) =>
        fn({
          schema: tx.schema,
          query: async (text, params) => {
            const result = await tx.query(text, params)
            if (pattern.test(text)) throw new Error('injected failure before COMMIT')
            return result
          },
        })
      ),
  }
}

// ─── collapseItems ─────────────────────────────────────────────────────────

dbDescribe('collapseItems (exercised through handleOrderCreated)', () => {
  /**
   * Two lines of 8 against a stock of 10. Checked line-by-line each passes
   * independently, 16 units get decremented and the row lands at -6. Summing
   * first is what makes the availability check mean what it says. (Here the
   * CHECK constraint would also stop it -- but as a rolled-back exception, not
   * the clean `insufficient` outcome the domain wants.)
   */
  it('SUMS two lines naming the same productId before the availability check', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const { deps } = makeDeps()

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [line('prod-1', 8), line('prod-1', 8)]),
      deps
    )

    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    expect(await outcomes()).toEqual(['insufficient'])
    expect((await counts()).reservations).toBe(0)
  })

  /** The shortfall is reported ONCE, for the summed quantity. */
  it('reports a single summed shortfall, not one per duplicate line', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const { deps } = makeDeps()

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [line('prod-1', 8), line('prod-1', 8)]),
      deps
    )

    const rows = await outbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.event_type).toBe('inventory.insufficient')
    expect(rows[0]?.envelope.payload.shortfalls).toEqual([
      { productId: 'prod-1', sku: 'SKU-prod-1', requested: 16, available: 10 },
    ])
  })

  /** The collapsed quantity is what gets decremented, and it is decremented ONCE. */
  it('decrements the SUMMED quantity exactly once when stock does cover it', async () => {
    await seedStock([{ productId: 'prod-1', available: 20 }])
    const { deps } = makeDeps()

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [line('prod-1', 8), line('prod-1', 8)]),
      deps
    )

    expect(await stock()).toEqual({ 'prod-1': { available: 4, reserved: 16 } })
    // The reservation stores the COLLAPSED line, so a later release credits
    // back 16 rather than crediting one 8 and losing the other.
    const [reservation] = await listReservations(store)
    expect(reservation?.items).toEqual([{ productId: 'prod-1', sku: 'SKU-prod-1', quantity: 16 }])
  })
})

// ─── Outbox ────────────────────────────────────────────────────────────────

dbDescribe('the outbox row written in the same transaction', () => {
  /**
   * The row's event_id IS the envelope's eventId: it was minted once, at insert
   * time, so every relay retry re-sends the same id and consumers can dedupe.
   */
  it('exists after commit with the same eventId as its stored envelope', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const { deps } = makeDeps()

    await handleOrderCreated(orderCreated('evt-1', 'ord-1', [line('prod-1', 3)]), deps)

    const rows = await outbox()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.status).toBe('pending')
    expect(row?.topic).toBe(TOPICS.inventory)
    expect(row?.event_type).toBe('inventory.reserved')
    // Keyed per product, as the inventory topic is declared.
    expect(row?.partition_key).toBe('prod-1')
    expect(row?.envelope.eventId).toBe(row?.event_id)
    expect(row?.envelope.eventType).toBe('inventory.reserved')
    expect(row?.envelope.payload).toMatchObject({ orderId: 'ord-1', orderNumber: 'ORD-ord-1' })
  })

  /** One row per product, each with its own eventId and only its own slice. */
  it('fans a multi-product order out to one row per product', async () => {
    await seedStock([
      { productId: 'prod-1', available: 10 },
      { productId: 'prod-2', available: 10 },
    ])
    const { deps } = makeDeps()

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [line('prod-2', 1), line('prod-1', 2)]),
      deps
    )

    const rows = await outbox()
    expect(rows.map((r) => r.partition_key).sort()).toEqual(['prod-1', 'prod-2'])
    expect(new Set(rows.map((r) => r.event_id)).size).toBe(2)
    for (const row of rows) {
      expect((row.envelope.payload.reservations as unknown[]).length).toBe(1)
    }
  })

  /** The relay can drain what the handler wrote (column-for-column compatible). */
  it('is drained by an OutboxRelay: the stored envelope is sent unchanged, then marked sent', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const { deps } = makeDeps()
    await handleOrderCreated(orderCreated('evt-1', 'ord-1', [line('prod-1', 3)]), deps)
    const [stored] = await outbox()

    const sent: { topic: string; key: string; eventId: string }[] = []
    const relay = new OutboxRelay({
      db: store.db,
      schema: TEST_SCHEMA,
      publish: async (row) => {
        sent.push({ topic: row.topic, key: row.partitionKey, eventId: row.envelope.eventId })
      },
      logPrefix: '[test]',
      pollMs: 50,
      batch: 10,
      leaseMs: 5000,
      sendTimeoutMs: 1000,
    })

    expect(await relay.tick()).toBe(1)

    expect(sent).toEqual([
      { topic: TOPICS.inventory, key: 'prod-1', eventId: stored?.event_id as string },
    ])
    expect((await outbox())[0]?.status).toBe('sent')
    const stats = await relay.stats()
    expect(stats.counts).toMatchObject({ pending: 0, sent: 1 })
  })
})

// ─── Atomicity ─────────────────────────────────────────────────────────────

dbDescribe('atomicity — one transaction per event', () => {
  /**
   * The failure lands AFTER the stock UPDATE and BEFORE COMMIT. Everything the
   * handler already wrote -- the stock, the reservation, the ledger claim, any
   * outbox row -- must vanish together. This is the property the NeDB version
   * could not offer and had to approximate by writing the ledger last.
   */
  it('rolls back stock, reservation, ledger AND outbox when it fails after the stock write', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const { deps } = makeDeps(failingAfter(/i\.available - u\.qty/))

    await expect(
      handleOrderCreated(orderCreated('evt-1', 'ord-1', [line('prod-1', 4)]), deps)
    ).rejects.toThrow('injected failure')

    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    expect(await counts()).toEqual({ reservations: 0, ledger: 0, outbox: 0 })
  })

  /** Same, failing after the LAST write (the outbox insert) -- the stock write is undone too. */
  it('rolls the stock write back when the outbox insert is what fails', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const { deps } = makeDeps(failingAfter(/INSERT INTO .*\.outbox_events/))

    await expect(
      handleOrderCreated(orderCreated('evt-1', 'ord-1', [line('prod-1', 4)]), deps)
    ).rejects.toThrow('injected failure')

    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    expect(await counts()).toEqual({ reservations: 0, ledger: 0, outbox: 0 })
  })

  /**
   * The rollback leaves the event UNRECORDED, so the redelivery applies it
   * exactly once -- the property that makes "throw and let Kafka redeliver" safe.
   */
  it('lets the redelivery of a rolled-back event apply it exactly once', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const envelope = orderCreated('evt-1', 'ord-1', [line('prod-1', 4)])

    await expect(
      handleOrderCreated(envelope, makeDeps(failingAfter(/i\.available - u\.qty/)).deps)
    ).rejects.toThrow()
    await handleOrderCreated(envelope, makeDeps().deps)
    await handleOrderCreated(envelope, makeDeps().deps)

    expect(await stock()).toEqual({ 'prod-1': { available: 6, reserved: 4 } })
    expect(await counts()).toEqual({ reservations: 1, ledger: 1, outbox: 1 })
  })

  /** The release path is atomic too: a failure after the credit undoes the status flip. */
  it('rolls back a release that fails after the stock credit', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    await handleOrderCreated(orderCreated('evt-a', 'ord-1', [line('prod-1', 4)]), makeDeps().deps)

    await expect(
      handleOrderCancelled(
        orderCancelled('evt-c', 'ord-1'),
        makeDeps(failingAfter(/i\.available \+ u\.qty/)).deps
      )
    ).rejects.toThrow('injected failure')

    expect(await stock()).toEqual({ 'prod-1': { available: 6, reserved: 4 } })
    expect((await listReservations(store))[0]?.status).toBe('RESERVED')
    expect((await ledger()).map((l) => l.eventId)).toEqual(['evt-a'])
    expect((await outbox()).map((o) => o.event_type)).toEqual(['inventory.reserved'])
  })
})

// ─── Idempotency guard 1: the event ledger ─────────────────────────────────

dbDescribe('guard 1 — the processed_events ledger', () => {
  /**
   * The literal Kafka redelivery: the SAME eventId arriving twice. If this
   * regresses, every consumer-group rebalance double-decrements stock.
   */
  it('skips a duplicate eventId and writes nothing at all', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const { deps, tryEnqueue } = makeDeps()
    const envelope = orderCreated('evt-dup', 'ord-1', [line('prod-1', 3)])

    await handleOrderCreated(envelope, deps)
    await handleOrderCreated(envelope, deps)

    expect(await stock()).toEqual({ 'prod-1': { available: 7, reserved: 3 } })
    expect(await counts()).toEqual({ reservations: 1, ledger: 1, outbox: 1 })
    // The expiry timer is scheduled once, not once per delivery.
    expect(tryEnqueue).toHaveBeenCalledTimes(1)
  })

  /**
   * The same eventId delivered by two consumers at once (a rebalance overlap).
   * The second INSERT blocks on the first's uncommitted ledger row, then sees
   * the conflict: exactly one effect.
   */
  it('applies one effect when the SAME eventId is delivered concurrently', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const envelope = orderCreated('evt-race', 'ord-1', [line('prod-1', 3)])

    await Promise.all([
      handleOrderCreated(envelope, makeDeps().deps),
      handleOrderCreated(envelope, makeDeps().deps),
    ])

    expect(await stock()).toEqual({ 'prod-1': { available: 7, reserved: 3 } })
    expect(await counts()).toEqual({ reservations: 1, ledger: 1, outbox: 1 })
  })
})

// ─── Idempotency guard 2: the reservation's own state ──────────────────────

dbDescribe('guard 2 — reservations.order_id PRIMARY KEY', () => {
  /**
   * The case guard 1 structurally CANNOT catch: a re-published order.created
   * for the same order carries a fresh eventId and looks unrelated to the
   * ledger. Without guard 2 the stock is reserved twice for one order.
   */
  it('does NOT reserve twice for a DIFFERENT eventId on an order already reserved', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const items = [line('prod-1', 4)]

    await handleOrderCreated(orderCreated('evt-a', 'ord-1', items), makeDeps().deps)
    await handleOrderCreated(orderCreated('evt-b', 'ord-1', items), makeDeps().deps)

    // One decrement only. A regression shows 2 available / 8 reserved.
    expect(await stock()).toEqual({ 'prod-1': { available: 6, reserved: 4 } })
    expect(await counts()).toEqual({ reservations: 1, ledger: 2, outbox: 1 })
    // The second event IS recorded as handled -- it was seen and decided upon.
    expect(await outcomes()).toEqual(['reserved', 'skipped:order-already-reserved'])
  })

  /** Same, but both events race: the PRIMARY KEY, not a read, picks the winner. */
  it('reserves once when two different eventIds for one order run concurrently', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const items = [line('prod-1', 4)]

    await Promise.all([
      handleOrderCreated(orderCreated('evt-a', 'ord-1', items), makeDeps().deps),
      handleOrderCreated(orderCreated('evt-b', 'ord-1', items), makeDeps().deps),
    ])

    expect(await stock()).toEqual({ 'prod-1': { available: 6, reserved: 4 } })
    expect(await counts()).toEqual({ reservations: 1, ledger: 2, outbox: 1 })
  })

  /**
   * A re-emitted order.created must not be misreported as insufficient just
   * because its own hold has since drained the shelf: the order is claimed
   * BEFORE the stock is looked at.
   */
  it('does not emit inventory.insufficient for an order that is already reserved', async () => {
    await seedStock([{ productId: 'prod-1', available: 4 }])
    const items = [line('prod-1', 4)]

    await handleOrderCreated(orderCreated('evt-a', 'ord-1', items), makeDeps().deps)
    // available is now 0, so a naive re-check would find the order "short".
    await handleOrderCreated(orderCreated('evt-b', 'ord-1', items), makeDeps().deps)

    expect((await outbox()).map((o) => o.event_type)).toEqual(['inventory.reserved'])
    expect(await outcomes()).toEqual(['reserved', 'skipped:order-already-reserved'])
  })

  /**
   * The mirror on the release side. handlers.ts calls double-crediting "the
   * most damaging failure mode this service has": it invents units that never
   * existed, and nothing downstream can tell the inflated number is wrong.
   */
  it('a second order.cancelled with a NEW eventId finds RELEASED and credits nothing', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    await handleOrderCreated(orderCreated('evt-a', 'ord-1', [line('prod-1', 4)]), makeDeps().deps)

    await handleOrderCancelled(orderCancelled('evt-c1', 'ord-1'), makeDeps().deps)
    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })

    await handleOrderCancelled(orderCancelled('evt-c2', 'ord-1'), makeDeps().deps)

    // Still 10, not 14. This is the assertion that matters.
    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    expect(await outcomes()).toEqual(['reserved', 'released', 'skipped:already-released'])
    // Only the first cancellation produced a release fact.
    expect((await outbox()).filter((o) => o.event_type === 'inventory.released')).toHaveLength(1)
  })

  /** Two cancellations racing: the status predicate lets exactly one credit. */
  it('credits stock once when two order.cancelled events run concurrently', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    await handleOrderCreated(orderCreated('evt-a', 'ord-1', [line('prod-1', 4)]), makeDeps().deps)

    await Promise.all([
      handleOrderCancelled(orderCancelled('evt-c1', 'ord-1'), makeDeps().deps),
      handleOrderCancelled(orderCancelled('evt-c2', 'ord-1'), makeDeps().deps),
    ])

    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    expect((await outbox()).filter((o) => o.event_type === 'inventory.released')).toHaveLength(1)
  })

  /** A cancellation for an order that never reserved is a no-op, not an error. */
  it('records skipped:no-reservation when the order never held stock', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])

    await handleOrderCancelled(orderCancelled('evt-c', 'ord-nope'), makeDeps().deps)

    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    expect(await outcomes()).toEqual(['skipped:no-reservation'])
    expect((await counts()).outbox).toBe(0)
  })
})

// ─── Concurrency across orders ─────────────────────────────────────────────

dbDescribe('race-safe stock movement', () => {
  /**
   * Two DIFFERENT orders contend for the last units. FOR UPDATE serialises
   * them: one reserves, the other sees the post-decrement stock and is told
   * it is short. A read-then-write implementation would pass both.
   */
  it('never oversells when two orders race for the same stock', async () => {
    await seedStock([{ productId: 'prod-1', available: 5 }])

    await Promise.all([
      handleOrderCreated(orderCreated('evt-a', 'ord-a', [line('prod-1', 4)]), makeDeps().deps),
      handleOrderCreated(orderCreated('evt-b', 'ord-b', [line('prod-1', 4)]), makeDeps().deps),
    ])

    expect(await stock()).toEqual({ 'prod-1': { available: 1, reserved: 4 } })
    expect((await outcomes()).slice().sort()).toEqual(['insufficient', 'reserved'])
    expect((await counts()).reservations).toBe(1)
  })

  /**
   * Overlapping lines in OPPOSITE order across two orders is the classic
   * deadlock recipe. Locking in product_id order makes both queue instead.
   */
  it('does not deadlock when two orders lock the same products in opposite orders', async () => {
    await seedStock([
      { productId: 'prod-1', available: 100 },
      { productId: 'prod-2', available: 100 },
    ])
    const batch = Array.from({ length: 6 }, (_, i) =>
      handleOrderCreated(
        orderCreated(
          `evt-${i}`,
          `ord-${i}`,
          i % 2 === 0
            ? [line('prod-1', 1), line('prod-2', 1)]
            : [line('prod-2', 1), line('prod-1', 1)]
        ),
        makeDeps().deps
      )
    )

    await Promise.all(batch)

    expect(await stock()).toEqual({
      'prod-1': { available: 94, reserved: 6 },
      'prod-2': { available: 94, reserved: 6 },
    })
  })
})

// ─── All-or-nothing ────────────────────────────────────────────────────────

dbDescribe('all-or-nothing reservation', () => {
  /**
   * A half-reserved order is not fulfillable, and the stock it holds starves
   * orders that ARE. One short line must therefore reserve nothing -- including
   * nothing for the lines that had plenty -- and leave an insufficient fact.
   */
  it('reserves NOTHING when one line of three is short, and queues inventory.insufficient', async () => {
    await seedStock([
      { productId: 'prod-1', available: 100 },
      { productId: 'prod-2', available: 1 },
      { productId: 'prod-3', available: 100 },
    ])
    const { deps, tryEnqueue } = makeDeps()

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [line('prod-1', 5), line('prod-2', 5), line('prod-3', 5)]),
      deps
    )

    expect(await stock()).toEqual({
      'prod-1': { available: 100, reserved: 0 },
      'prod-2': { available: 1, reserved: 0 },
      'prod-3': { available: 100, reserved: 0 },
    })
    expect(await counts()).toEqual({ reservations: 0, ledger: 1, outbox: 1 })
    expect(await outcomes()).toEqual(['insufficient'])
    expect(tryEnqueue).not.toHaveBeenCalled()

    // Only the SHORT product is reported: the satisfiable ones had nothing
    // happen to them, so a row on their partitions would be a movement that
    // never occurred.
    const [row] = await outbox()
    expect(row?.event_type).toBe('inventory.insufficient')
    expect(row?.partition_key).toBe('prod-2')
    expect(row?.envelope.payload.shortfalls).toEqual([
      { productId: 'prod-2', sku: 'SKU-prod-2', requested: 5, available: 1 },
    ])
  })

  /**
   * An unknown product is a shortfall of the whole quantity, not a crash:
   * ms-inventory does not own the catalogue, so its seed can legitimately not
   * cover a product ms-order sold.
   */
  it('treats an unknown productId as a shortfall of the full quantity', async () => {
    await seedStock([{ productId: 'prod-1', available: 100 }])

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [line('prod-1', 5), line('ghost', 2)]),
      makeDeps().deps
    )

    const [row] = await outbox()
    expect(row?.envelope.payload.shortfalls).toEqual([
      { productId: 'ghost', sku: 'SKU-ghost', requested: 2, available: 0 },
    ])
    // No row was created for the ghost product -- inventing one would assert a
    // stock level this service has no authority to know.
    expect(await stock()).toEqual({ 'prod-1': { available: 100, reserved: 0 } })
  })

  /** Exactly-enough stock is enough: the check is `<`, not `<=`. */
  it('reserves when available exactly equals the requested quantity', async () => {
    await seedStock([{ productId: 'prod-1', available: 5 }])

    await handleOrderCreated(orderCreated('evt-1', 'ord-1', [line('prod-1', 5)]), makeDeps().deps)

    expect(await stock()).toEqual({ 'prod-1': { available: 0, reserved: 5 } })
    expect(await outcomes()).toEqual(['reserved'])
  })

  /** The expiry timer is scheduled after commit, once, with the order's identity. */
  it('schedules the expiry job after a successful reservation', async () => {
    await seedStock([{ productId: 'prod-1', available: 5 }])
    const { deps, tryEnqueue } = makeDeps()

    await handleOrderCreated(orderCreated('evt-1', 'ord-1', [line('prod-1', 1)]), deps)

    expect(tryEnqueue).toHaveBeenCalledTimes(1)
    expect(tryEnqueue.mock.calls[0]?.[0]).toBe('release-expired-reservation')
    expect(
      (deps.queueManager as unknown as { enqueueReleaseExpired: jest.Mock }).enqueueReleaseExpired
    ).toHaveBeenCalledWith({ orderId: 'ord-1', orderNumber: 'ORD-ord-1', eventId: 'evt-1' })
  })
})

// ─── Release ───────────────────────────────────────────────────────────────

dbDescribe('release', () => {
  /**
   * `reserved` is clamped at 0. It can only sit below the held quantity because
   * of an external edit, and a negative reserved count is a fabricated number
   * (and would violate the CHECK, failing the whole release).
   */
  it('clamps reserved at 0 rather than going negative', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    await handleOrderCreated(orderCreated('evt-a', 'ord-1', [line('prod-1', 5)]), makeDeps().deps)
    // The skew an external edit produces: only 2 left reserved, reservation says 5.
    await store.db.query(`UPDATE ${TEST_SCHEMA}.inventory SET reserved = 2`)

    await handleOrderCancelled(orderCancelled('evt-c', 'ord-1'), makeDeps().deps)

    // `available` is credited the full held quantity -- the number the
    // reservation says was taken out of it.
    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
  })

  /**
   * A product row that vanished between reserve and release is skipped.
   * Recreating it would invent a stock level out of an event that only knows
   * how many units to give BACK.
   */
  it('skips a product row that vanished, still credits the others, and flips the reservation', async () => {
    await seedStock([
      { productId: 'prod-1', available: 10 },
      { productId: 'gone', available: 10 },
    ])
    await handleOrderCreated(
      orderCreated('evt-a', 'ord-1', [line('prod-1', 5), line('gone', 3)]),
      makeDeps().deps
    )
    await store.db.query(`DELETE FROM ${TEST_SCHEMA}.inventory WHERE product_id = 'gone'`)

    await handleOrderCancelled(orderCancelled('evt-c', 'ord-1'), makeDeps().deps)

    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    const [reservation] = await listReservations(store)
    expect(reservation?.status).toBe('RELEASED')
    expect(reservation?.releasedAt).not.toBeNull()
  })

  it('queues one inventory.released row per product, carrying the reason', async () => {
    await seedStock([
      { productId: 'prod-1', available: 10 },
      { productId: 'prod-2', available: 10 },
    ])
    await handleOrderCreated(
      orderCreated('evt-a', 'ord-1', [line('prod-1', 1), line('prod-2', 2)]),
      makeDeps().deps
    )

    await handleOrderCancelled(
      orderCancelled('evt-c', 'ord-1', 'customer-request'),
      makeDeps().deps
    )

    const released = (await outbox()).filter((o) => o.event_type === 'inventory.released')
    expect(released.map((r) => r.partition_key).sort()).toEqual(['prod-1', 'prod-2'])
    expect(released.every((r) => r.envelope.payload.reason === 'customer-request')).toBe(true)
  })
})

// ─── Reconciliation worker ─────────────────────────────────────────────────

dbDescribe('reservation-expiry reconciliation worker', () => {
  const job = (orderId: string) =>
    ({
      name: 'release-expired-reservation',
      data: { orderId, orderNumber: `ORD-${orderId}`, eventId: 'evt-a' },
    }) as never

  it('releases a stale hold once, then reports already-released', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    await handleOrderCreated(orderCreated('evt-a', 'ord-1', [line('prod-1', 4)]), makeDeps().deps)
    const process = makeReconciliationProcessor(store)

    expect(await process(job('ord-1'))).toMatchObject({ outcome: 'released', items: 1 })
    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })

    expect(await process(job('ord-1'))).toMatchObject({
      outcome: 'skipped',
      reason: 'already-released',
    })
    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    expect((await outbox()).filter((o) => o.event_type === 'inventory.released')).toHaveLength(1)
  })

  it('skips an order with no reservation', async () => {
    const process = makeReconciliationProcessor(store)
    expect(await process(job('ord-nope'))).toMatchObject({
      outcome: 'skipped',
      reason: 'reservation-not-found',
    })
  })
})

// ─── Malformed payloads ────────────────────────────────────────────────────

dbDescribe('malformed payloads', () => {
  /**
   * A payload no retry could ever fix is recorded as handled, so it is not
   * re-logged on every redelivery forever -- but no stock moves. The record is
   * what stops a poison message from becoming permanent log noise.
   */
  it.each([
    ['a null payload', null],
    ['orderId missing', { orderNumber: 'ORD-1', items: [] }],
    ['orderId not a string', { orderId: 42, items: [] }],
    ['items not an array', { orderId: 'ord-1', items: 'nope' }],
    ['items missing entirely', { orderId: 'ord-1' }],
    ['a fractional quantity', { orderId: 'ord-1', items: [line('prod-1', 1.5)] }],
    ['a zero quantity', { orderId: 'ord-1', items: [line('prod-1', 0)] }],
    ['a negative quantity', { orderId: 'ord-1', items: [line('prod-1', -3)] }],
    ['an item without a productId', { orderId: 'ord-1', items: [{ quantity: 1 }] }],
  ])('order.created with %s is recorded as handled and moves no stock', async (_label, payload) => {
    await seedStock([{ productId: 'prod-1', available: 10 }])
    const envelope = orderCreated('evt-bad', 'ord-1', [])
    ;(envelope as { payload: unknown }).payload = payload

    await handleOrderCreated(envelope, makeDeps().deps)

    expect(await outcomes()).toEqual(['rejected:malformed-payload'])
    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    expect(await counts()).toEqual({ reservations: 0, ledger: 1, outbox: 0 })
  })

  it.each([
    ['a null payload', null],
    ['orderId missing', { reason: 'x' }],
    ['orderId not a string', { orderId: { nested: true } }],
  ])(
    'order.cancelled with %s is recorded as handled and credits no stock',
    async (_label, payload) => {
      await seedStock([{ productId: 'prod-1', available: 10, reserved: 5 }])
      const envelope = orderCancelled('evt-bad', 'ord-1')
      ;(envelope as { payload: unknown }).payload = payload

      await handleOrderCancelled(envelope, makeDeps().deps)

      expect(await outcomes()).toEqual(['rejected:malformed-payload'])
      expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 5 } })
      expect((await counts()).outbox).toBe(0)
    }
  )

  /**
   * An empty item list is NOT malformed -- it is a well-formed order with
   * nothing in it. It reserves (vacuously) rather than being rejected, which
   * keeps the "rejected" outcome meaning what it says.
   */
  it('an empty items array is a valid order, not a malformed one', async () => {
    await seedStock([{ productId: 'prod-1', available: 10 }])

    await handleOrderCreated(orderCreated('evt-1', 'ord-1', []), makeDeps().deps)

    expect(await outcomes()).toEqual(['reserved'])
    expect(await stock()).toEqual({ 'prod-1': { available: 10, reserved: 0 } })
    expect((await counts()).reservations).toBe(1)
  })
})
