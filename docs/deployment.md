# Deployment

Docker, CI/CD and Kubernetes. [← Back to the README](../README.md)

## Deployment

### Docker Deployment

#### Option A: Application Services Only (External Hub Infrastructure Active)
Use when backing services (Postgres, Mongo, Redis, Redpanda/Kafka, etc.) are already running in `hub`:

```bash
# Build images
pnpm run docker:build

# Launch application containers
pnpm run docker:up
# Or explicit services command:
pnpm run docker:up:services
# Or with Makefile:
make docker-up-services

# Tear down application containers:
pnpm run docker:down
# Or:
make docker-down-services
```

#### Option B: Full Stack Deployment (Boot Hub Infra + Application Services)
To start the complete environment from scratch:

```bash
# 1. Start shared backing infrastructure in Hub (C:\Git\APPs\hub):
cd ../../hub
docker compose up -d
# Or start with all monitoring, search, and kafka profiles:
docker compose --profile all up -d

# 2. Start application services:
cd ../samples/event-driven-ecommerce
pnpm run docker:up
# Or with Makefile:
make docker-up
```

### CI / CD

- **CI Pipeline** (`.github/workflows/ci.yml`) runs lint, type-check and tests on every push and pull request.
- **Build & Publish Containers** and **Deploy to Kubernetes** run only for a release tag (`v*.*.*`) or a manual run,
  not for ordinary commits.

### Kubernetes (Kustomize) Deployment
```bash
# Deploy to Staging
kubectl apply -k packages/scripts/overlays/staging

# Deploy to Production
kubectl apply -k packages/scripts/overlays/production
```
