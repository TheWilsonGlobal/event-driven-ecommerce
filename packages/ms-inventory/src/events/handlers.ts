import type { DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import {
  type EventEnvelope,
  type OrderCancelledPayload,
  type OrderCreatedPayload,
} from '@ecommerce/shared-messaging'
import type { InventoryDoc, ProcessedEventDoc, ReservationDoc, ReservationItem } from '../types'
import type { QueueManager } from '../queues'
import {
  publishInventoryInsufficient,
  publishInventoryReleased,
  publishInventoryReserved,
} from './publishers'
import { LOG_PREFIX } from './producer'

/**
 * The stock-movement handlers behind ms-inventory's Kafka consumer.
 *
 * ── TWO idempotency guards, and why one is not enough ───────────────────────
 * Kafka redelivers: on rebalance, on restart, and any time an offset was not
 * committed. A handler WILL see the same message more than once. Both guards
 * below are load-bearing and neither subsumes the other.
 *
 *   1. THE EVENT LEDGER (`processed_events`, keyed on envelope.eventId).
 *      Catches the literal redelivery: the same published message arriving
 *      twice. This is the common case and the cheapest to check, so it runs
 *      first, before anything is read or written.
 *
 *   2. THE RESERVATION'S OWN STATE (keyed on orderId).
 *      Catches what the ledger cannot: two DIFFERENT eventIds describing the
 *      same order. That happens whenever ms-order publishes order.created more
 *      than once for one order — a retried checkout, a replay tool, an
 *      operator re-emitting a lost event. Each publish mints a fresh eventId
 *      (makeEnvelope calls randomUUID), so guard 1 sees them as unrelated and
 *      would happily reserve the same order's stock twice. Guard 2 is what
 *      makes "reserve for order X" converge on ONE reservation regardless of
 *      how many events describe it.
 *
 *      The mirror image holds for release: a second order.cancelled must find
 *      the reservation already RELEASED and do nothing, or the stock would be
 *      credited back twice and inventory would inflate out of thin air.
 *
 * ── Why the ledger is written LAST ──────────────────────────────────────────
 * NeDB gives no cross-collection transaction, so the ledger write and the
 * stock write cannot be atomic. Writing the ledger last means a crash between
 * them leaves the event unrecorded and it gets redelivered — at which point
 * guard 2 sees the reservation already exists and no double-reserve occurs.
 * Writing it first would risk the opposite: an event marked handled whose
 * stock movement never happened, which nothing would ever retry.
 *
 * ── Why these handlers do the work inline rather than enqueueing it ─────────
 * The consumer's docblock notes that work which must not be dropped should
 * enqueue a BullMQ job as its first action. A stock reservation is a small,
 * local, idempotent NeDB write with no external dependency — there is nothing
 * a retry could fix that a redelivery would not. The queue here is used for
 * the thing that genuinely needs a timer instead: expiring a stale hold.
 */

export interface HandlerDeps {
  inventoryStore: DocumentDatabaseAdapter<InventoryDoc>
  reservationsStore: DocumentDatabaseAdapter<ReservationDoc>
  processedEventsStore: DocumentDatabaseAdapter<ProcessedEventDoc>
  queueManager: QueueManager
}

/** Guard 1. True when this exact eventId has already been handled to completion. */
async function alreadyProcessed(
  store: DocumentDatabaseAdapter<ProcessedEventDoc>,
  eventId: string
): Promise<boolean> {
  return (await store.findOne({ eventId })) !== null
}

async function recordProcessed(
  store: DocumentDatabaseAdapter<ProcessedEventDoc>,
  envelope: EventEnvelope,
  outcome: string
): Promise<void> {
  await store.insert({
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    processedAt: new Date().toISOString(),
    outcome,
  })
}

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
  const { inventoryStore, reservationsStore, processedEventsStore, queueManager } = deps

  if (await alreadyProcessed(processedEventsStore, envelope.eventId)) {
    // eslint-disable-next-line no-console
    console.log(`${LOG_PREFIX} Skipping duplicate delivery of eventId=${envelope.eventId}`)
    return
  }

  const payload = envelope.payload as OrderCreatedPayload
  if (!payload || typeof payload.orderId !== 'string' || !Array.isArray(payload.items)) {
    // Malformed beyond the envelope's own validation. Recorded as handled so a
    // redelivery does not re-log it forever — retrying could never succeed.
    await recordProcessed(processedEventsStore, envelope, 'rejected:malformed-payload')
    return
  }

  // Guard 2: a reservation for this ORDER already exists, under some other
  // eventId. Converge rather than reserve again.
  const existing = await reservationsStore.findOne({ orderId: payload.orderId })
  if (existing) {
    await recordProcessed(
      processedEventsStore,
      envelope,
      `skipped:order-already-${existing.status.toLowerCase()}`
    )
    // eslint-disable-next-line no-console
    console.log(
      `${LOG_PREFIX} order.created for ${payload.orderNumber} ignored: reservation already ` +
        `${existing.status} (eventId=${existing.eventId})`
    )
    return
  }

  const items = collapseItems(payload.items)

  // Read every row first, then decide. Nothing is written until the whole
  // order is known to be satisfiable.
  const rows = new Map<string, InventoryDoc>()
  const shortfalls: { productId: string; sku: string; requested: number; available: number }[] = []

  for (const item of items) {
    const row = await inventoryStore.findOne({ productId: item.productId })
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
      continue
    }
    rows.set(item.productId, row)
    if (row.available < item.quantity) {
      shortfalls.push({
        productId: item.productId,
        sku: row.sku,
        requested: item.quantity,
        available: row.available,
      })
    }
  }

  if (shortfalls.length > 0) {
    await recordProcessed(processedEventsStore, envelope, 'insufficient')
    await publishInventoryInsufficient(
      {
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
        shortfalls,
      },
      envelope.correlationId
    )
    const detail = shortfalls
      .map((s) => `${s.productId} wanted ${s.requested}, had ${s.available}`)
      .join('; ')
    // eslint-disable-next-line no-console
    console.warn(`${LOG_PREFIX} Insufficient stock for ${payload.orderNumber}: ${detail}`)
    return
  }

  const now = new Date().toISOString()
  for (const item of items) {
    const row = rows.get(item.productId)
    if (!row) {
      continue
    }
    await inventoryStore.update(
      { productId: item.productId },
      {
        available: row.available - item.quantity,
        reserved: row.reserved + item.quantity,
        updatedAt: now,
      }
    )
  }

  await reservationsStore.insert({
    orderId: payload.orderId,
    orderNumber: payload.orderNumber,
    eventId: envelope.eventId,
    items,
    status: 'RESERVED',
    createdAt: now,
    releasedAt: null,
  })

  // Schedule the stale-hold sweep. The jobId is derived from the eventId, so a
  // redelivery that somehow got past both guards still cannot stack a second
  // timer — BullMQ ignores an add() whose jobId is already present.
  await queueManager.tryEnqueue('release-expired-reservation', () =>
    queueManager.enqueueReleaseExpired({
      orderId: payload.orderId,
      orderNumber: payload.orderNumber,
      eventId: envelope.eventId,
    })
  )

  await recordProcessed(processedEventsStore, envelope, 'reserved')

  const fanOut = await publishInventoryReserved(
    {
      orderId: payload.orderId,
      orderNumber: payload.orderNumber,
      reservations: items,
    },
    envelope.correlationId
  )

  // eslint-disable-next-line no-console
  console.log(
    `${LOG_PREFIX} Reserved stock for ${payload.orderNumber} (${items.length} product(s)); ` +
      `published ${fanOut.published}/${fanOut.attempted} inventory.reserved message(s)`
  )
}

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
  const { inventoryStore, reservationsStore, processedEventsStore } = deps

  if (await alreadyProcessed(processedEventsStore, envelope.eventId)) {
    // eslint-disable-next-line no-console
    console.log(`${LOG_PREFIX} Skipping duplicate delivery of eventId=${envelope.eventId}`)
    return
  }

  const payload = envelope.payload as OrderCancelledPayload
  if (!payload || typeof payload.orderId !== 'string') {
    await recordProcessed(processedEventsStore, envelope, 'rejected:malformed-payload')
    return
  }

  const reservation = await reservationsStore.findOne({ orderId: payload.orderId })

  if (!reservation) {
    await recordProcessed(processedEventsStore, envelope, 'skipped:no-reservation')
    return
  }

  // Guard 2 on the release side. Crediting stock back twice would invent units
  // that never existed — the most damaging failure mode this service has.
  if (reservation.status === 'RELEASED') {
    await recordProcessed(processedEventsStore, envelope, 'skipped:already-released')
    return
  }

  await releaseReservation(
    { inventoryStore, reservationsStore },
    reservation,
    payload.reason || 'order-cancelled',
    envelope.correlationId
  )

  await recordProcessed(processedEventsStore, envelope, 'released')

  // eslint-disable-next-line no-console
  console.log(
    `${LOG_PREFIX} Released reservation for ${reservation.orderNumber} (${payload.reason})`
  )
}

/**
 * Restores stock and flips the reservation to RELEASED.
 *
 * Shared by the cancellation handler and the reconciliation worker so the two
 * paths cannot drift. Both callers are responsible for checking the RESERVED
 * state first — this function assumes it, and would double-credit if called on
 * an already-released row.
 */
export async function releaseReservation(
  stores: {
    inventoryStore: DocumentDatabaseAdapter<InventoryDoc>
    reservationsStore: DocumentDatabaseAdapter<ReservationDoc>
  },
  reservation: ReservationDoc,
  reason: string,
  correlationId?: string
): Promise<void> {
  const now = new Date().toISOString()

  for (const item of reservation.items) {
    const row = await stores.inventoryStore.findOne({ productId: item.productId })
    if (!row) {
      // The product row vanished between reserving and releasing. Nothing to
      // credit back; recreating it here would invent a stock level.
      continue
    }
    await stores.inventoryStore.update(
      { productId: item.productId },
      {
        available: row.available + item.quantity,
        // Clamped: `reserved` can only have been driven below the held
        // quantity by an external edit, and a negative reserved count would be
        // a fabricated number.
        reserved: Math.max(0, row.reserved - item.quantity),
        updatedAt: now,
      }
    )
  }

  await stores.reservationsStore.update(
    { orderId: reservation.orderId },
    { status: 'RELEASED', releasedAt: now }
  )

  await publishInventoryReleased(
    {
      orderId: reservation.orderId,
      orderNumber: reservation.orderNumber,
      reason,
      releases: reservation.items,
    },
    correlationId
  )
}
