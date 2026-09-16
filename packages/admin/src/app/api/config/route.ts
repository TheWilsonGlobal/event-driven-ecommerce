import { NextResponse } from 'next/server';
import { loadDatabaseConfig } from '@ecommerce/shared-database';

export async function GET() {
  const dbConfig = loadDatabaseConfig(process.env);

  const sanitizedConfig = {
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      apiVersion: process.env.API_VERSION || 'v1',
      logLevel: process.env.LOG_LEVEL || 'info',
    },
    ports: {
      apiGateway: parseInt(process.env.API_GATEWAY_PORT || '3000', 10),
      userService: parseInt(process.env.USER_SERVICE_PORT || '3001', 10),
      productService: parseInt(process.env.PRODUCT_SERVICE_PORT || '3002', 10),
      orderService: parseInt(process.env.ORDER_SERVICE_PORT || '3003', 10),
      frontend: parseInt(process.env.FRONTEND_PORT || '3004', 10),
      adminPortal: parseInt(process.env.ADMIN_PORT || '3005', 10),
    },
    persistence: {
      mode: dbConfig.mode,
      relational: {
        driver: dbConfig.relational.driver,
        postgresHost: dbConfig.relational.postgres.host,
        postgresPort: dbConfig.relational.postgres.port,
        postgresDatabase: dbConfig.relational.postgres.database,
        sqlitePath: dbConfig.relational.sqlite.filePath,
        activeUrl: dbConfig.relational.driver === 'sqlite' ? dbConfig.relational.sqlite.url : 'postgresql://***@localhost:5432/ecommerce',
      },
      document: {
        driver: dbConfig.document.driver,
        mongodbUri: dbConfig.document.mongodb.uri.replace(/:[^:@]+@/, ':***@'),
        nedbDataPath: dbConfig.document.nedb.dataPath,
        nedbInMemory: dbConfig.document.nedb.inMemory,
      },
      keyValue: {
        driver: dbConfig.keyValue.driver,
        redisHost: dbConfig.keyValue.redis.host,
        redisPort: dbConfig.keyValue.redis.port,
        redisDb: dbConfig.keyValue.redis.db,
        rocksdbDataPath: dbConfig.keyValue.rocksdb.dataPath,
        embeddedInMemory: dbConfig.keyValue.embedded.inMemory,
      },
    },
    queues: {
      broker: 'BullMQ over Redis 7',
      concurrency: parseInt(process.env.BULLMQ_CONCURRENCY || '10', 10),
      orderExpirationMinutes: parseInt(process.env.BULLMQ_ORDER_EXPIRATION_MINUTES || '15', 10),
      maxRetries: parseInt(process.env.BULLMQ_MAX_RETRIES || '5', 10),
    },
    security: {
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
      jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
      bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10),
      allowedOrigins: process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3004,http://localhost:3005',
    },
    payments: {
      paypalMode: process.env.PAYPAL_MODE || 'sandbox',
      mockExternalApis: process.env.MOCK_EXTERNAL_APIS === 'true',
    },
    search: {
      elasticsearchHost: process.env.ELASTICSEARCH_HOST || 'http://localhost:9200',
      elasticsearchIndex: process.env.ELASTICSEARCH_INDEX || 'products',
    },
  };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    config: sanitizedConfig,
  });
}
