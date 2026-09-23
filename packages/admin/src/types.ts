import type { Order, Product, User } from '@ecommerce/shared-types'

export type Tab =
  | 'dashboard'
  | 'products'
  | 'orders'
  | 'users'
  | 'task-queues'
  | 'events'
  | 'kv-keys'
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
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN'
  statusCode: number
  latencyMs: number
  details?: Record<string, unknown>
  error?: string
  lastChecked: string
}

// Re-exported under admin's existing local names so the 24 files importing
// them don't need to change. The definitions themselves now live in
// @ecommerce/shared-types, shared with ms-user/ms-product/ms-order/client
// instead of being hand-copied per package — see that package for the
// canonical field lists and the sub-shapes (Address, CategoryRef, OrderItem, …).
export type UserRecord = User
export type ProductRecord = Product
export type OrderRecord = Order

export interface RustfsHealth {
  healthy: boolean | null
  latencyMs: number
  endpoint: string
  bucket: string
  lastChecked: string
}
