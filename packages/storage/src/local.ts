import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
  assertSafeKey,
  StorageError,
  type HeadResult,
  type PutOptions,
  type StorageProvider,
  type UploadTarget,
} from './types.js';

interface MetaFile {
  contentType?: string;
  metadata?: Record<string, string>;
}

/**
 * Local disk provider for the single-server MVP.
 * It intentionally does NOT issue presigned URLs; the API streams uploads/downloads.
 */
export class LocalDiskProvider implements StorageProvider {
  readonly kind = 'local' as const;
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const p = resolve(join(this.baseDir, key));
    if (p !== this.baseDir && !p.startsWith(this.baseDir + sep)) {
      throw new StorageError('INVALID_KEY', 'path escapes storage root');
    }
    return p;
  }

  async putObject(key: string, body: Buffer | Uint8Array | Readable, opts?: PutOptions): Promise<void> {
    const dest = this.pathFor(key);
    await mkdir(dirname(dest), { recursive: true });
    const tmp = `${dest}.${randomUUID()}.tmp`;
    try {
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        await writeFile(tmp, body);
      } else {
        await pipeline(body, createWriteStream(tmp));
      }
      const meta: MetaFile = { contentType: opts?.contentType, metadata: opts?.metadata };
      await writeFile(`${dest}.meta.json`, JSON.stringify(meta), 'utf8');
      await rename(tmp, dest);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {});
      if (e instanceof StorageError) throw e;
      throw new StorageError('PUT_FAILED', 'local put failed', e);
    }
  }

  async getObject(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const p = this.pathFor(key);
    try {
      await stat(p);
      return createReadStream(p, range ? { start: range.start, end: range.end } : undefined);
    } catch (e) {
      throw new StorageError('NOT_FOUND', 'object not found', e);
    }
  }

  async headObject(key: string): Promise<HeadResult> {
    const p = this.pathFor(key);
    try {
      const s = await stat(p);
      let meta: MetaFile = {};
      try {
        meta = JSON.parse(await readFile(`${p}.meta.json`, 'utf8')) as MetaFile;
      } catch {
        // legacy objects may have no sidecar
      }
      return { size: s.size, contentType: meta.contentType, etag: `"${s.size}-${Math.floor(s.mtimeMs)}"` };
    } catch (e) {
      throw new StorageError('NOT_FOUND', 'object not found', e);
    }
  }

  async deleteObject(key: string): Promise<void> {
    const p = this.pathFor(key);
    await unlink(p).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw new StorageError('DELETE_FAILED', 'delete failed', e);
    });
    await unlink(`${p}.meta.json`).catch(() => {});
  }

  async createUploadTarget(_key?: string, _opts?: PutOptions): Promise<UploadTarget | null> {
    return null;
  }

  async createDownloadUrl(_key?: string): Promise<string | null> {
    return null;
  }
}
