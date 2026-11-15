import type { Readable } from 'node:stream';

export type StorageDriver = 'local' | 's3';

export interface StorageConfig {
  driver: StorageDriver;
  localDir?: string;
  s3?: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
  };
}

export interface PutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface HeadResult {
  size: number;
  contentType?: string;
  etag?: string;
}

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: number;
}

export interface StorageProvider {
  readonly kind: StorageDriver;
  putObject(key: string, body: Buffer | Uint8Array | Readable, opts?: PutOptions): Promise<void>;
  getObject(key: string, range?: { start: number; end: number }): Promise<Readable>;
  headObject(key: string): Promise<HeadResult>;
  deleteObject(key: string): Promise<void>;
  /** S3: presigned PUT; local: null (use API streaming upload). */
  createUploadTarget(key: string, opts: PutOptions, expiresIn?: number): Promise<UploadTarget | null>;
  /** S3: presigned GET; local: null (use API HMAC file endpoint). */
  createDownloadUrl(key: string, expiresIn?: number): Promise<string | null>;
}

export class StorageError extends Error {
  constructor(public readonly code: string, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Reject traversal, absolute paths, empty keys and control chars. */
export function assertSafeKey(key: string): void {
  if (!key || key.length > 512) throw new StorageError('INVALID_KEY', 'invalid object key');
  if (key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new StorageError('INVALID_KEY', 'invalid object key');
  }
  const parts = key.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new StorageError('INVALID_KEY', 'invalid object key');
  }
}
