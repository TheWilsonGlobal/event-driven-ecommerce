import type { FastifyInstance } from 'fastify'
import type { AnalyticsStore } from '../aggregates/store'
import { registerEventRoutes } from '../events'
import { registerAnalyticsRoutes } from './analytics'
import { registerHealthRoutes, type HealthRouteDeps } from './health'

export { registerHealthRoutes, type HealthRouteDeps } from './health'
export { registerAnalyticsRoutes, type AnalyticsRouteDeps } from './analytics'

export interface ServiceRouteDeps extends HealthRouteDeps {
  store: AnalyticsStore
  consumer: HealthRouteDeps['consumer'] & Parameters<typeof registerEventRoutes>[1]
}

/**
 * Every HTTP route ms-analytics itself owns, in one place so the production
 * bootstrap and the security tests register exactly the same set.
 */
export function registerServiceRoutes(server: FastifyInstance, deps: ServiceRouteDeps): void {
  registerHealthRoutes(server, deps)
  registerAnalyticsRoutes(server, { store: deps.store })
  registerEventRoutes(server, deps.consumer)
}
