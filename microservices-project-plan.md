# Microservices Project Plan: E-commerce Platform

## Architecture Overview

### Clean Architecture Layers
1. **Domain Layer**: Core business logic and entities
2. **Application Layer**: Use cases and application services
3. **Infrastructure Layer**: External concerns (database, APIs)
4. **Presentation Layer**: Controllers, DTOs, and API endpoints

### Microservices Design

#### 1. API Gateway Service
- **Port**: 3000
- **Responsibilities**:
  - Single entry point for all client requests
  - Request routing to appropriate microservices
  - Authentication and authorization checks
  - Rate limiting and caching
  - Request/response transformation

#### 2. User Service
- **Port**: 3001
- **Database**: PostgreSQL
- **Responsibilities**:
  - User registration and authentication
  - Profile management
  - JWT token generation and validation
  - Role-based access control

#### 3. Product Service
- **Port**: 3002
- **Database**: MongoDB (for product catalog flexibility)
- **Responsibilities**:
  - Product catalog management
  - Inventory tracking
  - Product search and filtering
  - Category management

#### 4. Order Service
- **Port**: 3003
- **Database**: PostgreSQL
- **Responsibilities**:
  - Order processing and management
  - Cart operations
  - Payment integration
  - Order history

## Technology Stack

### Backend (NestJS)
- **Framework**: NestJS with TypeScript
- **Communication**:
  - REST APIs
  - RabbitMQ for asynchronous messaging
  - gRPC for inter-service communication
- **Data Persistence**:
  - PostgreSQL (User, Order services)
  - MongoDB (Product service)
  - Redis for caching and sessions
- **Security**:
  - JWT authentication
  - OAuth2 for third-party login
  - Bcrypt for password hashing

### Frontend (Next.js)
- **Framework**: Next.js 14 with App Router
- **UI Library**: Tailwind CSS + Headless UI
- **State Management**: Zustand or Redux Toolkit
- **HTTP Client**: Axios with interceptors
- **Authentication**: NextAuth.js

### DevOps & Infrastructure
- **Containerization**: Docker & Docker Compose
- **API Documentation**: Swagger/OpenAPI
- **Monitoring**: Prometheus + Grafana
- **Logging**: Winston + ELK Stack
- **CI/CD**: GitHub Actions

## Project Structure

```
microservices-ecommerce/
├── packages/
│   ├── shared/                    # Shared libraries and types
│   │   ├── types/                # Common TypeScript types
│   │   ├── utils/                # Shared utilities
│   │   └── constants/            # Shared constants
│   ├── api-gateway/              # NestJS API Gateway
│   ├── user-service/             # User microservice
│   ├── product-service/          # Product microservice
│   └── order-service/            # Order microservice
├── apps/
│   └── frontend/                 # Next.js frontend
├── docker-compose.yml            # Local development
├── docker-compose.prod.yml       # Production setup
├── .github/
│   └── workflows/                # CI/CD pipelines
└── docs/                         # Project documentation
```

## Implementation Steps

### Phase 1: Project Setup
1. Initialize monorepo with workspaces
2. Set up shared library with common types
3. Create Docker development environment
4. Configure CI/CD pipeline

### Phase 2: Core Services
1. Implement User Service with authentication
2. Create Product Service with CRUD operations
3. Build Order Service with cart functionality
4. Set up API Gateway with routing

### Phase 3: Service Communication
1. Implement message broker (RabbitMQ)
2. Create event-driven architecture
3. Set up service discovery
4. Add circuit breakers and retry logic
5. Implement message queue processors for async operations

### Phase 4: Frontend Development
1. Create Next.js application structure
2. Implement authentication flow
3. Build UI components for each domain
4. Connect to API Gateway

### Phase 5: Production Readiness
1. Add comprehensive logging
2. Set up monitoring and alerting
3. Implement security best practices
4. Add performance optimizations

## Key Features to Implement

### Authentication & Authorization
- JWT-based authentication
- Role-based permissions (Admin, Customer)
- OAuth2 integration (Google, Facebook)
- Password reset functionality

### API Features
- Paginated responses
- Filtering and sorting
- Search functionality
- File upload for product images
- WebSocket for real-time updates

### Frontend Features
- Responsive design
- Product catalog with filters
- Shopping cart
- Order history
- User profile management
- Admin dashboard

## Database Schemas

### User Service (PostgreSQL)
```sql
Users Table:
- id (UUID, Primary Key)
- email (VARCHAR, Unique)
- password (VARCHAR)
- firstName (VARCHAR)
- lastName (VARCHAR)
- role (ENUM: ADMIN, CUSTOMER)
- createdAt (TIMESTAMP)
- updatedAt (TIMESTAMP)

Roles Table:
- id (UUID, Primary Key)
- name (VARCHAR, Unique)
- permissions (JSONB)
```

### Product Service (MongoDB)
```javascript
Products Collection:
{
  _id: ObjectId,
  name: String,
  description: String,
  price: Number,
  categoryId: ObjectId,
  inventory: Number,
  images: [String],
  attributes: Object,
  createdAt: Date,
  updatedAt: Date
}

Categories Collection:
{
  _id: ObjectId,
  name: String,
  parentId: ObjectId,
  description: String
}
```

### Order Service (PostgreSQL)
```sql
Orders Table:
- id (UUID, Primary Key)
- userId (UUID, Foreign Key)
- status (ENUM: PENDING, CONFIRMED, SHIPPED, DELIVERED)
- totalAmount (DECIMAL)
- shippingAddress (JSON)
- createdAt (TIMESTAMP)

OrderItems Table:
- id (UUID, Primary Key)
- orderId (UUID, Foreign Key)
- productId (UUID)
- quantity (INTEGER)
- price (DECIMAL)
```

## API Endpoints Specification

### API Gateway Routes
```
POST   /api/v1/auth/login
POST   /api/v1/auth/register
POST   /api/v1/auth/refresh

GET    /api/v1/users/profile
PUT    /api/v1/users/profile
GET    /api/v1/users/admin/users (Admin only)

GET    /api/v1/products
GET    /api/v1/products/:id
POST   /api/v1/products (Admin only)
PUT    /api/v1/products/:id (Admin only)
DELETE /api/v1/products/:id (Admin only)

GET    /api/v1/orders
POST   /api/v1/orders
GET    /api/v1/orders/:id
PUT    /api/v1/orders/:id/cancel
```

## Docker Configuration

### docker-compose.yml (Development)
```yaml
version: '3.8'

services:
  api-gateway:
    build: ./packages/api-gateway
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
    depends_on:
      - user-service
      - product-service
      - order-service

  user-service:
    build: ./packages/user-service
    ports:
      - "3001:3001"
    environment:
      - DB_HOST=postgres-users
      - REDIS_HOST=redis
    depends_on:
      - postgres-users
      - redis

  product-service:
    build: ./packages/product-service
    ports:
      - "3002:3002"
    environment:
      - DB_HOST=mongodb-products
    depends_on:
      - mongodb-products

  order-service:
    build: ./packages/order-service
    ports:
      - "3003:3003"
    environment:
      - DB_HOST=postgres-orders
      - REDIS_HOST=redis
    depends_on:
      - postgres-orders
      - redis

  postgres-users:
    image: postgres:15
    environment:
      - POSTGRES_DB=users_db
      - POSTGRES_USER=admin
      - POSTGRES_PASSWORD=password
    volumes:
      - users_data:/var/lib/postgresql/data

  postgres-orders:
    image: postgres:15
    environment:
      - POSTGRES_DB=orders_db
      - POSTGRES_USER=admin
      - POSTGRES_PASSWORD=password
    volumes:
      - orders_data:/var/lib/postgresql/data

  mongodb-products:
    image: mongo:6
    volumes:
      - products_data:/data/db

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      - RABBITMQ_DEFAULT_USER=admin
      - RABBITMQ_DEFAULT_PASS=password

volumes:
  users_data:
  orders_data:
  products_data:
```

## Environment Variables

### User Service (.env)
```
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=users_db
DB_USER=admin
DB_PASSWORD=password
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=24h
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Product Service (.env)
```
NODE_ENV=development
PORT=3002
MONGODB_URI=mongodb://localhost:27017/products_db
REDIS_HOST=localhost
REDIS_PORT=6379
FILE_UPLOAD_PATH=./uploads
MAX_FILE_SIZE=5242880
```

### Order Service (.env)
```
NODE_ENV=development
PORT=3003
DB_HOST=localhost
DB_PORT=5432
DB_NAME=orders_db
DB_USER=admin
DB_PASSWORD=password
REDIS_HOST=localhost
REDIS_PORT=6379
RABBITMQ_URL=amqp://admin:password@localhost:5672
```

## CI/CD Pipeline (.github/workflows/main.yml)

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm run test

      - name: Run e2e tests
        run: npm run test:e2e

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Login to Docker Hub
        uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Build and push services
        run: |
          docker-compose -f docker-compose.prod.yml build
          docker-compose -f docker-compose.prod.yml push
```

## Getting Started Guide

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd microservices-ecommerce
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development environment**
   ```bash
   docker-compose up -d
   npm run dev
   ```

4. **Run database migrations**
   ```bash
   npm run migrate
   ```

5. **Access applications**
   - API Gateway: http://localhost:3000
   - Frontend: http://localhost:3005
   - API Documentation: http://localhost:3000/api
   - RabbitMQ Management: http://localhost:15672

## Performance Considerations

### Caching Strategy
- Redis for session storage
- API response caching with TTL
- Database query result caching
- CDN for static assets

### Database Optimization
- Database connection pooling
- Proper indexing strategies
- Read replicas for heavy read operations
- Database sharding for scalability

### Monitoring Metrics
- Response times
- Error rates
- Resource utilization
- Business metrics (orders per minute, etc.)

## Security Best Practices

1. **API Security**
   - Rate limiting
   - Input validation
   - SQL injection prevention
   - CORS configuration

2. **Authentication & Authorization**
   - JWT token rotation
   - Secure password policies
   - Multi-factor authentication
   - OAuth 2.0 implementation

3. **Data Protection**
   - Encryption at rest
   - Encrypted communication (HTTPS/TLS)
   - PII data masking
   - GDPR compliance

## Testing Strategy

### Unit Tests
- Service layer tests
- Repository tests
- Utility function tests
- Target coverage: 80%+

### Integration Tests
- API endpoint tests
- Database operations
- External service integrations
- Message queue operations

### E2E Tests
- User workflows
- Cross-service transactions
- Performance tests
- Load tests

## Future Enhancements

1. **Advanced Features**
   - Recommendation engine
   - Machine learning for product suggestions
   - Advanced analytics dashboard
   - Multi-tenant support

2. **Scalability**
   - Kubernetes deployment
   - Auto-scaling policies
   - Microservice mesh with Istio
   - Event sourcing architecture

3. **Observability**
   - Distributed tracing
   - Custom dashboards
   - Automated alerting
   - Log aggregation and analysis

## Message Queue Processing Architecture

### Queue Design Pattern

#### 1. Event-Driven Communication
```typescript
// Event Types
enum EventType {
  USER_REGISTERED = 'user.registered',
  ORDER_CREATED = 'order.created',
  ORDER_CANCELLED = 'order.cancelled',
  PAYMENT_PROCESSED = 'payment.processed',
  PRODUCT_UPDATED = 'product.updated',
  INVENTORY_UPDATED = 'inventory.updated',
  EMAIL_NOTIFICATION = 'email.notification'
}

// Event Message Structure
interface EventMessage<T = any> {
  id: string;
  type: EventType;
  timestamp: Date;
  service: string;
  version: string;
  data: T;
  correlationId?: string;
  retryCount?: number;
}
```

#### 2. Queue Configuration
```typescript
// RabbitMQ Queue Definitions
export const QUEUES = {
  // User Service Queues
  USER_EMAIL_QUEUE: {
    name: 'user.email',
    options: {
      durable: true,
      deadLetterExchange: 'user.email.dlx',
      messageTtl: 3600000 // 1 hour
    }
  },

  // Order Service Queues
  ORDER_PROCESSING_QUEUE: {
    name: 'order.processing',
    options: {
      durable: true,
      deadLetterExchange: 'order.processing.dlx',
      messageTtl: 86400000 // 24 hours
    }
  },

  INVENTORY_QUEUE: {
    name: 'inventory.update',
    options: {
      durable: true,
      deadLetterExchange: 'inventory.dlx'
    }
  },

  // Notification Queues
  EMAIL_NOTIFICATION_QUEUE: {
    name: 'notification.email',
    options: {
      durable: true,
      deadLetterExchange: 'notification.dlx'
    }
  },

  SMS_NOTIFICATION_QUEUE: {
    name: 'notification.sms',
    options: {
      durable: true
    }
  },

  // Payment Queue
  PAYMENT_PROCESSING_QUEUE: {
    name: 'payment.processing',
    options: {
      durable: true,
      deadLetterExchange: 'payment.dlx',
      messageTtl: 1800000 // 30 minutes
    }
  }
};

// Exchange Configuration
export const EXCHANGES = {
  EVENTS: 'events.exchange',
  DIRECT: 'direct.exchange',
  TOPIC: 'topic.exchange',
  FANOUT: 'fanout.exchange'
};
```

### 3. Message Processor Implementation

#### User Service Message Processors
```typescript
// user-service/src/processors/email.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { MailerService } from '@nestjs-modules/mailer';

@Processor(QUEUES.USER_EMAIL_QUEUE.name)
export class EmailProcessor {
  constructor(private mailerService: MailerService) {}

  @Process('welcome-email')
  async handleWelcomeEmail(job: Job<{ email: string; name: string }>) {
    try {
      await this.mailerService.sendMail({
        to: job.data.email,
        subject: 'Welcome to Our Platform!',
        template: 'welcome',
        context: {
          name: job.data.name
        }
      });

      // Log success
      await this.logEmailSent(job.data.email, 'welcome');
    } catch (error) {
      // Implement retry logic
      if (job.attemptsMade < 3) {
        throw new Error(`Email failed: ${error.message}`);
      }
      // Move to dead letter queue after max retries
      await this.handleFailedEmail(job.data, error);
    }
  }

  @Process('password-reset')
  async handlePasswordReset(job: Job<{ email: string; token: string }>) {
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${job.data.token}`;

    await this.mailerService.sendMail({
      to: job.data.email,
      subject: 'Password Reset Request',
      template: 'password-reset',
      context: {
        resetLink,
        expiresIn: '1 hour'
      }
    });
  }
}
```

#### Order Service Message Processors
```typescript
// order-service/src/processors/order.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { OrderService } from '../order/order.service';
import { InventoryService } from '../inventory/inventory.service';

@Processor(QUEUES.ORDER_PROCESSING_QUEUE.name)
export class OrderProcessor {
  constructor(
    private orderService: OrderService,
    private inventoryService: InventoryService,
    private eventBus: EventBus
  ) {}

  @Process('create-order')
  async handleOrderCreation(job: Job<{ orderId: string; userId: string }>) {
    const { orderId, userId } = job.data;

    try {
      // 1. Fetch order details
      const order = await this.orderService.findById(orderId);

      // 2. Check inventory availability
      const inventoryChecks = await Promise.all(
        order.items.map(item =>
          this.inventoryService.checkAvailability(item.productId, item.quantity)
        )
      );

      // 3. Reserve inventory
      if (inventoryChecks.every(check => check.available)) {
        await this.reserveInventory(order.items);

        // 4. Update order status
        await this.orderService.updateStatus(orderId, 'CONFIRMED');

        // 5. Emit order confirmed event
        this.eventBus.emit('order.confirmed', {
          orderId,
          userId,
          total: order.totalAmount
        });

        // 6. Add payment processing job
        await this.addPaymentJob(orderId);

      } else {
        // Handle insufficient inventory
        await this.orderService.updateStatus(orderId, 'CANCELLED');
        await this.notifyInsufficientInventory(orderId, inventoryChecks);
      }

    } catch (error) {
      // Update order status to failed
      await this.orderService.updateStatus(orderId, 'FAILED');
      throw error;
    }
  }

  @Process('cancel-order')
  async handleOrderCancellation(job: Job<{ orderId: string; reason: string }>) {
    const { orderId, reason } = job.data;

    // 1. Update order status
    await this.orderService.updateStatus(orderId, 'CANCELLED', reason);

    // 2. Release reserved inventory
    const order = await this.orderService.findById(orderId);
    await this.releaseInventory(order.items);

    // 3. Process refund if payment was made
    if (order.paymentStatus === 'PAID') {
      await this.addRefundJob(orderId);
    }

    // 4. Send cancellation notification
    await this.addCancellationEmailJob(order);
  }

  private async reserveInventory(items: OrderItem[]) {
    for (const item of items) {
      await this.inventoryService.reserve(
        item.productId,
        item.quantity,
        `order-${Date.now()}`
      );
    }
  }

  private async releaseInventory(items: OrderItem[]) {
    for (const item of items) {
      await this.inventoryService.release(
        item.productId,
        item.quantity
      );
    }
  }
}
```

### 4. Advanced Message Queue Patterns

#### Saga Pattern Implementation
```typescript
// order-service/src/sagas/order-saga.ts
import { Injectable } from '@nestjs/common';
import { Saga, ofType } from '@nestjs/cqrs';
import { Observable } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { OrderCreatedEvent } from '../events/order-created.event';
import { InventoryReservedEvent } from '../events/inventory-reserved.event';
import { InventoryReservationFailedEvent } from '../events/inventory-reservation-failed.event';
import { PaymentProcessedEvent } from '../events/payment-processed.event';
import { PaymentFailedEvent } from '../events/payment-failed.event';
import { CancelOrderCommand } from '../commands/cancel-order.command';
import { ReleaseInventoryCommand } from '../commands/release-inventory.command';
import { ProcessRefundCommand } from '../commands/process-refund.command';

@Injectable()
export class OrderSaga {

  @Saga()
  orderCreated = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(OrderCreatedEvent),
      map(async event => {
        try {
          // Step 1: Reserve Inventory
          const inventoryReserved = await this.reserveInventory(event.orderItems);

          if (inventoryReserved) {
            // Step 2: Process Payment
            const paymentProcessed = await this.processPayment(
              event.orderId,
              event.totalAmount
            );

            if (!paymentProcessed) {
              // Compensation: Release Inventory
              this.commandBus.execute(
                new ReleaseInventoryCommand(event.orderId, event.orderItems)
              );
            }
          } else {
            // Compensation: Cancel Order
            this.commandBus.execute(
              new CancelOrderCommand(
                event.orderId,
                'Insufficient inventory'
              )
            );
          }
        } catch (error) {
          // Handle saga failure
          this.handleSagaFailure(event, error);
        }
      })
    );
  }

  @Saga()
  paymentFailed = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(PaymentFailedEvent),
      delay(2000), // Wait for potential retries
      map(async event => {
        // Compensation actions
        await this.commandBus.execute(
          new ReleaseInventoryCommand(event.orderId)
        );
        await this.commandBus.execute(
          new CancelOrderCommand(event.orderId, 'Payment failed')
        );
      })
    );
  }
}
```

#### Dead Letter Queue Handling
```typescript
// shared/src/dead-letter/dlq-processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';

@Processor('dead-letter-queue')
export class DeadLetterProcessor {
  private readonly logger = new Logger(DeadLetterProcessor.name);

  @Process()
  async handleFailedJob(job: Job) {
    const { data, opts, failedReason } = job;

    this.logger.error(
      `Job failed: ${job.name}`,
      {
        jobId: job.id,
        attemptsMade: job.attemptsMade,
        failedReason,
        data
      }
    );

    // Categorize failure and take appropriate action
    if (opts.attempts?.made >= 3) {
      // Permanent failure - store for manual review
      await this.storeFailedJob(job);
      await this.notifyAdmin(job);
    } else {
      // Retry with exponential backoff
      await this.scheduleRetry(job);
    }
  }

  private async storeFailedJob(job: Job) {
    // Store in database for manual review
    await this.failedJobRepository.save({
      jobId: job.id,
      queue: job.queue.name,
      data: job.data,
      error: job.failedReason,
      createdAt: new Date()
    });
  }

  private async notifyAdmin(job: Job) {
    // Send alert to monitoring system
    await this.alertingService.sendAlert({
      level: 'ERROR',
      message: `Critical job failure in queue: ${job.queue.name}`,
      details: {
        jobId: job.id,
        attempts: job.attemptsMade,
        error: job.failedReason
      }
    });
  }
}
```

### 5. Monitoring and Observability

#### Queue Health Monitoring
```typescript
// shared/src/monitoring/queue-health.service.ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class QueueHealthService {
  constructor(
    @InjectQueue('order.processing') private orderQueue: Queue,
    @InjectQueue('notification.email') private emailQueue: Queue,
    @InjectQueue('payment.processing') private paymentQueue: Queue
  ) {}

  @Cron('*/30 * * * * *') // Every 30 seconds
  async monitorQueueHealth() {
    const queues = [this.orderQueue, this.emailQueue, this.paymentQueue];

    for (const queue of queues) {
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();

      // Alert if queue has too many waiting jobs
      if (waiting.length > 100) {
        await this.sendQueueAlert(queue.name, {
          type: 'HIGH_BACKLOG',
          waiting: waiting.length,
          threshold: 100
        });
      }

      // Alert if too many failed jobs
      if (failed.length > 10) {
        await this.sendQueueAlert(queue.name, {
          type: 'HIGH_FAILURE_RATE',
          failed: failed.length,
          threshold: 10
        });
      }

      // Update metrics
      await this.updateMetrics(queue.name, {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length
      });
    }
  }

  private async sendQueueAlert(queueName: string, alert: any) {
    // Integration with monitoring systems like Prometheus, Grafana, or Datadog
    this.metricsService.increment('queue_alerts_total', {
      queue: queueName,
      type: alert.type
    });

    // Send webhook or notification
    await this.notificationService.sendAlert({
      message: `Queue ${queueName} alert: ${alert.type}`,
      details: alert
    });
  }
}
```

### 6. Queue Performance Optimization

#### Batch Processing
```typescript
// inventory-service/src/processors/batch-inventory.processor.ts
@Processor('inventory.batch.update')
export class BatchInventoryProcessor {
  private batchSize = 100;
  private batchTimeout = 5000; // 5 seconds
  private batch: any[] = [];
  private batchTimer: NodeJS.Timeout;

  @Process()
  async handleInventoryUpdate(job: Job<{ productId: string; quantity: number }>) {
    this.batch.push(job.data);

    // Process batch if it reaches size limit
    if (this.batch.length >= this.batchSize) {
      await this.processBatch();
    } else if (!this.batchTimer) {
      // Set timer to process batch after timeout
      this.batchTimer = setTimeout(() => this.processBatch(), this.batchTimeout);
    }
  }

  private async processBatch() {
    if (this.batch.length === 0) return;

    clearTimeout(this.batchTimer);
    this.batchTimer = null;

    const currentBatch = this.batch.splice(0);

    try {
      // Process updates in bulk
      await this.inventoryService.bulkUpdate(currentBatch);

      // Log successful batch processing
      this.logger.log(`Processed batch of ${currentBatch.length} inventory updates`);
    } catch (error) {
      // Handle batch failure - optionally retry individual items
      await this.handleBatchFailure(currentBatch, error);
    }
  }
}
```

### 7. Testing Message Queues

#### Queue Testing Strategies
```typescript
// user-service/test/email.processor.spec.ts
import { Test } from '@nestjs/testing';
import { EmailProcessor } from '../processors/email.processor';
import { MailerService } from '@nestjs-modules/mailer';
import { BullModule } from '@nestjs/bull';
import { getQueueToken } from '@nestjs/bull';

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let mailerService: MailerService;
  let queue: Queue;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        BullModule.registerQueue({
          name: QUEUES.USER_EMAIL_QUEUE.name,
        })
      ],
      providers: [
        EmailProcessor,
        {
          provide: MailerService,
          useValue: {
            sendMail: jest.fn().mockResolvedValue(true)
          }
        }
      ]
    }).compile();

    processor = module.get<EmailProcessor>(EmailProcessor);
    mailerService = module.get<MailerService>(MailerService);
    queue = module.get(getQueueToken(QUEUES.USER_EMAIL_QUEUE.name));
  });

  describe('handleWelcomeEmail', () => {
    it('should send welcome email successfully', async () => {
      const jobData = {
        email: 'test@example.com',
        name: 'Test User'
      };

      const job = {
        data: jobData,
        attemptsMade: 0,
        opts: { attempts: 3 }
      } as Job;

      await processor.handleWelcomeEmail(job);

      expect(mailerService.sendMail).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: 'Welcome to Our Platform!',
        template: 'welcome',
        context: { name: 'Test User' }
      });
    });

    it('should retry on failure', async () => {
      const jobData = {
        email: 'test@example.com',
        name: 'Test User'
      };

      const job = {
        data: jobData,
        attemptsMade: 1,
        opts: { attempts: 3 }
      } as Job;

      mailerService.sendMail.mockRejectedValue(new Error('SMTP error'));

      await expect(processor.handleWelcomeEmail(job)).rejects.toThrow(
        'Email failed: SMTP error'
      );
    });
  });

  describe('queue integration', () => {
    it('should add email job to queue', async () => {
      const emailData = {
        email: 'test@example.com',
        name: 'Test User'
      };

      await queue.add('welcome-email', emailData, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });

      const jobs = await queue.getWaiting();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].data).toEqual(emailData);
    });
  });
});
```

### 8. Best Practices Checklist

#### Message Queue Best Practices
- ✅ Always use dead letter queues for failed messages
- ✅ Implement proper error handling and retry logic
- ✅ Set appropriate TTL (Time To Live) for messages
- ✅ Use message deduplication for idempotent operations
- ✅ Implement message versioning for backward compatibility
- ✅ Monitor queue depth and processing times
- ✅ Use batch processing for high-volume operations
- ✅ Implement proper logging and tracing
- ✅ Set up alerts for queue anomalies
- ✅ Use circuit breakers for external service calls
- ✅ Implement graceful shutdown for processors
- ✅ Test failure scenarios thoroughly
- ✅ Use separate queues for different priority levels
- ✅ Implement message ordering when required
- ✅ Use acknowledgments for guaranteed delivery