import { resolve } from 'node:path';
import { LocalDiskProvider } from './local.js';
import { S3StorageProvider } from './s3.js';
import { StorageError, type StorageConfig, type StorageProvider } from './types.js';

export function createStorage(config: StorageConfig): StorageProvider {
  if (config.driver === 'local') {
    return new LocalDiskProvider(config.localDir ?? resolve(process.cwd(), 'data/wc'));
  }
  if (!config.s3) throw new StorageError('CONFIG', 'S3 config is required when driver=s3');
  return new S3StorageProvider(config.s3);
}

/** Read config from environment; defaults to local so the MVP runs without OSS. */
export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const driver = (env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (driver !== 'local' && driver !== 's3') {
    throw new StorageError('CONFIG', `unknown STORAGE_DRIVER: ${driver}`);
  }
  if (driver === 'local') {
    return { driver, localDir: env.LOCAL_STORAGE_DIR ?? resolve(process.cwd(), 'data/wc') };
  }
  const required = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  for (const k of required) if (!env[k]) throw new StorageError('CONFIG', `missing ${k}`);
  return {
    driver,
    s3: {
      endpoint: env.S3_ENDPOINT!,
      region: env.S3_REGION!,
      bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    },
  };
}
