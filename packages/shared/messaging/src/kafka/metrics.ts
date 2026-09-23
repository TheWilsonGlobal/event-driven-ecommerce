import type { Kafka } from 'kafkajs'
import { Gauge, type Registry } from 'prom-client'
import type { EventProducer } from './producer'
import type { EventConsumer } from './consumer'
import { buildEventData } from './introspection'

/**
 * Prometheus metrics for the event backbone.
 *
 * Closes §6.6 of the implementation report — "consumer lag is observable but
 * unalerted". The numbers were already served by GET /api/v1/events; this puts
 * the same numbers on /metrics, where Prometheus already scrapes every service,
 * so a recording rule or an alert can finally be written against them.
 *
 * ── The central problem: Prometheus has no null ─────────────────────────────
 * introspection.ts is built around `lag: number | null`, where null means "the
 * admin round-trip failed, so we do not know". That distinction is the entire
 * reason the Snappy bug (§2.3) was caught: the wedged consumer reported
 * `running=true, consumed=0, failed=0` — perfectly healthy-looking — and ONLY
 * a non-zero lag disagreed.
 *
 * A Prometheus gauge cannot hold null. It can hold a number, or the series can
 * be ABSENT. So:
 *
 *     measurable    kafka_consumer_group_lag{group="..."} 3
 *     unmeasurable  (no series at all)
 *
 * Absence is the honest encoding, and it is also the useful one: `absent()` is
 * a first-class PromQL primitive, so "we stopped being able to measure lag"
 * becomes an alertable condition rather than a silent zero. Had this gauge
 * defaulted to 0 it would report a wedged consumer as perfectly caught up —
 * reintroducing at the metrics layer the exact bug the JSON layer was
 * carefully designed to expose.
 *
 * `gauge.remove(labels)` is what deletes a series. `gauge.set(labels, 0)` would
 * be a lie; leaving the previous value in place would be a STALE lie, which is
 * worse, because it decays silently instead of failing loudly.
 *
 * ── Why gauges, not counters, for the totals ────────────────────────────────
 * `published`, `consumed` and friends are already owned as authoritative
 * process-lifetime counters by EventProducer/EventConsumer. Mirroring them
 * onto a prom-client Counter would mean computing a delta on every scrape and
 * calling inc() — a second source of truth that can drift from the first.
 * Reporting the source value directly needs a Gauge, because a Counter offers
 * no "set to this absolute value" operation.
 *
 * This costs nothing in practice: `rate()` and `increase()` read the samples,
 * not the declared type, and a monotonic gauge behaves identically under both.
 * The one real difference is that a Gauge has no automatic counter-reset
 * detection, so a process restart shows as a DROP TO ZERO rather than being
 * smoothed over. These counters reset on restart anyway — that is what
 * `countersAreProcessLifetime` flags in the JSON — so the visible drop is an
 * accurate depiction of what happened, not an artefact.
 *
 * ── Scrape cost, and why it is bounded ──────────────────────────────────────
 * Measuring lag is a real admin round trip (describeGroups + fetchOffsets +
 * fetchTopicOffsets per topic), not a local read. Every one of those is already
 * bounded by withKafkaAdminDeadline inside buildEventData, so a dead broker
 * costs a scrape a bounded wait instead of hanging it — the same hazard that
 * made /health hang for 90 s in §2.1. A hanging scrape takes down the
 * monitoring of everything else in the process, so the bound matters more here
 * than almost anywhere else it appears.
 *
 * Throttled further by MIN_REFRESH_MS: Prometheus' default interval is 15 s and
 * several targets can scrape one process, so without it an unlucky alignment
 * would interrogate the broker far more often than the data changes.
 */

/** Floor on how often the broker is actually interrogated. */
const MIN_REFRESH_MS = 10_000

export interface KafkaMetricsOptions {
  /** The per-service registry returned by registerMetrics(). */
  registry: Registry
  /** Identifies the service in labels, e.g. 'ms-inventory'. */
  service: string
  producer: EventProducer
  consumers?: readonly EventConsumer[] | undefined
  /** Admin client, for partition counts and lag. Omit and both stay absent. */
  kafka?: Kafka | undefined
}

/**
 * Registers event-backbone metrics on an existing service registry.
 *
 * Safe to call when Kafka is disabled: the metrics are declared (so a scrape
 * has a stable shape and `kafka_enabled 0` is explicit) and simply carry no
 * consumer or lag series — the correct rendering of "no consumers exist",
 * as opposed to "consumers exist and are at 0".
 */
export function registerKafkaMetrics({
  registry,
  service,
  producer,
  consumers = [],
  kafka,
}: KafkaMetricsOptions): void {
  /**
   * Declares one gauge with the shared collect hook already attached.
   *
   * Every metric must carry it — see collectShared() for why attaching it to
   * only one silently produced an empty first scrape.
   */
  function gauge<T extends string>(config: {
    name: string
    help: string
    labelNames?: T[]
  }): Gauge<T> {
    return new Gauge<T>({
      ...config,
      registers: [registry],
      collect: collectShared,
    })
  }

  const connected = gauge({
    name: 'kafka_producer_connected',
    help: 'Whether this service currently holds a live producer connection (1) or not (0).',
  })

  const published = gauge({
    name: 'kafka_events_published_total',
    help: 'Domain events successfully published, by topic. Process-lifetime; resets on restart.',
    labelNames: ['topic'],
  })

  const publishFailures = gauge({
    name: 'kafka_publish_failures_total',
    help:
      'Publish attempts that failed and were SWALLOWED, by topic. Delivery is at-most-once, ' +
      'so each of these is an event that was lost rather than retried.',
    labelNames: ['topic'],
  })

  const topicPartitions = gauge({
    name: 'kafka_topic_partitions',
    help: 'Live partition count per topic. ABSENT when the broker could not be reached — never 0.',
    labelNames: ['topic'],
  })

  const consumerLag = gauge({
    name: 'kafka_consumer_group_lag',
    help:
      'Total consumer-group lag across partitions. ABSENT when it could not be measured — ' +
      'never 0, which would read as "caught up". Alert on absent() as well as on a high value.',
    labelNames: ['group', 'service'],
  })

  const consumerRunning = gauge({
    name: 'kafka_consumer_running',
    help:
      'Whether the consume loop is established (1) or not (0). 1 does NOT imply progress: a ' +
      'partition wedged on an undecodable message stays running=1 forever. Pair with lag.',
    labelNames: ['group', 'service'],
  })

  const consumed = gauge({
    name: 'kafka_events_consumed_total',
    help: 'Events handled successfully, by group. Process-lifetime; resets on restart.',
    labelNames: ['group', 'service'],
  })

  const consumerFailures = gauge({
    name: 'kafka_consumer_failures_total',
    help:
      'Handler invocations that threw, by group. The offset still advanced, so the event was ' +
      'dropped rather than retried.',
    labelNames: ['group', 'service'],
  })

  const consumerSkipped = gauge({
    name: 'kafka_events_skipped_total',
    help:
      'Messages deliberately not handled, by group: unparseable, or an event type this group ' +
      'does not subscribe to. Expected to be non-zero in normal operation.',
    labelNames: ['group', 'service'],
  })

  let lastRefresh = 0
  let inFlight: Promise<void> | null = null

  /**
   * Shared by EVERY metric's `collect`, and that breadth is load-bearing.
   *
   * prom-client v15 has no registry-level collect hook. Registry.metrics() maps
   * over the metrics concurrently with Promise.all, but each one serialises its
   * OWN values immediately after awaiting its OWN get() (see
   * getMetricsAsString). So a metric with no collect hook is snapshotted
   * without waiting for any other metric's hook to finish.
   *
   * Attaching the refresh to a single metric therefore looked correct and was
   * not: MEASURED 2026-09-23, the first scrape of a freshly started service
   * emitted only the two metrics that carry their own hook and NO consumer or
   * lag series at all, because those were read before the refresh had written
   * them. Every later scrape was fine, serving values the PREVIOUS refresh left
   * behind — permanently one scrape stale, and completely absent on the first.
   *
   * Giving every metric the same hook makes each one await the same shared
   * promise, so none is read before the refresh completes. The MIN_REFRESH_MS
   * throttle and the `inFlight` join mean this still performs exactly one set
   * of admin calls per scrape, not one per metric.
   */
  async function collectShared(): Promise<void> {
    if (!producer.enabled) {
      // No client exists, so there is nothing to interrogate. Leaving the other
      // series untouched (rather than zeroing them) keeps "disabled"
      // distinguishable from "enabled and idle".
      return
    }

    if (inFlight) {
      // A concurrent scrape — or another metric in THIS scrape — is already
      // measuring. Join it rather than issuing a second set of admin calls.
      await inFlight
      return
    }

    const now = Date.now()
    if (now - lastRefresh < MIN_REFRESH_MS) {
      return
    }
    lastRefresh = now

    inFlight = refresh()
      .catch(() => {
        // Swallowed deliberately: a metrics scrape must never be able to fail a
        // service, and an unreachable broker is already expressed by the series
        // this pass removes.
      })
      .finally(() => {
        inFlight = null
      })
    await inFlight
  }

  /**
   * Pulls the snapshot GET /api/v1/events serves and writes it onto the metrics
   * above.
   *
   * buildEventData never throws — it degrades every unreachable field to null —
   * so the only failures possible here are programming errors, which the
   * caller swallows rather than failing the whole scrape.
   */
  async function refresh(): Promise<void> {
    const data = await buildEventData({ producer, consumers, kafka })

    connected.set(data.connected ? 1 : 0)

    for (const topic of data.topics) {
      published.set({ topic: topic.name }, topic.published)
      publishFailures.set({ topic: topic.name }, topic.publishFailures)

      if (topic.partitions === null) {
        // Unmeasured, so the series is withdrawn rather than zeroed.
        topicPartitions.remove({ topic: topic.name })
      } else {
        topicPartitions.set({ topic: topic.name }, topic.partitions)
      }
    }

    for (const consumer of data.consumers) {
      // The group is the identity; `service` disambiguates two services that
      // (incorrectly) shared a group id, which would otherwise silently
      // overwrite each other's series and hide the very misconfiguration that
      // CONSUMER_GROUPS exists to prevent.
      const labels = { group: consumer.groupId, service }

      consumerRunning.set(labels, consumer.running ? 1 : 0)
      consumed.set(labels, consumer.consumed)
      consumerFailures.set(labels, consumer.failed)
      consumerSkipped.set(labels, consumer.skipped)

      if (consumer.lag === null) {
        // The load-bearing line of this module. A wedged consumer reports
        // running=1, consumed=0, failed=0 — indistinguishable from idle. Lag is
        // the only signal separating them, so when it cannot be measured the
        // series must vanish rather than claim zero.
        consumerLag.remove(labels)
      } else {
        consumerLag.set(labels, consumer.lag)
      }
    }
  }

  const enabled = gauge({
    name: 'kafka_enabled',
    help: 'Whether this service has the Kafka event backbone enabled (1) or not (0).',
  })
  // Static for the process lifetime, and the one metric that is meaningful
  // even when everything else is absent. Set once here rather than in
  // refresh(), which returns early when Kafka is disabled.
  enabled.set(producer.enabled ? 1 : 0)
}
