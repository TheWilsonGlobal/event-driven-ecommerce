import type { FastifyInstance } from 'fastify'
import { closeServicePools } from '@ecommerce/shared-database'
import type { EventConsumer, EventProducer, OutboxRelay } from '@ecommerce/shared-messaging'
import type { QueueManager } from './queues'

export interface ShutdownDeps {
  server: FastifyInstance
  queueManager: QueueManager
  eventProducer: EventProducer
  eventConsumer: EventConsumer
  outboxRelay: OutboxRelay
}

/**
 * Closes the outbox relay, the Kafka consumer and producer, the HTTP server,
 * the BullMQ worker/queue and finally the Postgres pool on SIGTERM/SIGINT.
 *
 * Order matters.
 *
 * 1. The relay goes FIRST. stop() waits for an in-flight tick, so a row it has
 *    claimed is either marked sent or failed rather than left in `processing`
 *    until its lease expires, and it must finish while the producer is still
 *    open to send it.
 * 2. The consumer goes down before the pool it writes to is torn down: a
 *    message dispatched mid-shutdown would otherwise run its handler against a
 *    closing pool, and a handler already in flight must still be able to COMMIT
 *    its transaction (ledger, stock, reservation and outbox rows together).
 * 3. The producer is closed after both, since kafkajs batches internally and
 *    exiting without disconnecting drops messages it already accepted.
 * 4. The pool closes LAST. Closing it earlier would turn every in-flight event
 *    into a needless failure; an interrupted transaction rolls back cleanly,
 *    but there is no reason to cause one.
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
  outboxRelay,
}: ShutdownDeps): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    console.log(`[Inventory Service] Received ${signal}, shutting down...`)

    try {
      await outboxRelay.stop()
    } catch (err) {
      console.warn(`[Inventory Service] Error stopping outbox relay: ${(err as Error).message}`)
    }

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

    try {
      await closeServicePools()
    } catch (err) {
      console.warn(`[Inventory Service] Error closing database pool: ${(err as Error).message}`)
    }

    console.log('[Inventory Service] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
