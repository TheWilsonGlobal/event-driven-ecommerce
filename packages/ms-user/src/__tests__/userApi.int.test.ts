import type { FastifyInstance } from 'fastify'
import {
  ADMIN_AUTH,
  BASE_DB_URL,
  CUST_A_AUTH,
  CUST_B_AUTH,
  NEWCOMER_AUTH,
  VENDOR_AUTH,
  buildTestServer,
  createTempSchema,
  headersFor,
  testAuth,
  type FakeGoTrue,
  type Persona,
  type TempSchema,
} from './helpers'
import type { PrismaClient } from '../../node_modules/.prisma-ms-user/client'

/**
 * ms-user against real Postgres in a throwaway schema (test_user_<random>), built
 * from the REAL migration files and dropped afterwards, so ms_user is never
 * touched. Supabase Auth is a fake fetch. Without USER_DATABASE_URL (derived from
 * SUPABASE_DB_URL) the suite is skipped, visibly.
 */
jest.setTimeout(120_000)

const dbDescribe = BASE_DB_URL ? describe : describe.skip

let tmp: TempSchema
let prisma: PrismaClient
let server: FastifyInstance
let gotrue: FakeGoTrue
/** Every response body the suite saw, for the "no credential material anywhere" check. */
const transcript: string[] = []

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  persona: Persona,
  body?: unknown,
  opts: { server?: FastifyInstance; remoteAddress?: string } = {}
) {
  const headers = await headersFor(persona)
  const res = await (opts.server ?? server).inject({
    method,
    url,
    headers: body !== undefined ? { ...headers, 'content-type': 'application/json' } : headers,
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    ...(opts.remoteAddress ? { remoteAddress: opts.remoteAddress } : {}),
  })
  transcript.push(res.body)
  let json: Record<string, any> = {}
  try {
    json = res.json()
  } catch {
    /* non-JSON */
  }
  return { status: res.statusCode, json, headers: res.headers, text: res.body }
}

const audits = () =>
  prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } }) as Promise<
    Array<{
      actorUserId: string | null
      actorRole: string | null
      action: string
      targetUserId: string | null
      details: Record<string, unknown> | null
    }>
  >

async function reseed() {
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany()
  const base = { isActive: true, isEmailVerified: true }
  await prisma.user.createMany({
    data: [
      {
        ...base,
        id: 'p-admin',
        authUserId: ADMIN_AUTH,
        email: 'admin@example.com',
        firstName: 'Ada',
        lastName: 'Admin',
        role: 'ADMIN',
      },
      // A legacy row that still has a bcrypt hash in the column.
      {
        ...base,
        id: 'p-a',
        authUserId: CUST_A_AUTH,
        email: 'a@example.com',
        firstName: 'Alice',
        lastName: 'A',
        role: 'CUSTOMER',
        passwordHash: 'LEAK-ME-HASH',
      },
      {
        ...base,
        id: 'p-b',
        authUserId: CUST_B_AUTH,
        email: 'b@example.com',
        firstName: 'Bob',
        lastName: 'B',
        role: 'CUSTOMER',
      },
      {
        ...base,
        id: 'p-vendor',
        authUserId: VENDOR_AUTH,
        email: 'vendor@example.com',
        firstName: 'Vera',
        lastName: 'V',
        role: 'VENDOR',
      },
      // A seeded row nobody has linked to a Supabase account yet.
      {
        ...base,
        id: 'p-unlinked',
        email: 'unlinked@example.com',
        firstName: 'Una',
        lastName: 'U',
        role: 'ADMIN',
      },
    ],
  })
  await prisma.address.create({
    data: {
      userId: 'p-a',
      addressLine1: '1 Main St',
      city: 'X',
      state: 'Y',
      postalCode: '1',
      country: 'US',
      isDefaultShipping: true,
    },
  })
}

beforeAll(async () => {
  if (!BASE_DB_URL) return
  tmp = await createTempSchema()
  prisma = tmp.prisma
  ;({ server, gotrue } = await buildTestServer(prisma))
})

afterAll(async () => {
  if (!BASE_DB_URL) return
  await server?.close()
  await tmp?.drop()
})

beforeEach(async () => {
  if (!BASE_DB_URL) return
  await reseed()
  gotrue.calls = []
  gotrue.failAdmin = null
  gotrue.failUser = null
  gotrue.accounts.clear()
})

dbDescribe('the migrations', () => {
  it('make password_hash nullable, add a unique auth_user_id and the audit_log table', async () => {
    const cols = await prisma.$queryRawUnsafe<
      { column_name: string; is_nullable: string; data_type: string }[]
    >(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users'`
    )
    const col = (n: string) => cols.find((c) => c.column_name === n)
    expect(col('password_hash')?.is_nullable).toBe('YES')
    expect(col('auth_user_id')?.data_type).toBe('uuid')
    // refresh_tokens is deprecated but must still exist (nothing dropped)
    const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`
    )
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(['users', 'addresses', 'refresh_tokens', 'audit_log'])
    )
    await expect(
      prisma.user.create({
        data: { email: 'dup@example.com', firstName: 'D', lastName: 'D', authUserId: ADMIN_AUTH },
      })
    ).rejects.toThrow()
  })
})

dbDescribe('profiles and ownership', () => {
  it('GET /users/me returns the caller own profile for every role', async () => {
    expect((await call('GET', '/api/v1/users/me', 'CUSTOMER')).json.id).toBe('p-a')
    expect((await call('GET', '/api/v1/users/me', 'VENDOR')).json.id).toBe('p-vendor')
    const admin = await call('GET', '/api/v1/users/me', 'ADMIN_AAL1')
    expect(admin.status).toBe(200)
    expect(admin.json.role).toBe('ADMIN')
  })

  it('GET /users/me provisions a CUSTOMER row on first call, once', async () => {
    const ta = await testAuth()
    const token = await ta.sign({
      sub: NEWCOMER_AUTH,
      role: 'CUSTOMER',
      email: 'Newcomer@Example.com',
    })
    const get = () =>
      server.inject({
        method: 'GET',
        url: '/api/v1/users/me',
        headers: { authorization: `Bearer ${token}` },
      })
    const [first, second] = [await get(), await get()]
    expect(first.statusCode).toBe(200)
    expect(second.json().id).toBe(first.json().id)
    expect(first.json()).toMatchObject({
      email: 'newcomer@example.com',
      role: 'CUSTOMER',
      isActive: true,
    })
    const rows = await prisma.user.findMany({ where: { authUserId: NEWCOMER_AUTH } })
    expect(rows).toHaveLength(1)
  })

  it('does NOT adopt an unlinked row that merely shares the e-mail (no role takeover)', async () => {
    const ta = await testAuth()
    const token = await ta.sign({
      sub: NEWCOMER_AUTH,
      role: 'CUSTOMER',
      email: 'unlinked@example.com',
    })
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('PROFILE_CONFLICT')
    expect((await prisma.user.findUnique({ where: { id: 'p-unlinked' } }))?.authUserId).toBeNull()
  })

  it('a customer reads and updates only their own profile; others are 404', async () => {
    expect((await call('GET', '/api/v1/users/p-a', 'CUSTOMER')).status).toBe(200)
    const other = await call('GET', '/api/v1/users/p-b', 'CUSTOMER')
    const missing = await call('GET', '/api/v1/users/p-nope', 'CUSTOMER')
    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    // indistinguishable from "does not exist"
    expect(other.json.code).toBe(missing.json.code)
    expect(other.json.message).toBe(missing.json.message)
    expect((await call('GET', '/api/v1/users/p-a', 'VENDOR')).status).toBe(404)

    expect(
      (
        await call('PATCH', '/api/v1/users/p-a', 'CUSTOMER', {
          firstName: 'Alicia',
          phoneNumber: '+1 555 0100',
        })
      ).json
    ).toMatchObject({
      firstName: 'Alicia',
      phoneNumber: '+1 555 0100',
    })
    expect(
      (await call('PATCH', '/api/v1/users/p-b', 'CUSTOMER', { firstName: 'Hacked' })).status
    ).toBe(404)
    expect((await prisma.user.findUnique({ where: { id: 'p-b' } }))?.firstName).toBe('Bob')
  })

  it('an admin can read and update any profile', async () => {
    expect((await call('GET', '/api/v1/users/p-b', 'ADMIN_AAL1')).status).toBe(200)
    expect(
      (await call('PATCH', '/api/v1/users/p-b', 'ADMIN_AAL1', { lastName: 'Builder' })).json
        .lastName
    ).toBe('Builder')
  })

  it('a customer cannot PATCH their own role (400 from the schema, row unchanged, no audit)', async () => {
    for (const body of [
      { role: 'ADMIN' },
      { firstName: 'X', role: 'ADMIN' },
      { isActive: false },
      { isEmailVerified: false },
    ]) {
      const r = await call('PATCH', '/api/v1/users/p-a', 'CUSTOMER', body)
      expect(r.status).toBe(400)
      expect(r.json.code).toBe('VALIDATION_FAILED')
    }
    expect((await prisma.user.findUnique({ where: { id: 'p-a' } }))?.role).toBe('CUSTOMER')
    expect(await audits()).toHaveLength(0)
  })

  it('lists users with bounded pagination for admins only', async () => {
    const r = await call('GET', '/api/v1/users?limit=2&page=2', 'ADMIN_AAL1')
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ total: 5, page: 2, limit: 2 })
    expect(r.json.users).toHaveLength(2)
    expect((await call('GET', '/api/v1/users', 'CUSTOMER')).status).toBe(403)
  })
})

dbDescribe('role, status, create and delete (admin, audited)', () => {
  it('a role change needs aal2, updates Supabase app_metadata and writes an AuditLog row', async () => {
    expect(
      (await call('PATCH', '/api/v1/users/p-b/role', 'CUSTOMER', { role: 'ADMIN' })).status
    ).toBe(403)
    const noMfa = await call('PATCH', '/api/v1/users/p-b/role', 'ADMIN_AAL1', { role: 'VENDOR' })
    expect(noMfa.status).toBe(403)
    expect(noMfa.json.code).toBe('MFA_REQUIRED')
    expect((await prisma.user.findUnique({ where: { id: 'p-b' } }))?.role).toBe('CUSTOMER')

    const ok = await call('PATCH', '/api/v1/users/p-b/role', 'ADMIN_AAL2', { role: 'VENDOR' })
    expect(ok.status).toBe(200)
    expect(ok.json.role).toBe('VENDOR')
    expect((await prisma.user.findUnique({ where: { id: 'p-b' } }))?.role).toBe('VENDOR')

    const put = gotrue.admin().find((c) => c.method === 'PUT')
    expect(put?.path).toBe(`/admin/users/${CUST_B_AUTH}`)
    expect(put?.body).toEqual({ app_metadata: { app_role: 'VENDOR' } })

    const rows = await audits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorUserId: ADMIN_AUTH,
      actorRole: 'ADMIN',
      action: 'user.role_change',
      targetUserId: 'p-b',
      details: { from: 'CUSTOMER', to: 'VENDOR' },
    })
  })

  it('nobody changes their own role, not even an aal2 admin', async () => {
    const r = await call('PATCH', '/api/v1/users/p-admin/role', 'ADMIN_AAL2', { role: 'CUSTOMER' })
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('SELF_ROLE_CHANGE')
    expect((await prisma.user.findUnique({ where: { id: 'p-admin' } }))?.role).toBe('ADMIN')
    expect(await audits()).toHaveLength(0)
    expect(gotrue.admin()).toHaveLength(0)
  })

  it('leaves everything unchanged when the identity provider is down', async () => {
    gotrue.failAdmin = 503
    const r = await call('PATCH', '/api/v1/users/p-b/role', 'ADMIN_AAL2', { role: 'ADMIN' })
    expect(r.status).toBe(503)
    expect(r.json.code).toBe('AUTH_PROVIDER_UNAVAILABLE')
    expect(r.text).not.toContain('boom')
    expect((await prisma.user.findUnique({ where: { id: 'p-b' } }))?.role).toBe('CUSTOMER')
    expect(await audits()).toHaveLength(0)
  })

  it('skips the provider for a row with no Supabase account and a no-op change writes nothing', async () => {
    expect(
      (await call('PATCH', '/api/v1/users/p-unlinked/role', 'ADMIN_AAL2', { role: 'VENDOR' }))
        .status
    ).toBe(200)
    expect(gotrue.admin()).toHaveLength(0)
    expect(await audits()).toHaveLength(1)
    await call('PATCH', '/api/v1/users/p-unlinked/role', 'ADMIN_AAL2', { role: 'VENDOR' })
    expect(await audits()).toHaveLength(1)
  })

  it('status change bans / unbans in Supabase, is audited, and cannot deactivate yourself', async () => {
    const off = await call('PATCH', '/api/v1/users/p-b/status', 'ADMIN_AAL1', { isActive: false })
    expect(off.status).toBe(200)
    expect(off.json.isActive).toBe(false)
    expect(gotrue.admin()[0]?.body).toEqual({ ban_duration: '876000h' })
    expect((await audits())[0]).toMatchObject({
      action: 'user.status_change',
      details: { from: true, to: false },
    })
    await call('PATCH', '/api/v1/users/p-b/status', 'ADMIN_AAL1', { isActive: true })
    expect(gotrue.admin()[1]?.body).toEqual({ ban_duration: 'none' })

    const self = await call('PATCH', '/api/v1/users/p-admin/status', 'ADMIN_AAL1', {
      isActive: false,
    })
    expect(self.status).toBe(403)
    expect(
      (await call('PATCH', '/api/v1/users/p-b/status', 'CUSTOMER', { isActive: false })).status
    ).toBe(403)
  })

  it('creates the Supabase account and the profile, never stores a password, and audits it', async () => {
    const r = await call('POST', '/api/v1/users', 'ADMIN_AAL2', {
      email: 'New.Hire@Example.com',
      firstName: 'New',
      lastName: 'Hire',
      role: 'VENDOR',
      addressLine1: '9 Road',
      city: 'C',
      state: 'S',
      postalCode: '9',
    })
    expect(r.status).toBe(201)
    expect(r.json).toMatchObject({
      email: 'new.hire@example.com',
      role: 'VENDOR',
      isEmailVerified: true,
    })
    expect(r.json.addresses).toHaveLength(1)

    const post = gotrue.admin().find((c) => c.method === 'POST')
    expect(post?.body).toMatchObject({
      email: 'new.hire@example.com',
      email_confirm: true,
      app_metadata: { app_role: 'VENDOR' },
    })
    expect(post?.body).not.toHaveProperty('password')

    const row = await prisma.user.findUnique({ where: { id: r.json.id } })
    expect(row?.passwordHash).toBeNull()
    expect(row?.authUserId).toMatch(/^[0-9a-f-]{36}$/)
    expect((await audits())[0]).toMatchObject({ action: 'user.create', targetUserId: r.json.id })
  })

  it('honours emailConfirm:false, and refuses duplicates from the DB or the provider', async () => {
    const unconfirmed = await call('POST', '/api/v1/users', 'ADMIN_AAL2', {
      email: 'later@example.com',
      firstName: 'L',
      lastName: 'L',
      emailConfirm: false,
    })
    expect(unconfirmed.json.isEmailVerified).toBe(false)
    expect(gotrue.admin()[0]?.body).toMatchObject({ email_confirm: false })

    const dupDb = await call('POST', '/api/v1/users', 'ADMIN_AAL2', {
      email: 'A@example.com',
      firstName: 'D',
      lastName: 'D',
    })
    expect(dupDb.status).toBe(409)
    const dupAuth = await call('POST', '/api/v1/users', 'ADMIN_AAL2', {
      email: 'exists@example.com',
      firstName: 'D',
      lastName: 'D',
    })
    expect(dupAuth.status).toBe(409)
    expect(await prisma.user.findUnique({ where: { email: 'exists@example.com' } })).toBeNull()
  })

  it('deletes the profile and the Supabase account, audits it, and refuses self-delete', async () => {
    expect((await call('DELETE', '/api/v1/users/p-b', 'ADMIN_AAL1')).status).toBe(403) // MFA
    const ok = await call('DELETE', '/api/v1/users/p-b', 'ADMIN_AAL2')
    expect(ok.json).toEqual({ success: true })
    expect(await prisma.user.findUnique({ where: { id: 'p-b' } })).toBeNull()
    expect(gotrue.admin().find((c) => c.method === 'DELETE')?.path).toBe(
      `/admin/users/${CUST_B_AUTH}`
    )
    expect((await audits())[0]).toMatchObject({
      action: 'user.delete',
      targetUserId: 'p-b',
      details: { email: 'b@example.com', role: 'CUSTOMER' },
    })

    expect((await call('DELETE', '/api/v1/users/p-admin', 'ADMIN_AAL2')).status).toBe(403)
    expect((await call('DELETE', '/api/v1/users/p-nope', 'ADMIN_AAL2')).status).toBe(404)

    gotrue.calls = []
    await call('DELETE', '/api/v1/users/p-unlinked', 'ADMIN_AAL2')
    expect(gotrue.admin()).toHaveLength(0)
  })
})

dbDescribe('operator routes', () => {
  it('serve an aal2 admin and nobody else', async () => {
    for (const url of ['/api/v1/schema', '/api/v1/endpoints', '/api/v1/logs']) {
      expect((await call('GET', url, 'ADMIN_AAL2')).status).toBe(200)
      expect((await call('GET', url, 'ADMIN_AAL1')).status).toBe(403)
      expect((await call('GET', url, 'CUSTOMER')).status).toBe(403)
    }
    expect((await call('GET', '/api/v1/logs/nope.log', 'ADMIN_AAL2')).status).toBe(404)
    const schema = await call('GET', '/api/v1/schema', 'ADMIN_AAL2')
    expect(schema.json.tables.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining(['users', 'audit_log'])
    )
  })
})

dbDescribe('registration', () => {
  it('answers 202 with the same body whether or not the address is already registered', async () => {
    const attempt = (email: string) =>
      call('POST', '/api/v1/auth/register', 'ANON', {
        email,
        password: 'a-long-password',
        firstName: 'R',
        lastName: 'R',
      })

    const fresh = await attempt('fresh@example.com')
    const taken = await attempt('taken@example.com') // GoTrue: obfuscated user, no identities
    const dupe = await attempt('dupe@example.com') // GoTrue: 422 user_already_exists
    const profileExists = await attempt('a@example.com') // we already hold a profile for it

    for (const r of [fresh, taken, dupe, profileExists]) expect(r.status).toBe(202)
    const bodies = new Set([fresh, taken, dupe, profileExists].map((r) => JSON.stringify(r.json)))
    expect(bodies.size).toBe(1)
    expect(fresh.text).not.toMatch(/already|registered email|exists/i)

    // only the genuinely new address got a profile (and it is a CUSTOMER)
    expect(await prisma.user.findUnique({ where: { email: 'fresh@example.com' } })).toMatchObject({
      role: 'CUSTOMER',
      isEmailVerified: false,
      passwordHash: null,
    })
    expect(await prisma.user.findUnique({ where: { email: 'taken@example.com' } })).toBeNull()
    expect(await prisma.user.findUnique({ where: { email: 'dupe@example.com' } })).toBeNull()
    expect((await prisma.user.findUnique({ where: { email: 'a@example.com' } }))?.authUserId).toBe(
      CUST_A_AUTH
    )
    expect(await prisma.user.count()).toBe(6)
  })

  it('never sends the password to anything but Supabase, and reports a weak one plainly', async () => {
    const weak = await call('POST', '/api/v1/auth/register', 'ANON', {
      email: 'weak@example.com',
      password: 'password123',
      firstName: 'W',
      lastName: 'W',
    })
    expect(weak.status).toBe(400)
    expect(weak.json.code).toBe('WEAK_PASSWORD')
    expect(weak.text).not.toContain('password123')
  })
})

dbDescribe('login and refresh', () => {
  it('returns the Supabase session with the role from the ms_user profile', async () => {
    gotrue.accounts.set('vendor@example.com', VENDOR_AUTH)
    const r = await call('POST', '/api/v1/auth/login', 'ANON', {
      email: 'Vendor@Example.com',
      password: 'correct-horse-1',
    })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({
      access_token: 'access.token.value',
      refresh_token: 'refresh-token-value',
      expires_in: 3600,
      user: { id: VENDOR_AUTH, email: 'vendor@example.com', role: 'VENDOR' },
    })
    expect(r.headers['cache-control']).toBe('no-store')
    expect(r.text).not.toContain('mock-jwt-token')
  })

  it('is the same generic 401 for a wrong password, an unknown e-mail and a deactivated account', async () => {
    gotrue.accounts.set('a@example.com', CUST_A_AUTH)
    await prisma.user.update({ where: { id: 'p-b' }, data: { isActive: false } })
    gotrue.accounts.set('b@example.com', CUST_B_AUTH)

    const results = [
      await call('POST', '/api/v1/auth/login', 'ANON', {
        email: 'a@example.com',
        password: 'wrong-password',
      }),
      await call('POST', '/api/v1/auth/login', 'ANON', {
        email: 'user@example.com',
        password: 'whatever',
      }),
      await call('POST', '/api/v1/auth/login', 'ANON', {
        email: 'b@example.com',
        password: 'correct-horse-1',
      }),
    ]
    for (const r of results) {
      expect(r.status).toBe(401)
      expect(r.json.code).toBe('INVALID_CREDENTIALS')
      expect(r.text).not.toContain('upstream')
    }
    expect(new Set(results.map((r) => r.json.message)).size).toBe(1)
    // no default e-mail is invented and no profile is created for the unknown one
    expect(await prisma.user.findUnique({ where: { email: 'user@example.com' } })).toBeNull()
  })

  it('provisions a CUSTOMER profile at first sign-in for an account created in Supabase directly', async () => {
    gotrue.accounts.set('direct@example.com', NEWCOMER_AUTH)
    const r = await call('POST', '/api/v1/auth/login', 'ANON', {
      email: 'direct@example.com',
      password: 'correct-horse-1',
    })
    expect(r.status).toBe(200)
    expect(r.json.user.role).toBe('CUSTOMER')
    expect(await prisma.user.findUnique({ where: { authUserId: NEWCOMER_AUTH } })).toMatchObject({
      role: 'CUSTOMER',
      isEmailVerified: true,
    })
  })

  it('refreshes a session and gives the same 401 for a bad refresh token', async () => {
    const ok = await call('POST', '/api/v1/auth/refresh', 'ANON', { refresh_token: 'good-refresh' })
    expect(ok.status).toBe(200)
    expect(ok.json.user).toMatchObject({ id: CUST_A_AUTH, role: 'CUSTOMER' })
    const bad = await call('POST', '/api/v1/auth/refresh', 'ANON', {
      refresh_token: 'stolen-or-expired',
    })
    expect(bad.status).toBe(401)
    expect(bad.json.code).toBe('INVALID_CREDENTIALS')
  })

  it('maps an identity-provider outage to 503, not to "wrong password"', async () => {
    gotrue.failUser = 502
    const login = await call('POST', '/api/v1/auth/login', 'ANON', {
      email: 'a@example.com',
      password: 'whatever-1',
    })
    expect(login.status).toBe(503)
    expect(login.json.code).toBe('AUTH_PROVIDER_UNAVAILABLE')
    const register = await call('POST', '/api/v1/auth/register', 'ANON', {
      email: 'outage@example.com',
      password: 'a-long-password',
      firstName: 'O',
      lastName: 'O',
    })
    expect(register.status).toBe(503)
    expect(await prisma.user.findUnique({ where: { email: 'outage@example.com' } })).toBeNull()
  })
})

dbDescribe('rate limiting on the auth routes', () => {
  it('answers 429 with Retry-After once the auth bucket is spent', async () => {
    const limited = await buildTestServer(prisma, { authIpPerMin: 3 })
    const codes: number[] = []
    let last
    for (let i = 0; i < 5; i += 1) {
      last = await call(
        'POST',
        '/api/v1/auth/login',
        'ANON',
        { email: `u${i}@example.com`, password: 'wrong-password' },
        { server: limited.server }
      )
      codes.push(last.status)
    }
    expect(codes).toEqual([401, 401, 401, 429, 429])
    expect(last?.json.code).toBe('RATE_LIMITED')
    expect(Number(last?.headers['retry-after'])).toBeGreaterThan(0)
    // another client address is unaffected
    const other = await call(
      'POST',
      '/api/v1/auth/login',
      'ANON',
      { email: 'o@example.com', password: 'x' },
      { server: limited.server, remoteAddress: '10.9.9.9' }
    )
    expect(other.status).toBe(401)
    await limited.server.close()
  })

  it('also limits per e-mail, so credential stuffing spread over many IPs is stopped', async () => {
    const limited = await buildTestServer(prisma, { authEmailPerMin: 2 })
    const codes: number[] = []
    for (let i = 0; i < 4; i += 1) {
      const r = await call(
        'POST',
        '/api/v1/auth/login',
        'ANON',
        { email: 'Victim@Example.com', password: `guess-${i}` },
        { server: limited.server, remoteAddress: `10.0.0.${i + 1}` }
      )
      codes.push(r.status)
    }
    expect(codes).toEqual([401, 401, 429, 429])
    await limited.server.close()
  })
})

dbDescribe('credential material', () => {
  it('passwordHash (and the auth link) appear in no response from any route', async () => {
    // Touch every data route with the legacy hashed row in scope, then scan everything seen.
    await call('GET', '/api/v1/users?limit=100', 'ADMIN_AAL1')
    await call('GET', '/api/v1/users/p-a', 'ADMIN_AAL1')
    await call('GET', '/api/v1/users/me', 'CUSTOMER')
    await call('PATCH', '/api/v1/users/p-a', 'CUSTOMER', { firstName: 'Still' })
    await call('PATCH', '/api/v1/users/p-a/role', 'ADMIN_AAL2', { role: 'VENDOR' })
    await call('PATCH', '/api/v1/users/p-a/status', 'ADMIN_AAL2', { isActive: true })
    await call('GET', '/api/v1/schema', 'ADMIN_AAL2')

    const all = transcript.join('\n')
    expect(all.length).toBeGreaterThan(1000)
    // (/schema lists column NAMES such as password_hash: structure, never a value)
    for (const needle of ['LEAK-ME-HASH', 'passwordHash', 'authUserId']) {
      expect(all).not.toContain(needle)
    }
  })
})
