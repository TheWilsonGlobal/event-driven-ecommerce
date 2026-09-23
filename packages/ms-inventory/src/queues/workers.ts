import type { Job } from 'bullmq'
import type { DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import type { InventoryDoc, ReservationDoc } from '../types'
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
 * the order.cancelled publish was lost (at-most-once, no outbox).
 */
export function makeReconciliationProcessor(
  inventoryStore: DocumentDatabaseAdapter<InventoryDoc>,
  reservationsStore: DocumentDatabaseAdapter<ReservationDoc>
) {
  return async function processReconciliation(job: Job<ReleaseExpiredReservationJob>) {
    if (job.name !== JOB_NAMES.releaseExpired) {
      throw new Error(`Unknown inventory-reconciliation job name: ${job.name}`)
    }

    const { orderId, orderNumber } = job.data

    // Re-read rather than trust the enqueue-time view — see jobTypes.ts. A
    // full TTL has passed, and the usual outcome is that order.cancelled
    // already released this.
    const reservation = await reservationsStore.findOne({ orderId })
    if (!reservation) {
      return { outcome: 'skipped', reason: 'reservation-not-found', orderId }
    }

    if (reservation.status !== 'RESERVED') {
      // The expected happy path: something released it within the TTL.
      return { outcome: 'skipped', reason: 'already-released', orderId, orderNumber }
    }

    await releaseReservation(
      { inventoryStore, reservationsStore },
      reservation,
      'reservation-expired'
    )

    return {
      outcome: 'released',
      orderId,
      orderNumber,
      items: reservation.items.length,
    }
  }
}
