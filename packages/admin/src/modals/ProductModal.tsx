import { useEffect, useRef, useState } from 'react'
import type { ProductRecord } from '../types'

const DEFAULT_IMAGE_URL = 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80'
const PRODUCT_SERVICE_URL = 'http://localhost:3002'
const RUSTFS_BUCKET_URL = 'http://localhost:9000/ecommerce-uploads'

function objectPublicUrl(key: string): string {
  return `${RUSTFS_BUCKET_URL}/${key}`
}

interface Props {
  isOpen: boolean
  editingProduct: ProductRecord | null
  onClose: () => void
  onSave: (e: React.FormEvent<HTMLFormElement>) => void
}

type ImageSource = 'url' | 'upload'

interface RustfsObject {
  key: string
  sizeBytes: number
  lastModified: string
}

export default function ProductModal({ isOpen, editingProduct, onClose, onSave }: Props) {
  const [imageSource, setImageSource] = useState<ImageSource>('url')
  const [imageUrl, setImageUrl] = useState(editingProduct?.images[0]?.url ?? DEFAULT_IMAGE_URL)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [existingObjects, setExistingObjects] = useState<RustfsObject[]>([])
  const [objectsLoading, setObjectsLoading] = useState(false)
  const [objectsError, setObjectsError] = useState<string | null>(null)
  const [objectSearch, setObjectSearch] = useState('')

  // Reset to the product being edited (or the placeholder default) every time
  // the modal is opened for a different product, rather than carrying over
  // whatever was left in state from the previous edit/upload.
  useEffect(() => {
    setImageUrl(editingProduct?.images[0]?.url ?? DEFAULT_IMAGE_URL)
    setImageSource('url')
    setUploadError(null)
    setObjectSearch('')
  }, [editingProduct, isOpen])

  useEffect(() => {
    if (!isOpen || imageSource !== 'upload') return
    let cancelled = false
    setObjectsLoading(true)
    setObjectsError(null)
    fetch(`${PRODUCT_SERVICE_URL}/api/v1/storage/objects`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setExistingObjects(data.objects ?? [])
      })
      .catch(() => {
        if (!cancelled) setObjectsError('Could not load existing images from RustFS.')
      })
      .finally(() => {
        if (!cancelled) setObjectsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, imageSource])

  if (!isOpen) return null

  const q = objectSearch.trim().toLowerCase()
  const filteredObjects = q
    ? existingObjects.filter((o) => o.key.toLowerCase().includes(q))
    : existingObjects

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
      setExistingObjects((prev) => [
        {
          key: data.key as string,
          sizeBytes: data.size ?? 0,
          lastModified: new Date().toISOString(),
        },
        ...prev,
      ])
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
            <label>Product Image</label>
            <div>
              <div className="filter-tabs" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className={`filter-tab${imageSource === 'url' ? ' active' : ''}`}
                  onClick={() => setImageSource('url')}
                >
                  External URL
                </button>
                <button
                  type="button"
                  className={`filter-tab${imageSource === 'upload' ? ' active' : ''}`}
                  onClick={() => setImageSource('upload')}
                >
                  Upload to RustFS
                </button>
              </div>

              {imageSource === 'url' ? (
                <input
                  name="imageUrl"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="input-field mono"
                  placeholder="https://example.com/image.jpg"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              ) : (
                <>
                  <input type="hidden" name="imageUrl" value={imageUrl} />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleFileSelected}
                    hidden
                  />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <img
                      src={imageUrl}
                      alt=""
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 4,
                        objectFit: 'cover',
                        border: '1px solid var(--border)',
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? 'Uploading…' : 'Upload New Image'}
                    </button>
                  </div>

                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 10,
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Search existing RustFS images by key..."
                      value={objectSearch}
                      onChange={(e) => setObjectSearch(e.target.value)}
                      className="input-field"
                      style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
                    />

                    {objectsLoading ? (
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        Loading existing images…
                      </div>
                    ) : objectsError ? (
                      <div style={{ fontSize: 11, color: 'var(--red-light)' }}>{objectsError}</div>
                    ) : filteredObjects.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        {existingObjects.length === 0
                          ? 'No images in the bucket yet — upload one above.'
                          : `No images match "${objectSearch}"`}
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))',
                          gap: 8,
                          maxHeight: 160,
                          overflowY: 'auto',
                        }}
                      >
                        {filteredObjects.map((o) => {
                          const url = objectPublicUrl(o.key)
                          const selected = url === imageUrl
                          return (
                            <button
                              type="button"
                              key={o.key}
                              onClick={() => setImageUrl(url)}
                              title={o.key}
                              style={{
                                padding: 0,
                                border: selected
                                  ? '2px solid var(--blue)'
                                  : '1px solid var(--border)',
                                borderRadius: 4,
                                overflow: 'hidden',
                                cursor: 'pointer',
                                background: 'var(--panel)',
                                lineHeight: 0,
                              }}
                            >
                              <img
                                src={url}
                                alt=""
                                style={{
                                  width: '100%',
                                  height: 56,
                                  objectFit: 'cover',
                                  display: 'block',
                                }}
                              />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
              {uploadError && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red-light)' }}>
                  {uploadError}
                </div>
              )}
            </div>
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
