import type { Tab } from '../types'
import type { AppRole } from './claims'

// Mirrors the route matrix in the API-defense plan (section 3). This only
// decides what the UI offers; the backend enforces the same rules.
const ADMIN_TABS: readonly Tab[] = [
  'dashboard',
  'products',
  'orders',
  'users',
  'task-queues',
  'events',
  'kv-keys',
  'storage',
  'persistence',
  'config',
]

// VENDOR: read-only subset -- inventory/analytics (dashboard) and own products.
const VENDOR_TABS: readonly Tab[] = ['dashboard', 'products']

export function allowedTabs(role: AppRole | null): readonly Tab[] {
  if (role === 'ADMIN') return ADMIN_TABS
  if (role === 'VENDOR') return VENDOR_TABS
  return []
}

export const canUseCockpit = (role: AppRole | null) => role === 'ADMIN' || role === 'VENDOR'
export const canEditRoles = (role: AppRole | null) => role === 'ADMIN'
export const canWrite = (role: AppRole | null) => role === 'ADMIN'
