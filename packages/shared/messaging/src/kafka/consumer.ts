import type { Consumer, Kafka } from 'kafkajs'
import { createKafkaClient, loadKafkaSettings, type KafkaSettings } from './client'
import { parseEnvelope, type EventEnvelope } from './envelope'
import { toKafkaUnavailable, type KafkaUnavailableError } from './errors'
import type { ConsumerGroupId, EventType, TopicName } from './topics'
import { describeError } from '../describeError'

/**
 * Consumes domain events from the backbone.
 *
 * ── One consumer group per SERVICE ──────────────────────────────────────────
 * The `groupId` must come from CONSUMER_GROUPS (topics.ts) and must never be
 * shared between two services. Kafka splits partitions between the members of a
 * group, so two services on one group id would each see roughly HALF the events
 * — presenting as intermittent, random-looking data loss. Each service having
 * its own group is what makes every service receive its own full copy, and what
 * makes adding ms-analytics a zero-risk change to ms-inventory.
 *
 * ── Idempotency is the HANDLER's job, not this class's ──────────────────────
 * Kafka redelivers on rebalance, on restart, and whenever an offset was not
 * committed. A handler WILL see the same `eventId` twice and must tolerate it.
 * Two mechanisms, both already idiomatic in this repo:
 *
 *   1. When the handler enqueues BullMQ work, derive a DETERMINISTIC jobId from
 *      the eventId — `jobId: \`reserve-${envelope.eventId}\``. BullMQ then
 *      dedupes for free. This is the trick enqueueExpireOrder already uses with
 *      `expire-${orderId}`.
 *   2. When the handler writes to its own store, key the write on eventId and
 *      skip a duplicate.
 *
 * Note the counter-example: enqueueRetryCapture deliberately uses a UNIQUE id
 * per enqueue, because a payment may legitimately be retried more than once.
 * Idempotency keys belong on the EVENT, not reflexively on every job.
 *
 * ── A failing HANDLER must not wedge the partition ──────────────────────────
 * If a handler throws, kafkajs does not commit the offset and redelivers the
 * same message — forever, if the failure is deterministic (a malformed payload,
 * a bug). That blocks every later message on the partition. So handler errors
 * are CAUGHT, counted and logged here, and the offset advances. The failure is
 * visible in `GET /api/v1/events` as a real `failed` count rather than as a
 * silently stalled consumer.
 *
 * This is a deliberate at-most-once choice for the handler side, mirroring the
 * at-most-once publish side. A consumer that must not drop work should enqueue
 * a BullMQ job as its FIRST action and do the real work there, where retries,
 * backoff and a dead-letter state actually exist. That is the whole reason the
 * diagram has BullMQ below Kafka rather than instead of it.
 *
 * ⚠️ ── The limit of that guarantee: it covers HANDLERS ONLY ──────────────────
 * `dispatch()` below is only ever reached for a message kafkajs has already
 * fetched and DECODED. A failure BEFORE that point is outside this class
 * entirely — it happens inside kafkajs' own fetch loop, so no try/catch here
 * can see it, and the offset is never committed.
 *
 * The real instance, observed 2026-09-23: a message produced by
 * `rpk topic produce` (which defaults to Snappy) against a kafkajs consumer
 * with no Snappy codec registered. Result:
 *
 *     Crash: KafkaJSNotImplemented: Snappy compression not implemented
 *
 * The partition wedged PERMANENTLY — group state `Empty`, lag climbing,
 * `consumed: 0`, and it survived a full service restart, because the poison is
 * in the log, not in the process. Worse, `running` stays `true`: the symptom is
 * indistinguishable from "no traffic" unless you look at lag.
 *
 * Mitigated at the source by registering the Snappy codec in client.ts, which
 * removes the only decode failure this repo can currently produce. It is a
 * mitigation, not a general fix: any future decode-level failure (an
 * unsupported codec such as LZ4/zstd, a corrupt batch) would wedge the
 * partition the same way. Recovery is operational, not in-process —
 * `rpk group seek <group> --to <timestamp|end>` — and it is per-group, so the
 * message stays poisoned for every other consumer of that topic.
 *
 * This is why `lag` is measured and surfaced rather than assumed: it is the
 * ONLY signal that distinguishes this state from an idle topic.
 */

export interface ConsumerCounters {
  consumed: number
  failed: number
  skipped: number
  lastConsumedAt: string | null
  lastFailureAt: string | null
  lastFailureReason: string | null
}

export type EventHandler = (envelope: EventEnvelope, context: EventContext) => Promise<void>

export interface EventContext {
  topic: string
  partition: number
  offset: string
}

export interface EventConsumerOptions {
  groupId: ConsumerGroupId
  topics: TopicName[]
  /**
   * Read the topic from its start on a group's FIRST run (no committed
   * offsets). Has no effect once the group has offsets, so it is not a replay
   * switch — resetting offsets is.
   *
   * ms-analytics sets this true: it is a pure aggregate over history, so it
   * should see everything that ever happened. ms-inventory sets it false —
   * replaying months of old orders would reserve stock for orders long since
   * shipped.
   */
  fromBeginning: boolean
  logPrefix: string
  clientId: string
}

/**
 * How long a caller waits for start() before being told "not yet".
 *
 * Generous, because a healthy connect is well under a second and a slow one is
 * usually a broker mid-election rather than a dead one. See start().
 */
const START_TIMEOUT_MS = 4000

function emptyCounters(): ConsumerCounters {
  return {
    consumed: 0,
    failed: 0,
    skipped: 0,
    lastConsumedAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
  }
}

export class EventConsumer {
  private readonly kafka: Kafka | undefined
  private consumer: Consumer | undefined
  private readonly handlers = new Map<EventType, EventHandler[]>()
  private readonly counters = emptyCounters()
  private running = false
  private closed = false
  private lastError: KafkaUnavailableError | null = null

  constructor(
    private readonly options: EventConsumerOptions,
    private readonly settings: KafkaSettings = loadKafkaSettings(options.clientId)
  ) {
    if (!this.settings.enabled) {
      return
    }
    this.kafka = createKafkaClient(this.settings, options.logPrefix)
  }

  get enabled(): boolean {
    return this.settings.enabled
  }

  get isRunning(): boolean {
    return this.running
  }

  get groupId(): string {
    return this.options.groupId
  }

  get topics(): string[] {
    return [...this.options.topics]
  }

  get stats(): ConsumerCounters {
    return { ...this.counters }
  }

  getLastError(): KafkaUnavailableError | null {
    return this.lastError
  }

  /**
   * Registers a handler for one event type. Several handlers may share a type;
   * they run in registration order, and one throwing does not stop the others.
   */
  on(eventType: EventType, handler: EventHandler): this {
    const existing = this.handlers.get(eventType) ?? []
    existing.push(handler)
    this.handlers.set(eventType, existing)
    return this
  }

  /**
   * Connects, subscribes and starts the consume loop.
   *
   * Never throws when the broker is unreachable — it logs and returns false, so
   * a service always finishes booting and serves HTTP. kafkajs' own retry
   * machinery (restartOnFailure, see client.ts) reconnects in the background,
   * so the consumer self-heals when the broker returns without a restart.
   *
   * ⚠️ BOUNDED, and the bound is load-bearing. `consumer.connect()` inherits
   * the client's `retries: MAX_SAFE_INTEGER`, so against a dead broker it
   * never resolves AND never rejects — measured still-pending at 30s. A caller
   * that awaits an unbounded start() therefore parks forever, and everything
   * sharing the kafkajs broker pool queues behind it.
   *
   * Returning false after START_TIMEOUT_MS does NOT abandon the consumer: the
   * underlying connect stays in flight and kafkajs' retry loop brings it up
   * when the broker returns. The timeout only bounds how long the CALLER
   * waits. `running` stays false until the loop is genuinely established, so
   * the honest answer to "is it consuming?" is still false rather than an
   * optimistic true.
   */
  async start(): Promise<boolean> {
    if (!this.kafka || this.closed) {
      return false
    }

    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), START_TIMEOUT_MS)
      timer.unref?.()
    })

    try {
      return await Promise.race([this.connectAndRun(), deadline])
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  /** The unbounded body of start(); raced against a deadline by start(). */
  private async connectAndRun(): Promise<boolean> {
    // start() has already established this; re-checked so the narrowing holds
    // inside this method rather than being asserted away.
    const kafka = this.kafka
    if (!kafka) {
      return false
    }

    try {
      this.consumer = kafka.consumer({
        groupId: this.options.groupId,
        // Generous, because a slow handler must not be mistaken for a dead
        // member: exceeding this triggers a group rebalance, which redelivers
        // in-flight messages to another member and makes duplicate processing
        // far more likely.
        sessionTimeout: 30_000,
        heartbeatInterval: 3000,
      })

      await this.consumer.connect()

      for (const topic of this.options.topics) {
        await this.consumer.subscribe({ topic, fromBeginning: this.options.fromBeginning })
      }

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          await this.dispatch(topic, partition, message.offset, message.value)
        },
      })

      this.running = true
      this.lastError = null
      return true
    } catch (err) {
      this.running = false
      this.lastError = toKafkaUnavailable(err)
      // eslint-disable-next-line no-console
      console.warn(
        `${this.options.logPrefix} Kafka consumer "${this.options.groupId}" failed to start: ${describeError(err)}`
      )
      return false
    }
  }

  /**
   * Routes one message to its handlers.
   *
   * Every failure path here completes normally so the offset advances — see the
   * partition-wedging note in this class's docblock.
   */
  private async dispatch(
    topic: string,
    partition: number,
    offset: string,
    value: Buffer | null
  ): Promise<void> {
    // NOTE: reaching here already means kafkajs decoded the batch. A
    // compression/decode failure never gets this far — see the ⚠️ section in
    // this class's docblock.
    const envelope = parseEnvelope(value)

    if (!envelope) {
      // Unparseable. Counted as skipped, not failed: nothing was wrong with
      // THIS consumer, and there is no schema registry to have caught it
      // upstream. Retrying could never succeed.
      this.counters.skipped += 1
      // eslint-disable-next-line no-console
      console.warn(
        `${this.options.logPrefix} Discarded unparseable message at ${topic}[${partition}]@${offset}`
      )
      return
    }

    const handlers = this.handlers.get(envelope.eventType)
    if (!handlers || handlers.length === 0) {
      // Not an error: a consumer subscribes to whole topics and will see event
      // types it does not care about. ms-inventory reads order.created and
      // order.cancelled from a topic that also carries order.confirmed.
      this.counters.skipped += 1
      return
    }

    const context: EventContext = { topic, partition, offset }

    for (const handler of handlers) {
      try {
        await handler(envelope, context)
        this.counters.consumed += 1
        this.counters.lastConsumedAt = new Date().toISOString()
      } catch (err) {
        this.counters.failed += 1
        this.counters.lastFailureAt = new Date().toISOString()
        this.counters.lastFailureReason = describeError(err)
        // eslint-disable-next-line no-console
        console.error(
          `${this.options.logPrefix} Handler for ${envelope.eventType} (eventId=${envelope.eventId}) threw: ${describeError(err)}`
        )
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    this.running = false
    if (!this.consumer) {
      return
    }
    try {
      await this.consumer.disconnect()
    } catch {
      /* already down */
    }
  }
}
