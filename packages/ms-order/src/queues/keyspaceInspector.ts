import type IORedis from 'ioredis'
import type { KeyValueStoreAdapter } from '@ecommerce/shared-database'

/**
 * The slice of a key-value backend that the cache introspection endpoints need.
 *
 * Exists so getCacheNamespaceData() and getCacheKeyData() are written once and
 * work against either Redis or the embedded file-backed store, instead of
 * duplicating the namespace/aggregation logic per backend.
 *
 * Deliberately narrow: listing and describing keys, nothing else. Reads and
 * writes stay with whichever client owns them.
 */

export type KeyspaceBackend = 'redis' | 'embedded'

export interface KeyspaceEntry {
  key: string
  type: string
  /** Redis TTL semantics: -1 = no expiry, -2 = absent. */
  ttlSeconds: number
  /** null = not measurable on this backend. Never render it as 0. */
  sizeBytes: number | null
}

export interface KeyspaceScanResult {
  keys: string[]
  truncated: boolean
}

export interface KeyspaceInspector {
  readonly backend: KeyspaceBackend
  /**
   * True when sizes are estimates. Redis samples nested elements; the embedded
   * store measures the stored string exactly.
   */
  readonly sizeIsApproximate: boolean
  scanKeys(pattern: string, cap: number): Promise<KeyspaceScanResult>
  describeKeys(keys: string[]): Promise<KeyspaceEntry[]>
}

/** Keys examined per SCAN round-trip. */
const SCAN_COUNT = 500

/** Hard ceiling on cursor iterations, so a huge keyspace cannot hang a request. */
const MAX_SCAN_ITERATIONS = 2000

/** Keys per pipeline flush — bounds the size of a single Redis round-trip. */
const PIPELINE_CHUNK = 200

/**
 * Nested-element sample count for MEMORY USAGE.
 *
 * MUST NOT be 0: `SAMPLES 0` means *exact*, which walks every element of an
 * aggregate — O(N), and on a large hash or stream that stalls the Redis event
 * loop exactly as KEYS would. 5 is Redis' own default and is effectively O(1).
 */
const MEMORY_SAMPLES = 5

function sortKeys(keys: Iterable<string>): string[] {
  // Sorted because SCAN order is not stable between calls and the admin
  // paginates client-side; an unstable order reshuffles pages on every refetch.
  return [...keys].sort((a, b) => a.localeCompare(b))
}

/** Redis-backed inspector: SCAN to list, one pipeline to describe. */
export class RedisKeyspaceInspector implements KeyspaceInspector {
  readonly backend = 'redis' as const
  readonly sizeIsApproximate = true

  constructor(private readonly client: IORedis) {}

  /**
   * Collects keys matching `pattern` with SCAN. NEVER KEYS — see the comment
   * block in cacheNamespaces.ts.
   *
   * De-duplicates via a Set: SCAN guarantees only that keys present for the
   * whole scan are returned at least once, so a concurrently-written keyspace
   * can yield the same key twice.
   */
  async scanKeys(pattern: string, cap: number): Promise<KeyspaceScanResult> {
    const seen = new Set<string>()
    let cursor = '0'
    let iterations = 0

    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT)
      cursor = next
      for (const key of batch) {
        seen.add(key)
      }
      iterations += 1
      if (seen.size >= cap || iterations >= MAX_SCAN_ITERATIONS) {
        return { keys: sortKeys(seen).slice(0, cap), truncated: true }
      }
    } while (cursor !== '0')

    return { keys: sortKeys(seen), truncated: false }
  }

  /**
   * TYPE, TTL and MEMORY USAGE per key, pipelined in chunks.
   *
   * A failure on one key degrades that key's field rather than failing the
   * request: one key expiring mid-flight should not blank the whole browser.
   * Only a connection-level throw from exec() propagates to the caller.
   */
  async describeKeys(keys: string[]): Promise<KeyspaceEntry[]> {
    const entries: KeyspaceEntry[] = []

    for (let offset = 0; offset < keys.length; offset += PIPELINE_CHUNK) {
      const chunk = keys.slice(offset, offset + PIPELINE_CHUNK)
      const pipeline = this.client.pipeline()
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

        const rawType = typeResult && !typeResult[0] ? typeResult[1] : undefined
        const rawTtl = ttlResult && !ttlResult[0] ? ttlResult[1] : undefined
        const rawSize = memoryResult && !memoryResult[0] ? memoryResult[1] : undefined

        entries.push({
          key,
          // TYPE answers 'none' for a key that vanished between the SCAN and
          // this pipeline — a real race on a live keyspace, not an error.
          type: typeof rawType === 'string' && rawType !== 'none' ? rawType : 'unknown',
          ttlSeconds: typeof rawTtl === 'number' ? rawTtl : -2,
          sizeBytes: typeof rawSize === 'number' ? rawSize : null,
        })
      })
    }

    return entries
  }
}

/**
 * Embedded-store inspector.
 *
 * Every value is a stored string, so the type is always 'string' and the size
 * is the exact UTF-8 byte length — not a sample. That is a real difference
 * from the Redis path and is reported honestly via `sizeIsApproximate`.
 */
export class EmbeddedKeyspaceInspector implements KeyspaceInspector {
  readonly backend = 'embedded' as const
  readonly sizeIsApproximate = false

  constructor(private readonly store: KeyValueStoreAdapter) {}

  async scanKeys(pattern: string, cap: number): Promise<KeyspaceScanResult> {
    return this.store.scan(pattern, cap)
  }

  async describeKeys(keys: string[]): Promise<KeyspaceEntry[]> {
    return Promise.all(
      keys.map(async (key) => {
        const [value, ttlSeconds] = await Promise.all([this.store.get(key), this.store.ttl(key)])
        return {
          key,
          type: value === null ? 'unknown' : 'string',
          ttlSeconds,
          sizeBytes: value === null ? null : Buffer.byteLength(value, 'utf8'),
        }
      })
    )
  }
}
