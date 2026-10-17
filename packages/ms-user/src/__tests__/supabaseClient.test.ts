import { SupabaseAuthError, createSupabaseAuth } from '../supabase'

const CONFIG = {
  url: 'https://proj.supabase.co',
  publishableKey: 'sb_publishable_PUBKEY',
  secretKey: 'sb_secret_TOPSECRET',
}
const ID = '00000000-0000-4000-8000-0000000000aa'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
const client = (handler: Handler, timeoutMs?: number) =>
  createSupabaseAuth(CONFIG, {
    fetchImpl: (async (u: unknown, i: RequestInit) => handler(String(u), i)) as typeof fetch,
    ...(timeoutMs ? { timeoutMs } : {}),
  })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

const kindOf = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof SupabaseAuthError ? e.kind : 'other'
  }
}

describe('supabase auth client', () => {
  it('uses the publishable key for user flows and the secret key only for the Admin API', async () => {
    const seen: Array<{ url: string; apikey: string; bearer: string | undefined }> = []
    const c = client((url, init) => {
      const h = init.headers as Record<string, string>
      seen.push({ url, apikey: h.apikey as string, bearer: h.authorization })
      if (url.includes('/admin/')) return json(200, { id: ID })
      return json(200, { id: ID, identities: [{}] })
    })
    await c.signUp({ email: 'a@b.co', password: 'x'.repeat(10), firstName: 'A', lastName: 'B' })
    await c.admin.createUser({ email: 'a@b.co', emailConfirm: true, appRole: 'CUSTOMER' })
    expect(seen[0]).toEqual({
      url: 'https://proj.supabase.co/auth/v1/signup',
      apikey: CONFIG.publishableKey,
      bearer: undefined,
    })
    expect(seen[1]?.apikey).toBe(CONFIG.secretKey)
    // opaque sb_ keys travel as `apikey` only
    expect(seen[1]?.bearer).toBeUndefined()
  })

  it('sets app_metadata.app_role and email_confirm on admin create, ban_duration on update', async () => {
    const bodies: unknown[] = []
    const c = client((_u, init) => {
      bodies.push(JSON.parse(String(init.body)))
      return json(200, { id: ID })
    })
    await c.admin.createUser({ email: 'a@b.co', emailConfirm: false, appRole: 'VENDOR' })
    await c.admin.updateUser(ID, { appRole: 'ADMIN', banned: true })
    await c.admin.updateUser(ID, { banned: false })
    expect(bodies[0]).toMatchObject({ email_confirm: false, app_metadata: { app_role: 'VENDOR' } })
    expect(bodies[1]).toEqual({ app_metadata: { app_role: 'ADMIN' }, ban_duration: '876000h' })
    expect(bodies[2]).toEqual({ ban_duration: 'none' })
  })

  it('maps upstream failures to kinds and never repeats the upstream message', async () => {
    const SECRET_TEXT = 'User victim@example.com already registered; key sb_secret_TOPSECRET'
    const cases: Array<[number, unknown, string, 'user' | 'admin']> = [
      [400, { error_code: 'invalid_credentials', msg: SECRET_TEXT }, 'invalid_credentials', 'user'],
      [422, { error_code: 'weak_password', msg: SECRET_TEXT }, 'weak_password', 'user'],
      [422, { error_code: 'user_already_exists', msg: SECRET_TEXT }, 'conflict', 'user'],
      [429, { msg: SECRET_TEXT }, 'rate_limited', 'user'],
      [500, { msg: SECRET_TEXT }, 'unavailable', 'user'],
      [401, { msg: SECRET_TEXT }, 'unavailable', 'admin'], // our key is wrong: not "bad credentials"
      [404, { msg: SECRET_TEXT }, 'not_found', 'admin'],
      [400, { msg: SECRET_TEXT }, 'rejected', 'admin'],
    ]
    for (const [status, body, kind, scope] of cases) {
      const c = client(() => json(status, body))
      const err = await (
        scope === 'user'
          ? c.signInWithPassword('a@b.co', 'pw')
          : c.admin.updateUser(ID, { appRole: 'ADMIN' })
      ).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(SupabaseAuthError)
      expect((err as SupabaseAuthError).kind).toBe(kind)
      expect(String((err as Error).message)).not.toContain('victim')
      expect(String((err as Error).message)).not.toContain('sb_secret')
    }
  })

  it('times out and treats network failure as unavailable', async () => {
    const slow = client(
      (_u, init) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new Error('aborted')))
        }),
      50
    )
    expect(await kindOf(slow.refresh('r'))).toBe('unavailable')
    const down = client(() => {
      throw new Error('ECONNREFUSED sb_secret_TOPSECRET')
    })
    expect(await kindOf(down.refresh('r'))).toBe('unavailable')
  })

  it('refuses an unreadable success body and a missing configuration', async () => {
    expect(await kindOf(client(() => json(200, { access_token: 1 })).refresh('r'))).toBe(
      'unavailable'
    )
    const unconfigured = createSupabaseAuth({ url: null, publishableKey: null, secretKey: null })
    expect(await kindOf(unconfigured.refresh('r'))).toBe('not_configured')
    expect(await kindOf(unconfigured.admin.deleteUser(ID))).toBe('not_configured')
  })

  it('keeps a non-uuid id out of the Admin API path', async () => {
    const c = client(() => json(200, {}))
    expect(await kindOf(c.admin.deleteUser('../../admin/users'))).toBe('rejected')
    expect(await kindOf(c.admin.updateUser('x?y=1', { banned: true }))).toBe('rejected')
  })

  it('reports an obfuscated sign-up (no identities) as already registered', async () => {
    const c = client(() => json(200, { id: ID, identities: [] }))
    expect(
      await c.signUp({ email: 'a@b.co', password: 'p', firstName: 'A', lastName: 'B' })
    ).toEqual({
      userId: ID,
      alreadyRegistered: true,
    })
  })
})
