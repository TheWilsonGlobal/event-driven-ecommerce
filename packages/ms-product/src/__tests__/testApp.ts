import fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import {
  MemoryRateStore,
  createTestAuth,
  registerSecurity,
  securityServerOptions,
  type TestAuth,
} from '@ecommerce/shared-security'
import {
  createRouteRegistry,
  registerEndpointsRoute,
  registerMetrics,
} from '@ecommerce/shared-utils'
import type { DocumentDatabaseAdapter } from '@ecommerce/shared-database'
import { registerSchemaRoutes, registerLogRoutes } from '../diagnostics'
import {
  registerHealthRoutes,
  registerStorageRoutes,
  registerProductRoutes,
  registerCategoryRoutes,
  registerUploadRoutes,
} from '../routes'
import { QueueManager, registerQueueRoutes } from '../queues'
import { MULTIPART_LIMITS } from '../routes/uploads'
import { applySharedRoutePolicies, searchConstraint } from '../security'
import type { CategoryDoc, ProductDoc } from '../types'
import { ProductCache, type CacheRedis, type CacheResult } from '../cache/productCache'

/** Equality-only in-memory stand-in for the Postgres/NeDB document store. */
export class MemoryStore<T extends { id?: string }> implements DocumentDatabaseAdapter<T> {
  docs: T[] = []
  /** findOne calls, and an artificial latency so concurrent requests overlap. */
  findOneCalls = 0
  findOneDelayMs = 0
  constructor(private readonly seed: () => T[]) {
    this.reset()
  }
  reset(): void {
    this.docs = this.seed().map((d) => structuredClone(d))
  }
  private match(q: Record<string, unknown>) {
    return (d: T) => Object.entries(q).every(([k, v]) => (d as Record<string, unknown>)[k] === v)
  }
  async findOne(q: Record<string, unknown>) {
    this.findOneCalls += 1
    if (this.findOneDelayMs) await new Promise((r) => setTimeout(r, this.findOneDelayMs))
    const d = this.docs.find(this.match(q))
    return d ? structuredClone(d) : null
  }
  async find(q: Record<string, unknown>) {
    return this.docs.filter(this.match(q)).map((d) => structuredClone(d))
  }
  async insert(doc: T) {
    this.docs.push(structuredClone(doc))
    return structuredClone(doc)
  }
  async update(q: Record<string, unknown>, patch: Partial<T>) {
    const hits = this.docs.filter(this.match(q))
    hits.forEach((d) => Object.assign(d, patch))
    return hits.length
  }
  async delete(q: Record<string, unknown>) {
    const before = this.docs.length
    this.docs = this.docs.filter((d) => !this.match(q)(d))
    return before - this.docs.length
  }
}

export const product = (over: Partial<ProductDoc> & { id: string }): ProductDoc => ({
  title: `Seed ${over.id}`,
  slug: `seed-${over.id}`,
  sku: `SKU-${over.id}`,
  description: 'A seeded product',
  price: 10,
  compareAtPrice: 12,
  currency: 'USD',
  stock: 5,
  isAvailable: true,
  category: { id: 'cat-1', name: 'Audio', slug: 'audio' },
  tags: ['a'],
  images: [{ url: 'https://example.com/a.png', alt: 'a', isPrimary: true }],
  attributes: [],
  ratings: { average: 4, count: 2 },
  ...over,
})

/** Test-only HS256 key for service-to-service tokens (not a real secret). */
export const TEST_SERVICE_SECRET = 'unit-test-service-secret-0123456789abcdef'
export const VENDOR_A = 'vendor-a'
export const VENDOR_B = 'vendor-b'

export const fixtures = (): ProductDoc[] => [
  product({ id: 'prod-admin' }), // no vendorId: ADMIN-only
  product({ id: 'prod-a', vendorId: VENDOR_A }),
  product({ id: 'prod-b', vendorId: VENDOR_B }),
]

export const roomy = {
  ipPerMin: 100_000,
  authIpPerMin: 100_000,
  authEmailPerMin: 100_000,
  userReadPerMin: 100_000,
  userWritePerMin: 100_000,
  expensivePerMin: 100_000,
  adminPerMin: 100_000,
}

export interface TestApp {
  server: FastifyInstance
  ta: TestAuth
  products: MemoryStore<ProductDoc>
  uploads: { key: string; type: string; size: number }[]
  signedKeys: string[]
  listPrefixes: (string | undefined)[]
  cache: ProductCache<ProductDoc>
  cacheResults: Record<CacheResult, number>
  tokens: () => Promise<
    Record<'ANON' | 'CUSTOMER' | 'VENDOR' | 'ADMIN_AAL1' | 'ADMIN_AAL2', string | undefined>
  >
}

export async function buildApp(
  opts: {
    auth?: 'report' | 'enforce'
    limits?: Partial<typeof roomy>
    /** Redis stand-in for the product cache; null/absent = no Redis. */
    redis?: CacheRedis | null
  } = {}
): Promise<TestApp> {
  const ta = await createTestAuth()
  const products = new MemoryStore<ProductDoc>(fixtures)
  const categories = new MemoryStore<CategoryDoc>(() => [
    { id: 'cat-1', name: 'Audio', slug: 'audio', icon: 'x', description: 'd', productCount: 1 },
  ])
  const uploads: TestApp['uploads'] = []
  const signedKeys: string[] = []
  const listPrefixes: (string | undefined)[] = []

  const server = fastify({
    ...securityServerOptions({}),
    constraints: { hasSearch: searchConstraint },
    logger: false,
  })
  const registry = createRouteRegistry(server)
  applySharedRoutePolicies(server)
  await registerSecurity(server, {
    service: 'ms-product',
    overrides: {
      jwks: ta.jwks,
      store: new MemoryRateStore(),
      config: {
        authMode: opts.auth ?? 'enforce',
        rateLimitMode: 'enforce',
        issuer: ta.issuer,
        audience: ta.audience,
        production: false,
        serviceAuthSecret: TEST_SERVICE_SECRET,
        limits: { ...roomy, ...(opts.limits ?? {}) },
      },
    },
  })
  registerMetrics(server, { service: 'ms-product' })
  await server.register(multipart, { limits: MULTIPART_LIMITS })

  const search = {
    searchProductIds: async () => null,
    indexProduct: async () => undefined,
    removeProduct: async () => undefined,
    ping: async () => ({ reachable: false }),
    isEnabled: () => false,
    nodeUrl: 'http://localhost:9200',
    indexName: 'test',
  }
  const rustfs = {
    uploadObject: async (key: string, buf: Buffer, type = '') => {
      uploads.push({ key, type, size: buf.byteLength })
      return { key, url: `http://storage.test/bucket/${key}` }
    },
    getSignedDownloadUrl: async (key: string) => {
      signedKeys.push(key)
      return `http://storage.test/signed/${key}`
    },
    // Deliberately ignores the prefix, so the route's own filter is what is tested.
    listObjects: async (prefix?: string) => {
      listPrefixes.push(prefix)
      return [
        { key: 'products/a.png', sizeBytes: 1, lastModified: new Date().toISOString() },
        { key: 'receipts/r.pdf', sizeBytes: 2, lastModified: new Date().toISOString() },
      ]
    },
    healthCheck: async () => ({ healthy: true, latencyMs: 1, endpoint: 'http://storage.test' }),
  }
  const queueManager = new QueueManager(false)
  const cacheResults: Record<CacheResult, number> = { hit: 0, miss: 0, coalesced: 0, bypass: 0 }
  const cache = new ProductCache<ProductDoc>({
    redis: opts.redis ?? null,
    counter: { inc: ({ result }) => void (cacheResults[result] += 1) },
  })

  registerHealthRoutes(server, {
    dbConfig: { mode: 'embedded', document: { driver: 'nedb' } } as never,
    search: search as never,
  })
  registerStorageRoutes(server, { rustfs: rustfs as never })
  registerProductRoutes(server, {
    productsStore: products,
    search: search as never,
    queueManager,
    cache,
  })
  registerCategoryRoutes(server, { categoriesStore: categories })
  registerUploadRoutes(server, { rustfs: rustfs as never })
  registerQueueRoutes(server, queueManager)
  registerSchemaRoutes(
    server,
    [
      {
        name: 'products',
        store: products as unknown as DocumentDatabaseAdapter<Record<string, unknown>>,
      },
    ],
    'test'
  )
  registerLogRoutes(server)
  registerEndpointsRoute(server, registry, 'ms-product')
  await server.ready()

  return {
    server,
    ta,
    products,
    uploads,
    signedKeys,
    listPrefixes,
    cache,
    cacheResults,
    tokens: async () => ({
      ANON: undefined,
      CUSTOMER: await ta.sign({ sub: 'cust-1', role: 'CUSTOMER' }),
      VENDOR: await ta.sign({ sub: VENDOR_A, role: 'VENDOR' }),
      ADMIN_AAL1: await ta.sign({ sub: 'admin-1', role: 'ADMIN', aal: 'aal1' }),
      ADMIN_AAL2: await ta.sign({ sub: 'admin-1', role: 'ADMIN', aal: 'aal2' }),
    }),
  }
}

export const bearer = (t: string | undefined): Record<string, string> =>
  t ? { authorization: `Bearer ${t}` } : {}

/** Hand-rolled multipart/form-data body. */
export function multipartBody(
  parts: { name: string; filename?: string; type?: string; data: Buffer | string }[]
) {
  const boundary = `----testboundary${Math.random().toString(16).slice(2)}`
  const chunks: Buffer[] = []
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`
    if (p.filename !== undefined) head += `; filename="${p.filename}"`
    head += '\r\n'
    if (p.type) head += `Content-Type: ${p.type}\r\n`
    chunks.push(Buffer.from(`${head}\r\n`), Buffer.from(p.data), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
])
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])
export const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)])
export const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(16),
])
export const PDF = Buffer.from('%PDF-1.7\n%%EOF\n')
