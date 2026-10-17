# Testing

Unit tests and the stress and load harness. [← Back to the README](../README.md)

## Testing

### Unit & Package Tests
```bash
# Run all unit/package tests across workspace
pnpm test

# Run tests in watch mode
pnpm run test:watch

# Run tests with coverage
pnpm --filter @ecommerce/client run test:coverage
```

### ⚡ Stress & Load Testing (`@ecommerce/tests`)

The load testing suite performs live end-to-end stress testing against real HTTP routes, BullMQ queues, and Kafka event consumers.

#### 1. Prerequisites
Before running stress tests, start the infrastructure and backend services:
```bash
# Terminal 1: Start Redis, Kafka/Redpanda, etc. in Hub (C:\Git\APPs\hub)
cd ../../hub && docker compose up -d

# Terminal 2: Start all backend microservices
pnpm run dev:backend
```

#### 2. Running Stress Tests
```bash
# Run all backend stress tests (Queues + Kafka Events)
pnpm run stress

# Run BullMQ task queue load test only (ms-order, ms-product)
pnpm run stress:queues
# With custom concurrency and rounds:
pnpm run stress:queues -- --concurrency=50 --rounds=3

# Run Kafka event-backbone load test only (ms-order, ms-inventory, ms-analytics)
pnpm run stress:events
# With custom order count and concurrency:
pnpm run stress:events -- --orders=500 --concurrency=50
```

---
