import { loadStorageConfig } from '../storage'
import { loadSearchConfig } from '../search'
import { loadDatabaseConfig } from '../config'
import {
  DB_POOL_MAX_DEFAULT,
  ELASTICSEARCH_INDEX_DEFAULT,
  REDIS_DB_DEFAULT,
  STORAGE_DEFAULTS,
} from '@ecommerce/shared-constants'

describe('database defaults', () => {
  it('equal the previous literals', () => {
    expect(DB_POOL_MAX_DEFAULT).toBe(3)
    expect(REDIS_DB_DEFAULT).toBe(0)
    expect(ELASTICSEARCH_INDEX_DEFAULT).toBe('products')
    expect(STORAGE_DEFAULTS).toEqual({
      provider: 'rustfs',
      bucket: 'ecommerce-uploads',
      region: 'us-east-1',
      useSSL: false,
    })
  })

  it('storage config falls back to them and env still wins', () => {
    const d = loadStorageConfig({})
    expect(d.provider).toBe('rustfs')
    expect(d.rustfs.bucket).toBe('ecommerce-uploads')
    expect(d.rustfs.region).toBe('us-east-1')
    expect(d.rustfs.useSSL).toBe(false)
    const o = loadStorageConfig({
      RUSTFS_BUCKET: 'b',
      RUSTFS_REGION: 'eu-west-1',
      RUSTFS_USE_SSL: 'true',
    })
    expect(o.rustfs.bucket).toBe('b')
    expect(o.rustfs.region).toBe('eu-west-1')
    expect(o.rustfs.useSSL).toBe(true)
    expect(loadStorageConfig({ RUSTFS_USE_SSL: 'false' }).rustfs.useSSL).toBe(false)
  })

  it('search index falls back and env still wins', () => {
    expect(loadSearchConfig({}).index).toBe('products')
    expect(loadSearchConfig({ ELASTICSEARCH_INDEX: 'x' }).index).toBe('x')
  })

  it('redis db falls back and env still wins', () => {
    const base = { DB_MODE: 'server', KV_CACHE_DRIVER: 'redis' }
    expect(loadDatabaseConfig(base).keyValue.redis.db).toBe(0)
    expect(loadDatabaseConfig({ ...base, REDIS_DB: '4' }).keyValue.redis.db).toBe(4)
  })
})
