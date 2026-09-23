import type { Admin, Kafka } from 'kafkajs'
import type { EventProducer } from './producer'
import type { EventConsumer } from './consumer'
import { TOPIC_DEFINITIONS, type TopicName } from './topics'
import { withKafkaAdminDeadline } from './health'
import { describeError } from '../describeError'

/**
 * Builds the GET /api/v1/events payload.
 *
 * Mirrors buildQueueData() in introspection.ts, and inherits its central rule:
 * an unreachable backend must be DISTINGUISHABLE from an idle one. The route
 * layer turns "enabled but unreachable" into a 503; "disabled" is a 200 with
 * `enabled: false`, because a switched-off optional feature is a healthy state,
 * not a fault.
 *
 * ── Why `lag` is nullable and must stay that way ────────────────────────────
 * Consumer lag comes from a real admin-API round trip. When that call fails —
 * broker down, group not yet registered, ACL refusal — the honest answer is
 * "unknown", i.e. null. It must NEVER be reported as 0, which would read as
 * "perfectly caught up": the most reassuring possible rendering of a state we
 * failed to measure.
 *
 * The JSON schema therefore types it `['number', 'null']`. With a plain
 * `{ type: 'number' }` Fastify's serializer coerces null to 0 and the lie
 * happens at the wire, far from this file. recentJobSchema.failedReason carries
 * a comment about the identical trap.
 */

export interface TopicView {
  name: string
  producer: string
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
  /** kafkajs group state: 'Stable' | 'Empty' | ... or null when unknown. */
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

export interface EventDataView {
  enabled: boolean
  connected: boolean
  brokers: string[]
  topics: TopicView[]
  consumers: ConsumerView[]
  summary: {
    topicCount: number
    published: number
    publishFailures: number
    consumed: number
    consumerFailures: number
  }
  /**
   * True when counters above are process-lifetime rather than durable totals.
   * Always true today; present so the admin can label them without hardcoding
   * an assumption it cannot verify.
   */
  countersAreProcessLifetime: boolean
}

/**
 * Per-topic partition counts. Absent keys mean "could not measure".
 *
 * ⚠️ Asks only for topics the broker ALREADY reports via listTopics(). Passing
 * a topic that does not exist yet makes fetchTopicMetadata throw
 * "This server does not host this topic-partition" for the WHOLE call — so a
 * single not-yet-created topic would discard the partition counts of every
 * topic that does exist. Topics here are auto-created on first publish, so
 * "not yet created" is the normal cold-start state, not an error. (Verified
 * against Redpanda v24.2.7, 2026-09-23.)
 */
async function fetchPartitionCounts(admin: Admin): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  try {
    const wanted = new Set<string>(TOPIC_DEFINITIONS.map((d) => d.name))
    const existing = (await admin.listTopics()).filter((name) => wanted.has(name))
    if (existing.length === 0) {
      return counts
    }
    const metadata = await admin.fetchTopicMetadata({ topics: existing })
    for (const topic of metadata.topics) {
      counts.set(topic.name, topic.partitions.length)
    }
  } catch {
    // Leave the map empty — callers render null, not 0.
  }
  return counts
}

/**
 * Measures a consumer group's total lag.
 *
 * Returns null on ANY failure rather than a number, so an unmeasurable lag can
 * never be rendered as a healthy zero.
 */
async function fetchConsumerLag(
  admin: Admin,
  groupId: string,
  topics: string[]
): Promise<{ state: string | null; lag: number | null }> {
  try {
    const described = await admin.describeGroups([groupId])
    const group = described.groups.find((g) => g.groupId === groupId)
    const state = group?.state ?? null

    let total = 0
    let measuredAny = false

    for (const topic of topics) {
      // Per-topic try: a topic that does not exist yet (nothing published to it
      // since these are auto-created on first publish) makes fetchTopicOffsets
      // throw. Letting that escape would discard the lag of every OTHER topic
      // this group reads AND lose the group state we already measured —
      // reporting "unknown" for a group we can see perfectly well.
      try {
        const offsets = await admin.fetchOffsets({ groupId, topics: [topic] })
        const topicOffsets = offsets.find((o) => o.topic === topic)
        if (!topicOffsets) {
          continue
        }
        const high = await admin.fetchTopicOffsets(topic)

        for (const partition of topicOffsets.partitions) {
          const end = high.find((h) => h.partition === partition.partition)
          if (!end) {
            continue
          }
          const committed = Number(partition.offset)
          const latest = Number(end.offset)
          // -1 means the group has never committed an offset for this
          // partition. Its lag is the whole partition.
          const behind = committed < 0 ? latest : latest - committed
          if (Number.isFinite(behind)) {
            total += Math.max(0, behind)
            measuredAny = true
          }
        }
      } catch {
        // This topic's lag is unmeasurable; others may still be fine.
        continue
      }
    }

    // measuredAny false => every topic failed or had no offsets. Report null
    // ("unknown"), never 0 ("caught up").
    return { state, lag: measuredAny ? total : null }
  } catch {
    return { state: null, lag: null }
  }
}

export interface BuildEventDataInput {
  producer: EventProducer
  consumers?: readonly EventConsumer[] | undefined
  /** Used only for admin-API calls (partition counts, lag). */
  kafka?: Kafka | undefined
}

/**
 * Builds the full event-backbone view.
 *
 * Never throws. When the broker is unreachable every live field degrades to
 * null and `connected` is false — the ROUTE decides whether that is a 503,
 * because only the route knows whether the caller asked for a health gate or a
 * best-effort snapshot.
 */
export async function buildEventData({
  producer,
  consumers = [],
  kafka,
}: BuildEventDataInput): Promise<EventDataView> {
  const enabled = producer.enabled

  let partitionCounts = new Map<string, number>()
  const consumerViews: ConsumerView[] = []
  let admin: Admin | undefined

  if (enabled && kafka) {
    admin = kafka.admin()
    let adminConnected = false
    try {
      // Bounded: the shared client retries forever by design (so consumers
      // self-heal), which means a raw admin.connect() against a dead broker
      // never rejects and would hang this request indefinitely. See
      // withKafkaAdminDeadline.
      const connected = await withKafkaAdminDeadline(async () => {
        await admin!.connect()
        return true
      })
      if (connected) {
        adminConnected = true
        partitionCounts =
          (await withKafkaAdminDeadline(() => fetchPartitionCounts(admin!))) ?? new Map()
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Kafka admin unavailable for introspection: ${describeError(err)}`)
    }

    for (const consumer of consumers) {
      const live =
        adminConnected && admin
          ? ((await withKafkaAdminDeadline(() =>
              fetchConsumerLag(admin!, consumer.groupId, consumer.topics)
            )) ?? { state: null, lag: null })
          : { state: null, lag: null }
      const stats = consumer.stats
      consumerViews.push({
        groupId: consumer.groupId,
        topics: consumer.topics,
        state: live.state,
        lag: live.lag,
        running: consumer.isRunning,
        consumed: stats.consumed,
        failed: stats.failed,
        skipped: stats.skipped,
        lastConsumedAt: stats.lastConsumedAt,
        lastFailureAt: stats.lastFailureAt,
        lastFailureReason: stats.lastFailureReason,
      })
    }

    if (adminConnected && admin) {
      // Not awaited: disconnect() can block behind the same stuck connection
      // when the broker is down.
      void admin.disconnect().catch(() => {
        /* nothing to unwind */
      })
    }
  } else {
    // Disabled, or no admin client: still report the consumers' own local
    // counters. They are real, just unaccompanied by broker-side lag.
    for (const consumer of consumers) {
      const stats = consumer.stats
      consumerViews.push({
        groupId: consumer.groupId,
        topics: consumer.topics,
        state: null,
        lag: null,
        running: consumer.isRunning,
        consumed: stats.consumed,
        failed: stats.failed,
        skipped: stats.skipped,
        lastConsumedAt: stats.lastConsumedAt,
        lastFailureAt: stats.lastFailureAt,
        lastFailureReason: stats.lastFailureReason,
      })
    }
  }

  const topics: TopicView[] = TOPIC_DEFINITIONS.map((def) => {
    const counters = producer.countersFor(def.name as TopicName)
    return {
      name: def.name,
      producer: def.producer,
      partitionKey: def.partitionKey,
      description: def.description,
      eventTypes: [...def.eventTypes],
      partitions: partitionCounts.get(def.name) ?? null,
      published: counters.published,
      publishFailures: counters.publishFailures,
      lastPublishedAt: counters.lastPublishedAt,
      lastFailureAt: counters.lastFailureAt,
      lastFailureReason: counters.lastFailureReason,
    }
  })

  return {
    enabled,
    connected: producer.isConnected,
    brokers: producer.brokers,
    topics,
    consumers: consumerViews,
    summary: {
      topicCount: topics.length,
      published: topics.reduce((sum, t) => sum + t.published, 0),
      publishFailures: topics.reduce((sum, t) => sum + t.publishFailures, 0),
      consumed: consumerViews.reduce((sum, c) => sum + c.consumed, 0),
      consumerFailures: consumerViews.reduce((sum, c) => sum + c.failed, 0),
    },
    countersAreProcessLifetime: true,
  }
}
