# Microservices E-Commerce Platform

A scalable, production-ready microservices e-commerce platform built with Node.js, TypeScript, and React.

## 🏗️ Architecture

This monorepo contains the following services:

### Backend Services (Fastify 4)
- **API Gateway** (`packages/gateway` · Port 5460) - Reverse proxy, JWT verification, rate limiting
- **User Service** (`packages/ms-user` · Port 5463) - Authentication, authorization, and user management
- **Product Service** (`packages/ms-product` · Port 5464) - Product catalog, Elasticsearch search, and inventory
- **Order Service** (`packages/ms-order` · Port 5465) - Order checkout saga, BullMQ delayed queues, and Stripe/PayPal

### Shared Libraries
- **Types** (`packages/shared/types`) - Common TypeScript type definitions & DTOs
- **Utils** (`packages/shared/utils`) - Shared utility functions & response wrappers
- **Database** (`packages/shared/database`) - Prisma ORM, Mongoose & Redis clients
- **Messaging** (`packages/shared/messaging`) - BullMQ queues & workers over Redis 7

### Frontend & Control Plane
- **Web Client** (`packages/client` · Port 5462) - Next.js 14 SSR React customer application
- **Admin Portal** (`packages/admin` · Port 5461) - React + Vite centralized service & config cockpit

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- pnpm 10+ (`corepack enable` or `npm install -g pnpm`)
- Docker & Docker Compose
- PostgreSQL 15
- Redis 7
- MongoDB 7
- Elasticsearch 8.11

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/microservices-ecommerce.git
cd microservices-ecommerce
```

2. Copy environment variables:
```bash
cp .env.example .env
# Update .env with your configuration
```

3. Install dependencies and generate Prisma clients:
```bash
pnpm install
pnpm run db:generate
```

4. Start development servers:
```bash
pnpm run dev
```

## 📦 Available Scripts

### Root Level Scripts
- `pnpm run dev` - Start all services concurrently in development mode (Gateway, Services, Client, Admin)
- `pnpm run build` - Build all workspace packages
- `pnpm run db:generate` - Generate Prisma clients across all microservices
- `pnpm run db:migrate` - Deploy database migrations across PostgreSQL services
- `pnpm run test` - Run all tests across workspace
- `pnpm run lint` - Lint all packages
- `pnpm run docker:up` - Start container services with Docker Compose
- `pnpm run docker:down` - Stop Docker Compose services

### Service-Specific Scripts
- `pnpm run dev:gateway` - Start API Gateway only (`@ecommerce/gateway` · Port 5460)
- `pnpm run dev:admin` - Start Admin Cockpit (`@ecommerce/admin` · Port 5461)
- `pnpm run dev:client` - Start Customer Client (`@ecommerce/client` · Port 5462)
- `pnpm run dev:ms-user` - Start User Service (`@ecommerce/ms-user` · Port 5463)
- `pnpm run dev:ms-product` - Start Product Service (`@ecommerce/ms-product` · Port 5464)
- `pnpm run dev:ms-order` - Start Order Service (`@ecommerce/ms-order` · Port 5465)

## 🏃 Development Workflow

### Adding a New Service
1. Create a new directory under `packages/`
2. Initialize with `pnpm init`
3. Verify matching glob in `pnpm-workspace.yaml`
4. Add to `tsconfig.json` references and paths
5. Update Docker Compose configuration

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

## ⚙️ Task Queues (BullMQ + Redis)

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

## 📊 Monitoring & Observability

- Health check endpoints: `/health`
- Metrics: Prometheus endpoints at `/metrics`
- Logging: Structured JSON logs
- Error Tracking: Sentry integration

## 🔒 Security

- JWT-based authentication
- Rate limiting
- CORS configuration
- Input validation
- Security headers with Helmet

## 🚀 Deployment

### Docker Deployment
```bash
# Build all services
pnpm run docker:build

# Start with Docker Compose
pnpm run docker:up
```

### Kubernetes (Kustomize) Deployment
```bash
# Deploy to Staging
kubectl apply -k scripts/k8s/overlays/staging

# Deploy to Production
kubectl apply -k scripts/k8s/overlays/production
```

## 📚 API Documentation

API documentation is available at:
- Swagger UI: http://localhost:5460/api-docs
- API Gateway: Routes to all service endpoints

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm run test:watch

# Run tests with coverage
pnpm --filter @ecommerce/client run test:coverage
```

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Please read our contributing guidelines before submitting a pull request.
## Backing services

**No backing service is defined in this repo.** PostgreSQL, MongoDB, Redis,
Elasticsearch, RustFS, Prometheus and Grafana all live in the `infra-hub` repo,
which owns their lifecycle:

```bash
cd ../infra-hub
docker compose up -d                      # Redis + RustFS (the two this repo uses)
docker compose --profile all up -d        # plus Postgres, Mongo, ES, Prometheus, Grafana
```

Ports are unchanged, so running the app on the host via `pnpm run dev` reaches
them on `localhost` using this repo's existing `.env` values — no code change.

`docker-compose.yml` here now defines only the five application services and
joins infra-hub's network as `external`, which is what keeps container
hostnames (`DB_HOST: postgres`, `REDIS_HOST: redis`, …) resolving. **Start
infra-hub first**, or compose fails with "network not found".

RustFS object data lives at `C:\Hub\RustFS` (see `RUSTFS_DATA_PATH`), outside
both repos.

## Search (Elasticsearch)

`ms-product` indexes products into Elasticsearch and uses it to answer
`GET /api/v1/products?search=`. NeDB remains the **source of truth** — the index
is a search accelerator, never the record.

```bash
cd ../infra-hub && docker compose --profile search up -d
```

- Every write path (seed, create, update, delete) mirrors into the index, and
  the whole catalogue is re-indexed from NeDB on each boot, so a wiped or stale
  index self-heals on restart.
- Search results are ranked by relevance, tolerate a typo (`fuzziness: AUTO`)
  and match on `tags`/`sku` as well as title and description — none of which the
  previous substring scan could do.
- Matching ids are resolved back to NeDB records before the response is built,
  so the API can never serve a stale indexed copy.

`GET /health` reports cluster status from a **10s cache**, so a liveness probe
never blocks on Elasticsearch: it answers in ~3ms whether the cluster is up or
down (an uncached probe took ~2.5s during an outage). The `search.cachedAgeMs`
field gives the age of that reading.

**When Elasticsearch is down the endpoint still works**, falling back to the old
in-memory substring filter. The response's `searchEngine` field
(`elasticsearch` | `memory` | `none`) says which path answered, and
`GET /health` reports cluster reachability and the indexed document count.
Set `ELASTICSEARCH_ENABLED=false` to skip it entirely and avoid the
connection timeout on every search.

## Metrics (Prometheus + Grafana)

All four backend services expose `GET /metrics` via the shared plugin in
[`packages/shared/utils/src/metrics.ts`](packages/shared/utils/src/metrics.ts):
request counts, latency histograms and Node process/event-loop stats, each
labelled with `service`.

```bash
cd ../infra-hub && docker compose --profile monitoring up -d
```

- Prometheus (<http://localhost:9090>) scrapes all four over
  `host.docker.internal`, since the services run on the host via `pnpm`.
- Grafana (<http://localhost:3005>, `admin`/`admin`) auto-provisions the
  Prometheus datasource and a **Micro-services Overview** dashboard from
  committed files in `infra-hub/monitoring/grafana/`.

Grafana also has an **Elasticsearch (products)** datasource pointed at the
search index. It is for browsing indexed documents in **Explore**, not for
dashboards: the index has no date field, so time-series panels built on it
return nothing. In Explore, set **Query type → Raw Data**; the default "Logs"
mode fails with `elasticsearch time field name is required`, since Logs and
Metrics both need a timestamp field this index does not have. Use Prometheus for graphs. Add datasources by committing a file
under `infra-hub/monitoring/grafana/provisioning/datasources/` rather than
clicking through the UI, so they survive a wiped data directory.

Targets show as `down` for any service that isn't running — expected during
partial local development, not an outage. Latency is labelled with route
**patterns** (`/api/v1/products/:id`), never raw URLs, to keep metric
cardinality bounded.
