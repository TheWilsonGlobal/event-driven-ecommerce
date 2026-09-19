import type { FastifyInstance } from 'fastify'
import * as bcrypt from 'bcryptjs'
import { PrismaClient } from '../../node_modules/.prisma-ms-user/client'
import { PLACEHOLDER_PASSWORD_HASH } from '../seed'

export function registerAuthRoutes(server: FastifyInstance, { prisma }: { prisma: PrismaClient }) {
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
}
