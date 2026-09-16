import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { loadDatabaseConfig } from '@ecommerce/shared-database'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.USER_SERVICE_PORT || '3001', 10)

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
      service: 'ms-user',
      timestamp: new Date().toISOString(),
      database: {
        mode: dbConfig.mode,
        driver: dbConfig.relational.driver,
      },
    }
  })

  server.get('/api/v1/users', async () => {
    return {
      users: [],
      total: 0,
      page: 1,
      limit: 10,
    }
  })

  server.post('/api/v1/auth/register', async (request) => {
    const body = (request.body as Record<string, any>) || {}
    return {
      success: true,
      message: 'User registration endpoint ready',
      data: {
        email: body.email || 'user@example.com',
      },
    }
  })

  server.post('/api/v1/auth/login', async (request) => {
    const body = (request.body as Record<string, any>) || {}
    return {
      success: true,
      token: 'mock-jwt-token',
      user: {
        email: body.email || 'user@example.com',
        role: 'CUSTOMER',
      },
    }
  })

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[User Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
