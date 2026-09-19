import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as bcrypt from 'bcryptjs'
import { PrismaClient } from '../node_modules/.prisma-ms-user/client'
import { loadDatabaseConfig, SEED_USERS } from '@ecommerce/shared-database'
import {
  registerMetrics,
  buildLoggerOptions,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'
import { registerSchemaRoutes, registerLogRoutes } from './diagnostics'

// Load ms-user's own .env first (takes precedence: dotenv does not
// override already-set keys). It supplies the SQLite DATABASE_URL used by
// this service's Prisma schema, which must win over the root .env's
// Postgres DATABASE_URL below (used by other, non-Prisma consumers).
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const dbConfig = loadDatabaseConfig(process.env)
const PORT = parseInt(process.env.USER_SERVICE_PORT || '5463', 10)

const prisma = new PrismaClient()

const server: FastifyInstance = fastify({
  // Pretty terminal output, plus shipping to Loki when it is reachable.
  logger: buildLoggerOptions({ service: 'ms-user' }),
})

// Placeholder dev password hash used for users created ad hoc via the admin
// "Add User" flow, where no real credential is collected yet. Same approach
// as the shared SEED_USERS records (bcrypt hash of "Password123!").
const PLACEHOLDER_PASSWORD_HASH = bcrypt.hashSync(`placeholder-${Date.now()}-${Math.random()}`, 10)

/**
 * Self-seeds the users table from the shared SEED_USERS source of truth if
 * (and only if) it is currently empty. Safe to call on every service start:
 * restarts never duplicate data since it no-ops once users exist.
 */
async function seedIfEmpty(): Promise<void> {
  const existingCount = await prisma.user.count()
  if (existingCount > 0) {
    server.log.info(`[ms-user] Skipping seed: ${existingCount} user(s) already present.`)
    return
  }

  let inserted = 0
  for (const seedUser of SEED_USERS) {
    await prisma.user.create({
      data: {
        id: seedUser.id,
        email: seedUser.email,
        passwordHash: seedUser.passwordHash,
        firstName: seedUser.firstName,
        lastName: seedUser.lastName,
        role: seedUser.role,
        isActive: seedUser.isActive,
        isEmailVerified: seedUser.isEmailVerified,
        addresses: {
          create: seedUser.addresses.map((address) => ({
            addressLine1: address.addressLine1,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode,
            country: address.country,
            isDefaultShipping: address.isDefaultShipping,
          })),
        },
      },
    })
    inserted += 1
  }

  server.log.info(`[ms-user] Seeded ${inserted} user(s) from SEED_USERS.`)
}

type UserWithAddresses = Awaited<ReturnType<typeof prisma.user.findFirstOrThrow>> & {
  addresses: Array<{
    addressLine1: string
    addressLine2: string | null
    city: string
    state: string
    postalCode: string
    country: string
    isDefaultShipping: boolean
    isDefaultBilling: boolean
  }>
}

/** Maps a Prisma User (with addresses included) to the public API shape, dropping passwordHash. */
function toPublicUser(user: UserWithAddresses) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified,
    addresses: user.addresses.map((address) => ({
      addressLine1: address.addressLine1,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      isDefaultShipping: address.isDefaultShipping,
    })),
    createdAt: user.createdAt.toISOString(),
  }
}

async function bootstrap() {
  await seedIfEmpty()

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
    }
  )

  server.get(
    '/api/v1/users',
    {
      schema: {
        tags: ['users'],
        description: 'List users (paginated).',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              users: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
              total: { type: 'number' },
              page: { type: 'number' },
              limit: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      const query = (request.query as Record<string, any>) || {}
      const page = Math.max(1, parseInt(query.page, 10) || 1)
      const limit = Math.max(1, parseInt(query.limit, 10) || 10)

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          include: { addresses: true },
          orderBy: { createdAt: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.user.count(),
      ])

      return {
        users: users.map(toPublicUser),
        total,
        page,
        limit,
      }
    }
  )

  server.post(
    '/api/v1/users',
    {
      schema: {
        tags: ['users'],
        description: 'Create a new user (admin "Add User" flow).',
        body: {
          type: 'object',
          required: ['email', 'firstName', 'lastName'],
          properties: {
            email: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            role: { type: 'string' },
            isActive: { type: 'boolean' },
            addressLine1: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            postalCode: { type: 'string' },
          },
        },
        response: {
          201: { type: 'object', additionalProperties: true },
          409: {
            type: 'object',
            properties: { success: { type: 'boolean' }, message: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const body = (request.body as Record<string, any>) || {}

      if (!body.email || !body.firstName || !body.lastName) {
        return reply.status(400).send({
          success: false,
          message: 'email, firstName and lastName are required',
        })
      }

      const existing = await prisma.user.findUnique({ where: { email: body.email } })
      if (existing) {
        return reply.status(409).send({
          success: false,
          message: `User with email ${body.email} already exists`,
        })
      }

      const hasAddress = body.addressLine1 && body.city && body.state && body.postalCode

      const user = await prisma.user.create({
        data: {
          email: body.email,
          passwordHash: PLACEHOLDER_PASSWORD_HASH,
          firstName: body.firstName,
          lastName: body.lastName,
          role: body.role || 'CUSTOMER',
          isActive: body.isActive ?? true,
          isEmailVerified: false,
          ...(hasAddress
            ? {
                addresses: {
                  create: [
                    {
                      addressLine1: body.addressLine1,
                      city: body.city,
                      state: body.state,
                      postalCode: body.postalCode,
                      country: body.country || 'United States',
                      isDefaultShipping: true,
                    },
                  ],
                },
              }
            : {}),
        },
        include: { addresses: true },
      })

      return reply.status(201).send(toPublicUser(user))
    }
  )

  server.patch(
    '/api/v1/users/:id',
    {
      schema: {
        tags: ['users'],
        description: 'Update a user (isActive, role, firstName, lastName).',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            isActive: { type: 'boolean' },
            role: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          404: {
            type: 'object',
            properties: { success: { type: 'boolean' }, message: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = (request.body as Record<string, any>) || {}

      const existing = await prisma.user.findUnique({ where: { id } })
      if (!existing) {
        return reply.status(404).send({ success: false, message: `User ${id} not found` })
      }

      const user = await prisma.user.update({
        where: { id },
        data: {
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
          ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        },
        include: { addresses: true },
      })

      return toPublicUser(user)
    }
  )

  server.delete(
    '/api/v1/users/:id',
    {
      schema: {
        tags: ['users'],
        description: 'Delete a user (cascades to addresses and refresh tokens).',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: { success: { type: 'boolean' } },
          },
          404: {
            type: 'object',
            properties: { success: { type: 'boolean' }, message: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const existing = await prisma.user.findUnique({ where: { id } })
      if (!existing) {
        return reply.status(404).send({ success: false, message: `User ${id} not found` })
      }

      await prisma.user.delete({ where: { id } })
      return { success: true }
    }
  )

  server.post(
    '/api/v1/auth/register',
    {
      schema: {
        tags: ['auth'],
        description: 'Register a new user account.',
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            password: { type: 'string' },
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
          409: {
            type: 'object',
            properties: { success: { type: 'boolean' }, message: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const body = (request.body as Record<string, any>) || {}
      const email = body.email || 'user@example.com'

      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) {
        return reply.status(409).send({
          success: false,
          message: `An account with email ${email} already exists`,
        })
      }

      const passwordHash = body.password
        ? bcrypt.hashSync(body.password, 10)
        : PLACEHOLDER_PASSWORD_HASH

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: body.firstName || 'New',
          lastName: body.lastName || 'User',
          role: 'CUSTOMER',
          isActive: true,
          isEmailVerified: false,
        },
      })

      return {
        success: true,
        message: 'User registered successfully',
        data: {
          email: user.email,
        },
      }
    }
  )

  server.post(
    '/api/v1/auth/login',
    {
      schema: {
        tags: ['auth'],
        description: 'Authenticate a user and receive a session token.',
        body: {
          type: 'object',
          required: ['email'],
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
          401: {
            type: 'object',
            properties: { success: { type: 'boolean' }, message: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const body = (request.body as Record<string, any>) || {}
      const email = body.email || ''

      const user = await prisma.user.findUnique({ where: { email } })

      // Demo app: existence + active-status check only, no real password
      // verification against passwordHash.
      if (!user || !user.isActive) {
        return reply.status(401).send({
          success: false,
          message: 'Invalid credentials or inactive account',
        })
      }

      return {
        success: true,
        token: 'mock-jwt-token',
        user: {
          email: user.email,
          role: user.role,
        },
      }
    }
  )

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
