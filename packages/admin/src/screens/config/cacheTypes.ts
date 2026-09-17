// Shape of GET http://localhost:3003/api/v1/cache/namespaces (ms-order).
//
// `truncated` (per-namespace and top-level) means the Redis SCAN hit its cap,
// so the count is a lower bound rather than an exact figure — the UI must not
// present a truncated count as complete.

/** Key counts by Redis type; types outside the broken-out set fold into `other`. */
export interface CacheTypeBreakdown {
  hash: number
  stream: number
  string: number
  zset: number
  other: number
}

export interface CacheNamespace {
  prefix: string
  purpose: string
  keyCount: number
  truncated: boolean
  /** Per-type counts. Sums to keyCount unless typesPartial is true. */
  types: CacheTypeBreakdown
  /** True when only the first N keys were TYPE-probed, so the breakdown is a subset. */
  typesPartial: boolean
}

export interface CacheData {
  namespaces: CacheNamespace[]
  totalKeys: number
  truncated: boolean
  /** Per-type totals across every namespace. */
  types: CacheTypeBreakdown
  /** True when any namespace's breakdown is partial. */
  typesPartial: boolean
  /** Which store answered — 'redis' or the embedded file-backed store. */
  backend: KeyspaceBackend
  scannedAt: string
}

export type KeyspaceBackend = 'redis' | 'embedded'

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
  /** Which store answered — 'redis' or the embedded file-backed store. */
  backend: KeyspaceBackend
  scannedAt: string
}

// Shape of GET http://localhost:3003/api/v1/cache/driver (ms-order).
//
// Reports the driver this process actually resolved at boot, so the admin can
// render the real backend instead of asserting one. It has no 503 branch: it
// answers even when Redis is down, which is exactly when an operator needs it.

export interface CacheDriverInfo {
  driver: 'redis' | 'rocksdb' | 'embedded'
  backend: KeyspaceBackend
  label: string
  /** host:port on Redis, null on the embedded driver. */
  host: string | null
  /** Snapshot path on the embedded driver, null on Redis. */
  dataPath: string | null
  inMemory: boolean
  /** False on the embedded driver: BullMQ requires real Redis. */
  queuesAvailable: boolean
  /** Non-null when a snapshot existed but could not be read. */
  loadError: string | null
}
