// Static snapshot of the monorepo's real Prisma schemas and Fastify routes.
//
// This admin package has no live backend of its own (see seed.ts et al.) — it
// mirrors the pattern used everywhere else in this app: hand-curated data
// shaped like what a real introspection endpoint would return, taken from the
// actual prisma/schema.prisma files (ms-user, ms-order) and src/index.ts route
// declarations (gateway, ms-user, ms-product, ms-order) as they exist on disk.

import type { ApiEndpointData, LogFile, SchemaData } from './configTypes'

export const SCHEMA_DATA: SchemaData = {
  tables: [
    {
      name: 'users',
      service: 'ms-user',
      driver: 'PostgreSQL / SQLite',
      rowCount: null,
      columns: [
        { name: 'id', type: 'uuid', nullable: false, isPrimaryKey: true, default: 'uuid()' },
        { name: 'email', type: 'varchar(255)', nullable: false, isUnique: true },
        { name: 'password_hash', type: 'varchar(255)', nullable: false },
        { name: 'first_name', type: 'varchar(100)', nullable: false },
        { name: 'last_name', type: 'varchar(100)', nullable: false },
        { name: 'phone_number', type: 'varchar(30)', nullable: true },
        { name: 'role', type: 'varchar(50)', nullable: false, default: "'CUSTOMER'" },
        { name: 'is_active', type: 'boolean', nullable: false, default: 'true' },
        { name: 'is_email_verified', type: 'boolean', nullable: false, default: 'false' },
        { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' },
      ],
      indexes: [{ name: 'users_email_key', definition: 'UNIQUE (email)' }],
    },
    {
      name: 'addresses',
      service: 'ms-user',
      driver: 'PostgreSQL / SQLite',
      rowCount: null,
      columns: [
        { name: 'id', type: 'uuid', nullable: false, isPrimaryKey: true, default: 'uuid()' },
        { name: 'user_id', type: 'uuid', nullable: false, references: 'users.id' },
        { name: 'address_line1', type: 'varchar(255)', nullable: false },
        { name: 'address_line2', type: 'varchar(255)', nullable: true },
        { name: 'city', type: 'varchar(100)', nullable: false },
        { name: 'state', type: 'varchar(100)', nullable: false },
        { name: 'postal_code', type: 'varchar(20)', nullable: false },
        { name: 'country', type: 'varchar(100)', nullable: false },
        { name: 'is_default_shipping', type: 'boolean', nullable: false, default: 'false' },
        { name: 'is_default_billing', type: 'boolean', nullable: false, default: 'false' },
        { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
      ],
      indexes: [{ name: 'addresses_user_id_idx', definition: 'INDEX (user_id)' }],
    },
    {
      name: 'refresh_tokens',
      service: 'ms-user',
      driver: 'PostgreSQL / SQLite',
      rowCount: null,
      columns: [
        { name: 'id', type: 'uuid', nullable: false, isPrimaryKey: true, default: 'uuid()' },
        { name: 'user_id', type: 'uuid', nullable: false, references: 'users.id' },
        { name: 'token_hash', type: 'varchar(255)', nullable: false },
        { name: 'expires_at', type: 'timestamptz', nullable: false },
        { name: 'is_revoked', type: 'boolean', nullable: false, default: 'false' },
        { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
      ],
      indexes: [{ name: 'refresh_tokens_user_id_idx', definition: 'INDEX (user_id)' }],
    },
    {
      name: 'orders',
      service: 'ms-order',
      driver: 'PostgreSQL / SQLite',
      rowCount: null,
      columns: [
        { name: 'id', type: 'uuid', nullable: false, isPrimaryKey: true, default: 'uuid()' },
        { name: 'order_number', type: 'varchar(50)', nullable: false, isUnique: true },
        { name: 'user_id', type: 'uuid', nullable: false, references: 'users.id (cross-service)' },
        { name: 'status', type: 'varchar(50)', nullable: false, default: "'PENDING'" },
        { name: 'subtotal', type: 'decimal(12,2)', nullable: false },
        { name: 'tax_amount', type: 'decimal(12,2)', nullable: false, default: '0.00' },
        { name: 'shipping_amount', type: 'decimal(12,2)', nullable: false, default: '0.00' },
        { name: 'discount_amount', type: 'decimal(12,2)', nullable: false, default: '0.00' },
        { name: 'total_amount', type: 'decimal(12,2)', nullable: false },
        { name: 'currency', type: 'varchar(3)', nullable: false, default: "'USD'" },
        { name: 'shipping_address', type: 'json', nullable: false },
        { name: 'billing_address', type: 'json', nullable: false },
        { name: 'idempotency_key', type: 'varchar(100)', nullable: true, isUnique: true },
        { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' },
      ],
      indexes: [
        { name: 'orders_order_number_key', definition: 'UNIQUE (order_number)' },
        { name: 'orders_idempotency_key_key', definition: 'UNIQUE (idempotency_key)' },
      ],
    },
    {
      name: 'order_items',
      service: 'ms-order',
      driver: 'PostgreSQL / SQLite',
      rowCount: null,
      columns: [
        { name: 'id', type: 'uuid', nullable: false, isPrimaryKey: true, default: 'uuid()' },
        { name: 'order_id', type: 'uuid', nullable: false, references: 'orders.id' },
        {
          name: 'product_id',
          type: 'varchar(100)',
          nullable: false,
          references: 'products.id (cross-service)',
        },
        { name: 'product_sku', type: 'varchar(100)', nullable: false },
        { name: 'product_title', type: 'varchar(255)', nullable: false },
        { name: 'unit_price', type: 'decimal(12,2)', nullable: false },
        { name: 'quantity', type: 'int', nullable: false },
        { name: 'total_price', type: 'decimal(12,2)', nullable: false },
        { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
      ],
      indexes: [{ name: 'order_items_order_id_idx', definition: 'INDEX (order_id)' }],
    },
    {
      name: 'payments',
      service: 'ms-order',
      driver: 'PostgreSQL / SQLite',
      rowCount: null,
      columns: [
        { name: 'id', type: 'uuid', nullable: false, isPrimaryKey: true, default: 'uuid()' },
        { name: 'order_id', type: 'uuid', nullable: false, references: 'orders.id' },
        { name: 'provider', type: 'varchar(50)', nullable: false },
        { name: 'transaction_id', type: 'varchar(255)', nullable: false, isUnique: true },
        { name: 'payment_method', type: 'varchar(50)', nullable: false },
        { name: 'amount', type: 'decimal(12,2)', nullable: false },
        { name: 'currency', type: 'varchar(3)', nullable: false, default: "'USD'" },
        { name: 'status', type: 'varchar(50)', nullable: false, default: "'PENDING'" },
        { name: 'raw_response', type: 'json', nullable: true },
        { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' },
      ],
      indexes: [{ name: 'payments_transaction_id_key', definition: 'UNIQUE (transaction_id)' }],
    },
    {
      name: 'products (mock document store)',
      service: 'ms-product',
      driver: 'MongoDB / NeDB',
      rowCount: null,
      columns: [
        { name: 'id', type: 'string', nullable: false, isPrimaryKey: true },
        { name: 'title', type: 'string', nullable: false },
        { name: 'slug', type: 'string', nullable: false, isUnique: true },
        { name: 'sku', type: 'string', nullable: false, isUnique: true },
        { name: 'description', type: 'string', nullable: false },
        { name: 'price', type: 'number', nullable: false },
        { name: 'compareAtPrice', type: 'number', nullable: true },
        { name: 'currency', type: 'string', nullable: false },
        { name: 'stock', type: 'number', nullable: false },
        { name: 'isAvailable', type: 'boolean', nullable: false, default: 'true' },
        {
          name: 'category',
          type: 'json { id, name, slug }',
          nullable: false,
          references: 'categories.id',
        },
        { name: 'tags', type: 'string[]', nullable: false },
        { name: 'images', type: 'json[] { url, alt, isPrimary }', nullable: false },
        { name: 'attributes', type: 'json[] { name, value }', nullable: false },
        { name: 'ratings', type: 'json { average, count }', nullable: false },
      ],
      indexes: [],
    },
    {
      name: 'categories (mock document store)',
      service: 'ms-product',
      driver: 'MongoDB / NeDB',
      rowCount: null,
      columns: [
        { name: 'id', type: 'string', nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'string', nullable: false },
        { name: 'slug', type: 'string', nullable: false, isUnique: true },
        { name: 'icon', type: 'string', nullable: true },
        { name: 'description', type: 'string', nullable: true },
        { name: 'productCount', type: 'number', nullable: false, default: '0' },
      ],
      indexes: [],
    },
  ],
  summary: { tableCount: 0, columnCount: 0, indexCount: 0, totalRows: 0 },
}
SCHEMA_DATA.summary = {
  tableCount: SCHEMA_DATA.tables.length,
  columnCount: SCHEMA_DATA.tables.reduce((sum, t) => sum + t.columns.length, 0),
  indexCount: SCHEMA_DATA.tables.reduce((sum, t) => sum + t.indexes.length, 0),
  totalRows: SCHEMA_DATA.tables.reduce((sum, t) => sum + (t.rowCount ?? 0), 0),
}

/**
 * Overlays real row counts (read from the live services this admin app
 * already polls) onto the static schema snapshot. Tables with no
 * corresponding live per-row data fetched by this admin (refresh_tokens,
 * categories) keep rowCount: null and render "n/a", same as before — this
 * only replaces numbers that were previously hand-typed placeholders.
 */
export function withLiveRowCounts(counts: {
  users: number
  addresses: number
  orders: number
  orderItems: number
  payments: number
}): SchemaData {
  const rowCountByTable: Record<string, number> = {
    users: counts.users,
    addresses: counts.addresses,
    orders: counts.orders,
    order_items: counts.orderItems,
    payments: counts.payments,
  }

  const tables = SCHEMA_DATA.tables.map((t) =>
    t.name in rowCountByTable ? { ...t, rowCount: rowCountByTable[t.name] } : t
  )

  return {
    tables,
    summary: {
      tableCount: tables.length,
      columnCount: tables.reduce((sum, t) => sum + t.columns.length, 0),
      indexCount: tables.reduce((sum, t) => sum + t.indexes.length, 0),
      totalRows: tables.reduce((sum, t) => sum + (t.rowCount ?? 0), 0),
    },
  }
}

export const API_ENDPOINT_DATA: ApiEndpointData = {
  groups: [
    {
      name: 'gateway',
      service: 'API Gateway',
      port: 3000,
      docsUrl: 'http://localhost:3000/api-docs',
      endpoints: [
        {
          method: 'GET',
          path: '/health',
          summary: 'Gateway health + upstream service URLs',
          documented: true,
        },
        {
          method: 'ANY',
          path: '/api/v1/auth/*',
          summary: 'Proxied → ms-user :3001',
          documented: false,
        },
        {
          method: 'ANY',
          path: '/api/v1/users/*',
          summary: 'Proxied → ms-user :3001',
          documented: false,
        },
        {
          method: 'ANY',
          path: '/api/v1/products/*',
          summary: 'Proxied → ms-product :3002',
          documented: false,
        },
        {
          method: 'ANY',
          path: '/api/v1/categories/*',
          summary: 'Proxied → ms-product :3002',
          documented: false,
        },
        {
          method: 'ANY',
          path: '/api/v1/orders/*',
          summary: 'Proxied → ms-order :3003',
          documented: false,
        },
        {
          method: 'ANY',
          path: '/api/v1/cart/*',
          summary: 'Proxied → ms-order :3003',
          documented: false,
        },
        {
          method: 'ANY',
          path: '/api/v1/payments/*',
          summary: 'Proxied → ms-order :3003',
          documented: false,
        },
      ],
    },
    {
      name: 'ms-user',
      service: 'User Service',
      port: 3001,
      docsUrl: 'http://localhost:3001/api-docs',
      endpoints: [
        {
          method: 'GET',
          path: '/health',
          summary: 'Health check + db mode/driver',
          documented: true,
        },
        { method: 'GET', path: '/api/v1/users', summary: 'List users', documented: true },
        {
          method: 'POST',
          path: '/api/v1/auth/register',
          summary: 'Register user',
          documented: true,
        },
        {
          method: 'POST',
          path: '/api/v1/auth/login',
          summary: 'Login, issues JWT',
          documented: true,
        },
      ],
    },
    {
      name: 'ms-product',
      service: 'Product Service',
      port: 3002,
      docsUrl: 'http://localhost:3002/api-docs',
      endpoints: [
        {
          method: 'GET',
          path: '/health',
          summary: 'Health check + db mode/driver',
          documented: true,
        },
        {
          method: 'GET',
          path: '/api/v1/storage/health',
          summary: 'RustFS object storage probe',
          documented: true,
        },
        { method: 'GET', path: '/api/v1/products', summary: 'List products', documented: true },
        { method: 'GET', path: '/api/v1/categories', summary: 'List categories', documented: true },
        {
          method: 'POST',
          path: '/api/v1/products/upload',
          summary: 'Upload product image (multipart)',
          documented: true,
        },
        {
          method: 'POST',
          path: '/api/v1/receipts/upload',
          summary: 'Upload order receipt PDF (multipart)',
          documented: true,
        },
      ],
    },
    {
      name: 'ms-order',
      service: 'Order Service',
      port: 3003,
      docsUrl: 'http://localhost:3003/api-docs',
      endpoints: [
        {
          method: 'GET',
          path: '/health',
          summary: 'Health check + db/queue driver',
          documented: true,
        },
        { method: 'GET', path: '/api/v1/orders', summary: 'List orders', documented: true },
        { method: 'GET', path: '/api/v1/cart', summary: 'Get cart', documented: true },
      ],
    },
  ],
  summary: { endpointCount: 0, documentedCount: 0, methodCounts: {} },
}
{
  let count = 0
  let documented = 0
  const methodCounts: Record<string, number> = {}
  for (const g of API_ENDPOINT_DATA.groups) {
    for (const e of g.endpoints) {
      count++
      if (e.documented) documented++
      methodCounts[e.method] = (methodCounts[e.method] ?? 0) + 1
    }
  }
  API_ENDPOINT_DATA.summary = { endpointCount: count, documentedCount: documented, methodCounts }
}

function sampleLog(service: string, lines: string[]): string {
  return `${lines.map((line) => `[${new Date().toISOString()}] [${service}] ${line}`).join('\n')}\n`
}

export const LOG_FILES: LogFile[] = [
  {
    filename: 'gateway-2026-09-16.log',
    service: 'gateway',
    size: 48213,
    modified: '2026-09-17T02:10:00.000Z',
    created: '2026-09-16T00:00:05.000Z',
    level: 'info',
    preview: sampleLog('gateway', [
      'INFO  server listening on http://0.0.0.0:3000',
      'INFO  proxied GET /api/v1/products/prod-42 -> ms-product:3002 (200, 18ms)',
      'INFO  proxied POST /api/v1/auth/login -> ms-user:3001 (200, 34ms)',
      'INFO  rate-limit window reset (100 req/min)',
    ]),
  },
  {
    filename: 'gateway-2026-09-15.log',
    service: 'gateway',
    size: 51022,
    modified: '2026-09-16T00:00:04.000Z',
    created: '2026-09-15T00:00:03.000Z',
    level: 'warn',
    preview: sampleLog('gateway', [
      'INFO  server listening on http://0.0.0.0:3000',
      'WARN  upstream ms-order:3003 responded slowly (612ms) for GET /api/v1/orders',
      'WARN  rate limit exceeded for 203.0.113.7, request throttled',
    ]),
  },
  {
    filename: 'ms-user-2026-09-16.log',
    service: 'ms-user',
    size: 19204,
    modified: '2026-09-17T01:58:00.000Z',
    created: '2026-09-16T00:00:11.000Z',
    level: 'info',
    preview: sampleLog('ms-user', [
      'INFO  server listening on http://0.0.0.0:3001',
      'INFO  POST /api/v1/auth/register 200 (email: user@example.com)',
      'INFO  POST /api/v1/auth/login 200 (mock-jwt-token issued)',
      'INFO  GET /api/v1/users 200 (total: 0)',
    ]),
  },
  {
    filename: 'ms-product-2026-09-16.log',
    service: 'ms-product',
    size: 27650,
    modified: '2026-09-17T02:02:00.000Z',
    created: '2026-09-16T00:00:09.000Z',
    level: 'error',
    preview: sampleLog('ms-product', [
      'INFO  server listening on http://0.0.0.0:3002',
      'INFO  GET /api/v1/categories 200',
      'ERROR RustFS upload failed: connect ECONNREFUSED 127.0.0.1:9000',
      'ERROR POST /api/v1/products/upload 500 (Storage upload failed)',
    ]),
  },
  {
    filename: 'ms-order-2026-09-16.log',
    service: 'ms-order',
    size: 33110,
    modified: '2026-09-17T01:55:00.000Z',
    created: '2026-09-16T00:00:14.000Z',
    level: 'info',
    preview: sampleLog('ms-order', [
      'INFO  server listening on http://0.0.0.0:3003',
      'INFO  GET /api/v1/orders 200 (total: 0)',
      'INFO  GET /api/v1/cart 200 (items: 0)',
    ]),
  },
  {
    filename: 'ms-order-2026-09-15.log',
    service: 'ms-order',
    size: 29883,
    modified: '2026-09-16T00:00:12.000Z',
    created: '2026-09-15T00:00:08.000Z',
    level: 'warn',
    preview: sampleLog('ms-order', [
      'INFO  server listening on http://0.0.0.0:3003',
      'WARN  saga step "reserve-inventory" retried (attempt 2/5)',
      'WARN  BullMQ job order-expire-3021 delayed by 4200ms',
    ]),
  },
]
