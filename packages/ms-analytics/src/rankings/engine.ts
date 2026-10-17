import {
  pruneSalesLines,
  readSalesBuckets,
  readSalesTotals,
  type AnalyticsStore,
  type SalesLine,
} from '../aggregates/store'
import { topProductsView } from '../aggregates/views'
import {
  KEY_ID,
  LONGEST_WINDOW_MS,
  WINDOWS,
  WINDOW_SPECS,
  bucketExpiryMs,
  bucketIndex,
  inWindow,
  liveBuckets,
  type RankWindow,
} from './windows'

/**
 * Real-time sales rank engine.
 *
 *   write   order.created (after the Postgres commit that claimed the eventId)
 *             -> ZINCRBY rank:global:{w}:b{n}  and rank:cat:{cat}:{w}:b{n}
 *   read    ZUNIONSTORE the live buckets into rank:global:{w} / rank:cat:{cat}:{w}
 *             -> ZREVRANGE ... WITHSCORES
 *   rebuild recompute every bucket from Postgres sales_lines
 *
 * Idempotency: Redis is touched only when the processed_events claim succeeded,
 * so a redelivered eventId never reaches it. The one gap is a crash (or Redis
 * error) between the Postgres commit and the ZINCRBY: that loses an increment,
 * never double counts. A failed write marks the engine stale and the next read
 * rebuilds from Postgres, so the drift is repaired rather than served.
 *
 * Rebuild race: rebuild snapshots Postgres then swaps the buckets in one MULTI.
 * An event committed after the snapshot whose ZINCRBY lands before the swap is
 * wiped by it until the next rebuild. The window is milliseconds and only
 * exists while a rebuild runs.
 */

/** Narrow slice of an ioredis pipeline, so tests can supply a fake. */
export interface RankPipeline {
  zincrby(key: string, increment: number, member: string): this
  pexpireat(key: string, ms: number): this
  del(...keys: string[]): this
  zadd(key: string, score: number, member: string): this
  set(key: string, value: string): this
  zunionstore(dest: string, numKeys: number, ...keys: string[]): this
  pexpire(key: string, ms: number): this
  zrevrange(key: string, start: number, stop: number, withScores: 'WITHSCORES'): this
  exec(): Promise<[Error | null, unknown][] | null>
}

export interface RankRedis {
  multi(): RankPipeline
  exists(key: string): Promise<number>
  scan(
    cursor: string,
    match: 'MATCH',
    pattern: string,
    count: 'COUNT',
    n: number
  ): Promise<[string, string[]]>
  quit(): Promise<unknown>
}

export interface RankedItem {
  rank: number
  productId: string
  unitsSold: number
}

export interface RankingResult {
  source: 'redis' | 'postgres'
  /** The window the caller asked for. */
  window: RankWindow
  /**
   * The window the numbers actually cover. Equal to `window` except when the
   * global ranking falls back to the all-time product_counters view.
   */
  windowApplied: RankWindow | 'all-time'
  limit: number
  generatedAt: string
  products: RankedItem[]
}

export interface RankingSink {
  recordOrder(input: { occurredAt: Date; lines: SalesLine[] }): Promise<void>
}

export interface RankingEngineOptions {
  /** Key namespace. 'rank' in production; tests use a unique prefix. */
  prefix?: string
  now?: () => number
  log?: (message: string) => void
}

export interface RankQuery {
  window: RankWindow
  limit: number
  categoryId?: string
}

const MAX_PRODUCT_ID_LENGTH = 128

/** Merges duplicate productId lines (summing quantity) and drops unusable ones. */
export function mergeLines(lines: SalesLine[]): SalesLine[] {
  const merged = new Map<string, SalesLine>()
  for (const line of lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue
    if (line.productId.length === 0 || line.productId.length > MAX_PRODUCT_ID_LENGTH) continue
    const prev = merged.get(line.productId)
    if (prev) {
      prev.quantity += line.quantity
      prev.categoryId = prev.categoryId ?? line.categoryId
    } else {
      merged.set(line.productId, { ...line })
    }
  }
  return [...merged.values()]
}

export class RankingEngine implements RankingSink {
  private readonly prefix: string
  private readonly now: () => number
  private readonly log: (message: string) => void
  private stale = false
  private rebuilding: Promise<{ rows: number }> | null = null

  constructor(
    private readonly redis: RankRedis,
    private readonly store: AnalyticsStore,
    options: RankingEngineOptions = {}
  ) {
    this.prefix = options.prefix ?? 'rank'
    this.now = options.now ?? Date.now
    this.log = options.log ?? (() => undefined)
  }

  private bucketKey(scope: string, w: RankWindow, bucket: number): string {
    return `${this.prefix}:${scope}:${w}:b${bucket}`
  }
  private viewKey(scope: string, w: RankWindow): string {
    return `${this.prefix}:${scope}:${w}`
  }
  private get readyKey(): string {
    return `${this.prefix}:meta:ready`
  }
  /** The category set is skipped (never invented) without a key-safe category id. */
  private scopesOf(categoryId: string | null): string[] {
    return categoryId && KEY_ID.test(categoryId) ? ['global', `cat:${categoryId}`] : ['global']
  }

  private assertExec(results: [Error | null, unknown][] | null): void {
    if (!results) throw new Error('redis pipeline aborted')
    for (const [err] of results) if (err) throw err
  }

  /**
   * Counts one applied order. Never throws: a Redis failure must not fail the
   * event (Postgres already committed it); it marks the engine stale instead.
   */
  async recordOrder({
    occurredAt,
    lines,
  }: {
    occurredAt: Date
    lines: SalesLine[]
  }): Promise<void> {
    try {
      const nowMs = this.now()
      const occurredMs = occurredAt.getTime()
      const pipe = this.redis.multi()
      let writes = 0
      for (const line of mergeLines(lines)) {
        for (const w of WINDOWS) {
          const spec = WINDOW_SPECS[w]
          // A replayed old event outside the window must not enter it.
          if (!inWindow(occurredMs, nowMs, spec)) continue
          const bucket = bucketIndex(occurredMs, spec)
          for (const scope of this.scopesOf(line.categoryId)) {
            const key = this.bucketKey(scope, w, bucket)
            pipe
              .zincrby(key, line.quantity, line.productId)
              .pexpireat(key, bucketExpiryMs(bucket, spec))
            writes += 1
          }
        }
      }
      if (writes === 0) return
      this.assertExec(await pipe.exec())
    } catch (err) {
      this.stale = true
      this.log(`rank write failed, will rebuild on next read: ${(err as Error).message}`)
    }
  }

  /** True once the ring has been (re)built since the last flush. */
  async isReady(): Promise<boolean> {
    return (await this.redis.exists(this.readyKey)) === 1
  }

  /** Rebuilds when the ready marker is missing (flush / first boot) or a write failed. */
  async ensureReady(): Promise<void> {
    if (this.stale || !(await this.isReady())) await this.rebuild()
  }

  /** Throws on Redis/Postgres failure; the caller decides about falling back. */
  async top({ window: w, limit, categoryId }: RankQuery): Promise<RankingResult> {
    await this.ensureReady()
    const scope = categoryId ? `cat:${categoryId}` : 'global'
    const nowMs = this.now()
    const sources = liveBuckets(nowMs, WINDOW_SPECS[w]).map((b) => this.bucketKey(scope, w, b))
    const view = this.viewKey(scope, w)

    // ZUNIONSTORE over absent keys is valid and yields an empty (absent) dest.
    const results = await this.redis
      .multi()
      .zunionstore(view, sources.length, ...sources)
      .pexpire(view, 10_000)
      .zrevrange(view, 0, limit - 1, 'WITHSCORES')
      .exec()
    this.assertExec(results)
    const flat = (results?.[2]?.[1] ?? []) as string[]

    const products: RankedItem[] = []
    for (let i = 0; i < flat.length; i += 2) {
      products.push({
        rank: products.length + 1,
        productId: flat[i] as string,
        unitsSold: Number(flat[i + 1]),
      })
    }
    return {
      source: 'redis',
      window: w,
      windowApplied: w,
      limit,
      generatedAt: new Date(nowMs).toISOString(),
      products,
    }
  }

  /** Single-flight: concurrent callers share one rebuild. */
  rebuild(): Promise<{ rows: number }> {
    if (!this.rebuilding) {
      this.rebuilding = this.doRebuild().finally(() => {
        this.rebuilding = null
      })
    }
    return this.rebuilding
  }

  private async doRebuild(): Promise<{ rows: number }> {
    const nowMs = this.now()
    // Rows older than the longest window can never rank again.
    await pruneSalesLines(this.store, new Date(nowMs - LONGEST_WINDOW_MS - 24 * 3_600_000))

    // Snapshot Postgres first, then swap in one MULTI.
    const pipe = this.redis.multi()
    for (const key of await this.scanKeys(`${this.prefix}:*`)) pipe.del(key)

    let rows = 0
    for (const w of WINDOWS) {
      const spec = WINDOW_SPECS[w]
      const current = bucketIndex(nowMs, spec)
      const oldest = current - spec.windowMs / spec.bucketMs + 1
      const found = await readSalesBuckets(
        this.store,
        new Date(oldest * spec.bucketMs),
        spec.bucketMs
      )
      for (const row of found) {
        if (row.bucket < oldest || row.bucket > current) continue
        for (const scope of this.scopesOf(row.categoryId)) {
          const key = this.bucketKey(scope, w, row.bucket)
          // Two rows can share a key (several products, same bucket) but never
          // a member within it; a product with and without a category lands in
          // the same global bucket, so the global scope must ADD, not overwrite.
          pipe
            .zincrby(key, row.units, row.productId)
            .pexpireat(key, bucketExpiryMs(row.bucket, spec))
        }
        rows += 1
      }
    }
    pipe.set(this.readyKey, new Date(nowMs).toISOString())
    this.assertExec(await pipe.exec())
    this.stale = false
    this.log(`rank rebuilt from Postgres (${rows} bucket rows)`)
    return { rows }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = []
    let cursor = '0'
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500)
      keys.push(...batch)
      cursor = next
    } while (cursor !== '0')
    return keys
  }

  /** Postgres answer for when this engine's Redis cannot serve the request. */
  fallback(query: RankQuery): Promise<RankingResult> {
    return postgresRanking(this.store, query, this.now())
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined)
  }
}

/**
 * Postgres-only ranking, used when no Redis engine exists or Redis failed.
 * The global ranking is the existing all-time topProductsView (windowApplied
 * 'all-time'); a category ranking has no all-time source, so it reads the
 * windowed sales_lines directly.
 */
export async function postgresRanking(
  store: AnalyticsStore,
  { window: w, limit, categoryId }: RankQuery,
  nowMs: number = Date.now()
): Promise<RankingResult> {
  const base = {
    source: 'postgres' as const,
    window: w,
    limit,
    generatedAt: new Date(nowMs).toISOString(),
  }
  if (!categoryId) {
    const view = await topProductsView(store, limit)
    return {
      ...base,
      windowApplied: 'all-time',
      products: view.products.map((p, i) => ({
        rank: i + 1,
        productId: p.productId,
        unitsSold: p.unitsOrdered,
      })),
    }
  }
  const found = await readSalesTotals(
    store,
    new Date(nowMs - WINDOW_SPECS[w].windowMs),
    categoryId,
    limit
  )
  return {
    ...base,
    windowApplied: w,
    products: found.map((r, i) => ({ rank: i + 1, productId: r.productId, unitsSold: r.units })),
  }
}
