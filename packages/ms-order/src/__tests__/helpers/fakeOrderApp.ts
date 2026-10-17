import * as os from 'os'
import fastify, { type FastifyInstance } from 'fastify'
import {
  MemoryRateStore,
  createTestAuth,
  securityServerOptions,
  type EnforceMode,
  type TestAuth,
} from '@ecommerce/shared-security'
import {
  createRouteRegistry,
  registerEndpointsRoute,
  registerMetrics,
} from '@ecommerce/shared-utils'
import type { loadDatabaseConfig } from '@ecommerce/shared-database'
import type { OutboxRelay } from '@ecommerce/shared-messaging'
import { RedisUnavailableError } from '../../queues/errors'
import { registerServiceRoutes } from '../../routes'
import { registerOrderSecurity } from '../../security'
import type { PriceVerifier } from '../../pricing/PriceVerifier'
import type { PrismaClient } from '../../../node_modules/.prisma-ms-order/client'
import type { QueueManager } from '../../queues'

/**
 * An in-memory stand-in for the slice of Prisma that ms-order's HTTP routes
 * touch. It lets the security tests drive the REAL route handlers, policy hook,
 * rate limiter and validator without a database, so they run everywhere and can
 * never write into a real ms_order schema.
 */

export interface FakeOrder {
  id: string
  orderNumber: string
  idempotencyKey: string | null
  userId: string
  customerName: string
  customerEmail: string
  status: string
  subtotal: number
  taxAmount: number
  shippingAmount: number
  discountAmount: number
  totalAmount: number
  currency: string
  shippingAddress: string
  billingAddress: string
  createdAt: Date
  updatedAt: Date
  items: {
    productId: string
    productSku: string
    productTitle: string
    unitPrice: number
    quantity: number
    totalPrice: number
  }[]
  payments: {
    id: string
    provider: string
    transactionId: string
    paymentMethod: string
    amount: number
    currency: string
    status: string
    createdAt: Date
  }[]
}

let seq = 0

export function makeOrder(userId: string, over: Partial<FakeOrder> = {}): FakeOrder {
  seq += 1
  const now = new Date(Date.UTC(2026, 9, 17, 12, 0, seq))
  return {
    id: `order-${seq}`,
    orderNumber: `ORD-${100000 + seq}`,
    idempotencyKey: null,
    userId,
    customerName: 'Pat',
    customerEmail: 'pat@example.com',
    status: 'PENDING',
    subtotal: 20,
    taxAmount: 0,
    shippingAmount: 0,
    discountAmount: 0,
    totalAmount: 20,
    currency: 'USD',
    shippingAddress: JSON.stringify({
      addressLine1: '1 Main St',
      city: 'Town',
      state: 'CA',
      postalCode: '90210',
      country: 'US',
    }),
    billingAddress: '{}',
    createdAt: now,
    updatedAt: now,
    items: [
      {
        productId: 'p1',
        productSku: 'S1',
        productTitle: 'Thing',
        unitPrice: 10,
        quantity: 2,
        totalPrice: 20,
      },
    ],
    payments: [
      {
        id: `pay-${seq}`,
        provider: 'stripe',
        transactionId: `ch_${seq}`,
        paymentMethod: 'STRIPE',
        amount: 20,
        currency: 'USD',
        status: 'PENDING',
        createdAt: now,
      },
    ],
    ...over,
  }
}

export class FakePrisma {
  orders: FakeOrder[] = []
  outbox: { eventType: string }[] = []

  private match(where: Record<string, unknown> | undefined) {
    return (o: FakeOrder) =>
      !where ||
      Object.entries(where).every(([k, v]) => (o as unknown as Record<string, unknown>)[k] === v)
  }

  order = {
    findMany: async (a: { where?: Record<string, unknown>; skip?: number; take?: number }) =>
      this.orders
        .filter(this.match(a.where))
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
        .slice(a.skip ?? 0, (a.skip ?? 0) + (a.take ?? 1000)),
    count: async (a?: { where?: Record<string, unknown> }) =>
      this.orders.filter(this.match(a?.where)).length,
    findUnique: async (a: { where: Record<string, unknown> }) =>
      this.orders.find(this.match(a.where)) ?? null,
    create: async (a: { data: Record<string, unknown> }) => {
      const d = a.data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
      const base = makeOrder(d.userId, {
        orderNumber: d.orderNumber,
        idempotencyKey: d.idempotencyKey ?? null,
        status: d.status,
        subtotal: d.subtotal,
        totalAmount: d.totalAmount,
        taxAmount: d.taxAmount,
        shippingAmount: d.shippingAmount,
        discountAmount: d.discountAmount,
        currency: d.currency,
        customerName: d.customerName,
        customerEmail: d.customerEmail,
        shippingAddress: d.shippingAddress,
        items: d.items.create,
        payments: d.payments.create.map((p: Record<string, unknown>, i: number) => ({
          ...p,
          id: `pay-new-${i}`,
          createdAt: new Date(),
        })),
      })
      this.orders.push(base)
      return base
    },
    update: async (a: { where: { id: string }; data: Partial<FakeOrder> }) => {
      const o = this.orders.find((x) => x.id === a.where.id)
      if (!o) throw Object.assign(new Error('not found'), { code: 'P2025' })
      Object.assign(o, a.data)
      return o
    },
  }

  payment = {
    findUnique: async (a: { where: { id: string } }) =>
      this.orders.flatMap((o) => o.payments).find((p) => p.id === a.where.id) ?? null,
    update: async (a: { where: { id: string }; data: { status: string } }) => {
      const p = this.orders.flatMap((o) => o.payments).find((x) => x.id === a.where.id)
      if (p) p.status = a.data.status
      return p
    },
  }

  outboxEvent = {
    create: async (a: { data: { eventType: string } }) => {
      this.outbox.push({ eventType: a.data.eventType })
    },
  }

  $queryRaw = async () => []

  $transaction = async <T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> => fn(this)
}

export const SERVICE_SECRET = 'unit-test-internal-secret-0123456789'

const stubQueues = {
  tryEnqueue: async () => 'job-1',
  enqueueSendConfirmation: async () => undefined,
  enqueueSendReceipt: async () => undefined,
  checkRedis: async () => new RedisUnavailableError('redis_unavailable', 'stub'),
  checkKeyspace: async () => new RedisUnavailableError('redis_unavailable', 'stub'),
  keyValueInfo: () => ({
    label: 'stub',
    dataPath: null,
    inMemory: true,
    loadError: null,
    backend: 'embedded',
  }),
  queuesAvailable: false,
  keyspaceInspector: { backend: 'embedded' },
} as unknown as QueueManager

const stubRelay = {
  stats: async () => ({
    enabled: false,
    running: false,
    workerId: 'w',
    counts: { pending: 0, processing: 0, sent: 0, failed: 0 },
    oldestPendingAgeMs: null,
    sinceStart: { sent: 0, failedAttempts: 0, lastError: null, lastTickAt: null },
  }),
  requeueFailed: async () => 0,
} as unknown as OutboxRelay

const dbConfigStub = {
  mode: 'test',
  relational: { driver: 'stub' },
  keyValue: { driver: 'embedded' },
} as unknown as ReturnType<typeof loadDatabaseConfig>

export interface BuildOptions {
  auth?: EnforceMode
  rate?: EnforceMode
  limits?: Partial<{ userWritePerMin: number; userReadPerMin: number; ipPerMin: number }>
  priceVerifier?: PriceVerifier
  prisma?: FakePrisma
  ta: TestAuth
}

export async function buildOrderApp(
  opts: BuildOptions
): Promise<{ server: FastifyInstance; prisma: FakePrisma }> {
  const prisma = opts.prisma ?? new FakePrisma()
  const server = fastify({ ...securityServerOptions({}), logger: false })

  await registerOrderSecurity(server, {
    redis: null,
    overrides: {
      jwks: opts.ta.jwks,
      store: new MemoryRateStore(),
      config: {
        authMode: opts.auth ?? 'enforce',
        rateLimitMode: opts.rate ?? 'enforce',
        issuer: opts.ta.issuer,
        audience: opts.ta.audience,
        serviceAuthSecret: SERVICE_SECRET,
        limits: {
          ipPerMin: 100_000,
          authIpPerMin: 100_000,
          authEmailPerMin: 100_000,
          userReadPerMin: 100_000,
          userWritePerMin: 100_000,
          expensivePerMin: 100_000,
          adminPerMin: 100_000,
          ...(opts.limits ?? {}),
        },
      },
    },
  })

  // Same infrastructure routes index.ts adds, so the policy stamping is tested.
  registerMetrics(server, { service: 'ms-order-test', collectDefaults: false })
  const registry = createRouteRegistry(server)

  registerServiceRoutes(server, {
    prisma: prisma as unknown as PrismaClient,
    queueManager: stubQueues,
    ...(opts.priceVerifier ? { priceVerifier: opts.priceVerifier } : {}),
    outboxRelay: stubRelay,
    dbConfig: dbConfigStub,
    // Never the real repo root: PATCH /events/config writes <root>/.env.
    repoRoot: os.tmpdir(),
  })
  registerEndpointsRoute(server, registry, 'ms-order')

  await server.ready()
  return { server, prisma }
}

export { createTestAuth }
