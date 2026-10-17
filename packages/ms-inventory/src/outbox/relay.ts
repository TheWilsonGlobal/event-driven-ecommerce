import {
  KafkaUnavailableError,
  OutboxRelay,
  loadOutboxEnv,
  type EventProducer,
} from '@ecommerce/shared-messaging'
import type { InventoryStore } from '../db/store'
import { LOG_PREFIX } from '../events/producer'

/**
 * Builds ms-inventory's OutboxRelay: drains ms_inventory.outbox_events to Kafka.
 *
 * ── Why these four callbacks ────────────────────────────────────────────────
 *   db           the service POOL (autocommit), never a transaction client: the
 *                claim is one self-contained statement and must not hold a
 *                connection open while Kafka is called.
 *   publish      `publishEnvelope` re-sends the STORED envelope, so every retry
 *                carries the eventId minted inside the business transaction.
 *                It throws on failure (unlike `tryPublish`), which is what lets
 *                the relay back off and retry instead of marking the row sent.
 *   isEnabled    with KAFKA_ENABLED unset the relay idles and rows wait in
 *                `pending` -- visible on GET /api/v1/outbox -- rather than being
 *                marked sent to a broker that was never contacted.
 *   isBrokerDown a broker outage is not any single row's fault, so the relay
 *                hands back the attempt it consumed; otherwise a long outage
 *                would dead-letter healthy events.
 *
 * Config comes from the OUTBOX_* env vars (loadOutboxEnv). The relay validates
 * at construction that the lease outlasts the send timeout and throws if not.
 */
export function createInventoryOutboxRelay(
  store: InventoryStore,
  eventProducer: EventProducer
): OutboxRelay {
  const env = loadOutboxEnv()
  return new OutboxRelay({
    db: store.db,
    schema: store.schema,
    publish: async (row) => {
      await eventProducer.publishEnvelope(row.topic, row.partitionKey, row.envelope)
    },
    isEnabled: () => eventProducer.enabled,
    isBrokerDown: (err) => err instanceof KafkaUnavailableError,
    logPrefix: LOG_PREFIX,
    pollMs: env.pollMs,
    batch: env.batch,
    leaseMs: env.leaseMs,
    sendTimeoutMs: env.sendTimeoutMs,
  })
}
