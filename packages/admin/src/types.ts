export type Tab =
  | 'dashboard'
  | 'products'
  | 'orders'
  | 'users'
  | 'task-queues'
  | 'redis-cache'
  | 'storage'
  | 'persistence'
  | 'config'

export interface ServiceItem {
  id: string
  name: string
  port: number
  url: string
  healthUrl: string
  type: string
  role: string
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE'
  statusCode: number
  latencyMs: number
  details?: Record<string, unknown>
  error?: string
  lastChecked: string
}

export interface UserRecord {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'ADMIN' | 'CUSTOMER' | 'VENDOR'
  isActive: boolean
  isEmailVerified: boolean
  addresses: {
    addressLine1: string
    city: string
    state: string
    postalCode: string
    country: string
    isDefaultShipping: boolean
  }[]
  createdAt?: string
}

export interface ProductRecord {
  id: string
  title: string
  slug: string
  sku: string
  description: string
  price: number
  compareAtPrice: number
  currency: string
  stock: number
  isAvailable?: boolean
  category: {
    id: string
    name: string
    slug: string
  }
  tags: string[]
  images: {
    url: string
    alt: string
    isPrimary: boolean
  }[]
  attributes: {
    name: string
    value: string
  }[]
  ratings: {
    average: number
    count: number
  }
}

export interface OrderRecord {
  id: string
  orderNumber: string
  customerId: string
  customerName: string
  customerEmail: string
  status: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
  subtotal: number
  taxAmount: number
  shippingAmount: number
  discountAmount: number
  totalAmount: number
  currency: string
  paymentMethod: 'STRIPE' | 'PAYPAL' | 'MOCK'
  paymentStatus: 'PAID' | 'PENDING' | 'FAILED' | 'REFUNDED'
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
    imageUrl?: string
  }[]
  createdAt: string
  updatedAt: string
  receiptUrl?: string
}

export interface RustfsHealth {
  healthy: boolean | null
  latencyMs: number
  endpoint: string
  bucket: string
  lastChecked: string
}
