import * as fs from 'fs'
import * as path from 'path'
import { EventConsumer } from '../kafka/consumer'
import {
  correlationTag,
  currentMessageContext,
  withCorrelationTag,
} from '../kafka/correlationContext'
import { makeEnvelope, parseEnvelope } from '../kafka/envelope'
import { validatePayload } from '../kafka/payloadSchemas'
import { CONSUMER_GROUPS, EVENT_TYPES, TOPICS } from '../kafka/topics'

const DISABLED = { enabled: false, brokers: ['localhost:9100'], clientId: 'test' }

const wire = (over: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      eventId: 'evt-1',
      eventType: EVENT_TYPES.orderCreated,
      eventVersion: 1,
      occurredAt: '2026-10-17T00:00:00.000Z',
      producer: 'ms-order',
      payload: {},
      ...over,
    })
  )

describe('parseEnvelope correlation fallback', () => {
  it('prefers the body correlationId over the header', () => {
    expect(parseEnvelope(wire({ correlationId: 'body-id' }), 'header-id')?.correlationId).toBe(
      'body-id'
    )
  })

  it('reads the correlation-id header when the body lacks one', () => {
    expect(parseEnvelope(wire(), 'trace-test-1')?.correlationId).toBe('trace-test-1')
  })

  it('ignores a malformed header and falls back to the eventId', () => {
    expect(parseEnvelope(wire(), 'bad id\nx')?.correlationId).toBe('evt-1')
    expect(parseEnvelope(wire(), null)?.correlationId).toBe('evt-1')
  })

  it.each(['bad id\nx', 'a'.repeat(129), '<script>', 'semi;colon', '', 5, {}])(
    'rejects an invalid body correlationId %j and falls back to the header',
    (bad) => {
      expect(parseEnvelope(wire({ correlationId: bad }), 'header-id')?.correlationId).toBe(
        'header-id'
      )
    }
  )

  it('falls back to the eventId when body and header are both invalid', () => {
    expect(parseEnvelope(wire({ correlationId: 'bad id' }), 'also bad')?.correlationId).toBe(
      'evt-1'
    )
    expect(parseEnvelope(wire({ correlationId: 'x'.repeat(200) }))?.correlationId).toBe('evt-1')
  })

  it('accepts a 128 character body id', () => {
    const id = 'a'.repeat(128)
    expect(parseEnvelope(wire({ correlationId: id }))?.correlationId).toBe(id)
  })

  it('producer and consumer use exactly the same header name', () => {
    const dir = path.resolve(__dirname, '../kafka')
    const producer = fs.readFileSync(path.join(dir, 'producer.ts'), 'utf8')
    const consumer = fs.readFileSync(path.join(dir, 'consumer.ts'), 'utf8')
    expect(producer).toContain("'correlation-id': envelope.correlationId")
    expect(consumer).toContain("headers?.['correlation-id']")
  })

  it('keeps the producer default (eventId) via makeEnvelope', () => {
    const e = makeEnvelope({ eventType: EVENT_TYPES.orderCreated, producer: 't', payload: {} })
    expect(e.correlationId).toBe(e.eventId)
  })
})

describe('EventConsumer binds the envelope correlationId while handling', () => {
  type Dispatch = (
    topic: string,
    partition: number,
    offset: string,
    value: Buffer | null,
    header?: string | null
  ) => Promise<void>

  function consumer() {
    const c = new EventConsumer(
      {
        groupId: CONSUMER_GROUPS.analytics,
        topics: [TOPICS.orders],
        fromBeginning: true,
        logPrefix: '[test]',
        clientId: 'test',
      },
      DISABLED
    )
    const dispatch = (c as unknown as { dispatch: Dispatch }).dispatch.bind(c)
    return { c, dispatch }
  }

  it('exposes the id to the handler and to everything it awaits', async () => {
    const { c, dispatch } = consumer()
    const seen: { sync?: string | undefined; afterAwait?: string | undefined; tagged?: string } = {}
    c.on(EVENT_TYPES.orderCreated, async () => {
      seen.sync = currentMessageContext()?.correlationId
      await new Promise((r) => setTimeout(r, 5))
      seen.afterAwait = currentMessageContext()?.correlationId
      seen.tagged = withCorrelationTag('did a thing')
    })
    await dispatch('t', 0, '1', wire({ correlationId: 'trace-test-1' }))
    expect(seen).toEqual({
      sync: 'trace-test-1',
      afterAwait: 'trace-test-1',
      tagged: 'did a thing [correlationId=trace-test-1]',
    })
  })

  it('takes the id from the Kafka header when the body has none', async () => {
    const { c, dispatch } = consumer()
    let id: string | undefined
    c.on(EVENT_TYPES.orderCreated, async () => {
      id = currentMessageContext()?.correlationId
    })
    await dispatch('t', 0, '1', wire(), 'from-header')
    expect(id).toBe('from-header')
  })

  it('keeps concurrent messages isolated and leaves nothing bound afterwards', async () => {
    const { c, dispatch } = consumer()
    const seen: string[] = []
    c.on(EVENT_TYPES.orderCreated, async (env) => {
      await new Promise((r) => setTimeout(r, env.correlationId === 'slow' ? 20 : 1))
      seen.push(`${env.correlationId}=${currentMessageContext()?.correlationId}`)
    })
    await Promise.all([
      dispatch('t', 0, '1', wire({ eventId: 'a', correlationId: 'slow' })),
      dispatch('t', 0, '2', wire({ eventId: 'b', correlationId: 'fast' })),
    ])
    expect(seen.sort()).toEqual(['fast=fast', 'slow=slow'])
    expect(currentMessageContext()).toBeUndefined()
    expect(correlationTag()).toBe('')
    expect(withCorrelationTag('plain')).toBe('plain')
  })

  it('names the correlationId when a handler throws', async () => {
    const { c, dispatch } = consumer()
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      c.on(EVENT_TYPES.orderCreated, async () => {
        throw new Error('boom')
      })
      await dispatch('t', 0, '1', wire({ correlationId: 'trace-test-1' }))
      expect(String(spy.mock.calls[0]?.[0])).toContain('correlationId=trace-test-1')
      expect(c.stats.failed).toBe(1)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('optional categoryId on order lines', () => {
  const base = {
    orderId: 'o1',
    orderNumber: 'ORD-1',
    userId: 'u1',
    customerEmail: 'a@b.co',
    status: 'CONFIRMED',
    totalAmount: 20,
    currency: 'USD',
  }
  const item = { productId: 'p1', sku: 'S1', quantity: 2, unitPrice: 10 }

  it('accepts lines with and without it (backwards compatible)', () => {
    expect(validatePayload(EVENT_TYPES.orderCreated, { ...base, items: [item] })).toEqual({
      ok: true,
    })
    expect(
      validatePayload(EVENT_TYPES.orderCreated, {
        ...base,
        items: [{ ...item, categoryId: 'cat_1-A' }],
      })
    ).toEqual({ ok: true })
  })

  it.each(['has space', 'a'.repeat(65), '', 'semi;colon', 5])('rejects %j', (bad) => {
    expect(
      validatePayload(EVENT_TYPES.orderCreated, { ...base, items: [{ ...item, categoryId: bad }] })
        .ok
    ).toBe(false)
  })
})
