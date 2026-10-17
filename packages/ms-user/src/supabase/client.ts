/**
 * Minimal GoTrue (Supabase Auth) client, fetch-based so ms-user takes no new
 * dependency for six HTTP calls.
 *
 * Two credentials, never mixed up:
 *   - the PUBLISHABLE key identifies the app for end-user flows (sign up, password
 *     sign-in, refresh). It is public by design.
 *   - the SECRET key authorises the Admin API (create/ban/delete users, set
 *     app_metadata). It lives in this process's environment only: it is never
 *     returned, logged, or put in a URL or an error message.
 *
 * Errors are mapped to a small closed set of kinds. The upstream status text and
 * body are deliberately DROPPED: GoTrue messages can echo the e-mail address or
 * reveal whether an account exists, and callers must not be able to relay them.
 */

export type SupabaseErrorKind =
  | 'not_configured' // missing URL / key: a deployment problem, not the caller's
  | 'invalid_credentials' // wrong password, bad or expired refresh token
  | 'weak_password' // rejected by the project's password policy
  | 'conflict' // the e-mail is already registered (admin API only)
  | 'rejected' // any other 4xx: malformed or not allowed
  | 'not_found'
  | 'rate_limited'
  | 'unavailable' // timeout, network failure, 5xx, bad admin key, unreadable reply

export class SupabaseAuthError extends Error {
  constructor(
    readonly kind: SupabaseErrorKind,
    readonly status: number | null = null
  ) {
    // The message is fixed per kind: nothing from the upstream reaches it.
    super(`Supabase Auth request failed (${kind})`)
    this.name = 'SupabaseAuthError'
  }
}

export interface SupabaseAuthConfig {
  /** e.g. https://<project>.supabase.co, no trailing slash. */
  url: string | null
  publishableKey: string | null
  secretKey: string | null
}

export function loadSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseAuthConfig {
  const clean = (v: string | undefined) => v?.trim() || null
  return {
    url: clean(env.SUPABASE_URL)?.replace(/\/+$/, '') ?? null,
    publishableKey: clean(env.SUPABASE_PUBLISHABLE_KEY),
    secretKey: clean(env.SUPABASE_SECRET_KEY),
  }
}

export interface AuthSession {
  accessToken: string
  refreshToken: string
  expiresIn: number
  userId: string
  email: string
}

export interface SignUpResult {
  userId: string | null
  /**
   * GoTrue answers a sign-up for an already-registered address with an
   * obfuscated user whose `identities` is empty (so the API itself does not
   * enumerate accounts). When true, `userId` is not a real account id and must
   * not be linked to anything.
   */
  alreadyRegistered: boolean
}

export interface AdminCreateUserInput {
  email: string
  emailConfirm: boolean
  appRole: string
  firstName?: string
  lastName?: string
  /** Only the sync script sets this, from SEED_USER_PASSWORD. */
  password?: string
}

export interface AdminUpdateUserInput {
  appRole?: string
  banned?: boolean
}

export interface AdminUserSummary {
  id: string
  email: string | null
}

export interface SupabaseAuth {
  signUp(input: {
    email: string
    password: string
    firstName: string
    lastName: string
  }): Promise<SignUpResult>
  signInWithPassword(email: string, password: string): Promise<AuthSession>
  refresh(refreshToken: string): Promise<AuthSession>
  admin: {
    createUser(input: AdminCreateUserInput): Promise<{ id: string }>
    updateUser(id: string, input: AdminUpdateUserInput): Promise<void>
    deleteUser(id: string): Promise<void>
    listUsers(page: number, perPage: number): Promise<AdminUserSummary[]>
  }
}

export interface SupabaseClientOptions {
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 100 years: GoTrue has no "ban forever", only a duration. */
const BAN_FOREVER = '876000h'

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

export function createSupabaseAuth(
  config: SupabaseAuthConfig,
  options: SupabaseClientOptions = {}
): SupabaseAuth {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 8_000

  async function call(
    scope: 'user' | 'admin',
    method: string,
    path: string,
    body?: unknown
  ): Promise<Json> {
    const key = scope === 'admin' ? config.secretKey : config.publishableKey
    if (!config.url || !key) throw new SupabaseAuthError('not_configured')

    const headers: Record<string, string> = { apikey: key, accept: 'application/json' }
    // Legacy keys are JWTs and the gateway wants them as a bearer too. The newer
    // sb_secret_ / sb_publishable_ keys are opaque and are accepted as `apikey` only.
    if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`
    if (body !== undefined) headers['content-type'] = 'application/json'

    let res: Response
    try {
      res = await fetchImpl(`${config.url}/auth/v1${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      // Timeout, DNS, TLS, reset: all the same to a caller.
      throw new SupabaseAuthError('unavailable')
    }

    let parsed: unknown = null
    try {
      const text = await res.text()
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }

    if (res.ok) {
      if (parsed === null && (res.status === 204 || method === 'DELETE')) return {}
      if (!isObject(parsed)) throw new SupabaseAuthError('unavailable', res.status)
      return parsed
    }
    throw mapError(scope, res.status, isObject(parsed) ? parsed : {})
  }

  const session = (data: Json): AuthSession => {
    const user = isObject(data.user) ? data.user : {}
    if (
      typeof data.access_token !== 'string' ||
      typeof data.refresh_token !== 'string' ||
      typeof data.expires_in !== 'number' ||
      typeof user.id !== 'string' ||
      typeof user.email !== 'string'
    ) {
      throw new SupabaseAuthError('unavailable')
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      userId: user.id,
      email: user.email,
    }
  }

  // The id goes into a URL path: refuse anything that is not a plain uuid so it
  // cannot smuggle path segments or query strings into an Admin API call.
  const adminPath = (id: string): string => {
    if (!UUID.test(id)) throw new SupabaseAuthError('rejected')
    return `/admin/users/${id}`
  }

  return {
    async signUp({ email, password, firstName, lastName }) {
      const data = await call('user', 'POST', '/signup', {
        email,
        password,
        data: { first_name: firstName, last_name: lastName },
      })
      // With e-mail confirmation on, the body IS the user; with auto-confirm it is
      // a session carrying `user`.
      const user = isObject(data.user) ? data.user : data
      const id = typeof user.id === 'string' ? user.id : null
      const identities = Array.isArray(user.identities) ? user.identities : null
      return { userId: id, alreadyRegistered: identities !== null && identities.length === 0 }
    },

    async signInWithPassword(email, password) {
      return session(await call('user', 'POST', '/token?grant_type=password', { email, password }))
    },

    async refresh(refreshToken) {
      return session(
        await call('user', 'POST', '/token?grant_type=refresh_token', {
          refresh_token: refreshToken,
        })
      )
    },

    admin: {
      async createUser(input) {
        const data = await call('admin', 'POST', '/admin/users', {
          email: input.email,
          email_confirm: input.emailConfirm,
          ...(input.password ? { password: input.password } : {}),
          app_metadata: { app_role: input.appRole },
          user_metadata: {
            ...(input.firstName ? { first_name: input.firstName } : {}),
            ...(input.lastName ? { last_name: input.lastName } : {}),
          },
        })
        if (typeof data.id !== 'string') throw new SupabaseAuthError('unavailable')
        return { id: data.id }
      },

      async updateUser(id, input) {
        await call('admin', 'PUT', adminPath(id), {
          ...(input.appRole !== undefined ? { app_metadata: { app_role: input.appRole } } : {}),
          ...(input.banned !== undefined
            ? { ban_duration: input.banned ? BAN_FOREVER : 'none' }
            : {}),
        })
      },

      async deleteUser(id) {
        await call('admin', 'DELETE', adminPath(id))
      },

      async listUsers(page, perPage) {
        const data = await call('admin', 'GET', `/admin/users?page=${page}&per_page=${perPage}`)
        if (!Array.isArray(data.users)) throw new SupabaseAuthError('unavailable')
        return data.users.flatMap((u: unknown) =>
          isObject(u) && typeof u.id === 'string'
            ? [{ id: u.id, email: typeof u.email === 'string' ? u.email.toLowerCase() : null }]
            : []
        )
      },
    },
  }
}

function mapError(scope: 'user' | 'admin', status: number, body: Json): SupabaseAuthError {
  const code = typeof body.error_code === 'string' ? body.error_code : ''
  if (status === 429) return new SupabaseAuthError('rate_limited', status)
  if (status >= 500) return new SupabaseAuthError('unavailable', status)
  if (status === 404) return new SupabaseAuthError('not_found', status)
  if (code === 'weak_password') return new SupabaseAuthError('weak_password', status)
  if (code === 'user_already_exists' || code === 'email_exists') {
    return new SupabaseAuthError('conflict', status)
  }
  // A 401/403 on the Admin API means OUR key is wrong: an outage from the caller's
  // point of view, never something to present as "bad credentials".
  if (scope === 'admin' && (status === 401 || status === 403)) {
    return new SupabaseAuthError('unavailable', status)
  }
  if (scope === 'user' && (status === 400 || status === 401 || status === 403)) {
    return new SupabaseAuthError('invalid_credentials', status)
  }
  return new SupabaseAuthError('rejected', status)
}
