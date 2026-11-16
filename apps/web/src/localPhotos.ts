export interface LocalPhoto {
  id: string;
  blob: Blob;
  filename: string;
  createdAt: number;
  width: number;
  height: number;
  remoteId?: string;
}

const DB_NAME = 'wc-local-photos';
const STORE = 'photos';

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

export async function addLocalPhoto(photo: LocalPhoto): Promise<void> {
  await tx('readwrite', (s) => s.put(photo));
}

export async function listLocalPhotos(): Promise<LocalPhoto[]> {
  const all = await tx<LocalPhoto[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getLocalPhoto(id: string): Promise<LocalPhoto | undefined> {
  return tx<LocalPhoto | undefined>('readonly', (s) => s.get(id));
}

export async function updateLocalPhoto(photo: LocalPhoto): Promise<void> {
  await tx('readwrite', (s) => s.put(photo));
}

export async function deleteLocalPhoto(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function countLocalPhotos(): Promise<number> {
  return tx<number>('readonly', (s) => s.count());
}

export async function localPhotoBytes(): Promise<number> {
  const photos = await listLocalPhotos();
  return photos.reduce((sum, p) => sum + (p.blob?.size ?? 0), 0);
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
