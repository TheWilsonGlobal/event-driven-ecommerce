import { useState } from 'react'
import type { Product, CartItem } from '../types'
import { createOrder, OrderApiError, type ShippingInfo } from '../../lib/api'

interface UseCheckoutParams {
  cart: CartItem[]
  subtotal: number
  estimatedTax: number
  shippingFee: number
  discountAmount: number
  finalTotal: number
  clearCart: () => void
  showToast: (msg: string) => void
}

export function useCheckout({
  cart,
  subtotal,
  estimatedTax,
  shippingFee,
  discountAmount,
  finalTotal,
  clearCart,
  showToast,
}: UseCheckoutParams) {
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState<boolean>(false)
  const [checkoutStep, setCheckoutStep] = useState<'shipping' | 'payment' | 'confirmed'>('shipping')
  const [lastOrderId, setLastOrderId] = useState<string>('')
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
      clearCart()
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

  return {
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
  }
}
