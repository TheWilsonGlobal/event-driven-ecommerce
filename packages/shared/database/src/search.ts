/**
 * Elasticsearch-backed product search.
 *
 * NeDB remains the source of truth for products — this module maintains a
 * secondary index used only to answer `?search=` queries. Every write path in
 * ms-product mirrors into the index; the index is never read back as data, so
 * a stale or missing index degrades search quality but can never lose a
 * product.
 *
 * Elasticsearch sits behind a compose profile in infra-hub and is frequently
 * NOT running:
 *
 *     cd ../infra-hub && docker compose --profile search up -d
 *
 * Every method here therefore fails soft. `isEnabled()` reports whether the
 * client believes the cluster is usable, and callers fall back to the in-memory
 * filter when it is not. A search endpoint that 500s because an optional
 * profile is down would be worse than a slower, less clever answer.
 */

import { Client } from '@elastic/elasticsearch'

export interface SearchConfiguration {
  /** Base URL of the cluster, e.g. http://localhost:9200 */
  node: string
  /** Index name holding product documents. */
  index: string
  /** When false, no client is constructed and every call is a no-op. */
  enabled: boolean
}

/**
 * Reads search settings from the environment.
 *
 * ELASTICSEARCH_HOST / ELASTICSEARCH_INDEX already existed in .env and the k8s
 * configmap but were never read by any code. They are the contract now.
 *
 * ELASTICSEARCH_ENABLED=false turns the integration off without unsetting the
 * host, which is what you want when the profile is down and you would rather
 * not pay the connection timeout on every search.
 */
export function loadSearchConfig(env: NodeJS.ProcessEnv = process.env): SearchConfiguration {
  return {
    node: env.ELASTICSEARCH_HOST || 'http://localhost:9200',
    index: env.ELASTICSEARCH_INDEX || 'products',
    enabled: env.ELASTICSEARCH_ENABLED !== 'false',
  }
}

/** The subset of a product this module indexes and can return. */
export interface IndexableProduct {
  id?: string
  _id?: string
  title?: string
  description?: string
  sku?: string
  tags?: string[]
  category?: { id?: string; name?: string; slug?: string }
  price?: number
  stock?: number
  isAvailable?: boolean
}

/**
 * Explicit mapping, created once on startup.
 *
 * Letting Elasticsearch infer the mapping would type `tags` and `category.slug`
 * as `text`, which analyses them — a filter on category slug "home-garden"
 * would then also match "home" and "garden" separately. Slug/sku/id are
 * `keyword` (exact), prose fields are `text` (analysed).
 */
const PRODUCT_MAPPING = {
  properties: {
    id: { type: 'keyword' },
    title: { type: 'text' },
    description: { type: 'text' },
    sku: { type: 'keyword' },
    tags: { type: 'keyword' },
    price: { type: 'double' },
    stock: { type: 'integer' },
    isAvailable: { type: 'boolean' },
    category: {
      properties: {
        id: { type: 'keyword' },
        name: { type: 'text' },
        slug: { type: 'keyword' },
      },
    },
  },
} as const

/**
 * How long a cluster-status probe stays fresh.
 *
 * 10s is short enough that a human refreshing /health sees an outage almost
 * immediately, and long enough that a 1s container probe makes ~1 round trip
 * per 10 probes instead of 1 per probe.
 */
const PING_CACHE_MS = 10_000

/** Result of a cluster-status probe, as cached by `ping()`. */
interface PingResult {
  reachable: boolean
  status?: string | undefined
  docs?: number | undefined
}

export class ProductSearchClient {
  private readonly client: Client | null
  private readonly index: string

  /**
   * Set false the moment the cluster proves unreachable, so we stop paying a
   * connection timeout on every subsequent request. `ensureIndex()` is the only
   * thing that flips it back to true.
   */
  private healthy: boolean

  /** Last ping result and when it was taken. See `ping()`. */
  private pingCache: { at: number; value: PingResult } | null = null

  /** In-flight refresh, shared by concurrent callers to avoid a stampede. */
  private pingInFlight: Promise<PingResult> | null = null

  constructor(private readonly config: SearchConfiguration) {
    this.index = config.index
    this.healthy = config.enabled
    this.client = config.enabled
      ? new Client({
          node: config.node,
          // Without a short timeout a down cluster stalls each search for the
          // 30s default before the fallback runs — far worse than no search.
          requestTimeout: 3000,
          maxRetries: 1,
        })
      : null
  }

  /** Whether callers should route search here rather than to the fallback. */
  isEnabled(): boolean {
    return this.client !== null && this.healthy
  }

  get indexName(): string {
    return this.index
  }

  get nodeUrl(): string {
    return this.config.node
  }

  /**
   * Creates the index with the explicit mapping if it does not exist.
   *
   * Returns false (rather than throwing) when the cluster is unreachable, which
   * is the normal state with the search profile down. Callers log and carry on.
   */
  async ensureIndex(): Promise<boolean> {
    if (!this.client) return false
    try {
      const exists = await this.client.indices.exists({ index: this.index })
      if (!exists) {
        await this.client.indices.create({
          index: this.index,
          mappings: PRODUCT_MAPPING as unknown as Record<string, unknown>,
        })
      }
      this.healthy = true
      return true
    } catch {
      this.healthy = false
      return false
    }
  }

  /**
   * Cluster status for the /health endpoint, cached for PING_CACHE_MS.
   *
   * /health is polled continuously by load balancers and container probes, and
   * an uncached ping put TWO Elasticsearch round trips (cluster.health + count)
   * on every one of those calls. That cost ~220ms when the cluster was up, and
   * ~2.5s when it was down, because each probe then waited out the client's
   * request timeout. A liveness endpoint that gets slower precisely when a
   * dependency fails is the wrong shape: it converts a degraded optional
   * feature into apparent unhealthiness of the whole service.
   *
   * Caching makes /health return instantly from memory between refreshes. The
   * staleness that buys is harmless here — this block is advisory (it never
   * affects the reported `status`), and a few seconds' lag on "is the search
   * index reachable" costs nothing, whereas per-request latency costs every
   * caller.
   *
   * Never throws.
   */
  async ping(): Promise<{
    reachable: boolean
    status?: string | undefined
    docs?: number | undefined
    /** Age of the returned data in ms. 0 means it was just fetched. */
    cachedAgeMs?: number | undefined
  }> {
    if (!this.client) return { reachable: false }

    const now = Date.now()
    if (this.pingCache && now - this.pingCache.at < PING_CACHE_MS) {
      return { ...this.pingCache.value, cachedAgeMs: now - this.pingCache.at }
    }

    // Collapse concurrent refreshes into one in-flight request. Without this, a
    // burst of probes arriving after the cache expires would each launch their
    // own pair of round trips — exactly the stampede the cache exists to avoid.
    if (this.pingInFlight) {
      const value = await this.pingInFlight
      return { ...value, cachedAgeMs: 0 }
    }

    this.pingInFlight = this.fetchPing()
    try {
      const value = await this.pingInFlight
      this.pingCache = { at: Date.now(), value }
      return { ...value, cachedAgeMs: 0 }
    } finally {
      this.pingInFlight = null
    }
  }

  /** Uncached probe. Always resolves; failure is reported as unreachable. */
  private async fetchPing(): Promise<{
    reachable: boolean
    status?: string | undefined
    docs?: number | undefined
  }> {
    if (!this.client) return { reachable: false }
    try {
      const health = await this.client.cluster.health({ index: this.index })
      let docs: number | undefined
      try {
        const counted = await this.client.count({ index: this.index })
        docs = counted.count
      } catch {
        // Index may not exist yet; the cluster is still reachable.
      }
      this.healthy = true
      return { reachable: true, status: health.status as string, docs }
    } catch {
      this.healthy = false
      return { reachable: false }
    }
  }

  /**
   * Upserts one product. Called after every NeDB write.
   *
   * `refresh: true` makes the change visible to the very next search. That is
   * slower than Elasticsearch's default near-real-time behaviour, but a create
   * followed by a search is exactly what a test or a user does, and a
   * one-second window where a just-created product is missing reads as a bug.
   */
  async indexProduct(product: IndexableProduct): Promise<void> {
    if (!this.client || !this.healthy) return
    const id = product.id ?? product._id
    if (!id) return
    try {
      await this.client.index({
        index: this.index,
        id,
        document: this.toDocument(product, id),
        refresh: true,
      })
    } catch {
      // Indexing is best-effort: NeDB already holds the authoritative write.
      this.healthy = false
    }
  }

  /** Bulk variant used by the seed path. Single round trip instead of N. */
  async indexProducts(products: IndexableProduct[]): Promise<number> {
    if (!this.client || !this.healthy || products.length === 0) return 0
    const indexable = products.filter((p) => (p.id ?? p._id) !== undefined)
    if (indexable.length === 0) return 0
    try {
      const operations = indexable.flatMap((product) => {
        const id = (product.id ?? product._id) as string
        return [{ index: { _index: this.index, _id: id } }, this.toDocument(product, id)]
      })
      const result = await this.client.bulk({ operations, refresh: true })
      if (result.errors) {
        const failed = result.items.filter((item) => item.index?.error).length
        return indexable.length - failed
      }
      return indexable.length
    } catch {
      this.healthy = false
      return 0
    }
  }

  /** Removes a product from the index after it is deleted from NeDB. */
  async removeProduct(id: string): Promise<void> {
    if (!this.client || !this.healthy) return
    try {
      await this.client.delete({ index: this.index, id, refresh: true })
    } catch {
      // A 404 here is fine and expected — the product may never have been
      // indexed (created while the cluster was down). Nothing to reconcile.
    }
  }

  /**
   * Full-text search, optionally narrowed to a category slug.
   *
   * Returns product ids in relevance order plus the total hit count. Ids rather
   * than documents: NeDB is the source of truth, so the caller re-reads the
   * real records and the response can never serve a stale indexed copy.
   *
   * Returns null when the cluster is unusable, which is the caller's signal to
   * fall back — distinct from an empty array, which means "searched, no match".
   */
  async searchProductIds(
    term: string,
    options: { categorySlug?: string | undefined; limit?: number } = {}
  ): Promise<{ ids: string[]; total: number } | null> {
    if (!this.client || !this.healthy) return null
    const limit = options.limit ?? 1000
    try {
      const filter: Record<string, unknown>[] = []
      if (options.categorySlug) {
        filter.push({ term: { 'category.slug': options.categorySlug } })
      }
      const response = await this.client.search({
        index: this.index,
        size: limit,
        // Only the id is needed; skipping _source keeps the response small.
        _source: false,
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: term,
                  // Title matters far more than body copy, and tags/sku are
                  // exact-ish signals worth more than a description mention.
                  fields: ['title^3', 'tags^2', 'sku^2', 'description'],
                  // One typo should not empty the result set.
                  fuzziness: 'AUTO',
                },
              },
            ],
            filter,
          },
        },
      })
      const hits = response.hits.hits
      const total =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : (response.hits.total?.value ?? hits.length)
      return { ids: hits.map((hit) => hit._id as string), total }
    } catch {
      this.healthy = false
      return null
    }
  }

  async close(): Promise<void> {
    if (!this.client) return
    try {
      await this.client.close()
    } catch {
      // Shutdown path — a failure to close cleanly must not mask the real exit.
    }
  }

  /** Projects a stored product down to the indexed fields. */
  private toDocument(product: IndexableProduct, id: string): Record<string, unknown> {
    return {
      id,
      title: product.title ?? '',
      description: product.description ?? '',
      sku: product.sku ?? '',
      tags: product.tags ?? [],
      price: product.price ?? 0,
      stock: product.stock ?? 0,
      isAvailable: product.isAvailable ?? true,
      category: {
        id: product.category?.id ?? '',
        name: product.category?.name ?? '',
        slug: product.category?.slug ?? '',
      },
    }
  }
}

export function createSearchClient(env: NodeJS.ProcessEnv = process.env): ProductSearchClient {
  return new ProductSearchClient(loadSearchConfig(env))
}
