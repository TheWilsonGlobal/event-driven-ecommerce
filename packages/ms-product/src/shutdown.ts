import type { FastifyInstance } from 'fastify'
import { QueueManager } from './queues'

export interface ShutdownDeps {
  server: FastifyInstance
  queueManager: QueueManager
}

/**
 * Closes the reindex-search worker/queue, its Redis connections, and the
 * HTTP server on SIGTERM/SIGINT. Mirrors ms-order's shutdown.ts. Without this
 * the BullMQ worker's blocking Redis read keeps the event loop alive and
 * ms-product hangs instead of exiting.
 */
export function registerShutdownHandlers({ server, queueManager }: ShutdownDeps): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    console.log(`[Product Service] Received ${signal}, shutting down...`)

    try {
      await server.close()
    } catch (err) {
      console.warn(`[Product Service] Error closing HTTP server: ${(err as Error).message}`)
    }

    try {
      await queueManager.close()
    } catch (err) {
      console.warn(`[Product Service] Error closing queues: ${(err as Error).message}`)
    }

    console.log('[Product Service] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
