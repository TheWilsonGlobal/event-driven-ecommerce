/**
 * Shared Fastify logger configuration: pretty terminal output, plus optional
 * shipping to Loki.
 *
 * Each service calls `buildLoggerOptions({ service: 'ms-product' })` and passes
 * the result as Fastify's `logger` option. With Loki enabled, every log line
 * goes to BOTH the terminal and Loki, so the existing `pnpm run dev` workflow
 * is unchanged and logs additionally become queryable in Grafana.
 *
 * Loki runs in infra-hub behind a compose profile:
 *
 *     cd ../infra-hub && docker compose --profile logging up -d
 *
 * Shipping happens in-process via pino-loki rather than by scraping files or
 * using Docker's log driver, because these services run on the HOST via pnpm —
 * there is no container whose stdout Docker could collect.
 */

import type { FastifyLoggerOptions } from 'fastify'
import type { PinoLoggerOptions } from 'fastify/types/logger'

/**
 * The logger config shape Fastify accepts for a default (HTTP/1) server.
 *
 * Deliberately NOT `FastifyServerOptions['logger']`: that union also admits a
 * pre-built `Logger` instance, and a value of the whole union makes TypeScript
 * fall through to the HTTP/2 `fastify()` overload — the result is then typed as
 * an HTTP/2 instance and no longer assignable to `FastifyInstance`. Naming the
 * options branch alone keeps the default overload selected.
 */
type PinoLoggerConfig = FastifyLoggerOptions & PinoLoggerOptions

export interface LoggerOptions {
  /** Value of the `service` label on every log line, e.g. "ms-product". */
  service: string
  /** Log level. Defaults to LOG_LEVEL, then "info". */
  level?: string
  /** Environment to read configuration from. Defaults to process.env. */
  env?: NodeJS.ProcessEnv
}

/**
 * Builds Fastify's `logger` option.
 *
 * Returns a plain config object rather than a constructed logger so Fastify
 * owns the logger's lifecycle, as it did before Loki was introduced.
 */
export function buildLoggerOptions(options: LoggerOptions): PinoLoggerConfig {
  const env = options.env ?? process.env
  const level = options.level ?? env.LOG_LEVEL ?? 'info'

  // Explicit opt-OUT rather than opt-in: a developer who starts the logging
  // profile should get logs in Grafana without also having to discover a flag.
  // Transport construction below is failure-tolerant, so leaving this on when
  // Loki is down costs nothing.
  const lokiEnabled = env.LOKI_ENABLED !== 'false'
  const lokiHost = env.LOKI_HOST || 'http://localhost:3100'

  const prettyTarget = {
    target: 'pino-pretty',
    options: { colorize: true },
  }

  if (!lokiEnabled) {
    return { level, transport: prettyTarget }
  }

  return {
    level,
    transport: {
      // Both targets receive every line. pino runs transports in a worker
      // thread, so a slow or unreachable Loki does not block request handling.
      targets: [
        prettyTarget,
        {
          target: 'pino-loki',
          options: {
            host: lokiHost,
            // Labels are the ONLY thing Loki indexes, and every distinct
            // combination creates a stream. Keep them low-cardinality and
            // bounded: never a request id, user id or URL. The log body stays
            // searchable with `|=` regardless.
            labels: {
              service: options.service,
              env: env.NODE_ENV || 'development',
            },
            // NOTE: do NOT add `propsToLabels: ['level']`. pino-loki already
            // emits a readable `level` label ("info"/"error") from its own
            // level mapping, but it spreads propsToLabels AFTER that — so
            // promoting `level` overwrites the readable value with pino's raw
            // numeric code and you get {level="30"} instead of {level="info"}.
            //
            // A custom pino `formatters.level` is not an alternative: pino
            // throws "option.transport.targets do not allow custom level
            // formatters" whenever more than one target is present, and there
            // are two here (pretty + loki).
            // Batch pushes instead of one HTTP request per log line. This is an
            // OBJECT, not `true` — a boolean silently disables batching.
            batching: { interval: 5 },
            // Print transport failures to stderr rather than swallowing them.
            // Without this, a misconfigured host looks exactly like "no logs
            // were produced", which is a miserable thing to debug.
            silenceErrors: false,
            // Loki 3 requires a tenant header only when auth_enabled is true;
            // ours is false, so no basicAuth/tenant is configured here.
          },
        },
      ],
    },
  }
}
