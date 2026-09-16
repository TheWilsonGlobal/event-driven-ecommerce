import { loadStorageConfig, createRustFSClient, RustFSStorageClient } from '../storage'

describe('RustFS and Storage Configuration', () => {
  it('should load default RustFS configuration when no env is provided', () => {
    const config = loadStorageConfig({})
    expect(config.provider).toBe('rustfs')
    expect(config.rustfs.endpoint).toBe('http://localhost:9000')
    expect(config.rustfs.bucket).toBe('ecommerce-uploads')
    expect(config.rustfs.accessKey).toBe('rustfsadmin')
  })

  it('should load custom environment configuration', () => {
    const customEnv = {
      STORAGE_PROVIDER: 'rustfs',
      RUSTFS_ENDPOINT: 'http://minio:9000',
      RUSTFS_BUCKET: 'custom-bucket',
      RUSTFS_ACCESS_KEY: 'my-key',
      RUSTFS_SECRET_KEY: 'my-secret',
    }
    const config = loadStorageConfig(customEnv as any)
    expect(config.rustfs.endpoint).toBe('http://minio:9000')
    expect(config.rustfs.bucket).toBe('custom-bucket')
    expect(config.rustfs.accessKey).toBe('my-key')
  })

  it('should create RustFSStorageClient instance correctly', () => {
    const client = createRustFSClient({
      RUSTFS_ENDPOINT: 'http://localhost:9000',
      RUSTFS_BUCKET: 'test-bucket',
    })
    expect(client).toBeInstanceOf(RustFSStorageClient)
    expect(client.getObjectUrl('test.jpg')).toBe('http://localhost:9000/test-bucket/test.jpg')
  })
})
