import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertSafeKey,
  StorageError,
  type HeadResult,
  type PutOptions,
  type StorageProvider,
  type UploadTarget,
} from './types.js';

/**
 * S3-compatible provider. Works with Aliyun OSS S3 API, R2, B2, MinIO.
 * Use virtual-hosted style for Aliyun OSS (forcePathStyle=false).
 */
export class S3StorageProvider implements StorageProvider {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
  }) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: cfg.forcePathStyle ?? false,
      // OSS/MinIO are happier without automatic flexible checksums on presigned PUTs.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async putObject(key: string, body: Buffer | Uint8Array | Readable, opts?: PutOptions): Promise<void> {
    assertSafeKey(key);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: opts?.contentType,
          Metadata: opts?.metadata,
        }),
      );
    } catch (e) {
      throw new StorageError('PUT_FAILED', 's3 put failed', e);
    }
  }

  async getObject(key: string, range?: { start: number; end: number }): Promise<Readable> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      );
      if (!res.Body) throw new Error('empty body');
      return res.Body as Readable;
    } catch (e) {
      throw new StorageError('GET_FAILED', 's3 get failed', e);
    }
  }

  async headObject(key: string): Promise<HeadResult> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType, etag: res.ETag };
    } catch (e) {
      throw new StorageError('NOT_FOUND', 's3 head failed', e);
    }
  }

  async deleteObject(key: string): Promise<void> {
    assertSafeKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      throw new StorageError('DELETE_FAILED', 's3 delete failed', e);
    }
  }

  async createUploadTarget(key: string, opts: PutOptions, expiresIn = 600): Promise<UploadTarget> {
    assertSafeKey(key);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      Metadata: opts.metadata,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return {
      url,
      method: 'PUT',
      headers: opts.contentType ? { 'Content-Type': opts.contentType } : {},
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  async createDownloadUrl(key: string, expiresIn = 300): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }
}
