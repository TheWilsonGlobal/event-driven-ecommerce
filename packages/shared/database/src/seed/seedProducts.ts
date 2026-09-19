export interface SeedProduct {
  id: string
  title: string
  slug: string
  sku: string
  description: string
  price: number
  compareAtPrice: number
  currency: string
  stock: number
  isAvailable: boolean
  category: {
    id: string
    name: string
    slug: string
  }
  tags: string[]
  images: {
    url: string
    alt: string
    isPrimary: boolean
  }[]
  attributes: {
    name: string
    value: string
  }[]
  ratings: {
    average: number
    count: number
  }
}

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    id: 'prod-1',
    title: 'Aura Pro Wireless ANC Headphones',
    slug: 'aura-pro-wireless-anc-headphones',
    sku: 'AUDIO-AURA-01',
    description:
      'Industry-leading active noise cancellation with 40-hour battery life, custom spatial audio tuning, and ultra-plush memory foam earcups.',
    price: 349.99,
    compareAtPrice: 399.99,
    currency: 'USD',
    stock: 45,
    isAvailable: true,
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
    description:
      'Uncompromising performance for creators and engineers. Liquid Retina XDR display with 120Hz ProMotion, 36GB Unified Memory, and 1TB NVMe SSD.',
    price: 2499.0,
    compareAtPrice: 2699.0,
    currency: 'USD',
    stock: 18,
    isAvailable: true,
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
    description:
      'Rugged titanium chassis with sapphire glass, dual-frequency GPS, 100m water resistance, ECG heart rate tracking, and 7-day battery life.',
    price: 799.0,
    compareAtPrice: 849.0,
    currency: 'USD',
    stock: 29,
    isAvailable: true,
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
    description:
      'Compact ergonomic earbuds with adaptive transparency mode, wireless Qi charging case, IPX5 water resistance, and crystal clear 6-mic beamforming calls.',
    price: 189.99,
    compareAtPrice: 229.99,
    currency: 'USD',
    stock: 62,
    isAvailable: true,
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
    description:
      'Hot-swappable linear optical switches, aircraft-grade aluminum frame, per-key RGB lighting, PBT double-shot keycaps, and detachable braided Type-C cable.',
    price: 149.99,
    compareAtPrice: 179.99,
    currency: 'USD',
    stock: 35,
    isAvailable: true,
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
    description:
      'Crisp 4K UHD resolution with 144Hz refresh rate, 1ms response time, 99% DCI-P3 color gamut, HDR600, USB-C 90W Power Delivery, and ergonomic tilt/swivel stand.',
    price: 649.99,
    compareAtPrice: 729.99,
    currency: 'USD',
    stock: 22,
    isAvailable: true,
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
  {
    id: 'prod-7',
    title: 'Zenith Air Ultralight 14" Laptop',
    slug: 'zenith-air-ultralight-14-laptop',
    sku: 'LAPTOP-ZENITH-14',
    description:
      'A featherweight 1.1kg magnesium-alloy chassis with a 14" 2.8K OLED display, 32GB RAM, 1TB SSD, and up to 18 hours of battery life for all-day mobile work.',
    price: 1399.0,
    compareAtPrice: 1599.0,
    currency: 'USD',
    stock: 27,
    isAvailable: true,
    category: {
      id: 'cat-2',
      name: 'Computers & Laptops',
      slug: 'computers-laptops',
    },
    tags: ['laptop', 'ultralight', 'oled', 'long-battery'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800&q=80',
        alt: 'Zenith Air Ultralight Laptop open on a desk',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Screen Size', value: '14 Inch OLED' },
      { name: 'RAM', value: '32GB' },
      { name: 'Storage', value: '1TB SSD' },
      { name: 'Weight', value: '1.1kg' },
    ],
    ratings: {
      average: 4.75,
      count: 87,
    },
  },
  {
    id: 'prod-8',
    title: 'Forge X15 RGB Gaming Laptop',
    slug: 'forge-x15-rgb-gaming-laptop',
    sku: 'LAPTOP-FORGE-15',
    description:
      'A 15.6" QHD 240Hz gaming powerhouse with the latest discrete GPU, per-key RGB keyboard, vapor-chamber cooling, and dual USB-C Thunderbolt ports.',
    price: 1899.0,
    compareAtPrice: 2099.0,
    currency: 'USD',
    stock: 15,
    isAvailable: true,
    category: {
      id: 'cat-2',
      name: 'Computers & Laptops',
      slug: 'computers-laptops',
    },
    tags: ['laptop', 'gaming', '240hz', 'rgb'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=800&q=80',
        alt: 'Forge X15 RGB Gaming Laptop with backlit keyboard',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Screen Size', value: '15.6 Inch QHD' },
      { name: 'Refresh Rate', value: '240Hz' },
      { name: 'Storage', value: '2TB SSD' },
    ],
    ratings: {
      average: 4.82,
      count: 176,
    },
  },
  {
    id: 'prod-9',
    title: 'Solace X1 5G Flagship Smartphone',
    slug: 'solace-x1-5g-flagship-smartphone',
    sku: 'PHONE-SOLACE-X1',
    description:
      'A 6.7" LTPO AMOLED 120Hz display, triple 50MP camera array with optical zoom, all-day 5000mAh battery, and 45W fast charging in a titanium frame.',
    price: 999.0,
    compareAtPrice: 1099.0,
    currency: 'USD',
    stock: 54,
    isAvailable: true,
    category: {
      id: 'cat-3',
      name: 'Smartphones & Watches',
      slug: 'smartphones-watches',
    },
    tags: ['smartphone', '5g', 'amoled', 'fast-charging'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&q=80',
        alt: 'Solace X1 5G Flagship Smartphone front view',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Display', value: '6.7 Inch LTPO AMOLED' },
      { name: 'Storage', value: '256GB' },
      { name: 'Battery', value: '5000mAh' },
    ],
    ratings: {
      average: 4.88,
      count: 421,
    },
  },
  {
    id: 'prod-10',
    title: 'Orbit Fit Sport Smartwatch',
    slug: 'orbit-fit-sport-smartwatch',
    sku: 'WATCH-ORBIT-FIT',
    description:
      'Lightweight aluminum sport smartwatch with continuous SpO2 and heart-rate monitoring, built-in GPS, 10-day battery life, and 50m water resistance.',
    price: 249.0,
    compareAtPrice: 299.0,
    currency: 'USD',
    stock: 73,
    isAvailable: true,
    category: {
      id: 'cat-3',
      name: 'Smartphones & Watches',
      slug: 'smartphones-watches',
    },
    tags: ['smartwatch', 'fitness-tracker', 'gps', 'lightweight'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=800&q=80',
        alt: 'Orbit Fit Sport Smartwatch on wrist',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Case Material', value: 'Aluminum' },
      { name: 'Case Size', value: '44mm' },
      { name: 'Battery', value: 'Up to 10 Days' },
    ],
    ratings: {
      average: 4.6,
      count: 298,
    },
  },
  {
    id: 'prod-11',
    title: 'Nimbus VR2 Wireless Headset',
    slug: 'nimbus-vr2-wireless-headset',
    sku: 'GAME-NIMBUS-VR2',
    description:
      'Standalone wireless VR headset with dual 2.5K LCD panels, 120Hz refresh, inside-out 6DOF tracking, and precision haptic controllers for immersive gaming.',
    price: 549.0,
    compareAtPrice: 599.0,
    currency: 'USD',
    stock: 31,
    isAvailable: true,
    category: {
      id: 'cat-4',
      name: 'Gaming & VR',
      slug: 'gaming-vr',
    },
    tags: ['vr', 'wireless', 'gaming', '6dof'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1622979135225-d2ba269cf1ac?w=800&q=80',
        alt: 'Nimbus VR2 Wireless Headset with controllers',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'Display', value: 'Dual 2.5K LCD' },
      { name: 'Refresh Rate', value: '120Hz' },
      { name: 'Tracking', value: 'Inside-Out 6DOF' },
    ],
    ratings: {
      average: 4.7,
      count: 154,
    },
  },
  {
    id: 'prod-12',
    title: 'Apex Pro Wireless Gaming Mouse',
    slug: 'apex-pro-wireless-gaming-mouse',
    sku: 'GAME-APEX-MOUSE',
    description:
      'Ultra-lightweight 58g wireless gaming mouse with a 36,000 DPI optical sensor, 70-hour battery life, and zero-latency 8000Hz polling rate.',
    price: 129.99,
    compareAtPrice: 149.99,
    currency: 'USD',
    stock: 68,
    isAvailable: true,
    category: {
      id: 'cat-4',
      name: 'Gaming & VR',
      slug: 'gaming-vr',
    },
    tags: ['gaming', 'mouse', 'wireless', 'lightweight'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=800&q=80',
        alt: 'Apex Pro Wireless Gaming Mouse top view',
        isPrimary: true,
      },
    ],
    attributes: [
      { name: 'DPI', value: 'Up to 36,000' },
      { name: 'Weight', value: '58g' },
      { name: 'Polling Rate', value: '8000Hz' },
    ],
    ratings: {
      average: 4.85,
      count: 233,
    },
  },
]
