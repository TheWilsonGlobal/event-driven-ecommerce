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
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'

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

/**
 * Repo-root `logs/` directory, resolved the same way regardless of which
 * package's `dist/` this runs from (mirrors how each service resolves its own
 * `.env`/data paths relative to `__dirname`, not the process cwd).
 *
 * Every service's dist output lives at `packages/<name>/dist/index.js`
 * (services) or `packages/shared/utils/dist/logger.js` (here) — three levels
 * up from either lands at the repo root.
 */
export function getLogsDir(): string {
  return path.resolve(__dirname, '../../../../logs')
}

/** Absolute path to today's log file for a given service, e.g. `ms-user-2026-09-19.log`. */
export function getLogFilePath(service: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10) // YYYY-MM-DD
  return path.join(getLogsDir(), `${service}-${day}.log`)
}

export interface LoggerOptions {
  /** Value of the `service` label on every log line, e.g. "ms-product". */
  service: string
  /** Log level. Defaults to LOG_LEVEL, then "info". */
  level?: string
  /** Environment to read configuration from. Defaults to process.env. */
  env?: NodeJS.ProcessEnv
  /**
   * Result of a pre-flight reachability check against Loki's `/ready`
   * endpoint (see `probeLokiReachable` below), run once at boot before
   * `fastify()` is constructed. When `false`, the Loki transport target is
   * skipped entirely — console/file logging is unaffected either way.
   *
   * Omit this (or pass `true`) to keep the old always-attach behavior.
   * Passed explicitly by every service's bootstrap so a downed Loki produces
   * one quiet log line at boot instead of a per-log-line ECONNREFUSED stack
   * trace for the life of the process.
   */
  lokiReachable?: boolean
}

/**
 * Quick TCP-level reachability check for Loki, run once at boot. Not a full
 * HTTP GET /ready — a raw connect is enough to know "is anything listening
 * here", and avoids pulling in a fetch/AbortController round trip before the
 * server has even started.
 */
export function probeLokiReachable(lokiHost: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let url: URL
    try {
      url = new URL(lokiHost)
    } catch {
      resolve(false)
      return
    }
    const socket = net.createConnection({
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      timeout: timeoutMs,
    })
    const finish = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
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
  const lokiEnabled = env.LOKI_ENABLED !== 'false' && options.lokiReachable !== false
  const lokiHost = env.LOKI_HOST || 'http://localhost:3100'

  // Printed once at boot (never per log line) so an unreachable Loki is
  // still discoverable without the ECONNREFUSED spam a downed target used
  // to produce for the life of the process.
  if (env.LOKI_ENABLED !== 'false' && options.lokiReachable === false) {
    // eslint-disable-next-line no-console
    console.log(
      `[${options.service}] Loki unreachable at ${lokiHost} — shipping skipped for this run. ` +
        'Console + file logging are unaffected. Start it with: cd ../infra-hub && docker compose --profile logging up -d'
    )
  }

  const prettyTarget = {
    target: 'pino-pretty',
    options: { colorize: true },
  }

  // Real, rotate-by-day log file under <repo-root>/logs, read back by each
  // service's own GET /api/v1/logs* routes. `pino/file` does not create its
  // parent directory, so it is ensured here rather than left to fail silently
  // on first write. NDJSON (pino's default), never pino-pretty's formatted
  // text — the log-listing routes scan for `"level":50/40` substrings, which
  // only holds for the raw JSON form.
  const logFilePath = getLogFilePath(options.service)
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
  const fileTarget = {
    target: 'pino/file',
    options: { destination: logFilePath, mkdir: true },
  }

  if (!lokiEnabled) {
    return { level, transport: { targets: [prettyTarget, fileTarget] } }
  }

  return {
    level,
    transport: {
      // All targets receive every line. pino runs transports in a worker
      // thread, so a slow disk or unreachable Loki does not block request
      // handling.
      targets: [
        prettyTarget,
        fileTarget,
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
