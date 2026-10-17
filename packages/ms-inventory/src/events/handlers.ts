import {
  validatePayload,
  type EventEnvelope,
  type OrderCancelledPayload,
  type OrderCreatedPayload,
} from '@ecommerce/shared-messaging'
import {
  claimEvent,
  creditStock,
  deleteReservation,
  getReservationState,
  insertReservation,
  lockStock,
  markReleased,
  reserveStock,
  setOutcome,
  type InventoryStore,
  type Tx,
} from '../db/store'
import type { ReservationItem } from '../types'
import type { QueueManager } from '../queues'
import {
  enqueueInventoryInsufficient,
  enqueueInventoryReleased,
  enqueueInventoryReserved,
} from './publishers'
import { LOG_PREFIX } from './producer'

/**
 * The stock-movement handlers behind ms-inventory's Kafka consumer.
 *
 * ── One transaction per event ───────────────────────────────────────────────
 * Each handler runs in a SINGLE Postgres transaction that contains, together:
 *
 *   - the processed_events ledger row,
 *   - the stock movement (inventory rows),
 *   - the reservation row,
 *   - the inventory.* outbox rows describing what happened.
 *
 * They commit or roll back as one. There is no longer an ordering to get right
 * and no window in which a crash leaves the ledger and the stock disagreeing:
 * if anything throws, the whole event never happened, Kafka redelivers it, and
 * the retry starts from a clean slate. (The NeDB version had to write the
 * ledger LAST because it had no cross-collection transaction, and relied on
 * guard 2 to make the resulting redelivery safe. That workaround is retired.)
 *
 * The inventory.reserved / .insufficient / .released facts are outbox rows in
 * the same transaction, NOT publishes after commit. The OutboxRelay delivers
 * them to Kafka later, at-least-once, with the eventId minted at insert time.
 * See events/publishers.ts.
 *
 * ── TWO idempotency guards, and why one is not enough ───────────────────────
 * Kafka redelivers: on rebalance, on restart, and any time an offset was not
 * committed. A handler WILL see the same message more than once. Both guards
 * below are load-bearing and neither subsumes the other.
 *
 *   1. THE EVENT LEDGER (`processed_events`, keyed on envelope.eventId).
 *      Catches the literal redelivery: the same published message arriving
 *      twice. It is the transaction's FIRST statement,
 *      `INSERT ... ON CONFLICT (event_id) DO NOTHING`; rowCount 0 means a
 *      duplicate, so the transaction commits having done nothing else. Two
 *      concurrent deliveries of one eventId serialise on the primary-key row:
 *      the second blocks until the first commits, then sees the conflict.
 *
 *   2. THE RESERVATION'S OWN STATE (`reservations.order_id` PRIMARY KEY).
 *      Catches what the ledger cannot: two DIFFERENT eventIds describing the
 *      same order, e.g. an operator re-emitting a lost order.created or a
 *      replay tool. Those carry fresh eventIds, so guard 1 sees them as
 *      unrelated and would happily reserve the same order's stock twice. Guard
 *      2 makes "reserve for order X" converge on ONE reservation regardless of
 *      how many events describe it, and it is a constraint rather than a
 *      read-then-check, so two concurrent events for one order cannot both
 *      pass it: the reserve path is `INSERT ... ON CONFLICT DO NOTHING` and a
 *      rowCount of 0 means someone else already owns the order.
 *
 *      The mirror image holds for release: `UPDATE ... WHERE status =
 *      'RESERVED'` is the guard, so a second order.cancelled matches nothing
 *      and credits nothing. Crediting twice would invent units that never
 *      existed -- the most damaging failure mode this service has.
 *
 * ── Race-safe stock movement ────────────────────────────────────────────────
 * The order's product rows are read in ONE batched query,
 * `WHERE product_id = ANY($1) ORDER BY product_id FOR UPDATE`, inside the
 * transaction. FOR UPDATE means no other order can change those rows between
 * the availability check and the decrement; ORDER BY product_id means every
 * transaction locks overlapping rows in the same order, so two orders cannot
 * deadlock each other. The CHECK (available >= 0) constraints are the backstop
 * should a bug ever skip the check: the transaction fails and rolls back whole.
 *
 * ── What stays outside the transaction ──────────────────────────────────────
 * The BullMQ expiry job is enqueued AFTER commit and stays best-effort, as
 * before: Redis is not part of the Postgres transaction and must not be able to
 * fail (or hold open) a stock movement. If the process dies between COMMIT and
 * the enqueue, or Redis is down, the reservation simply has no expiry timer
 * and is released by an explicit order.cancelled. A redelivery cannot repair
 * that -- it is a duplicate by then -- which is the documented cost of keeping
 * Redis out of the transaction.
 *
 * ── Why these handlers do the work inline rather than enqueueing it ─────────
 * The consumer's docblock notes that work which must not be dropped should
 * enqueue a BullMQ job as its first action. A stock reservation is a small,
 * local, transactional write with no external dependency — there is nothing a
 * retry could fix that a redelivery would not. The queue here is used for the
 * thing that genuinely needs a timer instead: expiring a stale hold.
 */

export interface HandlerDeps {
  store: InventoryStore
  queueManager: QueueManager
}

/** Largest value the `int` columns hold; one line above it is short by definition. */
const INT_MAX = 2_147_483_647

/**
 * Normalises the line items an order event carries.
 *
 * Several lines can name the same productId (a client that adds the same item
 * twice rather than incrementing a quantity). Summing them first is what makes
 * the availability check below correct: checking each line independently
 * against the same `available` would pass two lines of 8 against a stock of
 * 10, then decrement 16 and drive the row negative.
 */
function collapseItems(
  items: readonly { productId: string; sku: string; quantity: number }[]
): ReservationItem[] {
  const merged = new Map<string, ReservationItem>()
  for (const item of items) {
    const existing = merged.get(item.productId)
    if (existing) {
      existing.quantity += item.quantity
    } else {
      merged.set(item.productId, {
        productId: item.productId,
        sku: item.sku,
        quantity: item.quantity,
      })
    }
  }
  return [...merged.values()]
}

/**
 * True when every line can be stored and applied.
 *
 * A line that is not a positive whole number of units, or has no productId,
 * could never succeed -- the quantity column is an int, and a negative one would
 * credit stock through the reserve path -- and a poison message that throws is
 * redelivered forever. It is therefore classified as malformed and recorded,
 * exactly like a payload with no orderId.
 */
function hasUsableItems(items: unknown[]): boolean {
  return items.every((raw) => {
    const item = raw as Partial<ReservationItem> | null
    return (
      item !== null &&
      typeof item === 'object' &&
      typeof item.productId === 'string' &&
      item.productId.length > 0 &&
      Number.isInteger(item.quantity) &&
      (item.quantity as number) > 0 &&
      (item.quantity as number) <= INT_MAX
    )
  })
}

type CreatedResult =
  | { kind: 'duplicate' }
  | { kind: 'rejected' }
  | { kind: 'skipped'; status: string; eventId: string }
  | { kind: 'insufficient'; detail: string }
  | { kind: 'reserved'; items: ReservationItem[]; enqueued: number }

/**
 * order.created → reserve stock, all-or-nothing.
 *
 * The all-or-nothing rule is a domain decision, not a technical one: a
 * half-reserved order is not a fulfillable order, and holding stock for it
 * starves orders that COULD be fulfilled. So the availability of every line is
 * checked before any line is decremented, and a single short line reserves
 * nothing at all.
 */
export async function handleOrderCreated(
  envelope: EventEnvelope,
  deps: HandlerDeps
): Promise<void> {
  const { store, queueManager } = deps
  const payload = envelope.payload as OrderCreatedPayload

  const result = await store.transaction(async (tx): Promise<CreatedResult> => {
    // Guard 1 -- first statement, see the docblock above.
    if (!(await claimEvent(tx, envelope.eventId, envelope.eventType))) {
      return { kind: 'duplicate' }
    }

    const valid = validatePayload(envelope.eventType, payload)
    if (
      !valid.ok ||
      !payload ||
      typeof payload.orderId !== 'string' ||
      !Array.isArray(payload.items) ||
      !hasUsableItems(payload.items)
    ) {
      // Malformed beyond the envelope's own validation (the schema from
      // shared-messaging, plus the local line checks). Recorded as handled so a
      // redelivery does not re-log it forever; retrying could never succeed.
      await setOutcome(tx, envelope.eventId, 'rejected:malformed-payload')
      console.warn(
        `${LOG_PREFIX} Rejected malformed ${envelope.eventType} ` +
          `(eventId=${envelope.eventId}): ${valid.ok ? 'unusable line items' : valid.reason}`
      )
      return { kind: 'rejected' }
    }

    const items = collapseItems(payload.items)

    // Guard 2: claim the ORDER. rowCount 0 means a reservation for it exists,
    // under some other eventId (or a concurrent transaction owns it) --
    // converge rather than reserve again. Claimed BEFORE the stock is looked at
    // so a re-emitted order.created for an order that is already reserved can
    // never be misreported as insufficient just because its own hold has since
    // drained the shelf.
    const claimed = await insertReservation(tx, {
      orderId: payload.orderId,
      orderNumber: payload.orderNumber,
      eventId: envelope.eventId,
      items,
    })
    if (!claimed) {
      const existing = await getReservationState(tx, payload.orderId)
      const status = existing?.status ?? 'RESERVED'
      await setOutcome(tx, envelope.eventId, `skipped:order-already-${status.toLowerCase()}`)
      return { kind: 'skipped', status, eventId: existing?.eventId ?? '' }
    }

    // Read every row first (and lock it), then decide. Nothing is decremented
    // until the whole order is known to be satisfiable.
    const stock = await lockStock(
      tx,
      items.map((i) => i.productId)
    )
    const shortfalls: { productId: string; sku: string; requested: number; available: number }[] =
      []
    for (const item of items) {
      const row = stock.get(item.productId)
      if (!row) {
        // An unknown product is a shortfall of the whole quantity, not an error.
        // ms-inventory does not own the catalogue and must not assume its own
        // seed covers every product ms-order can sell.
        shortfalls.push({
          productId: item.productId,
          sku: item.sku,
          requested: item.quantity,
          available: 0,
        })
      } else if (row.available < item.quantity) {
        shortfalls.push({
          productId: item.productId,
          sku: row.sku || item.sku,
          requested: item.quantity,
          available: row.available,
        })
      }
    }

    if (shortfalls.length > 0) {
      // Withdraw the hold claimed above: an order that was short has NO
      // reservation row (GET /api/v1/reservations documents exactly that).
      await deleteReservation(tx, payload.orderId)
      await enqueueInventoryInsufficient(
        tx,
        { orderId: payload.orderId, orderNumber: payload.orderNumber, shortfalls },
        envelope.correlationId
      )
      await setOutcome(tx, envelope.eventId, 'insufficient')
      return {
        kind: 'insufficient',
        detail: shortfalls
          .map((s) => `${s.productId} wanted ${s.requested}, had ${s.available}`)
          .join('; '),
      }
    }

    await reserveStock(tx, items)
    const { enqueued } = await enqueueInventoryReserved(
      tx,
      { orderId: payload.orderId, orderNumber: payload.orderNumber, reservations: items },
      envelope.correlationId
    )
    await setOutcome(tx, envelope.eventId, 'reserved')
    return { kind: 'reserved', items, enqueued }
  })

  // ── Committed. Only logging and the best-effort timer happen below. ───────
  switch (result.kind) {
    case 'duplicate':
      // eslint-disable-next-line no-console
      console.log(`${LOG_PREFIX} Skipping duplicate delivery of eventId=${envelope.eventId}`)
      return
    case 'rejected':
      return
    case 'skipped':
      // eslint-disable-next-line no-console
      console.log(
        `${LOG_PREFIX} order.created for ${payload.orderNumber} ignored: reservation already ` +
          `${result.status} (eventId=${result.eventId})`
      )
      return
    case 'insufficient':
      // eslint-disable-next-line no-console
      console.warn(`${LOG_PREFIX} Insufficient stock for ${payload.orderNumber}: ${result.detail}`)
      return
    case 'reserved':
      // Schedule the stale-hold sweep. The jobId is derived from the eventId, so
      // a redelivery that somehow got past both guards still cannot stack a
      // second timer — BullMQ ignores an add() whose jobId is already present.
      await queueManager.tryEnqueue('release-expired-reservation', () =>
        queueManager.enqueueReleaseExpired({
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
          eventId: envelope.eventId,
        })
      )
      // eslint-disable-next-line no-console
      console.log(
        `${LOG_PREFIX} Reserved stock for ${payload.orderNumber} (${result.items.length} ` +
          `product(s)); queued ${result.enqueued} inventory.reserved outbox row(s)`
      )
  }
}

type CancelledResult =
  | { kind: 'duplicate' }
  | { kind: 'rejected' }
  | { kind: 'noop' }
  | { kind: 'released'; orderNumber: string }

/**
 * order.cancelled → release whatever this order holds.
 *
 * A no-op is the correct outcome for both "never reserved" (the order was
 * short on stock, or predates this service) and "already released". Neither is
 * an error worth failing the handler over — failing would only re-log the same
 * message on the next redelivery.
 */
export async function handleOrderCancelled(
  envelope: EventEnvelope,
  deps: HandlerDeps
): Promise<void> {
  const { store } = deps
  const payload = envelope.payload as OrderCancelledPayload

  const result = await store.transaction(async (tx): Promise<CancelledResult> => {
    if (!(await claimEvent(tx, envelope.eventId, envelope.eventType))) {
      return { kind: 'duplicate' }
    }

    const valid = validatePayload(envelope.eventType, payload)
    if (!valid.ok || !payload || typeof payload.orderId !== 'string') {
      await setOutcome(tx, envelope.eventId, 'rejected:malformed-payload')
      console.warn(
        `${LOG_PREFIX} Rejected malformed ${envelope.eventType} ` +
          `(eventId=${envelope.eventId}): ${valid.ok ? 'no orderId' : valid.reason}`
      )
      return { kind: 'rejected' }
    }

    const released = await releaseReservation(
      tx,
      payload.orderId,
      payload.reason || 'order-cancelled',
      envelope.correlationId
    )

    if (!released.released) {
      await setOutcome(
        tx,
        envelope.eventId,
        released.reason === 'no-reservation' ? 'skipped:no-reservation' : 'skipped:already-released'
      )
      return { kind: 'noop' }
    }

    await setOutcome(tx, envelope.eventId, 'released')
    return { kind: 'released', orderNumber: released.orderNumber }
  })

  if (result.kind === 'duplicate') {
    // eslint-disable-next-line no-console
    console.log(`${LOG_PREFIX} Skipping duplicate delivery of eventId=${envelope.eventId}`)
  } else if (result.kind === 'released') {
    // eslint-disable-next-line no-console
    console.log(`${LOG_PREFIX} Released reservation for ${result.orderNumber} (${payload.reason})`)
  }
}

export type ReleaseResult =
  | { released: true; orderNumber: string; items: ReservationItem[] }
  | { released: false; reason: 'no-reservation' | 'already-released' }

/**
 * Restores stock, flips the reservation to RELEASED and queues
 * inventory.released -- all on the caller's transaction.
 *
 * Shared by the cancellation handler and the reconciliation worker so the two
 * paths cannot drift. Unlike the NeDB version it does NOT assume the caller
 * checked the state first: the `status = 'RESERVED'` predicate on the flip is
 * the check, atomically, so calling it on an already-released order is a safe
 * no-op rather than a double credit. That matters because the worker (timer)
 * and a cancellation can race.
 *
 * Lock order is reservation row, then product rows sorted by id -- the same as
 * the reserve path, so the two cannot deadlock each other.
 */
export async function releaseReservation(
  tx: Tx,
  orderId: string,
  reason: string,
  correlationId?: string
): Promise<ReleaseResult> {
  const held = await markReleased(tx, orderId)
  if (!held) {
    const state = await getReservationState(tx, orderId)
    return { released: false, reason: state ? 'already-released' : 'no-reservation' }
  }

  await lockStock(
    tx,
    held.items.map((i) => i.productId)
  )
  await creditStock(tx, held.items)

  await enqueueInventoryReleased(
    tx,
    { orderId, orderNumber: held.orderNumber, reason, releases: held.items },
    correlationId
  )

  return { released: true, orderNumber: held.orderNumber, items: held.items }
}
