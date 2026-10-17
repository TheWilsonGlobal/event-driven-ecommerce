# Database and reliability patterns

One Supabase Postgres, a schema per service, the transactional outbox and migrations. [← Back to the README](../README.md)

## One Supabase Postgres, one schema per service

All application data lives in a single Supabase Postgres database. Each service owns
one schema and never reads another's; cross-service data travels as Kafka events.

| Service | Schema | Access |
|---|---|---|
| ms-user | `ms_user` | Prisma |
| ms-order | `ms_order` | Prisma (+ `outbox_events`, drained with raw SQL) |
| ms-product | `ms_product` | `pg`, jsonb documents |
| ms-inventory | `ms_inventory` | `pg`, typed tables, SQL migrations at boot |
| ms-analytics | `ms_analytics` | `pg`, typed tables, SQL migrations at boot |

Configure it in the repo-root `.env` (see `.env.example`, "Supabase" section):
`DB_MODE=supabase`, `<SERVICE>_DATABASE_URL` (runtime) and `<SERVICE>_DIRECT_URL` (migrations).
A password containing `@ # % ^ $` must be percent-encoded inside those URLs. The Supabase
secret key is server-only and never belongs in the `client` or `admin` env.
Every table has row level security enabled with no policies.

```bash
pnpm --filter @ecommerce/ms-user run migrate     # Prisma, reads the repo-root .env
pnpm --filter @ecommerce/ms-order run migrate
```

### Reliability patterns

1. **Transactional outbox.** ms-order and ms-inventory write each Kafka event as a row in
   `outbox_events` in the *same transaction* as the state change. An `OutboxRelay` drains the
   table to Kafka, so a crash between commit and publish can no longer lose an event.
   `GET /api/v1/outbox` shows rows by status; `POST /api/v1/outbox/requeue` revives dead rows.
   With Kafka disabled, events wait in the table instead of being dropped.
2. **Idempotency.** The `eventId` is minted once, at insert, and is identical on every retry.
   Consumers claim it in a `processed_events` table *inside the same transaction* as their
   effect. `POST /api/v1/orders` accepts an `Idempotency-Key` header: a repeat returns the
   original order (200), the same key with a different order is a 409.
3. **`FOR UPDATE SKIP LOCKED` + lease.** Relays claim rows with a database-clock lease, so
   several relays never collide, a dead worker's rows are reclaimed, and a stale worker cannot
   overwrite the new owner. A row is only claimable when no earlier row for the same order is
   still in flight, which keeps per-order event ordering.

Delivery into Kafka is **at-least-once**; consumers dedupe on `eventId`.


### Database Migrations (Prisma)
```bash
# Generate Prisma Client after schema changes
pnpm --filter @ecommerce/ms-user run prisma:generate
pnpm --filter @ecommerce/ms-order run prisma:generate

# Create and apply new migration in development
pnpm --filter @ecommerce/ms-user run migrate:dev --name add_user_avatar
pnpm --filter @ecommerce/ms-order run migrate:dev --name add_payment_metadata

# Deploy migrations in production / CI
pnpm run db:migrate
```
