// Thin API client for talking to backend microservices from the storefront.

import type { CartItem } from '../app/types'

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

const ORDER_SERVICE_URL = 'http://localhost:5465'

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
    response = await fetch(`${ORDER_SERVICE_URL}/api/v1/orders`, {
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
