export type StorageProvider = 'rustfs' | 's3' | 'local';

export interface StorageConfiguration {
  provider: StorageProvider;
  rustfs: {
    endpoint: string;
    consoleEndpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;
    useSSL: boolean;
  };
  s3: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
    endpoint?: string | undefined;
  };
  local: {
    uploadPath: string;
    maxFileSize: number;
  };
}

export function loadStorageConfig(
  env: NodeJS.ProcessEnv = process.env
): StorageConfiguration {
  const provider: StorageProvider =
    (env.STORAGE_PROVIDER?.toLowerCase() as StorageProvider) || 'rustfs';

  return {
    provider,
    rustfs: {
      endpoint: env.RUSTFS_ENDPOINT || 'http://localhost:9000',
      consoleEndpoint: env.RUSTFS_CONSOLE_ENDPOINT || 'http://localhost:9001',
      accessKey: env.RUSTFS_ACCESS_KEY || 'rustfsadmin',
      secretKey: env.RUSTFS_SECRET_KEY || 'rustfspassword',
      bucket: env.RUSTFS_BUCKET || 'ecommerce-uploads',
      region: env.RUSTFS_REGION || 'us-east-1',
      useSSL: env.RUSTFS_USE_SSL === 'true',
    },
    s3: {
      accessKeyId: env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
      region: env.AWS_REGION || 'us-east-1',
      bucket: env.AWS_S3_BUCKET || 'ecommerce-uploads',
      endpoint: env.AWS_S3_ENDPOINT || undefined,
    },
    local: {
      uploadPath: env.UPLOAD_PATH || './uploads',
      maxFileSize: parseInt(env.MAX_FILE_SIZE || '5242880', 10),
    },
  };
}

export interface ObjectStorageClient {
  uploadObject(key: string, buffer: Buffer, contentType?: string): Promise<{ url: string; key: string }>;
  getObjectUrl(key: string): string;
  deleteObject(key: string): Promise<boolean>;
}

/**
 * RustFS S3-compatible Object Storage Client Adapter
 */
export class RustFSStorageClient implements ObjectStorageClient {
  private endpoint: string;
  private bucket: string;

  constructor(endpoint: string, bucket: string) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.bucket = bucket;
  }

  async uploadObject(
    key: string,
    _buffer: Buffer,
    _contentType?: string
  ): Promise<{ url: string; key: string }> {
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    return { url, key };
  }

  getObjectUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  async deleteObject(_key: string): Promise<boolean> {
    return true;
  }
}
