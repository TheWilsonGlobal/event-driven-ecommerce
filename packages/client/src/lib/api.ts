// Thin API client for talking to backend microservices from the storefront.
// All calls go through the API gateway, not a direct service port, so the
// storefront keeps working if a service moves behind the gateway later.

import type { CartItem, Category, Product } from '../app/types'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:5460'

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

export class OrderApiError extends Error {
  status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OrderApiError'
    this.status = status
  }
}

export async function createOrder(
  cart: CartItem[],
  shippingInfo: ShippingInfo,
  totals: CreateOrderTotals
): Promise<CreatedOrder> {
  const body = {
    customerName: shippingInfo.fullName,
    customerEmail: shippingInfo.email,
    items: cart.map((item) => ({
      productId: item.product.id,
      sku: item.product.sku,
      title: item.product.title,
      unitPrice: item.product.price,
      quantity: item.quantity,
    })),
    shippingAddress: {
      addressLine1: shippingInfo.addressLine1,
      city: shippingInfo.city,
      state: shippingInfo.state,
      postalCode: shippingInfo.postalCode,
      country: 'United States',
    },
    paymentMethod: 'STRIPE',
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    shippingAmount: totals.shippingAmount,
    discountAmount: totals.discountAmount,
    totalAmount: totals.totalAmount,
    currency: totals.currency,
  }

  let response: Response
  try {
    response = await fetch(`${GATEWAY_URL}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new OrderApiError(
      'Could not reach Order Service. Please check your connection and try again.'
    )
  }

  if (!response.ok) {
    let errorMessage = `Order Service returned an error (status ${response.status}).`
    try {
      const errorBody = await response.json()
      if (errorBody && typeof errorBody.error === 'string') {
        errorMessage = errorBody.error
      }
    } catch {
      // response body wasn't JSON — fall back to the generic message
    }
    throw new OrderApiError(errorMessage, response.status)
  }

  return (await response.json()) as CreatedOrder
}

export class ProductApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductApiError'
  }
}

export async function getProducts(): Promise<Product[]> {
  let response: Response
  try {
    response = await fetch(`${GATEWAY_URL}/api/v1/products?limit=100`)
  } catch {
    throw new ProductApiError('Could not reach Product Service. Please check your connection.')
  }
  if (!response.ok) {
    throw new ProductApiError(`Product Service returned an error (status ${response.status}).`)
  }
  const body = (await response.json()) as { products: Product[] }
  return body.products
}

export async function getCategories(): Promise<Category[]> {
  let response: Response
  try {
    response = await fetch(`${GATEWAY_URL}/api/v1/categories`)
  } catch {
    throw new ProductApiError('Could not reach Product Service. Please check your connection.')
  }
  if (!response.ok) {
    throw new ProductApiError(`Product Service returned an error (status ${response.status}).`)
  }
  const body = (await response.json()) as { categories: Category[] }
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
  let response: Response
  try {
    response = await fetch(`${GATEWAY_URL}/api/v1/topology`)
  } catch {
    throw new TopologyApiError('Could not reach the API gateway. Please check your connection.')
  }
  if (!response.ok) {
    throw new TopologyApiError(`API gateway returned an error (status ${response.status}).`)
  }
  const body = (await response.json()) as { services: ServiceLocation[] }
  return body.services
}
