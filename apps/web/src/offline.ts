export interface PendingUpload {
  id: string;
  blob: Blob;
  filename: string;
  templateId: string;
  folderId?: string;
  values: Record<string, string>;
  spec: Record<string, unknown>;
  createdAt: number;
}

const DB_NAME = 'wc-offline';
const STORE = 'uploads';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

export async function addPending(item: PendingUpload): Promise<void> {
  await tx('readwrite', (s) => s.put(item));
}

export async function listPending(): Promise<PendingUpload[]> {
  const all = await tx<PendingUpload[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deletePending(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function countPending(): Promise<number> {
  return tx<number>('readonly', (s) => s.count());
}
