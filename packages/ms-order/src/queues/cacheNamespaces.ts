import type IORedis from 'ioredis'
import { CACHE_NAMESPACES } from './definitions'
import { toRedisUnavailable } from './queueManager'

/**
 * Real key counts per Redis namespace, gathered with SCAN.
 *
 * NEVER use KEYS here. KEYS is O(N) over the entire keyspace and blocks the
 * Redis event loop for the duration — on a production keyspace that is a
 * service-wide stall. SCAN walks the keyspace in cursor-bounded batches and
 * yields between them.
 */

/** Keys examined per SCAN round-trip. Larger = fewer round-trips, longer per call. */
const SCAN_COUNT = 500

/** Hard ceiling on cursor iterations per prefix, so a huge keyspace cannot hang the request. */
const MAX_SCAN_ITERATIONS = 2000

export interface CacheNamespaceView {
  prefix: string
  purpose: string
  keyCount: number
  /** True when the scan hit MAX_SCAN_ITERATIONS and keyCount is a floor, not an exact count. */
  truncated: boolean
}

export interface CacheNamespaceData {
  namespaces: CacheNamespaceView[]
  totalKeys: number
  /** True if any namespace was truncated — the UI can then label the total as approximate. */
  truncated: boolean
  scannedAt: string
}

/**
 * Counts keys matching `pattern` using SCAN.
 *
 * SCAN may return the same key more than once across iterations (it guarantees
 * only that keys present for the whole scan are returned at least once), so we
 * de-duplicate via a Set rather than summing batch lengths — otherwise the
 * count can overshoot on a keyspace being written concurrently.
 */
async function countKeysMatching(
  client: IORedis,
  pattern: string
): Promise<{ count: number; truncated: boolean }> {
  const seen = new Set<string>()
  let cursor = '0'
  let iterations = 0

  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT)
    cursor = nextCursor
    for (const key of keys) {
      seen.add(key)
    }
    iterations += 1
    if (iterations >= MAX_SCAN_ITERATIONS) {
      return { count: seen.size, truncated: true }
    }
  } while (cursor !== '0')

  return { count: seen.size, truncated: false }
}

/**
 * Scans every configured namespace and returns real counts.
 *
 * Throws RedisUnavailableError when Redis is unreachable; the route maps that
 * to a 503. Returning zeros instead would be indistinguishable from a genuinely
 * empty Redis, which is precisely the ambiguity this endpoint exists to remove.
 */
export async function getCacheNamespaceData(client: IORedis): Promise<CacheNamespaceData> {
  const namespaces: CacheNamespaceView[] = []
  let anyTruncated = false

  try {
    for (const ns of CACHE_NAMESPACES) {
      const { count, truncated } = await countKeysMatching(client, ns.prefix)
      if (truncated) {
        anyTruncated = true
      }
      namespaces.push({
        prefix: ns.prefix,
        purpose: ns.purpose,
        keyCount: count,
        truncated,
      })
    }
  } catch (err) {
    throw toRedisUnavailable(err)
  }

  return {
    namespaces,
    totalKeys: namespaces.reduce((sum, ns) => sum + ns.keyCount, 0),
    truncated: anyTruncated,
    scannedAt: new Date().toISOString(),
  }
}
