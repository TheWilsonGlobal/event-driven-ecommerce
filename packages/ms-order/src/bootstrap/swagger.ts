import type { FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

/** Registers the OpenAPI schema (`@fastify/swagger`) and its UI (`/api-docs`). */
export async function registerSwagger(server: FastifyInstance, port: number): Promise<void> {
  await server.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Order Service',
        description: 'Order processing, cart, and payment orchestration service.',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${port}` }],
      tags: [
        { name: 'health', description: 'Service health and status' },
        { name: 'orders', description: 'Order management' },
        { name: 'cart', description: 'Shopping cart' },
        { name: 'payments', description: 'Payment capture and retry' },
        { name: 'queues', description: 'BullMQ queue introspection' },
        { name: 'cache', description: 'Redis keyspace introspection' },
        { name: 'schema', description: 'Live database schema introspection' },
        { name: 'logs', description: 'Real log file listing and reading' },
        { name: 'endpoints', description: 'Live registered-route inventory' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })
}
