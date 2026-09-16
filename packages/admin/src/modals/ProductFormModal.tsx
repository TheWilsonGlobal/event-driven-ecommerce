import React from 'react'
import type { ProductRecord } from '../types'

interface Props {
  isOpen: boolean
  editingProduct: ProductRecord | null
  onClose: () => void
  onSave: (e: React.FormEvent<HTMLFormElement>) => void
}

export default function ProductFormModal({ isOpen, editingProduct, onClose, onSave }: Props) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
          <h3 className="font-bold text-base text-white">
            {editingProduct ? 'Edit Catalog Product' : 'Add New Product to Catalog'}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSave} className="space-y-3 text-xs">
          <div>
            <label className="text-slate-400 block mb-1">Product Title</label>
            <input
              name="title"
              defaultValue={editingProduct?.title || ''}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">SKU</label>
              <input
                name="sku"
                defaultValue={editingProduct?.sku || ''}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none font-mono focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Category</label>
              <select
                name="category"
                defaultValue={editingProduct?.category.name || 'Audio & Headphones'}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
              >
                <option value="Audio &amp; Headphones">Audio &amp; Headphones</option>
                <option value="Computers &amp; Laptops">Computers &amp; Laptops</option>
                <option value="Smartphones &amp; Watches">Smartphones &amp; Watches</option>
                <option value="Gaming &amp; VR">Gaming &amp; VR</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">Price ($)</label>
              <input
                name="price"
                type="number"
                step="0.01"
                defaultValue={editingProduct?.price || ''}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500 font-mono"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Compare Price ($)</label>
              <input
                name="compareAtPrice"
                type="number"
                step="0.01"
                defaultValue={editingProduct?.compareAtPrice || ''}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500 font-mono"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Stock Count</label>
              <input
                name="stock"
                type="number"
                defaultValue={editingProduct?.stock || 50}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-slate-400 block mb-1">CDN Image URL</label>
            <input
              name="imageUrl"
              defaultValue={
                editingProduct?.images[0]?.url ||
                'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80'
              }
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500 font-mono text-[11px]"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Description</label>
            <textarea
              name="description"
              rows={3}
              defaultValue={editingProduct?.description || ''}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3 rounded-xl shadow-lg transition mt-4"
          >
            {editingProduct ? 'Update Product' : 'Add to Catalog'}
          </button>
        </form>
      </div>
    </div>
  )
}
