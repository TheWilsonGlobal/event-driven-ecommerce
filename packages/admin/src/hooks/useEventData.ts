import { useState, useEffect, useCallback } from 'react'
import type { ConsumerView, EventData, TopicView } from '../screens/events/eventTypes'
import {
  fetchJson,
  isFetchError,
  describeError as describeQueueError,
  type FetchError,
} from './useQueueData'
import {
  ANALYTICS_SERVICE_AUTHORITY,
  ANALYTICS_SERVICE_URL,
  INVENTORY_SERVICE_AUTHORITY,
  INVENTORY_SERVICE_URL,
  ORDER_SERVICE_AUTHORITY,
  ORDER_SERVICE_URL,
} from '../data/serviceUrls'

// Live Kafka event-backbone introspection, served by ms-order (publisher) and
// ms-inventory / ms-analytics (consumers) directly — the API gateway does not
// proxy /api/v1/events any more than it proxies /api/v1/queues.
//
// This file is the event-backbone sibling of useQueueData.ts and inherits its
// two rules verbatim:
//
//   1. No fallback data, ever. A failed fetch leaves that source's `data` null
//      and populates its `error`. Previously-loaded data is DROPPED rather than
//      shown stale, because an unqualified stale snapshot is just a slower kind
//      of fabricated number.
//   2. Partial failure never hides a working source. Each service is fetched
//      independently and reported independently.
//
// It adds a third rule that is specific to Kafka being optional:
//
//   3. Disabled is not an error. `200 + enabled:false` is KAFKA_ENABLED=false —
//      the repo default and a healthy configuration. It arrives here as normal
//      `data`, NOT as a FetchError, and the panel renders it as a deliberate
//      configured state. Only `503` (enabled but unreachable) is an outage.

/** Machine-readable cause from a 503 body. Mirrors KafkaUnavailableReason. */
export type KafkaUnavailableReason =
  | 'kafka_connection_refused'
  | 'kafka_timeout'
  | 'kafka_broker_unavailable'
  | 'kafka_dns_failure'
  | 'kafka_auth_failure'
  | 'kafka_error'
  | 'kafka_producer_disconnected'
// Note: `kafka_disabled` is deliberately absent. The backend never returns it
// as a 503 — it becomes a 200 with enabled:false — so treating it as an error
// reason here would create a code path that can only ever mislead.

/** The role a service plays on the backbone. Fixed wiring, not something the payload reports. */
export type EventRole = 'producer' | 'consumer'

interface EventSourceMeta {
  service: string
  role: EventRole
  url: string
  authority: string
}

const EVENT_SOURCES: readonly EventSourceMeta[] = [
  {
    service: 'ms-order',
    role: 'producer',
    url: `${ORDER_SERVICE_URL}/api/v1/events`,
    authority: ORDER_SERVICE_AUTHORITY,
  },
  {
    service: 'ms-inventory',
    role: 'consumer',
    url: `${INVENTORY_SERVICE_URL}/api/v1/events`,
    authority: INVENTORY_SERVICE_AUTHORITY,
  },
  {
    service: 'ms-analytics',
    role: 'consumer',
    url: `${ANALYTICS_SERVICE_URL}/api/v1/events`,
    authority: ANALYTICS_SERVICE_AUTHORITY,
  },
] as const

/** One service's slice of the merged result — which service, and its raw fetch outcome. */
export interface EventSource {
  service: string
  role: EventRole
  authority: string
  data: EventData | null
  error: FetchError | null
}

/** A topic row tagged with the service whose counters it carries. */
export interface TopicRow extends TopicView {
  /** The service that REPORTED these counters, which is not always `producer`. */
  reportedBy: string
}

/** A consumer row tagged with the service that hosts the group. */
export interface ConsumerRow extends ConsumerView {
  service: string
}

export interface MergedEventSummary {
  topicCount: number
  published: number
  publishFailures: number
  consumed: number
  consumerFailures: number
}

export interface MergedEventResource {
  /** Every source, in EVENT_SOURCES order. `data` is null on the ones that failed. */
  sources: EventSource[]
  /**
   * Topic rows from the sources that answered. Null only when EVERY source
   * failed — distinct from an empty array, which means "answered, no topics".
   */
  topics: TopicRow[] | null
  /** Consumer-group rows from the sources that answered. Null only when every source failed. */
  consumers: ConsumerRow[] | null
  /**
   * Cross-source totals, or null when every source failed.
   *
   * `topicCount` counts DISTINCT topic names rather than summing each service's
   * `summary.topicCount`: TOPIC_DEFINITIONS is a shared static list, so all
   * three services report the same three topics and naively summing would
   * report nine topics on a backbone that has three.
   */
  summary: MergedEventSummary | null
  /** True when EVERY answering source reports enabled:false — i.e. Kafka is switched off. */
  allDisabled: boolean
  /** True when at least one answering source reports enabled:false. */
  anyDisabled: boolean
  /** True when at least one answering source has a live producer connection. */
  anyConnected: boolean
  /** Union of the brokers every answering source is configured against. */
  brokers: string[]
  /** True when at least one answering source flags its counters as process-lifetime. */
  countersAreProcessLifetime: boolean
  loading: boolean
  lastUpdated: string | null
  refetch: () => void
}

/**
 * Topic rows across every answering service.
 *
 * Deliberately NOT deduplicated by topic name. All three services embed the
 * same TOPIC_DEFINITIONS, but the per-topic counters (`published`,
 * `publishFailures`, `lastPublishedAt`) are that service's OWN producer
 * counters — ms-inventory publishes `ecommerce.inventory.v1` while ms-order
 * publishes orders and payments. Collapsing rows by name would have to pick a
 * winner among counter sets, and whichever it picked would present one
 * service's numbers under another service's name.
 */
function collectTopics(sources: EventSource[]): TopicRow[] | null {
  const answered = sources.filter((s): s is EventSource & { data: EventData } => s.data !== null)
  if (answered.length === 0) {
    return null
  }
  return answered.flatMap((s) =>
    s.data.topics.map((t): TopicRow => ({ ...t, reportedBy: s.service }))
  )
}

function collectConsumers(sources: EventSource[]): ConsumerRow[] | null {
  const answered = sources.filter((s): s is EventSource & { data: EventData } => s.data !== null)
  if (answered.length === 0) {
    return null
  }
  return answered.flatMap((s) =>
    s.data.consumers.map((c): ConsumerRow => ({ ...c, service: s.service }))
  )
}

/**
 * Every service on the event backbone, fetched in parallel and collected for
 * the Events tab.
 *
 * Partial-failure policy matches useMergedQueueData: one service being
 * unreachable must not hide another's data. Each source keeps its own
 * `error`, the tab renders an inline banner per failed source, and the
 * collections are null only when every source failed.
 */
export function useMergedEventData(): MergedEventResource {
  const [sources, setSources] = useState<EventSource[]>(
    EVENT_SOURCES.map(({ service, role, authority }) => ({
      service,
      role,
      authority,
      data: null,
      error: null,
    }))
  )
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.all(
      EVENT_SOURCES.map(async ({ service, role, url, authority }): Promise<EventSource> => {
        try {
          const data = await fetchJson<EventData>(url)
          return { service, role, authority, data, error: null }
        } catch (err) {
          return {
            service,
            role,
            authority,
            data: null,
            error: isFetchError(err)
              ? err
              : { kind: 'network', message: err instanceof Error ? err.message : String(err) },
          }
        }
      })
    )
    setSources(results)
    setLastUpdated(new Date().toISOString())
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    // `load` owns its own state writes; the flag just avoids a stray set after
    // unmount.
    void (async () => {
      if (cancelled) return
      await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const refetch = useCallback(() => {
    void load()
  }, [load])

  const answered = sources.filter((s): s is EventSource & { data: EventData } => s.data !== null)
  const topics = collectTopics(sources)
  const consumers = collectConsumers(sources)

  // Null when nothing answered. A zero-seeded reducer here would render
  // "0 published · 0 consumed" beside a full-page outage banner, which is
  // pixel-identical to a healthy but idle backbone.
  const summary: MergedEventSummary | null =
    answered.length === 0
      ? null
      : {
          // Distinct names, not a sum — see MergedEventResource.summary.
          topicCount: new Set((topics ?? []).map((t) => t.name)).size,
          published: answered.reduce((sum, s) => sum + s.data.summary.published, 0),
          publishFailures: answered.reduce((sum, s) => sum + s.data.summary.publishFailures, 0),
          consumed: answered.reduce((sum, s) => sum + s.data.summary.consumed, 0),
          consumerFailures: answered.reduce((sum, s) => sum + s.data.summary.consumerFailures, 0),
        }

  return {
    sources,
    topics,
    consumers,
    summary,
    // False when nothing answered: we cannot claim Kafka is switched off on
    // the strength of services that never replied.
    allDisabled: answered.length > 0 && answered.every((s) => !s.data.enabled),
    anyDisabled: answered.some((s) => !s.data.enabled),
    anyConnected: answered.some((s) => s.data.connected),
    brokers: [...new Set(answered.flatMap((s) => s.data.brokers))].sort((a, b) =>
      a.localeCompare(b)
    ),
    countersAreProcessLifetime: answered.some((s) => s.data.countersAreProcessLifetime),
    loading,
    lastUpdated,
    refetch,
  }
}

/**
 * Short operator-facing label for a failed event-source fetch.
 *
 * Kafka's own 503 reasons are handled here; anything else falls through to
 * useQueueData's describeError, which already knows how to phrase a network
 * failure against a named service and authority.
 */
export function describeEventSourceError(source: EventSource): string {
  const error = source.error
  if (!error) {
    return ''
  }
  switch (error.reason) {
    case 'kafka_connection_refused':
      return 'the Kafka broker refused the connection'
    case 'kafka_timeout':
      return 'the Kafka broker did not answer in time'
    case 'kafka_broker_unavailable':
      return 'no Kafka broker is available'
    case 'kafka_dns_failure':
      return 'the Kafka broker host could not be resolved'
    case 'kafka_auth_failure':
      return 'the Kafka broker rejected our credentials'
    case 'kafka_producer_disconnected':
      return 'the producer lost its broker connection'
    case 'kafka_error':
      return 'the Kafka client returned an error'
    default:
      return describeQueueError(error, source.service, source.authority)
  }
}
