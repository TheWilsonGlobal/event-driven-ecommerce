import { useMemo, useState } from 'react'
import type { Product, CartItem } from '../types'

export function useCart(showToast: (msg: string) => void) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false)
  const [discountCode, setDiscountCode] = useState<string>('')
  const [appliedDiscount, setAppliedDiscount] = useState<number>(0)
  const [discountError, setDiscountError] = useState<string>('')

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

  const clearCart = () => {
    setCart([])
    setAppliedDiscount(0)
  }

  return {
    cart,
    setCart,
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
  }
}
