/**
 * Client-Side Encrypted Desktop Backup Engine
 *
 * Uses Web Crypto API:
 * - KDF: PBKDF2-SHA256 (210,000 iterations, 16-byte random salt, 512-bit derived key)
 *   - Bytes [0..32]: AES-256-GCM encryption key
 *   - Bytes [32..64]: HMAC-SHA256 integrity verification key
 * - Cipher: AES-256-GCM (12-byte random IV, canonical AAD, 128-bit auth tag)
 * - Integrity: HMAC-SHA256 over envelope metadata + ciphertext (constant-time verified)
 *
 * Byte-for-byte compatible with Node.js crypto implementation in server/db.ts.
 */

export const ENCRYPTED_BACKUP_FORMAT = 'humansense_encrypted_backup_v1' as const;
export const ENCRYPTED_BACKUP_VERSION = 'humansense_enc_v4' as const;
export const ENCRYPTED_BACKUP_TYPE = 'HumanSense_Encrypted_Desktop_Backup' as const;
export const ENCRYPTED_BACKUP_AAD = 'HumanSense_Encrypted_Desktop_Backup:v4' as const;
export const BACKUP_KDF_ITERATIONS = 210_000;
export const BACKUP_MIN_PASSPHRASE_LENGTH = 8;

export interface EncryptedBackupEnvelope {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  type: typeof ENCRYPTED_BACKUP_TYPE;
  version: typeof ENCRYPTED_BACKUP_VERSION;
  exportedAt: string;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
  cipher: {
    name: 'AES-GCM';
    iv: string;
    aad: typeof ENCRYPTED_BACKUP_AAD;
  };
  ciphertext: string;
  hmac: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function getSubtleCrypto(): SubtleCrypto {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (!cryptoObj?.subtle) {
    throw new Error('当前环境不支持 Web Crypto 安全加密引擎 (subtle)');
  }
  return cryptoObj.subtle;
}

function buildCanonicalHmacInput(envelope: Omit<EncryptedBackupEnvelope, 'hmac'>): Uint8Array {
  const canonical = [
    envelope.format,
    envelope.version,
    envelope.exportedAt,
    envelope.kdf.name,
    envelope.kdf.hash,
    String(envelope.kdf.iterations),
    envelope.kdf.salt,
    envelope.cipher.name,
    envelope.cipher.iv,
    envelope.cipher.aad,
    envelope.ciphertext,
  ].join('|');
  return new TextEncoder().encode(canonical);
}

async function deriveBackupKeys(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<{ aesKey: CryptoKey; hmacKey: CryptoKey }> {
  const subtle = getSubtleCrypto();
  const passBytes = new TextEncoder().encode(passphrase);
  const baseKey = await subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      iterations,
    },
    baseKey,
    512
  );
  const fullBytes = new Uint8Array(derivedBits);
  const aesBytes = fullBytes.slice(0, 32);
  const hmacBytes = fullBytes.slice(32, 64);

  const [aesKey, hmacKey] = await Promise.all([
    subtle.importKey('raw', aesBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
    subtle.importKey('raw', hmacBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
  ]);

  return { aesKey, hmacKey };
}

export function isEncryptedBackupEnvelope(obj: any): obj is EncryptedBackupEnvelope {
  return Boolean(
    obj &&
      typeof obj === 'object' &&
      obj.format === ENCRYPTED_BACKUP_FORMAT &&
      obj.kdf &&
      typeof obj.kdf === 'object' &&
      obj.cipher &&
      typeof obj.cipher === 'object' &&
      typeof obj.ciphertext === 'string' &&
      typeof obj.hmac === 'string'
  );
}

export async function encryptBackupWithPassphrase(
  payload: unknown,
  passphrase: string
): Promise<EncryptedBackupEnvelope> {
  if (typeof passphrase !== 'string' || passphrase.length < BACKUP_MIN_PASSPHRASE_LENGTH) {
    throw new Error(`备份加密口令至少需要 ${BACKUP_MIN_PASSPHRASE_LENGTH} 个字符`);
  }

  const subtle = getSubtleCrypto();
  const cryptoObj = globalThis.crypto;
  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const exportedAt = new Date().toISOString();

  const { aesKey, hmacKey } = await deriveBackupKeys(passphrase, salt, BACKUP_KDF_ITERATIONS);
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload));
  const aadBytes = new TextEncoder().encode(ENCRYPTED_BACKUP_AAD);

  const encryptedBuf = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      additionalData: aadBytes as unknown as BufferSource,
      tagLength: 128,
    },
    aesKey,
    plaintextBytes as unknown as BufferSource
  );

  const unsignedEnvelope: Omit<EncryptedBackupEnvelope, 'hmac'> = {
    format: ENCRYPTED_BACKUP_FORMAT,
    type: ENCRYPTED_BACKUP_TYPE,
    version: ENCRYPTED_BACKUP_VERSION,
    exportedAt,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: BACKUP_KDF_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: 'AES-GCM',
      iv: bytesToBase64(iv),
      aad: ENCRYPTED_BACKUP_AAD,
    },
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuf)),
  };

  const hmacInput = buildCanonicalHmacInput(unsignedEnvelope);
  const hmacSig = await subtle.sign('HMAC', hmacKey, hmacInput as unknown as BufferSource);

  return {
    ...unsignedEnvelope,
    hmac: bytesToBase64(new Uint8Array(hmacSig)),
  };
}

export async function decryptBackupWithPassphrase<T = any>(
  envelope: unknown,
  passphrase: string
): Promise<T> {
  if (!isEncryptedBackupEnvelope(envelope)) {
    throw new Error('无效的加密备份文件格式');
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('请输入备份解密口令');
  }
  if (
    envelope.kdf.name !== 'PBKDF2' ||
    envelope.kdf.hash !== 'SHA-256' ||
    !Number.isInteger(envelope.kdf.iterations) ||
    envelope.kdf.iterations < 100_000 ||
    envelope.kdf.iterations > 2_000_000 ||
    envelope.cipher.name !== 'AES-GCM' ||
    envelope.cipher.aad !== ENCRYPTED_BACKUP_AAD
  ) {
    throw new Error('不支持或已被篡改的备份加密参数');
  }

  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  let providedHmac: Uint8Array;
  try {
    salt = base64ToBytes(envelope.kdf.salt);
    iv = base64ToBytes(envelope.cipher.iv);
    ciphertext = base64ToBytes(envelope.ciphertext);
    providedHmac = base64ToBytes(envelope.hmac);
  } catch {
    throw new Error('加密备份字段编码损坏');
  }

  if (salt.length < 16 || iv.length !== 12 || ciphertext.length <= 16 || providedHmac.length !== 32) {
    throw new Error('加密备份字段长度非法');
  }

  const subtle = getSubtleCrypto();
  const { aesKey, hmacKey } = await deriveBackupKeys(passphrase, salt, envelope.kdf.iterations);

  const hmacInput = buildCanonicalHmacInput(envelope);
  const expectedHmacBuf = await subtle.sign('HMAC', hmacKey, hmacInput as unknown as BufferSource);
  const expectedHmac = new Uint8Array(expectedHmacBuf);
  if (!constantTimeEqualBytes(providedHmac, expectedHmac)) {
    throw new Error('备份完整性校验失败：口令错误或备份文件已被篡改');
  }

  try {
    const aadBytes = new TextEncoder().encode(envelope.cipher.aad);
    const decryptedBuf = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        additionalData: aadBytes as unknown as BufferSource,
        tagLength: 128,
      },
      aesKey,
      ciphertext as unknown as BufferSource
    );
    const jsonText = new TextDecoder().decode(new Uint8Array(decryptedBuf));
    return JSON.parse(jsonText) as T;
  } catch {
    throw new Error('备份解密失败：口令错误或密文已损坏');
  }
}
