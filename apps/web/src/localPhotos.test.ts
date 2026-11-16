import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addLocalPhoto,
  countLocalPhotos,
  deleteLocalPhoto,
  getLocalPhoto,
  listLocalPhotos,
  localPhotoBytes,
  updateLocalPhoto,
  type LocalPhoto,
} from './localPhotos';

function photo(id: string): LocalPhoto {
  return {
    id,
    blob: new Blob(['watermarked-' + id], { type: 'image/jpeg' }),
    filename: `${id}.jpg`,
    createdAt: Date.now() + Number(id),
    width: 1200,
    height: 900,
  };
}

describe('local photo backup', () => {
  beforeEach(async () => {
    for (const p of await listLocalPhotos()) await deleteLocalPhoto(p.id);
  });

  it('stores, sorts and counts local watermarked photos', async () => {
    await addLocalPhoto(photo('1'));
    await addLocalPhoto(photo('2'));
    const all = await listLocalPhotos();
    expect(all.map((p) => p.id)).toEqual(['2', '1']);
    expect(await countLocalPhotos()).toBe(2);
    expect(await localPhotoBytes()).toBeGreaterThan(0);
  });

  it('links a local photo to its remote record and deletes it', async () => {
    await addLocalPhoto(photo('3'));
    const saved = await getLocalPhoto('3');
    expect(saved).toBeTruthy();
    saved!.remoteId = 'remote-3';
    await updateLocalPhoto(saved!);
    expect((await getLocalPhoto('3'))?.remoteId).toBe('remote-3');
    await deleteLocalPhoto('3');
    expect(await countLocalPhotos()).toBe(0);
  });
});
