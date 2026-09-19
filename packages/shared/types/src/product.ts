/**
 * A category as ms-product's catalog defines it. `icon`/`description`/
 * `productCount` are required here because ms-product always populates them;
 * a consumer that only has a partial snapshot (e.g. the category reference
 * embedded in a `Product`) should use `CategoryRef`, not mark these optional
 * on the canonical type.
 */
export interface Category {
  id: string
  name: string
  slug: string
  icon: string
  description: string
  productCount: number
}

/** The category summary embedded on a `Product` — id/name/slug only. */
export type CategoryRef = Pick<Category, 'id' | 'name' | 'slug'>

export interface ProductImage {
  url: string
  alt: string
  isPrimary: boolean
}

export interface ProductAttribute {
  name: string
  value: string
}

export interface ProductRatings {
  average: number
  count: number
}

/**
 * The product shape shared by ms-product (source of truth), admin, and
 * client. `isAvailable` is required — ms-product's document always carries
 * it; a consumer reading an older/partial record should default it rather
 * than widen this type back to optional.
 */
export interface Product {
  id: string
  title: string
  slug: string
  sku: string
  description: string
  price: number
  compareAtPrice: number
  currency: string
  stock: number
  isAvailable: boolean
  category: CategoryRef
  tags: string[]
  images: ProductImage[]
  attributes: ProductAttribute[]
  ratings: ProductRatings
}
