/**
 * Smoke test: every module ms-user's entry point (src/index.ts) depends on
 * loads without throwing.
 *
 * ms-user/src/index.ts inlines server construction AND server.listen() in one
 * top-level bootstrap() call that runs on import, so importing index.ts
 * itself would try to bind the real port (already in use by the dev server).
 * Instead this imports the route-registration modules it pulls in directly —
 * catching a broken import/re-export/circular import (including the
 * generated Prisma client and @ecommerce/shared-database) without touching
 * the network.
 */
import { registerSchemaRoutes, registerLogRoutes } from '../diagnostics'
import { PrismaClient } from '../../node_modules/.prisma-ms-user/client'
import { loadDatabaseConfig, SEED_USERS } from '@ecommerce/shared-database'
import {
  registerMetrics,
  buildLoggerOptions,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'

describe('ms-user module graph', () => {
  it('loads diagnostics/index without throwing', () => {
    expect(typeof registerSchemaRoutes).toBe('function')
    expect(typeof registerLogRoutes).toBe('function')
  })

  it('loads the generated Prisma client without throwing', () => {
    expect(typeof PrismaClient).toBe('function')
  })

  it('loads @ecommerce/shared-database exports used by index.ts', () => {
    expect(typeof loadDatabaseConfig).toBe('function')
    expect(Array.isArray(SEED_USERS)).toBe(true)
  })

  it('loads @ecommerce/shared-utils exports used by index.ts', () => {
    expect(typeof registerMetrics).toBe('function')
    expect(typeof buildLoggerOptions).toBe('function')
    expect(typeof createRouteRegistry).toBe('function')
    expect(typeof registerEndpointsRoute).toBe('function')
  })
})
