import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '../node_modules/.prisma-ms-user/client'
import { loadDatabaseConfig } from '@ecommerce/shared-database'
import {
  registerMetrics,
  buildLoggerOptions,
  probeLokiReachable,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import { registerSchemaRoutes, registerLogRoutes } from './diagnostics'
import { seedIfEmpty } from './seed'
import { registerHealthRoute } from './routes/health'
import { registerUserRoutes } from './routes/users'
import { registerAuthRoutes } from './routes/auth'

// Package-local .env first (an optional override; dotenv never overrides
// already-set keys), then the repo-root .env. The Prisma schema reads
// USER_DATABASE_URL, which lives in the root .env — there is no longer a
// package-local SQLite DATABASE_URL.
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.USER_SERVICE_PORT || '5463', 10)

const prisma = new PrismaClient()

// Checked once at boot, before the logger (and its Loki transport) is even
// constructed — an unreachable Loki then produces one quiet line here
// instead of a stack trace per log line for the life of the process.
let server: FastifyInstance

async function bootstrap() {
  const lokiHost = process.env.LOKI_HOST || 'http://localhost:3100'
  const lokiReachable =
    process.env.LOKI_ENABLED === 'false' ? false : await probeLokiReachable(lokiHost)

  server = fastify({
    logger: buildLoggerOptions({ service: 'ms-user', lokiReachable }),
  })

  await seedIfEmpty(server, prisma)

  // Before every other plugin, so the onResponse hook sees all traffic.
  registerMetrics(server, { service: 'ms-user' })

  // Before any route registration below — onRoute only fires for routes
  // registered after this hook is attached.
  const routeRegistry = createRouteRegistry(server)

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

  registerHealthRoute(server, dbConfig, prisma)
  registerUserRoutes(server, { prisma })
  registerAuthRoutes(server, { prisma })

  registerSchemaRoutes(server, prisma)
  registerLogRoutes(server)
  registerEndpointsRoute(server, routeRegistry, 'ms-user')

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`[User Service] Listening on http://localhost:${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap()

process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  process.exit(0)
})
