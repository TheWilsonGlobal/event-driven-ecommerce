export interface ApiFieldError {
  path: string
  rule: string
}

export interface ApiErrorInit {
  status: number
  code: string
  message: string
  requestId?: string | undefined
  fields?: ApiFieldError[]
  retryAfterSeconds?: number | undefined
}

/** Typed form of the backend's standard error body. Never carries tokens or request bodies. */
export class ApiError extends Error {
  status: number
  code: string
  requestId?: string | undefined
  fields: ApiFieldError[]
  retryAfterSeconds?: number | undefined

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.requestId = init.requestId
    this.fields = init.fields ?? []
    this.retryAfterSeconds = init.retryAfterSeconds
  }

  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.code === 'AUTHENTICATION_REQUIRED' ||
      this.code === 'TOKEN_INVALID'
    )
  }
}

const FIELD_LABELS: Record<string, string> = {
  customerName: 'Full name',
  customerEmail: 'Email',
  'shippingAddress.addressLine1': 'Shipping address',
  'shippingAddress.city': 'City',
  'shippingAddress.state': 'State',
  'shippingAddress.postalCode': 'Postal code',
}

function describeRule(rule: string): string {
  if (rule.startsWith('required')) return 'is required'
  if (rule === 'format') return 'is not in a valid format'
  if (rule === 'maxLength') return 'is too long'
  if (rule === 'minLength') return 'is too short'
  if (rule === 'maximum' || rule === 'minimum') return 'is out of range'
  if (rule === 'multipleOf') return 'has too many decimals'
  return 'is invalid'
}

/** Field-level messages, e.g. ["City is required"]. */
export function fieldMessages(fields: ApiFieldError[]): string[] {
  return fields.map((f) => {
    const raw = f.rule.startsWith('required:') ? f.rule.slice('required:'.length) : f.path
    const label =
      FIELD_LABELS[f.path] ??
      FIELD_LABELS[raw] ??
      raw.replace(/^items\.(\d+)\./, 'Item $1 ').replace(/^body\./, '')
    return `${label} ${describeRule(f.rule)}`
  })
}

export function rateLimitMessage(seconds?: number): string {
  return seconds && seconds > 0
    ? `Too many requests. Please wait ${seconds} second${seconds === 1 ? '' : 's'} and try again.`
    : 'Too many requests. Please wait a moment and try again.'
}

/** A user-facing sentence for any ApiError. */
export function friendlyMessage(err: ApiError): string {
  switch (err.code) {
    case 'RATE_LIMITED':
      return rateLimitMessage(err.retryAfterSeconds)
    case 'AUTHENTICATION_REQUIRED':
    case 'TOKEN_INVALID':
      return 'Please sign in to continue.'
    case 'FORBIDDEN':
      return 'You do not have permission to do that.'
    case 'PRICE_MISMATCH':
      return 'Some prices have changed. We refreshed your cart; please review it and try again.'
    case 'PAYLOAD_TOO_LARGE':
      return 'That request is too large. Please reduce it and try again.'
    case 'RATE_LIMIT_UNAVAILABLE':
      return 'The service is temporarily unavailable. Please try again shortly.'
    case 'VALIDATION_FAILED': {
      const msgs = fieldMessages(err.fields)
      return msgs.length ? `${msgs.join('. ')}.` : err.message
    }
    default:
      return err.message
  }
}
