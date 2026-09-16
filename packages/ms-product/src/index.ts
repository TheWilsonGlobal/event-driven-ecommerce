import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { loadDatabaseConfig } from '@ecommerce/shared-database';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const dbConfig = loadDatabaseConfig(process.env);
const PORT = parseInt(process.env.PRODUCT_SERVICE_PORT || '3002', 10);

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

async function bootstrap() {
  await server.register(cors, { origin: '*' });
  await server.register(helmet);

  server.get('/health', async () => {
    return {
      status: 'ok',
      service: 'ms-product',
      timestamp: new Date().toISOString(),
      database: {
        mode: dbConfig.mode,
        driver: dbConfig.document.driver,
      },
    };
  });

  server.get('/api/v1/products', async () => {
    return {
      products: [],
      total: 0,
      page: 1,
      limit: 20,
    };
  });

  server.get('/api/v1/categories', async () => {
    return {
      categories: [
        { id: '1', name: 'Electronics', slug: 'electronics' },
        { id: '2', name: 'Clothing', slug: 'clothing' },
        { id: '3', name: 'Books', slug: 'books' },
      ],
    };
  });

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[Product Service] Listening on http://localhost:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

bootstrap();
