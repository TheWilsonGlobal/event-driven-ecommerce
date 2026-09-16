import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export interface OrderItemRecord {
  productId: string;
  sku: string;
  title: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  imageUrl?: string;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
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
  items: OrderItemRecord[];
  createdAt: string;
  updatedAt: string;
  receiptUrl?: string;
}

const DEFAULT_ORDERS: OrderRecord[] = [
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

let inMemoryOrders: OrderRecord[] = [...DEFAULT_ORDERS];

function getOrdersFilePath(): string {
  return path.resolve(process.cwd(), '../../data/orders.json');
}

function loadOrders(): OrderRecord[] {
  try {
    const filePath = getOrdersFilePath();
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error loading orders from file, using in-memory fallback:', err);
  }
  return inMemoryOrders;
}

function saveOrders(orders: OrderRecord[]): void {
  inMemoryOrders = orders;
  try {
    const filePath = getOrdersFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(orders, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving orders to file:', err);
  }
}

export async function GET() {
  const orders = loadOrders();
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    total: orders.length,
    orders,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orders = loadOrders();

    const orderNum = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const newOrder: OrderRecord = {
      id: `ord-${Date.now()}`,
      orderNumber: body.orderNumber || orderNum,
      customerId: body.customerId || 'user-customer-01',
      customerName: body.customerName || 'Alex Morgan',
      customerEmail: body.customerEmail || 'customer@ecommerce.com',
      status: body.status || 'CONFIRMED',
      subtotal: parseFloat(body.subtotal) || 349.99,
      taxAmount: parseFloat(body.taxAmount) || 28.0,
      shippingAmount: parseFloat(body.shippingAmount) || 0.0,
      discountAmount: parseFloat(body.discountAmount) || 0.0,
      totalAmount: parseFloat(body.totalAmount) || 377.99,
      currency: body.currency || 'USD',
      paymentMethod: body.paymentMethod || 'STRIPE',
      paymentStatus: body.paymentStatus || 'PAID',
      transactionId: body.transactionId || `ch_${Date.now()}`,
      shippingAddress: body.shippingAddress || {
        addressLine1: '742 Evergreen Terrace',
        city: 'Springfield',
        state: 'OR',
        postalCode: '97477',
        country: 'United States',
      },
      items: body.items || [],
      receiptUrl: `http://localhost:9000/ecommerce-uploads/receipts/${orderNum}.pdf`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    orders.unshift(newOrder);
    saveOrders(orders);

    return NextResponse.json({ success: true, order: newOrder }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body.id) {
      return NextResponse.json({ success: false, error: 'Order ID is required' }, { status: 400 });
    }

    const orders = loadOrders();
    const index = orders.findIndex((o) => o.id === body.id);
    if (index === -1) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    orders[index] = {
      ...orders[index],
      ...body,
      updatedAt: new Date().toISOString(),
    };
    saveOrders(orders);

    return NextResponse.json({ success: true, order: orders[index] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'Order ID is required' }, { status: 400 });
    }

    let orders = loadOrders();
    orders = orders.filter((o) => o.id !== id);
    saveOrders(orders);

    return NextResponse.json({ success: true, message: `Order ${id} deleted` });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
