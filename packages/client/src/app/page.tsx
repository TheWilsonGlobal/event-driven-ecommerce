'use client'

import React from 'react'
import StorefrontHeader from '../components/StorefrontHeader'
import HeroSection from '../components/HeroSection'
import ProductGrid from '../components/ProductGrid'
import CartDrawer from '../components/CartDrawer'
import QuickViewModal from '../components/QuickViewModal'
import CheckoutModal from '../components/CheckoutModal'
import StorefrontFooter from '../components/StorefrontFooter'
import { useCatalog } from './hooks/useCatalog'
import { useToast } from './hooks/useToast'
import { useCart } from './hooks/useCart'
import { useCheckout } from './hooks/useCheckout'

export default function ClientStorefront() {
  const {
    products,
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
  } = useCatalog()

  const { toastMessage, showToast } = useToast()

  const {
    cart,
    isCartOpen,
    setIsCartOpen,
    discountCode,
    setDiscountCode,
    appliedDiscount,
    discountError,
    addToCart,
    updateQuantity,
    removeFromCart,
    totalCartCount,
    subtotal,
    discountAmount,
    estimatedTax,
    shippingFee,
    finalTotal,
    applyPromoCode,
    clearCart,
  } = useCart(showToast)

  const {
    quickViewProduct,
    setQuickViewProduct,
    isCheckoutOpen,
    setIsCheckoutOpen,
    checkoutStep,
    setCheckoutStep,
    lastOrderId,
    shippingInfo,
    handleShippingInfoChange,
    isSubmittingOrder,
    checkoutError,
    setCheckoutError,
    handleCompleteOrder,
  } = useCheckout({
    cart,
    subtotal,
    estimatedTax,
    shippingFee,
    discountAmount,
    finalTotal,
    clearCart,
    showToast,
  })

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
