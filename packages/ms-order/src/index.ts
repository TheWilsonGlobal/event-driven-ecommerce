import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { loadDatabaseConfig } from '@ecommerce/shared-database'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.ORDER_SERVICE_PORT || '3003', 10)

const server: FastifyInstance = fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  },
})

async function bootstrap() {
  await server.register(cors, { origin: '*' })
  await server.register(helmet)

  await server.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Order Service',
        description: 'Order processing, cart, and payment orchestration service.',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      tags: [
        { name: 'health', description: 'Service health and status' },
        { name: 'orders', description: 'Order management' },
        { name: 'cart', description: 'Shopping cart' },
      ],
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })

  server.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        description: 'Service liveness/status check, including database/queue driver.',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              database: {
                type: 'object',
                properties: {
                  mode: { type: 'string' },
                  driver: { type: 'string' },
                  queue: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return {
        status: 'ok',
        service: 'ms-order',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.relational.driver,
          queue: dbConfig.keyValue.driver,
        },
      }
    }
  )

  server.get(
    '/api/v1/orders',
    {
      schema: {
        tags: ['orders'],
        description: 'List orders (paginated).',
        response: {
          200: {
            type: 'object',
            properties: {
              orders: { type: 'array', items: { type: 'object' } },
              total: { type: 'number' },
              page: { type: 'number' },
              limit: { type: 'number' },
            },
          },
        },
      },
    },
    async () => {
      return {
        orders: [],
        total: 0,
        page: 1,
        limit: 10,
      }
    }
  )

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

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Order Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
