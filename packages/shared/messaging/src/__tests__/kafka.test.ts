import { makeEnvelope, parseEnvelope } from '../kafka/envelope'
import { toKafkaUnavailable, KafkaUnavailableError } from '../kafka/errors'
import { EventProducer } from '../kafka/producer'
import { EventConsumer } from '../kafka/consumer'
import { buildEventData } from '../kafka/introspection'
import { checkKafkaHealth, resetKafkaHealthCache } from '../kafka/health'
import { CONSUMER_GROUPS, EVENT_TYPES, TOPICS, TOPIC_DEFINITIONS } from '../kafka/topics'

/**
 * Regression tests for the Kafka half of shared-messaging.
 *
 * These concentrate on the behaviours that were actually WRONG during
 * implementation (2026-09-23) and on the invariants the rest of the codebase
 * depends on — not on re-testing kafkajs. Nothing here needs a broker: every
 * test runs with Kafka disabled or against a stub, so the suite stays runnable
 * in CI with no infrastructure.
 */

const DISABLED = { enabled: false, brokers: ['localhost:9100'], clientId: 'test' }

describe('envelope', () => {
  it('defaults correlationId to the eventId when no request context exists', () => {
    const env = makeEnvelope({
      eventType: EVENT_TYPES.orderCreated,
      producer: 'ms-order',
      payload: { orderId: 'o1' },
    })
    expect(env.correlationId).toBe(env.eventId)
    expect(env.eventVersion).toBe(1)
  })

  it('round-trips through JSON', () => {
    const env = makeEnvelope({
      eventType: EVENT_TYPES.orderCreated,
      producer: 'ms-order',
      payload: { orderId: 'o1' },
      correlationId: 'req-7',
    })
    const parsed = parseEnvelope(Buffer.from(JSON.stringify(env)))
    expect(parsed).toEqual(env)
  })

  // A single malformed message must never be able to throw inside the consume
  // loop: kafkajs would not commit the offset, redeliver forever, and wedge
  // every later message on that partition.
  it.each([
    ['not json at all', Buffer.from('<<<not json>>>')],
    ['json but not an object', Buffer.from('42')],
    ['object missing required fields', Buffer.from(JSON.stringify({ foo: 'bar' }))],
    ['null value (tombstone)', null],
  ])('returns null rather than throwing for %s', (_label, value) => {
    expect(() => parseEnvelope(value)).not.toThrow()
    expect(parseEnvelope(value)).toBeNull()
  })
})

describe('error classification', () => {
  it.each([
    ['connect ECONNREFUSED 127.0.0.1:9100', 'kafka_connection_refused'],
    ['Connection timeout', 'kafka_timeout'],
    ['getaddrinfo ENOTFOUND broker', 'kafka_dns_failure'],
    ['There is no leader for this topic-partition', 'kafka_broker_unavailable'],
    ['SASL Authentication failed', 'kafka_auth_failure'],
    ['something entirely unexpected', 'kafka_error'],
  ])('maps %s to %s', (message, expected) => {
    expect(toKafkaUnavailable(new Error(message)).reason).toBe(expected)
  })

  it('passes an existing KafkaUnavailableError through unchanged', () => {
    const original = new KafkaUnavailableError('kafka_timeout', 'already classified')
    expect(toKafkaUnavailable(original)).toBe(original)
  })
})

describe('topic definitions', () => {
  // The partition key is load-bearing: keying payment events on paymentId
  // instead of orderId would let a cancellation be consumed before the
  // creation it cancels. Pinned so a future edit has to be deliberate.
  it('keys order AND payment topics on orderId, not paymentId', () => {
    const orders = TOPIC_DEFINITIONS.find((d) => d.name === TOPICS.orders)
    const payments = TOPIC_DEFINITIONS.find((d) => d.name === TOPICS.payments)
    expect(orders?.partitionKey).toBe('orderId')
    expect(payments?.partitionKey).toBe('orderId')
  })

  it('gives every service a DISTINCT consumer group', () => {
    const ids = Object.values(CONSUMER_GROUPS)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('EventProducer when Kafka is disabled', () => {
  it('constructs nothing and never throws', () => {
    const producer = new EventProducer('ms-test', '[test]', DISABLED)
    expect(producer.enabled).toBe(false)
    expect(producer.isConnected).toBe(false)
  })

  // Disabled is a configured state, not a fault: tryPublish must return null
  // silently rather than logging an error on every request.
  it('tryPublish returns null without attempting a connection', async () => {
    const producer = new EventProducer('ms-test', '[test]', DISABLED)
    const result = await producer.tryPublish({
      topic: TOPICS.orders,
      eventType: EVENT_TYPES.orderCreated,
      key: 'o1',
      payload: { orderId: 'o1' },
    })
    expect(result).toBeNull()
    expect(producer.countersFor(TOPICS.orders).publishFailures).toBe(0)
  })

  it('close() is safe when nothing was ever constructed', async () => {
    const producer = new EventProducer('ms-test', '[test]', DISABLED)
    await expect(producer.close()).resolves.toBeUndefined()
  })
})

describe('EventConsumer when Kafka is disabled', () => {
  it('start() reports false rather than throwing, so the service still boots', async () => {
    const consumer = new EventConsumer(
      {
        groupId: CONSUMER_GROUPS.analytics,
        topics: [TOPICS.orders],
        fromBeginning: true,
        logPrefix: '[test]',
        clientId: 'test',
      },
      DISABLED
    )
    await expect(consumer.start()).resolves.toBe(false)
    expect(consumer.isRunning).toBe(false)
    await expect(consumer.close()).resolves.toBeUndefined()
  })
})

describe('buildEventData', () => {
  it('reports partitions and lag as null — never 0 — when nothing can be measured', async () => {
    const producer = new EventProducer('ms-test', '[test]', DISABLED)
    const data = await buildEventData({ producer })

    expect(data.enabled).toBe(false)
    expect(data.topics).toHaveLength(TOPIC_DEFINITIONS.length)
    for (const topic of data.topics) {
      // null means "unknown". 0 would mean "measured, and it is zero" — the
      // distinction this whole module exists to preserve.
      expect(topic.partitions).toBeNull()
      expect(topic.published).toBe(0)
    }
    expect(data.countersAreProcessLifetime).toBe(true)
  })

  it('surfaces a consumer local counters even with no broker to measure lag against', async () => {
    const producer = new EventProducer('ms-test', '[test]', DISABLED)
    const consumer = new EventConsumer(
      {
        groupId: CONSUMER_GROUPS.inventory,
        topics: [TOPICS.orders],
        fromBeginning: false,
        logPrefix: '[test]',
        clientId: 'test',
      },
      DISABLED
    )
    const data = await buildEventData({ producer, consumers: [consumer] })
    expect(data.consumers).toHaveLength(1)
    expect(data.consumers[0]?.groupId).toBe(CONSUMER_GROUPS.inventory)
    // Unmeasurable, so null — not a reassuring zero.
    expect(data.consumers[0]?.lag).toBeNull()
    expect(data.consumers[0]?.state).toBeNull()
  })
})

describe('checkKafkaHealth', () => {
  beforeEach(() => {
    resetKafkaHealthCache()
  })

  it('reports kafka_disabled without constructing a client', async () => {
    const health = await checkKafkaHealth(undefined, ['localhost:9100'], false)
    expect(health).toEqual({
      enabled: false,
      reachable: false,
      brokers: ['localhost:9100'],
      reason: 'kafka_disabled',
      cachedAgeMs: 0,
    })
  })

  /**
   * The bug this pins: the shared client sets retries to MAX_SAFE_INTEGER so
   * CONSUMERS self-heal, which made admin.connect() against a dead broker
   * retry forever and never reject. /health did not answer in 90s. The probe
   * is now raced against a 3s deadline.
   *
   * Stubbed rather than pointed at a real dead port, so the test is fast and
   * does not depend on the network.
   */
  it('bounds a probe that never settles, instead of hanging', async () => {
    const neverSettles = {
      admin: () => ({
        connect: () => new Promise<void>(() => undefined),
        listTopics: () => new Promise<string[]>(() => undefined),
        disconnect: async () => undefined,
      }),
    }

    const started = Date.now()
    const health = await checkKafkaHealth(neverSettles as never, ['localhost:9099'], true)
    const elapsed = Date.now() - started

    expect(health.enabled).toBe(true)
    expect(health.reachable).toBe(false)
    expect(health.reason).toBe('kafka_timeout')
    // Generous upper bound: the point is that it RETURNS, well before the 90s
    // it used to take.
    expect(elapsed).toBeLessThan(10_000)
  }, 15_000)
})
