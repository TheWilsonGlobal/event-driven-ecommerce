import type { FastifyInstance } from 'fastify'
import { CartOut, ErrorResponse } from './schemas'

/** Registers the `/api/v1/cart` route. */
export function registerCartRoutes(server: FastifyInstance): void {
  server.get(
    '/api/v1/cart',
    {
      config: { policy: { permission: 'orders:read' } },
      schema: {
        tags: ['cart'],
        description: "Get the current user's cart contents.",
        response: {
          200: CartOut,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async () => {
      return {
        items: [],
        subtotal: 0,
        total: 0,
      }
    }
  )
}
