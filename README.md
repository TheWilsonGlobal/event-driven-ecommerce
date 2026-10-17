# Event-Driven E-Commerce Platform

An event-driven microservices e-commerce platform: TypeScript, Node.js (Fastify 4), Next.js 14, Kafka/Redpanda, BullMQ and
one Supabase Postgres (a schema per service). Events travel through a transactional outbox; users sign in with Supabase Auth.

## Services

| Package | Port | Role |
|---|---|---|
| `packages/gateway` | 5460 | API gateway: proxy, rate limiting, CORS, trace headers |
| `packages/admin` | 5461 | Admin portal (React + Vite) |
| `packages/client` | 5462 | Storefront (Next.js 14) |
| `packages/ms-user` | 5463 | Profiles, roles, audit log on Supabase Auth |
| `packages/ms-product` | 5464 | Catalogue, search, storage, product cache |
| `packages/ms-order` | 5465 | Checkout, payments saga, BullMQ queues, outbox |
| `packages/ms-inventory` | 5466 | Stock reservation, Kafka consumer, outbox |
| `packages/ms-analytics` | 5467 | Aggregates, sales rankings, Kafka consumer |
| `packages/shared/*` | | types, constants, utils, database, messaging, security |
| `packages/tests` | | load and stress harness |

## Quick start

Prerequisites: Node.js 18+, pnpm 10+, Docker, a Supabase project, and Redis (Kafka, Elasticsearch and the rest are optional).

```bash
cp .env.example .env     # fill in SUPABASE_*, SERVICE_AUTH_SECRET; .env is gitignored
pnpm install
pnpm run db:generate
pnpm run dev             # gateway, services, storefront and admin
```

Swagger UI: http://localhost:5460/api-docs. More commands, Docker and the full script list: [Getting started](docs/getting-started.md).

## Security at a glance

Input validation, Redis rate limiting, Supabase Auth (tokens verified offline), and role-based access (ADMIN, VENDOR, CUSTOMER).
`AUTH_ENFORCE` and `RATE_LIMIT_ENFORCE` default to `report` (log, do not block). Details: [Security](docs/security.md).

## Documentation

| Topic | File |
|---|---|
| Setup, scripts, Docker, adding a service | [docs/getting-started.md](docs/getting-started.md) |
| Database, outbox, idempotency, migrations | [docs/database.md](docs/database.md) |
| Security and rollout switches | [docs/security.md](docs/security.md) |
| Task queues (BullMQ) | [docs/task-queues.md](docs/task-queues.md) |
| Events (Kafka / Redpanda) | [docs/events-kafka.md](docs/events-kafka.md) |
| Ports, search, caches, metrics, logs | [docs/infrastructure.md](docs/infrastructure.md) |
| Deployment, CI/CD, Kubernetes | [docs/deployment.md](docs/deployment.md) |
| Testing and stress tests | [docs/testing.md](docs/testing.md) |

Architecture notes, diagrams and the API-defense plans are in the notes repository (`.notes/JOBs/fse/event-driven-ecommerce/`).

## License

MIT, see the LICENSE file.

## Contributing

Please read the contributing guidelines before opening a pull request.
