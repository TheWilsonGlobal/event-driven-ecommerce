import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
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

  server.get('/health', async () => {
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
  })

  server.get('/api/v1/orders', async () => {
    return {
      orders: [],
      total: 0,
      page: 1,
      limit: 10,
    }
  })

  server.get('/api/v1/cart', async () => {
    return {
      items: [],
      subtotal: 0,
      total: 0,
    }
  })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[Order Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
