/**
 * Smoke test: every module ms-order's entry point (src/index.ts) depends on
 * loads without throwing.
 *
 * ms-order/src/index.ts inlines server construction AND server.listen() in
 * one top-level bootstrap() call that runs on import, so importing index.ts
 * itself would try to bind the real port (already in use by the dev server).
 * Instead this imports the route-registration/support modules it pulls in
 * directly — catching a broken import/re-export/circular import (including
 * the generated Prisma client, the BullMQ queues module group, and
 * @ecommerce/shared-database) without touching the network or Redis.
 *
 * queues/redisConnection.ts constructs an ioredis client at module load, but
 * by design (see its own docstring) nothing there throws at import time even
 * when Redis is unreachable — connection failures surface later as 503s from
 * the queue endpoints, not as import-time exceptions — so this is still safe
 * to import without a running Redis.
 */
import { registerSchemaRoutes, registerLogRoutes } from '../diagnostics'
import { PrismaClient } from '../../node_modules/.prisma-ms-order/client'
import { paymentMethodToProvider, paymentStatusToPaymentRowStatus } from '../seedOrders'
import { QueueManager, registerQueueRoutes, QUEUE_DEFINITIONS, redisEnabled } from '../queues'
import { createKeyValueStore, loadDatabaseConfig } from '@ecommerce/shared-database'
import {
  registerMetrics,
  buildLoggerOptions,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'

describe('ms-order module graph', () => {
  it('loads diagnostics/index without throwing', () => {
    expect(typeof registerSchemaRoutes).toBe('function')
    expect(typeof registerLogRoutes).toBe('function')
  })

  it('loads the generated Prisma client without throwing', () => {
    expect(typeof PrismaClient).toBe('function')
  })

  it('loads seedOrders without throwing', () => {
    expect(typeof paymentMethodToProvider).toBe('function')
    expect(typeof paymentStatusToPaymentRowStatus).toBe('function')
  })

  it('loads the queues module group without throwing', () => {
    expect(typeof QueueManager).toBe('function')
    expect(typeof registerQueueRoutes).toBe('function')
    expect(Array.isArray(QUEUE_DEFINITIONS)).toBe(true)
    expect(typeof redisEnabled).toBe('boolean')
  })

  it('loads @ecommerce/shared-database exports used by index.ts', () => {
    expect(typeof createKeyValueStore).toBe('function')
    expect(typeof loadDatabaseConfig).toBe('function')
  })

  it('loads @ecommerce/shared-utils exports used by index.ts', () => {
    expect(typeof registerMetrics).toBe('function')
    expect(typeof buildLoggerOptions).toBe('function')
    expect(typeof createRouteRegistry).toBe('function')
    expect(typeof registerEndpointsRoute).toBe('function')
  })
})
