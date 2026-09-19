// A live inventory of every route a Fastify instance actually registered.
//
// The admin's APIs tab used to read this from @fastify/swagger's generated
// document. Swagger only describes routes registered with `server.get/post/...`
// and a schema — it has no visibility into routes a plugin installs on the
// underlying router (e.g. @fastify/http-proxy's proxy routes), so it silently
// under-reports the gateway's real surface. `onRoute` fires for every route the
// router holds regardless of how it got there, which makes this the honest
// source for "what routes does this process actually answer to" — Swagger's
// document is used only to attach a human-readable summary where one exists,
// never as the list of routes itself.
//
// One registry per process: each service calls createRouteRegistry() once at
// boot and attaches its `onRoute` hook before registering any other route, so
// entries added later are not missed.

import type { FastifyInstance } from 'fastify'

export interface RegisteredRoute {
  method: string
  path: string
}

/**
 * Routes that exist in the router but are not part of the API surface: the
 * wildcard catch-all each proxy/static mount installs under the hood.
 */
function isInfrastructureRoute(url: string): boolean {
  return url === '*' || url.endsWith('/*')
}

export interface RouteRegistry {
  getRoutes: () => RegisteredRoute[]
}

/**
 * Attaches the `onRoute` hook and returns a handle to read the accumulated
 * list back. Must be called before any other `server.register`/`server.get`
 * call — `onRoute` only fires for routes registered after the hook is added.
 */
export function createRouteRegistry(server: FastifyInstance): RouteRegistry {
  const routes: RegisteredRoute[] = []

  server.addHook('onRoute', (route) => {
    if (isInfrastructureRoute(route.url)) return
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      // Fastify registers a HEAD alongside every GET (exposeHeadRoutes) — an
      // implementation detail an operator did not declare, so it is not
      // reported as a distinct endpoint.
      if (method === 'HEAD') continue
      if (routes.some((r) => r.method === method && r.path === route.url)) continue
      routes.push({ method, path: route.url })
    }
  })

  return { getRoutes: () => routes.slice() }
}
