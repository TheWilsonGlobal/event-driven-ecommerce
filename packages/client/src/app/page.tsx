'use client';

import React, { useState, useMemo } from 'react';

// Seed product definitions aligned with shared database seed
interface Product {
  id: string;
  title: string;
  slug: string;
  sku: string;
  description: string;
  price: number;
  compareAtPrice: number;
  currency: string;
  stock: number;
  category: {
    id: string;
    name: string;
    slug: string;
  };
  tags: string[];
  images: {
    url: string;
    alt: string;
    isPrimary: boolean;
  }[];
  attributes: {
    name: string;
    value: string;
  }[];
  ratings: {
    average: number;
    count: number;
  };
}

interface CartItem {
  product: Product;
  quantity: number;
}

const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    title: 'Aura Pro Wireless ANC Headphones',
    slug: 'aura-pro-wireless-anc-headphones',
    sku: 'AUDIO-AURA-01',
    description: 'Industry-leading active noise cancellation with 40-hour battery life, custom spatial audio tuning, and ultra-plush memory foam earcups.',
    price: 349.99,
    compareAtPrice: 399.99,
    currency: 'USD',
    stock: 45,
    category: {
      id: 'cat-1',
      name: 'Audio & Headphones',
      slug: 'audio-headphones',
    },
    tags: ['wireless', 'noise-cancelling', 'bluetooth 5.3', 'spatial-audio'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80',
        alt: 'Aura Pro Wireless Headphones in Midnight Black',
        isPrimary: true,
      },
      {
        url: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&q=80',
        alt: 'Aura Pro angled side view',
        isPrimary: false,
      },
    ],
    attributes: [
      { name: 'Color', value: 'Midnight Black' },
      { name: 'Battery Life', value: '40 Hours' },
      { name: 'Connectivity', value: 'Bluetooth 5.3 + 3.5mm Aux' },
    ],
    ratings: {
      average: 4.9,
      count: 328,
    },
  },
  {
    id: 'prod-2',
    title: 'NovaBook Pro 16" M3 Max Workstation',
    slug: 'novabook-pro-16-m3-workstation',
    sku: 'LAPTOP-NOVA-16',
    description: 'Uncompromising performance for creators and engineers. Liquid Retina XDR display with 120Hz ProMotion, 36GB Unified Memory, and 1TB NVMe SSD.',
    price: 2499.0,
    compareAtPrice: 2699.0,
    currency: 'USD',
    stock: 18,
    category: {
      id: 'cat-2',
      name: 'Computers & Laptops',
      slug: 'computers-laptops',
    },
    tags: ['laptop', 'workstation', 'retina-display', '120hz'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&q=80',
        alt: 'NovaBook Pro 16 on modern wooden desk',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Screen Size', value: '16.2 Inch' },
      { name: 'RAM', value: '36GB Unified' },
      { name: 'Storage', value: '1TB SSD' },
      { name: 'Color', value: 'Space Titanium' },
    ],
    ratings: {
      average: 4.95,
      count: 142,
    },
  },
  {
    id: 'prod-3',
    title: 'Titanium Horizon Smartwatch Ultra',
    slug: 'titanium-horizon-smartwatch-ultra',
    sku: 'WATCH-HORIZON-U',
    description: 'Rugged titanium chassis with sapphire glass, dual-frequency GPS, 100m water resistance, ECG heart rate tracking, and 7-day battery life.',
    price: 799.0,
    compareAtPrice: 849.0,
    currency: 'USD',
    stock: 29,
    category: {
      id: 'cat-3',
      name: 'Smartphones & Watches',
      slug: 'smartphones-watches',
    },
    tags: ['smartwatch', 'titanium', 'gps', 'fitness-tracker', 'ecg'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80',
        alt: 'Titanium Horizon Smartwatch on display',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Case Material', value: 'Grade 5 Titanium' },
      { name: 'Case Size', value: '49mm' },
      { name: 'Battery', value: 'Up to 7 Days' },
    ],
    ratings: {
      average: 4.85,
      count: 215,
    },
  },
  {
    id: 'prod-4',
    title: 'Pulse Studio Wireless Earbuds',
    slug: 'pulse-studio-wireless-earbuds',
    sku: 'AUDIO-PULSE-02',
    description: 'Compact ergonomic earbuds with adaptive transparency mode, wireless Qi charging case, IPX5 water resistance, and crystal clear 6-mic beamforming calls.',
    price: 189.99,
    compareAtPrice: 229.99,
    currency: 'USD',
    stock: 62,
    category: {
      id: 'cat-1',
      name: 'Audio & Headphones',
      slug: 'audio-headphones',
    },
    tags: ['earbuds', 'true-wireless', 'wireless-charging', 'ipx5'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&q=80',
        alt: 'Pulse Studio Wireless Earbuds with charging case',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Color', value: 'Matte White' },
      { name: 'Battery with Case', value: '32 Hours' },
    ],
    ratings: {
      average: 4.7,
      count: 512,
    },
  },
  {
    id: 'prod-5',
    title: 'Vortex RGB Mechanical Gaming Keyboard',
    slug: 'vortex-rgb-mechanical-gaming-keyboard',
    sku: 'GAME-VORTEX-KB',
    description: 'Hot-swappable linear optical switches, aircraft-grade aluminum frame, per-key RGB lighting, PBT double-shot keycaps, and detachable braided Type-C cable.',
    price: 149.99,
    compareAtPrice: 179.99,
    currency: 'USD',
    stock: 35,
    category: {
      id: 'cat-4',
      name: 'Gaming & VR',
      slug: 'gaming-vr',
    },
    tags: ['gaming', 'mechanical-keyboard', 'rgb', 'hot-swappable'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&q=80',
        alt: 'Vortex RGB Mechanical Gaming Keyboard illuminated',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Switch Type', value: 'Optical Linear Red' },
      { name: 'Layout', value: 'Tenkeyless (TKL)' },
    ],
    ratings: {
      average: 4.8,
      count: 189,
    },
  },
  {
    id: 'prod-6',
    title: 'Lumix Neo 4K 144Hz IPS Monitor 27"',
    slug: 'lumix-neo-4k-144hz-monitor',
    sku: 'MONITOR-LUMIX-27',
    description: 'Crisp 4K UHD resolution with 144Hz refresh rate, 1ms response time, 99% DCI-P3 color gamut, HDR600, USB-C 90W Power Delivery, and ergonomic tilt/swivel stand.',
    price: 649.99,
    compareAtPrice: 729.99,
    currency: 'USD',
    stock: 22,
    category: {
      id: 'cat-2',
      name: 'Computers & Laptops',
      slug: 'computers-laptops',
    },
    tags: ['4k', '144hz', 'ips-monitor', 'hdr600', 'usb-c'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=800&q=80',
        alt: 'Lumix Neo 4K Monitor displaying high-contrast graphics',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Resolution', value: '3840 x 2160 (4K)' },
      { name: 'Refresh Rate', value: '144Hz' },
      { name: 'Panel', value: 'Fast IPS' },
    ],
    ratings: {
      average: 4.9,
      count: 98,
    },
  },
];

const CATEGORIES = [
  { id: 'all', name: 'All Products', icon: '✨' },
  { id: 'cat-1', name: 'Audio & Headphones', icon: '🎧' },
  { id: 'cat-2', name: 'Computers & Laptops', icon: '💻' },
  { id: 'cat-3', name: 'Smartphones & Watches', icon: '⌚' },
  { id: 'cat-4', name: 'Gaming & VR', icon: '🎮' },
];

export default function ClientStorefront() {
  const [products] = useState<Product[]>(INITIAL_PRODUCTS);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc' | 'rating'>('featured');
  
  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [discountCode, setDiscountCode] = useState<string>('');
  const [appliedDiscount, setAppliedDiscount] = useState<number>(0);
  const [discountError, setDiscountError] = useState<string>('');

  // Modals
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState<boolean>(false);
  const [checkoutStep, setCheckoutStep] = useState<'shipping' | 'payment' | 'confirmed'>('shipping');
  const [lastOrderId, setLastOrderId] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filtered & Sorted products
  const filteredProducts = useMemo(() => {
    let list = products.filter((p) => {
      const matchesCategory = selectedCategory === 'all' || p.category.id === selectedCategory;
      const matchesSearch =
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });

    if (sortBy === 'price-asc') {
      list = [...list].sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price-desc') {
      list = [...list].sort((a, b) => b.price - a.price);
    } else if (sortBy === 'rating') {
      list = [...list].sort((a, b) => b.ratings.average - a.ratings.average);
    }

    return list;
  }, [products, selectedCategory, searchQuery, sortBy]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const addToCart = (product: Product, quantity = 1) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      return [...prev, { product, quantity }];
    });
    showToast(`Added "${product.title}" to cart!`);
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const totalCartCount = useMemo(
    () => cart.reduce((acc, item) => acc + item.quantity, 0),
    [cart]
  );

  const subtotal = useMemo(
    () => cart.reduce((acc, item) => acc + item.product.price * item.quantity, 0),
    [cart]
  );

  const discountAmount = subtotal * appliedDiscount;
  const estimatedTax = (subtotal - discountAmount) * 0.08;
  const shippingFee = subtotal > 100 || subtotal === 0 ? 0 : 15.0;
  const finalTotal = Math.max(0, subtotal - discountAmount + estimatedTax + shippingFee);

  const applyPromoCode = () => {
    if (discountCode.trim().toUpperCase() === 'SAVE20') {
      setAppliedDiscount(0.2);
      setDiscountError('');
      showToast('Promo code applied: 20% OFF!');
    } else if (discountCode.trim().toUpperCase() === 'FREESHIP') {
      setAppliedDiscount(0.05);
      setDiscountError('');
      showToast('Promo code applied: 5% Extra discount!');
    } else {
      setDiscountError('Invalid promo code. Try "SAVE20"');
    }
  };

  const handleCompleteOrder = () => {
    const orderNum = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    setLastOrderId(orderNum);
    setCheckoutStep('confirmed');
    setCart([]);
    setAppliedDiscount(0);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-bounce">
          <span className="text-emerald-400 text-lg">✓</span>
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white text-xs py-2 px-4 text-center font-medium flex justify-center items-center gap-4">
        <span>⚡ <b>SPRING TECH EVENT</b> — Use code <code className="bg-white/20 px-1.5 py-0.5 rounded font-mono text-amber-300">SAVE20</code> for 20% off all orders</span>
        <span className="hidden md:inline text-indigo-300">|</span>
        <span className="hidden md:inline text-indigo-200">RustFS Object Storage & Prisma Powered</span>
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
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products, brands, specs (e.g. 4K, M3, ANC)..."
                className="w-full bg-slate-100/80 border border-slate-300 focus:border-indigo-500 focus:bg-white text-slate-900 text-sm rounded-xl pl-10 pr-4 py-2 outline-none transition"
              />
              <span className="absolute left-3.5 top-2.5 text-slate-400">🔍</span>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
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
              onClick={() => setIsCartOpen(true)}
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
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search products..."
            className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-xl px-4 py-2 outline-none"
          />
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-indigo-950 via-slate-900 to-slate-950 text-white py-16 sm:py-24">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#818cf8_1px,transparent_1px)] [background-size:16px_16px]"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold">
                <span>🚀 Next-Gen Hardware & Spatial Sound</span>
              </div>
              <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight">
                Architectural Performance.<br />
                <span className="bg-gradient-to-r from-indigo-400 via-sky-300 to-violet-300 bg-clip-text text-transparent">
                  Engineered for Creators.
                </span>
              </h1>
              <p className="text-base sm:text-lg text-slate-300 max-w-2xl leading-relaxed">
                Experience high-performance computing, pristine acoustic spatial sound, and titanium wearables powered by real-time microservice architecture.
              </p>
              <div className="flex flex-wrap gap-4 justify-center lg:justify-start pt-2">
                <button
                  onClick={() => {
                    const el = document.getElementById('catalog');
                    el?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="bg-white text-slate-950 hover:bg-slate-100 px-6 py-3 rounded-xl font-bold text-sm shadow-xl transition transform active:scale-95"
                >
                  Explore Catalog ({products.length} Items)
                </button>
                <button
                  onClick={() => {
                    const featured = products[0];
                    if (featured) addToCart(featured, 1);
                  }}
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
                    <p className="text-xs text-slate-400">40h Battery · Spatial Audio · Bluetooth 5.3</p>
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

      {/* Main Catalog Section */}
      <main id="catalog" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        {/* Controls Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 border-b border-slate-200">
          {/* Category Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
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
              onChange={(e) => setSortBy(e.target.value as any)}
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
              <div className="relative h-64 bg-slate-100 overflow-hidden cursor-pointer" onClick={() => setQuickViewProduct(product)}>
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
                    setQuickViewProduct(product);
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
                    onClick={() => setQuickViewProduct(product)}
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
                    onClick={() => addToCart(product, 1)}
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

      {/* Slide-Over Cart Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
            onClick={() => setIsCartOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col">
              {/* Cart Header */}
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🛒</span>
                  <h2 className="text-lg font-bold text-slate-900">Your Shopping Cart</h2>
                  <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">
                    {totalCartCount} items
                  </span>
                </div>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Free shipping progress */}
              <div className="bg-indigo-50/70 px-6 py-3 border-b border-indigo-100 text-xs text-indigo-900">
                {subtotal >= 100 ? (
                  <span className="font-bold text-emerald-700 flex items-center gap-1">
                    🎉 You have unlocked <b>FREE Global Express Shipping!</b>
                  </span>
                ) : (
                  <span>
                    Add <b>${(100 - subtotal).toFixed(2)}</b> more to qualify for <b>FREE Shipping</b>
                  </span>
                )}
              </div>

              {/* Cart Items List */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {cart.length === 0 ? (
                  <div className="text-center py-16">
                    <span className="text-5xl block mb-3">🛍️</span>
                    <h3 className="font-bold text-slate-800 text-base">Your cart is empty</h3>
                    <p className="text-xs text-slate-500 mt-1 mb-6">
                      Explore our high-performance hardware catalog and add items.
                    </p>
                    <button
                      onClick={() => setIsCartOpen(false)}
                      className="bg-indigo-600 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow"
                    >
                      Start Shopping
                    </button>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div
                      key={item.product.id}
                      className="flex gap-4 p-3 rounded-xl border border-slate-100 hover:border-slate-200 bg-slate-50/50"
                    >
                      <img
                        src={item.product.images[0]?.url}
                        alt={item.product.title}
                        className="w-16 h-16 rounded-lg object-cover bg-white border border-slate-200"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-xs text-slate-900 truncate">
                          {item.product.title}
                        </h4>
                        <span className="text-xs font-bold text-indigo-600 block mt-0.5">
                          ${item.product.price.toFixed(2)}
                        </span>
                        {/* Quantity controls */}
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => updateQuantity(item.product.id, -1)}
                            className="w-6 h-6 rounded bg-white border border-slate-300 text-slate-700 font-bold flex items-center justify-center hover:bg-slate-100"
                          >
                            -
                          </button>
                          <span className="text-xs font-bold text-slate-800 px-1">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className="w-6 h-6 rounded bg-white border border-slate-300 text-slate-700 font-bold flex items-center justify-center hover:bg-slate-100"
                          >
                            +
                          </button>
                          <button
                            onClick={() => removeFromCart(item.product.id)}
                            className="ml-auto text-xs text-rose-500 hover:text-rose-700 font-medium"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Cart Footer */}
              {cart.length > 0 && (
                <div className="p-6 border-t border-slate-200 bg-slate-50 space-y-4">
                  {/* Promo code box */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Promo Code (SAVE20)"
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value)}
                      className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs uppercase font-mono outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={applyPromoCode}
                      className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-xl transition"
                    >
                      Apply
                    </button>
                  </div>
                  {discountError && (
                    <p className="text-[11px] text-rose-600 font-semibold">{discountError}</p>
                  )}
                  {appliedDiscount > 0 && (
                    <p className="text-[11px] text-emerald-600 font-bold">
                      ✓ Promo discount active: {(appliedDiscount * 100).toFixed(0)}% OFF
                    </p>
                  )}

                  {/* Order Totals Breakdown */}
                  <div className="space-y-1.5 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="font-semibold text-slate-900">${subtotal.toFixed(2)}</span>
                    </div>
                    {appliedDiscount > 0 && (
                      <div className="flex justify-between text-emerald-600 font-semibold">
                        <span>Discount</span>
                        <span>-${discountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Estimated Sales Tax (8%)</span>
                      <span>${estimatedTax.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Shipping</span>
                      <span>{shippingFee === 0 ? <b className="text-emerald-600">FREE</b> : `$${shippingFee.toFixed(2)}`}</span>
                    </div>
                    <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-2 border-t border-slate-200">
                      <span>Total Amount</span>
                      <span className="text-indigo-600 text-base">${finalTotal.toFixed(2)}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setIsCartOpen(false);
                      setIsCheckoutOpen(true);
                      setCheckoutStep('shipping');
                    }}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm py-3.5 rounded-xl shadow-lg shadow-indigo-100 transition transform active:scale-98 flex items-center justify-center gap-2"
                  >
                    <span>Proceed to Checkout</span>
                    <span>&rarr;</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick View Product Modal */}
      {quickViewProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-white rounded-3xl max-w-3xl w-full overflow-hidden shadow-2xl border border-slate-200 relative animate-fadeIn">
            <button
              onClick={() => setQuickViewProduct(null)}
              className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center"
            >
              ✕
            </button>
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="h-72 md:h-full bg-slate-100 relative">
                <img
                  src={quickViewProduct.images[0]?.url}
                  alt={quickViewProduct.title}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-8 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md">
                    {quickViewProduct.category.name}
                  </span>
                  <h3 className="text-2xl font-black text-slate-900 mt-3">{quickViewProduct.title}</h3>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-amber-400">★</span>
                    <span className="text-xs font-bold">{quickViewProduct.ratings.average}</span>
                    <span className="text-xs text-slate-400">({quickViewProduct.ratings.count} verified customer ratings)</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-4 leading-relaxed">
                    {quickViewProduct.description}
                  </p>

                  {/* Specifications */}
                  <div className="mt-6 border-t border-slate-100 pt-4">
                    <h5 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                      Key Specifications
                    </h5>
                    <div className="space-y-1">
                      {quickViewProduct.attributes.map((attr) => (
                        <div key={attr.name} className="flex justify-between text-xs py-0.5">
                          <span className="text-slate-500">{attr.name}</span>
                          <span className="font-semibold text-slate-800">{attr.value}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-xs py-0.5">
                        <span className="text-slate-500">SKU</span>
                        <span className="font-mono text-slate-800">{quickViewProduct.sku}</span>
                      </div>
                      <div className="flex justify-between text-xs py-0.5">
                        <span className="text-slate-500">Stock Status</span>
                        <span className="font-bold text-emerald-600">✓ In Stock ({quickViewProduct.stock} units)</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 mt-6 border-t border-slate-100 flex items-center justify-between gap-4">
                  <div>
                    <span className="text-xs text-slate-400 line-through block">
                      ${quickViewProduct.compareAtPrice.toFixed(2)}
                    </span>
                    <span className="text-2xl font-black text-slate-900">
                      ${quickViewProduct.price.toFixed(2)}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      addToCart(quickViewProduct, 1);
                      setQuickViewProduct(null);
                    }}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm py-3 rounded-xl shadow-lg shadow-indigo-100 transition text-center"
                  >
                    Add to Cart 🛒
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Checkout Modal Flow */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-200 relative p-8">
            <button
              onClick={() => setIsCheckoutOpen(false)}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center"
            >
              ✕
            </button>

            {/* Stepper Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
              <h2 className="text-xl font-black text-slate-900">
                {checkoutStep === 'shipping' && '1. Shipping & Delivery'}
                {checkoutStep === 'payment' && '2. Payment & Confirmation'}
                {checkoutStep === 'confirmed' && 'Order Confirmed! 🎉'}
              </h2>
              {checkoutStep !== 'confirmed' && (
                <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                  Total: ${finalTotal.toFixed(2)}
                </span>
              )}
            </div>

            {/* Step 1: Shipping Form */}
            {checkoutStep === 'shipping' && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Full Name</label>
                  <input
                    type="text"
                    defaultValue="Alex Morgan"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Email Address (Order Confirmation)</label>
                  <input
                    type="email"
                    defaultValue="customer@ecommerce.com"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Shipping Address</label>
                  <input
                    type="text"
                    defaultValue="742 Evergreen Terrace"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">City</label>
                    <input
                      type="text"
                      defaultValue="Springfield"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">State / Prov</label>
                    <input
                      type="text"
                      defaultValue="OR"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">Postal Code</label>
                    <input
                      type="text"
                      defaultValue="97477"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-medium outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <button
                  onClick={() => setCheckoutStep('payment')}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm py-3.5 rounded-xl shadow-lg shadow-indigo-100 transition mt-4"
                >
                  Continue to Payment &rarr;
                </button>
              </div>
            )}

            {/* Step 2: Payment Form */}
            {checkoutStep === 'payment' && (
              <div className="space-y-4 text-xs">
                <div className="p-4 rounded-xl border-2 border-indigo-500 bg-indigo-50/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-900 text-sm">💳 Credit / Debit Card (Stripe Gateway)</span>
                    <span className="text-[10px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded font-bold">Encrypted</span>
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">Card Number</label>
                    <input
                      type="text"
                      defaultValue="4242 •••• •••• 4242"
                      className="w-full bg-white border border-slate-300 rounded-lg p-2 font-mono outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Exp Date</label>
                      <input
                        type="text"
                        defaultValue="12/28"
                        className="w-full bg-white border border-slate-300 rounded-lg p-2 font-mono outline-none"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">CVC</label>
                      <input
                        type="text"
                        defaultValue="888"
                        className="w-full bg-white border border-slate-300 rounded-lg p-2 font-mono outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100">
                  <span>🅿️</span>
                  <span className="font-bold text-slate-800">PayPal Express / Smart Buttons</span>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setCheckoutStep('shipping')}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-5 py-3 rounded-xl"
                  >
                    &larr; Back
                  </button>
                  <button
                    onClick={handleCompleteOrder}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm py-3.5 rounded-xl shadow-lg shadow-emerald-100 transition"
                  >
                    Authorize & Pay ${finalTotal.toFixed(2)}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Confirmation */}
            {checkoutStep === 'confirmed' && (
              <div className="text-center py-6 space-y-4">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto shadow-inner">
                  ✓
                </div>
                <h3 className="text-xl font-black text-slate-900">Thank you for your purchase!</h3>
                <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
                  Your order has been registered via <b>Order Service (Port 3003)</b> and receipt archived to <b>RustFS Object Storage</b>.
                </p>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-left space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Order Reference:</span>
                    <span className="font-mono font-bold text-indigo-600">{lastOrderId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Delivery To:</span>
                    <span className="font-semibold text-slate-800">Alex Morgan, Springfield OR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Estimated Delivery:</span>
                    <span className="font-semibold text-emerald-700">2-3 Business Days</span>
                  </div>
                </div>
                <button
                  onClick={() => setIsCheckoutOpen(false)}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-6 py-3 rounded-xl transition"
                >
                  Continue Shopping
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Microservices Footer Info */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-24 pt-12 border-t border-slate-200">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="font-bold text-slate-800">Microservices Architecture:</span>
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">Gateway: 3000</span>
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">User: 3001</span>
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">Product: 3002</span>
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">Order: 3003</span>
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">RustFS: 9000</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="http://localhost:3005" target="_blank" rel="noreferrer" className="hover:text-indigo-600 font-medium">
              Admin Cockpit &rarr;
            </a>
            <a href="http://localhost:3000/health" target="_blank" rel="noreferrer" className="hover:text-indigo-600 font-medium">
              API Gateway Health &rarr;
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

