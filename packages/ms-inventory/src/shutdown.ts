import type { FastifyInstance } from 'fastify'
import type { EventConsumer, EventProducer } from '@ecommerce/shared-messaging'
import type { QueueManager } from './queues'

export interface ShutdownDeps {
  server: FastifyInstance
  queueManager: QueueManager
  eventProducer: EventProducer
  eventConsumer: EventConsumer
}

/**
 * Closes the HTTP server, the Kafka consumer and producer, and the BullMQ
 * worker/queue on SIGTERM/SIGINT.
 *
 * Order matters. The consumer goes down FIRST, before the stores it writes
 * to are torn down: a message dispatched mid-shutdown would otherwise run its
 * handler against a closing queue and leave a reservation with no expiry
 * timer. The producer is flushed after it, because a handler that was already
 * in flight still has its inventory.reserved to publish — kafkajs batches
 * internally, so exiting without disconnecting drops already-accepted messages
 * that have not yet left the process.
 *
 * Without this the BullMQ worker's blocking Redis read and the consumer's
 * fetch loop both keep the event loop alive, and the service hangs instead of
 * exiting.
 */
export function registerShutdownHandlers({
  server,
  queueManager,
  eventProducer,
  eventConsumer,
}: ShutdownDeps): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    console.log(`[Inventory Service] Received ${signal}, shutting down...`)

    try {
      await eventConsumer.close()
    } catch (err) {
      console.warn(`[Inventory Service] Error closing Kafka consumer: ${(err as Error).message}`)
    }

    try {
      await server.close()
    } catch (err) {
      console.warn(`[Inventory Service] Error closing HTTP server: ${(err as Error).message}`)
    }

    try {
      await eventProducer.close()
    } catch (err) {
      console.warn(`[Inventory Service] Error closing Kafka producer: ${(err as Error).message}`)
    }

    try {
      await queueManager.close()
    } catch (err) {
      console.warn(`[Inventory Service] Error closing queues: ${(err as Error).message}`)
    }

    console.log('[Inventory Service] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
