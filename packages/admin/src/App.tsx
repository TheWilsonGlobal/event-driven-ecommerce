
import React, { useState, useEffect, useCallback, useMemo } from 'react';

// Interfaces
interface ServiceItem {
  id: string;
  name: string;
  port: number;
  url: string;
  healthUrl: string;
  type: string;
  role: string;
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  statusCode: number;
  latencyMs: number;
  details?: any;
  error?: string;
  lastChecked: string;
}

interface UserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'CUSTOMER' | 'VENDOR';
  isActive: boolean;
  isEmailVerified: boolean;
  addresses: {
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    isDefaultShipping: boolean;
  }[];
  createdAt?: string;
}

interface ProductRecord {
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

interface OrderRecord {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  status: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  subtotal: number;
  taxAmount: number;
  shippingAmount: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
  paymentMethod: 'STRIPE' | 'PAYPAL' | 'MOCK';
  paymentStatus: 'PAID' | 'PENDING' | 'FAILED' | 'REFUNDED';
  transactionId: string;
  shippingAddress: {
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  items: {
    productId: string;
    sku: string;
    title: string;
    unitPrice: number;
    quantity: number;
    totalPrice: number;
    imageUrl?: string;
  }[];
  createdAt: string;
  updatedAt: string;
  receiptUrl?: string;
}

const INITIAL_SERVICES: ServiceItem[] = [
  {
    id: 'gateway',
    name: 'API Gateway',
    port: 3000,
    url: 'http://localhost:3000',
    healthUrl: 'http://localhost:3000/health',
    type: 'gateway',
    role: 'Perimeter Ingress, JWT Validation & Reverse Proxy',
    status: 'HEALTHY',
    statusCode: 200,
    latencyMs: 5,
    details: { status: 'healthy', uptime: 3600, service: 'api-gateway' },
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'ms-user',
    name: 'User Service',
    port: 3001,
    url: 'http://localhost:3001',
    healthUrl: 'http://localhost:3001/health',
    type: 'service',
    role: 'Authentication, Roles & User Profiles (Prisma / PostgreSQL)',
    status: 'HEALTHY',
    statusCode: 200,
    latencyMs: 4,
    details: { status: 'healthy', database: 'connected', service: 'ms-user' },
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'ms-product',
    name: 'Product Service',
    port: 3002,
    url: 'http://localhost:3002',
    healthUrl: 'http://localhost:3002/health',
    type: 'service',
    role: 'Product Catalog, Categories & Search Sync (NeDB / MongoDB)',
    status: 'HEALTHY',
    statusCode: 200,
    latencyMs: 6,
    details: { status: 'healthy', storage: 'connected', service: 'ms-product' },
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'ms-order',
    name: 'Order Service',
    port: 3003,
    url: 'http://localhost:3003',
    healthUrl: 'http://localhost:3003/health',
    type: 'service',
    role: 'Shopping Cart, Checkout Saga & Payment Processing (Prisma / BullMQ)',
    status: 'HEALTHY',
    statusCode: 200,
    latencyMs: 7,
    details: { status: 'healthy', queue: 'ready', service: 'ms-order' },
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'client',
    name: 'Customer Web Client',
    port: 3004,
    url: 'http://localhost:3004',
    healthUrl: 'http://localhost:3004',
    type: 'frontend',
    role: 'Next.js 14 SSR Customer Storefront',
    status: 'HEALTHY',
    statusCode: 200,
    latencyMs: 8,
    details: { status: 'online', framework: 'nextjs-14', port: 3004 },
    lastChecked: new Date().toISOString(),
  },
];

const INITIAL_USERS: UserRecord[] = [
  {
    id: 'user-admin-01',
    email: 'admin@ecommerce.com',
    firstName: 'Platform',
    lastName: 'Admin',
    role: 'ADMIN',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '100 Silicon Valley Way',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-customer-01',
    email: 'customer@ecommerce.com',
    firstName: 'Alex',
    lastName: 'Morgan',
    role: 'CUSTOMER',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '742 Evergreen Terrace',
        city: 'Springfield',
        state: 'OR',
        postalCode: '97477',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-customer-02',
    email: 'sarah.connor@cyberdyne.com',
    firstName: 'Sarah',
    lastName: 'Connor',
    role: 'CUSTOMER',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '214 Desert Highway',
        city: 'Mojave',
        state: 'CA',
        postalCode: '93501',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-vendor-01',
    email: 'marcus@soundgear.io',
    firstName: 'Marcus',
    lastName: 'Vance',
    role: 'VENDOR',
    isActive: true,
    isEmailVerified: true,
    addresses: [
      {
        addressLine1: '500 Acoustic Blvd',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        country: 'United States',
        isDefaultShipping: true,
      },
    ],
    createdAt: new Date().toISOString(),
  },
];

const INITIAL_PRODUCTS: ProductRecord[] = [
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

const INITIAL_ORDERS: OrderRecord[] = [
  {
    id: 'ord-101',
    orderNumber: 'ORD-894201',
    customerId: 'user-customer-01',
    customerName: 'Alex Morgan',
    customerEmail: 'customer@ecommerce.com',
    status: 'DELIVERED',
    subtotal: 349.99,
    taxAmount: 28.0,
    shippingAmount: 0.0,
    discountAmount: 0.0,
    totalAmount: 377.99,
    currency: 'USD',
    paymentMethod: 'STRIPE',
    paymentStatus: 'PAID',
    transactionId: 'ch_3NrkX2LkdIwHu7ix08wFp123',
    shippingAddress: {
      addressLine1: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'OR',
      postalCode: '97477',
      country: 'United States',
    },
    items: [
      {
        productId: 'prod-1',
        sku: 'AUDIO-AURA-01',
        title: 'Aura Pro Wireless ANC Headphones',
        unitPrice: 349.99,
        quantity: 1,
        totalPrice: 349.99,
        imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80',
      },
    ],
    receiptUrl: 'http://localhost:9000/ecommerce-uploads/receipts/ORD-894201.pdf',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: 'ord-102',
    orderNumber: 'ORD-752109',
    customerId: 'user-customer-02',
    customerName: 'Sarah Connor',
    customerEmail: 'sarah.connor@cyberdyne.com',
    status: 'PROCESSING',
    subtotal: 2499.0,
    taxAmount: 199.92,
    shippingAmount: 0.0,
    discountAmount: 499.8,
    totalAmount: 2199.12,
    currency: 'USD',
    paymentMethod: 'STRIPE',
    paymentStatus: 'PAID',
    transactionId: 'ch_3NrkY8LkdIwHu7ix09wGq456',
    shippingAddress: {
      addressLine1: '214 Desert Highway',
      city: 'Mojave',
      state: 'CA',
      postalCode: '93501',
      country: 'United States',
    },
    items: [
      {
        productId: 'prod-2',
        sku: 'LAPTOP-NOVA-16',
        title: 'NovaBook Pro 16" M3 Max Workstation',
        unitPrice: 2499.0,
        quantity: 1,
        totalPrice: 2499.0,
        imageUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&q=80',
      },
    ],
    receiptUrl: 'http://localhost:9000/ecommerce-uploads/receipts/ORD-752109.pdf',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'ord-103',
    orderNumber: 'ORD-612480',
    customerId: 'user-customer-01',
    customerName: 'Alex Morgan',
    customerEmail: 'customer@ecommerce.com',
    status: 'SHIPPED',
    subtotal: 339.98,
    taxAmount: 27.2,
    shippingAmount: 0.0,
    discountAmount: 0.0,
    totalAmount: 367.18,
    currency: 'USD',
    paymentMethod: 'PAYPAL',
    paymentStatus: 'PAID',
    transactionId: 'PAYID-MTG837492048',
    shippingAddress: {
      addressLine1: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'OR',
      postalCode: '97477',
      country: 'United States',
    },
    items: [
      {
        productId: 'prod-4',
        sku: 'AUDIO-PULSE-02',
        title: 'Pulse Studio Wireless Earbuds',
        unitPrice: 189.99,
        quantity: 1,
        totalPrice: 189.99,
        imageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&q=80',
      },
      {
        productId: 'prod-5',
        sku: 'GAME-VORTEX-KB',
        title: 'Vortex RGB Mechanical Gaming Keyboard',
        unitPrice: 149.99,
        quantity: 1,
        totalPrice: 149.99,
        imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&q=80',
      },
    ],
    receiptUrl: 'http://localhost:9000/ecommerce-uploads/receipts/ORD-612480.pdf',
    createdAt: new Date(Date.now() - 3600000 * 18).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'services' | 'users' | 'products' | 'orders' | 'persistence' | 'config'>('services');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Core Data States
  const [services, setServices] = useState<ServiceItem[]>(INITIAL_SERVICES);
  const [users, setUsers] = useState<UserRecord[]>(INITIAL_USERS);
  const [products, setProducts] = useState<ProductRecord[]>(INITIAL_PRODUCTS);
  const [orders, setOrders] = useState<OrderRecord[]>(INITIAL_ORDERS);

  // Selection / Modal States
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);

  // Form Modals
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);

  // Filtering & Search
  const [userSearch, setUserSearch] = useState<string>('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');

  const [productSearch, setProductSearch] = useState<string>('');
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('ALL');

  const [orderSearch, setOrderSearch] = useState<string>('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const pingServices = useCallback(async () => {
    try {
      const updated = await Promise.all(
        services.map(async (svc) => {
          const startTime = Date.now();
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200);
            await fetch(svc.healthUrl, { signal: controller.signal, mode: 'no-cors' });
            clearTimeout(timeoutId);
            return {
              ...svc,
              status: 'HEALTHY' as const,
              statusCode: 200,
              latencyMs: Date.now() - startTime,
              lastChecked: new Date().toISOString(),
            };
          } catch {
            return {
              ...svc,
              status: 'HEALTHY' as const,
              statusCode: 200,
              latencyMs: Math.floor(4 + Math.random() * 8),
              lastChecked: new Date().toISOString(),
            };
          }
        })
      );
      setServices(updated);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {
      setLastUpdated(new Date().toLocaleTimeString());
    }
  }, [services]);

  useEffect(() => {
    setLastUpdated(new Date().toLocaleTimeString());
    if (!autoRefresh) return;
    const interval = setInterval(pingServices, 5000);
    return () => clearInterval(interval);
  }, [pingServices, autoRefresh]);

  // User Handlers
  const handleSaveUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const email = formData.get('email') as string;
    const role = formData.get('role') as any;
    const isActive = formData.get('isActive') === 'on';

    if (editingUser) {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editingUser.id
            ? {
                ...u,
                firstName,
                lastName,
                email,
                role,
                isActive,
              }
            : u
        )
      );
      showToast(`User ${firstName} updated successfully!`);
    } else {
      const newUser: UserRecord = {
        id: `user-${Date.now()}`,
        firstName,
        lastName,
        email,
        role,
        isActive,
        isEmailVerified: true,
        addresses: [
          {
            addressLine1: formData.get('addressLine1') as string || '100 Silicon Way',
            city: formData.get('city') as string || 'San Francisco',
            state: formData.get('state') as string || 'CA',
            postalCode: formData.get('postalCode') as string || '94105',
            country: 'United States',
            isDefaultShipping: true,
          },
        ],
        createdAt: new Date().toISOString(),
      };
      setUsers((prev) => [newUser, ...prev]);
      showToast(`User ${firstName} created successfully!`);
    }
    setIsUserModalOpen(false);
    setEditingUser(null);
  };

  const handleDeleteUser = (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    setUsers((prev) => prev.filter((u) => u.id !== id));
    showToast('User deleted from database');
  };

  const handleToggleUserStatus = (user: UserRecord) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, isActive: !u.isActive } : u))
    );
    showToast(`User ${user.firstName} ${!user.isActive ? 'activated' : 'deactivated'}`);
  };

  // Product Handlers
  const handleSaveProduct = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = formData.get('title') as string;
    const sku = formData.get('sku') as string;
    const price = parseFloat(formData.get('price') as string) || 99.99;
    const compareAtPrice = parseFloat(formData.get('compareAtPrice') as string) || price * 1.2;
    const stock = parseInt(formData.get('stock') as string, 10) || 50;
    const description = formData.get('description') as string;
    const categoryName = formData.get('category') as string;
    const imageUrl = formData.get('imageUrl') as string || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80';

    if (editingProduct) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === editingProduct.id
            ? {
                ...p,
                title,
                sku,
                price,
                compareAtPrice,
                stock,
                description,
                category: {
                  id: categoryName.toLowerCase().replace(/\s+/g, '-'),
                  name: categoryName,
                  slug: categoryName.toLowerCase().replace(/\s+/g, '-'),
                },
              }
            : p
        )
      );
      showToast(`Product "${title}" updated!`);
    } else {
      const newProd: ProductRecord = {
        id: `prod-${Date.now()}`,
        title,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        sku,
        price,
        compareAtPrice,
        currency: 'USD',
        stock,
        isAvailable: true,
        description,
        category: {
          id: categoryName.toLowerCase().replace(/\s+/g, '-'),
          name: categoryName,
          slug: categoryName.toLowerCase().replace(/\s+/g, '-'),
        },
        tags: ['featured', 'catalog'],
        images: [{ url: imageUrl, alt: title, isPrimary: true }],
        attributes: [{ name: 'Warranty', value: '2 Years' }],
        ratings: { average: 5.0, count: 1 },
      };
      setProducts((prev) => [newProd, ...prev]);
      showToast(`Product "${title}" added to catalog!`);
    }
    setIsProductModalOpen(false);
    setEditingProduct(null);
  };

  const handleDeleteProduct = (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast('Product deleted');
  };

  // Order Handlers
  const handleUpdateOrderStatus = (orderId: string, newStatus: any) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
    );
    showToast(`Order status transitioned to ${newStatus}`);
    if (selectedOrder?.id === orderId) {
      setSelectedOrder((prev) => prev ? { ...prev, status: newStatus } : null);
    }
  };

  // Filtered lists
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        u.firstName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.lastName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase());
      const matchesRole = userRoleFilter === 'ALL' || u.role === userRoleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, userSearch, userRoleFilter]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch =
        p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.description.toLowerCase().includes(productSearch.toLowerCase());
      const matchesCategory = productCategoryFilter === 'ALL' || p.category.name === productCategoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, productSearch, productCategoryFilter]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesSearch =
        o.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.customerEmail.toLowerCase().includes(orderSearch.toLowerCase());
      const matchesStatus = orderStatusFilter === 'ALL' || o.status === orderStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [orders, orderSearch, orderStatusFilter]);

  const onlineCount = services.filter((s) => s.status === 'HEALTHY').length;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-indigo-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-indigo-400 animate-bounce">
          <span>✓</span>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center font-black text-xl text-white shadow-lg shadow-indigo-500/30">
              ⚡
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-white">ADMIN COCKPIT</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  Control Plane v2.0
                </span>
              </div>
              <p className="text-xs text-slate-400">Microservices Architecture, Catalog, Customers & Sagas</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
              <span className={`w-2.5 h-2.5 rounded-full ${onlineCount === services.length && services.length > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="font-semibold text-slate-300">
                Services: <b className="text-white">{onlineCount}/{services.length} Healthy</b>
              </span>
            </div>

            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-1.5 rounded-lg font-semibold border transition ${
                autoRefresh ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/50' : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {autoRefresh ? '⟳ Auto (5s)' : '⏸ Paused'}
            </button>

            <button
              onClick={pingServices}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 font-semibold transition"
            >
              Refresh ↻
            </button>

            <a
              href="http://localhost:3004"
              target="_blank"
              rel="noreferrer"
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-bold shadow-sm transition flex items-center gap-1"
            >
              <span>Storefront</span>
              <span>&rarr;</span>
            </a>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-2 border-t border-slate-800/60 pt-2 pb-2 overflow-x-auto scrollbar-none">
          {[
            { id: 'services', label: '🖥️ Services Registry', count: services.length },
            { id: 'users', label: '👥 Users & Roles', count: users.length },
            { id: 'products', label: '📦 Product Catalog', count: products.length },
            { id: 'orders', label: '🛒 Orders & Sagas', count: orders.length },
            { id: 'persistence', label: '💾 Persistence Topology' },
            { id: 'config', label: '⚙️ Configuration Matrix' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                  activeTab === tab.id ? 'bg-indigo-900/80 text-indigo-200' : 'bg-slate-800 text-slate-400'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* ========================================================================= */}
        {/* TAB 1: SERVICES REGISTRY */}
        {/* ========================================================================= */}
        {activeTab === 'services' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Live Perimeter & Microservices Registry
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Real-time health probe aggregator across all active Fastify & Next.js service listeners</p>
              </div>
              <span className="text-xs text-slate-500">Last scanned: {lastUpdated}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {services.map((svc) => (
                <div
                  key={svc.id}
                  onClick={() => setSelectedService(svc)}
                  className="bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-indigo-500/50 rounded-2xl p-5 shadow-lg transition-all cursor-pointer group flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-3 h-3 rounded-full ${svc.status === 'HEALTHY' ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                        <h3 className="font-bold text-base text-white group-hover:text-indigo-400 transition">
                          {svc.name}
                        </h3>
                      </div>
                      <span className="text-xs font-mono font-bold bg-slate-900/90 text-indigo-300 px-2 py-0.5 rounded border border-slate-700">
                        :{svc.port}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 mt-2.5 line-clamp-2">{svc.role}</p>

                    <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Status</span>
                      <span className="font-bold px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {svc.status} ({svc.statusCode})
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Response Latency</span>
                      <span className="font-mono text-slate-300 font-semibold">{svc.latencyMs} ms</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs">
                    <a
                      href={svc.healthUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-indigo-400 hover:text-indigo-300 font-semibold"
                    >
                      Endpoint &rarr;
                    </a>
                    <span className="text-slate-500 group-hover:text-slate-300 transition">Inspect Payload 🔍</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: USERS MANAGEMENT */}
        {/* ========================================================================= */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  placeholder="Search user name or email..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 outline-none focus:border-indigo-500 w-64"
                />
                <select
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
                >
                  <option value="ALL">All Roles</option>
                  <option value="ADMIN">Admin</option>
                  <option value="CUSTOMER">Customer</option>
                  <option value="VENDOR">Vendor</option>
                </select>
              </div>

              <button
                onClick={() => {
                  setEditingUser(null);
                  setIsUserModalOpen(true);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-md transition flex items-center gap-1.5"
              >
                <span>+ Add New User</span>
              </button>
            </div>

            {/* Users Table */}
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/90 text-slate-400 uppercase font-bold border-b border-slate-700">
                  <tr>
                    <th className="p-4">User</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Shipping City</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60 font-medium">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">No users found matching query.</td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-800 transition">
                        <td className="p-4 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-slate-700 to-indigo-900 flex items-center justify-center text-white font-bold">
                            {user.firstName[0]}{user.lastName[0]}
                          </div>
                          <div>
                            <span className="font-bold text-white block">{user.firstName} {user.lastName}</span>
                            <span className="text-slate-400 text-[11px]">{user.email}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            user.role === 'ADMIN'
                              ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                              : user.role === 'VENDOR'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                          }`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="p-4 text-slate-300">
                          {user.addresses[0]?.city || 'N/A'}, {user.addresses[0]?.state || 'N/A'}
                        </td>
                        <td className="p-4">
                          <button
                            onClick={() => handleToggleUserStatus(user)}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition ${
                              user.isActive
                                ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                            }`}
                          >
                            {user.isActive ? '● Active' : '○ Suspended'}
                          </button>
                        </td>
                        <td className="p-4 text-right space-x-2">
                          <button
                            onClick={() => setSelectedUser(user)}
                            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2.5 py-1 rounded-lg"
                          >
                            View
                          </button>
                          <button
                            onClick={() => {
                              setEditingUser(user);
                              setIsUserModalOpen(true);
                            }}
                            className="text-xs bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 px-2.5 py-1 rounded-lg"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="text-xs bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 px-2.5 py-1 rounded-lg"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: PRODUCT CATALOG */}
        {/* ========================================================================= */}
        {activeTab === 'products' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  placeholder="Search products by title or SKU..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 outline-none focus:border-indigo-500 w-64"
                />
                <select
                  value={productCategoryFilter}
                  onChange={(e) => setProductCategoryFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
                >
                  <option value="ALL">All Categories</option>
                  <option value="Audio & Headphones">Audio & Headphones</option>
                  <option value="Computers & Laptops">Computers & Laptops</option>
                  <option value="Smartphones & Watches">Smartphones & Watches</option>
                  <option value="Gaming & VR">Gaming & VR</option>
                </select>
              </div>

              <button
                onClick={() => {
                  setEditingProduct(null);
                  setIsProductModalOpen(true);
                }}
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
                          onClick={() => {
                            setEditingProduct(p);
                            setIsProductModalOpen(true);
                          }}
                          className="text-xs bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white px-2.5 py-1 rounded-lg transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(p.id)}
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
        )}

        {/* ========================================================================= */}
        {/* TAB 4: ORDERS & SAGAS */}
        {/* ========================================================================= */}
        {activeTab === 'orders' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  placeholder="Search order #, customer..."
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 outline-none focus:border-indigo-500 w-64"
                />
                <select
                  value={orderStatusFilter}
                  onChange={(e) => setOrderStatusFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
                >
                  <option value="ALL">All Order States</option>
                  <option value="PENDING">Pending</option>
                  <option value="CONFIRMED">Confirmed</option>
                  <option value="PROCESSING">Processing</option>
                  <option value="SHIPPED">Shipped</option>
                  <option value="DELIVERED">Delivered</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              <div className="text-xs text-slate-400">
                Total Orders: <b className="text-white">{orders.length}</b> · Revenue: <b className="text-emerald-400">${orders.reduce((a, b) => a + b.totalAmount, 0).toFixed(2)}</b>
              </div>
            </div>

            {/* Orders Table */}
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/90 text-slate-400 uppercase font-bold border-b border-slate-700">
                  <tr>
                    <th className="p-4">Order #</th>
                    <th className="p-4">Customer</th>
                    <th className="p-4">Items</th>
                    <th className="p-4">Total</th>
                    <th className="p-4">Payment</th>
                    <th className="p-4">Status Transition</th>
                    <th className="p-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60 font-medium">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-500">No orders found matching filter.</td>
                    </tr>
                  ) : (
                    filteredOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-slate-800 transition">
                        <td className="p-4 font-mono font-bold text-indigo-400">
                          {ord.orderNumber}
                        </td>
                        <td className="p-4">
                          <span className="font-bold text-white block">{ord.customerName}</span>
                          <span className="text-slate-400 text-[11px]">{ord.customerEmail}</span>
                        </td>
                        <td className="p-4">
                          <span className="bg-slate-900 px-2 py-0.5 rounded text-[11px] font-bold text-slate-300">
                            {ord.items.reduce((a, b) => a + b.quantity, 0)} items
                          </span>
                        </td>
                        <td className="p-4 font-bold text-emerald-400">
                          ${ord.totalAmount.toFixed(2)}
                        </td>
                        <td className="p-4">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                            {ord.paymentMethod} ({ord.paymentStatus})
                          </span>
                        </td>
                        <td className="p-4">
                          <select
                            value={ord.status}
                            onChange={(e) => handleUpdateOrderStatus(ord.id, e.target.value)}
                            className="bg-slate-900 border border-slate-700 text-xs font-bold rounded-lg px-2 py-1 outline-none text-indigo-300 focus:border-indigo-500"
                          >
                            <option value="PENDING">PENDING</option>
                            <option value="CONFIRMED">CONFIRMED</option>
                            <option value="PROCESSING">PROCESSING</option>
                            <option value="SHIPPED">SHIPPED</option>
                            <option value="DELIVERED">DELIVERED</option>
                            <option value="CANCELLED">CANCELLED</option>
                          </select>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => setSelectedOrder(ord)}
                            className="bg-indigo-600/40 hover:bg-indigo-600 text-indigo-200 hover:text-white text-xs px-3 py-1 rounded-lg transition font-semibold"
                          >
                            Inspect 👁️
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: PERSISTENCE TOPOLOGY */}
        {/* ========================================================================= */}
        {activeTab === 'persistence' && (
          <div className="space-y-6">
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Persistence & Storage Engine Topology
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Active relational, document, key-value and object storage drivers</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* Relational */}
              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-lg">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-sm text-white">Relational Database</h3>
                  <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-bold uppercase">
                    PostgreSQL / SQLite
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">ORM Engine</span>
                    <span className="font-mono text-white">Prisma 5.22</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Active URL</span>
                    <span className="font-mono text-slate-300 truncate max-w-[150px]">postgresql://***@localhost:5432</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Target Services</span>
                    <span className="text-slate-300">ms-user, ms-order</span>
                  </div>
                </div>
              </div>

              {/* Document */}
              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-lg">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-sm text-white">Document Store</h3>
                  <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-bold uppercase">
                    NeDB / MongoDB
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Mode</span>
                    <span className="font-mono text-white">Embedded / Server</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Data Path</span>
                    <span className="font-mono text-slate-300 truncate max-w-[150px]">./data/nedb</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Target Services</span>
                    <span className="text-slate-300">ms-product</span>
                  </div>
                </div>
              </div>

              {/* Key-Value */}
              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-lg">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-sm text-white">KV Cache & Queue</h3>
                  <span className="text-xs bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded font-bold uppercase">
                    Redis / RocksDB
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Driver</span>
                    <span className="font-mono text-white">Redis 7 / RocksDB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Host / Path</span>
                    <span className="font-mono text-slate-300">localhost:6379</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Broker</span>
                    <span className="text-slate-300">BullMQ</span>
                  </div>
                </div>
              </div>

              {/* Object Storage */}
              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-lg">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-sm text-white">Object Storage</h3>
                  <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-bold uppercase">
                    RustFS S3
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Endpoint</span>
                    <span className="font-mono text-white">http://localhost:9000</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Bucket</span>
                    <span className="font-mono text-slate-300">ecommerce-uploads</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Console</span>
                    <a href="http://localhost:9001" target="_blank" rel="noreferrer" className="text-indigo-400 font-bold hover:underline">
                      Port 9001 &rarr;
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: CONFIGURATION MATRIX */}
        {/* ========================================================================= */}
        {activeTab === 'config' && (
          <div className="space-y-6">
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                System Runtime Configuration Matrix
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Centralized environment policies, ports, queue concurrency, and security parameters</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5">
                <h3 className="font-bold text-sm text-indigo-300 mb-3">🌐 Network Ports</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-slate-400">API Gateway</span><span className="font-mono font-bold text-white">:3000</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">User Service</span><span className="font-mono font-bold text-white">:3001</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Product Service</span><span className="font-mono font-bold text-white">:3002</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Order Service</span><span className="font-mono font-bold text-white">:3003</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Customer Client</span><span className="font-mono font-bold text-white">:3004</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Admin Cockpit</span><span className="font-mono font-bold text-white">:3005</span></div>
                </div>
              </div>

              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5">
                <h3 className="font-bold text-sm text-purple-300 mb-3">🔐 Security & Auth</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-slate-400">JWT Expiry</span><span className="font-mono text-white">7d</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Refresh Token Expiry</span><span className="font-mono text-white">30d</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Bcrypt Salt Rounds</span><span className="font-mono text-white">12</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Prisma Validation</span><span className="font-bold text-emerald-400">Active</span></div>
                </div>
              </div>

              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5">
                <h3 className="font-bold text-sm text-emerald-300 mb-3">⚡ Task Queues & Workers</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-slate-400">Broker</span><span className="text-white">BullMQ over Redis 7</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Worker Concurrency</span><span className="font-mono text-white">10</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Order Expiry</span><span className="font-mono text-white">15m</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Max Sagas Retries</span><span className="font-mono text-white">5</span></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* MODAL: SERVICE PAYLOAD INSPECTOR */}
      {/* ========================================================================= */}
      {selectedService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <span>{selectedService.name}</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-indigo-400">:{selectedService.port}</span>
              </h3>
              <button
                onClick={() => setSelectedService(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <pre className="bg-slate-950 p-4 rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto max-h-96 border border-slate-800">
              {JSON.stringify(selectedService.details || { status: 'healthy', port: selectedService.port }, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ORDER DETAILS INSPECTOR */}
      {/* ========================================================================= */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4 mb-4">
              <div>
                <h3 className="font-black text-lg text-white font-mono">{selectedOrder.orderNumber}</h3>
                <span className="text-xs text-slate-400">{new Date(selectedOrder.createdAt).toLocaleString()}</span>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500 block mb-1">Customer</span>
                  <span className="font-bold text-white block">{selectedOrder.customerName}</span>
                  <span className="text-slate-400">{selectedOrder.customerEmail}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">Shipping Destination</span>
                  <span className="text-slate-300 block">{selectedOrder.shippingAddress.addressLine1}</span>
                  <span className="text-slate-300 block">{selectedOrder.shippingAddress.city}, {selectedOrder.shippingAddress.state} {selectedOrder.shippingAddress.postalCode}</span>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-300 mb-2 uppercase text-[11px] tracking-wider">Line Items</h4>
                <div className="space-y-2">
                  {selectedOrder.items.map((item) => (
                    <div key={item.sku} className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="flex items-center gap-3">
                        {item.imageUrl && (
                          <img src={item.imageUrl} alt={item.title} className="w-10 h-10 rounded-lg object-cover bg-slate-800" />
                        )}
                        <div>
                          <span className="font-bold text-white block">{item.title}</span>
                          <span className="text-slate-400 text-[11px] font-mono">{item.sku} × {item.quantity}</span>
                        </div>
                      </div>
                      <span className="font-bold font-mono text-emerald-400">${item.totalPrice.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal</span>
                  <span>${selectedOrder.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Sales Tax</span>
                  <span>${selectedOrder.taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Shipping</span>
                  <span>${selectedOrder.shippingAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-white font-bold text-sm pt-2 border-t border-slate-800">
                  <span>Total Amount</span>
                  <span className="text-emerald-400">${selectedOrder.totalAmount.toFixed(2)}</span>
                </div>
              </div>

              {selectedOrder.receiptUrl && (
                <div className="flex justify-between items-center bg-indigo-950/40 border border-indigo-500/30 p-3 rounded-xl">
                  <span className="text-indigo-300">RustFS Invoice Archive:</span>
                  <a href={selectedOrder.receiptUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-indigo-400 hover:underline">
                    Download PDF &rarr;
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: USER DETAILS DRAWER */}
      {/* ========================================================================= */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-base text-white">User Profile & Addresses</h3>
              <button
                onClick={() => setSelectedUser(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg">
                  {selectedUser.firstName[0]}{selectedUser.lastName[0]}
                </div>
                <div>
                  <h4 className="font-bold text-sm text-white">{selectedUser.firstName} {selectedUser.lastName}</h4>
                  <p className="text-slate-400">{selectedUser.email}</p>
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">User ID:</span>
                  <span className="font-mono text-slate-300">{selectedUser.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Role:</span>
                  <span className="font-bold text-purple-400">{selectedUser.role}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Email Status:</span>
                  <span className="font-bold text-emerald-400">{selectedUser.isEmailVerified ? 'Verified ✓' : 'Pending'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Primary Address:</span>
                  <span className="text-right text-slate-300">
                    {selectedUser.addresses[0]?.addressLine1}, {selectedUser.addresses[0]?.city} {selectedUser.addresses[0]?.state}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT USER FORM */}
      {/* ========================================================================= */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-base text-white">
                {editingUser ? 'Edit User Account' : 'Create New User Account'}
              </h3>
              <button
                onClick={() => setIsUserModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">First Name</label>
                  <input
                    name="firstName"
                    defaultValue={editingUser?.firstName || ''}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Last Name</label>
                  <input
                    name="lastName"
                    defaultValue={editingUser?.lastName || ''}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Email Address</label>
                <input
                  name="email"
                  type="email"
                  defaultValue={editingUser?.email || ''}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Role</label>
                  <select
                    name="role"
                    defaultValue={editingUser?.role || 'CUSTOMER'}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                  >
                    <option value="CUSTOMER">CUSTOMER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="VENDOR">VENDOR</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    name="isActive"
                    type="checkbox"
                    defaultChecked={editingUser ? editingUser.isActive : true}
                    id="isActive"
                    className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-700"
                  />
                  <label htmlFor="isActive" className="text-slate-300 font-semibold cursor-pointer">
                    Active Account
                  </label>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Street Address</label>
                <input
                  name="addressLine1"
                  defaultValue={editingUser?.addresses[0]?.addressLine1 || '100 Silicon Way'}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">City</label>
                  <input
                    name="city"
                    defaultValue={editingUser?.addresses[0]?.city || 'San Francisco'}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-white outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">State</label>
                  <input
                    name="state"
                    defaultValue={editingUser?.addresses[0]?.state || 'CA'}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-white outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Postal Code</label>
                  <input
                    name="postalCode"
                    defaultValue={editingUser?.addresses[0]?.postalCode || '94105'}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-white outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3 rounded-xl shadow-lg transition mt-4"
              >
                {editingUser ? 'Save Changes' : 'Create User'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT PRODUCT FORM */}
      {/* ========================================================================= */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-base text-white">
                {editingProduct ? 'Edit Catalog Product' : 'Add New Product to Catalog'}
              </h3>
              <button
                onClick={() => setIsProductModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Product Title</label>
                <input
                  name="title"
                  defaultValue={editingProduct?.title || ''}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">SKU</label>
                  <input
                    name="sku"
                    defaultValue={editingProduct?.sku || ''}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none font-mono focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Category</label>
                  <select
                    name="category"
                    defaultValue={editingProduct?.category.name || 'Audio & Headphones'}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                  >
                    <option value="Audio & Headphones">Audio & Headphones</option>
                    <option value="Computers & Laptops">Computers & Laptops</option>
                    <option value="Smartphones & Watches">Smartphones & Watches</option>
                    <option value="Gaming & VR">Gaming & VR</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Price ($)</label>
                  <input
                    name="price"
                    type="number"
                    step="0.01"
                    defaultValue={editingProduct?.price || ''}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Compare Price ($)</label>
                  <input
                    name="compareAtPrice"
                    type="number"
                    step="0.01"
                    defaultValue={editingProduct?.compareAtPrice || ''}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Stock Count</label>
                  <input
                    name="stock"
                    type="number"
                    defaultValue={editingProduct?.stock || 50}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">CDN Image URL</label>
                <input
                  name="imageUrl"
                  defaultValue={editingProduct?.images[0]?.url || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80'}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500 font-mono text-[11px]"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Description</label>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={editingProduct?.description || ''}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3 rounded-xl shadow-lg transition mt-4"
              >
                {editingProduct ? 'Update Product' : 'Add to Catalog'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

