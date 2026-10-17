import { randomUUID } from 'crypto'
import { describeError } from '../describeError'
import type { EventEnvelope } from '../kafka/envelope'
import type { TopicName } from '../kafka/topics'
import type { SqlClient } from './outbox'

/**
 * Transactional outbox — the read side: a relay that drains `outbox_events`
 * to Kafka.
 *
 * ── Claiming: FOR UPDATE SKIP LOCKED + a lease ─────────────────────────────
 * One autocommit statement selects eligible rows and flips them to
 * `processing` with a lease. SKIP LOCKED means two relays never wait on, or
 * double-claim, each other's rows. NO row lock is held while Kafka is called —
 * only the lease protects the row — so a slow broker cannot block other
 * workers. `locked_until` uses the DATABASE clock, so relays on different
 * machines cannot disagree through clock skew. A `processing` row whose lease
 * expired (worker died) is reclaimed by the same query.
 *
 * ── Completion guard ───────────────────────────────────────────────────────
 * markSent/markFailed only update the row if it is STILL ours:
 * `locked_by = me AND status = 'processing' AND attempts = the attempt I
 * claimed`. A stale worker whose lease was reclaimed updates 0 rows and cannot
 * overwrite the new owner.
 *
 * ── Per-key ordering (the part an e-mail outbox does not need) ─────────────
 * Every event about one order must reach its partition in insert order, or
 * inventory could release a reservation it never made. SKIP LOCKED alone would
 * let two relays take different rows of the same order. So a row is only
 * claimable when no EARLIER row with the same partition key is still
 * pending/processing. A `failed` (dead) row does not block — it is surfaced,
 * not allowed to wedge an order forever. Consequence: at most one in-flight
 * event per key, the relay loops again immediately when a tick found work.
 *
 * ── Guarantee ──────────────────────────────────────────────────────────────
 * At-least-once into Kafka. A crash after the broker acks and before markSent
 * re-sends the SAME envelope (same eventId); consumers dedupe on it.
 */

export interface OutboxRelayConfig {
  /** Any client with `query` — the service's pg Pool (NOT a transaction client). */
  db: SqlClient
  /** Schema that owns outbox_events, e.g. 'ms_order'. */
  schema: string
  /** Sends one stored envelope. Must THROW on failure. */
  publish: (row: ClaimedOutboxRow) => Promise<void>
  /** False when Kafka is disabled: the relay idles and rows wait, honestly. */
  isEnabled?: () => boolean
  /** True for errors that mean "broker unreachable" rather than "this row is bad". */
  isBrokerDown?: (err: unknown) => boolean
  logPrefix: string
  workerId?: string
  pollMs: number
  batch: number
  leaseMs: number
  sendTimeoutMs: number
  /** Backoff cap. */
  maxBackoffMs?: number
}

export interface ClaimedOutboxRow {
  seq: string
  eventId: string
  topic: TopicName
  partitionKey: string
  eventType: string
  envelope: EventEnvelope
  attempts: number
  maxAttempts: number
}

export interface OutboxStats {
  enabled: boolean
  running: boolean
  workerId: string
  counts: { pending: number; processing: number; sent: number; failed: number }
  oldestPendingAgeMs: number | null
  /** Process-lifetime, reset on restart — labelled as such wherever shown. */
  sinceStart: {
    sent: number
    failedAttempts: number
    lastError: string | null
    lastTickAt: string | null
  }
}

const SAFE_SCHEMA = /^[a-z_][a-z0-9_]*$/i

/** Rejects a config that could make duplicates likely (reference: config.ts). */
export function validateRelayConfig(
  cfg: Pick<OutboxRelayConfig, 'leaseMs' | 'sendTimeoutMs' | 'pollMs' | 'batch' | 'schema'>
): void {
  if (!SAFE_SCHEMA.test(cfg.schema)) throw new Error(`bad schema name: ${cfg.schema}`)
  if (cfg.leaseMs <= cfg.sendTimeoutMs) {
    throw new Error(
      `OUTBOX_LEASE_MS (${cfg.leaseMs}) must be greater than OUTBOX_SEND_TIMEOUT_MS (${cfg.sendTimeoutMs}); ` +
        `otherwise a row can be reclaimed while its send is still in flight.`
    )
  }
  if (cfg.pollMs < 10 || cfg.batch < 1)
    throw new Error('OUTBOX_POLL_MS must be >= 10 and OUTBOX_BATCH >= 1')
}

export class OutboxRelay {
  private readonly cfg: OutboxRelayConfig
  private readonly workerId: string
  private timer: NodeJS.Timeout | undefined
  private running = false
  private inTick = false
  private readonly since = {
    sent: 0,
    failedAttempts: 0,
    lastError: null as string | null,
    lastTickAt: null as string | null,
  }

  constructor(cfg: OutboxRelayConfig) {
    validateRelayConfig(cfg)
    this.cfg = cfg
    this.workerId = cfg.workerId ?? `${cfg.logPrefix}-${process.pid}-${randomUUID().slice(0, 8)}`
  }

  private get t(): string {
    return `${this.cfg.schema}.outbox_events`
  }

  start(): void {
    if (this.running) return
    this.running = true
    const loop = async (): Promise<void> => {
      if (!this.running) return
      let again = false
      try {
        again = (await this.tick()) > 0
      } catch (err) {
        this.since.lastError = describeError(err)
        // eslint-disable-next-line no-console
        console.warn(`${this.cfg.logPrefix} outbox tick failed: ${this.since.lastError}`)
      }
      if (!this.running) return
      // Work found => go again immediately (one in-flight event per key per tick).
      this.timer = setTimeout(loop, again ? 0 : this.cfg.pollMs)
      this.timer.unref?.()
    }
    this.timer = setTimeout(loop, 0)
    this.timer.unref?.()
  }

  /** Stops claiming; waits for an in-flight tick so shutdown does not strand a lease. */
  async stop(): Promise<void> {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    const deadline = Date.now() + this.cfg.sendTimeoutMs + 1000
    while (this.inTick && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
  }

  /** One claim → send → complete pass. Returns how many rows were claimed. */
  async tick(): Promise<number> {
    if (this.inTick) return 0
    if (this.cfg.isEnabled && !this.cfg.isEnabled()) return 0
    this.inTick = true
    try {
      this.since.lastTickAt = new Date().toISOString()
      await this.failExhausted()
      const rows = await this.claimBatch()
      for (const row of rows) await this.deliver(row)
      return rows.length
    } finally {
      this.inTick = false
    }
  }

  async claimBatch(): Promise<ClaimedOutboxRow[]> {
    const r = await this.cfg.db.query(
      `UPDATE ${this.t}
          SET status = 'processing', locked_by = $1,
              locked_until = now() + ($2::int * interval '1 millisecond'),
              attempts = attempts + 1
        WHERE seq IN (
          SELECT o.seq FROM ${this.t} o
           WHERE ((o.status = 'pending' AND o.next_attempt_at <= now())
               OR (o.status = 'processing' AND o.locked_until < now()))
             AND o.attempts < o.max_attempts
             AND NOT EXISTS (
               SELECT 1 FROM ${this.t} e2
                WHERE e2.partition_key = o.partition_key
                  AND e2.seq < o.seq
                  AND e2.status IN ('pending', 'processing'))
           ORDER BY o.seq
           LIMIT $3
           FOR UPDATE SKIP LOCKED)
       RETURNING seq::text AS seq, event_id::text AS event_id, topic, partition_key,
                 event_type, envelope, attempts, max_attempts`,
      [this.workerId, this.cfg.leaseMs, this.cfg.batch]
    )
    return r.rows.map((x) => ({
      seq: x.seq as string,
      eventId: x.event_id as string,
      topic: x.topic as TopicName,
      partitionKey: x.partition_key as string,
      eventType: x.event_type as string,
      envelope: (typeof x.envelope === 'string'
        ? JSON.parse(x.envelope)
        : x.envelope) as EventEnvelope,
      attempts: x.attempts as number,
      maxAttempts: x.max_attempts as number,
    }))
  }

  /**
   * Rows whose lease expired on their FINAL attempt are never reclaimed by
   * claimBatch (attempts < max_attempts), so they would sit in `processing`
   * forever. Mark them failed so they are visible.
   */
  async failExhausted(): Promise<number> {
    const r = await this.cfg.db.query(
      `UPDATE ${this.t}
          SET status = 'failed', last_error = COALESCE(last_error, 'lease expired on final attempt'),
              locked_by = NULL, locked_until = NULL
        WHERE status = 'processing' AND locked_until < now() AND attempts >= max_attempts`
    )
    return r.rowCount ?? 0
  }

  private async deliver(row: ClaimedOutboxRow): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        this.cfg.publish(row),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`send exceeded ${this.cfg.sendTimeoutMs}ms`)),
            this.cfg.sendTimeoutMs
          )
        }),
      ])
    } catch (err) {
      // A timed-out send may still complete in the background. That is safe:
      // the envelope (and eventId) is unchanged, and consumers dedupe on it.
      await this.markFailed(row, err)
      return
    } finally {
      if (timer) clearTimeout(timer)
    }
    await this.markSent(row)
  }

  private static readonly OWNED = `seq = $1 AND locked_by = $2 AND status = 'processing' AND attempts = $3`

  async markSent(row: ClaimedOutboxRow): Promise<boolean> {
    const r = await this.cfg.db.query(
      `UPDATE ${this.t}
          SET status = 'sent', sent_at = now(), locked_by = NULL, locked_until = NULL, last_error = NULL
        WHERE ${OutboxRelay.OWNED}`,
      [row.seq, this.workerId, row.attempts]
    )
    const ok = (r.rowCount ?? 0) === 1
    if (ok) this.since.sent += 1
    else
      // eslint-disable-next-line no-console
      console.warn(
        `${this.cfg.logPrefix} outbox seq=${row.seq}: lease lost before markSent (a newer owner holds it)`
      )
    return ok
  }

  async markFailed(row: ClaimedOutboxRow, err: unknown): Promise<boolean> {
    const message = describeError(err).slice(0, 500)
    this.since.failedAttempts += 1
    this.since.lastError = message
    const brokerDown = this.cfg.isBrokerDown?.(err) === true
    const maxBackoff = this.cfg.maxBackoffMs ?? 60_000
    // Broker-down is not this row's fault: hand back the attempt it consumed so
    // an outage cannot dead-letter healthy events.
    const attemptsAfter = brokerDown ? row.attempts - 1 : row.attempts
    const dead = !brokerDown && row.attempts >= row.maxAttempts
    const backoffMs = Math.min(maxBackoff, 500 * 2 ** Math.min(row.attempts, 12))
    const r = await this.cfg.db.query(
      `UPDATE ${this.t}
          SET status = $4, attempts = $5, last_error = $6, locked_by = NULL, locked_until = NULL,
              next_attempt_at = now() + ($7::int * interval '1 millisecond')
        WHERE ${OutboxRelay.OWNED}`,
      [
        row.seq,
        this.workerId,
        row.attempts,
        dead ? 'failed' : 'pending',
        attemptsAfter,
        message,
        backoffMs,
      ]
    )
    if (dead)
      // eslint-disable-next-line no-console
      console.error(
        `${this.cfg.logPrefix} outbox seq=${row.seq} ${row.eventType} DEAD after ${row.attempts} attempts: ${message}`
      )
    return (r.rowCount ?? 0) === 1
  }

  /** Operator action: put dead rows back in the queue. */
  async requeueFailed(): Promise<number> {
    const r = await this.cfg.db.query(
      `UPDATE ${this.t} SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
        WHERE status = 'failed'`
    )
    return r.rowCount ?? 0
  }

  async stats(): Promise<OutboxStats> {
    const c = await this.cfg.db.query(
      `SELECT status, count(*)::int AS n FROM ${this.t} GROUP BY status`
    )
    const counts = { pending: 0, processing: 0, sent: 0, failed: 0 }
    for (const x of c.rows) counts[x.status as keyof typeof counts] = x.n as number
    const age = await this.cfg.db.query(
      `SELECT (EXTRACT(EPOCH FROM (now() - min(created_at))) * 1000)::bigint AS ms
         FROM ${this.t} WHERE status IN ('pending','processing')`
    )
    const ms = age.rows[0]?.ms
    return {
      enabled: this.cfg.isEnabled ? this.cfg.isEnabled() : true,
      running: this.running,
      workerId: this.workerId,
      counts,
      oldestPendingAgeMs: ms == null ? null : Number(ms),
      sinceStart: { ...this.since },
    }
  }
}

export interface OutboxEnvConfig {
  pollMs: number
  batch: number
  maxAttempts: number
  leaseMs: number
  sendTimeoutMs: number
}

export function loadOutboxEnv(env: NodeJS.ProcessEnv = process.env): OutboxEnvConfig {
  const n = (k: string, d: number): number => {
    const v = parseInt(env[k] ?? '', 10)
    return Number.isFinite(v) && v > 0 ? v : d
  }
  return {
    pollMs: n('OUTBOX_POLL_MS', 500),
    batch: n('OUTBOX_BATCH', 50),
    maxAttempts: n('OUTBOX_MAX_ATTEMPTS', 10),
    leaseMs: n('OUTBOX_LEASE_MS', 60_000),
    sendTimeoutMs: n('OUTBOX_SEND_TIMEOUT_MS', 10_000),
  }
}
