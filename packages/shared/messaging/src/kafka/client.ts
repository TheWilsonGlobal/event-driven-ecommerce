import { Kafka, logLevel as KafkaLogLevel, CompressionTypes, CompressionCodecs } from 'kafkajs'
import type { KafkaConfig } from 'kafkajs'
import { describeError } from '../describeError'

/**
 * Snappy codec registration — do NOT remove.
 *
 * kafkajs ships GZIP support only. Anything else is a pluggable codec, and
 * without one a consumer that meets a Snappy-compressed batch dies with
 * `KafkaJSNotImplemented: Snappy compression not implemented`.
 *
 * ⚠️ That failure is REPORTED AS A CRASH INSIDE THE CONSUMER LOOP, not as a
 * message-level error, so the consumer stays `running: true` while consuming
 * nothing. Observed 2026-09-23 against Redpanda v24.2.7: both new services
 * reported `running=true, state=Empty, lag=3, consumed=0`. The symptom is
 * indistinguishable from "no traffic" unless you look at lag — which is
 * precisely why lag is measured and surfaced rather than assumed.
 *
 * The specific trigger, traced to its source: a message produced with
 * `rpk topic produce`, which defaults to Snappy. Our own kafkajs producer does
 * not set compression and so sends uncompressed — this was NOT the broker
 * re-compressing on its own. But that is exactly why the codec is needed:
 * Redpanda's `log_compression_type=producer` means each batch's compression is
 * chosen by WHOEVER PRODUCED IT, so a CLI, a console, or any future
 * non-kafkajs producer can put a Snappy batch on a topic at any time. A
 * consumer must be able to read the topic regardless of who wrote to it.
 *
 * ⚠️ One such message permanently wedges every kafkajs consumer on that
 * partition — the offset is never committed, so it is redelivered forever and
 * nothing behind it is ever read. Recovery without this codec means seeking a
 * group past the message (`rpk group seek <group> --to <ts>`), which is
 * per-group and leaves the topic still poisoned for anyone else.
 *
 * Registration is global to kafkajs and done HERE, once, rather than in each
 * service, so no consumer can be added later that forgets it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SnappyCodec = require('kafkajs-snappy')
CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec

/**
 * Kafka client construction for the event backbone.
 *
 * Design constraints this module exists to satisfy — deliberately the SAME
 * four that redisConnection.ts states for BullMQ, because the operational rule
 * is identical and a reader who knows one should recognise the other:
 *
 *  1. A service MUST boot and serve its API when Kafka is down. Nothing here
 *     connects at construction time; failures surface as a 503 from the event
 *     endpoints instead.
 *  2. kafkajs logs broker failures through its own logger, not as unhandled
 *     'error' events — but the same lesson applies: an unhandled failure path
 *     kills the process. Every client gets a logCreator wired to console, and
 *     `retry.restartOnFailure` returning true so the consumer never gives up
 *     permanently.
 *  3. A down broker must fail FAST, not hang. connectionTimeout and
 *     requestTimeout are both bounded, so a readiness check cannot block a
 *     liveness probe.
 *  4. The service must SELF-HEAL when Kafka comes back, without a restart.
 *     Retries back off to a ceiling and never permanently stop.
 *
 * ── Why no client is built when disabled ────────────────────────────────────
 * KAFKA_ENABLED=false is this repo's DEFAULT. In that state we construct no
 * client at all, exactly as QueueManager constructs no Redis connection when
 * KV_CACHE_DRIVER is not redis. Building one anyway would open sockets that
 * retry forever against a broker that is deliberately not running.
 */

export interface KafkaSettings {
  enabled: boolean
  /** Seed broker list. Metadata may redirect to other addresses — see compose. */
  brokers: string[]
  /** Identifies this process in the broker's logs and in `rpk group describe`. */
  clientId: string
}

/** Ceiling on the reconnect backoff. Never gives up — see constraint 4. */
const MAX_RETRY_TIME_MS = 30_000
const INITIAL_RETRY_TIME_MS = 300
const CONNECTION_TIMEOUT_MS = 3000
const REQUEST_TIMEOUT_MS = 5000

/**
 * Reads Kafka settings from the environment.
 *
 * Defaults to DISABLED. A developer who has not started the broker gets a repo
 * that boots and works, with the event endpoints honestly reporting
 * `enabled: false` — not a wall of connection errors.
 */
export function loadKafkaSettings(clientId: string): KafkaSettings {
  const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9100')
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b.length > 0)

  return {
    enabled: process.env.KAFKA_ENABLED === 'true',
    brokers,
    clientId: process.env.KAFKA_CLIENT_ID ?? clientId,
  }
}

/**
 * Builds a Kafka client. Never connects, never throws.
 *
 * `logPrefix` is prepended to warnings, e.g. `[Order Service]` — pass the same
 * bracketed style the service uses elsewhere so one grep catches everything.
 */
export function createKafkaClient(settings: KafkaSettings, logPrefix: string): Kafka {
  const seenErrorMessages = new Set<string>()

  const config: KafkaConfig = {
    clientId: settings.clientId,
    brokers: settings.brokers,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    retry: {
      initialRetryTime: INITIAL_RETRY_TIME_MS,
      maxRetryTime: MAX_RETRY_TIME_MS,
      retries: Number.MAX_SAFE_INTEGER,
      // Without this a consumer that exhausts its retries stops for good, and
      // the service needs a restart to recover from a broker blip. Needing a
      // restart to survive an outage is worse than a noisy log — the same
      // conclusion redisConnection.ts reached about its retryStrategy.
      restartOnFailure: async () => true,
    },
    logLevel: KafkaLogLevel.ERROR,
    // Connection-refused spam while the broker is down is expected and already
    // reflected in the endpoints' 503. Log once per distinct message rather
    // than on every retry tick.
    logCreator: () => {
      return ({ level, log }) => {
        if (level > KafkaLogLevel.ERROR) {
          return
        }
        const message = typeof log['message'] === 'string' ? log['message'] : describeError(log)
        if (seenErrorMessages.has(message)) {
          return
        }
        seenErrorMessages.add(message)
        // eslint-disable-next-line no-console
        console.warn(`${logPrefix} Kafka: ${message}`)
      }
    },
  }

  return new Kafka(config)
}
