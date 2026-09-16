import type { ProductRecord } from '../types';

interface Props {
  filteredProducts: ProductRecord[];
  productSearch: string;
  onProductSearch: (v: string) => void;
  productCategoryFilter: string;
  onCategoryFilter: (v: string) => void;
  onEditProduct: (p: ProductRecord) => void;
  onDeleteProduct: (id: string) => void;
  onAddProduct: () => void;
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
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search products by title or SKU..."
            value={productSearch}
            onChange={(e) => onProductSearch(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 outline-none focus:border-indigo-500 w-64"
          />
          <select
            value={productCategoryFilter}
            onChange={(e) => onCategoryFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Categories</option>
            <option value="Audio &amp; Headphones">Audio &amp; Headphones</option>
            <option value="Computers &amp; Laptops">Computers &amp; Laptops</option>
            <option value="Smartphones &amp; Watches">Smartphones &amp; Watches</option>
            <option value="Gaming &amp; VR">Gaming &amp; VR</option>
          </select>
        </div>

        <button
          onClick={onAddProduct}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-md transition flex items-center gap-1.5"
        >
          <span>+ Add New Product</span>
        </button>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredProducts.map((p) => (
          <div
            key={p.id}
            className="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden shadow-lg flex flex-col justify-between"
          >
            <div className="relative h-44 bg-slate-950">
              <img
                src={p.images[0]?.url}
                alt={p.title}
                className="w-full h-full object-cover opacity-90 hover:opacity-100 transition"
              />
              <span className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                {p.category.name}
              </span>
              <span className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                p.stock > 20 ? 'bg-emerald-500/90 text-white' : 'bg-rose-500/90 text-white'
              }`}>
                {p.stock} in stock
              </span>
            </div>

            <div className="p-4 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start gap-2">
                  <h4 className="font-bold text-sm text-white line-clamp-1">{p.title}</h4>
                  <span className="text-xs font-mono font-bold text-amber-400">${p.price.toFixed(2)}</span>
                </div>
                <span className="text-[11px] font-mono text-slate-400 block mt-0.5">{p.sku}</span>
                <p className="text-xs text-slate-400 mt-2 line-clamp-2">{p.description}</p>
              </div>

              <div className="pt-4 mt-3 border-t border-slate-700/60 flex items-center justify-between">
                <div className="flex items-center gap-1 text-xs text-amber-400">
                  <span>★</span>
                  <span className="font-bold">{p.ratings.average}</span>
                  <span className="text-slate-500">({p.ratings.count})</span>
                </div>

                <div className="space-x-2">
                  <button
                    onClick={() => onEditProduct(p)}
                    className="text-xs bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white px-2.5 py-1 rounded-lg transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDeleteProduct(p.id)}
                    className="text-xs bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white px-2.5 py-1 rounded-lg transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
