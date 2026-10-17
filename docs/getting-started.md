# Getting started

Setup, running with Docker, scripts and the development workflow. [← Back to the README](../README.md)

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- pnpm 10+ (`corepack enable` or `npm install -g pnpm`)
- Docker & Docker Compose
- A Supabase project (Postgres and Auth); no local Postgres is needed
- Redis 7 (rate limiter, BullMQ, product cache, rankings)
- Redpanda/Kafka (only when `KAFKA_ENABLED=true`)
- Elasticsearch 8.11 (optional, product search)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/event-driven-ecommerce.git
cd event-driven-ecommerce
```

2. Copy environment variables:
```bash
cp .env.example .env
# Update .env: SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SERVICE_AUTH_SECRET
# .env is gitignored; never commit it
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

### Run Backend with Docker Compose

#### Option A: Full Stack (Backing Infrastructure from Hub + Application Services)
Start external backing services in the shared `hub` (PostgreSQL 15, Redis 7, MongoDB 7, Elasticsearch 8.11, Kafka/Redpanda, Prometheus, Grafana), then start the application services:

```bash
# 1. Start shared backing infrastructure from hub (C:\Git\APPs\hub):
cd ../../hub && docker compose up -d
# Or enable all profiles (search, monitoring, logging, kafka):
docker compose --profile all up -d

# 2. Start application services in this repo:
pnpm run docker:up
# Or using Makefile:
make docker-up
```

#### Option B: Application Services Only (Using External Infrastructure from Hub)
When running against existing or external shared infrastructure already running in `hub`:

```bash
# Start only internal application services (Gateway, User, Product, Order, Inventory, Analytics, Client):
pnpm run docker:up
# Or shortcut script:
pnpm run docker:up:services
# Or using Makefile:
make docker-up-services

# Stop services only:
pnpm run docker:down
# Or shortcut script:
pnpm run docker:down:services
# Or using Makefile:
make docker-down-services
```

## 📦 Available Scripts

### Root Level Scripts
- `pnpm run dev` - Start all services concurrently in development mode (Gateway, Services, Client, Admin)
- `pnpm run dev:backend` - Start all backend services and Gateway concurrently
- `pnpm run build` - Build all workspace packages
- `pnpm run build:shared` - Build all shared packages
- `pnpm run db:generate` - Generate Prisma clients across microservices
- `pnpm run db:migrate` - Deploy Prisma migrations (ms-user, ms-order). ms-product/inventory/analytics apply their own SQL migrations at boot
- `pnpm run test` - Run all tests across workspace
- `pnpm run test:watch` - Run tests in interactive watch mode
- `pnpm run lint` - Lint all packages
- `pnpm run lint:fix` - Lint and auto-fix across packages
- `pnpm run docker:up` - Start application container services with Docker Compose
- `pnpm run docker:up:services` - Start internal application services only (using external Hub infra)
- `pnpm run docker:down` - Stop Docker Compose application services
- `pnpm run docker:down:services` - Stop internal application services only
- `pnpm run stress` - Run all backend stress tests (BullMQ task queues + Kafka event backbone)
- `pnpm run stress:queues` - Run BullMQ task queue stress test (`@ecommerce/tests`)
- `pnpm run stress:events` - Run Kafka event backbone stress test (`@ecommerce/tests`)

### Service-Specific Scripts
- `pnpm run dev:gateway` - Start API Gateway only (`@ecommerce/gateway` · Port 5460)
- `pnpm run dev:admin` - Start Admin Cockpit (`@ecommerce/admin` · Port 5461)
- `pnpm run dev:client` - Start Customer Client (`@ecommerce/client` · Port 5462)
- `pnpm run dev:ms-user` - Start User Service (`@ecommerce/ms-user` · Port 5463)
- `pnpm run dev:ms-product` - Start Product Service (`@ecommerce/ms-product` · Port 5464)
- `pnpm run dev:ms-order` - Start Order Service (`@ecommerce/ms-order` · Port 5465)
- `pnpm run dev:ms-inventory` - Start Inventory Service (`@ecommerce/ms-inventory` · Port 5466)
- `pnpm run dev:ms-analytics` - Start Analytics Service (`@ecommerce/ms-analytics` · Port 5467)

## 🏃 Development Workflow

### Adding a New Service
1. Create a new directory under `packages/`
2. Initialize with `pnpm init`
3. Verify matching glob in `pnpm-workspace.yaml`
4. Add to `tsconfig.json` references and paths
5. Update Docker Compose configuration

## API documentation

API documentation is available at:
- Swagger UI: http://localhost:5460/api-docs (public in development; needs `ops:read` in production)
- Rankings: `GET /api/v1/analytics/rankings/top-products?window=1h|24h|7d` and `/rankings/category/:categoryId` (ms-analytics)
- API Gateway: Routes to all service endpoints
