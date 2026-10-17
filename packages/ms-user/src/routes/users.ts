import type { FastifyInstance } from 'fastify'
import { Prisma, type PrismaClient } from '../../node_modules/.prisma-ms-user/client'
import {
  AppError,
  forbidden,
  notFound,
  requireOwnerOrAny,
  unauthorized,
  type Static,
} from '@ecommerce/shared-security'
import {
  AdminCreateUserBody,
  IdParams,
  ListUsersQuery,
  SuccessOut,
  UpdateProfileBody,
  UpdateRoleBody,
  UpdateStatusBody,
  UserListOut,
  UserOut,
} from '../schemas'
import { toPublicUser } from '../userMapping'
import { writeAuditLog } from '../services/auditLog'
import { ensureProfile } from '../services/profiles'
import { SupabaseAuthError, type SupabaseAuth } from '../supabase'

export interface UserRouteDeps {
  prisma: PrismaClient
  supabase: SupabaseAuth
}

const include = { addresses: true } as const

/**
 * An Admin API failure the caller can do nothing about. It is a 503 with a fixed
 * body: the upstream reason stays in the server log, not in the response.
 */
function providerUnavailable(
  request: { log: { warn: (o: object, m: string) => void } },
  err: unknown
) {
  request.log.warn(
    { providerError: err instanceof SupabaseAuthError ? err.kind : 'unknown' },
    'supabase admin call failed'
  )
  return new AppError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'The identity provider is unavailable')
}

export function registerUserRoutes(server: FastifyInstance, { prisma, supabase }: UserRouteDeps) {
  // ── admin: list ───────────────────────────────────────────────────────────
  server.get<{ Querystring: Static<typeof ListUsersQuery> }>(
    '/api/v1/users',
    {
      config: { policy: { permission: 'users:read:any' } },
      schema: {
        tags: ['users'],
        description: 'List users (paginated). Admin only.',
        querystring: ListUsersQuery,
        response: { 200: UserListOut },
      },
    },
    async (request) => {
      const { page, limit } = request.query
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          include,
          orderBy: { createdAt: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.user.count(),
      ])
      return { users: users.map(toPublicUser), total, page, limit }
    }
  )

  // ── admin: create ─────────────────────────────────────────────────────────
  server.post<{ Body: Static<typeof AdminCreateUserBody> }>(
    '/api/v1/users',
    {
      config: {
        policy: { permission: 'users:create', mfa: true, audit: true },
        rateTier: 'admin',
      },
      schema: {
        tags: ['users'],
        description:
          'Create a user (admin "Add User" flow). Creates the Supabase Auth account through ' +
          'the Admin API (no password: the person sets one with a password reset) and the ' +
          'profile row. Admin + MFA.',
        body: AdminCreateUserBody,
        response: { 201: UserOut },
      },
    },
    async (request, reply) => {
      const body = request.body
      const email = body.email.trim().toLowerCase()
      const role = body.role ?? 'CUSTOMER'
      const emailConfirm = body.emailConfirm ?? true

      if (await prisma.user.findUnique({ where: { email } })) {
        throw new AppError(409, 'EMAIL_IN_USE', 'A user with this email already exists')
      }

      let authUserId: string
      try {
        ;({ id: authUserId } = await supabase.admin.createUser({
          email,
          emailConfirm,
          appRole: role,
          firstName: body.firstName,
          lastName: body.lastName,
        }))
      } catch (err) {
        if (err instanceof SupabaseAuthError && err.kind === 'conflict') {
          throw new AppError(409, 'EMAIL_IN_USE', 'A user with this email already exists')
        }
        throw providerUnavailable(request, err)
      }

      const hasAddress = body.addressLine1 && body.city && body.state && body.postalCode
      try {
        const user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              authUserId,
              email,
              firstName: body.firstName,
              lastName: body.lastName,
              role,
              isActive: body.isActive ?? true,
              isEmailVerified: emailConfirm,
              ...(hasAddress
                ? {
                    addresses: {
                      create: [
                        {
                          addressLine1: body.addressLine1 as string,
                          city: body.city as string,
                          state: body.state as string,
                          postalCode: body.postalCode as string,
                          country: body.country ?? 'United States',
                          isDefaultShipping: true,
                        },
                      ],
                    },
                  }
                : {}),
            },
            include,
          })
          await writeAuditLog(tx, request, {
            action: 'user.create',
            targetUserId: created.id,
            details: { email, role },
          })
          return created
        })
        return reply.status(201).send(toPublicUser(user))
      } catch (err) {
        // Do not leave a Supabase account with no profile behind.
        await supabase.admin.deleteUser(authUserId).catch(() => undefined)
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppError(409, 'EMAIL_IN_USE', 'A user with this email already exists')
        }
        throw err
      }
    }
  )

  // ── self: my profile (declared before /:id; find-my-way prefers the static route) ──
  server.get(
    '/api/v1/users/me',
    {
      config: { policy: { permission: 'users:read' } },
      schema: {
        tags: ['users'],
        description:
          "The caller's own profile, created as CUSTOMER on first call for an identity that " +
          'signed up directly with Supabase.',
        response: { 200: UserOut },
      },
    },
    async (request) => {
      const auth = request.auth
      if (!auth) throw unauthorized() // only reachable in AUTH_ENFORCE=report
      if (!auth.email) {
        throw new AppError(400, 'PROFILE_UNAVAILABLE', 'The token carries no e-mail address')
      }
      const profile = await ensureProfile(prisma, {
        authUserId: auth.userId,
        email: auth.email.trim().toLowerCase(),
      })
      if (!profile) {
        throw new AppError(
          409,
          'PROFILE_CONFLICT',
          'Your account could not be linked to a profile. Contact an administrator.'
        )
      }
      return toPublicUser(profile)
    }
  )

  // ── self or admin: one profile ────────────────────────────────────────────
  server.get<{ Params: Static<typeof IdParams> }>(
    '/api/v1/users/:id',
    {
      config: { policy: { permission: 'users:read' } },
      schema: {
        tags: ['users'],
        description: 'One profile. Callers see only their own; admins see any.',
        params: IdParams,
        response: { 200: UserOut },
      },
    },
    async (request) => {
      const user = await prisma.user.findUnique({ where: { id: request.params.id }, include })
      if (!user) throw notFound()
      // 404, not 403, for somebody else's profile: ids cannot be probed.
      requireOwnerOrAny(request, user.authUserId, 'users:read')
      return toPublicUser(user)
    }
  )

  server.patch<{ Params: Static<typeof IdParams>; Body: Static<typeof UpdateProfileBody> }>(
    '/api/v1/users/:id',
    {
      config: { policy: { permission: 'users:update' } },
      schema: {
        tags: ['users'],
        description:
          'Update a profile (firstName, lastName, phoneNumber). Callers update only their own; ' +
          'admins any. Role and status have their own admin routes and are rejected here.',
        params: IdParams,
        body: UpdateProfileBody,
        response: { 200: UserOut },
      },
    },
    async (request) => {
      const { id } = request.params
      const body = request.body
      const existing = await prisma.user.findUnique({ where: { id } })
      if (!existing) throw notFound()
      requireOwnerOrAny(request, existing.authUserId, 'users:update')

      const user = await prisma.user.update({
        where: { id },
        data: {
          ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
          ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
          ...(body.phoneNumber !== undefined ? { phoneNumber: body.phoneNumber } : {}),
        },
        include,
      })
      return toPublicUser(user)
    }
  )

  // ── admin: role ───────────────────────────────────────────────────────────
  server.patch<{ Params: Static<typeof IdParams>; Body: Static<typeof UpdateRoleBody> }>(
    '/api/v1/users/:id/role',
    {
      config: {
        policy: { permission: 'users:update:role', mfa: true, audit: true },
        rateTier: 'admin',
      },
      schema: {
        tags: ['users'],
        description:
          'Change a role. Admin + MFA, audited, and also written to Supabase app_metadata so ' +
          'the next token carries it. Nobody can change their own role.',
        params: IdParams,
        body: UpdateRoleBody,
        response: { 200: UserOut },
      },
    },
    async (request) => {
      const { id } = request.params
      const { role } = request.body
      const existing = await prisma.user.findUnique({ where: { id }, include })
      if (!existing) throw notFound()

      if (request.auth && existing.authUserId === request.auth.userId) {
        throw forbidden('SELF_ROLE_CHANGE', 'You cannot change your own role')
      }
      if (existing.role === role) return toPublicUser(existing)

      // Provider first: if it is down nothing has changed anywhere. The access
      // token hook reads ms_user.users.role, so the DB write below is the source
      // of truth either way.
      if (existing.authUserId) {
        try {
          await supabase.admin.updateUser(existing.authUserId, { appRole: role })
        } catch (err) {
          if (!(err instanceof SupabaseAuthError && err.kind === 'not_found')) {
            throw providerUnavailable(request, err)
          }
        }
      }

      const user = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data: { role }, include })
        await writeAuditLog(tx, request, {
          action: 'user.role_change',
          targetUserId: id,
          details: { from: existing.role, to: role },
        })
        return updated
      })
      return toPublicUser(user)
    }
  )

  // ── admin: status ─────────────────────────────────────────────────────────
  server.patch<{ Params: Static<typeof IdParams>; Body: Static<typeof UpdateStatusBody> }>(
    '/api/v1/users/:id/status',
    {
      config: { policy: { permission: 'users:update:status', audit: true }, rateTier: 'admin' },
      schema: {
        tags: ['users'],
        description:
          'Activate or deactivate an account. Deactivating also bans the Supabase user so no ' +
          'new session can be issued. Admin only, audited.',
        params: IdParams,
        body: UpdateStatusBody,
        response: { 200: UserOut },
      },
    },
    async (request) => {
      const { id } = request.params
      const { isActive } = request.body
      const existing = await prisma.user.findUnique({ where: { id }, include })
      if (!existing) throw notFound()

      if (request.auth && existing.authUserId === request.auth.userId && !isActive) {
        throw forbidden('SELF_DEACTIVATION', 'You cannot deactivate your own account')
      }
      if (existing.isActive === isActive) return toPublicUser(existing)

      if (existing.authUserId) {
        try {
          await supabase.admin.updateUser(existing.authUserId, { banned: !isActive })
        } catch (err) {
          if (!(err instanceof SupabaseAuthError && err.kind === 'not_found')) {
            throw providerUnavailable(request, err)
          }
        }
      }

      const user = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data: { isActive }, include })
        await writeAuditLog(tx, request, {
          action: 'user.status_change',
          targetUserId: id,
          details: { from: existing.isActive, to: isActive },
        })
        return updated
      })
      return toPublicUser(user)
    }
  )

  // ── admin: delete ─────────────────────────────────────────────────────────
  server.delete<{ Params: Static<typeof IdParams> }>(
    '/api/v1/users/:id',
    {
      config: {
        policy: { permission: 'users:delete', mfa: true, audit: true },
        rateTier: 'admin',
      },
      schema: {
        tags: ['users'],
        description:
          'Delete a user: the Supabase account, the profile and its addresses. Admin + MFA, audited.',
        params: IdParams,
        response: { 200: SuccessOut },
      },
    },
    async (request) => {
      const { id } = request.params
      const existing = await prisma.user.findUnique({ where: { id } })
      if (!existing) throw notFound()

      if (request.auth && existing.authUserId === request.auth.userId) {
        throw forbidden('SELF_DELETE', 'You cannot delete your own account')
      }

      if (existing.authUserId) {
        try {
          await supabase.admin.deleteUser(existing.authUserId)
        } catch (err) {
          if (!(err instanceof SupabaseAuthError && err.kind === 'not_found')) {
            throw providerUnavailable(request, err)
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.delete({ where: { id } })
        await writeAuditLog(tx, request, {
          action: 'user.delete',
          targetUserId: id,
          details: { email: existing.email, role: existing.role },
        })
      })
      return { success: true }
    }
  )
}
