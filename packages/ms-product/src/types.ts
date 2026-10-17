import type { Category, Product } from '@ecommerce/shared-types'

// The API-facing field lists (title/slug/price/… for Product, name/slug/icon/…
// for Category) live in @ecommerce/shared-types, shared with admin/client/
// ms-order. ProductDoc/CategoryDoc extend them with the NeDB storage fields
// (`_id`, optional `id`) that only this package's document layer needs.
export interface ProductDoc extends Omit<Product, 'id'> {
  id?: string
  _id?: string
  /**
   * The Supabase user id of the VENDOR who created the product. Absent on seeded
   * and admin-created products, which makes them ADMIN-only to edit. Never
   * returned by the API (the response schema omits it) and never writable from a
   * request body.
   */
  vendorId?: string
}

export interface CategoryDoc extends Omit<Category, 'id'> {
  id?: string
  _id?: string
}
