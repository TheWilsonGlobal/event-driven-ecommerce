import { useEffect, useRef, useState } from 'react'
import type { ProductRecord } from '../../types'
import { PRODUCT_SERVICE_URL, RUSTFS_BUCKET_URL } from '../../data/serviceUrls'

export const DEFAULT_IMAGE_URL =
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80'

export function objectPublicUrl(key: string): string {
  return `${RUSTFS_BUCKET_URL}/${key}`
}

type ImageSource = 'url' | 'upload'

export interface RustfsObject {
  key: string
  sizeBytes: number
  lastModified: string
}

interface Props {
  isOpen: boolean
  editingProduct: ProductRecord | null
  imageUrl: string
  onImageUrlChange: (url: string) => void
}

export default function ImagePicker({ isOpen, editingProduct, imageUrl, onImageUrlChange }: Props) {
  const [imageSource, setImageSource] = useState<ImageSource>('url')
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
    onImageUrlChange(editingProduct?.images[0]?.url ?? DEFAULT_IMAGE_URL)
    setImageSource('url')
    setUploadError(null)
    setObjectSearch('')
  }, [editingProduct, isOpen, onImageUrlChange])

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
      onImageUrlChange(data.url as string)
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
          : 'Upload failed — is ms-product (port 5464) and RustFS running?'
      )
    } finally {
      setUploading(false)
    }
  }

  return (
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
            onChange={(e) => onImageUrlChange(e.target.value)}
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
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  Loading existing images…
                </div>
              ) : objectsError ? (
                <div style={{ fontSize: 12, color: 'var(--red-light)' }}>{objectsError}</div>
              ) : filteredObjects.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
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
                        onClick={() => onImageUrlChange(url)}
                        title={o.key}
                        style={{
                          padding: 0,
                          border: selected ? '2px solid var(--blue)' : '1px solid var(--border)',
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
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--red-light)' }}>{uploadError}</div>
        )}
      </div>
    </div>
  )
}
