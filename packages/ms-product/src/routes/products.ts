import type { FastifyInstance } from 'fastify'
import type { DocumentDatabaseAdapter, ProductSearchClient } from '@ecommerce/shared-database'
import type { ProductDoc } from '../types'
import type { QueueManager } from '../queues'

interface ProductRouteDeps {
  productsStore: DocumentDatabaseAdapter<ProductDoc>
  search: ProductSearchClient
  queueManager: QueueManager
}

// ─── Products ─────────────────────────────────────────────────────────────
export function registerProductRoutes(
  server: FastifyInstance,
  { productsStore, search, queueManager }: ProductRouteDeps
): void {
  server.get<{
    Querystring: { page?: string; limit?: string; category?: string; search?: string }
  }>(
    '/api/v1/products',
    {
      schema: {
        tags: ['products'],
        description:
          'List products (paginated). Supports ?page, ?limit, ?category (slug) and ?search (title/description).',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'string' },
            limit: { type: 'string' },
            category: { type: 'string' },
            search: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              products: { type: 'array', items: { type: 'object', additionalProperties: true } },
              total: { type: 'number' },
              page: { type: 'number' },
              limit: { type: 'number' },
              // Which engine answered: "elasticsearch" (relevance-ranked),
              // "memory" (substring fallback) or "none" (no ?search term).
              searchEngine: { type: 'string' },
            },
          },
        },
      },
    },
    async (req) => {
      const page = Math.max(parseInt(req.query.page ?? '1', 10) || 1, 1)
      const limit = Math.max(parseInt(req.query.limit ?? '20', 10) || 20, 1)
      const categorySlug = req.query.category
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

      const total = all.length
      const start = (page - 1) * limit
      const products = all.slice(start, start + limit)

      return { products, total, page, limit, searchEngine }
    }
  )

  server.get<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    {
      schema: {
        tags: ['products'],
        description: 'Fetch a single product by id.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          404: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (req, reply) => {
      const product = await productsStore.findOne({ id: req.params.id })
      if (!product) {
        return reply.status(404).send({ error: 'Product not found' })
      }
      return product
    }
  )

  server.post<{ Body: Partial<ProductDoc> }>(
    '/api/v1/products',
    {
      schema: {
        tags: ['products'],
        description: 'Create a new product.',
        body: { type: 'object', additionalProperties: true },
        response: {
          201: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (req, reply) => {
      const body = req.body ?? {}
      const id = (body.id as string | undefined) ?? `prod-${Date.now()}`
      const doc: ProductDoc = {
        id,
        title: body.title ?? 'Untitled Product',
        slug: body.slug ?? id,
        sku: body.sku ?? id.toUpperCase(),
        description: body.description ?? '',
        price: body.price ?? 0,
        compareAtPrice: body.compareAtPrice ?? body.price ?? 0,
        currency: body.currency ?? 'USD',
        stock: body.stock ?? 0,
        isAvailable: body.isAvailable ?? true,
        category: body.category ?? { id: '', name: '', slug: '' },
        tags: body.tags ?? [],
        images: body.images ?? [],
        attributes: body.attributes ?? [],
        ratings: body.ratings ?? { average: 0, count: 0 },
      }
      const created = await productsStore.insert(doc)
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

  server.patch<{ Params: { id: string }; Body: Partial<ProductDoc> }>(
    '/api/v1/products/:id',
    {
      schema: {
        tags: ['products'],
        description: 'Update fields on an existing product.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: { type: 'object', additionalProperties: true },
        response: {
          200: { type: 'object', additionalProperties: true },
          404: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (req, reply) => {
      const numUpdated = await productsStore.update({ id: req.params.id }, req.body ?? {})
      if (numUpdated === 0) {
        return reply.status(404).send({ error: 'Product not found' })
      }
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
      schema: {
        tags: ['products'],
        description: 'Delete a product by id.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: { type: 'object', properties: { success: { type: 'boolean' } } },
          404: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (req, reply) => {
      const numRemoved = await productsStore.delete({ id: req.params.id })
      if (numRemoved === 0) {
        return reply.status(404).send({ error: 'Product not found' })
      }
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
