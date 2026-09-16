import { NextResponse } from 'next/server';

interface ServiceProbe {
  id: string;
  name: string;
  port: number;
  url: string;
  healthUrl: string;
  type: 'gateway' | 'service' | 'frontend' | 'monitoring';
  role: string;
}

const SERVICES: ServiceProbe[] = [
  {
    id: 'gateway',
    name: 'API Gateway',
    port: 3000,
    url: 'http://localhost:3000',
    healthUrl: 'http://localhost:3000/health',
    type: 'gateway',
    role: 'Perimeter Ingress, JWT Validation & Reverse Proxy',
  },
  {
    id: 'ms-user',
    name: 'User Service',
    port: 3001,
    url: 'http://localhost:3001',
    healthUrl: 'http://localhost:3001/health',
    type: 'service',
    role: 'Authentication, Roles & User Profiles',
  },
  {
    id: 'ms-product',
    name: 'Product Service',
    port: 3002,
    url: 'http://localhost:3002',
    healthUrl: 'http://localhost:3002/health',
    type: 'service',
    role: 'Product Catalog, Categories & Search Sync',
  },
  {
    id: 'ms-order',
    name: 'Order Service',
    port: 3003,
    url: 'http://localhost:3003',
    healthUrl: 'http://localhost:3003/health',
    type: 'service',
    role: 'Shopping Cart, Checkout Saga & Payment Processing',
  },
  {
    id: 'frontend',
    name: 'Frontend Web App',
    port: 3004,
    url: 'http://localhost:3004',
    healthUrl: 'http://localhost:3004',
    type: 'frontend',
    role: 'Next.js 14 SSR Customer Storefront',
  },
];

async function checkServiceHealth(svc: ServiceProbe) {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(svc.healthUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json, text/html' },
      cache: 'no-store',
    });
    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startTime;
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = { status: res.ok ? 'online' : 'error' };
    }

    return {
      ...svc,
      status: res.ok ? 'HEALTHY' : 'DEGRADED',
      statusCode: res.status,
      latencyMs,
      details: data,
      lastChecked: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      ...svc,
      status: 'OFFLINE',
      statusCode: 0,
      latencyMs: Date.now() - startTime,
      error: err.message || 'Connection refused / offline',
      lastChecked: new Date().toISOString(),
    };
  }
}

export async function GET() {
  const results = await Promise.all(SERVICES.map(checkServiceHealth));
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    totalServices: SERVICES.length,
    onlineCount: results.filter((r) => r.status === 'HEALTHY').length,
    services: results,
  });
}
