import { useEffect, useMemo, useState } from 'react'
import type { Product, Category } from '../types'
import { getProducts, getCategories, ProductApiError } from '../../lib/api'

// Synthetic pseudo-category for the "show everything" tab — not a real
// category from ms-product, so description/productCount are placeholders.
const ALL_CATEGORY: Category = {
  id: 'all',
  name: 'All Products',
  icon: '✨',
  slug: 'all',
  description: 'Every product in the catalog',
  productCount: 0,
}

export function useCatalog() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [catalogLoading, setCatalogLoading] = useState<boolean>(true)
  const [catalogError, setCatalogError] = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc' | 'rating'>(
    'featured'
  )

  // Load the real catalog from ms-product (via the gateway) on mount.
  useEffect(() => {
    let cancelled = false
    async function loadCatalog() {
      setCatalogLoading(true)
      setCatalogError('')
      try {
        const [fetchedProducts, fetchedCategories] = await Promise.all([
          getProducts(),
          getCategories(),
        ])
        if (cancelled) return
        setProducts(fetchedProducts)
        setCategories(fetchedCategories)
      } catch (err) {
        if (cancelled) return
        setCatalogError(
          err instanceof ProductApiError
            ? err.message
            : 'Something went wrong loading the catalog. Please try again.'
        )
      } finally {
        if (!cancelled) setCatalogLoading(false)
      }
    }
    void loadCatalog()
    return () => {
      cancelled = true
    }
  }, [])

  const categoryTabs = useMemo(() => [ALL_CATEGORY, ...categories], [categories])

  // Filtered & Sorted products
  const filteredProducts = useMemo(() => {
    let list = products.filter((p) => {
      const matchesCategory = selectedCategory === 'all' || p.category.id === selectedCategory
      const matchesSearch =
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
      return matchesCategory && matchesSearch
    })

    if (sortBy === 'price-asc') {
      list = [...list].sort((a, b) => a.price - b.price)
    } else if (sortBy === 'price-desc') {
      list = [...list].sort((a, b) => b.price - a.price)
    } else if (sortBy === 'rating') {
      list = [...list].sort((a, b) => b.ratings.average - a.ratings.average)
    }

    return list
  }, [products, selectedCategory, searchQuery, sortBy])

  return {
    products,
    categories,
    catalogLoading,
    catalogError,
    categoryTabs,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    filteredProducts,
  }
}
