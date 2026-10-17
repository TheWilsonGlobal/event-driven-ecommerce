# Events (Kafka / Redpanda)

The event backbone above BullMQ. [← Back to the README](../README.md)

## Events (Kafka / Redpanda)

An event backbone sits **above** BullMQ, not instead of it. The split is the
whole design:

- **Kafka carries facts.** `order.created` states that something already
  happened and is already committed. It has many independent readers, each
  holding its own position in the log. Adding a consumer changes nothing for
  the existing ones.
- **BullMQ carries work.** "retry this capture in 10s with exponential backoff"
  is a task with one owner, a delay, an attempt counter and a terminal failure
  state — none of which Kafka provides natively.

So `ms-order` publishes a fact, and each consumer decides for itself what work
that fact implies, enqueueing into its **own** queues. The four existing queues
are unchanged.

```
Order API ──▶ Kafka ──┬──▶ Payment (ms-order)
                      ├──▶ Inventory (ms-inventory)
                      └──▶ Analytics (ms-analytics)

Payment ──▶ BullMQ ──┬──▶ Retry
                     ├──▶ Email
                     └──▶ Invoice
```

The broker lives in the **hub** repo (`C:\Git\APPs\hub`), like every other backing service:

```bash
cd ../../hub && docker compose --profile kafka up -d
```

Redpanda rather than Kafka + ZooKeeper: same wire protocol (kafkajs is
unmodified), one container, no JVM. Console at <http://localhost:9102>.

Host ports are **9100** (Kafka wire protocol), **9101** (admin API, used for
consumer lag) and **9102** (console) — re-ported 2026-09-23 from
`9092`/`9644`/`5469` so all three sit in one contiguous block in the `9xxx`
infrastructure range. The console was previously at `5469`, inside this repo's
own `546x` *application* block, which read as if this repo owned it; the
broker is infra-hub's. `8080`/`8090` were never options — both belong to other
projects on this machine.

### Off by default

`KAFKA_ENABLED=false` is the repo default. In that state **no Kafka client is
constructed and no socket is opened**, exactly as `KV_CACHE_DRIVER=rocksdb`
makes ms-order skip BullMQ. `GET /api/v1/events` then returns `200` with
`enabled: false` — a healthy configured state, not an error. Set
`KAFKA_ENABLED=true` to turn it on.

| Topic | Key | Events |
|---|---|---|
| `ecommerce.orders.v1` | `orderId` | `order.created`, `order.confirmed`, `order.cancelled` |
| `ecommerce.payments.v1` | `orderId` | `payment.captured`, `payment.failed`, `payment.refunded` |
| `ecommerce.inventory.v1` | `productId` | `inventory.reserved`, `inventory.released`, `inventory.insufficient` |

The partition key is load-bearing, not a detail. Keying order and payment
events on `orderId` is what guarantees a consumer sees `order.created` before
the `order.cancelled` that follows it — otherwise inventory could release a
reservation it had not yet made.

**One consumer group per service**, never shared (`ms-inventory-group`,
`ms-analytics-group`). Two services sharing a group id would silently split the
partitions and each would see roughly half the events — a bug that looks like
random data loss.

### Introspection

`GET /api/v1/events` on ms-order, ms-inventory and ms-analytics reports topics,
per-topic counters and consumer-group state/lag. Three distinct outcomes:

| Outcome | Meaning |
|---|---|
| `200` + `enabled:false` | Kafka switched off — the default, and healthy |
| `200` + `enabled:true` | Serviceable; live counters and lag |
| `503` + `reason` | Enabled but the broker is unreachable |

Never an empty `200` for the third case — zeros are indistinguishable from a
healthy idle backbone. `GET /health` carries an `events` block read from a ~10s
cache, so a liveness probe never blocks on an unreachable broker (the same
lesson `ms-product` learned from Elasticsearch).

`lag` and `partitions` are **nullable**. `null` means "could not measure";
`0` means "measured, and caught up". They are typed `['number','null']` in the
JSON schema on purpose — under a plain `{ type: 'number' }` Fastify's
serializer coerces `null` to `0`, which would render an unknown as the most
reassuring possible answer.

### Known limitations — stated, not hidden

1. **Delivery is at-least-once.** ms-order and ms-inventory stage every event in a
   transactional outbox (see "Reliability patterns") and a relay publishes it, so
   a crash or a broker outage no longer loses events. Consumers dedupe on
   `eventId`. Events from any publisher outside the outbox are still
   fire-and-forget; `publishFailures` on `/api/v1/events` reports those.
2. **No schema registry.** Envelope versioning is by convention and topic name.
3. **A failing consumer handler does not retry.** The error is caught, counted
   and the offset advances — otherwise one bad message would wedge the
   partition forever. A consumer that must not drop work enqueues a BullMQ job
   as its first action and does the real work there, where retries actually
   exist.
4. **Counters are process-lifetime.** `published`/`consumed` reset on restart.
   The payload says so via `countersAreProcessLifetime`.
5. **Single broker, `replication.factor=1`.** Correct for local development,
   not a production topology.
6. **Payloads are validated, not versioned.** Consumers check each event against the schemas in
   `packages/shared/messaging/src/kafka/payloadSchemas.ts`; malformed events are recorded as rejected and never retried.

---
