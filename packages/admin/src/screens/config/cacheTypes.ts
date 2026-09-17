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
