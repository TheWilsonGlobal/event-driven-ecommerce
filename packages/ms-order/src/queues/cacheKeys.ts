import type IORedis from 'ioredis'
import { toRedisUnavailable } from './queueManager'

/**
 * Individual-key listing for the admin's KV cache key browser.
 *
 * Companion to cacheNamespaces.ts, which answers "how many keys per prefix".
 * This answers "which keys, and what is in them" — type, TTL and approximate
 * size per key.
 *
 * Same hard rule as its companion: NEVER use KEYS. SCAN only. See the comment
 * block in cacheNamespaces.ts for why.
 */

/** Keys examined per SCAN round-trip. */
const SCAN_COUNT = 500

/** Hard ceiling on cursor iterations, so a huge keyspace cannot hang the request. */
const MAX_SCAN_ITERATIONS = 2000

/** Hard ceiling on keys returned in one response. */
export const MAX_KEYS_RETURNED = 1000

/**
 * Keys per pipeline flush. Bounds the size of any single Redis round-trip so a
 * full page is a handful of pipelines rather than one enormous one — and, more
 * importantly, rather than 3 * N separate round-trips.
 */
const PIPELINE_CHUNK = 200

/**
 * Nested-element sample count for MEMORY USAGE.
 *
 * MUST NOT be 0. `SAMPLES 0` means *exact*, which walks every element of an
 * aggregate — O(N), and on a large hash or stream that stalls the Redis event
 * loop exactly like KEYS would. 5 is Redis' own default and is effectively
 * O(1) regardless of how big the value is. The cost is that sizes are
 * estimates, which is why the response carries `sizeApproximate`.
 */
const MEMORY_SAMPLES = 5

const KEY_TYPES = ['string', 'list', 'set', 'zset', 'hash', 'stream'] as const

export type CacheKeyType = (typeof KEY_TYPES)[number] | 'unknown'

export interface CacheKeyView {
  key: string
  type: CacheKeyType
  /** Seconds until expiry. -1 = no expiry (Redis convention), -2 = key absent. */
  ttlSeconds: number
  /**
   * Approximate size from MEMORY USAGE. `null` means "not measurable", never
   * "zero" — the UI must render it as an em-dash rather than 0 B.
   */
  sizeBytes: number | null
}

export interface CacheKeysData {
  keys: CacheKeyView[]
  totalKeys: number
  /** True when the scan hit a ceiling; more keys exist than are listed. */
  truncated: boolean
  /** True when sizes came from sampling rather than exact measurement. */
  sizeApproximate: boolean
  scannedAt: string
}

function normalizeType(raw: unknown): CacheKeyType {
  // Redis answers TYPE with 'none' for a key that vanished between the SCAN
  // and this pipeline — a real race on a live keyspace, not an error.
  if (typeof raw !== 'string') return 'unknown'
  return (KEY_TYPES as readonly string[]).includes(raw) ? (raw as CacheKeyType) : 'unknown'
}

/**
 * Collects keys matching `pattern` using SCAN.
 *
 * De-duplicates via a Set: SCAN guarantees only that keys present for the whole
 * scan are returned *at least* once, so a concurrently-written keyspace can
 * yield the same key twice.
 *
 * Results are sorted before returning. SCAN order is not stable between calls,
 * and the admin paginates this list client-side — without a stable sort, page 2
 * would show different keys on every refetch.
 */
async function scanKeys(
  client: IORedis,
  pattern: string,
  cap: number
): Promise<{ keys: string[]; truncated: boolean }> {
  const seen = new Set<string>()
  let cursor = '0'
  let iterations = 0

  do {
    const [nextCursor, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT)
    cursor = nextCursor
    for (const key of batch) {
      seen.add(key)
    }
    iterations += 1
    if (seen.size >= cap || iterations >= MAX_SCAN_ITERATIONS) {
      return { keys: [...seen].sort((a, b) => a.localeCompare(b)).slice(0, cap), truncated: true }
    }
  } while (cursor !== '0')

  return { keys: [...seen].sort((a, b) => a.localeCompare(b)), truncated: false }
}

/**
 * Fetches TYPE, TTL and MEMORY USAGE for each key via pipelined batches.
 *
 * A failure on one key degrades that key's field ('unknown' / -2 / null)
 * rather than failing the whole request: one key expiring mid-flight should
 * not blank the entire browser. Only a connection-level throw from exec()
 * propagates, and the caller maps that to a 503.
 */
async function describeKeys(client: IORedis, keys: string[]): Promise<CacheKeyView[]> {
  const views: CacheKeyView[] = []

  for (let offset = 0; offset < keys.length; offset += PIPELINE_CHUNK) {
    const chunk = keys.slice(offset, offset + PIPELINE_CHUNK)
    const pipeline = client.pipeline()
    for (const key of chunk) {
      pipeline.type(key)
      pipeline.ttl(key)
      pipeline.call('MEMORY', 'USAGE', key, 'SAMPLES', String(MEMORY_SAMPLES))
    }

    const results = await pipeline.exec()

    chunk.forEach((key, index) => {
      // exec() returns [error, value] pairs in command order: three per key.
      const typeResult = results?.[index * 3]
      const ttlResult = results?.[index * 3 + 1]
      const memoryResult = results?.[index * 3 + 2]

      const type = typeResult && !typeResult[0] ? normalizeType(typeResult[1]) : 'unknown'
      const ttlRaw = ttlResult && !ttlResult[0] ? ttlResult[1] : undefined
      const memoryRaw = memoryResult && !memoryResult[0] ? memoryResult[1] : undefined

      views.push({
        key,
        type,
        ttlSeconds: typeof ttlRaw === 'number' ? ttlRaw : -2,
        sizeBytes: typeof memoryRaw === 'number' ? memoryRaw : null,
      })
    })
  }

  return views
}

/**
 * Lists individual keys with their type, TTL and approximate size.
 *
 * Throws RedisUnavailableError when Redis is unreachable; the route maps that
 * to a 503 rather than an empty 200, for the reason given in routes.ts.
 */
export async function getCacheKeyData(
  client: IORedis,
  options: { pattern?: string | undefined; limit?: number | undefined } = {}
): Promise<CacheKeysData> {
  const pattern = options.pattern && options.pattern.length > 0 ? options.pattern : '*'
  const limit = Math.min(Math.max(options.limit ?? MAX_KEYS_RETURNED, 1), MAX_KEYS_RETURNED)

  try {
    const { keys, truncated } = await scanKeys(client, pattern, limit)
    const views = await describeKeys(client, keys)

    return {
      keys: views,
      totalKeys: views.length,
      truncated,
      // MEMORY USAGE with SAMPLES > 0 is an estimate by construction, so any
      // measured size makes the set approximate.
      sizeApproximate: views.some((view) => view.sizeBytes !== null),
      scannedAt: new Date().toISOString(),
    }
  } catch (err) {
    throw toRedisUnavailable(err)
  }
}
