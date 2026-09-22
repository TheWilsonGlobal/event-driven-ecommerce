import type { FastifyInstance } from 'fastify'

// GET /api/v1/topology — the static service registry every port label in
// this codebase should be reading from, rather than hardcoding a number.
//
// Deliberately separate from /api/v1/services (servicesRoutes.ts): that route
// PROBES each upstream's live health and explicitly does not cover RustFS or
// the two frontends -- a browser-side probe already covers those (see its own
// doc comment). This route does the opposite job: it reports the CONFIGURED
// origin of every service in the stack, probed or not, so a client-side
// component (the storefront footer, an admin card) has one place to ask
// "what port is X actually on" instead of typing a number that goes stale the
// next time a port moves -- which is exactly what happened when RustFS moved
// off 9000/9001 to 6380/6381 on 2026-09-22 and StorefrontFooter.tsx's literal
// "RustFS: 9000" quietly stopped being true.
export interface ServiceLocation {
  name: string
  url: string
}

export function registerTopologyRoute(server: FastifyInstance, services: ServiceLocation[]): void {
  server.get(
    '/api/v1/topology',
    {
      schema: {
        tags: ['services'],
        description:
          'The configured origin of every service in the stack (gateway, both frontends, ' +
          'the three backend services, and RustFS). A static registry, not a health probe -- ' +
          'see /api/v1/services for live status. A client derives a port from the URL rather ' +
          'than hardcoding a number that goes stale the next time a port moves.',
        response: {
          200: {
            type: 'object',
            properties: {
              services: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    url: { type: 'string' },
                  },
                  required: ['name', 'url'],
                },
              },
            },
            required: ['services'],
          },
        },
      },
    },
    async () => ({ services })
  )
}
