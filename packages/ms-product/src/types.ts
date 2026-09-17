export interface ProductDoc {
  id?: string
  _id?: string
  title: string
  slug: string
  sku: string
  description: string
  price: number
  compareAtPrice: number
  currency: string
  stock: number
  isAvailable: boolean
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

export interface CategoryDoc {
  id?: string
  _id?: string
  name: string
  slug: string
  icon: string
  description: string
  productCount: number
}
