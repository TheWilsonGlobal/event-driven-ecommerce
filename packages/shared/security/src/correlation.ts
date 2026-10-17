import * as crypto from 'crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

/**
 * Correlation / trace propagation for every HTTP service.
 *
 * One id follows a checkout from the browser through the gateway, ms-order,
 * ms-product and onto the Kafka envelope, so a single grep (or Loki query)
 * reconstructs the whole story.
 *
 * Sources, in order of precedence:
 *   1. `x-correlation-id`  accepted only if it matches CORRELATION_ID_PATTERN
 *   2. `traceparent`       (W3C Trace Context) accepted only if strictly valid;
 *                          its 32-hex trace-id becomes the correlation id
 *   3. a freshly generated uuid
 * Anything malformed is IGNORED and replaced, never echoed: the id lands in
 * log lines and response headers, so it must not be able to carry newlines,
 * control characters or an unbounded string.
 */

export const CORRELATION_HEADER = 'x-correlation-id'
export const TRACEPARENT_HEADER = 'traceparent'

export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
/** W3C traceparent, version 00 layout: version-traceid-parentid-flags. */
export const TRACEPARENT_PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

declare module 'fastify' {
  interface FastifyRequest {
    /** Validated inbound id, or a generated one. Always set once the plugin is registered. */
    correlationId: string
    /** The validated inbound `traceparent`, or null (never forwarded when invalid). */
    traceparent: string | null
  }
}

/** The trace-id of a strictly valid traceparent, else null. */
export function parseTraceparent(raw: unknown): { traceId: string; header: string } | null {
  if (typeof raw !== 'string') return null
  const m = TRACEPARENT_PATTERN.exec(raw)
  if (!m) return null
  const [, version, traceId, parentId] = m
  // ff is reserved/invalid; all-zero ids are explicitly invalid in the spec.
  if (version === 'ff' || /^0+$/.test(traceId!) || /^0+$/.test(parentId!)) return null
  return { traceId: traceId!, header: raw }
}

export function isValidCorrelationId(raw: unknown): raw is string {
  return typeof raw === 'string' && CORRELATION_ID_PATTERN.test(raw)
}

export interface ResolvedCorrelation {
  correlationId: string
  traceparent: string | null
}

export function resolveCorrelation(headers: Record<string, unknown>): ResolvedCorrelation {
  const trace = parseTraceparent(headers[TRACEPARENT_HEADER])
  const inbound = headers[CORRELATION_HEADER]
  const correlationId = isValidCorrelationId(inbound)
    ? inbound
    : (trace?.traceId ?? crypto.randomUUID())
  return { correlationId, traceparent: trace?.header ?? null }
}

/**
 * The headers to put on an outgoing service-to-service call made while serving
 * `request`. Only validated values, so a forged header cannot be laundered
 * through this service.
 */
export function correlationHeaders(request: {
  correlationId: string
  traceparent: string | null
}): Record<string, string> {
  return {
    [CORRELATION_HEADER]: request.correlationId,
    ...(request.traceparent ? { [TRACEPARENT_HEADER]: request.traceparent } : {}),
  }
}

/**
 * onRequest hook: resolves the id, binds it to the request logger (child logger
 * field `correlationId`) and echoes it on the response. Registered first by
 * registerSecurity so even a rate-limited or unauthorised reply carries it.
 */
export const correlationPlugin = fp(
  async (server: FastifyInstance) => {
    server.decorateRequest('correlationId', '')
    server.decorateRequest('traceparent', null)

    server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const { correlationId, traceparent } = resolveCorrelation(request.headers)
      request.correlationId = correlationId
      request.traceparent = traceparent
      // request.log and reply.log are separate properties holding the same
      // logger; both must be rebound or "request completed" lacks the field.
      const bound = request.log.child({ correlationId })
      request.log = bound
      reply.log = bound
      void reply.header(CORRELATION_HEADER, correlationId)
    })
  },
  { name: 'correlation' }
)
