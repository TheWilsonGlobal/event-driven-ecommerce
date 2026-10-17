import type { FastifyInstance } from 'fastify'
import { assertPolicyCoverage } from '@ecommerce/shared-security'
import { SEED_PRODUCTS } from '@ecommerce/shared-database'
import { PNG, bearer, buildApp, multipartBody, VENDOR_A, VENDOR_B, type TestApp } from './testApp'
import { hasSearchTerm } from '../security'

const open: FastifyInstance[] = []
async function app(opts?: Parameters<typeof buildApp>[0]): Promise<TestApp> {
  const a = await buildApp(opts)
  open.push(a.server)
  return a
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()))
})

const validProduct = {
  title: 'Test Product',
  slug: 'test-product',
  sku: 'TEST-01',
  price: 19.99,
}

type Who = 'ANON' | 'CUSTOMER' | 'VENDOR' | 'ADMIN_AAL1' | 'ADMIN_AAL2'
const WHO: Who[] = ['ANON', 'CUSTOMER', 'VENDOR', 'ADMIN_AAL1', 'ADMIN_AAL2']

// [method, url, kind, expected statuses for ANON, CUSTOMER, VENDOR, ADMIN aal1, ADMIN aal2]
type Row = [string, string, 'json' | 'png' | 'none', number, number, number, number, number]
const MATRIX: Row[] = [
  ['GET', '/health', 'none', 200, 200, 200, 200, 200],
  ['GET', '/metrics', 'none', 200, 200, 200, 200, 200],
  ['GET', '/api/v1/products', 'none', 200, 200, 200, 200, 200],
  ['GET', '/api/v1/products?search=seed', 'none', 200, 200, 200, 200, 200],
  ['GET', '/api/v1/products/prod-a', 'none', 200, 200, 200, 200, 200],
  ['GET', '/api/v1/categories', 'none', 200, 200, 200, 200, 200],
  ['POST', '/api/v1/products', 'json', 401, 403, 201, 201, 201],
  // prod-admin has no owner: a VENDOR gets the same 404 as for a missing id
  ['PATCH', '/api/v1/products/prod-admin', 'json', 401, 403, 404, 200, 200],
  ['DELETE', '/api/v1/products/prod-admin', 'none', 401, 403, 404, 200, 200],
  ['POST', '/api/v1/products/upload', 'png', 401, 403, 201, 201, 201],
  ['POST', '/api/v1/receipts/upload', 'png', 401, 403, 201, 201, 201],
  // storage:read is held by ADMIN and VENDOR (not CUSTOMER) in rbac/roles.ts
  ['GET', '/api/v1/storage/health', 'none', 401, 403, 200, 200, 200],
  ['GET', '/api/v1/storage/objects', 'none', 401, 403, 200, 200, 200],
  ['GET', '/api/v1/storage/download?key=products/a.png', 'none', 401, 403, 302, 302, 302],
  [
    'GET',
    '/api/v1/storage/download?key=products/a.png&format=json',
    'none',
    401,
    403,
    200,
    200,
    200,
  ],
  [
    'GET',
    '/api/v1/storage/download?key=products/a.png&format=redirect',
    'none',
    401,
    403,
    302,
    302,
    302,
  ],
  // ops:read with mfa: an aal1 admin is refused. /queues answers 503 (no Redis in the test).
  ['GET', '/api/v1/queues', 'none', 401, 403, 403, 403, 503],
  ['GET', '/api/v1/logs', 'none', 401, 403, 403, 403, 200],
  ['GET', '/api/v1/schema', 'none', 401, 403, 403, 403, 200],
  ['GET', '/api/v1/endpoints', 'none', 401, 403, 403, 403, 200],
]

describe('ms-product policy matrix', () => {
  it.each(MATRIX)('%s %s', async (method, url, kind, ...expected) => {
    const a = await app()
    const t = await a.tokens()
    const got: number[] = []
    for (const who of WHO) {
      a.products.reset()
      const extra =
        kind === 'json'
          ? {
              payload: method === 'POST' ? validProduct : { title: 'Renamed' },
            }
          : kind === 'png'
            ? multipartBody([
                {
                  name: url.includes('receipts') ? 'receipt' : 'image',
                  filename: 'x.png',
                  type: 'image/png',
                  data: PNG,
                },
              ])
            : {}
      const res = await a.server.inject({
        method: method as 'GET',
        url,
        headers: { ...bearer(t[who]), ...(extra as { headers?: object }).headers },
        ...(extra.payload !== undefined ? { payload: extra.payload } : {}),
      })
      got.push(res.statusCode)
    }
    expect(got).toEqual(expected)
  })

  it('every route has a policy (default deny)', async () => {
    const a = await app()
    expect(() => assertPolicyCoverage(a.server)).not.toThrow()
    expect(a.server.routePolicies.length).toBeGreaterThan(15)
  })

  it('MFA_REQUIRED is reported for an aal1 admin on operator routes', async () => {
    const a = await app()
    const t = await a.tokens()
    const res = await a.server.inject({ url: '/api/v1/logs', headers: bearer(t.ADMIN_AAL1) })
    expect(res.json().code).toBe('MFA_REQUIRED')
  })

  it('report mode logs but does not block (rollout: unauthenticated admin UI keeps working)', async () => {
    const a = await app({ auth: 'report' })
    const res = await a.server.inject({
      method: 'POST',
      url: '/api/v1/products',
      payload: { ...validProduct, ratings: { average: 5, count: 1 } },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('vendor ownership', () => {
  const post = (a: TestApp, token: string | undefined, payload: object = validProduct) =>
    a.server.inject({ method: 'POST', url: '/api/v1/products', headers: bearer(token), payload })
  const patch = (a: TestApp, token: string | undefined, id: string) =>
    a.server.inject({
      method: 'PATCH',
      url: `/api/v1/products/${id}`,
      headers: bearer(token),
      payload: { title: 'Changed' },
    })
  const del = (a: TestApp, token: string | undefined, id: string) =>
    a.server.inject({ method: 'DELETE', url: `/api/v1/products/${id}`, headers: bearer(token) })

  it('a VENDOR becomes the owner of what they create; the owner is never published', async () => {
    const a = await app()
    const t = await a.tokens()
    const res = await post(a, t.VENDOR)
    expect(res.statusCode).toBe(201)
    expect(res.json().vendorId).toBeUndefined()
    const stored = a.products.docs.find((d) => d.id === res.json().id)
    expect(stored?.vendorId).toBe(VENDOR_A)
  })

  it('an ADMIN-created product has no owner', async () => {
    const a = await app()
    const t = await a.tokens()
    const res = await post(a, t.ADMIN_AAL1)
    expect(a.products.docs.find((d) => d.id === res.json().id)?.vendorId).toBeUndefined()
  })

  it('the owner can edit and delete; another vendor gets 404 and nothing changes', async () => {
    const a = await app()
    const t = await a.tokens()
    const other = await a.ta.sign({ sub: VENDOR_B, role: 'VENDOR' })

    const denied = await patch(a, other, 'prod-a')
    expect(denied.statusCode).toBe(404)
    const missing = await patch(a, other, 'prod-does-not-exist')
    expect(denied.json().code).toBe(missing.json().code) // indistinguishable
    expect((await del(a, other, 'prod-a')).statusCode).toBe(404)
    expect(a.products.docs.find((d) => d.id === 'prod-a')?.title).toBe('Seed prod-a')

    expect((await patch(a, t.VENDOR, 'prod-a')).statusCode).toBe(200)
    expect(a.products.docs.find((d) => d.id === 'prod-a')?.title).toBe('Changed')
    expect((await del(a, t.VENDOR, 'prod-a')).statusCode).toBe(200)
    expect(a.products.docs.some((d) => d.id === 'prod-a')).toBe(false)
  })

  it("an ADMIN can edit and delete any vendor's product", async () => {
    const a = await app()
    const t = await a.tokens()
    expect((await patch(a, t.ADMIN_AAL1, 'prod-b')).statusCode).toBe(200)
    expect((await del(a, t.ADMIN_AAL1, 'prod-b')).statusCode).toBe(200)
  })

  it('an unowned (seeded) product is ADMIN-only', async () => {
    const a = await app()
    const t = await a.tokens()
    expect((await patch(a, t.VENDOR, 'prod-admin')).statusCode).toBe(404)
    expect((await del(a, t.VENDOR, 'prod-admin')).statusCode).toBe(404)
    expect((await patch(a, t.ADMIN_AAL1, 'prod-admin')).statusCode).toBe(200)
  })

  it('ownership cannot be set or stolen through the body', async () => {
    const a = await app()
    const t = await a.tokens()
    expect((await post(a, t.VENDOR, { ...validProduct, vendorId: VENDOR_B })).statusCode).toBe(400)
    const res = await a.server.inject({
      method: 'PATCH',
      url: '/api/v1/products/prod-b',
      headers: bearer(await a.ta.sign({ sub: VENDOR_B, role: 'VENDOR' })),
      payload: { vendorId: VENDOR_A },
    })
    expect(res.statusCode).toBe(400)
  })

  it('only an ADMIN can set ratings', async () => {
    const a = await app()
    const t = await a.tokens()
    const body = { ...validProduct, ratings: { average: 5, count: 9999 } }
    expect((await post(a, t.VENDOR, body)).statusCode).toBe(403)
    expect((await post(a, t.ADMIN_AAL1, body)).statusCode).toBe(201)
  })
})

describe('validation of hostile and legitimate input', () => {
  const create = async (a: TestApp, payload: unknown, raw = false) => {
    const t = await a.tokens()
    return a.server.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { ...bearer(t.ADMIN_AAL1), ...(raw ? { 'content-type': 'application/json' } : {}) },
      payload: payload as never,
    })
  }

  it('accepts exactly what the admin SPA sends (including its float compareAtPrice and odd category id)', async () => {
    const a = await app()
    const res = await create(a, {
      title: 'Aura Pro',
      slug: 'aura-pro-',
      sku: 'AUDIO-AURA-01',
      price: 349.99,
      compareAtPrice: 419.988,
      currency: 'USD',
      stock: 50,
      isAvailable: true,
      description: 'd',
      category: {
        id: 'audio-&-headphones',
        name: 'Audio & Headphones',
        slug: 'audio-&-headphones',
      },
      tags: ['featured', 'catalog'],
      images: [
        { url: 'https://images.unsplash.com/photo-1?w=800&q=80', alt: 'Aura Pro', isPrimary: true },
      ],
      attributes: [{ name: 'Warranty', value: '2 Years' }],
      ratings: { average: 5.0, count: 1 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().compareAtPrice).toBe(419.99)
  })

  it('accepts every valid 2-decimal price (shared Money, multipleOfPrecision: 0.07, 19.99)', async () => {
    const a = await app()
    for (const price of [0.07, 0.29, 19.99, 33.33, 349.99, 1234.56, 0]) {
      expect((await create(a, { title: 't', price })).statusCode).toBe(201)
    }
  })

  const bad: [string, unknown][] = [
    ['unknown field', { title: 't', role: 'ADMIN' }],
    ['missing title', { price: 1 }],
    ['empty title', { title: '' }],
    ['title too long', { title: 'x'.repeat(201) }],
    ['price as a string', { title: 't', price: '5' }],
    ['negative price', { title: 't', price: -1 }],
    ['three decimals', { title: 't', price: 1.001 }],
    ['absurd price', { title: 't', price: 1e12 }],
    ['infinite price', '{"title":"t","price":1e999}'],
    ['fractional stock', { title: 't', stock: 1.5 }],
    ['negative stock', { title: 't', stock: -1 }],
    ['huge stock', { title: 't', stock: 1e9 }],
    ['slug with spaces/markup', { title: 't', slug: '<script>alert(1)</script>' }],
    ['uppercase slug', { title: 't', slug: 'Has-Caps' }],
    ['sku with spaces', { title: 't', sku: 'A B' }],
    ['lowercase currency', { title: 't', currency: 'usd' }],
    ['description too long', { title: 't', description: 'x'.repeat(5001) }],
    ['too many tags', { title: 't', tags: Array.from({ length: 31 }, (_, i) => `t${i}`) }],
    [
      'too many images',
      {
        title: 't',
        images: Array.from({ length: 21 }, () => ({
          url: 'https://e.co/a.png',
          alt: '',
          isPrimary: false,
        })),
      },
    ],
    [
      'javascript: image url',
      { title: 't', images: [{ url: 'javascript:alert(1)', alt: '', isPrimary: true }] },
    ],
    [
      'image with extra key',
      {
        title: 't',
        images: [{ url: 'https://e.co/a.png', alt: '', isPrimary: true, onerror: 'x' }],
      },
    ],
    ['rating above 5', { title: 't', ratings: { average: 6, count: 1 } }],
    [
      'category name too long',
      { title: 't', category: { id: 'a', name: 'x'.repeat(101), slug: 'a' } },
    ],
    ['id with traversal', { title: 't', id: '../x' }],
    ['body is an array', [{ title: 't' }]],
    ['body is null', 'null'],
    ['prototype key', '{"title":"t","__proto__":{"isAdmin":true}}'],
    ['constructor key', '{"title":"t","constructor":{"prototype":{"x":1}}}'],
  ]
  it.each(bad)('rejects: %s', async (_name, payload) => {
    const a = await app()
    const res = await create(a, payload, typeof payload === 'string')
    expect(res.statusCode).toBe(400)
    expect(a.products.docs).toHaveLength(3)
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
  })

  it('treats SQL/JSON-looking text as plain data', async () => {
    const a = await app()
    const title = `'; DROP TABLE products;-- {"$ne":null}`
    const res = await create(a, { title })
    expect(res.statusCode).toBe(201)
    expect(res.json().title).toBe(title)
  })

  it('rejects an oversized JSON body with 413 and a non-JSON content type with 415', async () => {
    const a = await app()
    expect((await create(a, { title: 't', description: 'x'.repeat(200 * 1024) })).statusCode).toBe(
      413
    )
    const t = await a.tokens()
    const res = await a.server.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { ...bearer(t.ADMIN_AAL1), 'content-type': 'text/plain' },
      payload: 'title=t',
    })
    expect(res.statusCode).toBe(415)
  })

  it('validation errors never echo the offending value', async () => {
    const a = await app()
    const res = await create(a, { title: 'ok', sku: 'SECRET VALUE' })
    expect(JSON.stringify(res.json())).not.toContain('SECRET')
  })

  it('PATCH needs at least one field and a sane id', async () => {
    const a = await app()
    const t = await a.tokens()
    const h = bearer(t.ADMIN_AAL1)
    expect(
      (
        await a.server.inject({
          method: 'PATCH',
          url: '/api/v1/products/prod-a',
          headers: h,
          payload: {},
        })
      ).statusCode
    ).toBe(400)
    expect(
      (
        await a.server.inject({
          method: 'PATCH',
          url: `/api/v1/products/${'x'.repeat(65)}`,
          headers: h,
          payload: { title: 't' },
        })
      ).statusCode
    ).toBe(400)
  })

  it('a duplicate client-supplied id is a 409, not a 500', async () => {
    const a = await app()
    expect((await create(a, { title: 't', id: 'prod-a' })).statusCode).toBe(409)
  })

  const badQueries = [
    'limit=1000',
    'limit=abc',
    'limit=0',
    'limit=-1',
    'page=0',
    'page=abc',
    'sort=passwordHash',
    'order=sideways',
    `search=${'x'.repeat(101)}`,
    `category=${'x'.repeat(101)}`,
    'unknown=1',
    'limit=1.5',
  ]
  it.each(badQueries)('list rejects ?%s', async (q) => {
    const a = await app()
    expect((await a.server.inject(`/api/v1/products?${q}`)).statusCode).toBe(400)
  })

  it('list sorts by an allow-listed field and paginates', async () => {
    const a = await app()
    a.products.docs[0]!.price = 30
    a.products.docs[1]!.price = 10
    a.products.docs[2]!.price = 20
    const res = await a.server.inject('/api/v1/products?sort=price&order=desc&limit=2&page=1')
    expect(res.json().products.map((p: { price: number }) => p.price)).toEqual([30, 20])
    expect(res.json()).toMatchObject({ total: 3, page: 1, limit: 2 })
  })
})

describe('closed responses', () => {
  it('serves seed documents unchanged but never an undeclared field', async () => {
    const a = await app()
    const seed = SEED_PRODUCTS[0]!
    a.products.docs.push({
      ...seed,
      passwordHash: 'leak',
      internalNote: 'x',
      vendorId: 'v',
    } as never)
    const res = await a.server.inject(`/api/v1/products/${seed.id}`)
    expect(res.json()).toEqual(seed)
    const list = await a.server.inject('/api/v1/products?limit=100')
    for (const p of list.json().products) {
      expect(p.passwordHash).toBeUndefined()
      expect(p.vendorId).toBeUndefined()
    }
  })
})

describe('search rate tier', () => {
  it('?search= is limited as expensive while the plain list stays in the read tier', async () => {
    const a = await app({ limits: { expensivePerMin: 2, userReadPerMin: 1000 } })
    const get = (u: string) => a.server.inject(u)
    expect((await get('/api/v1/products?search=seed')).statusCode).toBe(200)
    expect((await get('/api/v1/products?search=seed')).statusCode).toBe(200)
    expect((await get('/api/v1/products?search=seed')).statusCode).toBe(429)
    expect((await get('/api/v1/products')).statusCode).toBe(200)
    // an encoded parameter name cannot dodge the stricter tier
    expect((await get('/api/v1/products?s%65arch=seed')).statusCode).toBe(429)
  })

  it('hasSearchTerm ignores empty terms', () => {
    expect(hasSearchTerm('/p?search=')).toBe(false)
    expect(hasSearchTerm('/p?search=%20')).toBe(false)
    expect(hasSearchTerm('/p?search=a')).toBe(true)
    expect(hasSearchTerm('/p')).toBe(false)
  })
})

describe('write rate tier', () => {
  it('limits writes per user', async () => {
    const a = await app({ limits: { userWritePerMin: 2 } })
    const t = await a.tokens()
    const post = () =>
      a.server.inject({
        method: 'POST',
        url: '/api/v1/products',
        headers: bearer(t.ADMIN_AAL1),
        payload: validProduct,
      })
    expect((await post()).statusCode).toBe(201)
    expect((await post()).statusCode).toBe(201)
    expect((await post()).statusCode).toBe(429)
  })
})
