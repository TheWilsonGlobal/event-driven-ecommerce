import type { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma, type PrismaClient } from '../../node_modules/.prisma-ms-user/client'
import { AppError, unauthorized, type Static } from '@ecommerce/shared-security'
import { LoginBody, RefreshBody, RegisterBody, RegisterOut, SessionOut } from '../schemas'
import { ensureProfile } from '../services/profiles'
import { SupabaseAuthError, type AuthSession, type SupabaseAuth } from '../supabase'

export interface AuthRouteDeps {
  prisma: PrismaClient
  supabase: SupabaseAuth
}

/**
 * The same sentence whether the address is new, taken, or rejected upstream: a
 * response that differed would tell an attacker which e-mails have accounts.
 */
const REGISTER_MESSAGE =
  'If this address can be registered, a confirmation email has been sent. Check your inbox.'

const invalidCredentials = () => unauthorized('INVALID_CREDENTIALS', 'Invalid email or password')

/** Sign-in and refresh failures: one 401 for every credential problem, 503 for outages. */
function signInFailure(err: unknown): unknown {
  if (!(err instanceof SupabaseAuthError)) return err
  switch (err.kind) {
    case 'rate_limited':
      return new AppError(429, 'RATE_LIMITED', 'Too many requests', {}, { 'retry-after': '30' })
    case 'unavailable':
    case 'not_configured':
      return new AppError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'The identity provider is unavailable')
    default:
      return invalidCredentials()
  }
}

/**
 * Turns a Supabase session into our response. The role comes from the ms_user
 * profile (source of truth), which is created on first sign-in if it is missing.
 */
async function sessionResponse(
  prisma: PrismaClient,
  session: AuthSession
): Promise<Static<typeof SessionOut>> {
  const profile = await ensureProfile(prisma, {
    authUserId: session.userId,
    email: session.email.trim().toLowerCase(),
  })
  // No linkable profile, or a deactivated one: indistinguishable from a bad password.
  if (!profile || !profile.isActive) throw invalidCredentials()

  // Supabase only hands out a session to a confirmed address, so reaching here
  // proves the e-mail: record it.
  if (!profile.isEmailVerified) {
    await prisma.user.update({ where: { id: profile.id }, data: { isEmailVerified: true } })
  }

  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_in: Math.trunc(session.expiresIn),
    user: {
      id: session.userId,
      email: profile.email,
      role: profile.role as Static<typeof SessionOut>['user']['role'],
    },
  }
}

const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store')

export function registerAuthRoutes(server: FastifyInstance, { prisma, supabase }: AuthRouteDeps) {
  server.post<{ Body: Static<typeof RegisterBody> }>(
    '/api/v1/auth/register',
    {
      config: { policy: { public: true }, rateTier: 'auth' },
      schema: {
        tags: ['auth'],
        description:
          'Register a customer account with Supabase Auth. Always answers 202 with the same ' +
          'message, so it cannot be used to discover which e-mails are registered.',
        body: RegisterBody,
        response: { 202: RegisterOut },
      },
    },
    async (request, reply) => {
      const body = request.body
      const email = body.email.trim().toLowerCase()

      try {
        const result = await supabase.signUp({
          email,
          password: body.password,
          firstName: body.firstName,
          lastName: body.lastName,
        })
        if (!result.alreadyRegistered && result.userId) {
          try {
            await prisma.user.create({
              data: {
                authUserId: result.userId,
                email,
                firstName: body.firstName,
                lastName: body.lastName,
                role: 'CUSTOMER',
                isActive: true,
                isEmailVerified: false,
              },
            })
          } catch (err) {
            // A profile with this address (or id) already exists: say nothing.
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
              throw err
            }
          }
        }
      } catch (err) {
        if (err instanceof SupabaseAuthError) {
          if (err.kind === 'weak_password') {
            throw new AppError(
              400,
              'WEAK_PASSWORD',
              'This password does not meet the password requirements'
            )
          }
          if (err.kind === 'rate_limited') {
            throw new AppError(
              429,
              'RATE_LIMITED',
              'Too many requests',
              {},
              { 'retry-after': '30' }
            )
          }
          if (err.kind === 'unavailable' || err.kind === 'not_configured') {
            throw new AppError(
              503,
              'AUTH_PROVIDER_UNAVAILABLE',
              'The identity provider is unavailable'
            )
          }
          // conflict / rejected: indistinguishable from success on purpose.
          request.log.warn({ providerError: err.kind }, 'supabase sign-up not accepted')
        } else {
          throw err
        }
      }

      noStore(reply)
      return reply.status(202).send({ message: REGISTER_MESSAGE })
    }
  )

  server.post<{ Body: Static<typeof LoginBody> }>(
    '/api/v1/auth/login',
    {
      config: { policy: { public: true }, rateTier: 'auth' },
      schema: {
        tags: ['auth'],
        description:
          'Password sign-in through Supabase Auth. Returns the Supabase session; any credential ' +
          'problem is the same 401. `user.id` is the Supabase user id (the token `sub`).',
        body: LoginBody,
        response: { 200: SessionOut },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body
      let session: AuthSession
      try {
        session = await supabase.signInWithPassword(email.trim().toLowerCase(), password)
      } catch (err) {
        throw signInFailure(err)
      }
      noStore(reply)
      return sessionResponse(prisma, session)
    }
  )

  server.post<{ Body: Static<typeof RefreshBody> }>(
    '/api/v1/auth/refresh',
    {
      config: { policy: { public: true }, rateTier: 'auth' },
      schema: {
        tags: ['auth'],
        description: 'Exchange a refresh token for a new session (Supabase rotates it).',
        body: RefreshBody,
        response: { 200: SessionOut },
      },
    },
    async (request, reply) => {
      let session: AuthSession
      try {
        session = await supabase.refresh(request.body.refresh_token)
      } catch (err) {
        throw signInFailure(err)
      }
      noStore(reply)
      return sessionResponse(prisma, session)
    }
  )
}
