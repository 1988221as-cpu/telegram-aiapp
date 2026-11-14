export type PendingMediaField = 'imageUrl' | 'videoUrl' | 'audioUrl' | 'fileUrl';

export interface PendingMediaRecord {
  key: string;
  accountId: string;
  chatId: string;
  messageId: string;
  mediaField: PendingMediaField;
  fileName: string;
  mimeType: string;
  size: number;
  blob: Blob;
  createdAt: number;
}

const DB_NAME = 'hs_pending_media_v1';
const DB_VERSION = 1;
const STORE_NAME = 'pending_media';

function normalizeAccId(accountId?: string): string {
  return (accountId || '').trim() || 'default';
}

export function buildPendingMediaKey(accountId: string | undefined, messageId: string): string {
  return `${normalizeAccId(accountId)}::${messageId}`;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

let dbOpenPromise: Promise<IDBDatabase | null> | null = null;

function openPendingMediaDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        } else {
          store = request.transaction!.objectStore(STORE_NAME);
        }
        if (!store.indexNames.contains('accountChat')) {
          store.createIndex('accountChat', ['accountId', 'chatId'], { unique: false });
        }
        if (!store.indexNames.contains('accountId')) {
          store.createIndex('accountId', 'accountId', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch {}
          dbOpenPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbOpenPromise = null;
        resolve(null);
      };
      request.onblocked = () => {
        dbOpenPromise = null;
        resolve(null);
      };
    } catch {
      dbOpenPromise = null;
      resolve(null);
    }
  });

  return dbOpenPromise;
}

export async function savePendingMediaBlob(params: {
  accountId?: string;
  chatId: string;
  messageId: string;
  mediaField: PendingMediaField;
  blob: Blob;
  fileName?: string;
  mimeType?: string;
  createdAt?: number;
}): Promise<boolean> {
  if (!params?.messageId || !params?.chatId || !params?.blob || typeof params.blob.size !== 'number') {
    return false;
  }
  const db = await openPendingMediaDb();
  if (!db) return false;

  const accountId = normalizeAccId(params.accountId);
  const record: PendingMediaRecord = {
    key: buildPendingMediaKey(accountId, params.messageId),
    accountId,
    chatId: params.chatId,
    messageId: params.messageId,
    mediaField: params.mediaField,
    fileName:
      params.fileName ||
      (params.blob as File).name ||
      (params.mediaField === 'videoUrl'
        ? 'video.mp4'
        : params.mediaField === 'imageUrl'
        ? 'photo.jpg'
        : params.mediaField === 'audioUrl'
        ? 'voice.webm'
        : 'file.bin'),
    mimeType: params.mimeType || params.blob.type || 'application/octet-stream',
    size: params.blob.size,
    blob: params.blob,
    createdAt: typeof params.createdAt === 'number' ? params.createdAt : Date.now(),
  };

  return await new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getPendingMediaBlob(
  accountId: string | undefined,
  messageId: string
): Promise<PendingMediaRecord | null> {
  if (!messageId) return null;
  const db = await openPendingMediaDb();
  if (!db) return null;

  const key = buildPendingMediaKey(accountId, messageId);
  return await new Promise<PendingMediaRecord | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const res = req.result as PendingMediaRecord | undefined;
        resolve(res && res.blob instanceof Blob ? res : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function listChatPendingMediaBlobs(
  accountId: string | undefined,
  chatId: string
): Promise<PendingMediaRecord[]> {
  if (!chatId) return [];
  const db = await openPendingMediaDb();
  if (!db) return [];

  const normAcc = normalizeAccId(accountId);
  return await new Promise<PendingMediaRecord[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('accountChat');
      const req = index.getAll(IDBKeyRange.only([normAcc, chatId]));
      req.onsuccess = () => {
        const list = Array.isArray(req.result) ? (req.result as PendingMediaRecord[]) : [];
        resolve(list.filter((r) => r && r.blob instanceof Blob));
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function deletePendingMediaBlob(
  accountId: string | undefined,
  messageId: string
): Promise<void> {
  if (!messageId) return;
  const db = await openPendingMediaDb();
  if (!db) return;

  const key = buildPendingMediaKey(accountId, messageId);
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearChatPendingMediaBlobs(
  accountId: string | undefined,
  chatId: string
): Promise<void> {
  if (!chatId) return;
  const db = await openPendingMediaDb();
  if (!db) return;

  const normAcc = normalizeAccId(accountId);
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('accountChat');
      const req = index.getAllKeys(IDBKeyRange.only([normAcc, chatId]));
      req.onsuccess = () => {
        const keys = Array.isArray(req.result) ? req.result : [];
        for (const k of keys) {
          store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearAccountPendingMediaBlobs(accountId: string | undefined): Promise<void> {
  const normAcc = normalizeAccId(accountId);
  const db = await openPendingMediaDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('accountId');
      const req = index.getAllKeys(IDBKeyRange.only(normAcc));
      req.onsuccess = () => {
        const keys = Array.isArray(req.result) ? req.result : [];
        for (const k of keys) {
          store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function purgeAllPendingMediaBlobs(): Promise<void> {
  const db = await openPendingMediaDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
