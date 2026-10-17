import type { FastifyInstance } from 'fastify'
import { closeServicePools } from '@ecommerce/shared-database'
import type { EventConsumer, EventProducer } from '@ecommerce/shared-messaging'

export interface ShutdownDeps {
  server: FastifyInstance
  consumer: EventConsumer
  producer: EventProducer
}

/**
 * Closes the HTTP server, the consumer and the (never-used) producer on
 * SIGTERM/SIGINT.
 *
 * The consumer close is what actually matters: kafkajs' consume loop holds a
 * long-poll fetch open, which keeps the event loop alive. Without disconnecting
 * it the process hangs on Ctrl-C instead of exiting — the same failure mode
 * ms-order's blocking BullMQ reads produce.
 *
 * Order is deliberate: the HTTP server first (stop accepting requests), then
 * the consumer (let the in-flight handler finish and COMMIT its
 * transaction), then the Postgres pool last, so that handler still has a
 * connection to commit on. An interrupted transaction rolls back cleanly rather
 * than half-applying, but closing the pool first would turn every in-flight
 * event into a needless failure.
 */
export function registerShutdownHandlers({ server, consumer, producer }: ShutdownDeps): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    console.log(`[Analytics Service] Received ${signal}, shutting down...`)

    try {
      await server.close()
    } catch (err) {
      console.warn(`[Analytics Service] Error closing HTTP server: ${(err as Error).message}`)
    }

    try {
      await consumer.close()
    } catch (err) {
      console.warn(`[Analytics Service] Error closing event consumer: ${(err as Error).message}`)
    }

    // Nothing was ever published, so there is no batched send to flush — but
    // closing keeps the lifecycle symmetric and costs nothing when no client
    // was constructed.
    try {
      await producer.close()
    } catch (err) {
      console.warn(`[Analytics Service] Error closing event producer: ${(err as Error).message}`)
    }

    try {
      await closeServicePools()
    } catch (err) {
      console.warn(`[Analytics Service] Error closing database pool: ${(err as Error).message}`)
    }

    console.log('[Analytics Service] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
