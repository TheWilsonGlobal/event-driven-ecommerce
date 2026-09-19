import type { KeyspaceBackend, KeyspaceInspector } from './keyspaceInspector'
import { toRedisUnavailable } from './errors'

/**
 * Individual-key listing for the admin's KV cache key browser.
 *
 * Companion to cacheNamespaces.ts, which answers "how many keys per prefix".
 * This answers "which keys, and what is in them" — type, TTL and size per key.
 *
 * Backend-agnostic: the scanning and describing is done by a KeyspaceInspector
 * so the same logic serves Redis and the embedded file-backed store.
 */

/** Hard ceiling on keys returned in one response. */
export const MAX_KEYS_RETURNED = 1000

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
  /** Which store answered — 'redis' or the embedded file-backed store. */
  backend: KeyspaceBackend
  scannedAt: string
}

function normalizeType(raw: unknown): CacheKeyType {
  // Redis answers TYPE with 'none' for a key that vanished between the SCAN
  // and this pipeline — a real race on a live keyspace, not an error.
  if (typeof raw !== 'string') return 'unknown'
  return (KEY_TYPES as readonly string[]).includes(raw) ? (raw as CacheKeyType) : 'unknown'
}

/**
 * Lists individual keys with their type, TTL and approximate size.
 *
 * Throws RedisUnavailableError when Redis is unreachable; the route maps that
 * to a 503 rather than an empty 200, for the reason given in routes.ts.
 */
export async function getCacheKeyData(
  inspector: KeyspaceInspector,
  options: { pattern?: string | undefined; limit?: number | undefined } = {}
): Promise<CacheKeysData> {
  const pattern = options.pattern && options.pattern.length > 0 ? options.pattern : '*'
  const limit = Math.min(Math.max(options.limit ?? MAX_KEYS_RETURNED, 1), MAX_KEYS_RETURNED)

  try {
    const { keys, truncated } = await inspector.scanKeys(pattern, limit)
    const described = await inspector.describeKeys(keys)
    const views: CacheKeyView[] = described.map((entry) => ({
      key: entry.key,
      type: normalizeType(entry.type),
      ttlSeconds: entry.ttlSeconds,
      sizeBytes: entry.sizeBytes,
    }))

    return {
      keys: views,
      totalKeys: views.length,
      truncated,
      backend: inspector.backend,
      // Only claim approximation when the backend samples AND something was
      // actually measured; the embedded store reports exact byte lengths.
      sizeApproximate: inspector.sizeIsApproximate && views.some((view) => view.sizeBytes !== null),
      scannedAt: new Date().toISOString(),
    }
  } catch (err) {
    throw toRedisUnavailable(err)
  }
}
