/**
 * Job payload shapes for ms-inventory's inventory-reconciliation queue.
 *
 * The payload carries identifiers only — no copy of the reservation's items or
 * its status. The job is scheduled to fire a full TTL after the reservation is
 * made, so by the time it runs the reservation may well have been released by
 * an order.cancelled that arrived in the meantime. A job that acted on the
 * state captured at enqueue time would release stock a second time. The worker
 * re-reads the row and re-checks its status instead. Same rule ms-product's
 * jobTypes.ts states for reindex jobs, with a much longer window to get it
 * wrong in.
 */
export interface ReleaseExpiredReservationJob {
  orderId: string
  orderNumber: string
  /** The order.created eventId — the deterministic jobId is derived from it. */
  eventId: string
}

export const JOB_NAMES = {
  releaseExpired: 'release-expired-reservation',
} as const
