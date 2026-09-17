// Shape of GET http://localhost:3003/api/v1/cache/namespaces (ms-order).
//
// `truncated` (per-namespace and top-level) means the Redis SCAN hit its cap,
// so the count is a lower bound rather than an exact figure — the UI must not
// present a truncated count as complete.

export interface CacheNamespace {
  prefix: string
  purpose: string
  keyCount: number
  truncated: boolean
}

export interface CacheData {
  namespaces: CacheNamespace[]
  totalKeys: number
  truncated: boolean
  scannedAt: string
}

// Shape of GET http://localhost:3003/api/v1/cache/keys (ms-order).
//
// `sizeBytes` is APPROXIMATE: the backend reads it with MEMORY USAGE using a
// bounded sample count, because an exact read is O(N) over the value and would
// stall Redis on a large hash or stream. `null` means the size could not be
// measured at all — render it as an em-dash, never as 0, which would look like
// a real measurement of an empty key.

export type CacheKeyType = 'string' | 'list' | 'set' | 'zset' | 'hash' | 'stream' | 'unknown'

export interface CacheKeyView {
  key: string
  type: CacheKeyType
  /** Seconds to expiry; -1 = no expiry (Redis convention), -2 = key absent. */
  ttlSeconds: number
  sizeBytes: number | null
}

export interface CacheKeysData {
  keys: CacheKeyView[]
  totalKeys: number
  /** True when more keys exist than were returned (scan hit its cap). */
  truncated: boolean
  /** True when any listed size came from sampling rather than exact measurement. */
  sizeApproximate: boolean
  scannedAt: string
}
