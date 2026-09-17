import { useState } from 'react'
import type { ProductRecord } from '../types'
import { Pagination } from '../components/ui'

interface Props {
  filteredProducts: ProductRecord[]
  productSearch: string
  onProductSearch: (val: string) => void
  productCategoryFilter: string
  onCategoryFilter: (val: string) => void
  onEditProduct: (p: ProductRecord) => void
  onDeleteProduct: (id: string) => void
  onAddProduct: () => void
}

export default function ProductsTab({
  filteredProducts,
  productSearch,
  onProductSearch,
  productCategoryFilter,
  onCategoryFilter,
  onEditProduct,
  onDeleteProduct,
  onAddProduct,
}: Props) {
  const [page, setPage] = useState<number>(1)
  const pageSize = 10
  const paginated = filteredProducts.slice((page - 1) * pageSize, page * pageSize)

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          Product Catalog <span className="tag">{filteredProducts.length} Items</span>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={onAddProduct}>
            + Add New Product
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="text"
            placeholder="Search title, SKU, description..."
            value={productSearch}
            onChange={(e) => {
              onProductSearch(e.target.value)
              setPage(1)
            }}
          />
          <select
            value={productCategoryFilter}
            onChange={(e) => {
              onCategoryFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="ALL">All Categories</option>
            <option value="Audio & Headphones">Audio & Headphones</option>
            <option value="Computers & Laptops">Computers & Laptops</option>
            <option value="Smartphones & Watches">Smartphones & Watches</option>
            <option value="Gaming & VR">Gaming & VR</option>
          </select>
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Description</th>
              <th>SKU</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Rating</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{ textAlign: 'center', padding: 32, color: 'var(--text-faint)' }}
                >
                  No products found matching filter criteria.
                </td>
              </tr>
            ) : (
              paginated.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <img
                        src={p.images[0]?.url}
                        alt=""
                        style={{ width: 26, height: 26, borderRadius: 4, objectFit: 'cover' }}
                      />
                      <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>
                        {p.title}
                      </span>
                    </div>
                  </td>
                  <td
                    style={{
                      fontSize: 12,
                      color: 'var(--text-faint)',
                      maxWidth: 260,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={p.description}
                  >
                    {p.description}
                  </td>
                  <td className="mono" style={{ color: 'var(--blue-light)', fontWeight: 600 }}>
                    {p.sku}
                  </td>
                  <td>
                    <span className="chip chip-purple">{p.category.name}</span>
                  </td>
                  <td className="mono" style={{ color: 'var(--green-light)', fontWeight: 700 }}>
                    ${p.price.toFixed(2)}
                  </td>
                  <td>
                    <span
                      className={`chip ${p.stock > 20 ? 'chip-green' : p.stock > 0 ? 'chip-amber' : 'chip-red'}`}
                    >
                      {p.stock} in stock
                    </span>
                  </td>
                  <td className="mono">
                    ⭐ {p.ratings.average.toFixed(1)} ({p.ratings.count})
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => onEditProduct(p)}>
                        Edit
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => onDeleteProduct(p.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <Pagination
          page={page}
          pageSize={pageSize}
          total={filteredProducts.length}
          onPage={setPage}
          noun="products"
        />
      </div>
    </>
  )
}
