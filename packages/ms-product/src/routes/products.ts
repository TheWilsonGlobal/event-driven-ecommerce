import type { FastifyInstance, FastifyRequest } from 'fastify'
import * as crypto from 'crypto'
import type { DocumentDatabaseAdapter, ProductSearchClient } from '@ecommerce/shared-database'
import {
  AppError,
  ErrorResponse,
  forbidden,
  identityHas,
  notFound,
  requireOwnerOrAny,
  type RateTier,
} from '@ecommerce/shared-security'
import type { ProductDoc } from '../types'
import type { QueueManager } from '../queues'
import type { ProductCache } from '../cache/productCache'
import {
  CreateProductBody,
  ListProductsQuery,
  PatchProductBody,
  ProductListResponse,
  ProductParams,
  ProductResponse,
  SuccessResponse,
  roundMoney,
} from '../schemas'

interface ProductRouteDeps {
  productsStore: DocumentDatabaseAdapter<ProductDoc>
  search: Pick<ProductSearchClient, 'searchProductIds' | 'indexProduct' | 'removeProduct'>
  queueManager: Pick<
    QueueManager,
    'queuesAvailable' | 'tryEnqueue' | 'enqueueReindexProduct' | 'enqueueRemoveFromIndex'
  >
  /**
   * Cache-aside for GET /products/:id. Absent = direct store reads (the tests that
   * predate the cache, and any deployment with no Redis).
   */
  cache?: ProductCache<ProductDoc> | undefined
}

const errorResponses = {
  400: ErrorResponse,
  401: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
}

/**
 * Ratings are a trust signal shown to shoppers, so only an administrator may set
 * them; a vendor could otherwise award their own product five stars. (In report
 * mode the attempt is allowed and only the policy log records it, like every
 * other decision during rollout.)
 */
function assertMayRate(req: FastifyRequest, ratings: unknown): void {
  if (ratings === undefined) return
  if (identityHas(req.auth, 'products:write:any')) return
  if (req.server.securityMode === 'enforce') {
    throw forbidden('FORBIDDEN', 'Only an administrator can set product ratings')
  }
}

// ─── Products ─────────────────────────────────────────────────────────────
export function registerProductRoutes(
  server: FastifyInstance,
  { productsStore, search, queueManager, cache }: ProductRouteDeps
): void {
  // The listing is registered twice on the same path. `hasSearch` is a routing
  // constraint (see security.ts): a request carrying a non-empty ?search= lands on
  // the 'yes' definition, which sits in the `expensive` rate tier; everything else
  // is an ordinary `read`.
  for (const hasSearch of ['yes', 'no'] as const) {
    const rateTier: RateTier = hasSearch === 'yes' ? 'expensive' : 'read'
    server.get<{ Querystring: ListProductsQuery }>(
      '/api/v1/products',
      {
        constraints: { hasSearch },
        config: { policy: { public: true }, rateTier },
        schema: {
          tags: ['products'],
          description:
            'List products (paginated). Supports ?page, ?limit, ?category (slug), ?search ' +
            '(title/description) and ?sort=title|price|stock with ?order=asc|desc. A request ' +
            'with ?search= is rate-limited in the expensive tier.',
          // Same path twice: only one definition is documented.
          ...(hasSearch === 'yes' ? { hide: true } : {}),
          querystring: ListProductsQuery,
          response: { 200: ProductListResponse, 400: ErrorResponse },
        },
      },
      async (req) => {
        const { page, limit, category: categorySlug, sort, order } = req.query
        const term = req.query.search?.trim()

        let all = await productsStore.find({})
        // Relevance-ordered when Elasticsearch answered; insertion order otherwise.
        let searchEngine: 'elasticsearch' | 'memory' | 'none' = 'none'

        if (term) {
          const hits = await search.searchProductIds(term, { categorySlug })
          if (hits) {
            // Elasticsearch ranked the ids; re-read the authoritative NeDB records
            // and reorder them to match, so the response body always comes from
            // the source of truth even if the index holds a stale copy.
            searchEngine = 'elasticsearch'
            const byId = new Map(all.map((p) => [p.id ?? p._id, p]))
            all = hits.ids
              .map((id) => byId.get(id))
              .filter((p): p is (typeof all)[number] => p !== undefined)
          } else {
            // Cluster unreachable or disabled — substring scan, as before.
            searchEngine = 'memory'
            const needle = term.toLowerCase()
            if (categorySlug) {
              all = all.filter((p) => p.category?.slug === categorySlug)
            }
            all = all.filter(
              (p) =>
                p.title?.toLowerCase().includes(needle) ||
                p.description?.toLowerCase().includes(needle)
            )
          }
        } else if (categorySlug) {
          all = all.filter((p) => p.category?.slug === categorySlug)
        }

        if (sort) {
          // Array.sort is stable, so equal keys keep their relevance/insertion order.
          const dir = order === 'desc' ? -1 : 1
          all = [...all].sort((a, b) => {
            const x = a[sort]
            const y = b[sort]
            const cmp =
              typeof x === 'string' && typeof y === 'string'
                ? x.localeCompare(y)
                : Number(x) - Number(y)
            return cmp * dir
          })
        }

        const total = all.length
        const start = (page - 1) * limit
        const products = all.slice(start, start + limit)

        return { products, total, page, limit, searchEngine }
      }
    )
  }

  server.get<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    {
      config: { policy: { public: true }, rateTier: 'read' },
      schema: {
        tags: ['products'],
        description:
          'Fetch a single product by id. Served cache-aside from Redis when available; ' +
          'every product write invalidates the entry.',
        params: ProductParams,
        response: { 200: ProductResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      const { id } = req.params
      const load = () => productsStore.findOne({ id })
      // Service identities (ms-order's PriceVerifier) must see the store's current
      // price: they bypass the cache entirely (no read, no write-back).
      const useCache = cache && req.auth?.kind !== 'service'
      const product = useCache ? await cache.getOrLoad(id, load) : await load()
      if (!product) throw notFound('Product not found')
      return product
    }
  )

  server.post<{ Body: CreateProductBody }>(
    '/api/v1/products',
    {
      config: { policy: { permission: 'products:write', audit: true }, rateTier: 'write' },
      schema: {
        tags: ['products'],
        description:
          'Create a new product. A VENDOR becomes its owner (only they and an ADMIN can edit ' +
          'it); a product created by an ADMIN has no owner and stays ADMIN-only.',
        body: CreateProductBody,
        response: { 201: ProductResponse, ...errorResponses, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      const body = req.body
      assertMayRate(req, body.ratings)

      // `prod-${Date.now()}` used to be the fallback here: under concurrent
      // creates, two requests landing in the same millisecond collided on
      // that id, and NeDB's unique-key constraint turned the second insert
      // into an unhandled 500 rather than a clean conflict response (found
      // via packages/load-testing's queue stress test). randomUUID() is
      // already this package's convention for generated ids (see
      // routes/uploads.ts) and is collision-proof regardless of request rate.
      const id = body.id ?? `prod-${crypto.randomUUID()}`
      if (body.id && (await productsStore.findOne({ id }))) {
        throw new AppError(409, 'CONFLICT', 'A product with this id already exists')
      }

      const owner = req.auth?.role === 'VENDOR' ? req.auth.userId : undefined
      const doc: ProductDoc = {
        id,
        title: body.title,
        slug: body.slug ?? id,
        sku: body.sku ?? id.toUpperCase(),
        description: body.description ?? '',
        price: body.price ?? 0,
        compareAtPrice: roundMoney(body.compareAtPrice ?? body.price ?? 0),
        currency: body.currency ?? 'USD',
        stock: body.stock ?? 0,
        isAvailable: body.isAvailable ?? true,
        category: body.category ?? { id: '', name: '', slug: '' },
        tags: body.tags ?? [],
        images: body.images ?? [],
        attributes: body.attributes ?? [],
        ratings: body.ratings ?? { average: 0, count: 0 },
        ...(owner ? { vendorId: owner } : {}),
      }
      const created = await productsStore.insert(doc)
      await cache?.invalidate(id)
      // Mirror into the search index via the reindex-search queue rather than
      // an inline call: this gets automatic retry (5 attempts, exponential
      // backoff) if Elasticsearch is briefly down, instead of the product
      // silently staying unindexed until the next full-service restart
      // re-runs seedAndIndex()'s bulk backfill. Fire-and-forget — a Redis
      // outage (or the embedded KV driver being active) must not fail a write
      // NeDB already committed; tryEnqueue logs and swallows that case.
      //
      // NOTE: this means a create immediately followed by a ?search= may not
      // find the product yet (the old inline `await search.indexProduct()`
      // guaranteed that). Falling back to indexing inline when the queue is
      // unavailable at least keeps that guarantee on the embedded-KV/no-Redis
      // path, which is this repo's default.
      if (queueManager.queuesAvailable) {
        await queueManager.tryEnqueue('reindex-product', () =>
          queueManager.enqueueReindexProduct({ productId: created.id ?? (created._id as string) })
        )
      } else {
        await search.indexProduct(created)
      }
      return reply.status(201).send(created)
    }
  )

  server.patch<{ Params: { id: string }; Body: PatchProductBody }>(
    '/api/v1/products/:id',
    {
      config: { policy: { permission: 'products:write', audit: true }, rateTier: 'write' },
      schema: {
        tags: ['products'],
        description:
          'Update fields on an existing product. A VENDOR can only update their own products; ' +
          "someone else's product answers 404, exactly like a missing one.",
        params: ProductParams,
        body: PatchProductBody,
        response: { 200: ProductResponse, ...errorResponses },
      },
    },
    async (req) => {
      const existing = await productsStore.findOne({ id: req.params.id })
      if (!existing) throw notFound('Product not found')
      // 404, not 403, for another vendor's product so ids cannot be enumerated.
      requireOwnerOrAny(req, existing.vendorId, 'products:write')

      const patch = { ...req.body }
      assertMayRate(req, patch.ratings)
      if (patch.compareAtPrice !== undefined) {
        patch.compareAtPrice = roundMoney(patch.compareAtPrice)
      }

      const numUpdated = await productsStore.update({ id: req.params.id }, patch)
      // Price/stock/any field: drop the cached copy as soon as the write commits so
      // PriceVerifier (ms-order) and shoppers never read the old value afterwards.
      await cache?.invalidate(req.params.id)
      if (numUpdated === 0) throw notFound('Product not found')
      const updated = await productsStore.findOne({ id: req.params.id })
      if (updated) {
        if (queueManager.queuesAvailable) {
          await queueManager.tryEnqueue('reindex-product', () =>
            queueManager.enqueueReindexProduct({ productId: updated.id ?? (updated._id as string) })
          )
        } else {
          await search.indexProduct(updated)
        }
      }
      return updated
    }
  )

  server.delete<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    {
      config: { policy: { permission: 'products:write', audit: true }, rateTier: 'write' },
      schema: {
        tags: ['products'],
        description:
          'Delete a product by id. A VENDOR can only delete their own products; ' +
          "someone else's product answers 404, exactly like a missing one.",
        params: ProductParams,
        response: { 200: SuccessResponse, ...errorResponses },
      },
    },
    async (req) => {
      const existing = await productsStore.findOne({ id: req.params.id })
      if (!existing) throw notFound('Product not found')
      requireOwnerOrAny(req, existing.vendorId, 'products:write')

      const numRemoved = await productsStore.delete({ id: req.params.id })
      await cache?.invalidate(req.params.id)
      if (numRemoved === 0) throw notFound('Product not found')
      if (queueManager.queuesAvailable) {
        await queueManager.tryEnqueue('remove-from-index', () =>
          queueManager.enqueueRemoveFromIndex({ productId: req.params.id })
        )
      } else {
        await search.removeProduct(req.params.id)
      }
      return { success: true }
    }
  )
}
