/**
 * The website's documents, in the browser's IndexedDB: each one's text, and when it came from (or was saved
 * to) a file on disk, that file's handle and, if the person allowed it, its folder (for its pictures). Pictures
 * added here are kept as assets until the folder can take them.
 */

export interface WebDoc {
  id: string;
  name: string;
  text: string;
  updated: number;
  handle?: FileSystemFileHandle;
  dir?: FileSystemDirectoryHandle;
}

let db: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  return (db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('nib', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('docs', { keyPath: 'id' });
      req.result.createObjectStore('assets');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function run<T>(store: 'docs' | 'assets', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await open()).transaction(store, mode);
  const req = fn(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const listDocs = async () => ((await run<WebDoc[]>('docs', 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => b.updated - a.updated);
export const getDoc = (id: string) => run<WebDoc | undefined>('docs', 'readonly', (s) => s.get(id));
export const putDoc = (doc: WebDoc) => run('docs', 'readwrite', (s) => s.put(doc)).then(() => undefined);
export const deleteDoc = (id: string) => run('docs', 'readwrite', (s) => s.delete(id)).then(() => undefined);
export const getAsset = (id: string, url: string) => run<Uint8Array | undefined>('assets', 'readonly', (s) => s.get(`${id}/${url}`));
export const putAsset = (id: string, url: string, bytes: Uint8Array) => run('assets', 'readwrite', (s) => s.put(bytes, `${id}/${url}`)).then(() => undefined);

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Read or write access to a handle, asking when allowed to (asking needs a click). */
export async function access(h: FileSystemHandle, mode: 'read' | 'readwrite', ask: boolean): Promise<boolean> {
  const p = h as FileSystemHandle & { queryPermission?(o: { mode: string }): Promise<PermissionState>; requestPermission?(o: { mode: string }): Promise<PermissionState> };
  if (!p.queryPermission) return true;
  if ((await p.queryPermission({ mode })) === 'granted') return true;
  return ask && !!p.requestPermission && (await p.requestPermission({ mode })) === 'granted';
}

/** The file at a path relative to `dir` ("images/a.png", "../x.png" is not reachable). */
export async function fileIn(dir: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemFileHandle | undefined> {
  const parts = path.split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return undefined;
  try {
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create });
    return await d.getFileHandle(parts.at(-1)!, { create });
  } catch {
    return undefined;
  }
}
