// Shape of GET /api/v1/endpoints, served by each service itself.
//
// Built from the routes Fastify actually registered (an onRoute hook,
// recorded at registration time — see shared-utils/routeRegistry.ts), not
// from the OpenAPI document. A route a plugin installs (e.g. an http-proxy
// mount) is still reported here even though it carries no schema of its own
// for Swagger to describe.

export interface ApiEndpointView {
  method: string
  path: string
  summary?: string
  documented: boolean
}

export interface ApiEndpointsResponse {
  service: string
  endpoints: ApiEndpointView[]
  summary: {
    endpointCount: number
    documentedCount: number
    methodCounts: Record<string, number>
  }
}

export interface ApiServiceGroup {
  name: string
  title: string
  port: number
  docsUrl: string
  endpoints: ApiEndpointView[]
}
