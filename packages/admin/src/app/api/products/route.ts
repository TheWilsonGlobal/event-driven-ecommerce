import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

export interface ProductRecord {
  id: string;
  title: string;
  slug: string;
  sku: string;
  description: string;
  price: number;
  compareAtPrice: number;
  currency: string;
  stock: number;
  isAvailable?: boolean;
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

const DEFAULT_PRODUCTS: ProductRecord[] = [
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
    description: 'Rugged titanium chassis with sapphire glass, dual-frequency GPS, 100m water resistance, ECG heart rate tracking, and 7-day battery life.',
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
    description: 'Compact ergonomic earbuds with adaptive transparency mode, wireless Qi charging case, IPX5 water resistance, and crystal clear 6-mic beamforming calls.',
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
    description: 'Hot-swappable linear optical switches, aircraft-grade aluminum frame, per-key RGB lighting, PBT double-shot keycaps, and detachable braided Type-C cable.',
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
    description: 'Crisp 4K UHD resolution with 144Hz refresh rate, 1ms response time, 99% DCI-P3 color gamut, HDR600, USB-C 90W Power Delivery, and ergonomic tilt/swivel stand.',
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
];

let inMemoryProducts: ProductRecord[] = [...DEFAULT_PRODUCTS];

function getProductsFilePath(): string {
  return path.resolve(process.cwd(), '../../data/products.json');
}

function loadProducts(): ProductRecord[] {
  try {
    const filePath = getProductsFilePath();
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error loading products from file, using in-memory fallback:', err);
  }
  return inMemoryProducts;
}

function saveProducts(products: ProductRecord[]): void {
  inMemoryProducts = products;
  try {
    const filePath = getProductsFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(products, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving products to file:', err);
  }
}

export async function GET() {
  const products = loadProducts();
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    total: products.length,
    products,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const products = loadProducts();

    const title = body.title || 'New Product';
    const slug = body.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const sku = body.sku || `SKU-${Date.now().toString().slice(-6)}`;

    const newProduct: ProductRecord = {
      id: `prod-${Date.now()}`,
      title,
      slug,
      sku,
      description: body.description || 'High quality product designed for modern workspaces.',
      price: parseFloat(body.price) || 99.99,
      compareAtPrice: parseFloat(body.compareAtPrice) || (parseFloat(body.price) || 99.99) * 1.2,
      currency: body.currency || 'USD',
      stock: parseInt(body.stock, 10) || 50,
      isAvailable: body.isAvailable !== undefined ? body.isAvailable : true,
      category: body.category || {
        id: 'cat-1',
        name: 'Audio & Headphones',
        slug: 'audio-headphones',
      },
      tags: body.tags || ['featured', 'new-arrival'],
      images: body.images || [
        {
          url: body.imageUrl || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80',
          alt: title,
          isPrimary: true,
        },
      ],
      attributes: body.attributes || [
        { name: 'Warranty', value: '2 Years' },
        { name: 'Color', value: 'Black' },
      ],
      ratings: {
        average: 5.0,
        count: 1,
      },
    };

    products.unshift(newProduct);
    saveProducts(products);

    return NextResponse.json({ success: true, product: newProduct }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body.id) {
      return NextResponse.json({ success: false, error: 'Product ID is required' }, { status: 400 });
    }

    const products = loadProducts();
    const index = products.findIndex((p) => p.id === body.id);
    if (index === -1) {
      return NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 });
    }

    products[index] = {
      ...products[index],
      ...body,
      price: body.price !== undefined ? parseFloat(body.price) : products[index].price,
      stock: body.stock !== undefined ? parseInt(body.stock, 10) : products[index].stock,
    };
    saveProducts(products);

    return NextResponse.json({ success: true, product: products[index] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'Product ID is required' }, { status: 400 });
    }

    let products = loadProducts();
    products = products.filter((p) => p.id !== id);
    saveProducts(products);

    return NextResponse.json({ success: true, message: `Product ${id} deleted` });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
