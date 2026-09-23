import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AnalyticsStore } from '../aggregates/store'
import { funnelView, revenueView, summaryView, topProductsView } from '../aggregates/views'
import {
  badRequestSchema,
  funnelResponseSchema,
  revenueResponseSchema,
  summaryResponseSchema,
  topProductsResponseSchema,
} from './schemas'

/**
 * The read API over the analytics aggregates.
 *
 * Every response carries `eventsProcessed` and a nullable `lastEventAt`, so a
 * caller can always distinguish "I have processed nothing yet" from "every
 * value I measured is zero". Those two states produce identical counts and
 * would otherwise be indistinguishable — the same defect the queue and event
 * endpoints were built to avoid.
 *
 * Nothing here touches Kafka. These routes read NeDB and answer even when the
 * broker has never been reachable; the view is then simply empty and says so.
 */

/** Bounds on `?hours`. 1 week of hourly buckets is 168 points — plenty for a chart. */
const MIN_HOURS = 1
const MAX_HOURS = 24 * 7
const DEFAULT_HOURS = 24

const MIN_LIMIT = 1
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 10

/**
 * Parses a bounded integer query parameter.
 *
 * Returns a discriminated result rather than clamping silently: a caller who
 * asked for `?hours=99999` gets a 400 telling them the bound, instead of a
 * 200 whose window quietly is not the one they requested. Clamping would make
 * the response a correct answer to a question nobody asked.
 */
function parseBounded(
  raw: unknown,
  { name, min, max, fallback }: { name: string; min: number; max: number; fallback: number }
): { ok: true; value: number } | { ok: false; message: string } {
  if (raw === undefined || raw === '') {
    return { ok: true, value: fallback }
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, message: `${name} must be an integer` }
  }
  if (value < min || value > max) {
    return { ok: false, message: `${name} must be between ${min} and ${max}` }
  }
  return { ok: true, value }
}

export interface AnalyticsRouteDeps {
  store: AnalyticsStore
}

export function registerAnalyticsRoutes(
  server: FastifyInstance,
  { store }: AnalyticsRouteDeps
): void {
  server.get(
    '/api/v1/analytics/summary',
    {
      schema: {
        tags: ['analytics'],
        description:
          'Headline totals across all history, with the real extent of the data as ' +
          'windowStart/windowEnd. averageOrderValue and payments.successRate are null ' +
          'when their denominator is zero — never 0.',
        response: { 200: summaryResponseSchema },
      },
    },
    async () => summaryView(store)
  )

  server.get(
    '/api/v1/analytics/revenue',
    {
      schema: {
        tags: ['analytics'],
        description:
          'Hourly order and revenue series for the last ?hours hours (UTC hour ' +
          'buckets). Hours with no data are absent from the series rather than ' +
          'zero-filled.',
        querystring: {
          type: 'object',
          properties: {
            hours: {
              type: 'integer',
              minimum: MIN_HOURS,
              maximum: MAX_HOURS,
              default: DEFAULT_HOURS,
            },
          },
        },
        response: { 200: revenueResponseSchema, 400: badRequestSchema },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: { hours?: string | number } }>,
      reply: FastifyReply
    ) => {
      const hours = parseBounded(request.query.hours, {
        name: 'hours',
        min: MIN_HOURS,
        max: MAX_HOURS,
        fallback: DEFAULT_HOURS,
      })
      if (!hours.ok) {
        return reply.status(400).send({ error: 'Bad Request', message: hours.message })
      }
      return revenueView(store, hours.value)
    }
  )

  server.get(
    '/api/v1/analytics/top-products',
    {
      schema: {
        tags: ['analytics'],
        description:
          'Products ranked by units ordered, over all history. averageUnitPrice is ' +
          'null for a product with no counted units.',
        querystring: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              minimum: MIN_LIMIT,
              maximum: MAX_LIMIT,
              default: DEFAULT_LIMIT,
            },
          },
        },
        response: { 200: topProductsResponseSchema, 400: badRequestSchema },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: { limit?: string | number } }>,
      reply: FastifyReply
    ) => {
      const limit = parseBounded(request.query.limit, {
        name: 'limit',
        min: MIN_LIMIT,
        max: MAX_LIMIT,
        fallback: DEFAULT_LIMIT,
      })
      if (!limit.ok) {
        return reply.status(400).send({ error: 'Bad Request', message: limit.message })
      }
      return topProductsView(store, limit.value)
    }
  )

  server.get(
    '/api/v1/analytics/funnel',
    {
      schema: {
        tags: ['analytics'],
        description:
          'The five funnel counts (created, confirmed, cancelled, reserved, ' +
          'insufficient) plus conversion ratios. Every ratio is null when its ' +
          'denominator is zero — never 0 and never NaN.',
        response: { 200: funnelResponseSchema },
      },
    },
    async () => funnelView(store)
  )
}
