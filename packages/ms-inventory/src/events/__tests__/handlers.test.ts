import type { EventEnvelope } from '@ecommerce/shared-messaging'
import type { DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import type { InventoryDoc, ProcessedEventDoc, ReservationDoc } from '../../types'
import type { QueueManager } from '../../queues'

// The publishers reach for the module-level EventProducer, which reads
// KAFKA_ENABLED at import time. Mocked out entirely: these tests are about the
// stock arithmetic, not kafkajs, and a real producer would make the suite
// depend on the ambient environment.
jest.mock('../publishers', () => ({
  publishInventoryReserved: jest.fn(async () => ({ attempted: 0, published: 0 })),
  publishInventoryReleased: jest.fn(async () => ({ attempted: 0, published: 0 })),
  publishInventoryInsufficient: jest.fn(async () => ({ attempted: 0, published: 0 })),
}))

import {
  handleOrderCancelled,
  handleOrderCreated,
  releaseReservation,
  type HandlerDeps,
} from '../handlers'
import {
  publishInventoryInsufficient,
  publishInventoryReleased,
  publishInventoryReserved,
} from '../publishers'

/**
 * Unit tests for ms-inventory's stock-movement handlers.
 *
 * These pin the invariants named in handlers.ts's own docblock — the ones
 * whose failure corrupts stock SILENTLY, producing a number that is wrong but
 * entirely plausible. Nothing here touches NeDB, Kafka or Redis: the three
 * document stores are replaced by in-memory arrays with the same
 * DocumentDatabaseAdapter surface, so a regression in the domain logic is the
 * only thing that can fail a test here.
 */

// ─── In-memory stand-in for DocumentDatabaseAdapter ────────────────────────

type Fake<T> = DocumentDatabaseAdapter<T> & {
  docs: T[]
  updates: { query: Record<string, unknown>; doc: Partial<T> }[]
}

/**
 * A store with real query semantics for the flat equality matches the handlers
 * actually issue ({ productId }, { orderId }, { eventId }). Deliberately NOT a
 * jest.fn() returning canned values: the handlers read back what they wrote,
 * so a stub that could not do that would let a double-decrement pass unnoticed.
 */
function makeStore<T extends object>(seed: T[] = []): Fake<T> {
  const docs: T[] = seed.map((d) => ({ ...d }))
  const updates: { query: Record<string, unknown>; doc: Partial<T> }[] = []

  const matches = (doc: T, query: Record<string, unknown>): boolean =>
    Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v)

  return {
    docs,
    updates,
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
      // Every update is recorded, so a test can assert that NO write happened
      // at all — which is the actual claim behind "all-or-nothing".
      updates.push({ query, doc: updateDoc })
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

function inventoryRow(productId: string, available: number, reserved = 0): InventoryDoc {
  return {
    productId,
    sku: `SKU-${productId}`,
    available,
    reserved,
    updatedAt: '2026-09-23T00:00:00.000Z',
  }
}

function orderCreated(
  eventId: string,
  orderId: string,
  items: { productId: string; sku: string; quantity: number }[]
): EventEnvelope {
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

function orderCancelled(
  eventId: string,
  orderId: string,
  reason = 'user-cancelled'
): EventEnvelope {
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

interface Harness {
  deps: HandlerDeps
  inventory: Fake<InventoryDoc>
  reservations: Fake<ReservationDoc>
  processed: Fake<ProcessedEventDoc>
}

function harness(rows: InventoryDoc[] = [], reservations: ReservationDoc[] = []): Harness {
  const inventory = makeStore<InventoryDoc>(rows)
  const reservationsStore = makeStore<ReservationDoc>(reservations)
  const processed = makeStore<ProcessedEventDoc>([])

  // tryEnqueue is the only QueueManager surface the handler touches. It is
  // invoked for its side effect and its result is ignored by the handler.
  const queueManager = {
    tryEnqueue: jest.fn(async (_name: string, run: () => Promise<unknown>) => {
      await run()
      return undefined
    }),
    enqueueReleaseExpired: jest.fn(async () => 'job-1'),
  } as unknown as QueueManager

  return {
    inventory,
    reservations: reservationsStore,
    processed,
    deps: {
      inventoryStore: inventory,
      reservationsStore,
      processedEventsStore: processed,
      queueManager,
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── collapseItems ─────────────────────────────────────────────────────────

describe('collapseItems (exercised through handleOrderCreated)', () => {
  /**
   * The exact scenario handlers.ts names: two lines of 8 against a stock of 10.
   * Checked line-by-line each passes independently, 16 units get decremented
   * and the row lands at -6. Summing first is what makes the availability
   * check mean what it says.
   *
   * A regression here does not throw — it silently produces negative stock
   * that every later reservation then reads as "plenty available".
   */
  it('SUMS two lines naming the same productId before the availability check', async () => {
    const h = harness([inventoryRow('prod-1', 10)])

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 8 },
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 8 },
      ]),
      h.deps
    )

    // 16 > 10, so the whole order is short and NOTHING moves.
    expect(h.inventory.updates).toHaveLength(0)
    expect(h.inventory.docs[0]?.available).toBe(10)
    expect(h.inventory.docs[0]?.reserved).toBe(0)
    expect(h.processed.docs[0]?.outcome).toBe('insufficient')
    expect(h.reservations.docs).toHaveLength(0)
  })

  /**
   * The shortfall is reported ONCE, for the summed quantity — not once per
   * line. A per-line shortfall would tell a consumer the order wanted 8 when
   * it actually wanted 16.
   */
  it('reports a single summed shortfall, not one per duplicate line', async () => {
    const h = harness([inventoryRow('prod-1', 10)])

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 8 },
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 8 },
      ]),
      h.deps
    )

    expect(publishInventoryInsufficient).toHaveBeenCalledTimes(1)
    const payload = (publishInventoryInsufficient as jest.Mock).mock.calls[0]?.[0]
    expect(payload.shortfalls).toEqual([
      { productId: 'prod-1', sku: 'SKU-prod-1', requested: 16, available: 10 },
    ])
  })

  /** The collapsed quantity is what gets decremented, and it is decremented ONCE. */
  it('decrements the SUMMED quantity exactly once when stock does cover it', async () => {
    const h = harness([inventoryRow('prod-1', 20)])

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 8 },
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 8 },
      ]),
      h.deps
    )

    expect(h.inventory.updates).toHaveLength(1)
    expect(h.inventory.docs[0]?.available).toBe(4)
    expect(h.inventory.docs[0]?.reserved).toBe(16)
    // The reservation stores the COLLAPSED line, so a later release credits
    // back 16 rather than crediting one 8 and losing the other.
    expect(h.reservations.docs[0]?.items).toEqual([
      { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 16 },
    ])
  })
})

// ─── Idempotency guard 1: the event ledger ─────────────────────────────────

describe('guard 1 — the processed_events ledger', () => {
  /**
   * The literal Kafka redelivery: the SAME eventId arriving twice. If this
   * regresses, every consumer-group rebalance double-decrements stock.
   */
  it('skips a duplicate eventId and writes nothing at all', async () => {
    const h = harness([inventoryRow('prod-1', 10)])
    const envelope = orderCreated('evt-dup', 'ord-1', [
      { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 3 },
    ])

    await handleOrderCreated(envelope, h.deps)
    const updatesAfterFirst = h.inventory.updates.length

    await handleOrderCreated(envelope, h.deps)

    expect(h.inventory.updates).toHaveLength(updatesAfterFirst)
    expect(h.inventory.docs[0]?.available).toBe(7)
    expect(h.inventory.docs[0]?.reserved).toBe(3)
    // The ledger keeps exactly one row — the duplicate is not re-recorded.
    expect(h.processed.docs).toHaveLength(1)
    expect(h.reservations.docs).toHaveLength(1)
  })
})

// ─── Idempotency guard 2: the reservation's own state ──────────────────────

describe('guard 2 — the reservation state, keyed on orderId', () => {
  /**
   * The case guard 1 structurally CANNOT catch: makeEnvelope mints a fresh
   * eventId per publish, so a re-published order.created for the same order
   * looks like an unrelated event to the ledger. Without guard 2 the stock is
   * reserved twice for one order.
   */
  it('does NOT reserve twice for a DIFFERENT eventId on an order already reserved', async () => {
    const h = harness([inventoryRow('prod-1', 10)])
    const items = [{ productId: 'prod-1', sku: 'SKU-prod-1', quantity: 4 }]

    await handleOrderCreated(orderCreated('evt-a', 'ord-1', items), h.deps)
    await handleOrderCreated(orderCreated('evt-b', 'ord-1', items), h.deps)

    // One decrement only. A regression shows 2 available / 8 reserved.
    expect(h.inventory.docs[0]?.available).toBe(6)
    expect(h.inventory.docs[0]?.reserved).toBe(4)
    expect(h.inventory.updates).toHaveLength(1)
    expect(h.reservations.docs).toHaveLength(1)

    // The second event IS recorded as handled — it was seen and decided upon,
    // so a further redelivery of evt-b is caught by the cheaper guard 1.
    expect(h.processed.docs.map((d) => d.outcome)).toEqual([
      'reserved',
      'skipped:order-already-reserved',
    ])
  })

  /**
   * The mirror on the release side. handlers.ts calls double-crediting "the
   * most damaging failure mode this service has": it invents units that never
   * existed, and nothing downstream can tell the inflated number is wrong.
   */
  it('a second order.cancelled with a NEW eventId finds RELEASED and credits nothing', async () => {
    const h = harness([inventoryRow('prod-1', 10)])
    await handleOrderCreated(
      orderCreated('evt-a', 'ord-1', [{ productId: 'prod-1', sku: 'SKU-prod-1', quantity: 4 }]),
      h.deps
    )

    await handleOrderCancelled(orderCancelled('evt-c1', 'ord-1'), h.deps)
    expect(h.inventory.docs[0]?.available).toBe(10)
    expect(h.inventory.docs[0]?.reserved).toBe(0)

    await handleOrderCancelled(orderCancelled('evt-c2', 'ord-1'), h.deps)

    // Still 10, not 14. This is the assertion that matters.
    expect(h.inventory.docs[0]?.available).toBe(10)
    expect(h.inventory.docs[0]?.reserved).toBe(0)
    expect(h.processed.docs.map((d) => d.outcome)).toEqual([
      'reserved',
      'released',
      'skipped:already-released',
    ])
    // Only the first cancellation published a release fact.
    expect(publishInventoryReleased).toHaveBeenCalledTimes(1)
  })

  /** A cancellation for an order that never reserved is a no-op, not an error. */
  it('records skipped:no-reservation when the order never held stock', async () => {
    const h = harness([inventoryRow('prod-1', 10)])

    await handleOrderCancelled(orderCancelled('evt-c', 'ord-nope'), h.deps)

    expect(h.inventory.updates).toHaveLength(0)
    expect(h.processed.docs[0]?.outcome).toBe('skipped:no-reservation')
    expect(publishInventoryReleased).not.toHaveBeenCalled()
  })
})

// ─── All-or-nothing ────────────────────────────────────────────────────────

describe('all-or-nothing reservation', () => {
  /**
   * A half-reserved order is not fulfillable, and the stock it holds starves
   * orders that ARE. One short line must therefore reserve nothing — including
   * nothing for the lines that had plenty.
   */
  it('reserves NOTHING when one line of three is short', async () => {
    const h = harness([
      inventoryRow('prod-1', 100),
      inventoryRow('prod-2', 1),
      inventoryRow('prod-3', 100),
    ])

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 5 },
        { productId: 'prod-2', sku: 'SKU-prod-2', quantity: 5 },
        { productId: 'prod-3', sku: 'SKU-prod-3', quantity: 5 },
      ]),
      h.deps
    )

    // No inventory row was decremented — not even the two that could satisfy.
    expect(h.inventory.updates).toHaveLength(0)
    expect(h.inventory.docs.map((d) => d.available)).toEqual([100, 1, 100])
    expect(h.inventory.docs.every((d) => d.reserved === 0)).toBe(true)
    expect(h.reservations.docs).toHaveLength(0)
    expect(publishInventoryReserved).not.toHaveBeenCalled()
  })

  /**
   * Only the SHORT products are reported. Publishing the satisfied ones would
   * put a movement on their partitions that never happened — see publishers.ts.
   */
  it('reports only the short line, not the lines that were satisfiable', async () => {
    const h = harness([inventoryRow('prod-1', 100), inventoryRow('prod-2', 1)])

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 5 },
        { productId: 'prod-2', sku: 'SKU-prod-2', quantity: 5 },
      ]),
      h.deps
    )

    const payload = (publishInventoryInsufficient as jest.Mock).mock.calls[0]?.[0]
    expect(payload.shortfalls).toEqual([
      { productId: 'prod-2', sku: 'SKU-prod-2', requested: 5, available: 1 },
    ])
  })

  /**
   * An unknown product is a shortfall of the whole quantity, not a crash:
   * ms-inventory does not own the catalogue, so its seed can legitimately not
   * cover a product ms-order sold.
   */
  it('treats an unknown productId as a shortfall of the full quantity', async () => {
    const h = harness([inventoryRow('prod-1', 100)])

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 5 },
        { productId: 'ghost', sku: 'SKU-ghost', quantity: 2 },
      ]),
      h.deps
    )

    const payload = (publishInventoryInsufficient as jest.Mock).mock.calls[0]?.[0]
    expect(payload.shortfalls).toEqual([
      { productId: 'ghost', sku: 'SKU-ghost', requested: 2, available: 0 },
    ])
    // No row was created for the ghost product — inventing one would assert a
    // stock level this service has no authority to know.
    expect(h.inventory.docs).toHaveLength(1)
    expect(h.inventory.updates).toHaveLength(0)
  })

  /** Exactly-enough stock is enough: the check is `<`, not `<=`. */
  it('reserves when available exactly equals the requested quantity', async () => {
    const h = harness([inventoryRow('prod-1', 5)])

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [{ productId: 'prod-1', sku: 'SKU-prod-1', quantity: 5 }]),
      h.deps
    )

    expect(h.inventory.docs[0]?.available).toBe(0)
    expect(h.inventory.docs[0]?.reserved).toBe(5)
    expect(h.processed.docs[0]?.outcome).toBe('reserved')
  })
})

// ─── releaseReservation ────────────────────────────────────────────────────

describe('releaseReservation', () => {
  const reservation: ReservationDoc = {
    orderId: 'ord-1',
    orderNumber: 'ORD-ord-1',
    eventId: 'evt-1',
    items: [{ productId: 'prod-1', sku: 'SKU-prod-1', quantity: 5 }],
    status: 'RESERVED',
    createdAt: '2026-09-23T04:00:00.000Z',
    releasedAt: null,
  }

  /**
   * `reserved` is clamped at 0. It can only sit below the held quantity
   * because of an external edit, and a negative reserved count is a fabricated
   * number that every later subtraction would compound.
   */
  it('clamps reserved at 0 rather than going negative', async () => {
    // The row holds only 2 reserved but the reservation claims 5 — the skew an
    // external edit produces.
    const inventory = makeStore<InventoryDoc>([inventoryRow('prod-1', 10, 2)])
    const reservations = makeStore<ReservationDoc>([reservation])

    await releaseReservation(
      { inventoryStore: inventory, reservationsStore: reservations },
      reservation,
      'test'
    )

    expect(inventory.docs[0]?.reserved).toBe(0)
    // `available` is NOT clamped — it is credited the full held quantity,
    // because that is the number the reservation says was taken out of it.
    expect(inventory.docs[0]?.available).toBe(15)
  })

  /**
   * A product row that vanished between reserve and release is skipped.
   * Recreating it would invent a stock level out of an event that only knows
   * how many units to give BACK, not how many existed.
   */
  it('skips a product row that vanished, rather than recreating it', async () => {
    const inventory = makeStore<InventoryDoc>([])
    const reservations = makeStore<ReservationDoc>([reservation])

    await releaseReservation(
      { inventoryStore: inventory, reservationsStore: reservations },
      reservation,
      'test'
    )

    expect(inventory.docs).toHaveLength(0)
    expect(inventory.updates).toHaveLength(0)
    // The reservation is still flipped to RELEASED: the hold is gone either
    // way, and leaving it RESERVED would keep it eligible for release forever.
    expect(reservations.docs[0]?.status).toBe('RELEASED')
    expect(reservations.docs[0]?.releasedAt).not.toBeNull()
  })

  /** Only the vanished line is skipped; the surviving lines are still credited. */
  it('credits the surviving lines when only one product row vanished', async () => {
    const multi: ReservationDoc = {
      ...reservation,
      items: [
        { productId: 'prod-1', sku: 'SKU-prod-1', quantity: 5 },
        { productId: 'gone', sku: 'SKU-gone', quantity: 3 },
      ],
    }
    const inventory = makeStore<InventoryDoc>([inventoryRow('prod-1', 0, 5)])
    const reservations = makeStore<ReservationDoc>([multi])

    await releaseReservation(
      { inventoryStore: inventory, reservationsStore: reservations },
      multi,
      'test'
    )

    expect(inventory.docs).toHaveLength(1)
    expect(inventory.docs[0]?.available).toBe(5)
    expect(inventory.docs[0]?.reserved).toBe(0)
  })
})

// ─── Malformed payloads ────────────────────────────────────────────────────

describe('malformed payloads', () => {
  /**
   * A payload no retry could ever fix is recorded as handled, so it is not
   * re-logged on every redelivery forever — but no stock moves. The record is
   * what stops a poison message from becoming permanent log noise.
   */
  it.each([
    ['a null payload', null],
    ['orderId missing', { orderNumber: 'ORD-1', items: [] }],
    ['orderId not a string', { orderId: 42, items: [] }],
    ['items not an array', { orderId: 'ord-1', items: 'nope' }],
    ['items missing entirely', { orderId: 'ord-1' }],
  ])('order.created with %s is recorded as handled and moves no stock', async (_label, payload) => {
    const h = harness([inventoryRow('prod-1', 10)])
    const envelope = orderCreated('evt-bad', 'ord-1', [])
    ;(envelope as { payload: unknown }).payload = payload

    await handleOrderCreated(envelope, h.deps)

    expect(h.processed.docs).toHaveLength(1)
    expect(h.processed.docs[0]?.outcome).toBe('rejected:malformed-payload')
    expect(h.inventory.updates).toHaveLength(0)
    expect(h.inventory.docs[0]?.available).toBe(10)
    expect(h.reservations.docs).toHaveLength(0)
    expect(publishInventoryReserved).not.toHaveBeenCalled()
    expect(publishInventoryInsufficient).not.toHaveBeenCalled()
  })

  it.each([
    ['a null payload', null],
    ['orderId missing', { reason: 'x' }],
    ['orderId not a string', { orderId: { nested: true } }],
  ])(
    'order.cancelled with %s is recorded as handled and credits no stock',
    async (_label, payload) => {
      const h = harness([inventoryRow('prod-1', 10, 5)])
      const envelope = orderCancelled('evt-bad', 'ord-1')
      ;(envelope as { payload: unknown }).payload = payload

      await handleOrderCancelled(envelope, h.deps)

      expect(h.processed.docs[0]?.outcome).toBe('rejected:malformed-payload')
      expect(h.inventory.updates).toHaveLength(0)
      expect(h.inventory.docs[0]?.available).toBe(10)
      expect(h.inventory.docs[0]?.reserved).toBe(5)
      expect(publishInventoryReleased).not.toHaveBeenCalled()
    }
  )

  /**
   * An empty item list is NOT malformed — it is a well-formed order with
   * nothing in it. It reserves (vacuously) rather than being rejected, which
   * keeps the "rejected" outcome meaning what it says.
   */
  it('an empty items array is a valid order, not a malformed one', async () => {
    const h = harness([inventoryRow('prod-1', 10)])

    await handleOrderCreated(orderCreated('evt-1', 'ord-1', []), h.deps)

    expect(h.processed.docs[0]?.outcome).toBe('reserved')
    expect(h.inventory.updates).toHaveLength(0)
    expect(h.reservations.docs).toHaveLength(1)
  })
})

// ─── Ledger write ordering ─────────────────────────────────────────────────

describe('write ordering', () => {
  /**
   * The ledger is written LAST on the reserve path. NeDB has no
   * cross-collection transaction, so a crash between the stock write and the
   * ledger write must leave the event UNRECORDED — it then gets redelivered
   * and guard 2 catches it. The opposite order would mark an event handled
   * whose stock movement never happened, and nothing would ever retry it.
   */
  it('inserts the reservation before recording the event as processed', async () => {
    const h = harness([inventoryRow('prod-1', 10)])
    const order: string[] = []

    const originalReservationInsert = h.reservations.insert.bind(h.reservations)
    h.reservations.insert = async (doc) => {
      order.push('reservation')
      return originalReservationInsert(doc)
    }
    const originalProcessedInsert = h.processed.insert.bind(h.processed)
    h.processed.insert = async (doc) => {
      order.push('ledger')
      return originalProcessedInsert(doc)
    }

    await handleOrderCreated(
      orderCreated('evt-1', 'ord-1', [{ productId: 'prod-1', sku: 'SKU-prod-1', quantity: 1 }]),
      h.deps
    )

    expect(order).toEqual(['reservation', 'ledger'])
  })
})
