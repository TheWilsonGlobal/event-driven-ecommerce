'use client'

import React from 'react'
import type { Product } from '../app/types'

interface QuickViewModalProps {
  product: Product | null
  onClose: () => void
  onAddToCart: (p: Product) => void
}

export default function QuickViewModal({ product, onClose, onAddToCart }: QuickViewModalProps) {
  if (!product) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div className="bg-white rounded-3xl max-w-3xl w-full overflow-hidden shadow-2xl border border-slate-200 relative animate-fadeIn">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center"
        >
          ✕
        </button>
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="h-72 md:h-full bg-slate-100 relative">
            <img
              src={product.images[0]?.url}
              alt={product.title}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="p-8 flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md">
                {product.category.name}
              </span>
              <h3 className="text-2xl font-black text-slate-900 mt-3">{product.title}</h3>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-amber-400">★</span>
                <span className="text-xs font-bold">{product.ratings.average}</span>
                <span className="text-xs text-slate-400">
                  ({product.ratings.count} verified customer ratings)
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-4 leading-relaxed">{product.description}</p>

              {/* Specifications */}
              <div className="mt-6 border-t border-slate-100 pt-4">
                <h5 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                  Key Specifications
                </h5>
                <div className="space-y-1">
                  {product.attributes.map((attr) => (
                    <div key={attr.name} className="flex justify-between text-xs py-0.5">
                      <span className="text-slate-500">{attr.name}</span>
                      <span className="font-semibold text-slate-800">{attr.value}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs py-0.5">
                    <span className="text-slate-500">SKU</span>
                    <span className="font-mono text-slate-800">{product.sku}</span>
                  </div>
                  <div className="flex justify-between text-xs py-0.5">
                    <span className="text-slate-500">Stock Status</span>
                    <span className="font-bold text-emerald-600">
                      ✓ In Stock ({product.stock} units)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center justify-between gap-4">
              <div>
                <span className="text-xs text-slate-400 line-through block">
                  ${product.compareAtPrice.toFixed(2)}
                </span>
                <span className="text-2xl font-black text-slate-900">
                  ${product.price.toFixed(2)}
                </span>
              </div>
              <button
                onClick={() => {
                  onAddToCart(product)
                  onClose()
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm py-3 rounded-xl shadow-lg shadow-indigo-100 transition text-center"
              >
                Add to Cart 🛒
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
