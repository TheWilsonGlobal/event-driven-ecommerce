import type { DatabaseConfiguration } from './config'

export interface KeyValueStoreAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number | undefined): Promise<void>
  del(key: string): Promise<boolean>
  exists(key: string): Promise<boolean>
  flush(): Promise<void>
}

/**
 * Embedded Key-Value / RocksDB persistent and in-memory store adapter
 */
export class EmbeddedKeyValueStore implements KeyValueStoreAdapter {
  private store: Map<string, { value: string; expiresAt?: number | undefined }> = new Map()
  private dataPath: string | undefined

  constructor(dataPath?: string | undefined) {
    this.dataPath = dataPath
  }

  getDataPath(): string | undefined {
    return this.dataPath
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key)
    if (!item) return null
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key)
      return null
    }
    return item.value
  }

  async set(key: string, value: string, ttlSeconds?: number | undefined): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined
    this.store.set(key, { value, expiresAt })
  }

  async del(key: string): Promise<boolean> {
    return this.store.delete(key)
  }

  async exists(key: string): Promise<boolean> {
    const val = await this.get(key)
    return val !== null
  }

  async flush(): Promise<void> {
    this.store.clear()
  }
}

/**
 * Factory to create Key-Value store based on driver (Redis vs RocksDB / Embedded)
 */
export function createKeyValueStore(config: DatabaseConfiguration): KeyValueStoreAdapter {
  if (config.keyValue.driver === 'rocksdb') {
    return new EmbeddedKeyValueStore(config.keyValue.rocksdb.dataPath)
  }
  return new EmbeddedKeyValueStore()
}
