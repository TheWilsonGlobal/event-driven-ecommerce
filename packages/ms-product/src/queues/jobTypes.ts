/**
 * Job payload shapes for ms-product's reindex-search queue.
 *
 * Payloads carry the product id, not a snapshot of the product — the worker
 * re-reads the current NeDB row before indexing, so a job that sat in the
 * queue for a while (retry backoff, or Elasticsearch being briefly down)
 * never writes stale data into the index. See workers.ts.
 */

/** reindex-search: upsert */
export interface ReindexProductJob {
  productId: string
}

/** reindex-search: remove (the product itself is already gone from NeDB) */
export interface RemoveProductFromIndexJob {
  productId: string
}

export type ReindexSearchJob = ReindexProductJob | RemoveProductFromIndexJob

export const JOB_NAMES = {
  reindexProduct: 'reindex-product',
  removeFromIndex: 'remove-from-index',
} as const
