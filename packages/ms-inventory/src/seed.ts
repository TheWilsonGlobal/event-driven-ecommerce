import { SEED_PRODUCTS } from '@ecommerce/shared-database'
import { seedInventory, type InventoryStore } from './db/store'

/**
 * Self-seed the inventory table on first boot.
 *
 * Stock levels come from SEED_PRODUCTS — the same shared seed ms-product
 * populates its catalogue from — so the productIds and skus here are exactly
 * the ones ms-order's orders reference. Inventing a separate set of ids would
 * make every order arrive as `product-not-found` and the service would look
 * broken while behaving correctly.
 *
 * ── Idempotent per product, not per table ───────────────────────────────────
 * The guard is `INSERT ... ON CONFLICT (product_id) DO NOTHING` rather than "is
 * the table empty". The empty-table check (which ms-product uses, correctly,
 * for a catalogue) would be wrong here: this table is WRITTEN by the reserve
 * path, so after the first order it is never empty again — but it may still be
 * missing a product added to the seed set later. Per-product also means a
 * restart can never re-inflate the stock of a product whose units are
 * currently reserved, which is the failure this guard exists to prevent.
 */
export async function seedInventoryIfMissing(store: InventoryStore): Promise<number> {
  return seedInventory(
    store,
    SEED_PRODUCTS.map((p) => ({ productId: p.id, sku: p.sku, stock: p.stock }))
  )
}
