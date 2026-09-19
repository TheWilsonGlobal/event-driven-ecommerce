import type { Job } from 'bullmq'
import type { DocumentDatabaseAdapter, ProductSearchClient } from '@ecommerce/shared-database'
import type { ProductDoc } from '../types'
import { JOB_NAMES, type ReindexProductJob, type RemoveProductFromIndexJob } from './jobTypes'

/**
 * Worker processor for ms-product's reindex-search queue.
 *
 * Replaces the inline `await search.indexProduct(...)` / `removeProduct(...)`
 * calls the write routes used to make directly. Those calls already failed
 * soft (ProductSearchClient never throws out of them — see search.ts), so
 * moving them here is not about protecting the HTTP response; it is about
 * retrying when Elasticsearch is briefly down. Before this queue existed, a
 * product written while the cluster profile was down (`docker compose
 * --profile search`) silently never made it into the index until the next
 * full service restart re-ran seedAndIndex()'s bulk backfill. Now BullMQ
 * retries the single-product upsert with backoff (5 attempts, exponential,
 * 3s base — see definitions.ts) before giving up.
 */
export function makeReindexSearchProcessor(
  productsStore: DocumentDatabaseAdapter<ProductDoc>,
  search: ProductSearchClient
) {
  return async function processReindexSearch(
    job: Job<ReindexProductJob | RemoveProductFromIndexJob>
  ) {
    if (job.name === JOB_NAMES.reindexProduct) {
      const { productId } = job.data as ReindexProductJob

      // Re-read fresh rather than trust the payload: the job may have sat in
      // the queue through a retry backoff, during which the product could
      // have been updated again (index the latest write, not a stale one) or
      // deleted (nothing to index).
      const product = await productsStore.findOne({ id: productId })
      if (!product) {
        return { outcome: 'skipped', reason: 'product-not-found', productId }
      }

      if (!search.isEnabled()) {
        // ELASTICSEARCH_ENABLED=false (or the client was never constructed):
        // an intentional off-switch, not an outage. Retrying would never
        // succeed and would just pile up in the failed-jobs list.
        return { outcome: 'skipped', reason: 'search-disabled', productId }
      }

      await search.indexProduct(product)

      // indexProduct() fails soft internally (catches and marks the client
      // unhealthy rather than throwing) so a down cluster wouldn't otherwise
      // surface here as a thrown error to retry against. Re-checking
      // isEnabled() after the call catches exactly that transition — enabled
      // going in, unhealthy coming out — and turns it into a real BullMQ
      // retry instead of a silently swallowed failure.
      if (!search.isEnabled()) {
        throw new Error(`Elasticsearch unreachable while indexing product ${productId}`)
      }

      return { outcome: 'indexed', productId }
    }

    if (job.name === JOB_NAMES.removeFromIndex) {
      const { productId } = job.data as RemoveProductFromIndexJob

      if (!search.isEnabled()) {
        return { outcome: 'skipped', reason: 'search-disabled', productId }
      }

      await search.removeProduct(productId)

      if (!search.isEnabled()) {
        throw new Error(`Elasticsearch unreachable while removing product ${productId} from index`)
      }

      return { outcome: 'removed', productId }
    }

    throw new Error(`Unknown reindex-search job name: ${job.name}`)
  }
}
