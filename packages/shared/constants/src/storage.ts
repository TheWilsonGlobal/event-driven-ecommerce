/**
 * Object storage defaults (RustFS). Overridable with STORAGE_PROVIDER,
 * RUSTFS_BUCKET, RUSTFS_REGION and RUSTFS_USE_SSL. Endpoints and keys stay in .env.
 */
export const STORAGE_DEFAULTS = {
  provider: 'rustfs',
  bucket: 'ecommerce-uploads',
  region: 'us-east-1',
  useSSL: false,
} as const
