import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const env = process.env;
  const mode = env.DB_MODE?.toLowerCase() === 'embedded' ? 'embedded' : 'server';
  const relationalDriver = (env.RELATIONAL_DB_DRIVER?.toLowerCase()) || (mode === 'embedded' ? 'sqlite' : 'postgres');
  const documentDriver = (env.DOCUMENT_DB_DRIVER?.toLowerCase()) || (mode === 'embedded' ? 'nedb' : 'mongodb');
  const keyValueDriver = (env.KV_CACHE_DRIVER?.toLowerCase()) || (mode === 'embedded' ? 'rocksdb' : 'redis');

  const sanitizedConfig = {
    environment: {
      nodeEnv: env.NODE_ENV || 'development',
      apiVersion: env.API_VERSION || 'v1',
      logLevel: env.LOG_LEVEL || 'info',
    },
    ports: {
      apiGateway: parseInt(env.API_GATEWAY_PORT || '3000', 10),
      userService: parseInt(env.USER_SERVICE_PORT || '3001', 10),
      productService: parseInt(env.PRODUCT_SERVICE_PORT || '3002', 10),
      orderService: parseInt(env.ORDER_SERVICE_PORT || '3003', 10),
      frontend: parseInt(env.FRONTEND_PORT || '3004', 10),
      adminPortal: parseInt(env.ADMIN_PORT || '3005', 10),
    },
    persistence: {
      mode,
      relational: {
        driver: relationalDriver,
        postgresHost: env.POSTGRES_HOST || 'localhost',
        postgresPort: parseInt(env.POSTGRES_PORT || '5432', 10),
        postgresDatabase: env.POSTGRES_DB || 'ecommerce',
        sqlitePath: env.SQLITE_DB_PATH || './data/ecommerce.db',
        activeUrl: relationalDriver === 'sqlite' ? `file:${env.SQLITE_DB_PATH || './data/ecommerce.db'}` : 'postgresql://***@localhost:5432/ecommerce',
      },
      document: {
        driver: documentDriver,
        mongodbUri: (env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce').replace(/:[^:@]+@/, ':***@'),
        nedbDataPath: env.NEDB_DATA_PATH || './data/nedb',
        nedbInMemory: env.NEDB_IN_MEMORY === 'true',
      },
      keyValue: {
        driver: keyValueDriver,
        redisHost: env.REDIS_HOST || 'localhost',
        redisPort: parseInt(env.REDIS_PORT || '6379', 10),
        redisDb: parseInt(env.REDIS_DB || '0', 10),
        rocksdbDataPath: env.ROCKSDB_DATA_PATH || './data/rocksdb',
        embeddedInMemory: env.EMBEDDED_KV_IN_MEMORY === 'true',
      },
    },
    storage: {
      provider: env.STORAGE_PROVIDER || 'rustfs',
      rustfs: {
        endpoint: env.RUSTFS_ENDPOINT || 'http://localhost:9000',
        consoleEndpoint: env.RUSTFS_CONSOLE_ENDPOINT || 'http://localhost:9001',
        bucket: env.RUSTFS_BUCKET || 'ecommerce-uploads',
        region: env.RUSTFS_REGION || 'us-east-1',
      },
      s3Bucket: env.AWS_S3_BUCKET || 'ecommerce-uploads',
      localUploadPath: env.UPLOAD_PATH || './uploads',
    },
    queues: {
      broker: 'BullMQ over Redis 7',
      concurrency: parseInt(env.BULLMQ_CONCURRENCY || '10', 10),
      orderExpirationMinutes: parseInt(env.BULLMQ_ORDER_EXPIRATION_MINUTES || '15', 10),
      maxRetries: parseInt(env.BULLMQ_MAX_RETRIES || '5', 10),
    },
    security: {
      jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
      jwtRefreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN || '30d',
      bcryptSaltRounds: parseInt(env.BCRYPT_SALT_ROUNDS || '12', 10),
      allowedOrigins: env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3004,http://localhost:3005',
    },
    payments: {
      paypalMode: env.PAYPAL_MODE || 'sandbox',
      mockExternalApis: env.MOCK_EXTERNAL_APIS === 'true',
    },
    search: {
      elasticsearchHost: env.ELASTICSEARCH_HOST || 'http://localhost:9200',
      elasticsearchIndex: env.ELASTICSEARCH_INDEX || 'products',
    },
  };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    config: sanitizedConfig,
  });
}
