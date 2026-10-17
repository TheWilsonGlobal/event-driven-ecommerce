import { makeEnvelope, type EventEnvelope } from '../kafka/envelope'
import type { EventType, TopicName } from '../kafka/topics'

/**
 * Transactional outbox — the write side.
 *
 * The problem this removes: a route commits to the database and THEN publishes
 * to Kafka. A crash between the two loses the event, and the old
 * `tryPublish` documented that as accepted at-most-once. Here the event is a
 * row written in the SAME transaction as the state change it describes, so
 * either both exist or neither does. A separate relay (relay.ts) drains the
 * table to Kafka afterwards.
 *
 * ── The eventId is minted ONCE, here ────────────────────────────────────────
 * Before, every publish called `randomUUID()`, so a retried publish looked like
 * a different event and consumers needed a second, state-based guard to catch
 * it. The envelope is now built at insert time and stored whole; the relay
 * re-sends the stored envelope untouched, so every attempt carries the same
 * eventId and consumers can dedupe on it alone.
 *
 * Table shape lives in each service's migration (ms_order.outbox_events via
 * Prisma, ms_inventory.outbox_events via SQL). Both are identical in columns.
 */

/** The only thing the outbox needs from a database client: pg's `query`. */
export interface SqlClient {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
}

export interface OutboxEventInput<T> {
  producer: string
  topic: TopicName
  eventType: EventType
  /** Partition key — all events for one order share it, which fixes their order. */
  key: string
  payload: T
  correlationId?: string | undefined
  maxAttempts?: number | undefined
}

export interface OutboxEventRow<T = unknown> {
  eventId: string
  topic: TopicName
  partitionKey: string
  eventType: EventType
  envelope: EventEnvelope<T>
  maxAttempts: number
}

export const DEFAULT_MAX_ATTEMPTS = 10

/** Pure: builds the row to insert. No I/O, so a caller can pass it to any ORM. */
export function buildOutboxEvent<T>(input: OutboxEventInput<T>): OutboxEventRow<T> {
  const envelope = makeEnvelope({
    eventType: input.eventType,
    producer: input.producer,
    payload: input.payload,
    correlationId: input.correlationId,
  })
  return {
    eventId: envelope.eventId,
    topic: input.topic,
    partitionKey: input.key,
    eventType: input.eventType,
    envelope,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  }
}

const SAFE_SCHEMA = /^[a-z_][a-z0-9_]*$/i

/**
 * Inserts the row through a raw client. `client` MUST be the transaction's own
 * client (e.g. the one handed to `withTransaction`) — passing the pool writes
 * the row outside the transaction and silently defeats the whole pattern.
 */
export async function insertOutboxEvent<T>(
  client: SqlClient,
  schema: string,
  row: OutboxEventRow<T>
): Promise<void> {
  if (!SAFE_SCHEMA.test(schema)) throw new Error(`bad schema name: ${schema}`)
  await client.query(
    `INSERT INTO ${schema}.outbox_events
       (event_id, topic, partition_key, event_type, envelope, max_attempts)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      row.eventId,
      row.topic,
      row.partitionKey,
      row.eventType,
      JSON.stringify(row.envelope),
      row.maxAttempts,
    ]
  )
}

/** Convenience: build + insert in one call. */
export async function enqueueOutboxEvent<T>(
  client: SqlClient,
  schema: string,
  input: OutboxEventInput<T>
): Promise<OutboxEventRow<T>> {
  const row = buildOutboxEvent(input)
  await insertOutboxEvent(client, schema, row)
  return row
}
