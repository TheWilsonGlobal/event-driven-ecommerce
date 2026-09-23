/**
 * Client-side mirror of `EventDataView` in
 * packages/shared/messaging/src/kafka/introspection.ts.
 *
 * Hand-mirrored rather than imported because @ecommerce/shared-messaging is a
 * server package (it pulls in kafkajs) and the admin bundle must not depend on
 * it — the same reason queueTypes.ts mirrors the queue introspection shape.
 *
 * ── The nullable fields are the whole point ─────────────────────────────────
 * `partitions`, `lag` and `state` are `| null` on purpose and MUST stay that
 * way. null means UNMEASURED — the admin API round trip to the broker failed,
 * the group is not registered yet, or Kafka is switched off entirely. Widening
 * any of them to a non-null number (or defaulting with `?? 0` at a call site)
 * republishes a measurement nobody took. `lag: 0` in particular reads as
 * "perfectly caught up", which is the most reassuring possible rendering of a
 * state we failed to observe. Render null as "—" / "unknown", never as 0.
 */

export interface TopicView {
  name: string
  /** Which service publishes to this topic. */
  producer: string
  /** What the partition key is, and therefore what ordering is guaranteed. */
  partitionKey: string
  description: string
  eventTypes: string[]
  /** Live partition count, or null when the broker could not be reached. */
  partitions: number | null
  /** Process-lifetime counters — these RESET on restart. Not durable totals. */
  published: number
  publishFailures: number
  lastPublishedAt: string | null
  lastFailureAt: string | null
  lastFailureReason: string | null
}

export interface ConsumerView {
  groupId: string
  topics: string[]
  /** kafkajs group state ('Stable' | 'Empty' | …), or null when unknown. */
  state: string | null
  /** Total lag across partitions. null = could not measure. NEVER 0 as a fallback. */
  lag: number | null
  running: boolean
  consumed: number
  failed: number
  skipped: number
  lastConsumedAt: string | null
  lastFailureAt: string | null
  lastFailureReason: string | null
}

export interface EventSummary {
  topicCount: number
  published: number
  publishFailures: number
  consumed: number
  consumerFailures: number
}

export interface EventData {
  /** false => KAFKA_ENABLED is off. A configured, healthy state — not an outage. */
  enabled: boolean
  /** Producer has a live broker connection. false while cold, even when healthy. */
  connected: boolean
  brokers: string[]
  topics: TopicView[]
  consumers: ConsumerView[]
  summary: EventSummary
  /** True when the counters above reset on process restart rather than being durable totals. */
  countersAreProcessLifetime: boolean
}

/**
 * A wedged consumer: claims to be running and is demonstrably behind, yet has
 * processed nothing this process lifetime.
 *
 * Worth its own predicate because `running: true, lag: 0-ish, consumed: 0` (a
 * healthy consumer with nothing to do) and `running: true, lag: 40, consumed: 0`
 * (a consumer that joined the group, was assigned partitions, and is not
 * draining them) render IDENTICALLY in a naive table — same green "running"
 * dot, same zero. The second is an incident.
 *
 * Deliberately requires `lag !== null`: an unmeasured lag is not evidence of
 * anything, and flagging it would manufacture an alarm from a missing
 * measurement — the mirror image of the fabricated-zero defect.
 */
export function isWedgedConsumer(c: ConsumerView): boolean {
  return c.running && c.lag !== null && c.lag > 0 && c.consumed === 0
}
