import type { Job } from 'bullmq'
import type { InventoryStore } from '../db/store'
import { releaseReservation } from '../events/handlers'
import { JOB_NAMES, type ReleaseExpiredReservationJob } from './jobTypes'

/**
 * Worker processor for the inventory-reconciliation queue.
 *
 * This is the one piece of ms-inventory's behaviour that no event can trigger.
 * order.created reserves and order.cancelled releases, but an order that is
 * simply abandoned — created, never paid, never explicitly cancelled — emits
 * nothing further, and the stock it holds would stay unsellable forever. A
 * timer is the only thing that can notice a fact that consists of an event NOT
 * arriving.
 *
 * ms-order has its own order-expiration queue that will usually cancel such an
 * order first, and that cancellation releases the stock through the normal
 * path. This queue is the backstop for when it does not: ms-order's Redis was
 * down when the order was created, its expiry job failed all its attempts, or
 * the order.cancelled event never reached us.
 *
 * ── Check and release are one atomic statement ──────────────────────────────
 * A full TTL has passed, so the usual outcome is that order.cancelled already
 * released this. The state is therefore never trusted from enqueue time, and it
 * is not read-then-acted-on either: `releaseReservation` flips RESERVED ->
 * RELEASED with a status predicate inside one transaction, so a cancellation
 * landing at the same instant as this timer cannot make both credit the stock.
 * There is no ledger row here -- a BullMQ job is not a Kafka event -- the
 * reservation's own state is the idempotency key.
 */
export function makeReconciliationProcessor(store: InventoryStore) {
  return async function processReconciliation(job: Job<ReleaseExpiredReservationJob>) {
    if (job.name !== JOB_NAMES.releaseExpired) {
      throw new Error(`Unknown inventory-reconciliation job name: ${job.name}`)
    }

    const { orderId, orderNumber } = job.data

    const result = await store.transaction((tx) =>
      releaseReservation(tx, orderId, 'reservation-expired')
    )

    if (!result.released) {
      // already-released is the expected happy path: something released it
      // within the TTL.
      return result.reason === 'no-reservation'
        ? { outcome: 'skipped', reason: 'reservation-not-found', orderId }
        : { outcome: 'skipped', reason: 'already-released', orderId, orderNumber }
    }

    return {
      outcome: 'released',
      orderId,
      orderNumber,
      items: result.items.length,
    }
  }
}
