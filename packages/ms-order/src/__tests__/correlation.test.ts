import type { TestAuth } from '@ecommerce/shared-security'
import { ProductClient } from '../pricing/ProductClient'
import type { PriceVerifier } from '../pricing/PriceVerifier'
import { SERVICE_SECRET, buildOrderApp, createTestAuth } from './helpers/fakeOrderApp'

/**
 * Trace propagation and the optional order-line categoryId, through the real
 * handlers: the request's correlation id must land on the outbox envelopes and
 * on the ms-order -> ms-product price-check call.
 */

let ta: TestAuth
beforeAll(async () => {
  ta = await createTestAuth()
})

const BODY = {
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

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

async function post(
  headers: Record<string, string>,
  body: unknown = BODY,
  priceVerifier?: PriceVerifier
) {
  const { server, prisma } = await buildOrderApp({
    ta,
    ...(priceVerifier ? { priceVerifier } : {}),
  })
  const token = await ta.sign({ sub: 'cust-a', role: 'CUSTOMER' })
  const res = await server.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: { authorization: `Bearer ${token}`, ...headers },
    payload: body as object,
  })
  await server.close()
  return { res, prisma }
}

describe('correlation id on order events', () => {
  it('uses the request x-correlation-id for order.created AND order.confirmed', async () => {
    const { res, prisma } = await post({ 'x-correlation-id': 'trace-test-1' })
    expect(res.statusCode).toBe(201)
    expect(res.headers['x-correlation-id']).toBe('trace-test-1')
    expect(prisma.outbox.map((o) => o.eventType).sort()).toEqual([
      'order.confirmed',
      'order.created',
    ])
    for (const row of prisma.outbox) expect(row.envelope.correlationId).toBe('trace-test-1')
  })

  it('falls back to the traceparent trace id', async () => {
    const { prisma } = await post({ traceparent: TRACEPARENT })
    expect(prisma.outbox[0]!.envelope.correlationId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('never copies a malformed header into the envelope; the generated id equals the echoed one', async () => {
    const { res, prisma } = await post({ 'x-correlation-id': 'bad id\twith spaces' })
    const echoed = res.headers['x-correlation-id'] as string
    expect(echoed).toMatch(/^[0-9a-f-]{36}$/)
    expect(prisma.outbox[0]!.envelope.correlationId).toBe(echoed)
  })
})

describe('correlation id on the ms-product price check', () => {
  it('forwards x-correlation-id and a valid traceparent', async () => {
    const seen: Record<string, string>[] = []
    const verifier: PriceVerifier = {
      mode: 'enforce',
      client: new ProductClient({
        baseUrl: 'http://product.test',
        serviceSecret: SERVICE_SECRET,
        fetchImpl: async (_input, init) => {
          seen.push(init?.headers as Record<string, string>)
          return new Response(
            JSON.stringify({ id: 'p1', price: 10, currency: 'USD', title: 'T', sku: 'S1' }),
            { status: 200 }
          )
        },
      }),
    }
    const { res } = await post(
      { 'x-correlation-id': 'trace-test-1', traceparent: TRACEPARENT },
      BODY,
      verifier
    )
    expect(res.statusCode).toBe(201)
    expect(seen).toHaveLength(1)
    expect(seen[0]!['x-correlation-id']).toBe('trace-test-1')
    expect(seen[0]!['traceparent']).toBe(TRACEPARENT)
    expect(seen[0]!['authorization']).toMatch(/^Bearer /)
  })
})

describe('optional order line categoryId', () => {
  const withCategory = (categoryId: unknown) => ({
    ...BODY,
    items: [{ ...BODY.items[0]!, categoryId }],
  })

  it('is forwarded on the order.created payload items', async () => {
    const { res, prisma } = await post({}, withCategory('cat-electronics_1'))
    expect(res.statusCode).toBe(201)
    const created = prisma.outbox.find((o) => o.eventType === 'order.created')!
    expect(created.envelope.payload.items[0]).toMatchObject({
      productId: 'p1',
      categoryId: 'cat-electronics_1',
    })
  })

  it('is omitted (not null) when the client did not send one', async () => {
    const { res, prisma } = await post({})
    expect(res.statusCode).toBe(201)
    const created = prisma.outbox.find((o) => o.eventType === 'order.created')!
    expect('categoryId' in created.envelope.payload.items[0]).toBe(false)
  })

  it.each(['has space', 'a'.repeat(65), 'semi;colon', '', 7])(
    'rejects %j with 400',
    async (bad) => {
      const { res } = await post({}, withCategory(bad))
      expect(res.statusCode).toBe(400)
    }
  )
})
