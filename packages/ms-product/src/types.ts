import type { Category, Product } from '@ecommerce/shared-types'

// The API-facing field lists (title/slug/price/… for Product, name/slug/icon/…
// for Category) live in @ecommerce/shared-types, shared with admin/client/
// ms-order. ProductDoc/CategoryDoc extend them with the NeDB storage fields
// (`_id`, optional `id`) that only this package's document layer needs.
export interface ProductDoc extends Omit<Product, 'id'> {
  id?: string
  _id?: string
}

export interface CategoryDoc extends Omit<Category, 'id'> {
  id?: string
  _id?: string
}
