'use client'

import React from 'react'

interface HeroSectionProps {
  productCount: number
  onScrollToCatalog: () => void
  onQuickAddFlagship: () => void
}

export default function HeroSection({
  productCount,
  onScrollToCatalog,
  onQuickAddFlagship,
}: HeroSectionProps) {
  return (
    <>
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-indigo-950 via-slate-900 to-slate-950 text-white py-16 sm:py-24">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#818cf8_1px,transparent_1px)] [background-size:16px_16px]"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold">
                <span>🚀 Next-Gen Hardware &amp; Spatial Sound</span>
              </div>
              <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight">
                Architectural Performance.
                <br />
                <span className="bg-gradient-to-r from-indigo-400 via-sky-300 to-violet-300 bg-clip-text text-transparent">
                  Engineered for Creators.
                </span>
              </h1>
              <p className="text-base sm:text-lg text-slate-300 max-w-2xl leading-relaxed">
                Experience high-performance computing, pristine acoustic spatial sound, and titanium
                wearables powered by real-time microservice architecture.
              </p>
              <div className="flex flex-wrap gap-4 justify-center lg:justify-start pt-2">
                <button
                  onClick={onScrollToCatalog}
                  className="bg-white text-slate-950 hover:bg-slate-100 px-6 py-3 rounded-xl font-bold text-sm shadow-xl transition transform active:scale-95"
                >
                  Explore Catalog ({productCount} Items)
                </button>
                <button
                  onClick={onQuickAddFlagship}
                  className="bg-indigo-600/60 hover:bg-indigo-600 text-white border border-indigo-400/30 px-6 py-3 rounded-xl font-bold text-sm transition"
                >
                  Quick Add Flagship Headphone ($349.99)
                </button>
              </div>
            </div>

            {/* Hero image card */}
            <div className="lg:col-span-5 flex justify-center">
              <div className="relative group rounded-3xl overflow-hidden shadow-2xl border border-slate-700/50 bg-slate-800/80 backdrop-blur max-w-md w-full p-4">
                <div className="h-64 sm:h-72 w-full rounded-2xl overflow-hidden relative">
                  <img
                    src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80"
                    alt="Flagship Aura Pro"
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                  />
                  <span className="absolute top-3 left-3 bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
                    Top Seller 🔥
                  </span>
                </div>
                <div className="mt-4 flex justify-between items-end">
                  <div>
                    <h3 className="font-bold text-lg text-white">Aura Pro Wireless ANC</h3>
                    <p className="text-xs text-slate-400">
                      40h Battery · Spatial Audio · Bluetooth 5.3
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400 line-through block">$399.99</span>
                    <span className="text-xl font-black text-amber-400">$349.99</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature perks */}
      <section className="bg-white border-b border-slate-200 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div className="flex flex-col items-center">
            <span className="text-2xl mb-1">📦</span>
            <h4 className="text-sm font-bold text-slate-900">Free Express Shipping</h4>
            <p className="text-xs text-slate-500">On all orders over $100</p>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-2xl mb-1">🛡️</span>
            <h4 className="text-sm font-bold text-slate-900">2-Year Full Warranty</h4>
            <p className="text-xs text-slate-500">Comprehensive hardware coverage</p>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-2xl mb-1">⚡</span>
            <h4 className="text-sm font-bold text-slate-900">Fast Microservice Backend</h4>
            <p className="text-xs text-slate-500">Gateway + Fastify + Prisma + RustFS</p>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-2xl mb-1">🔄</span>
            <h4 className="text-sm font-bold text-slate-900">30-Day Free Returns</h4>
            <p className="text-xs text-slate-500">Hassle-free guarantee</p>
          </div>
        </div>
      </section>
    </>
  )
}
