'use client';

import React from 'react';

interface StorefrontHeaderProps {
  searchQuery: string;
  onSearch: (v: string) => void;
  totalCartCount: number;
  onOpenCart: () => void;
}

export default function StorefrontHeader({
  searchQuery,
  onSearch,
  totalCartCount,
  onOpenCart,
}: StorefrontHeaderProps) {
  return (
    <>
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white text-xs py-2 px-4 text-center font-medium flex justify-center items-center gap-4">
        <span>⚡ <b>SPRING TECH EVENT</b> — Use code <code className="bg-white/20 px-1.5 py-0.5 rounded font-mono text-amber-300">SAVE20</code> for 20% off all orders</span>
        <span className="hidden md:inline text-indigo-300">|</span>
        <span className="hidden md:inline text-indigo-200">RustFS Object Storage &amp; Prisma Powered</span>
      </div>

      {/* Navigation Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-black text-xl shadow-md shadow-indigo-200">
              ⚡
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-800 bg-clip-text text-transparent">
                NEO STORE
              </span>
              <span className="hidden sm:inline-block ml-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                Microservices Client
              </span>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search products, brands, specs (e.g. 4K, M3, ANC)..."
                className="w-full bg-slate-100/80 border border-slate-300 focus:border-indigo-500 focus:bg-white text-slate-900 text-sm rounded-xl pl-10 pr-4 py-2 outline-none transition"
              />
              <span className="absolute left-3.5 top-2.5 text-slate-400">🔍</span>
              {searchQuery && (
                <button
                  onClick={() => onSearch('')}
                  className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <a
              href="http://localhost:3005"
              target="_blank"
              rel="noreferrer"
              className="hidden lg:flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-200 transition"
            >
              <span>⚙️ Admin Portal</span>
            </a>

            <button
              onClick={onOpenCart}
              className="relative flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md shadow-indigo-100 transition transform active:scale-95"
            >
              <span>🛒 Cart</span>
              {totalCartCount > 0 && (
                <span className="bg-amber-400 text-slate-900 text-xs font-black px-2 py-0.5 rounded-full">
                  {totalCartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile search bar */}
        <div className="p-3 border-t border-slate-100 md:hidden bg-slate-50">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-xl px-4 py-2 outline-none"
          />
        </div>
      </header>
    </>
  );
}
