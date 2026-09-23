import * as crypto from 'crypto'
import type { EventType } from './topics'

/**
 * The envelope every event on the backbone is wrapped in.
 *
 * ── Identifiers, not snapshots ──────────────────────────────────────────────
 * Payloads carry ids and the few immutable facts a consumer needs to decide
 * whether it cares. They do NOT carry a snapshot of mutable state. This is the
 * same rule `jobTypes.ts` already states for BullMQ jobs ("a job that was
 * enqueued 15 minutes ago must not act on a 15-minute-old view of the order"),
 * and it applies with MORE force across a service boundary, where the lag
 * between publish and consume is unbounded. A consumer that needs current state
 * re-reads it over HTTP.
 *
 * The exception is genuinely immutable historical fact — the amount that was
 * charged, the quantity that was ordered. Those are what happened, not a view
 * of what currently is, so carrying them is correct and saves a round-trip.
 */
export interface EventEnvelope<T = unknown> {
  /**
   * Unique per PUBLISH, and the idempotency key every consumer must key on.
   *
   * Kafka redelivers on rebalance, on restart, and any time an offset was not
   * committed — so a consumer WILL see the same eventId more than once and
   * must tolerate it. See the two mechanisms in the consumer docs: a
   * deterministic BullMQ jobId derived from this value, or a processed-events
   * record in the consumer's own store.
   */
  eventId: string
  eventType: EventType
  /** Payload schema version. The topic name carries it too; this is for logs. */
  eventVersion: number
  /** When the fact occurred, ISO 8601. Not when it was published or consumed. */
  occurredAt: string
  /** Which service published it. */
  producer: string
  /**
   * Threaded through from the originating HTTP request so a consumer's logs can
   * be correlated back to the checkout that caused them. Falls back to the
   * eventId when there is no request context.
   */
  correlationId: string
  payload: T
}

export interface MakeEnvelopeInput<T> {
  eventType: EventType
  producer: string
  payload: T
  correlationId?: string | undefined
  /** Defaults to now. Pass an explicit value when replaying historical facts. */
  occurredAt?: string | undefined
  eventVersion?: number | undefined
}

export function makeEnvelope<T>({
  eventType,
  producer,
  payload,
  correlationId,
  occurredAt,
  eventVersion,
}: MakeEnvelopeInput<T>): EventEnvelope<T> {
  const eventId = crypto.randomUUID()
  return {
    eventId,
    eventType,
    eventVersion: eventVersion ?? 1,
    occurredAt: occurredAt ?? new Date().toISOString(),
    producer,
    correlationId: correlationId ?? eventId,
    payload,
  }
}

/**
 * Parses a Kafka message value into an envelope.
 *
 * Returns null rather than throwing on anything malformed. A single bad
 * message must not be able to kill a consumer loop — without this, one
 * unparseable payload (a hand-produced test message, a future producer's
 * incompatible schema) would throw on every redelivery and wedge the consumer
 * group's progress on that partition permanently.
 *
 * There is no schema registry here, so this is the ONLY validation boundary.
 * It deliberately checks only the envelope's own required fields; the payload
 * is the consumer's business to validate.
 */
export function parseEnvelope(value: Buffer | string | null): EventEnvelope | null {
  if (value === null) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(typeof value === 'string' ? value : value.toString('utf8'))
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const e = parsed as Partial<EventEnvelope>
  if (
    typeof e.eventId !== 'string' ||
    typeof e.eventType !== 'string' ||
    typeof e.occurredAt !== 'string' ||
    typeof e.producer !== 'string'
  ) {
    return null
  }

  return {
    eventId: e.eventId,
    eventType: e.eventType as EventType,
    eventVersion: typeof e.eventVersion === 'number' ? e.eventVersion : 1,
    occurredAt: e.occurredAt,
    producer: e.producer,
    correlationId: typeof e.correlationId === 'string' ? e.correlationId : e.eventId,
    payload: e.payload,
  }
}
