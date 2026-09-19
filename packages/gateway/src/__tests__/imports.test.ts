/**
 * Smoke test: every module gateway's entry point (src/index.ts) depends on
 * loads without throwing.
 *
 * gateway/src/index.ts inlines server construction AND server.listen() in one
 * top-level bootstrap() call that runs on import, so importing index.ts
 * itself would try to bind the real port (already in use by the dev server).
 * Instead this imports the route-registration modules it pulls in directly —
 * catching a broken import/re-export/circular import without touching the
 * network.
 */
import { registerLogRoutes } from '../diagnostics'
import {
  registerMetrics,
  buildLoggerOptions,
  createRouteRegistry,
  registerEndpointsRoute,
} from '@ecommerce/shared-utils'

describe('gateway module graph', () => {
  it('loads diagnostics/index without throwing', () => {
    expect(typeof registerLogRoutes).toBe('function')
  })

  it('loads @ecommerce/shared-utils exports used by index.ts', () => {
    expect(typeof registerMetrics).toBe('function')
    expect(typeof buildLoggerOptions).toBe('function')
    expect(typeof createRouteRegistry).toBe('function')
    expect(typeof registerEndpointsRoute).toBe('function')
  })
})
