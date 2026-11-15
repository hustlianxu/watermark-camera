import { buffer } from 'node:stream/consumers';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDiskProvider } from '../src/local.js';
import { S3StorageProvider } from '../src/s3.js';
import { createStorage, storageConfigFromEnv } from '../src/factory.js';
import { StorageError } from '../src/types.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tempDir() {
  const d = await mkdtemp(join(tmpdir(), 'wc-storage-'));
  dirs.push(d);
  return d;
}

describe('LocalDiskProvider', () => {
  it('puts, heads, gets, ranges and deletes an object', async () => {
    const dir = await tempDir();
    const s = new LocalDiskProvider(dir);
    const key = 'orig/u1/r1/abc.jpg';
    await s.putObject(key, Buffer.from('0123456789'), { contentType: 'image/jpeg' });
    const head = await s.headObject(key);
    expect(head.size).toBe(10);
    expect(head.contentType).toBe('image/jpeg');
    expect(await buffer(await s.getObject(key))).toEqual(Buffer.from('0123456789'));
    expect(await buffer(await s.getObject(key, { start: 2, end: 4 }))).toEqual(Buffer.from('234'));
    await s.deleteObject(key);
    await expect(s.headObject(key)).rejects.toBeInstanceOf(StorageError);
  });

  it('streams a Readable body', async () => {
    const dir = await tempDir();
    const s = new LocalDiskProvider(dir);
    await s.putObject('a/b.txt', Readable.from(['hello ', 'world']));
    expect((await buffer(await s.getObject('a/b.txt'))).toString()).toBe('hello world');
  });

  it('rejects traversal and absolute keys', async () => {
    const dir = await tempDir();
    const s = new LocalDiskProvider(dir);
    await expect(s.putObject('../evil', Buffer.from('x'))).rejects.toBeInstanceOf(StorageError);
    await expect(s.putObject('/etc/passwd', Buffer.from('x'))).rejects.toBeInstanceOf(StorageError);
    await expect(s.putObject('a/../../evil', Buffer.from('x'))).rejects.toBeInstanceOf(StorageError);
  });

  it('does not issue presigned URLs', async () => {
    const s = new LocalDiskProvider(await tempDir());
    expect(await s.createUploadTarget('a.jpg', {})).toBeNull();
    expect(await s.createDownloadUrl('a.jpg')).toBeNull();
  });
});

describe('factory', () => {
  it('defaults to local', () => {
    const cfg = storageConfigFromEnv({});
    expect(cfg.driver).toBe('local');
    expect(createStorage(cfg).kind).toBe('local');
  });

  it('builds s3 from env', () => {
    const cfg = storageConfigFromEnv({
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
      S3_REGION: 'oss-cn-hangzhou',
      S3_BUCKET: 'watermark-cam-prod',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(createStorage(cfg).kind).toBe('s3');
  });

  it('fails clearly when s3 config is missing', () => {
    expect(() => storageConfigFromEnv({ STORAGE_DRIVER: 's3' })).toThrow(StorageError);
  });
});

describe('S3StorageProvider', () => {
  it('creates a presigned PUT and GET without network', async () => {
    const s = new S3StorageProvider({
      endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
      region: 'oss-cn-hangzhou',
      bucket: 'watermark-cam-prod',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
    });
    const put = await s.createUploadTarget('orig/u/r/a.jpg', { contentType: 'image/jpeg' }, 600);
    expect(put).not.toBeNull();
    expect(put!.url).toContain('watermark-cam-prod');
    expect(put!.url).toContain('X-Amz-Signature');
    expect(put!.headers['Content-Type']).toBe('image/jpeg');
    const get = await s.createDownloadUrl('render/u/r/x.jpg', 300);
    expect(get).toContain('X-Amz-Signature');
  });
});
