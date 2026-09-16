'use client';

import React from 'react';

interface CheckoutModalProps {
  isOpen: boolean;
  checkoutStep: 'shipping' | 'payment' | 'confirmed';
  finalTotal: number;
  lastOrderId: string;
  onClose: () => void;
  onContinueToPayment: () => void;
  onBack: () => void;
  onCompleteOrder: () => void;
}

export default function CheckoutModal({
  isOpen,
  checkoutStep,
  finalTotal,
  lastOrderId,
  onClose,
  onContinueToPayment,
  onBack,
  onCompleteOrder,
}: CheckoutModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div className="bg-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-200 relative p-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center"
        >
          ✕
        </button>

        {/* Stepper Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
          <h2 className="text-xl font-black text-slate-900">
            {checkoutStep === 'shipping' && '1. Shipping & Delivery'}
            {checkoutStep === 'payment' && '2. Payment & Confirmation'}
            {checkoutStep === 'confirmed' && 'Order Confirmed! 🎉'}
          </h2>
          {checkoutStep !== 'confirmed' && (
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
              Total: ${finalTotal.toFixed(2)}
            </span>
          )}
        </div>

        {/* Step 1: Shipping Form */}
        {checkoutStep === 'shipping' && (
          <div className="space-y-4 text-xs">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Full Name</label>
              <input
                type="text"
                defaultValue="Alex Morgan"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">Email Address (Order Confirmation)</label>
              <input
                type="email"
                defaultValue="customer@ecommerce.com"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">Shipping Address</label>
              <input
                type="text"
                defaultValue="742 Evergreen Terrace"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">City</label>
                <input
                  type="text"
                  defaultValue="Springfield"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">State / Prov</label>
                <input
                  type="text"
                  defaultValue="OR"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Postal Code</label>
                <input
                  type="text"
                  defaultValue="97477"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <button
              onClick={onContinueToPayment}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm py-3.5 rounded-xl shadow-lg shadow-indigo-100 transition mt-4"
            >
              Continue to Payment &rarr;
            </button>
          </div>
        )}

        {/* Step 2: Payment Form */}
        {checkoutStep === 'payment' && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl border-2 border-indigo-500 bg-indigo-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-900 text-sm">💳 Credit / Debit Card (Stripe Gateway)</span>
                <span className="text-[10px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded font-bold">Encrypted</span>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Card Number</label>
                <input
                  type="text"
                  defaultValue="4242 •••• •••• 4242"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 font-mono outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Exp Date</label>
                  <input
                    type="text"
                    defaultValue="12/28"
                    className="w-full bg-white border border-slate-300 rounded-lg p-2 font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">CVC</label>
                  <input
                    type="text"
                    defaultValue="888"
                    className="w-full bg-white border border-slate-300 rounded-lg p-2 font-mono outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100">
              <span>🅿️</span>
              <span className="font-bold text-slate-800">PayPal Express / Smart Buttons</span>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={onBack}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-5 py-3 rounded-xl"
              >
                &larr; Back
              </button>
              <button
                onClick={onCompleteOrder}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm py-3.5 rounded-xl shadow-lg shadow-emerald-100 transition"
              >
                Authorize &amp; Pay ${finalTotal.toFixed(2)}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Confirmation */}
        {checkoutStep === 'confirmed' && (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto shadow-inner">
              ✓
            </div>
            <h3 className="text-xl font-black text-slate-900">Thank you for your purchase!</h3>
            <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
              Your order has been registered via <b>Order Service (Port 3003)</b> and receipt archived to <b>RustFS Object Storage</b>.
            </p>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-left space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Order Reference:</span>
                <span className="font-mono font-bold text-indigo-600">{lastOrderId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Delivery To:</span>
                <span className="font-semibold text-slate-800">Alex Morgan, Springfield OR</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Estimated Delivery:</span>
                <span className="font-semibold text-emerald-700">2-3 Business Days</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-6 py-3 rounded-xl transition"
            >
              Continue Shopping
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
