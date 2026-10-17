import { getBridge } from '../auth/bridge'
import { isServiceUrl } from './apiOrigins'

export interface ApiFieldError {
  path: string
  rule: string
}

/** Standard backend error body: {statusCode, error, code, message, requestId, fields?}. */
export class ApiError extends Error {
  readonly statusCode: number
  readonly error: string
  readonly code: string
  readonly requestId?: string
  readonly fields?: ApiFieldError[]
  readonly retryAfterSeconds?: number

  constructor(init: {
    statusCode: number
    error?: string
    code?: string
    message?: string
    requestId?: string
    fields?: ApiFieldError[]
    retryAfterSeconds?: number
  }) {
    super(init.message || `HTTP ${init.statusCode}`)
    this.name = 'ApiError'
    this.statusCode = init.statusCode
    this.error = init.error ?? ''
    this.code = init.code ?? ''
    this.requestId = init.requestId
    this.fields = init.fields
    this.retryAfterSeconds = init.retryAfterSeconds
  }
}

interface ErrorBody {
  statusCode?: number
  error?: string
  code?: string
  message?: string
  requestId?: string
  fields?: ApiFieldError[]
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  try {
    const body: unknown = await res.clone().json()
    return body && typeof body === 'object' ? (body as ErrorBody) : {}
  } catch {
    return {}
  }
}

function retryAfter(res: Response): number | undefined {
  const raw = res.headers?.get?.('Retry-After')
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function friendlyMessage(
  status: number,
  body: ErrorBody,
  fields: ApiFieldError[] | undefined,
  retryAfterSeconds: number | undefined
): string {
  if (body.code === 'FORBIDDEN') return 'Not allowed for your role.'
  if (body.code === 'MFA_REQUIRED') return 'Two-factor authentication is required for this action.'
  if (status === 429 || body.code === 'RATE_LIMITED') {
    return retryAfterSeconds !== undefined
      ? `Rate limited -- retry in ${retryAfterSeconds}s.`
      : 'Rate limited -- please retry shortly.'
  }
  if (body.code === 'VALIDATION_FAILED' && fields?.length) {
    const list = fields.map((f) => `${f.path}: ${f.rule}`).join('; ')
    return `${body.message ?? 'Invalid input'} (${list})`
  }
  return body.message || body.error || `HTTP ${status}`
}

/** Turns a non-OK response into a typed ApiError (does not consume `res`). */
export async function toApiError(res: Response): Promise<ApiError> {
  const body = await readErrorBody(res)
  const retryAfterSeconds = retryAfter(res)
  const fields = Array.isArray(body.fields) ? body.fields : undefined
  return new ApiError({
    statusCode: res.status,
    error: body.error,
    code: body.code,
    message: friendlyMessage(res.status, body, fields, retryAfterSeconds),
    requestId: body.requestId,
    fields,
    retryAfterSeconds,
  })
}

/** Display text for any caught error; appends the request id of an ApiError for support. */
export function errorText(err: unknown, fallback = 'Unknown error'): string {
  if (err instanceof ApiError) {
    return err.requestId ? `${err.message} (ref ${err.requestId})` : err.message
  }
  return err instanceof Error ? err.message : fallback
}

let refreshing: Promise<string | null> | null = null
function refreshOnce(): Promise<string | null> {
  refreshing ??= getBridge()
    .refresh()
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

function withToken(init: RequestInit | undefined, token: string | null): RequestInit {
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

/**
 * fetch() for the admin app. Drop-in: resolves a Response for any HTTP status
 * (callers keep their `res.ok` handling) and rejects only on network failure.
 *
 * - Bearer token is attached ONLY to allow-listed service origins.
 * - 401: refresh the session once and retry; if still 401, back to sign-in.
 * - 403 MFA_REQUIRED: open the MFA flow, then retry once.
 * - 429 / 503 RATE_LIMIT_UNAVAILABLE: surfaced as a notice (with retry time).
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isServiceUrl(url)) return fetch(url, init)

  const bridge = getBridge()
  let res = await fetch(url, withToken(init, bridge.getToken()))

  if (res.status === 401) {
    const fresh = await refreshOnce()
    if (!fresh) {
      bridge.onSessionExpired()
      return res
    }
    res = await fetch(url, withToken(init, fresh))
    if (res.status === 401) {
      bridge.onSessionExpired()
      return res
    }
  }

  if (res.status === 403) {
    const body = await readErrorBody(res)
    if (body.code === 'MFA_REQUIRED') {
      const ok = await bridge.requestMfa()
      if (ok) res = await fetch(url, withToken(init, bridge.getToken()))
    }
  }

  if (res.status === 429) {
    const secs = retryAfter(res)
    bridge.notify(
      secs !== undefined
        ? `Rate limited -- retry in ${secs}s.`
        : 'Rate limited -- please retry shortly.'
    )
  } else if (res.status === 503) {
    const body = await readErrorBody(res)
    if (body.code === 'RATE_LIMIT_UNAVAILABLE') {
      bridge.notify('Rate limiter unavailable -- the request was refused. Try again shortly.')
    }
  }

  return res
}

/** apiFetch + JSON parse, throwing ApiError for any non-OK status. */
export async function apiFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init)
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as T
}
