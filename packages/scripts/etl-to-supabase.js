#!/usr/bin/env node
/**
 * One-off, idempotent copy of the legacy embedded data into the single Supabase
 * Postgres (change-03-db-upgrade, Phase 5). OPTIONAL: dev data is seeded on
 * boot, so reseeding is usually enough. Use this only to keep the old rows.
 *
 *   node packages/scripts/etl-to-supabase.js                    # dry run: counts only
 *   node packages/scripts/etl-to-supabase.js --apply            # copy
 *   node packages/scripts/etl-to-supabase.js --apply --only=user,order
 *
 * Sources (read-only):  data/db/ms-user.db, ms-order.db   (SQLite, via node:sqlite)
 *                       data/db/products|categories|inventory|reservations.db (NeDB files)
 * Targets:              ms_user.*, ms_order.*, ms_product."products|categories",
 *                       ms_inventory.inventory|reservations
 *
 * Rules
 *  - Every insert is ON CONFLICT DO NOTHING, so re-running is safe and rows the
 *    services already seeded are left alone (reported as "skipped").
 *  - The target schemas must already exist (run the migrations / boot each service once).
 *  - NOT copied: analytics_* (derived aggregates, rebuilt from the event log) and the
 *    processed_events ledgers (a stale ledger would only suppress legitimate replays).
 *  - Prints per-table source / inserted / skipped / target counts. Never prints the URL.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const need = (m, from) => require(require.resolve(m, { paths: from }))
const dotenv = need('dotenv', [path.join(ROOT, 'packages/ms-order')])
const { Client } = need('pg', [path.join(ROOT, 'packages/shared/database')])
dotenv.config({ path: path.join(ROOT, '.env') })

// Same derivation as shared-database's applyServiceUrlDefaults: the connection base is
// written once (SUPABASE_DB_URL); explicit per-service values still win.
if (process.env.SUPABASE_DB_URL) {
  const base = process.env.SUPABASE_DB_URL.trim().replace(/\/+$/, '')
  const db = process.env.SUPABASE_DB_NAME || 'postgres'
  for (const s of ['user', 'order', 'product', 'inventory', 'analytics']) {
    const url = `${base}/${db}?schema=ms_${s}`
    process.env[`${s.toUpperCase()}_DATABASE_URL`] ||= url
    process.env[`${s.toUpperCase()}_DIRECT_URL`] ||= url
  }
}

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const onlyArg = args.find((a) => a.startsWith('--only='))
const ONLY = onlyArg ? onlyArg.slice(7).split(',') : ['user', 'order', 'product', 'inventory']
const DATA = path.join(ROOT, 'data/db')

function connect(service) {
  const raw = process.env[`${service.toUpperCase()}_DIRECT_URL`] || process.env[`${service.toUpperCase()}_DATABASE_URL`]
  if (!raw) throw new Error(`${service.toUpperCase()}_DATABASE_URL is not set`)
  const u = new URL(raw)
  u.search = ''
  const c = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } })
  return c.connect().then(() => c)
}

/** NeDB: one JSON doc per line, later lines win per _id, {$$deleted:true} removes. */
function readNedb(file) {
  const p = path.join(DATA, file)
  if (!fs.existsSync(p)) return []
  const byId = new Map()
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let doc
    try {
      doc = JSON.parse(line)
    } catch {
      continue // a torn trailing line; NeDB itself ignores it
    }
    if (doc.$$indexCreated || doc.$$indexRemoved) continue
    const id = doc._id ?? doc.id
    if (doc.$$deleted) byId.delete(doc.$$deleted === true ? id : doc.$$deleted)
    else byId.set(id, doc)
  }
  return [...byId.values()]
}

const DATE_COLS = new Set(['created_at', 'updated_at', 'expires_at'])
const BOOL_COLS = /^is_/

/** Prisma+SQLite stores DateTime as epoch ms (integer) and Boolean as 0/1. */
function convert(col, v) {
  if (v === null || v === undefined) return null
  if (DATE_COLS.has(col)) return typeof v === 'number' ? new Date(v).toISOString() : v
  if (BOOL_COLS.test(col)) return v === 1 || v === true || v === '1'
  return v
}

async function copySqlite(db, client, schema, table, report) {
  const rows = db.prepare(`SELECT * FROM "${table}"`).all()
  let inserted = 0
  if (APPLY) {
    for (const row of rows) {
      const cols = Object.keys(row)
      const vals = cols.map((c) => convert(c, row[c]))
      const r = await client.query(
        `INSERT INTO ${schema}."${table}" (${cols.map((c) => `"${c}"`).join(',')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING`,
        vals
      )
      inserted += r.rowCount ?? 0
    }
  }
  const target = (await client.query(`SELECT count(*)::int n FROM ${schema}."${table}"`)).rows[0].n
  report.push({ table: `${schema}.${table}`, source: rows.length, inserted: APPLY ? inserted : '(dry)', skipped: APPLY ? rows.length - inserted : '(dry)', target })
}

async function copyDocs(client, schema, table, docs, report) {
  let inserted = 0
  if (APPLY) {
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}."${table}" (id text PRIMARY KEY, doc jsonb NOT NULL)`)
    for (const d of docs) {
      const id = String(d.id ?? d._id)
      const r = await client.query(
        `INSERT INTO ${schema}."${table}"(id, doc) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING`,
        [id, JSON.stringify({ ...d, id, _id: id })]
      )
      inserted += r.rowCount ?? 0
    }
  }
  let target = 'n/a'
  try {
    target = (await client.query(`SELECT count(*)::int n FROM ${schema}."${table}"`)).rows[0].n
  } catch {
    /* table not created yet in a dry run */
  }
  report.push({ table: `${schema}.${table}`, source: docs.length, inserted: APPLY ? inserted : '(dry)', skipped: APPLY ? docs.length - inserted : '(dry)', target })
}

async function main() {
  const report = []
  const { DatabaseSync } = require('node:sqlite')

  if (ONLY.includes('user')) {
    const client = await connect('user')
    const db = new DatabaseSync(path.join(DATA, 'ms-user.db'), { readOnly: true })
    for (const t of ['users', 'addresses', 'refresh_tokens']) await copySqlite(db, client, 'ms_user', t, report)
    db.close()
    await client.end()
  }
  if (ONLY.includes('order')) {
    const client = await connect('order')
    const db = new DatabaseSync(path.join(DATA, 'ms-order.db'), { readOnly: true })
    for (const t of ['orders', 'order_items', 'payments']) await copySqlite(db, client, 'ms_order', t, report)
    db.close()
    await client.end()
  }
  if (ONLY.includes('product')) {
    const client = await connect('product')
    await copyDocs(client, 'ms_product', 'products', readNedb('products.db'), report)
    await copyDocs(client, 'ms_product', 'categories', readNedb('categories.db'), report)
    await client.end()
  }
  if (ONLY.includes('inventory')) {
    const client = await connect('inventory')
    const inv = readNedb('inventory.db')
    const res = readNedb('reservations.db')
    let ins = 0
    let insR = 0
    if (APPLY) {
      for (const d of inv) {
        const r = await client.query(
          `INSERT INTO ms_inventory.inventory(product_id, sku, available, reserved, updated_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [d.productId, d.sku, d.available, d.reserved, d.updatedAt ?? new Date().toISOString()]
        )
        ins += r.rowCount ?? 0
      }
      for (const d of res) {
        const r = await client.query(
          `INSERT INTO ms_inventory.reservations(order_id, order_number, event_id, items, status, created_at, released_at)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [d.orderId, d.orderNumber, d.eventId, JSON.stringify(d.items ?? []), d.status, d.createdAt, d.releasedAt ?? null]
        )
        insR += r.rowCount ?? 0
      }
    }
    const t1 = (await client.query('SELECT count(*)::int n FROM ms_inventory.inventory')).rows[0].n
    const t2 = (await client.query('SELECT count(*)::int n FROM ms_inventory.reservations')).rows[0].n
    report.push({ table: 'ms_inventory.inventory', source: inv.length, inserted: APPLY ? ins : '(dry)', skipped: APPLY ? inv.length - ins : '(dry)', target: t1 })
    report.push({ table: 'ms_inventory.reservations', source: res.length, inserted: APPLY ? insR : '(dry)', skipped: APPLY ? res.length - insR : '(dry)', target: t2 })
    await client.end()
  }

  console.log(APPLY ? 'APPLIED' : 'DRY RUN (pass --apply to copy)')
  console.table(report)
}

main().catch((e) => {
  console.error('ETL failed:', e.message)
  process.exit(1)
})
