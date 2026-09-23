import { SEED_PRODUCTS, type DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import type { InventoryDoc } from './types'

/**
 * Self-seed the inventory collection on first boot.
 *
 * Stock levels come from SEED_PRODUCTS — the same shared seed ms-product
 * populates its catalogue from — so the productIds and skus here are exactly
 * the ones ms-order's orders reference. Inventing a separate set of ids would
 * make every order arrive as `product-not-found` and the service would look
 * broken while behaving correctly.
 *
 * ── Idempotent per product, not per collection ──────────────────────────────
 * The guard is a findOne per productId rather than "is the collection empty".
 * The empty-collection check (which ms-product uses, correctly, for a
 * catalogue) would be wrong here: this collection is WRITTEN by the reserve
 * path, so after the first order it is never empty again — but it may still be
 * missing a product added to the seed set later. Per-product also means a
 * restart can never re-inflate the stock of a product whose units are
 * currently reserved, which is the failure this guard exists to prevent.
 */
export async function seedInventoryIfMissing(
  store: DocumentDatabaseAdapter<InventoryDoc>
): Promise<number> {
  const now = new Date().toISOString()
  let seeded = 0

  for (const product of SEED_PRODUCTS) {
    const existing = await store.findOne({ productId: product.id })
    if (existing) {
      continue
    }

    await store.insert({
      productId: product.id,
      sku: product.sku,
      available: product.stock,
      reserved: 0,
      updatedAt: now,
    })
    seeded += 1
  }

  return seeded
}
