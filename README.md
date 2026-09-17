# Microservices E-Commerce Platform

A scalable, production-ready microservices e-commerce platform built with Node.js, TypeScript, and React.

## 🏗️ Architecture

This monorepo contains the following services:

### Backend Services (Fastify 4)
- **API Gateway** (`packages/gateway` · Port 3000) - Reverse proxy, JWT verification, rate limiting
- **User Service** (`packages/ms-user` · Port 3001) - Authentication, authorization, and user management
- **Product Service** (`packages/ms-product` · Port 3002) - Product catalog, Elasticsearch search, and inventory
- **Order Service** (`packages/ms-order` · Port 3003) - Order checkout saga, BullMQ delayed queues, and Stripe/PayPal

### Shared Libraries
- **Types** (`packages/shared/types`) - Common TypeScript type definitions & DTOs
- **Utils** (`packages/shared/utils`) - Shared utility functions & response wrappers
- **Database** (`packages/shared/database`) - Prisma ORM, Mongoose & Redis clients
- **Messaging** (`packages/shared/messaging`) - BullMQ queues & workers over Redis 7

### Frontend & Control Plane
- **Web Client** (`packages/client` · Port 3004) - Next.js 14 SSR React customer application
- **Admin Portal** (`packages/admin` · Port 3005) - Next.js 14 centralized service & config cockpit

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
- `pnpm run dev:gateway` - Start API Gateway only (`@ecommerce/gateway` · Port 3000)
- `pnpm run dev:ms-user` - Start User Service (`@ecommerce/ms-user` · Port 3001)
- `pnpm run dev:ms-product` - Start Product Service (`@ecommerce/ms-product` · Port 3002)
- `pnpm run dev:ms-order` - Start Order Service (`@ecommerce/ms-order` · Port 3003)
- `pnpm run dev:client` - Start Customer Client (`@ecommerce/client` · Port 3004)
- `pnpm run dev:admin` - Start Admin Cockpit (`@ecommerce/admin` · Port 3005)

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

Introspection endpoints (ms-order, port 3003):

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
- Swagger UI: http://localhost:3000/api-docs
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