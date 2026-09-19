import type { FastifyInstance } from 'fastify'

// GET /api/v1/services — the gateway-reported health rollup.
//
// This is deliberately server-side truth, not a duplicate of the admin's own
// client-side probing (useServiceProbes.ts): the browser already pings every
// service's /health directly, including the two frontends (Next.js client,
// admin itself) and RustFS, which this route has no way to probe the same
// way. What only the gateway can answer honestly is "can *I*, the ingress
// this traffic actually flows through, reach each backend microservice" —
// a real network path a browser-side probe (typically same-origin via Vite
// dev proxies, or a different NIC/route in a containerized deployment) does
// not necessarily exercise. Each upstream's own /health payload is not
// re-validated against a schema here: they're independent services and this
// route reports whatever they say, or that they didn't answer.

interface UpstreamService {
  name: string
  url: string
}

interface GatewayServiceHealth {
  name: string
  url: string
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE'
  statusCode: number | null
  latencyMs: number
  error: string | null
}

const REQUEST_TIMEOUT_MS = 2000

async function probe(service: UpstreamService): Promise<GatewayServiceHealth> {
  const start = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${service.url}/health`, { signal: controller.signal })
    const latencyMs = Date.now() - start
    return {
      name: service.name,
      url: service.url,
      status: res.ok ? 'HEALTHY' : 'DEGRADED',
      statusCode: res.status,
      latencyMs,
      error: res.ok ? null : `HTTP ${res.status}`,
    }
  } catch (err) {
    return {
      name: service.name,
      url: service.url,
      status: 'OFFLINE',
      statusCode: null,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unreachable',
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export function registerServicesRoute(
  server: FastifyInstance,
  upstreams: UpstreamService[]
): void {
  server.get(
    '/api/v1/services',
    {
      schema: {
        tags: ['services'],
        description:
          'Live health of every backend microservice this gateway proxies to, probed ' +
          "server-side by this process (never the browser) against each service's own " +
          '/health. Reports the gateway\'s own real network path, which can differ from a ' +
          "browser-side probe's. Does not cover the frontend apps or object storage — those " +
          'have no upstream this gateway proxies to and are probed client-side instead.',
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
                    status: { type: 'string', enum: ['HEALTHY', 'DEGRADED', 'OFFLINE'] },
                    statusCode: { type: ['number', 'null'] },
                    latencyMs: { type: 'number' },
                    error: { type: ['string', 'null'] },
                  },
                  required: ['name', 'url', 'status', 'statusCode', 'latencyMs', 'error'],
                },
              },
              summary: {
                type: 'object',
                properties: {
                  serviceCount: { type: 'number' },
                  healthyCount: { type: 'number' },
                  checkedAt: { type: 'string', format: 'date-time' },
                },
                required: ['serviceCount', 'healthyCount', 'checkedAt'],
              },
            },
            required: ['services', 'summary'],
          },
        },
      },
    },
    async () => {
      const services = await Promise.all(upstreams.map(probe))
      return {
        services,
        summary: {
          serviceCount: services.length,
          healthyCount: services.filter((s) => s.status === 'HEALTHY').length,
          checkedAt: new Date().toISOString(),
        },
      }
    }
  )
}
