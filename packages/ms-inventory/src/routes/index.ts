import type { FastifyInstance } from 'fastify'
import type { loadDatabaseConfig } from '@ecommerce/shared-database'
import type { EventConsumer, OutboxRelay } from '@ecommerce/shared-messaging'
import type { InventoryStore } from '../db/store'
import { registerEventRoutes } from '../events'
import { registerOutboxRoutes } from '../outbox'
import { registerQueueRoutes, type QueueManager } from '../queues'
import { registerHealthRoute, type HealthDeps } from './health'
import { registerInventoryRoutes } from './inventory'

export interface ServiceRouteDeps {
  store: InventoryStore
  queueManager: QueueManager
  eventConsumer: EventConsumer
  outboxRelay: OutboxRelay
  dbConfig: ReturnType<typeof loadDatabaseConfig>
  probe?: HealthDeps['probe']
}

/**
 * Every HTTP route ms-inventory itself owns, in one place so the production
 * bootstrap and the security tests register exactly the same set.
 */
export function registerServiceRoutes(server: FastifyInstance, deps: ServiceRouteDeps): void {
  registerHealthRoute(server, {
    dbConfig: deps.dbConfig,
    eventConsumer: deps.eventConsumer,
    ...(deps.probe ? { probe: deps.probe } : {}),
  })
  registerInventoryRoutes(server, { store: deps.store })
  registerQueueRoutes(server, deps.queueManager)
  registerEventRoutes(server, deps.eventConsumer)
  registerOutboxRoutes(server, deps.outboxRelay)
}
