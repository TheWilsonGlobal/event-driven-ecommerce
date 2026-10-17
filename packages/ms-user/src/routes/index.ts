import type { FastifyInstance } from 'fastify'
import type { DatabaseConfiguration } from '@ecommerce/shared-database'
import { registerEndpointsRoute, type RouteRegistry } from '@ecommerce/shared-utils'
import type { PrismaClient } from '../../node_modules/.prisma-ms-user/client'
import { registerSchemaRoutes, registerLogRoutes } from '../diagnostics'
import type { SupabaseAuth } from '../supabase'
import { registerAuthRoutes } from './auth'
import { registerHealthRoute } from './health'
import { registerUserRoutes } from './users'

export interface RouteDeps {
  prisma: PrismaClient
  supabase: SupabaseAuth
  dbConfig: DatabaseConfiguration
  routeRegistry: RouteRegistry
}

/**
 * Every ms-user route, in one call, so the production entry point and the test
 * suite register exactly the same set (and the policy-coverage test therefore
 * covers what really runs).
 */
export function registerRoutes(server: FastifyInstance, deps: RouteDeps): void {
  const { prisma, supabase, dbConfig, routeRegistry } = deps
  registerHealthRoute(server, dbConfig, prisma)
  registerUserRoutes(server, { prisma, supabase })
  registerAuthRoutes(server, { prisma, supabase })

  registerSchemaRoutes(server, prisma)
  registerLogRoutes(server)
  registerEndpointsRoute(server, routeRegistry, 'ms-user')
}
