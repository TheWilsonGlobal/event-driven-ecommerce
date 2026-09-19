/**
 * toRecentJobView moved to @ecommerce/shared-messaging 2026-09-19 — ms-product
 * needed the identical BullMQ-Job-to-admin-shape mapping for its own queue.
 * Re-exported here so existing imports from './jobView' keep working
 * unchanged.
 */
export { toRecentJobView, type RecentJobView } from '@ecommerce/shared-messaging'
export { isContractJobState } from '@ecommerce/shared-messaging'
