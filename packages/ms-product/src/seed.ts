import type { FastifyInstance } from 'fastify'
import {
  SEED_PRODUCTS,
  SEED_CATEGORIES,
  type DocumentDatabaseAdapter,
  type ProductSearchClient,
} from '@ecommerce/shared-database'
import type { ProductDoc, CategoryDoc } from './types'

interface SeedAndIndexDeps {
  productsStore: DocumentDatabaseAdapter<ProductDoc>
  categoriesStore: DocumentDatabaseAdapter<CategoryDoc>
  search: ProductSearchClient
}

/**
 * Self-seed (first run only) and search-index backfill, run once at boot.
 *
 * Populates the real NeDB-backed stores from the shared seed data the first
 * time the service boots against an empty database. Safe to run on every
 * boot — it's a no-op once data already exists, so seeded data persists
 * across restarts instead of being re-inserted.
 *
 * Also backfills Elasticsearch from NeDB on every boot rather than only after
 * a seed. NeDB is authoritative and survives independently of the cluster, so
 * the index can be empty (fresh volume), stale (writes while the search
 * profile was down) or absent — reindexing from the source of truth is the
 * one action that fixes all three, and it is cheap at this catalogue size.
 */
export async function seedAndIndex(
  server: FastifyInstance,
  { productsStore, categoriesStore, search }: SeedAndIndexDeps
): Promise<void> {
  // ─── Self-seed (first run only) ───────────────────────────────────────────
  {
    const existingProducts = await productsStore.find({})
    let seededProducts = 0
    if (existingProducts.length === 0) {
      for (const product of SEED_PRODUCTS) {
        await productsStore.insert(product as unknown as ProductDoc)
        seededProducts++
      }
    }

    const existingCategories = await categoriesStore.find({})
    let seededCategories = 0
    if (existingCategories.length === 0) {
      for (const category of SEED_CATEGORIES) {
        await categoriesStore.insert(category as unknown as CategoryDoc)
        seededCategories++
      }
    }

    server.log.info(
      `[Seed] products: ${seededProducts > 0 ? `inserted ${seededProducts}` : `skipped (${existingProducts.length} already present)`}, ` +
        `categories: ${seededCategories > 0 ? `inserted ${seededCategories}` : `skipped (${existingCategories.length} already present)`}`
    )
  }

  // ─── Search index ─────────────────────────────────────────────────────────
  if (await search.ensureIndex()) {
    const all = await productsStore.find({})
    const indexed = await search.indexProducts(all)
    server.log.info(
      `[Search] Elasticsearch ready at ${search.nodeUrl} — indexed ${indexed}/${all.length} products into "${search.indexName}"`
    )
  } else {
    server.log.warn(
      `[Search] Elasticsearch unreachable at ${search.nodeUrl} — ?search falls back to in-memory filtering. ` +
        `Start it with: cd ../infra-hub && docker compose --profile search up -d`
    )
  }
}
