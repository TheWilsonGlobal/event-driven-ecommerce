import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import httpProxy from '@fastify/http-proxy';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const server: FastifyInstance = fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  },
});

const PORT = parseInt(
  process.env.API_GATEWAY_PORT || process.env.PORT || '3000',
  10
);
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://127.0.0.1:3001';
const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL || 'http://127.0.0.1:3002';
const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL || 'http://127.0.0.1:3003';

async function bootstrap() {
  await server.register(cors, {
    origin: '*',
  });

  await server.register(helmet, {
    contentSecurityPolicy: false,
  });

  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  server.get('/health', async () => {
    return {
      status: 'ok',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      routes: {
        users: USER_SERVICE_URL,
        products: PRODUCT_SERVICE_URL,
        orders: ORDER_SERVICE_URL,
      },
    };
  });

  // Proxy user and auth routes
  await server.register(httpProxy, {
    upstream: USER_SERVICE_URL,
    prefix: '/api/v1/auth',
    rewritePrefix: '/api/v1/auth',
  });

  await server.register(httpProxy, {
    upstream: USER_SERVICE_URL,
    prefix: '/api/v1/users',
    rewritePrefix: '/api/v1/users',
  });

  // Proxy product routes
  await server.register(httpProxy, {
    upstream: PRODUCT_SERVICE_URL,
    prefix: '/api/v1/products',
    rewritePrefix: '/api/v1/products',
  });

  await server.register(httpProxy, {
    upstream: PRODUCT_SERVICE_URL,
    prefix: '/api/v1/categories',
    rewritePrefix: '/api/v1/categories',
  });

  // Proxy order and payment routes
  await server.register(httpProxy, {
    upstream: ORDER_SERVICE_URL,
    prefix: '/api/v1/orders',
    rewritePrefix: '/api/v1/orders',
  });

  await server.register(httpProxy, {
    upstream: ORDER_SERVICE_URL,
    prefix: '/api/v1/cart',
    rewritePrefix: '/api/v1/cart',
  });

  await server.register(httpProxy, {
    upstream: ORDER_SERVICE_URL,
    prefix: '/api/v1/payments',
    rewritePrefix: '/api/v1/payments',
  });

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[API Gateway] Listening on http://localhost:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

bootstrap();
