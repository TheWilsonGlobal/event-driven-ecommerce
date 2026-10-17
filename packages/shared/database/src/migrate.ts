import * as fs from 'fs'
import * as path from 'path'
import { Client } from 'pg'
import { SERVICE_SCHEMAS, parsePgUrl, resolveServiceUrl, type ServiceName } from './postgres'

/**
 * Minimal forward-only SQL migration runner for the services that do not use
 * Prisma (product, inventory, analytics). Prisma owns user and order.
 *
 * Files are `NNN_name.sql` in a directory, applied in filename order, each in
 * its own transaction, and recorded in `<schema>.schema_migrations`. The token
 * `{{schema}}` in a file is replaced with the service's schema name.
 *
 * Runs on the DIRECT (session) URL — DDL and the advisory lock below do not
 * belong behind a transaction pooler. The lock serialises two replicas that
 * boot together so they do not race the same file.
 */
export interface MigrationResult {
  applied: string[]
  skipped: string[]
}

export async function runMigrations(
  service: ServiceName,
  dir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<MigrationResult> {
  const schema = SERVICE_SCHEMAS[service]
  const { connectionString } = parsePgUrl(resolveServiceUrl(service, 'DIRECT', env))
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  const result: MigrationResult = { applied: [], skipped: [] }
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`migrate:${schema}`])
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
         name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
    )
    const done = new Set(
      (await client.query(`SELECT name FROM ${schema}.schema_migrations`)).rows.map(
        (r) => r.name as string
      )
    )
    for (const file of files) {
      if (done.has(file)) {
        result.skipped.push(file)
        continue
      }
      const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\{\{schema\}\}/g, schema)
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(`INSERT INTO ${schema}.schema_migrations(name) VALUES ($1)`, [file])
        await client.query('COMMIT')
        result.applied.push(file)
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw new Error(
          `Migration ${file} failed for ${schema}: ${err instanceof Error ? err.message : err}`
        )
      }
    }
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(hashtext($1))', [`migrate:${schema}`])
      .catch(() => undefined)
    await client.end().catch(() => undefined)
  }
  return result
}
