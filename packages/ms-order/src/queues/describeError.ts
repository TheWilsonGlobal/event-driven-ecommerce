/**
 * describeError moved to @ecommerce/shared-messaging 2026-09-19 — ms-product
 * needed the same error-unwrapping logic for its own queue. Re-exported here
 * so existing imports from './describeError' keep working unchanged.
 */
export { describeError } from '@ecommerce/shared-messaging'
