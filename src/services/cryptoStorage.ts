/**
 * Client-Side AES-256-GCM Local Storage Encryption Engine
 *
 * Security Architecture:
 * 1. Electron Desktop: Uses main-process OS-level safeStorage (Windows DPAPI) to seal the
 *    256-bit master key on disk, performing synchronous & asynchronous AES-256-GCM encryption
 *    across contextBridge without ever storing plaintext keys in localStorage.
 * 2. Browser (Web Crypto API): Uses a non-extractable (extractable: false) AES-256-GCM
 *    CryptoKey stored in IndexedDB (`hs_secure_keystore`), strictly separated from localStorage.
 * 3. Zero Downgrade Policy: Real `enc:gcm256:<iv>:<ciphertext>` payloads are never downgraded
 *    back to legacy stream ciphers; legacy formats (`s256:`, `sync:`, `raw:`, plain JSON)
 *    are transparently upgraded to real AES-256-GCM on async read.
 */

const LEGACY_KEY_STORE_KEY = 'tg_pro_crypto_seed_v1';
const ENCRYPTION_PREFIX = 'enc:gcm256:';
const SYNC_CIPHER_PREFIX = `${ENCRYPTION_PREFIX}s256:`;
const IDB_NAME = 'hs_secure_keystore';
const IDB_STORE_NAME = 'keys';
const IDB_KEY_RECORD = 'master_aes_gcm_key';

interface ElectronCryptoBridge {
  getStatus: () => { isElectron: boolean; hardwareProtected: boolean; storageMode: string };
  encryptSync: (plaintext: string) => string | null;
  decryptSync: (ciphertext: string) => string | null;
  encryptAsync?: (plaintext: string) => Promise<string | null>;
  decryptAsync?: (ciphertext: string) => Promise<string | null>;
  migrateLegacySeed: (legacySeedBase64: string) => boolean;
  purgeMasterKey: () => boolean;
}

declare global {
  interface Window {
    humanSenseCrypto?: ElectronCryptoBridge;
  }
}

let cachedCryptoKey: CryptoKey | null = null;
let initPromise: Promise<CryptoKey> | null = null;
let ephemeralNodeOrFallbackSeed: Uint8Array | null = null;
let legacyMigratedSeedBytes: Uint8Array | null = null;
let legacySeedChecked = false;
const inMemoryCache = new Map<string, any>();
const pendingAsyncWrites = new Map<string, Promise<void>>();
const pendingAsyncWriteOutcomes = new Map<string, Promise<{ ok: boolean; ciphertext?: string; aborted?: boolean; error?: string }>>();
const failedAsyncWriteKeys = new Map<string, string>();
const lastCommittedCiphertext = new Map<string, string>();
const keyWriteSeq = new Map<string, number>();
let cryptoStorageEpoch = 0;
const debouncedPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface CryptoSyncWriteResult {
  ok: boolean;
  mode: 'dpapi' | 'webcrypto_async' | 'node_fallback' | 'none';
  ciphertext?: string;
  writePromise?: Promise<boolean>;
  error?: string;
}

export interface CryptoFlushResult {
  ok: boolean;
  failedKeys: string[];
  verifiedKeys: string[];
  aborted: boolean;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getElectronBridge(): ElectronCryptoBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.humanSenseCrypto;
  if (
    bridge &&
    typeof bridge.getStatus === 'function' &&
    typeof bridge.encryptSync === 'function' &&
    typeof bridge.decryptSync === 'function'
  ) {
    return bridge;
  }
  return null;
}

function hasWebCryptoSubtle(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.crypto && window.crypto.subtle && typeof window.crypto.subtle.encrypt === 'function')
  );
}

export function isTrueAesGcmCiphertext(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  if (!raw.startsWith(ENCRYPTION_PREFIX)) return false;
  if (
    raw.startsWith(SYNC_CIPHER_PREFIX) ||
    raw.startsWith(`${ENCRYPTION_PREFIX}sync:`) ||
    raw.startsWith(`${ENCRYPTION_PREFIX}raw:`)
  ) {
    return false;
  }
  const rest = raw.slice(ENCRYPTION_PREFIX.length);
  const parts = rest.split(':');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

/**
 * Consumes any legacy plaintext seed left in localStorage from older versions,
 * migrating it into Electron DPAPI or IndexedDB and deleting it from localStorage.
 */
function consumeLegacyLocalStorageSeedOnce(): Uint8Array | null {
  if (legacySeedChecked) return legacyMigratedSeedBytes;
  legacySeedChecked = true;
  if (typeof window === 'undefined') return null;
  try {
    const rawKeyBase64 = localStorage.getItem(LEGACY_KEY_STORE_KEY);
    if (!rawKeyBase64) return null;
    const bytes = base64ToBytes(rawKeyBase64);
    if (bytes.length === 32) {
      legacyMigratedSeedBytes = bytes;
      const bridge = getElectronBridge();
      if (bridge && typeof bridge.migrateLegacySeed === 'function') {
        try {
          bridge.migrateLegacySeed(rawKeyBase64);
          localStorage.removeItem(LEGACY_KEY_STORE_KEY);
        } catch {}
      } else if (hasWebCryptoSubtle() && typeof indexedDB !== 'undefined') {
        // Remove plaintext seed from localStorage once imported by getOrCreateCryptoKey()
      }
      return legacyMigratedSeedBytes;
    }
  } catch {}
  return null;
}

function getFallbackSyncKeyBytes(): Uint8Array {
  if (typeof window === 'undefined') {
    if (!ephemeralNodeOrFallbackSeed) {
      const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
      ephemeralNodeOrFallbackSeed =
        cryptoObj && typeof cryptoObj.getRandomValues === 'function'
          ? cryptoObj.getRandomValues(new Uint8Array(32))
          : new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    }
    return ephemeralNodeOrFallbackSeed;
  }
  const legacy = consumeLegacyLocalStorageSeedOnce();
  if (legacy) return legacy;
  if (!ephemeralNodeOrFallbackSeed) {
    const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    ephemeralNodeOrFallbackSeed =
      cryptoObj && typeof cryptoObj.getRandomValues === 'function'
        ? cryptoObj.getRandomValues(new Uint8Array(32))
        : new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
  }
  return ephemeralNodeOrFallbackSeed;
}

/**
 * Legacy s256 synchronous stream keystream generator (kept strictly for backward-compatible
 * decryption of pre-upgrade data and non-WebCrypto fallback).
 */
function generateKeystream(key: Uint8Array, iv: Uint8Array, length: number): Uint8Array {
  const stream = new Uint8Array(length);
  let s0 = 0x85ebca6b,
    s1 = 0xc2b2ae35,
    s2 = 0x27d4eb2f,
    s3 = 0x165667b1;

  for (let i = 0; i < 32; i += 4) {
    const k = (key[i] | (key[i + 1] << 8) | (key[i + 2] << 16) | (key[i + 3] << 24)) >>> 0;
    if (i === 0) s0 ^= k;
    else if (i === 4) s1 ^= k;
    else if (i === 8) s2 ^= k;
    else if (i === 12) s3 ^= k;
    else if (i === 16) s0 = (s0 + k) >>> 0;
    else if (i === 20) s1 = (s1 + k) >>> 0;
    else if (i === 24) s2 = (s2 + k) >>> 0;
    else if (i === 28) s3 = (s3 + k) >>> 0;
  }

  for (let i = 0; i < 12; i += 4) {
    const v = (iv[i] | (iv[i + 1] << 8) | (iv[i + 2] << 16) | (iv[i + 3] << 24)) >>> 0;
    if (i === 0) s0 ^= (v + 0x9e3779b9) >>> 0;
    else if (i === 4) s1 ^= (v + 0x9e3779b9) >>> 0;
    else if (i === 8) s2 ^= (v + 0x9e3779b9) >>> 0;
  }

  let blockCounter = 0;
  for (let offset = 0; offset < length; offset += 16) {
    blockCounter++;
    let a = (s0 + blockCounter) >>> 0;
    let b = (s1 ^ blockCounter) >>> 0;
    let c = (s2 + blockCounter * 0x1b) >>> 0;
    let d = (s3 ^ (blockCounter * 0x3d)) >>> 0;

    for (let round = 0; round < 8; round++) {
      a = (a + b) >>> 0;
      d = (((d ^ a) << 16) | ((d ^ a) >>> 16)) >>> 0;
      c = (c + d) >>> 0;
      b = (((b ^ c) << 12) | ((b ^ c) >>> 20)) >>> 0;
      a = (a + b) >>> 0;
      d = (((d ^ a) << 8) | ((d ^ a) >>> 24)) >>> 0;
      c = (c + d) >>> 0;
      b = (((b ^ c) << 7) | ((b ^ c) >>> 25)) >>> 0;
    }

    const words = [a, b, c, d];
    for (let w = 0; w < 4 && offset + w * 4 < length; w++) {
      const val = words[w];
      for (let bIdx = 0; bIdx < 4 && offset + w * 4 + bIdx < length; bIdx++) {
        stream[offset + w * 4 + bIdx] = (val >>> (bIdx * 8)) & 0xff;
      }
    }
  }

  return stream;
}

// ==================== INDEXEDDB KEYSTORE (NON-EXTRACTABLE CRYPTOKEY) ====================

function openKeystoreDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
  });
}

async function readKeyFromIdb(): Promise<CryptoKey | null> {
  try {
    const db = await openKeystoreDb();
    return await new Promise<CryptoKey | null>((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const getReq = store.get(IDB_KEY_RECORD);
      getReq.onsuccess = () => resolve((getReq.result as CryptoKey) || null);
      getReq.onerror = () => resolve(null);
      tx.oncomplete = () => {
        try { db.close(); } catch {}
      };
    });
  } catch {
    return null;
  }
}

async function writeKeyToIdb(key: CryptoKey): Promise<void> {
  try {
    const db = await openKeystoreDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(key, IDB_KEY_RECORD);
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve();
      };
      tx.onerror = () => resolve();
    });
  } catch {}
}

async function deleteKeyFromIdb(): Promise<void> {
  try {
    const db = await openKeystoreDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.delete(IDB_KEY_RECORD);
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve();
      };
      tx.onerror = () => resolve();
    });
  } catch {}
}

/**
 * Initializes or retrieves the persistent non-extractable AES-256-GCM CryptoKey.
 * Stored in IndexedDB (isolated from localStorage) with extractable = false.
 */
export async function getOrCreateCryptoKey(): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!hasWebCryptoSubtle()) {
      throw new Error('Web Crypto API (subtle) is not available in this environment');
    }

    // 1. Check IndexedDB for existing non-extractable CryptoKey
    const existingIdbKey = await readKeyFromIdb();
    if (existingIdbKey) {
      consumeLegacyLocalStorageSeedOnce();
      try {
        localStorage.removeItem(LEGACY_KEY_STORE_KEY);
      } catch {}
      cachedCryptoKey = existingIdbKey;
      return existingIdbKey;
    }

    // 2. Migrate any legacy localStorage seed into a non-extractable IndexedDB CryptoKey, then delete plaintext seed
    const legacySeed = consumeLegacyLocalStorageSeedOnce();
    let key: CryptoKey;
    if (legacySeed) {
      key = await window.crypto.subtle.importKey(
        'raw',
        legacySeed.buffer as unknown as BufferSource,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    } else {
      key = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }

    await writeKeyToIdb(key);
    try {
      localStorage.removeItem(LEGACY_KEY_STORE_KEY);
    } catch {}
    cachedCryptoKey = key;
    return key;
  })().catch((err) => {
    initPromise = null;
    throw err;
  });

  return initPromise;
}

if (typeof window !== 'undefined') {
  consumeLegacyLocalStorageSeedOnce();
  if (!getElectronBridge() && hasWebCryptoSubtle()) {
    getOrCreateCryptoKey().catch((err) => {
      console.warn('[WebCryptoStorage] Key initialization warning:', err);
    });
  }
}

function encryptFallbackSyncStream(dataStr: string): string {
  const keyBytes = getFallbackSyncKeyBytes();
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  const iv =
    cryptoObj && typeof cryptoObj.getRandomValues === 'function'
      ? cryptoObj.getRandomValues(new Uint8Array(12))
      : new Uint8Array(12).map(() => Math.floor(Math.random() * 256));

  const encoder = new TextEncoder();
  const utf8Bytes = encoder.encode(dataStr);
  const keystream = generateKeystream(keyBytes, iv, utf8Bytes.length);

  const ciphertext = new Uint8Array(utf8Bytes.length);
  for (let i = 0; i < utf8Bytes.length; i++) {
    ciphertext[i] = utf8Bytes[i] ^ keystream[i];
  }

  return `${SYNC_CIPHER_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(ciphertext)}`;
}

/**
 * Synchronous encryption:
 * - In Electron: Uses genuine OS-backed AES-256-GCM via safeStorage master key (`enc:gcm256:<iv>:<ct+tag>`).
 * - In Browser: Fails closed (throws) instead of silently downgrading to weak XOR cipher.
 * - In Node unit test env (`typeof window === 'undefined'`): Allows 256-bit stream round-trip verification.
 */
export function encryptDataSync(dataStr: string): string {
  const bridge = getElectronBridge();
  if (bridge) {
    const gcmCipher = bridge.encryptSync(dataStr);
    if (gcmCipher && isTrueAesGcmCiphertext(gcmCipher)) {
      return gcmCipher;
    }
    throw new Error('Electron OS DPAPI AES-256-GCM 不可用，已禁止降级加密');
  }
  if (typeof window !== 'undefined') {
    throw new Error('浏览器环境仅支持 WebCrypto AES-256-GCM 异步落盘，已禁止同步降级流加密');
  }
  return encryptFallbackSyncStream(dataStr);
}

function parseDecodedValue<T = any>(jsonStr: string): T {
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return jsonStr as unknown as T;
  }
}

/**
 * Synchronous decryption:
 * - Supports Electron DPAPI-backed `enc:gcm256:<iv>:<ct+tag>`
 * - Supports legacy `enc:gcm256:s256:`, `enc:gcm256:sync:`, `enc:gcm256:raw:`, and plain JSON.
 */
export function decryptDataSync<T = any>(encryptedStr: string | null): T | null {
  if (!encryptedStr) return null;

  // 1. Unencrypted legacy data
  if (!encryptedStr.startsWith(ENCRYPTION_PREFIX)) {
    return parseDecodedValue<T>(encryptedStr);
  }

  // 2. True AES-256-GCM via Electron DPAPI bridge
  if (isTrueAesGcmCiphertext(encryptedStr)) {
    const bridge = getElectronBridge();
    if (bridge) {
      const plain = bridge.decryptSync(encryptedStr);
      if (plain !== null) {
        return parseDecodedValue<T>(plain);
      }
    }
    return null;
  }

  // 3. Legacy 256-bit Synchronous Cipher format: enc:gcm256:s256:<iv>:<ciphertext>
  if (encryptedStr.startsWith(SYNC_CIPHER_PREFIX)) {
    try {
      const payload = encryptedStr.slice(SYNC_CIPHER_PREFIX.length);
      const parts = payload.split(':');
      if (parts.length !== 2) return null;

      const [ivBase64, ciphertextBase64] = parts;
      const iv = base64ToBytes(ivBase64);
      const ciphertext = base64ToBytes(ciphertextBase64);
      const keyBytes = getFallbackSyncKeyBytes();

      const keystream = generateKeystream(keyBytes, iv, ciphertext.length);
      const plainBytes = new Uint8Array(ciphertext.length);
      for (let i = 0; i < ciphertext.length; i++) {
        plainBytes[i] = ciphertext[i] ^ keystream[i];
      }

      const decoder = new TextDecoder();
      return parseDecodedValue<T>(decoder.decode(plainBytes));
    } catch (err) {
      console.warn('[WebCryptoStorage] Decrypt s256 warning:', err);
      return null;
    }
  }

  // 4. Legacy sync format: enc:gcm256:sync:<bytes>
  if (encryptedStr.startsWith(`${ENCRYPTION_PREFIX}sync:`)) {
    try {
      const b64 = encryptedStr.slice(`${ENCRYPTION_PREFIX}sync:`.length);
      const bytes = base64ToBytes(b64);
      const key = 0x5a;
      const plainBytes = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        plainBytes[i] = bytes[i] ^ key;
      }
      try {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const json = decoder.decode(plainBytes);
        return JSON.parse(json) as T;
      } catch {
        let chars = '';
        for (let i = 0; i < bytes.length; i++) {
          chars += String.fromCharCode(bytes[i] ^ key);
        }
        return JSON.parse(chars) as T;
      }
    } catch {
      return null;
    }
  }

  // 5. Fallback raw b64
  if (encryptedStr.startsWith(`${ENCRYPTION_PREFIX}raw:`)) {
    try {
      const b64 = encryptedStr.slice(`${ENCRYPTION_PREFIX}raw:`.length);
      const json = decodeURIComponent(atob(b64));
      return JSON.parse(json) as T;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Asynchronously encrypts arbitrary data using genuine AES-256-GCM.
 * Output format: enc:gcm256:<iv_base64>:<ciphertext_plus_tag_base64>
 */
export async function encryptDataAsync(data: any): Promise<string> {
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);

  const bridge = getElectronBridge();
  if (bridge) {
    const gcmCipher =
      typeof bridge.encryptAsync === 'function'
        ? await bridge.encryptAsync(jsonStr)
        : bridge.encryptSync(jsonStr);
    if (gcmCipher && isTrueAesGcmCiphertext(gcmCipher)) {
      return gcmCipher;
    }
    throw new Error('Electron OS DPAPI AES-256-GCM 不可用，已禁止降级写入本地存储');
  }

  if (!hasWebCryptoSubtle()) {
    throw new Error('当前环境缺少 WebCrypto AES-256-GCM 安全上下文，已禁止降级写入本地存储');
  }

  const key = await getOrCreateCryptoKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(jsonStr);

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encodedData as unknown as BufferSource
  );

  const ivBase64 = bytesToBase64(iv);
  const ciphertextBase64 = bytesToBase64(new Uint8Array(ciphertextBuffer));

  return `${ENCRYPTION_PREFIX}${ivBase64}:${ciphertextBase64}`;
}

/**
 * Asynchronously decrypts an encrypted payload string using AES-256-GCM
 * or legacy fallback formats (for seamless zero-data-loss migration).
 */
export async function decryptDataAsync<T = any>(encryptedStr: string | null): Promise<T | null> {
  if (!encryptedStr) return null;

  if (isTrueAesGcmCiphertext(encryptedStr)) {
    const bridge = getElectronBridge();
    if (bridge && typeof bridge.decryptAsync === 'function') {
      try {
        const plain = await bridge.decryptAsync(encryptedStr);
        if (plain !== null) {
          return parseDecodedValue<T>(plain);
        }
      } catch {}
    }
  }

  // Try sync decrypt (covers Electron DPAPI sync fallback, s256, sync, raw, and plain JSON)
  const syncResult = decryptDataSync<T>(encryptedStr);
  if (syncResult !== null) return syncResult;

  if (!hasWebCryptoSubtle() || !isTrueAesGcmCiphertext(encryptedStr)) {
    return null;
  }

  try {
    const payload = encryptedStr.slice(ENCRYPTION_PREFIX.length);
    const parts = payload.split(':');
    if (parts.length !== 2) return null;

    const [ivBase64, ciphertextBase64] = parts;
    const iv = base64ToBytes(ivBase64);
    const ciphertext = base64ToBytes(ciphertextBase64);

    const key = await getOrCreateCryptoKey();
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource
    );

    const decoder = new TextDecoder();
    const jsonStr = decoder.decode(decryptedBuffer);
    return parseDecodedValue<T>(jsonStr);
  } catch (err) {
    console.error('[WebCryptoStorage] Async decryption error:', err);
    return null;
  }
}

/**
 * Synchronously reads from in-memory cache or decrypts synchronously when supported.
 */
export function secureGetItemSync<T = any>(storageKey: string): T | null {
  if (typeof window === 'undefined' && typeof localStorage === 'undefined') return null;

  if (inMemoryCache.has(storageKey)) {
    return inMemoryCache.get(storageKey) as T;
  }

  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;

  const decrypted = decryptDataSync<T>(raw);
  if (decrypted !== null) {
    inMemoryCache.set(storageKey, decrypted);
    return decrypted;
  }

  return null;
}

export function getCryptoStorageEpoch(): number {
  return cryptoStorageEpoch;
}

function enqueueAsyncAesGcmPersist(
  storageKey: string,
  data: any
): Promise<{ ok: boolean; ciphertext?: string; aborted?: boolean; error?: string }> {
  const capturedEpoch = cryptoStorageEpoch;
  const seq = (keyWriteSeq.get(storageKey) || 0) + 1;
  keyWriteSeq.set(storageKey, seq);
  failedAsyncWriteKeys.delete(storageKey);

  const prev = pendingAsyncWrites.get(storageKey) || Promise.resolve();
  const outcomePromise: Promise<{ ok: boolean; ciphertext?: string; aborted?: boolean; error?: string }> = prev
    .catch(() => {})
    .then(async () => {
      // Abort cleanly if cache was cleared/purged or key removed/superseded
      if (
        capturedEpoch !== cryptoStorageEpoch ||
        keyWriteSeq.get(storageKey) !== seq ||
        !inMemoryCache.has(storageKey)
      ) {
        return { ok: false, aborted: true };
      }
      const latestData = inMemoryCache.get(storageKey);
      const encrypted = await encryptDataAsync(latestData !== undefined ? latestData : data);
      if (
        capturedEpoch !== cryptoStorageEpoch ||
        keyWriteSeq.get(storageKey) !== seq ||
        !inMemoryCache.has(storageKey)
      ) {
        return { ok: false, aborted: true };
      }
      if (typeof localStorage === 'undefined') {
        failedAsyncWriteKeys.set(storageKey, 'localStorage unavailable');
        return { ok: false, error: 'localStorage unavailable' };
      }
      localStorage.setItem(storageKey, encrypted);
      const verified = localStorage.getItem(storageKey) === encrypted && isTrueAesGcmCiphertext(encrypted);
      if (!verified) {
        failedAsyncWriteKeys.set(storageKey, 'localStorage ciphertext readback mismatch');
        return { ok: false, error: 'localStorage ciphertext readback mismatch' };
      }
      lastCommittedCiphertext.set(storageKey, encrypted);
      failedAsyncWriteKeys.delete(storageKey);
      return { ok: true, ciphertext: encrypted };
    })
    .catch((err: any) => {
      const msg = String(err?.message || err || 'async_encrypt_failed');
      if (capturedEpoch === cryptoStorageEpoch && keyWriteSeq.get(storageKey) === seq) {
        failedAsyncWriteKeys.set(storageKey, msg);
      }
      console.warn('[WebCryptoStorage] Async AES-256-GCM persist warning:', err);
      return { ok: false, error: msg };
    });

  const voidNext = outcomePromise
    .then(() => undefined)
    .finally(() => {
      if (pendingAsyncWrites.get(storageKey) === voidNext) {
        pendingAsyncWrites.delete(storageKey);
      }
      if (pendingAsyncWriteOutcomes.get(storageKey) === outcomePromise) {
        pendingAsyncWriteOutcomes.delete(storageKey);
      }
    });

  pendingAsyncWrites.set(storageKey, voidNext);
  pendingAsyncWriteOutcomes.set(storageKey, outcomePromise);
  return outcomePromise;
}

/**
 * Flushes all pending async AES-256-GCM writes and verifies that each committed
 * target key matches the exact ciphertext written in the current epoch.
 */
export async function flushPendingCryptoWritesWithResult(targetKeys?: string[]): Promise<CryptoFlushResult> {
  const startEpoch = cryptoStorageEpoch;
  const scopedList = Array.isArray(targetKeys) && targetKeys.length > 0 ? Array.from(new Set(targetKeys)) : null;

  // Promote any matching debounced writes so flush verifies latest in-memory values
  const keysToPromote = scopedList
    ? scopedList.filter((k) => debouncedPersistTimers.has(k))
    : Array.from(debouncedPersistTimers.keys());
  for (const k of keysToPromote) {
    const timer = debouncedPersistTimers.get(k);
    if (timer) {
      clearTimeout(timer);
      debouncedPersistTimers.delete(k);
    }
    if (inMemoryCache.has(k)) {
      void secureSetItemAsyncWithResult(k, inMemoryCache.get(k));
    }
  }

  // Drain any writes queued for these keys (or all keys if unscoped)
  for (let round = 0; round < 4; round++) {
    const keysToDrain = scopedList
      ? scopedList.filter((k) => pendingAsyncWriteOutcomes.has(k) || pendingAsyncWrites.has(k))
      : Array.from(new Set([...pendingAsyncWriteOutcomes.keys(), ...pendingAsyncWrites.keys()]));
    if (keysToDrain.length === 0) break;
    await Promise.allSettled(
      keysToDrain.map((k) => pendingAsyncWriteOutcomes.get(k) || pendingAsyncWrites.get(k) || Promise.resolve())
    );
  }

  if (cryptoStorageEpoch !== startEpoch) {
    return {
      ok: false,
      failedKeys: scopedList || [],
      verifiedKeys: [],
      aborted: true,
    };
  }

  const keysToVerify = scopedList || Array.from(new Set([...failedAsyncWriteKeys.keys()]));
  const failedKeys: string[] = [];
  const verifiedKeys: string[] = [];

  for (const key of keysToVerify) {
    if (failedAsyncWriteKeys.has(key)) {
      failedKeys.push(key);
      continue;
    }
    const expectedCiphertext = lastCommittedCiphertext.get(key);
    const currentRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (expectedCiphertext && currentRaw === expectedCiphertext) {
      verifiedKeys.push(key);
    } else if (scopedList) {
      // Caller explicitly asked to verify commit of targetKey in this epoch
      failedKeys.push(key);
    }
  }

  return {
    ok: failedKeys.length === 0,
    failedKeys,
    verifiedKeys,
    aborted: false,
  };
}

/**
 * Flushes all pending async AES-256-GCM writes to localStorage.
 */
export async function flushPendingCryptoWrites(): Promise<void> {
  await flushPendingCryptoWritesWithResult();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => {
    void flushPendingCryptoWrites();
  });
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushPendingCryptoWrites();
      }
    });
  }
}

/**
 * Asynchronously encrypts and persists an item using genuine AES-256-GCM.
 */
export async function secureSetItemAsync(storageKey: string, data: any): Promise<void> {
  if (typeof window === 'undefined') return;
  const capturedEpoch = cryptoStorageEpoch;
  const seq = (keyWriteSeq.get(storageKey) || 0) + 1;
  keyWriteSeq.set(storageKey, seq);
  inMemoryCache.set(storageKey, data);
  failedAsyncWriteKeys.delete(storageKey);
  const encrypted = await encryptDataAsync(data);
  if (
    capturedEpoch !== cryptoStorageEpoch ||
    keyWriteSeq.get(storageKey) !== seq ||
    !inMemoryCache.has(storageKey)
  ) {
    return;
  }
  localStorage.setItem(storageKey, encrypted);
  if (localStorage.getItem(storageKey) === encrypted && isTrueAesGcmCiphertext(encrypted)) {
    lastCommittedCiphertext.set(storageKey, encrypted);
  }
}

/**
 * Saves an item into in-memory cache synchronously and returns explicit commit result:
 * - In Electron: synchronous DPAPI + AES-256-GCM via main process IPC + ciphertext readback verification.
 * - In Browser: serialized WebCrypto AES-256-GCM write returning tracked writePromise.
 * - In insecure context without DPAPI/WebCrypto: keeps in memory only; fails closed (`ok: false`).
 */
export function secureSetItemSyncWithResult(storageKey: string, data: any): CryptoSyncWriteResult {
  if (typeof window === 'undefined' && typeof localStorage === 'undefined') {
    return { ok: false, mode: 'none', error: 'storage unavailable' };
  }

  inMemoryCache.set(storageKey, data);
  failedAsyncWriteKeys.delete(storageKey);

  const bridge = getElectronBridge();
  if (bridge) {
    try {
      const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
      const gcmCipher = bridge.encryptSync(jsonStr);
      if (gcmCipher && isTrueAesGcmCiphertext(gcmCipher)) {
        keyWriteSeq.set(storageKey, (keyWriteSeq.get(storageKey) || 0) + 1);
        localStorage.setItem(storageKey, gcmCipher);
        const verified = localStorage.getItem(storageKey) === gcmCipher;
        if (!verified) {
          failedAsyncWriteKeys.set(storageKey, 'localStorage write readback mismatch');
          return { ok: false, mode: 'dpapi', error: 'localStorage write readback mismatch' };
        }
        lastCommittedCiphertext.set(storageKey, gcmCipher);
        return { ok: true, mode: 'dpapi', ciphertext: gcmCipher };
      }
      failedAsyncWriteKeys.set(storageKey, 'Electron DPAPI encryptSync returned invalid ciphertext');
      return { ok: false, mode: 'dpapi', error: 'Electron DPAPI encryptSync returned invalid ciphertext' };
    } catch (err: any) {
      const errMsg = String(err?.message || err || 'dpapi_write_failed');
      failedAsyncWriteKeys.set(storageKey, errMsg);
      return { ok: false, mode: 'dpapi', error: errMsg };
    }
  }

  if (hasWebCryptoSubtle()) {
    const outcomePromise = enqueueAsyncAesGcmPersist(storageKey, data);
    return {
      ok: true,
      mode: 'webcrypto_async',
      writePromise: outcomePromise.then((res) => Boolean(res.ok && !res.aborted)),
    };
  }

  return { ok: false, mode: 'none', error: 'AES-256-GCM 写入通道不可用' };
}

/**
 * Saves an item into in-memory cache synchronously and persists ONLY as genuine AES-256-GCM:
 * - In Electron: synchronous DPAPI + AES-256-GCM via main process IPC (never downgrades if DPAPI unavailable).
 * - In Browser: serialized WebCrypto AES-256-GCM write using IndexedDB non-extractable key.
 * - In insecure context without DPAPI/WebCrypto: keeps in memory only; never writes downgraded XOR ciphertext.
 */
export function secureSetItemSync(storageKey: string, data: any): void {
  const pendingTimer = debouncedPersistTimers.get(storageKey);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    debouncedPersistTimers.delete(storageKey);
  }
  void secureSetItemSyncWithResult(storageKey, data);
}

/**
 * Updates in-memory cache synchronously and persists via non-blocking async AES-256-GCM
 * when Electron async IPC or WebCrypto is available (falls back to sync bridge if async is absent).
 */
export function secureSetItemAsyncWithResult(storageKey: string, data: any): CryptoSyncWriteResult {
  if (typeof window === 'undefined' && typeof localStorage === 'undefined') {
    return { ok: false, mode: 'none', error: 'storage unavailable' };
  }
  const pendingTimer = debouncedPersistTimers.get(storageKey);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    debouncedPersistTimers.delete(storageKey);
  }
  inMemoryCache.set(storageKey, data);
  failedAsyncWriteKeys.delete(storageKey);

  const bridge = getElectronBridge();
  if (bridge && typeof bridge.encryptAsync === 'function') {
    const outcomePromise = enqueueAsyncAesGcmPersist(storageKey, data);
    return {
      ok: true,
      mode: 'dpapi',
      writePromise: outcomePromise.then((res) => Boolean(res.ok && !res.aborted)),
    };
  }
  return secureSetItemSyncWithResult(storageKey, data);
}

/**
 * Updates in-memory cache immediately and coalesces frequent writes into a single async encrypted flush.
 */
export function secureSetItemDebounced(storageKey: string, data: any, delayMs = 250): void {
  if (typeof window === 'undefined' && typeof localStorage === 'undefined') return;
  inMemoryCache.set(storageKey, data);
  failedAsyncWriteKeys.delete(storageKey);
  const prevTimer = debouncedPersistTimers.get(storageKey);
  if (prevTimer) clearTimeout(prevTimer);
  const capturedEpoch = cryptoStorageEpoch;
  const timer = setTimeout(() => {
    debouncedPersistTimers.delete(storageKey);
    if (capturedEpoch !== cryptoStorageEpoch || !inMemoryCache.has(storageKey)) return;
    void secureSetItemAsyncWithResult(storageKey, inMemoryCache.get(storageKey));
  }, Math.max(0, delayMs));
  debouncedPersistTimers.set(storageKey, timer);
}

/**
 * Asynchronously retrieves and decrypts an item from localStorage using AES-256-GCM.
 * Never downgrades true `enc:gcm256:` ciphertext; upgrades legacy formats to real AES-256-GCM.
 */
export async function secureGetItemAsync<T = any>(storageKey: string): Promise<T | null> {
  if (typeof window === 'undefined') return null;

  await flushPendingCryptoWrites();

  if (inMemoryCache.has(storageKey)) {
    return inMemoryCache.get(storageKey) as T;
  }

  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;

  const decrypted = await decryptDataAsync<T>(raw);
  if (decrypted !== null) {
    inMemoryCache.set(storageKey, decrypted);
    // Upgrade legacy formats (s256:, sync:, raw:, or plain JSON) to real AES-256-GCM;
    // NEVER overwrite/downgrade true AES-256-GCM ciphertext.
    if (!isTrueAesGcmCiphertext(raw)) {
      await secureSetItemAsync(storageKey, decrypted);
    }
    return decrypted;
  }
  return null;
}

/**
 * Removes an item from both the in-memory decryption cache and localStorage.
 */
export function secureRemoveItem(storageKey: string): void {
  keyWriteSeq.set(storageKey, (keyWriteSeq.get(storageKey) || 0) + 1);
  const pendingTimer = debouncedPersistTimers.get(storageKey);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    debouncedPersistTimers.delete(storageKey);
  }
  inMemoryCache.delete(storageKey);
  pendingAsyncWrites.delete(storageKey);
  pendingAsyncWriteOutcomes.delete(storageKey);
  failedAsyncWriteKeys.delete(storageKey);
  lastCommittedCiphertext.delete(storageKey);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(storageKey);
    } catch {}
  }
}

/**
 * Clears in-memory decryption caches and cached Web Crypto key so restored backups
 * immediately read from the updated localStorage values and key store.
 */
export function clearCryptoStorageCache(): void {
  cryptoStorageEpoch++;
  for (const timer of debouncedPersistTimers.values()) {
    clearTimeout(timer);
  }
  debouncedPersistTimers.clear();
  inMemoryCache.clear();
  pendingAsyncWrites.clear();
  pendingAsyncWriteOutcomes.clear();
  failedAsyncWriteKeys.clear();
  lastCommittedCiphertext.clear();
  keyWriteSeq.clear();
  cachedCryptoKey = null;
  initPromise = null;
}

/**
 * Purges the in-memory cache and all isolated key custody material (Electron DPAPI key,
 * IndexedDB CryptoKey, and any legacy localStorage seed).
 */
export function purgeCryptoSeed(): void {
  clearCryptoStorageCache();
  ephemeralNodeOrFallbackSeed = null;
  legacyMigratedSeedBytes = null;
  legacySeedChecked = false;
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(LEGACY_KEY_STORE_KEY);
    } catch {}
    const bridge = getElectronBridge();
    if (bridge && typeof bridge.purgeMasterKey === 'function') {
      try {
        bridge.purgeMasterKey();
      } catch {}
    }
    void deleteKeyFromIdb();
  }
}

export function getCryptoStorageSecurityInfo(): {
  mode: 'dpapi_aes_gcm' | 'webcrypto_idb_aes_gcm' | 'fallback_stream';
  label: string;
  detail: string;
  hardwareProtected: boolean;
} {
  const bridge = getElectronBridge();
  if (bridge) {
    try {
      const status = bridge.getStatus();
      if (status?.hardwareProtected) {
        return {
          mode: 'dpapi_aes_gcm',
          label: 'OS DPAPI + AES-256-GCM（同步落盘）',
          detail: '由 Electron 主进程通过 Windows DPAPI 封存主密钥并执行真实同步 AES-256-GCM 加密。',
          hardwareProtected: true,
        };
      }
      return {
        mode: 'fallback_stream',
        label: '未启用 AES-256-GCM（系统 DPAPI 不可用，已禁止降级写入）',
        detail: 'Electron 主进程无法启用系统级 safeStorage/DPAPI，系统已禁止明文或弱加密落盘，仅限当前内存会话。',
        hardwareProtected: false,
      };
    } catch {}
  }
  if (hasWebCryptoSubtle()) {
    return {
      mode: 'webcrypto_idb_aes_gcm',
      label: 'WebCrypto AES-256-GCM（异步落盘）',
      detail: '浏览器环境：不可导出 CryptoKey 隔离于 IndexedDB，缓存写入以异步 AES-256-GCM 队列落盘。',
      hardwareProtected: false,
    };
  }
  return {
    mode: 'fallback_stream',
    label: '未启用 AES-256-GCM（非安全上下文，已禁止降级写入）',
    detail: '当前环境缺少 Electron DPAPI 桥接与 WebCrypto 安全上下文，系统已禁止降级加密落盘，仅保留当前内存会话。',
    hardwareProtected: false,
  };
}
