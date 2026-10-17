import * as crypto from 'crypto'
import * as path from 'path'
import { buildOutboxEvent, insertOutboxEvent } from '../outbox'
import { OutboxRelay, validateRelayConfig, type ClaimedOutboxRow } from '../relay'
import { TOPICS, EVENT_TYPES } from '../../kafka/topics'

/**
 * Integration tests for the transactional outbox and its relay.
 *
 * ── Real Postgres, throwaway schema ─────────────────────────────────────────
 * Everything of interest (SKIP LOCKED, the lease, the completion guard, the
 * per-key ordering predicate, rollback atomicity) is SQL behaviour, so these run
 * against the real Supabase database from the root .env inside a schema named
 * test_outbox_<random> that is created here and DROPPED afterwards. They never
 * touch ms_* schemas. Without ORDER_DATABASE_URL the DB suites are skipped
 * (visibly, in the jest summary). No Kafka: `publish` is a fake.
 *
 * The DDL below mirrors the production outbox_events tables (ms_order via
 * Prisma, ms_inventory via SQL) column for column.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const root = path.resolve(__dirname, '../../../../../..')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require(require.resolve('dotenv', { paths: [path.join(root, 'packages/ms-order')] }))
dotenv.config({ path: path.join(root, '.env') })
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pool } = require(
  require.resolve('pg', { paths: [path.join(root, 'packages/shared/database')] })
)

jest.setTimeout(120_000)

const URL_ENV = process.env.ORDER_DATABASE_URL
const dbDescribe = URL_ENV ? describe : describe.skip
const SCHEMA = `test_outbox_${crypto.randomBytes(6).toString('hex')}`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: any

function pgUrl(): string {
  const u = new URL(URL_ENV as string)
  u.search = ''
  return u.toString()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function enqueue(key: string, n = 1, client = pool): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const row = buildOutboxEvent({
      producer: 'test',
      topic: TOPICS.orders,
      eventType: EVENT_TYPES.orderCreated,
      key,
      payload: { orderId: key, i },
    })
    await insertOutboxEvent(client, SCHEMA, row)
    ids.push(row.eventId)
  }
  return ids
}

function relay(
  publish: (row: ClaimedOutboxRow) => Promise<void>,
  over: Partial<ConstructorParameters<typeof OutboxRelay>[0]> = {}
): OutboxRelay {
  return new OutboxRelay({
    db: pool,
    schema: SCHEMA,
    publish,
    logPrefix: '[test]',
    pollMs: 20,
    batch: 10,
    leaseMs: 5000,
    sendTimeoutMs: 1000,
    ...over,
  })
}

async function drain(relays: OutboxRelay[], maxMs = 60_000): Promise<void> {
  const until = Date.now() + maxMs
  while (Date.now() < until) {
    const n = (await Promise.all(relays.map((r) => r.tick()))).reduce((a, b) => a + b, 0)
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM ${SCHEMA}.outbox_events WHERE status IN ('pending','processing')`
    )
    if (rows[0].n === 0) return
    if (n === 0) await sleep(25)
  }
  throw new Error('drain timed out')
}

beforeAll(async () => {
  if (!URL_ENV) return
  pool = new Pool({ connectionString: pgUrl(), max: 8, ssl: { rejectUnauthorized: false } })
  await pool.query(`CREATE SCHEMA ${SCHEMA}`)
  await pool.query(`
    CREATE TABLE ${SCHEMA}.outbox_events (
      seq bigserial PRIMARY KEY,
      event_id uuid NOT NULL UNIQUE,
      topic text NOT NULL,
      partition_key text NOT NULL,
      event_type text NOT NULL,
      envelope jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
      attempts int NOT NULL DEFAULT 0,
      max_attempts int NOT NULL DEFAULT 10,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      locked_by text,
      locked_until timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz);
    CREATE INDEX ON ${SCHEMA}.outbox_events (partition_key, seq);`)
})

afterAll(async () => {
  if (!pool) return
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await pool.end()
})

beforeEach(async () => {
  if (pool) await pool.query(`TRUNCATE ${SCHEMA}.outbox_events RESTART IDENTITY`)
})

describe('validateRelayConfig (no database)', () => {
  const ok = { schema: 'ms_order', pollMs: 500, batch: 10, leaseMs: 60_000, sendTimeoutMs: 10_000 }
  it('accepts lease > send timeout', () => expect(() => validateRelayConfig(ok)).not.toThrow())
  it('rejects lease <= send timeout (a row could be reclaimed mid-send)', () => {
    expect(() => validateRelayConfig({ ...ok, leaseMs: 10_000 })).toThrow(/greater than/)
  })
  it('rejects an unsafe schema name', () => {
    expect(() => validateRelayConfig({ ...ok, schema: 'x; DROP' })).toThrow(/bad schema/)
  })
})

describe('buildOutboxEvent (no database)', () => {
  it('mints the eventId once; the envelope carries the same id', () => {
    const r = buildOutboxEvent({
      producer: 'test',
      topic: TOPICS.orders,
      eventType: EVENT_TYPES.orderCreated,
      key: 'o1',
      payload: {},
    })
    expect(r.envelope.eventId).toBe(r.eventId)
  })
})

dbDescribe('outbox write side (pattern 1: atomicity)', () => {
  it('rolls the event back with the business write when the transaction fails', async () => {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await enqueue('o-rollback', 1, c)
      // Failure after the staged write and before COMMIT (reference: beforeCommit hook).
      await c.query('ROLLBACK')
    } finally {
      c.release()
    }
    const { rows } = await pool.query(`SELECT count(*)::int n FROM ${SCHEMA}.outbox_events`)
    expect(rows[0].n).toBe(0)
  })

  it('commits the event with the business write', async () => {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await enqueue('o-commit', 2, c)
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const { rows } = await pool.query(`SELECT count(*)::int n FROM ${SCHEMA}.outbox_events`)
    expect(rows[0].n).toBe(2)
  })

  it('ignores a duplicate event_id (ON CONFLICT DO NOTHING)', async () => {
    const row = buildOutboxEvent({
      producer: 'test',
      topic: TOPICS.orders,
      eventType: EVENT_TYPES.orderCreated,
      key: 'dup',
      payload: {},
    })
    await insertOutboxEvent(pool, SCHEMA, row)
    await insertOutboxEvent(pool, SCHEMA, row)
    const { rows } = await pool.query(`SELECT count(*)::int n FROM ${SCHEMA}.outbox_events`)
    expect(rows[0].n).toBe(1)
  })
})

dbDescribe('relay (pattern 3: SKIP LOCKED + lease)', () => {
  it('delivers a row once, with the same envelope/eventId that was stored', async () => {
    const [id] = await enqueue('o1')
    const seen: ClaimedOutboxRow[] = []
    const r = relay(async (row) => void seen.push(row))
    await drain([r])
    expect(seen).toHaveLength(1)
    expect(seen[0]!.eventId).toBe(id)
    expect(seen[0]!.envelope.eventId).toBe(id)
    const { rows } = await pool.query(`SELECT status, sent_at FROM ${SCHEMA}.outbox_events`)
    expect(rows[0].status).toBe('sent')
    expect(rows[0].sent_at).not.toBeNull()
  })

  it('4 concurrent relays deliver 160 rows exactly once each, none skipped', async () => {
    for (let k = 0; k < 40; k++) await enqueue(`order-${k}`, 4)
    const counts = new Map<string, number>()
    const publish = async (row: ClaimedOutboxRow) => {
      counts.set(row.eventId, (counts.get(row.eventId) ?? 0) + 1)
      await sleep(Math.random() * 5)
    }
    const relays = [0, 1, 2, 3].map(() => relay(publish))
    await drain(relays)
    expect(counts.size).toBe(160)
    expect([...counts.values()].every((n) => n === 1)).toBe(true)
  })

  it('never has two events of one key in flight, and delivers each key in insert order', async () => {
    // Interleave inserts across 3 keys so per-key order is only visible via the key.
    const expected = new Map<string, string[]>()
    for (let i = 0; i < 8; i++) {
      for (const k of ['A', 'B', 'C']) {
        const [id] = await enqueue(k)
        expected.set(k, [...(expected.get(k) ?? []), id!])
      }
    }
    const delivered = new Map<string, string[]>()
    const inFlight = new Set<string>()
    let overlap = false
    const publish = async (row: ClaimedOutboxRow) => {
      if (inFlight.has(row.partitionKey)) overlap = true
      inFlight.add(row.partitionKey)
      await sleep(Math.random() * 15)
      delivered.set(row.partitionKey, [...(delivered.get(row.partitionKey) ?? []), row.eventId])
      inFlight.delete(row.partitionKey)
    }
    await drain([relay(publish), relay(publish), relay(publish)])
    expect(overlap).toBe(false)
    for (const k of ['A', 'B', 'C']) expect(delivered.get(k)).toEqual(expected.get(k))
  })

  it('reclaims a row whose lease expired, and the stale owner cannot overwrite the new one', async () => {
    const [id] = await enqueue('lease')
    // Worker A claims, then "freezes" (never calls markSent).
    const a = relay(async () => undefined, { leaseMs: 1500, sendTimeoutMs: 500, workerId: 'A' })
    const claimedByA = await a.claimBatch()
    expect(claimedByA.map((r) => r.eventId)).toEqual([id])

    // Before expiry nobody else can take it.
    const b = relay(async () => undefined, { leaseMs: 1500, sendTimeoutMs: 500, workerId: 'B' })
    expect(await b.claimBatch()).toHaveLength(0)

    await sleep(1800)
    const claimedByB = await b.claimBatch()
    expect(claimedByB.map((r) => r.eventId)).toEqual([id])
    expect(claimedByB[0]!.attempts).toBe(2)

    // A wakes up and tries to complete: 0 rows, B still owns it.
    expect(await a.markSent(claimedByA[0]!)).toBe(false)
    const { rows } = await pool.query(`SELECT status, locked_by FROM ${SCHEMA}.outbox_events`)
    expect(rows[0]).toMatchObject({ status: 'processing', locked_by: 'B' })

    expect(await b.markSent(claimedByB[0]!)).toBe(true)
  })

  it('fails a row (dead) after max_attempts and requeueFailed puts it back', async () => {
    const row = buildOutboxEvent({
      producer: 'test',
      topic: TOPICS.orders,
      eventType: EVENT_TYPES.orderCreated,
      key: 'poison',
      payload: {},
      maxAttempts: 2,
    })
    await insertOutboxEvent(pool, SCHEMA, row)
    let calls = 0
    const r = relay(
      async () => {
        calls++
        throw new Error('boom')
      },
      { maxBackoffMs: 1 }
    )
    for (let i = 0; i < 6; i++) {
      await r.tick()
      await sleep(30)
    }
    expect(calls).toBe(2)
    const s = await r.stats()
    expect(s.counts.failed).toBe(1)
    expect(await r.requeueFailed()).toBe(1)
    expect((await r.stats()).counts.pending).toBe(1)
  })

  it('a dead row does not wedge later events of the same key', async () => {
    const dead = buildOutboxEvent({
      producer: 'test',
      topic: TOPICS.orders,
      eventType: EVENT_TYPES.orderCreated,
      key: 'k',
      payload: {},
      maxAttempts: 1,
    })
    await insertOutboxEvent(pool, SCHEMA, dead)
    const [later] = await enqueue('k')
    const sent: string[] = []
    const r = relay(
      async (row) => {
        if (row.eventId === dead.eventId) throw new Error('bad')
        sent.push(row.eventId)
      },
      { maxBackoffMs: 1 }
    )
    for (let i = 0; i < 6; i++) {
      await r.tick()
      await sleep(30)
    }
    expect(sent).toEqual([later])
  })

  it('does not burn attempts when the broker is down, so an outage cannot dead-letter events', async () => {
    await enqueue('outage')
    const down = new Error('broker down')
    const r = relay(
      async () => {
        throw down
      },
      { isBrokerDown: (e) => e === down, maxBackoffMs: 1 }
    )
    for (let i = 0; i < 15; i++) {
      await r.tick()
      await sleep(10)
    }
    const { rows } = await pool.query(`SELECT status, attempts FROM ${SCHEMA}.outbox_events`)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].attempts).toBe(0)
  })

  it('fails rows whose lease expired on the final attempt instead of leaving them processing', async () => {
    const row = buildOutboxEvent({
      producer: 'test',
      topic: TOPICS.orders,
      eventType: EVENT_TYPES.orderCreated,
      key: 'last',
      payload: {},
      maxAttempts: 1,
    })
    await insertOutboxEvent(pool, SCHEMA, row)
    const a = relay(async () => undefined, { leaseMs: 1500, sendTimeoutMs: 500 })
    expect(await a.claimBatch()).toHaveLength(1)
    await sleep(1800)
    expect(await a.failExhausted()).toBe(1)
    const { rows } = await pool.query(`SELECT status FROM ${SCHEMA}.outbox_events`)
    expect(rows[0].status).toBe('failed')
  })

  it('idles (claims nothing) while disabled, and keeps rows pending', async () => {
    await enqueue('off')
    const r = relay(async () => undefined, { isEnabled: () => false })
    expect(await r.tick()).toBe(0)
    expect((await r.stats()).counts.pending).toBe(1)
  })
})
