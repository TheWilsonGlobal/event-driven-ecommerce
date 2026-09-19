import { useState } from 'react'
import type { ProductRecord } from '../types'
import ImagePicker, { DEFAULT_IMAGE_URL } from './productModal/ImagePicker'

interface Props {
  isOpen: boolean
  editingProduct: ProductRecord | null
  onClose: () => void
  onSave: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>
}

export default function ProductModal({ isOpen, editingProduct, onClose, onSave }: Props) {
  const [imageUrl, setImageUrl] = useState(editingProduct?.images[0]?.url ?? DEFAULT_IMAGE_URL)

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{editingProduct ? 'Edit Catalog Product' : 'Add New Product'}</h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <form onSubmit={onSave} className="modal-body">
          <div className="form-group-inline">
            <label>Product Title</label>
            <input
              name="title"
              defaultValue={editingProduct?.title ?? ''}
              required
              className="input-field"
              placeholder="e.g. Aura Pro Wireless Headphones"
            />
          </div>

          <div className="form-group-inline">
            <label>SKU</label>
            <input
              name="sku"
              defaultValue={editingProduct?.sku ?? ''}
              required
              className="input-field mono"
              placeholder="AUDIO-AURA-01"
            />
          </div>

          <div className="form-group-inline">
            <label>Category</label>
            <select
              name="category"
              defaultValue={editingProduct?.category.name ?? 'Audio & Headphones'}
              className="input-field"
            >
              <option value="Audio & Headphones">Audio & Headphones</option>
              <option value="Computers & Laptops">Computers & Laptops</option>
              <option value="Smartphones & Watches">Smartphones & Watches</option>
              <option value="Gaming & VR">Gaming & VR</option>
            </select>
          </div>

          <div className="form-group-inline">
            <label>Price ($)</label>
            <input
              name="price"
              type="number"
              step="0.01"
              defaultValue={editingProduct?.price ?? ''}
              required
              className="input-field mono"
            />
          </div>

          <div className="form-group-inline">
            <label>Compare Price ($)</label>
            <input
              name="compareAtPrice"
              type="number"
              step="0.01"
              defaultValue={editingProduct?.compareAtPrice ?? ''}
              className="input-field mono"
            />
          </div>

          <div className="form-group-inline">
            <label>Stock Count</label>
            <input
              name="stock"
              type="number"
              defaultValue={editingProduct?.stock ?? 50}
              required
              className="input-field mono"
            />
          </div>

          <ImagePicker
            isOpen={isOpen}
            editingProduct={editingProduct}
            imageUrl={imageUrl}
            onImageUrlChange={setImageUrl}
          />

          <div className="form-group-inline">
            <label>Description</label>
            <textarea
              name="description"
              rows={3}
              defaultValue={editingProduct?.description ?? ''}
              className="input-field"
              placeholder="Product description and specifications..."
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {editingProduct ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
