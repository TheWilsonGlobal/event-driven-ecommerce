import type { FastifyInstance } from 'fastify'

/** Registers the `/api/v1/cart` route. */
export function registerCartRoutes(server: FastifyInstance): void {
  server.get(
    '/api/v1/cart',
    {
      schema: {
        tags: ['cart'],
        description: "Get the current user's cart contents.",
        response: {
          200: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'object' } },
              subtotal: { type: 'number' },
              total: { type: 'number' },
            },
          },
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
