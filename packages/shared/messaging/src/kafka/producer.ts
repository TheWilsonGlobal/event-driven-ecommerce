import type { Kafka, Producer } from 'kafkajs'
import { createKafkaClient, loadKafkaSettings, type KafkaSettings } from './client'
import { makeEnvelope, type EventEnvelope } from './envelope'
import { KafkaUnavailableError, toKafkaUnavailable } from './errors'
import type { EventType, TopicName } from './topics'
import { describeError } from '../describeError'

/**
 * Publishes domain events to the backbone.
 *
 * ── Publish AFTER the commit, and never fail the caller ─────────────────────
 * `tryPublish` is the method routes should use. It mirrors QueueManager's
 * `tryEnqueue` exactly, including the reasoning stated there:
 *
 *   "A Redis outage must NOT fail an order that was already committed to the
 *    relational database. The enqueue failure is logged and swallowed; the
 *    order stands."
 *
 * The same holds for Kafka, with the same known consequence: a crash between
 * the database commit and the publish LOSES the event. This is at-most-once
 * delivery, and it is a deliberate trade for a sample repo — the alternative is
 * a transactional outbox table drained by a poller, which is a subsystem of its
 * own. What matters is that the gap is reported rather than hidden:
 * `publishFailures` below is a real counter surfaced by GET /api/v1/events, and
 * the README states the guarantee plainly.
 *
 * ── Counters are process-lifetime ───────────────────────────────────────────
 * `published` / `failed` reset when the process restarts. They are labelled as
 * such everywhere they surface. Presenting a restart-resetting counter as a
 * lifetime total is exactly the class of quiet lie this codebase has repeatedly
 * removed from its admin panels.
 */

export interface TopicCounters {
  published: number
  publishFailures: number
  lastPublishedAt: string | null
  lastFailureAt: string | null
  lastFailureReason: string | null
}

export interface PublishInput<T> {
  topic: TopicName
  eventType: EventType
  /**
   * The partition key. Load-bearing for ordering: all events sharing a key land
   * on one partition and are consumed in order. See topics.ts.
   */
  key: string
  payload: T
  correlationId?: string | undefined
}

/**
 * Hard deadline on a single publish attempt (connect + send).
 *
 * ⚠️ This is NOT redundant with the client's connectionTimeout/requestTimeout.
 * The shared client sets `retries: Number.MAX_SAFE_INTEGER` so CONSUMERS
 * self-heal after a broker blip without a restart (see client.ts). Applied to
 * a producer on the HTTP path that is actively harmful: `producer.connect()`
 * against a dead broker retries forever and never rejects, so `tryPublish`
 * never returns and the caller's request hangs.
 *
 * Measured before this guard existed: POST /api/v1/orders did not return in
 * 61s with the broker unreachable. That directly violates the rule this whole
 * module is built around — a messaging outage must never fail, or stall, work
 * that is already committed to the database. Three seconds is well beyond a
 * healthy publish (~5ms observed) and far below any caller's patience.
 */
const PUBLISH_TIMEOUT_MS = 3000

/**
 * How long a known-bad broker is treated as bad before we try again.
 *
 * Without this, EVERY publish pays the full PUBLISH_TIMEOUT_MS while the
 * broker is down. Measured: POST /api/v1/orders took 6.17s because the route
 * publishes twice and each attempt waited out its own 3s deadline. The order
 * did succeed — the failure is swallowed as designed — but a 6s checkout is a
 * user-visible regression caused by an optional subsystem being unavailable,
 * which is exactly what "a messaging outage must not affect committed work"
 * is supposed to rule out.
 *
 * So the first failure opens a breaker and subsequent publishes fail
 * IMMEDIATELY (counted and logged as normal) until the window elapses, at
 * which point one attempt is allowed through to re-probe. That keeps the
 * self-healing property — no restart needed when the broker returns — while
 * bounding the cost of an outage to roughly one timeout per window rather
 * than one per publish.
 */
const BREAKER_WINDOW_MS = 30_000

/**
 * Races an operation against the deadline above.
 *
 * Rejects with a KafkaUnavailableError on timeout so the caller's normal
 * failure path (count it, log it, swallow it) handles it like any other
 * broker failure.
 */
async function withPublishDeadline<T>(fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new KafkaUnavailableError(
            'kafka_timeout',
            `Kafka publish exceeded ${PUBLISH_TIMEOUT_MS}ms`
          )
        ),
      PUBLISH_TIMEOUT_MS
    )
    timer.unref?.()
  })
  try {
    return await Promise.race([fn(), deadline])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

function emptyCounters(): TopicCounters {
  return {
    published: 0,
    publishFailures: 0,
    lastPublishedAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
  }
}

export class EventProducer {
  private readonly kafka: Kafka | undefined
  private producer: Producer | undefined
  private readonly counters = new Map<TopicName, TopicCounters>()
  private connected = false
  private connecting: Promise<void> | null = null
  private closed = false
  private lastError: KafkaUnavailableError | null = null
  /** Epoch ms of the last publish failure; drives the breaker above. */
  private breakerOpenedAt = 0

  /**
   * @param producerName the service publishing, e.g. 'ms-order'. Lands in every
   *   envelope's `producer` field and in the Kafka clientId.
   * @param settings defaults to the environment. When `enabled` is false NO
   *   client is constructed — see client.ts.
   */
  constructor(
    private readonly producerName: string,
    private readonly logPrefix: string,
    private readonly settings: KafkaSettings = loadKafkaSettings(producerName)
  ) {
    if (!this.settings.enabled) {
      return
    }
    this.kafka = createKafkaClient(this.settings, logPrefix)
  }

  get enabled(): boolean {
    return this.settings.enabled
  }

  get isConnected(): boolean {
    return this.connected
  }

  get brokers(): string[] {
    return [...this.settings.brokers]
  }

  getLastError(): KafkaUnavailableError | null {
    return this.lastError
  }

  /** Per-topic counters for GET /api/v1/events. Process-lifetime, not durable. */
  countersFor(topic: TopicName): TopicCounters {
    return this.counters.get(topic) ?? emptyCounters()
  }

  private bumpCounters(topic: TopicName, mutate: (c: TopicCounters) => void): void {
    const current = this.counters.get(topic) ?? emptyCounters()
    mutate(current)
    this.counters.set(topic, current)
  }

  /**
   * Connects lazily, and at most once concurrently.
   *
   * Callers race here — several routes can publish at the same moment on a cold
   * producer. Without the shared `connecting` promise each would call
   * producer.connect() independently.
   */
  private async ensureConnected(): Promise<Producer> {
    if (this.closed) {
      throw new KafkaUnavailableError(
        'kafka_producer_disconnected',
        'Event producer has been shut down'
      )
    }
    if (!this.kafka) {
      throw new KafkaUnavailableError(
        'kafka_disabled',
        'Kafka is disabled (KAFKA_ENABLED is not "true")'
      )
    }

    if (this.producer && this.connected) {
      return this.producer
    }

    if (!this.producer) {
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: true,
        // Bounded so a dead broker surfaces as a fast failure rather than a
        // request that hangs behind the caller's HTTP response.
        transactionTimeout: 30_000,
      })
      this.producer.on(this.producer.events.DISCONNECT, () => {
        this.connected = false
      })
    }

    if (!this.connecting) {
      const producer = this.producer
      this.connecting = producer
        .connect()
        .then(() => {
          this.connected = true
          this.lastError = null
        })
        .catch((err: unknown) => {
          this.connected = false
          this.lastError = toKafkaUnavailable(err)
          throw this.lastError
        })
        .finally(() => {
          this.connecting = null
        })
    }

    // Capture before awaiting: if this attempt times out, the shared promise
    // must not be left as the one every later publish awaits, or one stalled
    // connect would make every subsequent publish inherit the same stall.
    const pending = this.connecting
    try {
      await pending
    } catch (err) {
      throw toKafkaUnavailable(err)
    }
    return this.producer
  }

  /**
   * Publishes an event. THROWS on failure — use `tryPublish` from a route.
   *
   * Exposed for the rare caller that genuinely must know (a test, an operator
   * endpoint that reports the outcome).
   */
  async publish<T>({
    topic,
    eventType,
    key,
    payload,
    correlationId,
  }: PublishInput<T>): Promise<EventEnvelope<T>> {
    const envelope = makeEnvelope({
      eventType,
      producer: this.producerName,
      payload,
      correlationId,
    })

    // Breaker: a broker known to be down in the last BREAKER_WINDOW_MS fails
    // instantly rather than making this caller wait out another full timeout.
    if (this.breakerOpenedAt > 0 && Date.now() - this.breakerOpenedAt < BREAKER_WINDOW_MS) {
      const err =
        this.lastError ??
        new KafkaUnavailableError('kafka_broker_unavailable', 'Kafka broker recently unreachable')
      this.bumpCounters(topic, (c) => {
        c.publishFailures += 1
        c.lastFailureAt = new Date().toISOString()
        c.lastFailureReason = err.reason
      })
      throw err
    }

    try {
      // Bounded as a whole: connect AND send share one deadline, because a
      // dead broker can stall at either step. See PUBLISH_TIMEOUT_MS.
      await withPublishDeadline(async () => {
        const producer = await this.ensureConnected()
        await producer.send({
          topic,
          messages: [
            {
              key,
              value: JSON.stringify(envelope),
              headers: {
                'event-type': envelope.eventType,
                'event-id': envelope.eventId,
                'correlation-id': envelope.correlationId,
              },
            },
          ],
        })
      })
      // Success closes the breaker, so recovery needs no restart.
      this.breakerOpenedAt = 0
      this.bumpCounters(topic, (c) => {
        c.published += 1
        c.lastPublishedAt = new Date().toISOString()
      })
      return envelope
    } catch (err) {
      const unavailable = toKafkaUnavailable(err)
      this.lastError = unavailable
      // Open the breaker so the next publish does not repeat this wait.
      this.breakerOpenedAt = Date.now()
      this.bumpCounters(topic, (c) => {
        c.publishFailures += 1
        c.lastFailureAt = new Date().toISOString()
        c.lastFailureReason = unavailable.reason
      })
      throw unavailable
    }
  }

  /**
   * Fire-and-forget publish used by the HTTP routes.
   *
   * A broker outage must NOT fail work that is already committed to the
   * database. The failure is counted (so /api/v1/events reports it honestly),
   * logged, and swallowed. Returns the envelope on success, null on failure, so
   * a caller can report truthfully rather than assuming.
   *
   * Returns null immediately when Kafka is disabled — no error, no log. That is
   * a configured state, not a fault.
   */
  async tryPublish<T>(input: PublishInput<T>): Promise<EventEnvelope<T> | null> {
    if (!this.settings.enabled) {
      return null
    }
    try {
      return await this.publish(input)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `${this.logPrefix} Failed to publish ${input.eventType} to ${input.topic}: ${describeError(err)}`
      )
      return null
    }
  }

  /**
   * Flushes and disconnects. Safe to call when disabled or never connected.
   *
   * Must be wired into the service's shutdown handler: kafkajs batches sends
   * internally, so exiting without disconnecting can drop already-accepted
   * messages that have not yet left the process.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    this.connected = false
    if (!this.producer) {
      return
    }
    try {
      await this.producer.disconnect()
    } catch {
      /* already down — nothing to unwind */
    }
  }
}
