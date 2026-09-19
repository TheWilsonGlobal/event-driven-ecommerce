import type { EmbeddedKeyValueStore, KeyValueStoreAdapter } from '@ecommerce/shared-database'
import type { KeyspaceBackend } from './keyspaceInspector'

export interface KeyValueInfo {
  backend: KeyspaceBackend
  label: string
  dataPath: string | null
  inMemory: boolean
  loadError: string | null
}

/**
 * Describes the active key-value backend for the driver endpoint.
 *
 * Reports what this process actually resolved at boot rather than what the
 * environment requested, so the admin can never show a driver that is not
 * the one in use.
 */
export function describeKeyValueBackend(
  redisEnabled: boolean,
  kvStore: KeyValueStoreAdapter | undefined
): KeyValueInfo {
  if (redisEnabled) {
    return {
      backend: 'redis',
      label: 'Redis 7 (ioredis)',
      dataPath: null,
      inMemory: false,
      loadError: null,
    }
  }

  // The embedded store is the only non-Redis implementation; the extra
  // accessors are optional so a future adapter without them still works.
  const store = kvStore as EmbeddedKeyValueStore | undefined
  const persistent = store?.isPersistent?.() ?? false
  return {
    backend: 'embedded',
    // Never "RocksDB": this is a JSON snapshot, and naming it otherwise
    // would reintroduce exactly the misreporting this work removed.
    label: persistent ? 'Embedded (file-backed JSON)' : 'Embedded (in-memory)',
    dataPath: store?.getFilePath?.() ?? null,
    inMemory: !persistent,
    loadError: store?.getLastLoadError?.()?.message ?? null,
  }
}
