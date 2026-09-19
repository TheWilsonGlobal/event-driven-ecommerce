export interface Category {
  id: string
  name: string
  slug: string
  icon?: string
  description?: string
  productCount?: number
}

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

export interface CartItem {
  product: Product
  quantity: number
}
