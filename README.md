# Microservices E-Commerce Platform

A scalable, production-ready microservices e-commerce platform built with Node.js, TypeScript, and React.

## 🏗️ Architecture

This monorepo contains the following services:

### Backend Services (Fastify 4)
- **API Gateway** (`packages/api-gateway` · Port 3000) - Reverse proxy, JWT verification, rate limiting
- **User Service** (`packages/ms-user` · Port 3001) - Authentication, authorization, and user management
- **Product Service** (`packages/ms-product` · Port 3002) - Product catalog, Elasticsearch search, and inventory
- **Order Service** (`packages/ms-order` · Port 3003) - Order checkout saga, BullMQ delayed queues, and Stripe/PayPal

### Shared Libraries
- **Types** (`packages/shared/types`) - Common TypeScript type definitions & DTOs
- **Utils** (`packages/shared/utils`) - Shared utility functions & response wrappers
- **Database** (`packages/shared/database`) - TypeORM, Mongoose & Redis clients
- **Messaging** (`packages/shared/messaging`) - BullMQ queues & workers over Redis 7

### Frontend
- **Web App** (`packages/frontend` · Port 3004) - Next.js 14 SSR React application

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

3. Install dependencies:
```bash
pnpm install
```

4. Start development servers:
```bash
pnpm run dev
```

## 📦 Available Scripts

### Root Level Scripts
- `pnpm run dev` - Start all services concurrently in development mode
- `pnpm run build` - Build all workspace packages
- `pnpm run test` - Run all tests across workspace
- `pnpm run lint` - Lint all packages
- `pnpm run docker:up` - Start 11 container services with Docker Compose
- `pnpm run docker:down` - Stop Docker Compose services

### Service-Specific Scripts
- `pnpm run dev:api-gateway` - Start API Gateway only
- `pnpm run dev:ms-user` - Start User Service (`@ecommerce/ms-user`) only
- `pnpm run dev:ms-product` - Start Product Service (`@ecommerce/ms-product`) only
- `pnpm run dev:ms-order` - Start Order Service (`@ecommerce/ms-order`) only
- `pnpm run dev:frontend` - Start Frontend (`@ecommerce/frontend`) only

## 🏃 Development Workflow

### Adding a New Service
1. Create a new directory under `packages/`
2. Initialize with `pnpm init`
3. Verify matching glob in `pnpm-workspace.yaml`
4. Add to `tsconfig.json` references and paths
5. Update Docker Compose configuration

### Database Migrations
```bash
# Run migrations
pnpm --filter @ecommerce/ms-user run migrate

# Generate new migration
pnpm --filter @ecommerce/ms-user run migrate:generate -- MigrationName
```

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

### Kubernetes
See `k8s/` directory for Kubernetes manifests.

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
pnpm --filter @ecommerce/frontend run test:coverage
```

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Please read our contributing guidelines before submitting a pull request.