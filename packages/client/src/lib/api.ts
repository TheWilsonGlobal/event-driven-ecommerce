// Thin API client for talking to backend microservices from the storefront.
// All calls go through the API gateway, not a direct service port, so the
// storefront keeps working if a service moves behind the gateway later.
// Every call goes through apiFetch (bearer token, one 401 retry, typed errors).

import type { CartItem, Category, Product } from '../app/types'
import { ApiError, friendlyMessage, type ApiFieldError } from './apiError'
import { emitAuthRequired } from './authEvents'
import { getBrowserSupabase } from './supabase/browser'

export { ApiError, friendlyMessage, fieldMessages } from './apiError'
export type { ApiFieldError } from './apiError'

function gatewayUrl(): string {
  return process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:5460'
}

/** Refresh a little before the access token actually expires. */
const EXPIRY_SKEW_MS = 30_000

export type AuthMode = 'none' | 'optional' | 'required'

export interface ApiFetchOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  /**
   * none: never attach a token (public catalog reads).
   * optional: attach the bearer token when a session exists.
   * required: refuse (and ask the UI to prompt for sign-in) without a session.
   */
  auth?: AuthMode
  /** Used in the "could not reach ..." message. */
  serviceName?: string
}

async function getAccessToken(forceRefresh: boolean): Promise<string | null> {
  const supabase = getBrowserSupabase()
  if (!supabase) return null
  try {
    if (forceRefresh) {
      const { data, error } = await supabase.auth.refreshSession()
      return error ? null : (data.session?.access_token ?? null)
    }
    const { data } = await supabase.auth.getSession()
    const session = data.session
    if (!session) return null
    if (session.expires_at && session.expires_at * 1000 - Date.now() < EXPIRY_SKEW_MS) {
      const refreshed = await supabase.auth.refreshSession()
      return refreshed.error ? null : (refreshed.data.session?.access_token ?? null)
    }
    return session.access_token
  } catch {
    // Never log the error object: it could carry session material.
    return null
  }
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'FORBIDDEN',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await response.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    // non-JSON body: fall back to the generic message
  }
  const status = response.status
  const headerRetry = Number(response.headers.get('retry-after'))
  const bodyRetry = typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : NaN
  const retryAfterSeconds =
    Number.isFinite(headerRetry) && headerRetry > 0
      ? Math.ceil(headerRetry)
      : Number.isFinite(bodyRetry) && bodyRetry > 0
        ? Math.ceil(bodyRetry)
        : undefined
  const message =
    typeof body.message === 'string'
      ? body.message
      : typeof body.error === 'string'
        ? body.error
        : `The server returned an error (status ${status}).`
  const fields = Array.isArray(body.fields)
    ? (body.fields as ApiFieldError[]).filter(
        (f) => f && typeof f.path === 'string' && typeof f.rule === 'string'
      )
    : []
  return new ApiError({
    status,
    code: typeof body.code === 'string' ? body.code : (DEFAULT_CODES[status] ?? 'HTTP_ERROR'),
    message,
    requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
    fields,
    retryAfterSeconds,
  })
}

/**
 * The single entry point for every gateway call.
 *  - attaches `Authorization: Bearer <access_token>` (refreshing an expired token first)
 *  - retries a 401 exactly once after `refreshSession`
 *  - maps the standard error body to a typed ApiError (429 carries the wait time)
 * The token is only ever placed in the request header, never logged or stored by us.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    headers = {},
    auth = 'optional',
    serviceName = 'the server',
  } = options

  const send = async (token: string | null): Promise<Response> => {
    const h: Record<string, string> = { ...headers }
    if (body !== undefined) h['Content-Type'] = 'application/json'
    if (token) h['Authorization'] = `Bearer ${token}`
    try {
      return await fetch(`${gatewayUrl()}${path}`, {
        method,
        headers: h,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: `Could not reach ${serviceName}. Please check your connection and try again.`,
      })
    }
  }

  let token: string | null = null
  if (auth !== 'none') {
    token = await getAccessToken(false)
    if (!token && auth === 'required') {
      emitAuthRequired('Sign in to continue.')
      throw new ApiError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Please sign in to continue.',
      })
    }
  }

  let response = await send(token)

  if (response.status === 401 && auth !== 'none') {
    // One silent refresh + retry, then give up and ask the user to sign in.
    const fresh = await getAccessToken(true)
    if (fresh) response = await send(fresh)
    if (response.status === 401) {
      emitAuthRequired('Your session has expired. Please sign in again.')
    }
  }

  if (!response.ok) throw await toApiError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** Money must have at most 2 decimals on the wire. */
export const roundMoney = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export interface ShippingInfo {
  fullName: string
  email: string
  addressLine1: string
  city: string
  state: string
  postalCode: string
}

export interface CreateOrderTotals {
  subtotal: number
  taxAmount: number
  shippingAmount: number
  discountAmount: number
  totalAmount: number
  currency: string
}

export interface CreatedOrder {
  id: string
  orderNumber: string
  customerId: string
  customerName: string
  customerEmail: string
  status: string
  subtotal: number
  taxAmount: number
  shippingAmount: number
  discountAmount: number
  totalAmount: number
  currency: string
  paymentMethod: string
  paymentStatus: string
  transactionId: string
  shippingAddress: {
    addressLine1: string
    city: string
    state: string
    postalCode: string
    country: string
  }
  items: {
    productId: string
    sku: string
    title: string
    unitPrice: number
    quantity: number
    totalPrice: number
  }[]
  createdAt: string
  updatedAt: string
}

/** Build the strict POST /orders body. userId comes from the token, never the body. */
export function buildOrderBody(
  cart: CartItem[],
  shippingInfo: ShippingInfo,
  totals: CreateOrderTotals
) {
  return {
    customerName: shippingInfo.fullName,
    customerEmail: shippingInfo.email,
    items: cart.map((item) => ({
      productId: item.product.id,
      sku: item.product.sku,
      title: item.product.title,
      unitPrice: roundMoney(item.product.price),
      quantity: Math.min(1000, Math.max(1, Math.trunc(item.quantity))),
    })),
    shippingAddress: {
      addressLine1: shippingInfo.addressLine1,
      city: shippingInfo.city,
      state: shippingInfo.state,
      postalCode: shippingInfo.postalCode,
      country: 'US',
    },
    paymentMethod: 'STRIPE',
    subtotal: roundMoney(totals.subtotal),
    taxAmount: roundMoney(totals.taxAmount),
    shippingAmount: roundMoney(totals.shippingAmount),
    discountAmount: roundMoney(totals.discountAmount),
    totalAmount: roundMoney(totals.totalAmount),
    currency: totals.currency,
  }
}

export function createOrder(
  cart: CartItem[],
  shippingInfo: ShippingInfo,
  totals: CreateOrderTotals
): Promise<CreatedOrder> {
  return apiFetch<CreatedOrder>('/api/v1/orders', {
    method: 'POST',
    body: buildOrderBody(cart, shippingInfo, totals),
    auth: 'required',
    serviceName: 'Order Service',
  })
}

export interface UserProfile {
  id: string
  email: string
  role: string
  [key: string]: unknown
}

/** The caller's profile (auto-provisioned by the backend on first call). */
export function getMe(): Promise<UserProfile> {
  return apiFetch<UserProfile>('/api/v1/users/me', {
    auth: 'required',
    serviceName: 'User Service',
  })
}

export class ProductApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductApiError'
  }
}

async function publicGet<T>(path: string, service: string): Promise<T> {
  try {
    return await apiFetch<T>(path, { auth: 'none', serviceName: service })
  } catch (err) {
    if (err instanceof ApiError) {
      throw new ProductApiError(
        err.status === 0
          ? `Could not reach ${service}. Please check your connection.`
          : friendlyMessage(err)
      )
    }
    throw err
  }
}

export async function getProducts(): Promise<Product[]> {
  const body = await publicGet<{ products: Product[] }>(
    '/api/v1/products?limit=100',
    'Product Service'
  )
  return body.products
}

export async function getCategories(): Promise<Category[]> {
  const body = await publicGet<{ categories: Category[] }>('/api/v1/categories', 'Product Service')
  return body.categories
}

export interface ServiceLocation {
  name: string
  url: string
}

export class TopologyApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TopologyApiError'
  }
}

/**
 * The gateway's static service registry (see registerTopologyRoute in the
 * gateway repo) -- every service's configured origin, not just the three
 * this storefront proxies through. Built for StorefrontFooter's port badges,
 * which used to be hand-typed literals: RustFS's badge went stale the moment
 * its host port moved from 9000 to 6380 on 2026-09-22, because nothing here
 * would have noticed. Throws rather than returning a partial/empty list on
 * failure, same as every other call in this file -- the caller decides what
 * "the gateway is unreachable" should look like, not this function.
 */
export async function getTopology(): Promise<ServiceLocation[]> {
  try {
    const body = await apiFetch<{ services: ServiceLocation[] }>('/api/v1/topology', {
      auth: 'none',
      serviceName: 'the API gateway',
    })
    return body.services
  } catch (err) {
    if (err instanceof ApiError) {
      throw new TopologyApiError(
        err.status === 0
          ? 'Could not reach the API gateway. Please check your connection.'
          : `API gateway returned an error (status ${err.status}).`
      )
    }
    throw err
  }
}
