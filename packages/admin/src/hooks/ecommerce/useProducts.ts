import { useState, useMemo, useEffect, useCallback } from 'react'
import type { ProductRecord } from '../../types'
import { PRODUCT_SERVICE_URL } from '../../data/serviceUrls'
import { FETCH_ALL_LIMIT, mapProduct } from './mappers'

export function useProducts(showToast: (msg: string) => void) {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [productsLoading, setProductsLoading] = useState<boolean>(true)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [objectCount, setObjectCount] = useState<number>(0)

  // Modal & selection state
  const [isProductModalOpen, setIsProductModalOpen] = useState<boolean>(false)
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null)

  // Filters
  const [productSearch, setProductSearch] = useState<string>('')
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('ALL')

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true)
    setProductsError(null)
    try {
      const res = await fetch(
        `${PRODUCT_SERVICE_URL}/api/v1/products?page=1&limit=${FETCH_ALL_LIMIT}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setProducts((data.products ?? []).map(mapProduct))
    } catch (err) {
      setProductsError(
        err instanceof Error
          ? err.message
          : 'Failed to load products — is ms-product (5464) running?'
      )
    } finally {
      setProductsLoading(false)
    }
  }, [])

  const fetchObjectCount = useCallback(async () => {
    try {
      const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/storage/objects`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setObjectCount(Array.isArray(data.objects) ? data.objects.length : 0)
    } catch {
      setObjectCount(0)
    }
  }, [])

  useEffect(() => {
    // Independent fetches: one backend being down must not block the other.
    void fetchProducts()
    void fetchObjectCount()
  }, [fetchProducts, fetchObjectCount])

  const handleSaveProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const title = formData.get('title') as string
    const sku = formData.get('sku') as string
    const price = parseFloat(formData.get('price') as string) || 99.99
    const compareAtPrice = parseFloat(formData.get('compareAtPrice') as string) || price * 1.2
    const stock = parseInt(formData.get('stock') as string, 10) || 50
    const description = formData.get('description') as string
    const categoryName = formData.get('category') as string
    const imageUrl =
      (formData.get('imageUrl') as string) ||
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80'

    const category = {
      id: categoryName.toLowerCase().replace(/\s+/g, '-'),
      name: categoryName,
      slug: categoryName.toLowerCase().replace(/\s+/g, '-'),
    }

    setIsProductModalOpen(false)
    setEditingProduct(null)

    try {
      if (editingProduct) {
        const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/products/${editingProduct.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            sku,
            price,
            compareAtPrice,
            stock,
            description,
            category,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error ?? `HTTP ${res.status}`)
        }
        showToast(`Product "${title}" updated!`)
      } else {
        const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            sku,
            price,
            compareAtPrice,
            currency: 'USD',
            stock,
            isAvailable: true,
            description,
            category,
            tags: ['featured', 'catalog'],
            images: [{ url: imageUrl, alt: title, isPrimary: true }],
            attributes: [{ name: 'Warranty', value: '2 Years' }],
            ratings: { average: 5.0, count: 1 },
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error ?? `HTTP ${res.status}`)
        }
        showToast(`Product "${title}" added!`)
      }
      await fetchProducts()
    } catch (err) {
      showToast(`Failed to save product: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return
    try {
      const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/products/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      showToast('Product deleted')
      await fetchProducts()
    } catch (err) {
      showToast(`Failed to delete product: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matches =
        p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.description.toLowerCase().includes(productSearch.toLowerCase())
      const catMatch = productCategoryFilter === 'ALL' || p.category.name === productCategoryFilter
      return matches && catMatch
    })
  }, [products, productSearch, productCategoryFilter])

  return {
    products,
    productsLoading,
    productsError,
    fetchProducts,
    objectCount,
    fetchObjectCount,
    isProductModalOpen,
    setIsProductModalOpen,
    editingProduct,
    setEditingProduct,
    productSearch,
    setProductSearch,
    productCategoryFilter,
    setProductCategoryFilter,
    filteredProducts,
    handleSaveProduct,
    handleDeleteProduct,
  }
}
