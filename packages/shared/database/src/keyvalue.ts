import * as fs from 'fs'
import * as path from 'path'
import type { DatabaseConfiguration } from './config'

export interface ScanResult {
  keys: string[]
  /** True when the scan stopped at `limit` and more keys match. */
  truncated: boolean
}

export interface KeyValueStoreAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number | undefined): Promise<void>
  del(key: string): Promise<boolean>
  exists(key: string): Promise<boolean>
  flush(): Promise<void>
  /**
   * Keys matching a Redis-style glob (`*` and `?` only — character classes are
   * deliberately not supported; see globToRegExp).
   *
   * Returns every match up to `limit` rather than exposing a cursor: a cursor
   * would be fiction over a Map that callers can mutate between calls, and the
   * consumers of this interface want "all matches, bounded".
   */
  scan(pattern?: string | undefined, limit?: number | undefined): Promise<ScanResult>
  /** Redis TTL semantics: seconds remaining, -1 = no expiry, -2 = key absent. */
  ttl(key: string): Promise<number>
  /**
   * Flushes pending writes and releases resources. Optional: an adapter with
   * no durable state has nothing to close. Callers should invoke it on
   * shutdown so a debounced snapshot is not lost.
   */
  close?(): Promise<void>
}

/** Snapshot file format. `version` gates forward-compatibility. */
interface KeyValueSnapshot {
  version: number
  savedAt: string
  entries: [string, { value: string; expiresAt?: number | undefined }][]
}

const SNAPSHOT_VERSION = 1
const SNAPSHOT_FILENAME = 'keyvalue.db'

/**
 * Delay before a mutation is persisted. Batches a burst of writes into one
 * file write instead of one per `set`.
 */
const WRITE_DEBOUNCE_MS = 250

/** Retry delay after a failed rename (Windows AV/indexer holding the handle). */
const RENAME_RETRY_MS = 50

const DEFAULT_SCAN_LIMIT = 1000

/**
 * Converts a Redis glob to an anchored RegExp.
 *
 * Iterates character by character so `*` and `?` are interpreted BEFORE the
 * escaping pass. Escaping the whole string first and then un-escaping the
 * wildcards is the classic bug here: it corrupts any pattern containing a
 * literal `.` or `+`, which Redis key names routinely do.
 *
 * `[abc]` character classes are NOT supported — Redis accepts them, but
 * half-implementing them would silently mismatch. Callers needing them should
 * filter the result set themselves.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (const char of pattern) {
    if (char === '*') {
      source += '.*'
    } else if (char === '?') {
      source += '.'
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

/** Compiled-pattern cache, bounded so a hostile caller cannot grow it forever. */
const PATTERN_CACHE = new Map<string, RegExp>()
const PATTERN_CACHE_LIMIT = 32

function compilePattern(pattern: string): RegExp {
  const cached = PATTERN_CACHE.get(pattern)
  if (cached) return cached
  const compiled = globToRegExp(pattern)
  if (PATTERN_CACHE.size >= PATTERN_CACHE_LIMIT) {
    PATTERN_CACHE.clear()
  }
  PATTERN_CACHE.set(pattern, compiled)
  return compiled
}

/**
 * Embedded key-value store: an in-process Map, optionally persisted to a JSON
 * snapshot on disk.
 *
 * This is the implementation behind `KV_CACHE_DRIVER=rocksdb|embedded`. It is
 * NOT RocksDB — it is a debounced JSON snapshot, which is why callers should
 * describe it as "embedded (file-backed)". The `rocksdb` driver name is kept
 * as a legacy alias because `.env` and the config type already use it.
 *
 * Shape follows EmbeddedDocumentStore in document.ts: the constructor is
 * synchronous and never throws, load happens on a `readyPromise`, and every
 * async method awaits it before touching state.
 *
 * SINGLE-WRITER ASSUMPTION: one process owns one snapshot file. Two processes
 * pointed at the same path will last-writer-wins and silently lose data. The
 * pid-suffixed temp file prevents *corruption* from interleaved writes, not
 * that loss. No locking is implemented.
 */
export class EmbeddedKeyValueStore implements KeyValueStoreAdapter {
  private store: Map<string, { value: string; expiresAt?: number | undefined }> = new Map()
  private dataPath: string | undefined
  private filePath: string | undefined
  private readonly persistent: boolean
  private readyPromise: Promise<void>
  private writeTimer: NodeJS.Timeout | null = null
  /** Serialises snapshot writes so two flushes cannot interleave on one file. */
  private writeChain: Promise<void> = Promise.resolve()
  private lastLoadError: Error | null = null
  private closed = false

  constructor(dataPath?: string | undefined, inMemory?: boolean | undefined) {
    this.dataPath = dataPath
    this.persistent = !inMemory && !!dataPath
    this.filePath = this.persistent
      ? EmbeddedKeyValueStore.resolveFilePath(dataPath as string)
      : undefined
    this.readyPromise = this.load()
  }

  /**
   * Resolves the snapshot path. A `dataPath` ending in `.db` is used verbatim;
   * anything else is treated as a directory holding `keyvalue.db`. Mirrors
   * EmbeddedDocumentStore.resolveFilePath.
   */
  private static resolveFilePath(dataPath: string): string {
    if (dataPath.toLowerCase().endsWith('.db')) {
      return dataPath
    }
    return path.join(dataPath, SNAPSHOT_FILENAME)
  }

  /**
   * Reads the snapshot, sweeping entries that expired while the process was
   * down.
   *
   * Never throws and never deletes the file. A missing file is first boot, not
   * an error. A corrupt or future-version file leaves the store empty and is
   * recorded in `getLastLoadError()` — clobbering it would destroy data the
   * operator may want to recover, and throwing would break the "constructor
   * never throws" contract this class shares with EmbeddedDocumentStore.
   */
  private async load(): Promise<void> {
    if (!this.persistent || !this.filePath) return

    try {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
      const raw = await fs.promises.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as KeyValueSnapshot

      if (!parsed || parsed.version !== SNAPSHOT_VERSION || !Array.isArray(parsed.entries)) {
        this.lastLoadError = new Error(
          `Unsupported snapshot at ${this.filePath} (version ${String(parsed?.version)}); starting empty.`
        )
        return
      }

      const now = Date.now()
      let swept = 0
      for (const [key, entry] of parsed.entries) {
        if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
          swept += 1
          continue
        }
        this.store.set(key, entry)
      }

      // Converge the file so expired entries do not linger across restarts.
      if (swept > 0) this.scheduleWrite()
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return // First boot: no snapshot yet.
      this.lastLoadError = err instanceof Error ? err : new Error(String(err))
    }
  }

  private async ready(): Promise<void> {
    return this.readyPromise
  }

  getDataPath(): string | undefined {
    return this.dataPath
  }

  /** Absolute snapshot path, or undefined when running in memory. */
  getFilePath(): string | undefined {
    return this.filePath
  }

  /** Non-null when the snapshot existed but could not be read. */
  getLastLoadError(): Error | null {
    return this.lastLoadError
  }

  isPersistent(): boolean {
    return this.persistent
  }

  /** Drops an entry that has passed its TTL. Lazy expiry, as Redis does. */
  private liveEntry(key: string): { value: string; expiresAt?: number | undefined } | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry
  }

  private scheduleWrite(): void {
    if (!this.persistent || this.closed) return
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      // Errors are swallowed into the chain: an unhandled rejection from a
      // timer callback would take the whole host process down.
      this.writeChain = this.writeChain.then(() => this.writeSnapshot()).catch(() => undefined)
    }, WRITE_DEBOUNCE_MS)
    // Do not let a pending snapshot keep the event loop alive at shutdown.
    this.writeTimer.unref?.()
  }

  /**
   * Writes the snapshot via temp file + rename.
   *
   * The temp name carries the pid so two processes sharing a path cannot write
   * the same temp file. On Windows the rename can fail with EPERM/EBUSY when a
   * virus scanner or the search indexer briefly holds the target, so it is
   * retried once and then falls back to writing in place — a non-atomic write
   * is better than losing the data entirely.
   */
  private async writeSnapshot(): Promise<void> {
    if (!this.persistent || !this.filePath) return

    const snapshot: KeyValueSnapshot = {
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      entries: [...this.store.entries()],
    }
    const json = JSON.stringify(snapshot)
    const tempPath = `${this.filePath}.${process.pid}.tmp`

    try {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.promises.writeFile(tempPath, json, 'utf8')
      try {
        await fs.promises.rename(tempPath, this.filePath)
      } catch {
        await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS))
        try {
          await fs.promises.rename(tempPath, this.filePath)
        } catch {
          await fs.promises.writeFile(this.filePath, json, 'utf8')
          await fs.promises.rm(tempPath, { force: true })
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[EmbeddedKeyValueStore] snapshot write failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  async get(key: string): Promise<string | null> {
    await this.ready()
    return this.liveEntry(key)?.value ?? null
  }

  async set(key: string, value: string, ttlSeconds?: number | undefined): Promise<void> {
    await this.ready()
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined
    this.store.set(key, { value, expiresAt })
    this.scheduleWrite()
  }

  async del(key: string): Promise<boolean> {
    await this.ready()
    const deleted = this.store.delete(key)
    if (deleted) this.scheduleWrite()
    return deleted
  }

  async exists(key: string): Promise<boolean> {
    await this.ready()
    return this.liveEntry(key) !== null
  }

  async flush(): Promise<void> {
    await this.ready()
    this.store.clear()
    this.scheduleWrite()
  }

  async scan(pattern?: string | undefined, limit?: number | undefined): Promise<ScanResult> {
    await this.ready()
    const matcher = compilePattern(pattern && pattern.length > 0 ? pattern : '*')
    const cap = Math.max(limit ?? DEFAULT_SCAN_LIMIT, 1)

    const matched: string[] = []
    for (const key of [...this.store.keys()]) {
      if (!this.liveEntry(key)) continue // Skips and sweeps expired entries.
      if (matcher.test(key)) matched.push(key)
    }

    // Sorted for the same reason the Redis path sorts: the admin paginates
    // this list client-side, and an unstable order reshuffles pages.
    matched.sort((a, b) => a.localeCompare(b))
    return { keys: matched.slice(0, cap), truncated: matched.length > cap }
  }

  async ttl(key: string): Promise<number> {
    await this.ready()
    const entry = this.liveEntry(key)
    if (!entry) return -2
    if (entry.expiresAt === undefined) return -1
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000))
  }

  /** Flushes any pending snapshot and stops the timer. Call on shutdown. */
  async close(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    await this.writeChain
    if (this.persistent && !this.closed) {
      await this.writeSnapshot()
    }
    this.closed = true
  }
}

/**
 * Builds the key-value store for the configured driver.
 *
 * There is no Redis-backed adapter here: services that need Redis (ms-order's
 * BullMQ queues) talk to ioredis directly, so a Redis implementation of this
 * interface would have no callers. The factory therefore always returns the
 * embedded store, file-backed unless explicitly configured in-memory, and
 * degrades rather than throwing — matching createDocumentStore.
 */
export function createKeyValueStore(config: DatabaseConfiguration): KeyValueStoreAdapter {
  const { driver, embedded, rocksdb } = config.keyValue
  // 'rocksdb' is a legacy alias for the embedded store; both are file-backed.
  const dataPath = embedded.dataPath || rocksdb.dataPath
  const inMemory = driver === 'redis' ? true : embedded.inMemory
  return new EmbeddedKeyValueStore(dataPath, inMemory)
}
