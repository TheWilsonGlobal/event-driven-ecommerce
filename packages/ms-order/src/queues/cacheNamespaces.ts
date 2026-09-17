import type { KeyspaceBackend, KeyspaceInspector } from './keyspaceInspector'
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

/**
 * Upper bound on keys counted per namespace. A namespace with more than this
 * reports `truncated`, and the count is a floor rather than an exact figure.
 */
const NAMESPACE_SCAN_CAP = 100000

/**
 * Upper bound on keys TYPE-probed per namespace.
 *
 * Counting is cheap (SCAN alone), but the per-type breakdown needs a TYPE call
 * per key. That is pipelined, yet still one command per key — so on a huge
 * namespace it is capped and the breakdown is reported as partial rather than
 * quietly under-counting. Well above any realistic namespace here.
 */
const TYPE_PROBE_CAP = 5000

/** Key types broken out per namespace; other Redis types fold into `other`. */
export interface CacheTypeBreakdown {
  hash: number
  stream: number
  string: number
  zset: number
  other: number
}

export interface CacheNamespaceView {
  prefix: string
  purpose: string
  keyCount: number
  /** True when the scan hit MAX_SCAN_ITERATIONS and keyCount is a floor, not an exact count. */
  truncated: boolean
  /** Per-type counts. Sums to keyCount unless typesPartial is true. */
  types: CacheTypeBreakdown
  /**
   * True when more keys exist than were TYPE-probed, so the breakdown covers
   * only the first TYPE_PROBE_CAP keys. The UI must not present it as complete.
   */
  typesPartial: boolean
}

export interface CacheNamespaceData {
  namespaces: CacheNamespaceView[]
  totalKeys: number
  /** True if any namespace was truncated — the UI can then label the total as approximate. */
  truncated: boolean
  /** Per-type totals across every namespace. */
  types: CacheTypeBreakdown
  /** True when any namespace's breakdown is partial. */
  typesPartial: boolean
  /** Which store answered — 'redis' or the embedded file-backed store. */
  backend: KeyspaceBackend
  scannedAt: string
}

/**
 * Scans every configured namespace and returns real counts.
 *
 * Throws RedisUnavailableError when Redis is unreachable; the route maps that
 * to a 503. Returning zeros instead would be indistinguishable from a genuinely
 * empty Redis, which is precisely the ambiguity this endpoint exists to remove.
 */
export async function getCacheNamespaceData(
  inspector: KeyspaceInspector
): Promise<CacheNamespaceData> {
  const namespaces: CacheNamespaceView[] = []
  let anyTruncated = false

  try {
    for (const ns of CACHE_NAMESPACES) {
      const { keys, truncated } = await inspector.scanKeys(ns.prefix, NAMESPACE_SCAN_CAP)
      if (truncated) {
        anyTruncated = true
      }

      const probed = keys.slice(0, TYPE_PROBE_CAP)
      const described = probed.length > 0 ? await inspector.describeKeys(probed) : []
      const types: CacheTypeBreakdown = { hash: 0, stream: 0, string: 0, zset: 0, other: 0 }
      for (const entry of described) {
        if (entry.type === 'hash') types.hash += 1
        else if (entry.type === 'stream') types.stream += 1
        else if (entry.type === 'string') types.string += 1
        else if (entry.type === 'zset') types.zset += 1
        else types.other += 1
      }

      namespaces.push({
        prefix: ns.prefix,
        purpose: ns.purpose,
        keyCount: keys.length,
        truncated,
        types,
        typesPartial: keys.length > probed.length,
      })
    }
  } catch (err) {
    throw toRedisUnavailable(err)
  }

  const totals: CacheTypeBreakdown = { hash: 0, stream: 0, string: 0, zset: 0, other: 0 }
  for (const ns of namespaces) {
    totals.hash += ns.types.hash
    totals.stream += ns.types.stream
    totals.string += ns.types.string
    totals.zset += ns.types.zset
    totals.other += ns.types.other
  }

  return {
    namespaces,
    totalKeys: namespaces.reduce((sum, ns) => sum + ns.keyCount, 0),
    truncated: anyTruncated,
    types: totals,
    typesPartial: namespaces.some((ns) => ns.typesPartial),
    backend: inspector.backend,
    scannedAt: new Date().toISOString(),
  }
}
