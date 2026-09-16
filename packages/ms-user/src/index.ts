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

  await server.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'User Service',
        description: 'User management and authentication service.',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      tags: [
        { name: 'health', description: 'Service health and status' },
        { name: 'users', description: 'User account management' },
        { name: 'auth', description: 'Registration and authentication' },
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
        description: 'Service liveness/status check, including database mode/driver.',
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
        service: 'ms-user',
        timestamp: new Date().toISOString(),
        database: {
          mode: dbConfig.mode,
          driver: dbConfig.relational.driver,
        },
      }
    },
  )

  server.get(
    '/api/v1/users',
    {
      schema: {
        tags: ['users'],
        description: 'List users (paginated).',
        response: {
          200: {
            type: 'object',
            properties: {
              users: { type: 'array', items: { type: 'object' } },
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
        users: [],
        total: 0,
        page: 1,
        limit: 10,
      }
    },
  )

  server.post(
    '/api/v1/auth/register',
    {
      schema: {
        tags: ['auth'],
        description: 'Register a new user account.',
        body: {
          type: 'object',
          properties: {
            email: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const body = (request.body as Record<string, any>) || {}
      return {
        success: true,
        message: 'User registration endpoint ready',
        data: {
          email: body.email || 'user@example.com',
        },
      }
    },
  )

  server.post(
    '/api/v1/auth/login',
    {
      schema: {
        tags: ['auth'],
        description: 'Authenticate a user and receive a session token.',
        body: {
          type: 'object',
          properties: {
            email: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              token: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  role: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const body = (request.body as Record<string, any>) || {}
      return {
        success: true,
        token: 'mock-jwt-token',
        user: {
          email: body.email || 'user@example.com',
          role: 'CUSTOMER',
        },
      }
    },
  )

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[User Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()
