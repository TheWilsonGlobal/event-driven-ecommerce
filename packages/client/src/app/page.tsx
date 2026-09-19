'use client'

import React, { useState, useMemo, useEffect } from 'react'
import type { Product, Category, CartItem } from './types'
import StorefrontHeader from '../components/StorefrontHeader'
import HeroSection from '../components/HeroSection'
import ProductGrid from '../components/ProductGrid'
import CartDrawer from '../components/CartDrawer'
import QuickViewModal from '../components/QuickViewModal'
import CheckoutModal from '../components/CheckoutModal'
import StorefrontFooter from '../components/StorefrontFooter'
import {
  createOrder,
  getProducts,
  getCategories,
  OrderApiError,
  ProductApiError,
  type ShippingInfo,
} from '../lib/api'

const ALL_CATEGORY: Category = { id: 'all', name: 'All Products', icon: '✨', slug: 'all' }

export default function ClientStorefront() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [catalogLoading, setCatalogLoading] = useState<boolean>(true)
  const [catalogError, setCatalogError] = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc' | 'rating'>(
    'featured'
  )

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([])
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false)
  const [discountCode, setDiscountCode] = useState<string>('')
  const [appliedDiscount, setAppliedDiscount] = useState<number>(0)
  const [discountError, setDiscountError] = useState<string>('')

  // Modals
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState<boolean>(false)
  const [checkoutStep, setCheckoutStep] = useState<'shipping' | 'payment' | 'confirmed'>('shipping')
  const [lastOrderId, setLastOrderId] = useState<string>('')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [shippingInfo, setShippingInfo] = useState<ShippingInfo>({
    fullName: 'Alex Morgan',
    email: 'customer@ecommerce.com',
    addressLine1: '742 Evergreen Terrace',
    city: 'Springfield',
    state: 'OR',
    postalCode: '97477',
  })
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false)
  const [checkoutError, setCheckoutError] = useState<string>('')

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

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage(null)
    }, 3000)
  }

  const addToCart = (product: Product, quantity = 1) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id)
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + quantity } : item
        )
      }
      return [...prev, { product, quantity }]
    })
    showToast(`Added "${product.title}" to cart!`)
  }

  const updateQuantity = (productId: string, delta: number) => {
    setCart(
      (prev) =>
        prev
          .map((item) => {
            if (item.product.id === productId) {
              const newQty = item.quantity + delta
              return newQty > 0 ? { ...item, quantity: newQty } : null
            }
            return item
          })
          .filter(Boolean) as CartItem[]
    )
  }

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId))
  }

  const totalCartCount = useMemo(() => cart.reduce((acc, item) => acc + item.quantity, 0), [cart])

  const subtotal = useMemo(
    () => cart.reduce((acc, item) => acc + item.product.price * item.quantity, 0),
    [cart]
  )

  const discountAmount = subtotal * appliedDiscount
  const estimatedTax = (subtotal - discountAmount) * 0.08
  const shippingFee = subtotal > 100 || subtotal === 0 ? 0 : 15.0
  const finalTotal = Math.max(0, subtotal - discountAmount + estimatedTax + shippingFee)

  const applyPromoCode = () => {
    if (discountCode.trim().toUpperCase() === 'SAVE20') {
      setAppliedDiscount(0.2)
      setDiscountError('')
      showToast('Promo code applied: 20% OFF!')
    } else if (discountCode.trim().toUpperCase() === 'FREESHIP') {
      setAppliedDiscount(0.05)
      setDiscountError('')
      showToast('Promo code applied: 5% Extra discount!')
    } else {
      setDiscountError('Invalid promo code. Try "SAVE20"')
    }
  }

  const handleShippingInfoChange = (field: keyof ShippingInfo, value: string) => {
    setShippingInfo((prev) => ({ ...prev, [field]: value }))
  }

  const handleCompleteOrder = async () => {
    setCheckoutError('')
    setIsSubmittingOrder(true)
    try {
      const order = await createOrder(cart, shippingInfo, {
        subtotal,
        taxAmount: estimatedTax,
        shippingAmount: shippingFee,
        discountAmount,
        totalAmount: finalTotal,
        currency: 'USD',
      })
      setLastOrderId(order.orderNumber)
      setCheckoutStep('confirmed')
      setCart([])
      setAppliedDiscount(0)
    } catch (err) {
      const message =
        err instanceof OrderApiError
          ? err.message
          : 'Something went wrong placing your order. Please try again.'
      setCheckoutError(message)
      showToast(message)
    } finally {
      setIsSubmittingOrder(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-bounce">
          <span className="text-emerald-400 text-lg">✓</span>
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      <StorefrontHeader
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        totalCartCount={totalCartCount}
        onOpenCart={() => setIsCartOpen(true)}
      />

      <HeroSection
        productCount={products.length}
        featuredProduct={products[0] ?? null}
        onScrollToCatalog={() => {
          const el = document.getElementById('catalog')
          el?.scrollIntoView({ behavior: 'smooth' })
        }}
        onQuickAddFlagship={() => {
          const featured = products[0]
          if (featured) addToCart(featured, 1)
        }}
      />

      {catalogError && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
          <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3">
            {catalogError} — is the gateway (5460) and Product Service (5464) running?
          </div>
        </div>
      )}

      {catalogLoading ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 text-center text-sm text-slate-500">
          Loading catalog…
        </div>
      ) : (
        <ProductGrid
          categories={categoryTabs}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          sortBy={sortBy}
          onSortChange={setSortBy}
          filteredProducts={filteredProducts}
          onQuickView={setQuickViewProduct}
          onAddToCart={(p) => addToCart(p, 1)}
        />
      )}

      <CartDrawer
        isOpen={isCartOpen}
        cart={cart}
        subtotal={subtotal}
        discountAmount={discountAmount}
        estimatedTax={estimatedTax}
        shippingFee={shippingFee}
        finalTotal={finalTotal}
        appliedDiscount={appliedDiscount}
        discountCode={discountCode}
        discountError={discountError}
        onClose={() => setIsCartOpen(false)}
        onUpdateQuantity={updateQuantity}
        onRemove={removeFromCart}
        onDiscountChange={setDiscountCode}
        onApplyPromo={applyPromoCode}
        onCheckout={() => {
          setIsCartOpen(false)
          setIsCheckoutOpen(true)
          setCheckoutStep('shipping')
          setCheckoutError('')
        }}
      />

      <QuickViewModal
        product={quickViewProduct}
        onClose={() => setQuickViewProduct(null)}
        onAddToCart={(p) => addToCart(p, 1)}
      />

      <CheckoutModal
        isOpen={isCheckoutOpen}
        checkoutStep={checkoutStep}
        finalTotal={finalTotal}
        lastOrderId={lastOrderId}
        shippingInfo={shippingInfo}
        onShippingInfoChange={handleShippingInfoChange}
        isSubmitting={isSubmittingOrder}
        submitError={checkoutError}
        onClose={() => setIsCheckoutOpen(false)}
        onContinueToPayment={() => setCheckoutStep('payment')}
        onBack={() => setCheckoutStep('shipping')}
        onCompleteOrder={handleCompleteOrder}
      />

      <StorefrontFooter />
    </div>
  )
}
