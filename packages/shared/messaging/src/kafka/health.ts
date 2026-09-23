import type { Kafka } from 'kafkajs'
import { KafkaUnavailableError, toKafkaUnavailable } from './errors'
import { describeError } from '../describeError'

/**
 * Cached broker reachability for /health.
 *
 * ── Why the cache exists ────────────────────────────────────────────────────
 * ms-product learned this the hard way with Elasticsearch: an UNCACHED health
 * probe took ~2.5s during an outage, because the check itself has to wait out
 * the connection timeout. A liveness probe that blocks for 2.5s is worse than
 * useless — it makes a degraded-but-serving service look dead to whatever is
 * probing it. That endpoint now answers in ~3ms from a 10s cache and reports
 * the reading's age. Kafka gets identical treatment and the same TTL.
 *
 * The staleness is reported (`cachedAgeMs`) rather than hidden, so a caller can
 * tell a fresh reading from a 9-second-old one instead of assuming.
 */

const CACHE_TTL_MS = 10_000

/**
 * Hard deadline for a single probe.
 *
 * ⚠️ This is NOT redundant with the client's connectionTimeout. The shared
 * client is configured with `retries: Number.MAX_SAFE_INTEGER` and
 * `restartOnFailure: () => true` so CONSUMERS self-heal after a broker blip
 * without a restart (see client.ts). That is right for a consumer and wrong
 * for a health probe: `admin.connect()` against a dead broker then retries
 * forever and never rejects, so the probe never settles, the cache is never
 * populated, and every /health request hangs.
 *
 * Measured before this guard existed: /health did not answer in 90s with the
 * broker down. A liveness probe that hangs is worse than one that reports a
 * failure — it makes a degraded-but-serving service look dead. The race below
 * bounds the probe independently of the client's retry policy.
 */
const PROBE_TIMEOUT_MS = 3000

/**
 * Runs an admin-API call under the same hard deadline `probe` uses.
 *
 * Exported because EVERY admin call has the unbounded-retry hazard described
 * at PROBE_TIMEOUT_MS, not just the health probe: introspection's metadata and
 * lag walks, and the events route's cold-start reachability check, would each
 * hang forever against a dead broker without this. Returns `null` on timeout
 * or failure, so a caller degrades to "unknown" (null) rather than blocking or
 * inventing a zero.
 */
export async function withKafkaAdminDeadline<T>(
  fn: () => Promise<T>,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([fn(), deadline])
  } catch {
    return null
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export interface KafkaHealth {
  enabled: boolean
  reachable: boolean
  brokers: string[]
  /** null when reachable, or the machine-readable reason when not. */
  reason: string | null
  /** Age of this reading in ms. 0 means it was just measured. */
  cachedAgeMs: number
}

interface CachedReading {
  reachable: boolean
  reason: string | null
  measuredAt: number
}

let cached: CachedReading | null = null
let inFlight: Promise<CachedReading> | null = null

/** Test seam — clears the cache so a test can force a fresh probe. */
export function resetKafkaHealthCache(): void {
  cached = null
  inFlight = null
}

async function probe(kafka: Kafka): Promise<CachedReading> {
  const admin = kafka.admin()

  // Raced against the deadline rather than awaited directly -- see
  // PROBE_TIMEOUT_MS. A never-settling connect must not be able to hold a
  // /health request open.
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new KafkaUnavailableError('kafka_timeout', `Kafka probe exceeded ${PROBE_TIMEOUT_MS}ms`)
        ),
      PROBE_TIMEOUT_MS
    )
    // Do not let the timer keep the process alive on shutdown.
    timer.unref?.()
  })

  try {
    await Promise.race([
      (async () => {
        await admin.connect()
        await admin.listTopics()
      })(),
      deadline,
    ])
    return { reachable: true, reason: null, measuredAt: Date.now() }
  } catch (err) {
    return {
      reachable: false,
      reason: toKafkaUnavailable(err).reason,
      measuredAt: Date.now(),
    }
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    // Deliberately NOT awaited: with the broker down, disconnect() can itself
    // block behind the same stuck connection attempt this function just timed
    // out on, reintroducing the hang one line later.
    void admin.disconnect().catch(() => {
      /* nothing to unwind */
    })
  }
}

/**
 * Reports broker reachability, from a ~10s cache.
 *
 * Never throws. When Kafka is disabled it returns immediately without
 * constructing anything — `enabled: false, reachable: false` is a healthy
 * configured state, and the caller must not render it as an outage.
 */
export async function checkKafkaHealth(
  kafka: Kafka | undefined,
  brokers: string[],
  enabled: boolean
): Promise<KafkaHealth> {
  if (!enabled || !kafka) {
    return {
      enabled: false,
      reachable: false,
      brokers,
      reason: 'kafka_disabled',
      cachedAgeMs: 0,
    }
  }

  const now = Date.now()
  if (cached && now - cached.measuredAt < CACHE_TTL_MS) {
    return {
      enabled: true,
      reachable: cached.reachable,
      brokers,
      reason: cached.reason,
      cachedAgeMs: now - cached.measuredAt,
    }
  }

  // Collapse concurrent probes: several /health hits can land inside one
  // timeout window, and each would otherwise open its own admin connection to
  // a broker that is already struggling.
  if (!inFlight) {
    inFlight = probe(kafka).finally(() => {
      inFlight = null
    })
  }

  try {
    cached = await inFlight
  } catch (err) {
    // probe() catches its own errors, so this is belt-and-braces only.
    cached = {
      reachable: false,
      reason: toKafkaUnavailable(err).reason,
      measuredAt: Date.now(),
    }
  }

  return {
    enabled: true,
    reachable: cached.reachable,
    brokers,
    reason: cached.reason,
    cachedAgeMs: 0,
  }
}

/**
 * Readiness gate for the event routes — returns null when serviceable, or a
 * KafkaUnavailableError the caller turns into a 503.
 *
 * Disabled is NOT an error: it returns a KafkaUnavailableError with reason
 * `kafka_disabled` that the route renders as a 200 with `enabled: false`. Only
 * the route knows which it wants, so this just classifies.
 */
export function classifyKafkaState(
  enabled: boolean,
  connected: boolean,
  lastError: KafkaUnavailableError | null
): KafkaUnavailableError | null {
  if (!enabled) {
    return new KafkaUnavailableError(
      'kafka_disabled',
      'Kafka is disabled (KAFKA_ENABLED is not "true")'
    )
  }
  if (connected) {
    return null
  }
  if (lastError) {
    return lastError
  }
  // Not yet connected and nothing has failed — a cold producer that has not
  // published. Not an error; the first publish will connect.
  return null
}

export { describeError }
