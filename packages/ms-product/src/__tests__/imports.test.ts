/**
 * Smoke test: every module ms-product's entry point (src/index.ts) depends
 * on loads without throwing.
 *
 * ms-product/src/index.ts inlines server construction AND server.listen() in
 * one top-level bootstrap() call that runs on import, so importing index.ts
 * itself would try to bind the real port (already in use by the dev server).
 * Instead this imports the route-registration/support modules it pulls in
 * directly — catching a broken import/re-export/circular import without
 * touching the network.
 *
 * The @ecommerce/shared-database factories (createRustFSClient,
 * createDocumentStore, createSearchClient) are only asserted importable here,
 * not invoked: calling them for real would open a NeDB data file / construct
 * an S3 client tied to this repo's data directory, which is more than an
 * import-graph smoke test needs.
 */
import { registerSchemaRoutes, registerLogRoutes } from '../diagnostics'
import type { ProductDoc, CategoryDoc } from '../types'
import {
  loadDatabaseConfig,
  createRustFSClient,
  createDocumentStore,
  createSearchClient,
  SEED_PRODUCTS,
  SEED_CATEGORIES,
} from '@ecommerce/shared-database'
import {
  registerMetrics,
  buildLoggerOptions,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'

describe('ms-product module graph', () => {
  it('loads diagnostics/index without throwing', () => {
    expect(typeof registerSchemaRoutes).toBe('function')
    expect(typeof registerLogRoutes).toBe('function')
  })

  it('loads types.ts without throwing (type-only, compiles clean)', () => {
    const product: Partial<ProductDoc> = {}
    const category: Partial<CategoryDoc> = {}
    expect(product).toBeDefined()
    expect(category).toBeDefined()
  })

  it('loads @ecommerce/shared-database exports used by index.ts', () => {
    expect(typeof loadDatabaseConfig).toBe('function')
    expect(typeof createRustFSClient).toBe('function')
    expect(typeof createDocumentStore).toBe('function')
    expect(typeof createSearchClient).toBe('function')
    expect(Array.isArray(SEED_PRODUCTS)).toBe(true)
    expect(Array.isArray(SEED_CATEGORIES)).toBe(true)
  })

  it('loads @ecommerce/shared-utils exports used by index.ts', () => {
    expect(typeof registerMetrics).toBe('function')
    expect(typeof buildLoggerOptions).toBe('function')
    expect(typeof createRouteRegistry).toBe('function')
    expect(typeof registerEndpointsRoute).toBe('function')
  })
})
