import type { FastifyInstance, FastifyRequest } from 'fastify'
import { EntityId, ErrorResponse, Strict, Type, type Static } from '@ecommerce/shared-security'
import type { AnalyticsStore } from '../aggregates/store'
import { funnelView, revenueView, summaryView, topProductsView } from '../aggregates/views'
import { postgresRanking, type RankingEngine, type RankingResult } from '../rankings/engine'
import type { RankWindow } from '../rankings/windows'
import {
  funnelResponseSchema,
  rankingResponseSchema,
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

const RankingQuery = Strict({
  limit: Type.Integer({ minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT }),
  window: Type.Optional(Type.Union([Type.Literal('1h'), Type.Literal('24h'), Type.Literal('7d')])),
})
const CategoryParams = Strict({ categoryId: EntityId })

export interface AnalyticsRouteDeps {
  store: AnalyticsStore
  /** Redis rank engine; absent when the KV driver is not Redis (Postgres only). */
  rankings?: RankingEngine | undefined
}

export function registerAnalyticsRoutes(
  server: FastifyInstance,
  { store, rankings }: AnalyticsRouteDeps
): void {
  // Redis first; on ANY Redis/rebuild failure (or no Redis engine at all) the
  // answer comes from Postgres and says so in `source`.
  async function ranked(
    query: { window: RankWindow; limit: number; categoryId?: string },
    log: FastifyInstance['log']
  ): Promise<RankingResult> {
    if (rankings) {
      try {
        return await rankings.top(query)
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'rank engine unavailable, using Postgres')
      }
    }
    return postgresRanking(store, query)
  }

  server.get(
    '/api/v1/analytics/rankings/top-products',
    {
      config: { policy: { permission: 'analytics:read' }, rateTier: 'read' },
      schema: {
        tags: ['analytics'],
        description:
          'Real-time top products by units sold in the last window (1h, 24h or 7d; ' +
          'default 24h), from Redis sorted sets. `source` is redis or postgres; the ' +
          'Postgres fallback is the all-time view (windowApplied all-time).',
        querystring: RankingQuery,
        response: {
          200: rankingResponseSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: Static<typeof RankingQuery> }>) =>
      ranked({ window: request.query.window ?? '24h', limit: request.query.limit }, request.log)
  )

  server.get(
    '/api/v1/analytics/rankings/category/:categoryId',
    {
      config: { policy: { permission: 'analytics:read' }, rateTier: 'read' },
      schema: {
        tags: ['analytics'],
        description:
          'Top products by units sold within one category over the window (default 24h). ' +
          'Only orders whose lines carried a categoryId are counted. `source` is ' +
          'redis or postgres.',
        params: CategoryParams,
        querystring: RankingQuery,
        response: {
          200: rankingResponseSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: Static<typeof CategoryParams>
        Querystring: Static<typeof RankingQuery>
      }>
    ) => {
      const result = await ranked(
        {
          window: request.query.window ?? '24h',
          limit: request.query.limit,
          categoryId: request.params.categoryId,
        },
        request.log
      )
      return { ...result, categoryId: request.params.categoryId }
    }
  )

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
