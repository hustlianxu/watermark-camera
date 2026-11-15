import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { addPending, countPending, deletePending, listPending, type PendingUpload } from './offline';

function item(id: string): PendingUpload {
  return {
    id,
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    filename: 'x.jpg',
    templateId: 'minimal',
    values: { modelo: id },
    spec: {},
    createdAt: Date.now(),
  };
}

describe('offline queue', () => {
  beforeEach(async () => {
    for (const p of await listPending()) await deletePending(p.id);
  });

  it('stores, lists and deletes pending uploads', async () => {
    await addPending(item('a'));
    await addPending(item('b'));
    expect(await countPending()).toBe(2);
    expect((await listPending()).map((p) => p.id).sort()).toEqual(['a', 'b']);
    await deletePending('a');
    expect(await countPending()).toBe(1);
    expect((await listPending())[0].id).toBe('b');
  });
});
