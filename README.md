# Microservices E-Commerce Platform

A scalable, production-ready microservices e-commerce platform built with Node.js, TypeScript, and React.

## 🏗️ Architecture

This monorepo contains the following services:

### Backend Services
- **API Gateway** (Port 3000) - Routes requests to appropriate services
- **User Service** (Port 3001) - Authentication, authorization, and user management
- **Product Service** (Port 3002) - Product catalog and inventory management
- **Order Service** (Port 3003) - Order processing and payment handling

### Shared Libraries
- **Types** - Common TypeScript type definitions
- **Utils** - Shared utility functions
- **Database** - Database models and configurations
- **Messaging** - Event bus and message queue utilities

### Frontend
- **Web App** - Next.js React application

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm 9+
- Docker & Docker Compose
- PostgreSQL
- Redis
- MongoDB

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
npm run bootstrap
```

4. Start development servers:
```bash
npm run dev
```

## 📦 Available Scripts

### Root Level Scripts
- `npm run dev` - Start all services in development mode
- `npm run build` - Build all packages
- `npm run test` - Run all tests
- `npm run lint` - Lint all packages
- `npm run docker:up` - Start services with Docker Compose

### Service-Specific Scripts
- `npm run dev:api-gateway` - Start API Gateway only
- `npm run dev:user-service` - Start User Service only
- `npm run dev:product-service` - Start Product Service only
- `npm run dev:order-service` - Start Order Service only
- `npm run dev:frontend` - Start Frontend only

## 🏃 Development Workflow

### Adding a New Service
1. Create a new directory under `packages/`
2. Initialize with `npm init`
3. Add to `workspaces` in root `package.json`
4. Add to `tsconfig.json` references
5. Update Docker Compose configuration

### Database Migrations
```bash
# Run migrations
npm run migrate --workspace=@ecommerce/user-service

# Generate new migration
npm run migrate:generate --workspace=@ecommerce/user-service -- MigrationName
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
npm run docker:build

# Start with Docker Compose
npm run docker:up
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
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Please read our contributing guidelines before submitting a pull request.