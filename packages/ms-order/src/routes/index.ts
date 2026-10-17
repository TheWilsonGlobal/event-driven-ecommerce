import type { FastifyInstance } from 'fastify'
import type { loadDatabaseConfig } from '@ecommerce/shared-database'
import type { OutboxRelay } from '@ecommerce/shared-messaging'
import type { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import type { QueueManager } from '../queues'
import { registerQueueRoutes } from '../queues'
import { registerEventRoutes } from '../events'
import { registerOutboxRoutes } from '../outbox'
import { registerSchemaRoutes, registerLogRoutes } from '../diagnostics'
import type { PriceVerifier } from '../pricing/PriceVerifier'
import { registerCartRoutes } from './cart'
import { registerHealthRoute } from './health'
import { registerOrderRoutes } from './orders'
import { registerPaymentRoutes } from './payments'

export interface ServiceRouteDeps {
  prisma: PrismaClient
  queueManager: QueueManager
  priceVerifier?: PriceVerifier
  outboxRelay: OutboxRelay
  dbConfig: ReturnType<typeof loadDatabaseConfig>
  repoRoot: string
}

/**
 * Every HTTP route ms-order itself owns, in one place so the production
 * bootstrap and the security tests register exactly the same set (a coverage
 * test over a hand-copied list would prove nothing about production).
 */
export function registerServiceRoutes(server: FastifyInstance, deps: ServiceRouteDeps): void {
  const { prisma, queueManager, priceVerifier } = deps

  registerHealthRoute(server, prisma, deps.dbConfig)
  registerOrderRoutes(server, { prisma, queueManager, ...(priceVerifier ? { priceVerifier } : {}) })
  registerPaymentRoutes(server, { prisma, queueManager })

  registerQueueRoutes(server, queueManager)
  registerEventRoutes(server, { repoRoot: deps.repoRoot })
  registerOutboxRoutes(server, deps.outboxRelay)
  registerSchemaRoutes(server, prisma)
  registerLogRoutes(server)

  registerCartRoutes(server)
}
