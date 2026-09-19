import type { UserRecord, ProductRecord, OrderRecord } from '../../types'

// This admin dashboard doesn't have real pagination UI wired to these list
// endpoints yet — request a single large page and let the existing
// client-side filteredX/useMemo + per-tab Pagination components keep working
// against the full set, same as they did against the old static arrays.
export const FETCH_ALL_LIMIT = 100

// ─── API → UserRecord/ProductRecord/OrderRecord mapping ───────────────────
// The backend shapes were designed to match these types closely; these
// mapping functions exist mainly to coerce optional/missing fields to safe
// defaults rather than to reshape data, so a partial/unexpected response
// never crashes the table render.

export function mapUser(raw: any): UserRecord {
  return {
    id: raw.id,
    email: raw.email,
    firstName: raw.firstName,
    lastName: raw.lastName,
    role: raw.role,
    isActive: Boolean(raw.isActive),
    isEmailVerified: Boolean(raw.isEmailVerified),
    addresses: Array.isArray(raw.addresses) ? raw.addresses : [],
    createdAt: raw.createdAt,
  }
}

export function mapProduct(raw: any): ProductRecord {
  return {
    id: raw.id,
    title: raw.title,
    slug: raw.slug,
    sku: raw.sku,
    description: raw.description ?? '',
    price: Number(raw.price) || 0,
    compareAtPrice: Number(raw.compareAtPrice ?? raw.price) || 0,
    currency: raw.currency ?? 'USD',
    stock: Number(raw.stock) || 0,
    isAvailable: raw.isAvailable ?? true,
    category: raw.category ?? { id: '', name: '', slug: '' },
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    images: Array.isArray(raw.images) ? raw.images : [],
    attributes: Array.isArray(raw.attributes) ? raw.attributes : [],
    ratings: raw.ratings ?? { average: 0, count: 0 },
  }
}

export function mapOrder(raw: any): OrderRecord {
  return {
    id: raw.id,
    orderNumber: raw.orderNumber,
    customerId: raw.customerId,
    customerName: raw.customerName,
    customerEmail: raw.customerEmail,
    status: raw.status,
    subtotal: Number(raw.subtotal) || 0,
    taxAmount: Number(raw.taxAmount) || 0,
    shippingAmount: Number(raw.shippingAmount) || 0,
    discountAmount: Number(raw.discountAmount) || 0,
    totalAmount: Number(raw.totalAmount) || 0,
    currency: raw.currency ?? 'USD',
    paymentMethod: raw.paymentMethod,
    paymentStatus: raw.paymentStatus,
    transactionId: raw.transactionId ?? '',
    shippingAddress: raw.shippingAddress,
    items: Array.isArray(raw.items) ? raw.items : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    receiptUrl: raw.receiptUrl,
  }
}
