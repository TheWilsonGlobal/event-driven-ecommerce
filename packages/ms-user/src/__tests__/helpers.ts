import * as crypto from 'crypto'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import fastify, { type FastifyInstance } from 'fastify'
import {
  MemoryRateStore,
  createTestAuth,
  registerSecurity,
  securityServerOptions,
  type TestAuth,
} from '@ecommerce/shared-security'
import { applyServiceUrlDefaults, type DatabaseConfiguration } from '@ecommerce/shared-database'
import { createRouteRegistry, registerMetrics } from '@ecommerce/shared-utils'
import { PrismaClient } from '../../node_modules/.prisma-ms-user/client'
import { registerRoutes } from '../routes'
import { applyForeignRoutePolicies } from '../security'
import { createSupabaseAuth } from '../supabase'

// ── identities ──────────────────────────────────────────────────────────────

export const ADMIN_AUTH = '00000000-0000-4000-8000-0000000000a1'
export const CUST_A_AUTH = '00000000-0000-4000-8000-0000000000c1'
export const CUST_B_AUTH = '00000000-0000-4000-8000-0000000000c2'
export const VENDOR_AUTH = '00000000-0000-4000-8000-0000000000b1'
export const NEWCOMER_AUTH = '00000000-0000-4000-8000-0000000000d1'

export type Persona = 'ANON' | 'CUSTOMER' | 'VENDOR' | 'ADMIN_AAL1' | 'ADMIN_AAL2'
export const PERSONAS: Persona[] = ['ANON', 'CUSTOMER', 'VENDOR', 'ADMIN_AAL1', 'ADMIN_AAL2']

let ta: TestAuth | undefined
export async function testAuth(): Promise<TestAuth> {
  ta ??= await createTestAuth()
  return ta
}

/** Authorization header for a persona (empty for ANON). */
export async function headersFor(persona: Persona): Promise<Record<string, string>> {
  const auth = await testAuth()
  const claims = {
    CUSTOMER: { sub: CUST_A_AUTH, role: 'CUSTOMER', aal: 'aal1', email: 'a@example.com' },
    VENDOR: { sub: VENDOR_AUTH, role: 'VENDOR', aal: 'aal1', email: 'vendor@example.com' },
    ADMIN_AAL1: { sub: ADMIN_AUTH, role: 'ADMIN', aal: 'aal1', email: 'admin@example.com' },
    ADMIN_AAL2: { sub: ADMIN_AUTH, role: 'ADMIN', aal: 'aal2', email: 'admin@example.com' },
  } as const
  if (persona === 'ANON') return {}
  return { authorization: `Bearer ${await auth.sign(claims[persona])}` }
}

// ── fake GoTrue ─────────────────────────────────────────────────────────────

export interface FakeCall {
  method: string
  path: string
  body: Record<string, unknown> | null
  headers: Record<string, string>
}

/**
 * Stands in for Supabase Auth: records every request and answers like GoTrue
 * does (including its habit of putting a revealing message in error bodies, so
 * tests can prove those never reach our responses).
 */
export class FakeGoTrue {
  calls: FakeCall[] = []
  /** email -> Supabase user id, for sign-in */
  accounts = new Map<string, string>()
  failAdmin: number | null = null
  failUser: number | null = null

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    const headers = (init?.headers ?? {}) as Record<string, string>
    const p = url.pathname.replace('/auth/v1', '') + url.search
    this.calls.push({ method, path: p, body, headers })

    const reply = (status: number, data: unknown) =>
      new Response(data === null ? null : JSON.stringify(data), { status })

    if (p.startsWith('/admin/') && this.failAdmin) return reply(this.failAdmin, { msg: 'boom' })
    if (!p.startsWith('/admin/') && this.failUser) return reply(this.failUser, { msg: 'boom' })

    if (p === '/signup') {
      const email = String(body?.email)
      if (email.startsWith('taken')) {
        // GoTrue's anti-enumeration answer: a fake user with no identities.
        return reply(200, { id: crypto.randomUUID(), email, identities: [] })
      }
      if (email.startsWith('dupe')) {
        return reply(422, {
          error_code: 'user_already_exists',
          msg: `User ${email} already registered`,
        })
      }
      if (email.startsWith('weak'))
        return reply(422, { error_code: 'weak_password', msg: 'too weak' })
      return reply(200, { id: crypto.randomUUID(), email, identities: [{ provider: 'email' }] })
    }
    if (p.startsWith('/token?grant_type=password')) {
      const id = this.accounts.get(String(body?.email))
      if (id && body?.password === 'correct-horse-1')
        return reply(200, session(id, String(body.email)))
      return reply(400, {
        error_code: 'invalid_credentials',
        msg: 'Invalid login credentials for upstream',
      })
    }
    if (p.startsWith('/token?grant_type=refresh_token')) {
      if (body?.refresh_token === 'good-refresh')
        return reply(200, session(CUST_A_AUTH, 'a@example.com'))
      return reply(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
    }
    if (method === 'POST' && p === '/admin/users') {
      if (String(body?.email).startsWith('exists'))
        return reply(422, { error_code: 'email_exists' })
      return reply(200, { id: crypto.randomUUID(), email: body?.email })
    }
    if (p.startsWith('/admin/users/')) return reply(200, {})
    return reply(404, {})
  }

  admin(): FakeCall[] {
    return this.calls.filter((c) => c.path.startsWith('/admin/'))
  }
}

function session(userId: string, email: string) {
  return {
    access_token: 'access.token.value',
    refresh_token: 'refresh-token-value',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email },
  }
}

// ── server ──────────────────────────────────────────────────────────────────

export const NO_LIMITS = {
  ipPerMin: 100_000,
  authIpPerMin: 100_000,
  authEmailPerMin: 100_000,
  userReadPerMin: 100_000,
  userWritePerMin: 100_000,
  expensivePerMin: 100_000,
  adminPerMin: 100_000,
}

export interface TestServer {
  server: FastifyInstance
  gotrue: FakeGoTrue
}

export async function buildTestServer(
  prisma: PrismaClient,
  limits: Partial<typeof NO_LIMITS> = {}
): Promise<TestServer> {
  const auth = await testAuth()
  const gotrue = new FakeGoTrue()
  const supabase = createSupabaseAuth(
    {
      url: 'https://test-project.supabase.co',
      publishableKey: 'sb_publishable_test',
      secretKey: 'sb_secret_test',
    },
    { fetchImpl: gotrue.fetch }
  )

  const server = fastify({ ...securityServerOptions({}), logger: false })
  applyForeignRoutePolicies(server)
  await registerSecurity(server, {
    service: 'ms-user',
    overrides: {
      jwks: auth.jwks,
      store: new MemoryRateStore(),
      config: {
        authMode: 'enforce',
        rateLimitMode: 'enforce',
        issuer: auth.issuer,
        audience: auth.audience,
        serviceAuthSecret: null,
        limits: { ...NO_LIMITS, ...limits },
      },
    },
  })
  // The same wiring as src/index.ts, so /metrics is part of the coverage check.
  registerMetrics(server, { service: 'ms-user-test', collectDefaults: false })
  const routeRegistry = createRouteRegistry(server)
  registerRoutes(server, {
    prisma,
    supabase,
    dbConfig: {
      mode: 'supabase',
      relational: { driver: 'postgres' },
    } as unknown as DatabaseConfiguration,
    routeRegistry,
  })
  await server.ready()
  return { server, gotrue }
}

/** A Prisma stand-in that fails the test if a handler reaches the database. */
export function untouchablePrisma(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_t, prop) {
      if (prop === '$queryRaw') return async () => [{ '?column?': 1 }]
      throw new Error(`database touched: ${String(prop)}`)
    },
  })
}

// ── throwaway schema ────────────────────────────────────────────────────────

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })
applyServiceUrlDefaults(process.env)

export const BASE_DB_URL = process.env.USER_DATABASE_URL

function urlFor(schema: string): string {
  const u = new URL(BASE_DB_URL as string)
  u.search = `?schema=${schema}`
  return u.toString()
}

export interface TempSchema {
  prisma: PrismaClient
  url: string
  drop(): Promise<void>
}

/**
 * Creates test_user_<random> and applies EVERY real migration to it, in order,
 * so the tests run against the schema that will exist in ms_user. ms_user itself
 * is never touched. The migration files are split on `;` exactly as seed.ts does.
 */
export async function createTempSchema(): Promise<TempSchema> {
  const schema = `test_user_${crypto.randomBytes(6).toString('hex')}`
  const admin = new PrismaClient({ datasources: { db: { url: BASE_DB_URL as string } } })
  await admin.$executeRawUnsafe(`CREATE SCHEMA ${schema}`)

  const url = urlFor(schema)
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  const dir = path.resolve(__dirname, '../../prisma/migrations')
  for (const entry of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, entry, 'migration.sql')
    if (!fs.existsSync(file)) continue
    const statements = fs
      .readFileSync(file, 'utf8')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const statement of statements) await prisma.$executeRawUnsafe(statement)
  }

  return {
    prisma,
    url,
    drop: async () => {
      await prisma.$disconnect()
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await admin.$disconnect()
    },
  }
}
