import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { DB_POOL_MAX_DEFAULT } from '@ecommerce/shared-constants'

/**
 * Postgres access for the single Supabase database.
 *
 * One database, one SCHEMA per service (ms_user, ms_order, ms_product,
 * ms_inventory, ms_analytics). A service only ever touches its own schema;
 * cross-service data travels as Kafka events.
 *
 * ── Every table reference is schema-qualified ───────────────────────────────
 * The transaction pooler (pgbouncer, transaction mode) does not preserve
 * session state, so `SET search_path` / startup `options` cannot be relied on.
 * Code therefore writes `ms_inventory.reservations`, never bare `reservations`.
 *
 * ── The `?schema=` URL parameter ────────────────────────────────────────────
 * Prisma reads `?schema=`; `pg` does not know it. `parsePgUrl` strips it (and
 * `pgbouncer`) before the URL reaches `pg`, and returns the schema separately.
 */

export type ServiceName = 'user' | 'order' | 'product' | 'inventory' | 'analytics'

export const SERVICE_SCHEMAS: Record<ServiceName, string> = {
  user: 'ms_user',
  order: 'ms_order',
  product: 'ms_product',
  inventory: 'ms_inventory',
  analytics: 'ms_analytics',
}

export interface ParsedPgUrl {
  connectionString: string
  schema: string | undefined
}

export function parsePgUrl(raw: string): ParsedPgUrl {
  const url = new URL(raw)
  const schema = url.searchParams.get('schema') ?? undefined
  url.searchParams.delete('schema')
  url.searchParams.delete('pgbouncer')
  url.searchParams.delete('connection_limit')
  return { connectionString: url.toString(), schema }
}

/**
 * Writes the connection base ONCE, as SUPABASE_DB_URL
 * (`postgresql://user:encoded-password@host:5432`), and derives every service's
 * `<SERVICE>_DATABASE_URL` / `<SERVICE>_DIRECT_URL` from it:
 * `${SUPABASE_DB_URL}/postgres?schema=ms_<service>`.
 *
 * An explicit per-service value always wins, so one service can still point at
 * the transaction pooler (or another database) without touching the rest.
 * Fills `env` in place because Prisma reads its datasource URL straight from
 * process.env when the client is constructed — this must therefore run before
 * `new PrismaClient()` (loadDatabaseConfig calls it).
 */
export function applyServiceUrlDefaults(env: NodeJS.ProcessEnv = process.env): void {
  const base = env.SUPABASE_DB_URL?.trim().replace(/\/+$/, '')
  if (!base) return
  const dbName = env.SUPABASE_DB_NAME?.trim() || 'postgres'
  for (const service of Object.keys(SERVICE_SCHEMAS) as ServiceName[]) {
    const prefix = service.toUpperCase()
    const url = `${base}/${dbName}?schema=${SERVICE_SCHEMAS[service]}`
    if (!env[`${prefix}_DATABASE_URL`]) env[`${prefix}_DATABASE_URL`] = url
    if (!env[`${prefix}_DIRECT_URL`]) env[`${prefix}_DIRECT_URL`] = url
  }
}

/** `USER_DATABASE_URL` / `ORDER_DIRECT_URL` etc. Throws rather than guessing. */
export function resolveServiceUrl(
  service: ServiceName,
  kind: 'DATABASE' | 'DIRECT' = 'DATABASE',
  env: NodeJS.ProcessEnv = process.env
): string {
  applyServiceUrlDefaults(env)
  const key = `${service.toUpperCase()}_${kind}_URL`
  let value = env[key]
  // DIRECT falls back to the runtime URL; a missing DATABASE url is an error.
  if (!value && kind === 'DIRECT') value = env[`${service.toUpperCase()}_DATABASE_URL`]
  if (!value || !/^postgres(ql)?:\/\//i.test(value)) {
    throw new Error(
      `${key} is missing or is not a postgres:// URL. ` +
        `Set SUPABASE_DB_URL (or this variable) in the repo-root .env — see .env.example (Supabase section).`
    )
  }
  return value
}

export interface ServicePool {
  pool: Pool
  schema: string
  service: ServiceName
}

const pools = new Map<string, ServicePool>()

/** One pool per service per process. Safe to call repeatedly. */
export function getServicePool(
  service: ServiceName,
  env: NodeJS.ProcessEnv = process.env
): ServicePool {
  const cached = pools.get(service)
  if (cached) return cached
  const { connectionString, schema } = parsePgUrl(resolveServiceUrl(service, 'DATABASE', env))
  const expected = SERVICE_SCHEMAS[service]
  if (schema && schema !== expected) {
    throw new Error(`${service} URL targets schema "${schema}" but ${service} owns "${expected}".`)
  }
  const pool = new Pool({
    connectionString,
    max: parseInt(env.DB_POOL_MAX ?? String(DB_POOL_MAX_DEFAULT), 10),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: `ecommerce-ms-${service}`,
  })
  // An idle client erroring (Supabase restart, network blip) must not crash the process.
  pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`[pg:${service}] idle client error: ${err.message}`)
  })
  const sp: ServicePool = { pool, schema: expected, service }
  pools.set(service, sp)
  return sp
}

export async function closeServicePools(): Promise<void> {
  const all = [...pools.values()]
  pools.clear()
  await Promise.all(all.map((p) => p.pool.end().catch(() => undefined)))
}

/**
 * Runs `fn` in ONE transaction on ONE client — BEGIN/COMMIT/ROLLBACK.
 * Every statement in `fn` must go through the `client` it is given; using the
 * pool inside `fn` silently runs outside the transaction.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The connection is already dead; surface the ORIGINAL error.
    }
    throw err
  } finally {
    client.release()
  }
}

export interface PgHealth {
  reachable: boolean
  latencyMs: number | null
  schema: string
  error?: string
}

/** A real round trip. Never reports reachable from configuration alone. */
export async function pgHealth(sp: ServicePool, timeoutMs = 3000): Promise<PgHealth> {
  const started = Date.now()
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      sp.pool.query('SELECT 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      }),
    ])
    return { reachable: true, latencyMs: Date.now() - started, schema: sp.schema }
  } catch (err) {
    return {
      reachable: false,
      latencyMs: null,
      schema: sp.schema,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function pgQuery<R extends QueryResultRow = QueryResultRow>(
  pool: Pool | PoolClient,
  text: string,
  params: unknown[] = []
): Promise<R[]> {
  return (await pool.query<R>(text, params)).rows
}
