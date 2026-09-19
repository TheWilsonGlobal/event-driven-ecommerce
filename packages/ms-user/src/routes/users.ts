import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '../../node_modules/.prisma-ms-user/client'
import { PLACEHOLDER_PASSWORD_HASH } from '../seed'
import { toPublicUser } from '../userMapping'

export function registerUserRoutes(server: FastifyInstance, { prisma }: { prisma: PrismaClient }) {
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
}
