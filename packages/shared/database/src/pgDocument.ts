import type { Pool } from 'pg'
import { randomUUID } from 'crypto'
import type { DocumentDatabaseAdapter } from './document'
import type { DatabaseConfiguration } from './config'
import { createDocumentStore } from './document'
import { SERVICE_SCHEMAS, getServicePool, type ServiceName } from './postgres'

/**
 * `DocumentDatabaseAdapter` over a Postgres jsonb table — the compatibility
 * shim that lets ms-product leave NeDB without rewriting every call site.
 *
 * Table per collection: `<schema>."<collection>"(id text PK, doc jsonb)`.
 * Query semantics are the subset the services actually use: top-level
 * equality, expressed as jsonb containment (`doc @> $1`). Operators such as
 * `$gt` or `$regex` are REJECTED loudly instead of being silently ignored —
 * a silently-ignored filter would return every row.
 *
 * Transactional paths (inventory, analytics, outbox) do NOT use this; they
 * use typed repositories with `withTransaction`, because this adapter has no
 * transaction concept.
 */
export class PostgresDocumentStore<
  T extends { id?: string | undefined; _id?: string | undefined },
> implements DocumentDatabaseAdapter<T> {
  private readyPromise: Promise<void> | undefined
  private readonly table: string

  constructor(
    collection: string,
    private readonly pool: Pool,
    private readonly schema: string
  ) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(collection))
      throw new Error(`bad collection name: ${collection}`)
    this.table = `${schema}."${collection}"`
  }

  private ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`)
        await this.pool.query(
          `CREATE TABLE IF NOT EXISTS ${this.table} (id text PRIMARY KEY, doc jsonb NOT NULL)`
        )
        await this.pool.query(`ALTER TABLE ${this.table} ENABLE ROW LEVEL SECURITY`)
      })().catch((err) => {
        this.readyPromise = undefined // allow a later retry
        throw err
      })
    }
    return this.readyPromise
  }

  private static hasOperator(v: unknown): boolean {
    return (
      !!v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Date) &&
      Object.keys(v as object).some((x) => x.startsWith('$'))
    )
  }

  private where(query: Record<string, unknown>): { sql: string; params: unknown[] } {
    for (const [k, v] of Object.entries(query)) {
      if (k.startsWith('$') || PostgresDocumentStore.hasOperator(v)) {
        throw new Error(
          `PostgresDocumentStore supports equality filters only; got operator in "${k}"`
        )
      }
    }
    const keys = Object.keys(query)
    if (keys.length === 0) return { sql: 'TRUE', params: [] }
    // `id`/`_id` are mirrored, so a lookup by either hits the primary key.
    if (keys.length === 1 && (keys[0] === 'id' || keys[0] === '_id')) {
      return { sql: 'id = $1', params: [String(query[keys[0]])] }
    }
    return { sql: 'doc @> $1::jsonb', params: [JSON.stringify(query)] }
  }

  async findOne(query: Record<string, unknown>): Promise<T | null> {
    await this.ready()
    const w = this.where(query)
    const r = await this.pool.query(
      `SELECT doc FROM ${this.table} WHERE ${w.sql} LIMIT 1`,
      w.params
    )
    return (r.rows[0]?.doc as T | undefined) ?? null
  }

  async find(query: Record<string, unknown>): Promise<T[]> {
    await this.ready()
    const w = this.where(query)
    const r = await this.pool.query(`SELECT doc FROM ${this.table} WHERE ${w.sql}`, w.params)
    return r.rows.map((x) => x.doc as T)
  }

  async insert(doc: T): Promise<T> {
    await this.ready()
    const id = doc.id ?? doc._id ?? randomUUID()
    const stored = { ...doc, id, _id: id } as T
    await this.pool.query(`INSERT INTO ${this.table}(id, doc) VALUES ($1, $2::jsonb)`, [
      id,
      JSON.stringify(stored),
    ])
    return stored
  }

  async update(query: Record<string, unknown>, updateDoc: Partial<T>): Promise<number> {
    await this.ready()
    const w = this.where(query)
    const r = await this.pool.query(
      `UPDATE ${this.table} SET doc = doc || $${w.params.length + 1}::jsonb WHERE ${w.sql}`,
      [...w.params, JSON.stringify(updateDoc)]
    )
    return r.rowCount ?? 0
  }

  async delete(query: Record<string, unknown>): Promise<number> {
    await this.ready()
    const w = this.where(query)
    const r = await this.pool.query(`DELETE FROM ${this.table} WHERE ${w.sql}`, w.params)
    return r.rowCount ?? 0
  }
}

export function createPostgresDocumentStore<
  T extends { id?: string | undefined; _id?: string | undefined },
>(service: ServiceName, collection: string): PostgresDocumentStore<T> {
  const sp = getServicePool(service)
  return new PostgresDocumentStore<T>(collection, sp.pool, SERVICE_SCHEMAS[service])
}

/**
 * Driver-aware factory: Postgres when DOCUMENT_DB_DRIVER=postgres, otherwise
 * the legacy embedded store. Services call this instead of createDocumentStore.
 */
export function createServiceDocumentStore<
  T extends { id?: string | undefined; _id?: string | undefined },
>(
  service: ServiceName,
  collection: string,
  config: DatabaseConfiguration
): DocumentDatabaseAdapter<T> {
  return config.document.driver === 'postgres'
    ? createPostgresDocumentStore<T>(service, collection)
    : createDocumentStore<T>(collection, config)
}
