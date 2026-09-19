/**
 * buildQueueData moved to @ecommerce/shared-messaging 2026-09-19 — ms-product
 * needed the identical GET /api/v1/queues payload builder for its own queue.
 * Re-exported here so existing imports from './introspection' keep working
 * unchanged.
 */
export { buildQueueData } from '@ecommerce/shared-messaging'
