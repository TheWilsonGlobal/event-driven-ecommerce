import type { Product } from '@ecommerce/shared-types'

// Re-exported from @ecommerce/shared-types so this module stays the import
// path the rest of client uses (`../types` / `../../app/types`), without
// hand-copying the definitions — see that package for Category/Product's
// canonical field lists, shared with admin/ms-product/ms-order.
export type { Category, Product } from '@ecommerce/shared-types'

export interface CartItem {
  product: Product
  quantity: number
}
