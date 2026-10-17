import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ErrorResponse, Strict, Type, type Static } from '@ecommerce/shared-security'
import type { AnalyticsStore } from '../aggregates/store'
import { funnelView, revenueView, summaryView, topProductsView } from '../aggregates/views'
import {
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
 * Nothing here touches Kafka. These routes read Postgres and answer even when the
 * broker has never been reachable; the view is then simply empty and says so.
 */

/** Bounds on `?hours`. 1 week of hourly buckets is 168 points: plenty for a chart. */
const MAX_HOURS = 24 * 7
const DEFAULT_HOURS = 24
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 10

// Out-of-range values are a 400 (never clamped): a caller who asked for
// ?hours=99999 must not get a 200 whose window is not the one they requested.
const RevenueQuery = Strict({
  hours: Type.Integer({ minimum: 1, maximum: MAX_HOURS, default: DEFAULT_HOURS }),
})
const TopProductsQuery = Strict({
  limit: Type.Integer({ minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT }),
})
const NoQuery = Strict({})

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
      config: { policy: { permission: 'analytics:read' } },
      schema: {
        querystring: NoQuery,
        tags: ['analytics'],
        description:
          'Headline totals across all history, with the real extent of the data as ' +
          'windowStart/windowEnd. averageOrderValue and payments.successRate are null ' +
          'when their denominator is zero — never 0.',
        response: { 200: summaryResponseSchema, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async () => summaryView(store)
  )

  server.get(
    '/api/v1/analytics/revenue',
    {
      config: { policy: { permission: 'analytics:read' }, rateTier: 'expensive' },
      schema: {
        tags: ['analytics'],
        description:
          'Hourly order and revenue series for the last ?hours hours (UTC hour ' +
          'buckets). Hours with no data are absent from the series rather than ' +
          'zero-filled.',
        querystring: RevenueQuery,
        response: {
          200: revenueResponseSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: Static<typeof RevenueQuery> }>) => {
      return revenueView(store, request.query.hours)
    }
  )

  server.get(
    '/api/v1/analytics/top-products',
    {
      config: { policy: { permission: 'analytics:read' }, rateTier: 'expensive' },
      schema: {
        tags: ['analytics'],
        description:
          'Products ranked by units ordered, over all history. averageUnitPrice is ' +
          'null for a product with no counted units.',
        querystring: TopProductsQuery,
        response: {
          200: topProductsResponseSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: Static<typeof TopProductsQuery> }>) => {
      return topProductsView(store, request.query.limit)
    }
  )

  server.get(
    '/api/v1/analytics/funnel',
    {
      config: { policy: { permission: 'analytics:read' } },
      schema: {
        querystring: NoQuery,
        tags: ['analytics'],
        description:
          'The five funnel counts (created, confirmed, cancelled, reserved, ' +
          'insufficient) plus conversion ratios. Every ratio is null when its ' +
          'denominator is zero — never 0 and never NaN.',
        response: { 200: funnelResponseSchema, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async () => funnelView(store)
  )
}
