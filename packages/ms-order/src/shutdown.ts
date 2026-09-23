import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '../node_modules/.prisma-ms-order/client'
import type { KeyValueStoreAdapter } from '@ecommerce/shared-database'
import { QueueManager } from './queues'
import type { EventProducer } from '@ecommerce/shared-messaging'

export interface ShutdownDeps {
  server: FastifyInstance
  queueManager: QueueManager
  kvStore: KeyValueStoreAdapter | undefined
  prisma: PrismaClient
  eventProducer: EventProducer
}

/**
 * Closes workers, queues, Redis connections, the HTTP server and Prisma on
 * SIGTERM/SIGINT. Without this the BullMQ workers' blocking Redis reads keep
 * the event loop alive and ms-order hangs instead of exiting.
 */
export function registerShutdownHandlers({
  server,
  queueManager,
  kvStore,
  prisma,
  eventProducer,
}: ShutdownDeps): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    console.log(`[Order Service] Received ${signal}, shutting down...`)

    try {
      await server.close()
    } catch (err) {
      console.warn(`[Order Service] Error closing HTTP server: ${(err as Error).message}`)
    }

    try {
      await queueManager.close()
    } catch (err) {
      console.warn(`[Order Service] Error closing queues: ${(err as Error).message}`)
    }

    // Before the KV store, and after the HTTP server: kafkajs BATCHES sends
    // internally, so exiting without disconnecting can drop messages the
    // producer already accepted but has not yet put on the wire.
    try {
      await eventProducer.close()
    } catch (err) {
      console.warn(`[Order Service] Error closing event producer: ${(err as Error).message}`)
    }

    try {
      await kvStore?.close?.()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[Order Service] Error closing KV store: ${(err as Error).message}`)
    }

    try {
      await prisma.$disconnect()
    } catch (err) {
      console.warn(`[Order Service] Error disconnecting Prisma: ${(err as Error).message}`)
    }

    console.log('[Order Service] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
