import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type StorageProvider = 'rustfs' | 's3' | 'local'

export interface StorageConfiguration {
  provider: StorageProvider
  rustfs: {
    endpoint: string
    consoleEndpoint: string
    accessKey: string
    secretKey: string
    bucket: string
    region: string
    useSSL: boolean
  }
  s3: {
    accessKeyId: string
    secretAccessKey: string
    region: string
    bucket: string
    endpoint?: string | undefined
  }
  local: {
    uploadPath: string
    maxFileSize: number
  }
}

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfiguration {
  const provider: StorageProvider =
    (env.STORAGE_PROVIDER?.toLowerCase() as StorageProvider) || 'rustfs'

  return {
    provider,
    rustfs: {
      endpoint: env.RUSTFS_ENDPOINT ?? 'http://localhost:9000',
      consoleEndpoint: env.RUSTFS_CONSOLE_ENDPOINT ?? 'http://localhost:9001',
      accessKey: env.RUSTFS_ACCESS_KEY ?? 'rustfsadmin',
      secretKey: env.RUSTFS_SECRET_KEY ?? 'rustfspassword',
      bucket: env.RUSTFS_BUCKET ?? 'ecommerce-uploads',
      region: env.RUSTFS_REGION ?? 'us-east-1',
      useSSL: env.RUSTFS_USE_SSL === 'true',
    },
    s3: {
      accessKeyId: env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? '',
      region: env.AWS_REGION ?? 'us-east-1',
      bucket: env.AWS_S3_BUCKET ?? 'ecommerce-uploads',
      endpoint: env.AWS_S3_ENDPOINT ?? undefined,
    },
    local: {
      uploadPath: env.UPLOAD_PATH ?? './uploads',
      maxFileSize: parseInt(env.MAX_FILE_SIZE ?? '5242880', 10),
    },
  }
}

export interface StorageObjectSummary {
  key: string
  sizeBytes: number
  lastModified: string
}

export interface ObjectStorageClient {
  uploadObject(
    key: string,
    buffer: Buffer,
    contentType?: string
  ): Promise<{ url: string; key: string }>
  getSignedDownloadUrl(
    key: string,
    expiresInSeconds?: number,
    downloadFilename?: string
  ): Promise<string>
  getObjectUrl(key: string): string
  deleteObject(key: string): Promise<boolean>
  listObjects(prefix?: string): Promise<StorageObjectSummary[]>
  ensureBucket(): Promise<void>
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number; endpoint: string }>
}

/**
 * RustFS S3-compatible Object Storage Client
 * Uses @aws-sdk/client-s3 against the RustFS endpoint (RustFS is S3-API compatible).
 */
export class RustFSStorageClient implements ObjectStorageClient {
  private s3: S3Client
  private bucket: string
  private endpoint: string

  constructor(
    endpoint: string,
    bucket: string,
    accessKey: string,
    secretKey: string,
    region = 'us-east-1'
  ) {
    this.endpoint = endpoint.replace(/\/$/, '')
    this.bucket = bucket

    this.s3 = new S3Client({
      endpoint: this.endpoint,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true, // required for RustFS / MinIO style endpoints
    })
  }

  /** Ensure the target bucket exists, create it if not. */
  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }))
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }))
    }
  }

  /** Upload a Buffer as an object under the given key. Returns public URL and key. */
  async uploadObject(
    key: string,
    buffer: Buffer,
    contentType = 'application/octet-stream'
  ): Promise<{ url: string; key: string }> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentLength: buffer.byteLength,
      })
    )
    const url = `${this.endpoint}/${this.bucket}/${key}`
    return { url, key }
  }

  /**
   * Generate a pre-signed GET URL valid for the given number of seconds (default 1 hour).
   * Passing `downloadFilename` sets Content-Disposition so the browser saves the file
   * directly (via the S3 ResponseContentDisposition override) instead of opening it inline.
   */
  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds = 3600,
    downloadFilename?: string
  ): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: downloadFilename
        ? `attachment; filename="${downloadFilename}"`
        : undefined,
    })
    return getSignedUrl(this.s3, cmd, { expiresIn: expiresInSeconds })
  }

  /** Returns the direct public URL for an object key. */
  getObjectUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`
  }

  /** Delete an object by key. Returns true on success. */
  async deleteObject(key: string): Promise<boolean> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
    return true
  }

  /** List objects in the bucket, optionally filtered by key prefix. */
  async listObjects(prefix?: string): Promise<StorageObjectSummary[]> {
    const result = await this.s3.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix })
    )
    return (result.Contents ?? []).map((obj) => ({
      key: obj.Key ?? '',
      sizeBytes: obj.Size ?? 0,
      lastModified: (obj.LastModified ?? new Date()).toISOString(),
    }))
  }

  /**
   * Probe RustFS by performing a HeadBucket request and measuring round-trip latency.
   * Returns { healthy, latencyMs, endpoint }.
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; endpoint: string }> {
    const start = Date.now()
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }))
      return { healthy: true, latencyMs: Date.now() - start, endpoint: this.endpoint }
    } catch {
      return { healthy: false, latencyMs: Date.now() - start, endpoint: this.endpoint }
    }
  }
}

/**
 * Factory: create a ready-to-use RustFSStorageClient from environment config.
 */
export function createRustFSClient(env: NodeJS.ProcessEnv = process.env): RustFSStorageClient {
  const cfg = loadStorageConfig(env)
  return new RustFSStorageClient(
    cfg.rustfs.endpoint,
    cfg.rustfs.bucket,
    cfg.rustfs.accessKey,
    cfg.rustfs.secretKey,
    cfg.rustfs.region
  )
}
