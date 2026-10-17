# Task queues

BullMQ over Redis in ms-order. [← Back to the README](../README.md)

## Task queues (BullMQ + Redis)

`ms-order` runs four BullMQ queues over Redis. Start Redis first —
`docker compose up -d redis` — otherwise the service still boots and serves
orders, but the queue endpoints return `503`.

| Queue | Concurrency | Attempts | Backoff | Triggered by |
|---|---|---|---|---|
| `order-expiration` | 10 | 3 | exponential 5s | An order created with `paymentPreCaptured: false` (status `PENDING`) |
| `payment-retry` | 5 | 5 | exponential 10s | A failed capture at `POST /api/v1/payments/:orderId/capture` |
| `notification-dispatch` | 10 | 4 | fixed 3s | An order reaching `CONFIRMED` |
| `saga-compensation` | 5 | 5 | exponential 8s | Exhausted payment retries, or `POST /api/v1/orders/:id/saga-failure` |

Introspection endpoints (ms-order, port 5465):

- `GET /api/v1/queues` — live job counts and recent jobs per queue.
- `GET /api/v1/cache/namespaces` — real Redis key counts per prefix, via `SCAN`.

Both return `503` with a machine-readable `reason` when Redis is unreachable,
never an empty `200` — "no data" and "no connection" must stay distinguishable.

Outbound side effects (SMTP, PDF render, Stripe/PayPal capture and refund) are
simulated — this repo has no payment or email credentials. Queue mechanics,
retries, state transitions and all database writes are real. See the
`SIMULATED:` comments in `packages/ms-order/src/queues/workers.ts`.
