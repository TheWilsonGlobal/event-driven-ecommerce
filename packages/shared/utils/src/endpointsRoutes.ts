// GET /api/v1/endpoints — the route list this process actually registered
// (from the route registry, see routeRegistry.ts), enriched with the
// human-readable description @fastify/swagger derived for a matching route.
//
// Swagger is enrichment only, never the source of the list itself: a route
// installed by a plugin (e.g. @fastify/http-proxy) has no schema of its own
// for Swagger to describe, but it is still a real route this process answers
// to, so it is still reported — just with documented: false.

import type { FastifyInstance } from 'fastify'
import type { RouteRegistry } from './routeRegistry'

export interface EndpointView {
  method: string
  path: string
  summary: string | undefined
  documented: boolean
}

export interface EndpointsData {
  service: string
  endpoints: EndpointView[]
  summary: {
    endpointCount: number
    documentedCount: number
    methodCounts: Record<string, number>
  }
}

interface SwaggerOperation {
  description?: string
  summary?: string
}

interface SwaggerDocument {
  paths?: Record<string, Partial<Record<string, SwaggerOperation>>>
}

/** Fastify writes params as `:id`; this normalizes for a straight string match. */
function normalizePath(path: string): string {
  return path.replace(/\/$/, '') || '/'
}

export function registerEndpointsRoute(
  server: FastifyInstance,
  registry: RouteRegistry,
  service: string
): void {
  server.get(
    '/api/v1/endpoints',
    {
      schema: {
        tags: ['endpoints'],
        description:
          'Every route this process actually registered (recorded via an onRoute hook at ' +
          "registration time), enriched with the description this service's own OpenAPI " +
          'schema declares where one exists. Routes installed by a plugin (e.g. a proxy) ' +
          'carry no schema of their own and are reported with documented: false rather than ' +
          'omitted.',
        response: {
          200: {
            type: 'object',
            properties: {
              service: { type: 'string' },
              endpoints: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    method: { type: 'string' },
                    path: { type: 'string' },
                    summary: { type: 'string' },
                    documented: { type: 'boolean' },
                  },
                  required: ['method', 'path', 'documented'],
                },
              },
              summary: {
                type: 'object',
                properties: {
                  endpointCount: { type: 'number' },
                  documentedCount: { type: 'number' },
                  methodCounts: { type: 'object', additionalProperties: { type: 'number' } },
                },
                required: ['endpointCount', 'documentedCount', 'methodCounts'],
              },
            },
            required: ['service', 'endpoints', 'summary'],
          },
        },
      },
    },
    async () => {
      const routes = registry.getRoutes()

      // server.swagger() (decorated by @fastify/swagger, a peer dependency of
      // the services that call this — not declared here to avoid pulling that
      // whole package into shared-utils just for one method's type) returns
      // the document built from every route registered with a `schema` — used
      // only to look up a description for a route this registry already knows
      // is real.
      const swaggerFn = (server as unknown as { swagger?: () => unknown }).swagger
      const spec = (swaggerFn ? swaggerFn() : {}) as SwaggerDocument
      const byPath = new Map<string, Partial<Record<string, SwaggerOperation>>>()
      for (const [specPath, ops] of Object.entries(spec.paths ?? {})) {
        byPath.set(normalizePath(specPath), ops)
      }

      const endpoints: EndpointView[] = routes
        .map((r) => {
          const op = byPath.get(normalizePath(r.path))?.[r.method.toLowerCase()]
          const summary = op?.description ?? op?.summary
          return {
            method: r.method.toUpperCase(),
            path: r.path,
            summary,
            documented: Boolean(summary),
          }
        })
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))

      const methodCounts: Record<string, number> = {}
      for (const e of endpoints) methodCounts[e.method] = (methodCounts[e.method] ?? 0) + 1

      return {
        service,
        endpoints,
        summary: {
          endpointCount: endpoints.length,
          documentedCount: endpoints.filter((e) => e.documented).length,
          methodCounts,
        },
      }
    }
  )
}
