/**
 * Prometheus metrics, shared by every Fastify service in the workspace.
 *
 * Each service calls `registerMetrics(server, { service: 'ms-product' })` once
 * during bootstrap. That installs an onResponse hook recording request counts
 * and latency, and exposes GET /metrics in the Prometheus text format.
 *
 * Prometheus runs in infra-hub behind a compose profile:
 *
 *     cd ../infra-hub && docker compose --profile monitoring up -d
 *
 * It scrapes the app services over host.docker.internal because they run on the
 * HOST via pnpm, not as containers on infra-network.
 *
 * Nothing here talks to Prometheus — scraping is strictly pull-based, so a
 * service is fully functional whether or not anything ever collects from it.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client'

export interface MetricsOptions {
  /** Value of the `service` label on every metric, e.g. "ms-product". */
  service: string
  /** Route to expose the scrape endpoint on. Default: /metrics */
  path?: string
  /** Include process/GC/heap metrics. Default: true. */
  collectDefaults?: boolean
}

export interface ServiceMetrics {
  registry: Registry
  httpRequestsTotal: Counter<string>
  httpRequestDuration: Histogram<string>
}

/**
 * Buckets in SECONDS, matching prom-client's convention.
 *
 * The default buckets top out at 10s, which wastes most of their resolution on
 * a service whose requests are largely sub-100ms. These concentrate detail in
 * the 5ms–1s band where these services actually live, while still catching the
 * slow tail.
 */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]

/**
 * Registers metrics collection and the scrape endpoint on a Fastify instance.
 *
 * Returns the metric handles so a service can record its own domain metrics
 * against the same registry.
 */
export function registerMetrics(server: FastifyInstance, options: MetricsOptions): ServiceMetrics {
  const path = options.path ?? '/metrics'

  // A per-service registry rather than the global default one: two services in
  // the same process during tests would otherwise throw on duplicate metric
  // registration, and the global registry makes metrics leak between them.
  const registry = new Registry()
  registry.setDefaultLabels({ service: options.service })

  if (options.collectDefaults !== false) {
    collectDefaultMetrics({ register: registry })
  }

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests handled, by method, route and status code.',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  })

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds, by method and route.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: LATENCY_BUCKETS,
    registers: [registry],
  })

  server.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    // Label with the ROUTE PATTERN (/api/v1/products/:id), never req.url. Using
    // the raw URL would mint a new time series per product id — unbounded
    // cardinality, the standard way to take down a Prometheus server.
    const route = req.routeOptions?.url ?? 'unknown'

    // Scraping itself is not application traffic; counting it makes the request
    // rate track the scrape interval rather than real load.
    if (route === path) return

    const labels = {
      method: req.method,
      route,
      status_code: String(reply.statusCode),
    }
    httpRequestsTotal.inc(labels)
    // Fastify measures this for us in MILLISECONDS; Prometheus convention is
    // seconds, hence the division.
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000)
  })

  server.get(
    path,
    {
      schema: {
        tags: ['monitoring'],
        description: 'Prometheus scrape endpoint (OpenMetrics text format).',
      },
      // Keep the scrape endpoint out of the public API docs; it is infra, and
      // Swagger renders the plaintext body badly anyway.
      hide: true,
    } as never,
    async (_req, reply) => {
      reply.header('Content-Type', registry.contentType)
      return registry.metrics()
    }
  )

  return { registry, httpRequestsTotal, httpRequestDuration }
}
