import { useEffect, useRef, useState } from 'react'
import type { ProductRecord } from '../types'

const DEFAULT_IMAGE_URL = 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80'
const PRODUCT_SERVICE_URL = 'http://localhost:3002'

interface Props {
  isOpen: boolean
  editingProduct: ProductRecord | null
  onClose: () => void
  onSave: (e: React.FormEvent<HTMLFormElement>) => void
}

export default function ProductModal({ isOpen, editingProduct, onClose, onSave }: Props) {
  const [imageUrl, setImageUrl] = useState(editingProduct?.images[0]?.url ?? DEFAULT_IMAGE_URL)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset to the product being edited (or the placeholder default) every time
  // the modal is opened for a different product, rather than carrying over
  // whatever was left in state from the previous edit/upload.
  useEffect(() => {
    setImageUrl(editingProduct?.images[0]?.url ?? DEFAULT_IMAGE_URL)
    setUploadError(null)
  }, [editingProduct, isOpen])

  if (!isOpen) return null

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploading(true)
    setUploadError(null)
    try {
      const body = new FormData()
      body.append('image', file)
      const res = await fetch(`${PRODUCT_SERVICE_URL}/api/v1/products/upload`, {
        method: 'POST',
        body,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status})`)
      setImageUrl(data.url as string)
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : 'Upload failed — is ms-product (port 3002) and RustFS running?'
      )
    } finally {
      setUploading(false)
    }
  }

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

          <div className="form-group-inline">
            <label>Image URL</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                name="imageUrl"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="input-field mono"
                style={{ flex: 1 }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleFileSelected}
                hidden
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? 'Uploading…' : 'Upload to RustFS'}
              </button>
            </div>
            {uploadError && (
              <div style={{ gridColumn: '2', fontSize: 11, color: 'var(--red-light)' }}>
                {uploadError}
              </div>
            )}
          </div>

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
