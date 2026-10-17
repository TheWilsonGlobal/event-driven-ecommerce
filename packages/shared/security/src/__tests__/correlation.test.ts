import fastify, { type FastifyInstance } from 'fastify'
import {
  MemoryRateStore,
  correlationHeaders,
  isValidCorrelationId,
  parseTraceparent,
  registerSecurity,
  resolveCorrelation,
  securityServerOptions,
} from '..'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const VALID_TP = `00-${TRACE_ID}-00f067aa0ba902b7-01`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('parseTraceparent', () => {
  it('accepts a well-formed traceparent and returns the trace id', () => {
    expect(parseTraceparent(VALID_TP)).toEqual({ traceId: TRACE_ID, header: VALID_TP })
  })

  it.each([
    ['uppercase hex', VALID_TP.toUpperCase()],
    ['too short trace id', `00-abc-00f067aa0ba902b7-01`],
    ['version ff', `ff-${TRACE_ID}-00f067aa0ba902b7-01`],
    ['all-zero trace id', `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`],
    ['all-zero parent id', `00-${TRACE_ID}-${'0'.repeat(16)}-01`],
    ['trailing junk', `${VALID_TP}-extra`],
    ['newline injection', `${VALID_TP}\nx: y`],
    ['empty', ''],
  ])('rejects %s', (_name, value) => {
    expect(parseTraceparent(value)).toBeNull()
  })

  it('rejects non-strings', () => {
    expect(parseTraceparent(undefined)).toBeNull()
    expect(parseTraceparent(['a', 'b'])).toBeNull()
  })
})

describe('isValidCorrelationId', () => {
  it('accepts the documented alphabet up to 128 characters', () => {
    expect(isValidCorrelationId('trace-test-1')).toBe(true)
    expect(isValidCorrelationId('A.b_c-9')).toBe(true)
    expect(isValidCorrelationId('a'.repeat(128))).toBe(true)
  })

  it.each(['', 'a'.repeat(129), 'has space', 'semi;colon', 'new\nline', 'ünï', 'a/b'])(
    'rejects %j',
    (v) => {
      expect(isValidCorrelationId(v)).toBe(false)
    }
  )
})

describe('resolveCorrelation', () => {
  it('prefers x-correlation-id over traceparent', () => {
    expect(resolveCorrelation({ 'x-correlation-id': 'mine-1', traceparent: VALID_TP })).toEqual({
      correlationId: 'mine-1',
      traceparent: VALID_TP,
    })
  })

  it('falls back to the trace id of a valid traceparent', () => {
    expect(resolveCorrelation({ traceparent: VALID_TP })).toEqual({
      correlationId: TRACE_ID,
      traceparent: VALID_TP,
    })
  })

  it('replaces invalid values with a generated uuid and drops a bad traceparent', () => {
    const r = resolveCorrelation({ 'x-correlation-id': 'bad id!', traceparent: 'nope' })
    expect(r.correlationId).toMatch(UUID)
    expect(r.traceparent).toBeNull()
  })

  it('generates a fresh id each time when nothing is sent', () => {
    expect(resolveCorrelation({}).correlationId).not.toBe(resolveCorrelation({}).correlationId)
  })
})

describe('correlationHeaders', () => {
  it('emits only what was validated', () => {
    expect(correlationHeaders({ correlationId: 'c1', traceparent: null })).toEqual({
      'x-correlation-id': 'c1',
    })
    expect(correlationHeaders({ correlationId: 'c1', traceparent: VALID_TP })).toEqual({
      'x-correlation-id': 'c1',
      traceparent: VALID_TP,
    })
  })
})

describe('correlation plugin (via registerSecurity)', () => {
  const lines: Record<string, unknown>[] = []
  const stream = {
    write(chunk: string) {
      lines.push(JSON.parse(chunk) as Record<string, unknown>)
    },
  }
  let server: FastifyInstance

  beforeEach(async () => {
    lines.length = 0
    server = fastify({ ...securityServerOptions({}), logger: { level: 'info', stream } })
    await registerSecurity(server, {
      service: 'test',
      overrides: {
        store: new MemoryRateStore(),
        config: { authMode: 'report', rateLimitMode: 'report' },
      },
    })
    server.get('/echo', { config: { policy: { public: true } } }, async (request) => {
      request.log.info('inside handler')
      return { correlationId: request.correlationId, traceparent: request.traceparent }
    })
    await server.ready()
  })

  afterEach(async () => {
    await server.close()
  })

  it('uses a valid x-correlation-id, exposes it and echoes it', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/echo',
      headers: { 'x-correlation-id': 'trace-test-1' },
    })
    expect(res.headers['x-correlation-id']).toBe('trace-test-1')
    expect(res.json()).toEqual({ correlationId: 'trace-test-1', traceparent: null })
  })

  it('derives the id from a valid traceparent', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/echo',
      headers: { traceparent: VALID_TP },
    })
    expect(res.headers['x-correlation-id']).toBe(TRACE_ID)
    expect(res.json()).toEqual({ correlationId: TRACE_ID, traceparent: VALID_TP })
  })

  it('ignores an invalid id and generates one instead of echoing it', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/echo',
      headers: { 'x-correlation-id': 'x'.repeat(200), traceparent: 'garbage' },
    })
    const id = res.headers['x-correlation-id'] as string
    expect(id).toMatch(UUID)
    expect(res.json()).toEqual({ correlationId: id, traceparent: null })
  })

  it('generates an id when no header is sent', async () => {
    const res = await server.inject({ method: 'GET', url: '/echo' })
    expect(res.headers['x-correlation-id']).toMatch(UUID)
  })

  it('binds correlationId to handler logs and the completion line', async () => {
    await server.inject({
      method: 'GET',
      url: '/echo',
      headers: { 'x-correlation-id': 'log-me' },
    })
    const handler = lines.find((l) => l.msg === 'inside handler')
    const done = lines.find((l) => l.msg === 'request completed')
    expect(handler?.correlationId).toBe('log-me')
    expect(done?.correlationId).toBe('log-me')
  })

  it('echoes the id on error responses and keeps requestId in the body', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/missing',
      headers: { 'x-correlation-id': 'on-404' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.headers['x-correlation-id']).toBe('on-404')
    expect(res.json().requestId).toEqual(expect.any(String))
  })
})
