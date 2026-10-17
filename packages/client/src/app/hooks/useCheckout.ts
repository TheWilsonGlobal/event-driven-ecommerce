import { useState } from 'react'
import type { Product, CartItem } from '../types'
import { createOrder, ApiError, friendlyMessage, type ShippingInfo } from '../../lib/api'
import { useAuth } from '../../components/AuthProvider'

interface UseCheckoutParams {
  cart: CartItem[]
  subtotal: number
  estimatedTax: number
  shippingFee: number
  discountAmount: number
  finalTotal: number
  clearCart: () => void
  showToast: (msg: string) => void
  /** Called on PRICE_MISMATCH so the caller can refresh catalog prices in the cart. */
  onPriceMismatch?: () => Promise<void> | void
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
  onPriceMismatch,
}: UseCheckoutParams) {
  const { user, openAuthModal } = useAuth()
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
      if (err instanceof ApiError && err.isAuthError) {
        // Keep the cart and the entered details; resume once signed in again.
        const msg = 'Please sign in to place your order.'
        setCheckoutError(msg)
        openAuthModal({ reason: msg, onSignedIn: () => void handleCompleteOrder() })
        return
      }
      let message = 'Something went wrong placing your order. Please try again.'
      if (err instanceof ApiError) {
        message = friendlyMessage(err)
        if (err.code === 'PRICE_MISMATCH') {
          try {
            await onPriceMismatch?.()
          } catch {
            // the message above already tells the user to review the cart
          }
        }
      }
      setCheckoutError(message)
      showToast(message)
    } finally {
      setIsSubmittingOrder(false)
    }
  }

  /** Open checkout; signed-out users get the sign-in modal first and resume afterwards. */
  const beginCheckout = () => {
    const open = () => {
      setIsCheckoutOpen(true)
      setCheckoutStep('shipping')
      setCheckoutError('')
    }
    if (!user) {
      openAuthModal({ reason: 'Sign in to check out. Your cart is saved.', onSignedIn: open })
      return
    }
    open()
  }

  return {
    beginCheckout,
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
