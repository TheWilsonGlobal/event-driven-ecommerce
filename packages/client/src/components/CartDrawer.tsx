'use client'

import React from 'react'
import type { CartItem } from '../app/types'

interface CartDrawerProps {
  isOpen: boolean
  cart: CartItem[]
  subtotal: number
  discountAmount: number
  estimatedTax: number
  shippingFee: number
  finalTotal: number
  appliedDiscount: number
  discountCode: string
  discountError: string
  onClose: () => void
  onUpdateQuantity: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onDiscountChange: (v: string) => void
  onApplyPromo: () => void
  onCheckout: () => void
}

export default function CartDrawer({
  isOpen,
  cart,
  subtotal,
  discountAmount,
  estimatedTax,
  shippingFee,
  finalTotal,
  appliedDiscount,
  discountCode,
  discountError,
  onClose,
  onUpdateQuantity,
  onRemove,
  onDiscountChange,
  onApplyPromo,
  onCheckout,
}: CartDrawerProps) {
  if (!isOpen) return null

  const totalCartCount = cart.reduce((acc, item) => acc + item.quantity, 0)

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col">
          {/* Cart Header */}
          <div className="p-6 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🛒</span>
              <h2 className="text-lg font-bold text-slate-900">Your Shopping Cart</h2>
              <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">
                {totalCartCount} items
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 font-bold"
            >
              ✕
            </button>
          </div>

          {/* Free shipping progress */}
          <div className="bg-indigo-50/70 px-6 py-3 border-b border-indigo-100 text-xs text-indigo-900">
            {subtotal >= 100 ? (
              <span className="font-bold text-emerald-700 flex items-center gap-1">
                🎉 You have unlocked <b>FREE Global Express Shipping!</b>
              </span>
            ) : (
              <span>
                Add <b>${(100 - subtotal).toFixed(2)}</b> more to qualify for <b>FREE Shipping</b>
              </span>
            )}
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {cart.length === 0 ? (
              <div className="text-center py-16">
                <span className="text-5xl block mb-3">🛍️</span>
                <h3 className="font-bold text-slate-800 text-base">Your cart is empty</h3>
                <p className="text-xs text-slate-500 mt-1 mb-6">
                  Explore our high-performance hardware catalog and add items.
                </p>
                <button
                  onClick={onClose}
                  className="bg-indigo-600 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow"
                >
                  Start Shopping
                </button>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.product.id}
                  className="flex gap-4 p-3 rounded-xl border border-slate-100 hover:border-slate-200 bg-slate-50/50"
                >
                  <img
                    src={item.product.images[0]?.url}
                    alt={item.product.title}
                    className="w-16 h-16 rounded-lg object-cover bg-white border border-slate-200"
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-xs text-slate-900 truncate">
                      {item.product.title}
                    </h4>
                    <span className="text-xs font-bold text-indigo-600 block mt-0.5">
                      ${item.product.price.toFixed(2)}
                    </span>
                    {/* Quantity controls */}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => onUpdateQuantity(item.product.id, -1)}
                        className="w-6 h-6 rounded bg-white border border-slate-300 text-slate-700 font-bold flex items-center justify-center hover:bg-slate-100"
                      >
                        -
                      </button>
                      <span className="text-xs font-bold text-slate-800 px-1">{item.quantity}</span>
                      <button
                        onClick={() => onUpdateQuantity(item.product.id, 1)}
                        className="w-6 h-6 rounded bg-white border border-slate-300 text-slate-700 font-bold flex items-center justify-center hover:bg-slate-100"
                      >
                        +
                      </button>
                      <button
                        onClick={() => onRemove(item.product.id)}
                        className="ml-auto text-xs text-rose-500 hover:text-rose-700 font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Cart Footer */}
          {cart.length > 0 && (
            <div className="p-6 border-t border-slate-200 bg-slate-50 space-y-4">
              {/* Promo code box */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Promo Code (SAVE20)"
                  value={discountCode}
                  onChange={(e) => onDiscountChange(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs uppercase font-mono outline-none focus:border-indigo-500"
                />
                <button
                  onClick={onApplyPromo}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-xl transition"
                >
                  Apply
                </button>
              </div>
              {discountError && (
                <p className="text-[11px] text-rose-600 font-semibold">{discountError}</p>
              )}
              {appliedDiscount > 0 && (
                <p className="text-[11px] text-emerald-600 font-bold">
                  ✓ Promo discount active: {(appliedDiscount * 100).toFixed(0)}% OFF
                </p>
              )}

              {/* Order Totals Breakdown */}
              <div className="space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-semibold text-slate-900">${subtotal.toFixed(2)}</span>
                </div>
                {appliedDiscount > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Discount</span>
                    <span>-${discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Estimated Sales Tax (8%)</span>
                  <span>${estimatedTax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span>
                    {shippingFee === 0 ? (
                      <b className="text-emerald-600">FREE</b>
                    ) : (
                      `$${shippingFee.toFixed(2)}`
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Total Amount</span>
                  <span className="text-indigo-600 text-base">${finalTotal.toFixed(2)}</span>
                </div>
              </div>

              <button
                onClick={onCheckout}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm py-3.5 rounded-xl shadow-lg shadow-indigo-100 transition transform active:scale-98 flex items-center justify-center gap-2"
              >
                <span>Proceed to Checkout</span>
                <span>&rarr;</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
