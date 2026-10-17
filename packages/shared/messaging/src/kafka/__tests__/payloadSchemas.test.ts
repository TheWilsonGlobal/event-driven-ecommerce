import { EVENT_TYPES, PAYLOAD_SCHEMAS, validatePayload } from '../..'

const line = { productId: 'p1', sku: 'S1', quantity: 2, unitPrice: 9.99 }
const ref = { orderId: 'o1', orderNumber: 'ORD-1' }

const valid: Record<string, unknown> = {
  [EVENT_TYPES.orderCreated]: {
    ...ref,
    userId: 'u1',
    customerEmail: 'a@b.co',
    status: 'CONFIRMED',
    totalAmount: 19.98,
    currency: 'USD',
    items: [line],
  },
  [EVENT_TYPES.orderConfirmed]: {
    ...ref,
    customerEmail: 'a@b.co',
    customerName: 'A',
    totalAmount: 1,
    currency: 'USD',
  },
  [EVENT_TYPES.orderCancelled]: { ...ref, reason: 'expired-unpaid', items: [line] },
  [EVENT_TYPES.paymentCaptured]: {
    ...ref,
    paymentId: 'pay1',
    provider: 'stripe',
    amount: 5,
    currency: 'USD',
  },
  [EVENT_TYPES.paymentFailed]: {
    ...ref,
    paymentId: 'pay1',
    provider: 'stripe',
    amount: 5,
    currency: 'USD',
    reason: 'declined',
    attempt: 1,
  },
  [EVENT_TYPES.paymentRefunded]: {
    ...ref,
    paymentId: 'pay1',
    amount: 5,
    currency: 'USD',
    reason: 'x',
  },
  [EVENT_TYPES.inventoryReserved]: {
    ...ref,
    reservations: [{ productId: 'p1', sku: 'S1', quantity: 2 }],
  },
  [EVENT_TYPES.inventoryReleased]: {
    ...ref,
    reason: '',
    releases: [{ productId: 'p1', sku: 'S1', quantity: 2 }],
  },
  [EVENT_TYPES.inventoryInsufficient]: {
    ...ref,
    shortfalls: [{ productId: 'p1', sku: 'S1', requested: 3, available: 0 }],
  },
}

describe('payload schemas', () => {
  it('has a schema and a valid sample for every event type', () => {
    expect(Object.keys(PAYLOAD_SCHEMAS).sort()).toEqual(Object.values(EVENT_TYPES).sort())
    expect(Object.keys(valid).sort()).toEqual(Object.values(EVENT_TYPES).sort())
  })

  it.each(Object.entries(valid))('%s: a well-formed payload passes', (type, payload) => {
    expect(validatePayload(type, payload)).toEqual({ ok: true })
  })

  it.each(Object.entries(valid))(
    '%s: tolerates extra fields (forward compatible)',
    (type, payload) => {
      expect(validatePayload(type, { ...(payload as object), futureField: 1 }).ok).toBe(true)
    }
  )

  it.each(Object.entries(valid))('%s: rejects null, a string and an array', (type) => {
    for (const bad of [null, 'x', [], 42, undefined]) {
      expect(validatePayload(type, bad).ok).toBe(false)
    }
  })

  it.each(Object.entries(valid))('%s: rejects a payload missing orderId', (type, payload) => {
    const { orderId: _omit, ...rest } = payload as Record<string, unknown>
    void _omit
    const r = validatePayload(type, rest)
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('orderId') })
  })

  const orderCreated = valid[EVENT_TYPES.orderCreated] as Record<string, unknown>
  const hostile: [string, Record<string, unknown>][] = [
    ['negative quantity', { items: [{ ...line, quantity: -1 }] }],
    ['zero quantity', { items: [{ ...line, quantity: 0 }] }],
    ['fractional quantity', { items: [{ ...line, quantity: 1.5 }] }],
    ['quantity above int range', { items: [{ ...line, quantity: 2 ** 31 }] }],
    ['string quantity', { items: [{ ...line, quantity: '2' }] }],
    ['negative price', { items: [{ ...line, unitPrice: -1 }] }],
    ['null price', { items: [{ ...line, unitPrice: null }] }],
    ['line without productId', { items: [{ sku: 'S', quantity: 1, unitPrice: 1 }] }],
    ['items not an array', { items: { 0: line } }],
    ['5000 lines', { items: Array.from({ length: 5000 }, () => line) }],
    ['negative total', { totalAmount: -5 }],
    ['non-finite total', { totalAmount: Infinity }],
    ['NaN total', { totalAmount: NaN }],
    ['10k-char order number', { orderNumber: 'x'.repeat(10_000) }],
  ]
  it.each(hostile)('order.created rejects %s', (_n, patch) => {
    expect(validatePayload(EVENT_TYPES.orderCreated, { ...orderCreated, ...patch }).ok).toBe(false)
  })

  it('the failure reason names the path and rule but never echoes the value', () => {
    const secret = 'hunter2-hunter2'
    const r = validatePayload(EVENT_TYPES.orderCreated, { ...orderCreated, totalAmount: secret })
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(secret)
    expect(r).toEqual({ ok: false, reason: 'totalAmount type' })
  })

  it('an unknown event type fails closed', () => {
    expect(validatePayload('order.exploded', {})).toEqual({
      ok: false,
      reason: expect.stringContaining('no payload schema'),
    })
  })

  it('does not let __proto__ in a payload through as data', () => {
    const payload = JSON.parse('{"__proto__":{"x":1},"orderId":"o"}')
    expect(validatePayload(EVENT_TYPES.orderConfirmed, payload).ok).toBe(false)
  })
})
