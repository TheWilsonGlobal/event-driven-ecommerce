import type IORedis from 'ioredis'
import { loadDatabaseConfig } from '@ecommerce/shared-database'
import {
  createRedisConnectionRegistry,
  isConnectionUsable as sharedIsConnectionUsable,
  type RedisRole,
} from '@ecommerce/shared-messaging'

/**
 * ms-order's Redis connection setup.
 *
 * The generic connection-lifecycle logic (retry strategy, offline-queue-false,
 * per-connection error handling, graceful close) moved to
 * @ecommerce/shared-messaging's `createRedisConnectionRegistry` 2026-09-19 —
 * ms-product needed the identical behaviour for its own queue. This module now
 * only wires that registry to ms-order's own DB config and keeps the original
 * module-level function names so none of ms-order's 13 existing call sites
 * needed to change.
 */

const dbConfig = loadDatabaseConfig(process.env)

const registry = createRedisConnectionRegistry('[Order Service]')

export type { RedisRole }

/**
 * Creates an ioredis client with an 'error' handler already attached.
 *
 * `role` selects the option profile: 'worker' connections get BullMQ's
 * required blocking-command settings, everything else gets the fail-fast
 * profile.
 */
export function createRedisConnection(role: RedisRole, label: string): IORedis {
  return registry.create(dbConfig.keyValue.redis, role, label)
}

export function getLastRedisError(): Error | null {
  return registry.getLastError()
}

/**
 * True when the shared connection is in a state where a command can be issued.
 * ioredis statuses: 'connecting' | 'connect' | 'ready' | 'close' | 'reconnecting' | 'end'
 */
export function isConnectionUsable(client: IORedis): boolean {
  return sharedIsConnectionUsable(client)
}

/** Closes every connection created through this module. */
export async function closeAllRedisConnections(): Promise<void> {
  await registry.closeAll()
}

export const redisSettings = dbConfig.keyValue.redis
export const keyValueDriver = dbConfig.keyValue.driver

/**
 * True when this process should talk to Redis at all.
 *
 * The 'rocksdb' and 'embedded' drivers both select the embedded file-backed
 * store; only 'redis' creates connections and BullMQ queues.
 */
export const redisEnabled = dbConfig.keyValue.driver === 'redis'
