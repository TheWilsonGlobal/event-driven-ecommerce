import type { FastifyInstance } from 'fastify'
import {
  TokenVerifier,
  assertPolicyCoverage,
  describePolicies,
  signServiceToken,
  type TestAuth,
} from '@ecommerce/shared-security'
import { ProductClient, createProductClientFromEnv } from '../pricing/ProductClient'
import type { PriceVerifier } from '../pricing/PriceVerifier'
import {
  FakePrisma,
  SERVICE_SECRET,
  buildOrderApp,
  createTestAuth,
  makeOrder,
} from './helpers/fakeOrderApp'

/**
 * API-defense tests for ms-order: the policy matrix per role, object-level
 * authorization (BOLA), body hardening, server-side price verification and rate
 * limiting. Everything runs the real handlers and the real security plugin in
 * enforce mode, against an in-memory Prisma stand-in (no database is touched).
 */

let ta: TestAuth
beforeAll(async () => {
  ta = await createTestAuth()
})

const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

type Who = 'ANON' | 'CUSTOMER' | 'VENDOR' | 'ADMIN1' | 'ADMIN2' | 'SERVICE'
const WHO: Who[] = ['ANON', 'CUSTOMER', 'VENDOR', 'ADMIN1', 'ADMIN2', 'SERVICE']

async function headersFor(who: Who): Promise<Record<string, string>> {
  switch (who) {
    case 'ANON':
      return {}
    case 'CUSTOMER':
      return bearer(await ta.sign({ sub: 'cust-a', role: 'CUSTOMER' }))
    case 'VENDOR':
      return bearer(await ta.sign({ sub: 'vend-a', role: 'VENDOR' }))
    case 'ADMIN1':
      return bearer(await ta.sign({ sub: 'adm-a', role: 'ADMIN', aal: 'aal1' }))
    case 'ADMIN2':
      return bearer(await ta.sign({ sub: 'adm-a', role: 'ADMIN', aal: 'aal2' }))
    case 'SERVICE':
      return bearer(await signServiceToken(SERVICE_SECRET, 'ms-test'))
  }
}

const ORDER_BODY = {
  customerName: 'Pat Doe',
  customerEmail: 'pat@example.com',
  items: [{ productId: 'p1', sku: 'S1', title: 'Thing', unitPrice: 10, quantity: 2 }],
  shippingAddress: {
    addressLine1: '1 Main St',
    city: 'Town',
    state: 'CA',
    postalCode: '90210',
    country: 'US',
  },
  paymentMethod: 'STRIPE',
  subtotal: 20,
  taxAmount: 0,
  shippingAmount: 0,
  discountAmount: 0,
  totalAmount: 20,
  currency: 'USD',
}

describe('policy matrix (role x route)', () => {
  let server: FastifyInstance
  let target: { id: string }

  beforeAll(async () => {
    const prisma = new FakePrisma()
    // Owned by nobody in the matrix, so object-level 404s never mask a 401/403.
    const o = makeOrder('someone-else')
    prisma.orders.push(o)
    target = o
    ;({ server } = await buildOrderApp({ ta, prisma }))
  })
  afterAll(async () => server.close())

  type Row = {
    method: 'GET' | 'POST' | 'PATCH'
    url: () => string
    payload?: unknown
    /** Roles the POLICY lets through; everyone else must be refused. */
    allow: Who[]
    /** Expected refusal for a role that is not allowed but has an identity. */
    mfaFor?: Who[]
  }

  const AUTHENTICATED: Who[] = ['CUSTOMER', 'VENDOR', 'ADMIN1', 'ADMIN2', 'SERVICE']
  const USERS: Who[] = ['CUSTOMER', 'VENDOR', 'ADMIN1', 'ADMIN2']
  const OPS: Who[] = ['ADMIN2']

  const rows: [string, Row][] = [
    ['GET /health', { method: 'GET', url: () => '/health', allow: WHO }],
    ['GET /metrics', { method: 'GET', url: () => '/metrics', allow: WHO }],
    ['GET /api/v1/orders', { method: 'GET', url: () => '/api/v1/orders', allow: AUTHENTICATED }],
    [
      'GET /api/v1/orders/:id',
      { method: 'GET', url: () => `/api/v1/orders/${target.id}`, allow: AUTHENTICATED },
    ],
    [
      'POST /api/v1/orders',
      { method: 'POST', url: () => '/api/v1/orders', payload: ORDER_BODY, allow: USERS },
    ],
    [
      'PATCH /api/v1/orders/:id',
      {
        method: 'PATCH',
        url: () => `/api/v1/orders/${target.id}`,
        payload: { status: 'CANCELLED' },
        allow: USERS,
      },
    ],
    [
      'POST /api/v1/payments/:orderId/capture',
      {
        method: 'POST',
        url: () => `/api/v1/payments/${target.id}/capture`,
        payload: {},
        allow: USERS,
      },
    ],
    [
      'POST /api/v1/orders/:id/saga-failure',
      {
        method: 'POST',
        url: () => `/api/v1/orders/${target.id}/saga-failure`,
        payload: { step: 'reserve-inventory', compensation: 'release-inventory' },
        allow: ['ADMIN2', 'SERVICE'],
        mfaFor: ['ADMIN1'],
      },
    ],
    ['GET /api/v1/cart', { method: 'GET', url: () => '/api/v1/cart', allow: AUTHENTICATED }],
    ...[
      '/api/v1/queues',
      '/api/v1/cache/namespaces',
      '/api/v1/cache/keys',
      '/api/v1/cache/driver',
      '/api/v1/events',
      '/api/v1/outbox',
      '/api/v1/logs',
      '/api/v1/logs/nope.log',
      '/api/v1/schema',
      '/api/v1/endpoints',
    ].map((url): [string, Row] => [
      `GET ${url}`,
      { method: 'GET', url: () => url, allow: OPS, mfaFor: ['ADMIN1'] },
    ]),
    [
      'POST /api/v1/outbox/requeue',
      {
        method: 'POST',
        url: () => '/api/v1/outbox/requeue',
        payload: {},
        allow: OPS,
        mfaFor: ['ADMIN1'],
      },
    ],
    [
      // An invalid body for the one role that is let through: the policy answer
      // is visible as a 400 while the handler (which writes the repo .env) never runs.
      'PATCH /api/v1/events/config',
      {
        method: 'PATCH',
        url: () => '/api/v1/events/config',
        payload: { enabled: 'not-a-boolean' },
        allow: OPS,
        mfaFor: ['ADMIN1'],
      },
    ],
  ]

  const cases = rows.flatMap(([name, row]) => WHO.map((who) => [name, who, row] as const))

  it.each(cases)('%s as %s', async (_name, who, row) => {
    const res = await server.inject({
      method: row.method,
      url: row.url(),
      headers: await headersFor(who),
      ...(row.payload !== undefined ? { payload: row.payload as object } : {}),
    })
    if (row.allow.includes(who)) {
      expect([401, 403, 429]).not.toContain(res.statusCode)
    } else if (who === 'ANON') {
      expect(res.statusCode).toBe(401)
    } else if (row.mfaFor?.includes(who)) {
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('MFA_REQUIRED')
    } else {
      expect(res.statusCode).toBe(403)
    }
  })

  it('every registered route carries a policy (default deny)', () => {
    expect(() => assertPolicyCoverage(server)).not.toThrow()
    expect(describePolicies(server).length).toBeGreaterThan(15)
  })

  it('a route nobody listed in the matrix cannot hide: every policied route is covered above', () => {
    const covered = new Set(rows.map(([name]) => name.replace(/:[a-zA-Z]+/g, ':p')))
    const missing = describePolicies(server)
      .filter((r) => !r.url.startsWith('/api-docs') && !r.url.startsWith('/documentation'))
      .map((r) => `${r.method} ${r.url}`.replace(/:[a-zA-Z]+/g, ':p'))
      .filter((k) => !covered.has(k) && !covered.has(k.replace(/:p$/, 'nope.log')))
    expect(missing).toEqual([])
  })

  it('a bad or forged token is a 401, never an anonymous pass', async () => {
    for (const token of [
      await ta.sign({ expiresInSec: -120 }),
      await ta.signForged({ role: 'ADMIN' }),
    ]) {
      const res = await server.inject({ url: '/api/v1/orders', headers: bearer(token) })
      expect(res.statusCode).toBe(401)
    }
  })

  it('identity headers are never trusted', async () => {
    const res = await server.inject({
      url: '/api/v1/orders',
      headers: { 'x-user-id': 'cust-a', 'x-user-role': 'ADMIN' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('object-level authorization (BOLA)', () => {
  let server: FastifyInstance
  let prisma: FakePrisma
  let orderA: ReturnType<typeof makeOrder>
  let orderB: ReturnType<typeof makeOrder>
  let A: Record<string, string>
  let B: Record<string, string>
  let ADMIN: Record<string, string>
  let SERVICE: Record<string, string>

  beforeEach(async () => {
    prisma = new FakePrisma()
    orderA = makeOrder('cust-a')
    orderB = makeOrder('cust-b')
    prisma.orders.push(orderA, orderB)
    ;({ server } = await buildOrderApp({ ta, prisma }))
    A = bearer(await ta.sign({ sub: 'cust-a', role: 'CUSTOMER' }))
    B = bearer(await ta.sign({ sub: 'cust-b', role: 'CUSTOMER' }))
    ADMIN = bearer(await ta.sign({ sub: 'adm', role: 'ADMIN', aal: 'aal2' }))
    SERVICE = await headersFor('SERVICE')
  })
  afterEach(async () => server.close())

  it('a customer reads their own order and gets 404 (not 403) for another customer', async () => {
    expect(
      (await server.inject({ url: `/api/v1/orders/${orderA.id}`, headers: A })).statusCode
    ).toBe(200)
    const other = await server.inject({ url: `/api/v1/orders/${orderB.id}`, headers: A })
    expect(other.statusCode).toBe(404)
    expect(other.json().code).toBe('NOT_FOUND')
    // Same answer for an id that does not exist: ids cannot be probed.
    const missing = await server.inject({ url: '/api/v1/orders/does-not-exist', headers: A })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().message).toBe(other.json().message)
  })

  it('lookup by order NUMBER is ownership-checked too', async () => {
    const res = await server.inject({ url: `/api/v1/orders/${orderB.orderNumber}`, headers: A })
    expect(res.statusCode).toBe(404)
  })

  it('an admin and a service identity can read any order', async () => {
    expect(
      (await server.inject({ url: `/api/v1/orders/${orderB.id}`, headers: ADMIN })).statusCode
    ).toBe(200)
    expect(
      (await server.inject({ url: `/api/v1/orders/${orderB.id}`, headers: SERVICE })).statusCode
    ).toBe(200)
  })

  it('listing is filtered IN the query: a customer sees only their own orders and counts', async () => {
    prisma.orders.push(makeOrder('cust-a'), makeOrder('cust-b'), makeOrder('cust-b'))
    const mine = (await server.inject({ url: '/api/v1/orders?limit=2', headers: A })).json()
    expect(mine.total).toBe(2)
    expect(mine.orders).toHaveLength(2)
    expect(mine.orders.every((o: { customerId: string }) => o.customerId === 'cust-a')).toBe(true)
    // Page size 1 must still be a full page of MY orders, not a page of everyone's with holes.
    const page = (await server.inject({ url: '/api/v1/orders?limit=1&page=2', headers: A })).json()
    expect(page.orders).toHaveLength(1)
    expect(page.orders[0].customerId).toBe('cust-a')

    const all = (await server.inject({ url: '/api/v1/orders?limit=100', headers: ADMIN })).json()
    expect(all.total).toBe(5)
    const svc = (await server.inject({ url: '/api/v1/orders?limit=100', headers: SERVICE })).json()
    expect(svc.total).toBe(5)
  })

  it("a customer cannot cancel another customer's order (404) and nothing changes", async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderB.id}`,
      headers: A,
      payload: { status: 'CANCELLED' },
    })
    expect(res.statusCode).toBe(404)
    expect(orderB.status).toBe('PENDING')
    expect(prisma.outbox).toHaveLength(0)
  })

  it('a customer can cancel their own order, which stages order.cancelled', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderA.id}`,
      headers: A,
      payload: { status: 'CANCELLED' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('CANCELLED')
    expect(prisma.outbox.map((e) => e.eventType)).toEqual(['order.cancelled'])
  })

  it('a customer cannot set any status except CANCELLED; an admin can', async () => {
    for (const status of ['CONFIRMED', 'SHIPPED', 'DELIVERED', 'PENDING']) {
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/orders/${orderA.id}`,
        headers: A,
        payload: { status },
      })
      expect(res.statusCode).toBe(403)
    }
    expect(orderA.status).toBe('PENDING')
    const admin = await server.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderA.id}`,
      headers: ADMIN,
      payload: { status: 'CONFIRMED' },
    })
    expect(admin.statusCode).toBe(200)
    expect(orderA.status).toBe('CONFIRMED')
  })

  it('the status enum is closed', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${orderA.id}`,
      headers: ADMIN,
      payload: { status: 'REFUNDED' },
    })
    expect(res.statusCode).toBe(400)
  })

  it("a customer cannot capture payment for another customer's order (404)", async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/payments/${orderB.id}/capture`,
      headers: A,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(orderB.payments[0]!.status).toBe('PENDING')
  })

  it('the owner captures their own order, but cannot force the simulated outcome', async () => {
    const forced = await server.inject({
      method: 'POST',
      url: `/api/v1/payments/${orderB.id}/capture`,
      headers: B,
      payload: { outcome: 'succeed' },
    })
    expect(forced.statusCode).toBe(403)
    expect(orderB.payments[0]!.status).toBe('PENDING')

    const admin = await server.inject({
      method: 'POST',
      url: `/api/v1/payments/${orderB.id}/capture`,
      headers: ADMIN,
      payload: { outcome: 'succeed' },
    })
    expect(admin.statusCode).toBe(200)
    expect(admin.json()).toMatchObject({ captured: true, orderStatus: 'CONFIRMED' })
  })

  it('saga-failure is not reachable by a customer even for their own order', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderA.id}/saga-failure`,
      headers: A,
      payload: { step: 's', compensation: 'release-inventory' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('responses carry only the documented order fields', async () => {
    const res = await server.inject({ url: `/api/v1/orders/${orderA.id}`, headers: A })
    expect(Object.keys(res.json()).sort()).toEqual(
      [
        'id',
        'orderNumber',
        'customerId',
        'customerName',
        'customerEmail',
        'status',
        'subtotal',
        'taxAmount',
        'shippingAmount',
        'discountAmount',
        'totalAmount',
        'currency',
        'paymentMethod',
        'paymentStatus',
        'transactionId',
        'shippingAddress',
        'items',
        'createdAt',
        'updatedAt',
      ].sort()
    )
  })
})

const line0 = ORDER_BODY.items[0]!

describe('POST /api/v1/orders: ownership and hostile input', () => {
  let server: FastifyInstance
  let prisma: FakePrisma
  let A: Record<string, string>

  beforeAll(async () => {
    ;({ server, prisma } = await buildOrderApp({ ta }))
    A = bearer(await ta.sign({ sub: 'cust-a', role: 'CUSTOMER' }))
  })
  afterAll(async () => server.close())

  const post = (payload: unknown, headers: Record<string, string> = A, extra: object = {}) =>
    server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers,
      payload: payload as object,
      ...extra,
    })

  it('stores the TOKEN subject as the owner', async () => {
    const res = await post(ORDER_BODY)
    expect(res.statusCode).toBe(201)
    expect(res.json().customerId).toBe('cust-a')
    expect(prisma.orders.at(-1)!.userId).toBe('cust-a')
  })

  it('validates real catalogue prices (0.07, 19.99, 33.33) and unrounded client-derived tax/total', async () => {
    for (const unitPrice of [0.07, 19.99, 33.33]) {
      const res = await post({
        ...ORDER_BODY,
        items: [{ ...line0, unitPrice, quantity: 1 }],
        subtotal: unitPrice,
        // The storefront sends float-derived values unrounded.
        taxAmount: unitPrice * 0.08,
        totalAmount: unitPrice + unitPrice * 0.08,
      })
      expect(res.statusCode).not.toBe(400)
    }
  })

  it('rejects a three-decimal unit price, subtotal or shipping amount', async () => {
    expect(
      (await post({ ...ORDER_BODY, items: [{ ...line0, unitPrice: 10.001 }] })).statusCode
    ).toBe(400)
    expect((await post({ ...ORDER_BODY, subtotal: 20.001 })).statusCode).toBe(400)
    expect((await post({ ...ORDER_BODY, shippingAmount: 1.005 })).statusCode).toBe(400)
  })

  it('rejects a body userId (no impersonation, no guest owner)', async () => {
    const res = await post({ ...ORDER_BODY, userId: 'cust-b' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_FAILED')
    expect(res.json().fields[0].rule).toBe('unknownField:userId')
  })

  it('there is no guest checkout: anonymous is 401 before the body is even read', async () => {
    const res = await post({ nonsense: true }, {})
    expect(res.statusCode).toBe(401)
  })

  const line = ORDER_BODY.items[0]!
  const hostile: [string, unknown][] = [
    ['empty items', { ...ORDER_BODY, items: [] }],
    ['101 lines', { ...ORDER_BODY, items: Array.from({ length: 101 }, () => line) }],
    ['negative quantity', { ...ORDER_BODY, items: [{ ...line, quantity: -1 }] }],
    ['zero quantity', { ...ORDER_BODY, items: [{ ...line, quantity: 0 }] }],
    ['fractional quantity', { ...ORDER_BODY, items: [{ ...line, quantity: 1.5 }] }],
    ['quantity above the cap', { ...ORDER_BODY, items: [{ ...line, quantity: 1001 }] }],
    [
      'string quantity (no coercion in bodies)',
      { ...ORDER_BODY, items: [{ ...line, quantity: '2' }] },
    ],
    ['negative price', { ...ORDER_BODY, items: [{ ...line, unitPrice: -5 }] }],
    ['null price', { ...ORDER_BODY, items: [{ ...line, unitPrice: null }] }],
    ['absurd price', { ...ORDER_BODY, items: [{ ...line, unitPrice: 1e12 }] }],
    ['extra field on a line', { ...ORDER_BODY, items: [{ ...line, discount: 100 }] }],
    ['extra top-level field', { ...ORDER_BODY, role: 'ADMIN' }],
    [
      'extra address field',
      { ...ORDER_BODY, shippingAddress: { ...ORDER_BODY.shippingAddress, x: 1 } },
    ],
    [
      'unicode country name',
      {
        ...ORDER_BODY,
        shippingAddress: { ...ORDER_BODY.shippingAddress, country: 'United States' },
      },
    ],
    ['lowercase currency', { ...ORDER_BODY, currency: 'usd' }],
    ['unknown payment method', { ...ORDER_BODY, paymentMethod: 'BITCOIN' }],
    ['bad email', { ...ORDER_BODY, customerEmail: 'not-an-email' }],
    ['10k-char title', { ...ORDER_BODY, items: [{ ...line, title: 'x'.repeat(10_000) }] }],
    [
      'sql-looking product id',
      { ...ORDER_BODY, items: [{ ...line, productId: "p1'; DROP TABLE orders;--" }] },
    ],
    ['items as an object', { ...ORDER_BODY, items: { 0: line } }],
    ['missing totalAmount', { ...ORDER_BODY, totalAmount: undefined }],
    ['array body', [ORDER_BODY]],
    ['null body', null],
  ]

  it.each(hostile)('%s is a 400', async (_name, payload) => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { ...A, 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    })
    expect(res.statusCode).toBe(400)
  })

  it('Infinity (1e999 in JSON) and NaN-like numbers are rejected', async () => {
    const raw = JSON.stringify(ORDER_BODY).replace('"unitPrice":10', '"unitPrice":1e999')
    expect(raw).toContain('1e999')
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { ...A, 'content-type': 'application/json' },
      payload: raw,
    })
    expect(res.statusCode).toBe(400)
  })

  it('a __proto__ key does not pollute and does not pass', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { ...A, 'content-type': 'application/json' },
      payload: JSON.stringify(ORDER_BODY).replace('{', '{"__proto__":{"isAdmin":true},'),
    })
    expect(res.statusCode).toBe(400)
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
  })

  it('a non-JSON content type is 415 and an oversized body is 413', async () => {
    const text = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { ...A, 'content-type': 'text/plain' },
      payload: 'hello',
    })
    expect(text.statusCode).toBe(415)
    const big = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { ...A, 'content-type': 'application/json' },
      payload: JSON.stringify({ ...ORDER_BODY, pad: 'x'.repeat(200 * 1024) }),
    })
    expect(big.statusCode).toBe(413)
  })

  it('a hostile Idempotency-Key header is bounded', async () => {
    const res = await post(ORDER_BODY, { ...A, 'idempotency-key': 'k'.repeat(500) })
    expect(res.statusCode).toBe(400)
  })

  it('an unrounded client total (cents of tax) is accepted: amounts are bounded, not cent-exact', async () => {
    const res = await post({
      ...ORDER_BODY,
      taxAmount: 0.1 + 0.2 + 1.3,
      totalAmount: 20 + 0.1 + 0.2 + 1.3,
    })
    expect(res.statusCode).toBe(201)
  })

  it('validation errors never echo the offending value', async () => {
    const secret = 'hunter2-hunter2-hunter2'
    const res = await post({ ...ORDER_BODY, customerEmail: secret })
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.json())).not.toContain(secret)
  })
})

describe('price verification (PRICE_CHECK)', () => {
  const catalogue: Record<string, { price: number; currency: string; title: string; sku: string }> =
    {
      p1: { price: 10, currency: 'USD', title: 'Real title', sku: 'REAL-1' },
    }

  function verifier(mode: 'report' | 'enforce', fetchImpl?: typeof fetch): PriceVerifier {
    return {
      mode,
      client: new ProductClient({
        baseUrl: 'http://product.test',
        serviceSecret: SERVICE_SECRET,
        timeoutMs: 200,
        fetchImpl:
          fetchImpl ??
          (async (input) => {
            const id = decodeURIComponent(String(input).split('/').pop() ?? '')
            const p = catalogue[id]
            return p
              ? new Response(JSON.stringify({ id, ...p }), { status: 200 })
              : new Response('{"error":"Product not found"}', { status: 404 })
          }),
      }),
    }
  }

  async function run(mode: 'report' | 'enforce', body: unknown, fetchImpl?: typeof fetch) {
    const { server, prisma } = await buildOrderApp({ ta, priceVerifier: verifier(mode, fetchImpl) })
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: bearer(await ta.sign({ sub: 'cust-a', role: 'CUSTOMER' })),
      payload: body as object,
    })
    await server.close()
    return { res, prisma }
  }

  it('enforce: matching prices are accepted, and the catalogue title/sku are stored', async () => {
    const { res, prisma } = await run('enforce', ORDER_BODY)
    expect(res.statusCode).toBe(201)
    expect(prisma.orders[0]!.items[0]).toMatchObject({
      productTitle: 'Real title',
      productSku: 'REAL-1',
    })
  })

  it('enforce: a cheaper unit price is 422 PRICE_MISMATCH and nothing is written', async () => {
    const body = {
      ...ORDER_BODY,
      items: [{ ...ORDER_BODY.items[0]!, unitPrice: 1 }],
      subtotal: 2,
      totalAmount: 2,
    }
    const { res, prisma } = await run('enforce', body)
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('PRICE_MISMATCH')
    expect(res.json().mismatches[0]).toMatchObject({
      field: 'items[0].unitPrice',
      expected: 10,
      actual: 1,
    })
    expect(prisma.orders).toHaveLength(0)
    expect(prisma.outbox).toHaveLength(0)
  })

  it('enforce: right line prices but a lowered subtotal or total are both caught', async () => {
    expect((await run('enforce', { ...ORDER_BODY, subtotal: 1 })).res.statusCode).toBe(422)
    expect((await run('enforce', { ...ORDER_BODY, totalAmount: 1 })).res.statusCode).toBe(422)
  })

  it('enforce: a discount bigger than the subtotal is refused', async () => {
    const { res } = await run('enforce', { ...ORDER_BODY, discountAmount: 25, totalAmount: -5 + 5 })
    expect(res.statusCode).toBe(422)
  })

  it('enforce: tax, shipping and a legitimate discount are accepted when the arithmetic holds', async () => {
    const { res } = await run('enforce', {
      ...ORDER_BODY,
      taxAmount: 1.44,
      shippingAmount: 15,
      discountAmount: 4,
      totalAmount: 32.44,
    })
    expect(res.statusCode).toBe(201)
  })

  it('enforce: within one cent of the catalogue is accepted', async () => {
    const { res } = await run('enforce', { ...ORDER_BODY, subtotal: 20.01, totalAmount: 20.01 })
    expect(res.statusCode).toBe(201)
  })

  it('enforce: an unknown product is 422', async () => {
    const { res } = await run('enforce', {
      ...ORDER_BODY,
      items: [{ ...ORDER_BODY.items[0]!, productId: 'ghost' }],
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().mismatches[0].reason).toBe('unknown-product')
  })

  it('enforce: a currency different from the catalogue is 422', async () => {
    const { res } = await run('enforce', { ...ORDER_BODY, currency: 'EUR' })
    expect(res.statusCode).toBe(422)
  })

  const down: typeof fetch = async () => {
    throw new TypeError('fetch failed')
  }

  it('enforce: ms-product unreachable is 503 with Retry-After, nothing written', async () => {
    const { res, prisma } = await run('enforce', ORDER_BODY, down)
    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('PRICE_CHECK_UNAVAILABLE')
    expect(res.headers['retry-after']).toBeDefined()
    expect(prisma.orders).toHaveLength(0)
  })

  it('enforce: a 500 from ms-product is also 503, not a pass', async () => {
    const { res } = await run(
      'enforce',
      ORDER_BODY,
      async () => new Response('boom', { status: 500 })
    )
    expect(res.statusCode).toBe(503)
  })

  it('report: a mismatch is logged and the order is ACCEPTED as submitted', async () => {
    const body = {
      ...ORDER_BODY,
      items: [{ ...ORDER_BODY.items[0]!, unitPrice: 1 }],
      subtotal: 2,
      totalAmount: 2,
    }
    const { res, prisma } = await run('report', body)
    expect(res.statusCode).toBe(201)
    expect(prisma.orders[0]!.totalAmount).toBe(2)
    // Report mode must not rewrite the client's title either.
    expect(prisma.orders[0]!.items[0]!.productTitle).toBe('Thing')
  })

  it('report: an unreachable ms-product does not block checkout', async () => {
    expect((await run('report', ORDER_BODY, down)).res.statusCode).toBe(201)
  })
})

describe('ProductClient', () => {
  it('calls ms-product with a verifiable SERVICE token for ms-order', async () => {
    let seen: { url: string; auth: string | undefined } | null = null
    const client = new ProductClient({
      baseUrl: 'http://product.test/',
      serviceSecret: SERVICE_SECRET,
      fetchImpl: async (input, init) => {
        seen = {
          url: String(input),
          auth: (init?.headers as Record<string, string>)?.authorization,
        }
        return new Response(JSON.stringify({ price: 5, currency: 'USD' }), { status: 200 })
      },
    })
    expect(await client.getProduct('prod 1/../x')).toMatchObject({ price: 5 })
    expect(seen!.url).toBe('http://product.test/api/v1/products/prod%201%2F..%2Fx')
    const token = seen!.auth!.replace(/^Bearer /, '')
    const identity = await new TokenVerifier({
      issuer: ta.issuer,
      audience: ta.audience,
      jwks: ta.jwks,
      serviceSecret: SERVICE_SECRET,
    }).verify(token)
    expect(identity).toMatchObject({ role: 'SERVICE', userId: 'ms-order', kind: 'service' })
  })

  it('gives up after the timeout instead of hanging the checkout', async () => {
    const client = new ProductClient({
      baseUrl: 'http://product.test',
      serviceSecret: null,
      timeoutMs: 50,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    })
    const started = Date.now()
    await expect(client.getProduct('p1')).rejects.toThrow(/timed out/)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('treats a price-less body as unavailable rather than free', async () => {
    const client = new ProductClient({
      baseUrl: 'http://product.test',
      serviceSecret: null,
      fetchImpl: async () => new Response(JSON.stringify({ title: 'x' }), { status: 200 }),
    })
    await expect(client.getProduct('p1')).rejects.toThrow(/usable price/)
  })

  it('defaults to the product port from PRODUCT_SERVICE_PORT', async () => {
    const urls: string[] = []
    const realFetch = global.fetch
    global.fetch = (async (input: unknown) => {
      urls.push(String(input))
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    try {
      await createProductClientFromEnv({
        PRODUCT_SERVICE_PORT: '5464',
      } as NodeJS.ProcessEnv).getProduct('p1')
      await createProductClientFromEnv({
        PRODUCT_SERVICE_URL: 'http://prod:1',
      } as NodeJS.ProcessEnv).getProduct('p1')
    } finally {
      global.fetch = realFetch
    }
    expect(urls).toEqual([
      'http://127.0.0.1:5464/api/v1/products/p1',
      'http://prod:1/api/v1/products/p1',
    ])
  })
})

describe('rate limiting', () => {
  it('POST /orders uses the write tier: the 4th request in a window is 429 with Retry-After', async () => {
    const { server } = await buildOrderApp({ ta, limits: { userWritePerMin: 3 } })
    const A = bearer(await ta.sign({ sub: 'cust-a', role: 'CUSTOMER' }))
    const B = bearer(await ta.sign({ sub: 'cust-b', role: 'CUSTOMER' }))
    const post = (headers: Record<string, string>) =>
      server.inject({ method: 'POST', url: '/api/v1/orders', headers, payload: ORDER_BODY })

    for (let i = 0; i < 3; i++) expect((await post(A)).statusCode).toBe(201)
    const limited = await post(A)
    expect(limited.statusCode).toBe(429)
    expect(limited.headers['retry-after']).toBeDefined()
    expect(limited.json().code).toBe('RATE_LIMITED')
    // The bucket is per user: another customer is unaffected.
    expect((await post(B)).statusCode).toBe(201)
    await server.close()
  })

  it('does not rate-limit /health', async () => {
    const { server } = await buildOrderApp({ ta, limits: { ipPerMin: 1 } })
    for (let i = 0; i < 5; i++) expect((await server.inject('/health')).statusCode).not.toBe(429)
    await server.close()
  })
})

describe('AUTH_ENFORCE=report (rollout mode)', () => {
  it('logs but does not block: anonymous checkout still works and is owned by "guest"', async () => {
    const { server, prisma } = await buildOrderApp({ ta, auth: 'report' })
    const res = await server.inject({ method: 'POST', url: '/api/v1/orders', payload: ORDER_BODY })
    expect(res.statusCode).toBe(201)
    expect(prisma.orders[0]!.userId).toBe('guest')
    expect((await server.inject('/api/v1/orders')).statusCode).toBe(200)
    await server.close()
  })

  it('still validates input: report mode relaxes authorization, not the contract', async () => {
    const { server } = await buildOrderApp({ ta, auth: 'report' })
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: { ...ORDER_BODY, userId: 'x' },
    })
    expect(res.statusCode).toBe(400)
    await server.close()
  })
})
