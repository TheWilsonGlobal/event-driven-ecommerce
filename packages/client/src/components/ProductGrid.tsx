'use client';

import React from 'react';
import { CATEGORIES } from '../app/data';
import type { Product } from '../app/types';

interface ProductGridProps {
  selectedCategory: string;
  onCategoryChange: (id: string) => void;
  sortBy: 'featured' | 'price-asc' | 'price-desc' | 'rating';
  onSortChange: (v: 'featured' | 'price-asc' | 'price-desc' | 'rating') => void;
  filteredProducts: Product[];
  onQuickView: (p: Product) => void;
  onAddToCart: (p: Product) => void;
}

export default function ProductGrid({
  selectedCategory,
  onCategoryChange,
  sortBy,
  onSortChange,
  filteredProducts,
  onQuickView,
  onAddToCart,
}: ProductGridProps) {
  return (
    <main id="catalog" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
      {/* Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 border-b border-slate-200">
        {/* Category Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onCategoryChange(cat.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
                selectedCategory === cat.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>

        {/* Sorting & Counter */}
        <div className="flex items-center justify-between md:justify-end gap-3">
          <span className="text-xs font-semibold text-slate-500">
            Showing {filteredProducts.length} items
          </span>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as 'featured' | 'price-asc' | 'price-desc' | 'rating')}
            className="bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
          >
            <option value="featured">Sort by: Featured</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="rating">Highest Rated</option>
          </select>
        </div>
      </div>

      {/* Product Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 pt-8">
        {filteredProducts.map((product) => (
          <div
            key={product.id}
            className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col group"
          >
            {/* Image Container */}
            <div className="relative h-64 bg-slate-100 overflow-hidden cursor-pointer" onClick={() => onQuickView(product)}>
              <img
                src={product.images[0]?.url}
                alt={product.images[0]?.alt || product.title}
                className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
              />
              <div className="absolute top-3 left-3 flex flex-col gap-1">
                {product.compareAtPrice > product.price && (
                  <span className="bg-rose-500 text-white text-[11px] font-black px-2.5 py-0.5 rounded-full shadow-sm">
                    SAVE ${(product.compareAtPrice - product.price).toFixed(0)}
                  </span>
                )}
                <span className="bg-slate-900/80 backdrop-blur text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                  {product.category.name}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickView(product);
                }}
                className="absolute bottom-3 right-3 bg-white/90 backdrop-blur hover:bg-white text-slate-800 text-xs font-bold px-3 py-1.5 rounded-lg shadow opacity-0 group-hover:opacity-100 transition"
              >
                Quick View 👁️
              </button>
            </div>

            {/* Card Body */}
            <div className="p-5 flex-1 flex flex-col justify-between">
              <div>
                {/* Ratings */}
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-amber-400 text-sm">★</span>
                  <span className="text-xs font-bold text-slate-800">{product.ratings.average}</span>
                  <span className="text-xs text-slate-400">({product.ratings.count} reviews)</span>
                </div>

                <h3
                  onClick={() => onQuickView(product)}
                  className="font-bold text-slate-900 text-base group-hover:text-indigo-600 transition cursor-pointer line-clamp-1"
                >
                  {product.title}
                </h3>

                <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                  {product.description}
                </p>

                {/* Badges / Specs */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {product.attributes.slice(0, 2).map((attr) => (
                    <span
                      key={attr.name}
                      className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium"
                    >
                      {attr.name}: <b>{attr.value}</b>
                    </span>
                  ))}
                </div>
              </div>

              {/* Footer & Add to Cart */}
              <div className="pt-5 mt-4 border-t border-slate-100 flex items-center justify-between">
                <div>
                  {product.compareAtPrice > product.price && (
                    <span className="text-xs text-slate-400 line-through block">
                      ${product.compareAtPrice.toFixed(2)}
                    </span>
                  )}
                  <span className="text-xl font-black text-slate-900">
                    ${product.price.toFixed(2)}
                  </span>
                </div>

                <button
                  onClick={() => onAddToCart(product)}
                  className="bg-indigo-50 hover:bg-indigo-600 text-indigo-600 hover:text-white font-bold text-xs px-4 py-2.5 rounded-xl border border-indigo-200 hover:border-indigo-600 transition flex items-center gap-1.5"
                >
                  <span>+ Add</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
