/**
 * 灵犀语境 (LingXi Context) Cloudflare Worker 云端认证与卡密授权中心
 *
 * 核心商业规则：
 * 1. 卡密激活：支持 3 天试用卡密 (trial_3d) 与 30 天包月卡密 (monthly_30d)，一卡一账号。
 * 2. 单机绑定：一个会员账号仅绑定一台电脑设备指纹 (LX-DEV-...)，换机登录返回 403 DEVICE_MISMATCH。
 * 3. 到期拦截：卡密到期后返回 401 VIP_EXPIRED，需输入新卡密调用 /api/auth/redeem 续费激活。
 * 4. 账户额度：单机默认授权最多登录 20 个 Telegram 账户 (maxAccounts: 20)。
 * 5. 非对称签名：使用 Cloudflare Secret JWT_PRIVATE_KEY (RSA-2048 PKCS8) 签发 RS256 JWT，
 *    客户端仅内置对应的公钥，无法伪造会员与到期时间。
 *
 * 环境变量 (wrangler.toml / Cloudflare Dashboard):
 * - 数据库二选一：
 *   1) Turso (推荐): Secret TURSO_DATABASE_URL (libsql://... 或 https://...) + TURSO_AUTH_TOKEN
 *   2) Cloudflare D1: Binding DB
 * - Secret: JWT_PRIVATE_KEY (-----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----)
 * - Secret: JWT_PUBLIC_KEY (可选；与 JWT_PRIVATE_KEY 配对的 SPKI 公钥)
 * - Secret: ADMIN_SECRET (用于管理员批量生成卡密、设备解绑与管理 Telegram API 池)
 * - Secret (可选兜底): TELEGRAM_API_POOL (JSON数组) 或 TELEGRAM_API_ID + TELEGRAM_API_HASH
 * - Variable / Secret (云端大脑隐形转发): BRAIN_UPSTREAM_URL (例如 https://xxx.up.railway.app，仅保存在 Cloudflare 后台，客户端 .exe 不感知)
 * - Secret (可选，云端大脑鉴权密钥): BRAIN_UPSTREAM_KEY (例如 lx-sk-...；若配置，Worker 验证会员 JWT 后会自动向知识库服务器注入该密钥)
 */

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all?<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta: { changes?: number } }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface Env {
  DB?: D1Database;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  JWT_PRIVATE_KEY: string;
  JWT_PUBLIC_KEY?: string;
  ADMIN_SECRET: string;
  TELEGRAM_API_POOL?: string;
  TELEGRAM_API_ID?: string;
  TELEGRAM_API_HASH?: string;
  BRAIN_UPSTREAM_URL?: string;
  KNOWLEDGE_SERVER_URL?: string;
  RAILWAY_BRAIN_URL?: string;
  BRAIN_UPSTREAM_KEY?: string;
  ENGINE_LICENSE_KEYS?: string;
  ALLOWED_ENGINE_KEYS?: string;
  ALLOWED_ORIGINS?: string;
}

const DEFAULT_JWT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0s5gFU5TfCr7mbuuC/96
EJJnEbuAC5Vw4+vqrXZrvvmiUZAAlULHV5kP6OFEJI3wXOGKAV5cqGezcYFT/P3m
I2mBLGqc0JHjCQZALb/GGluyCc1cmOiKbWDHgwFCd3fuCao0oborg7lzhg/Zy962
zKLUy9eFI5vyAwbYDbXiCNGbnJX6qeoZDJ6HyKC2kt1AOGj3UpNElh73dUnjsNlv
8ryJLqfq9IR6Xej8TDj2lxibCW3uUDCtb8UPQToweiHphflSc6v9ppNXM3l0rfZI
EYvpYe7IaRgd6AZJOMapvz7dY8ZoiqdgqUr33NxliQdDaUYakRDna+Fz+pt2cwgh
UwIDAQAB
-----END PUBLIC KEY-----`;

const MAX_ACCOUNTS_PER_DEVICE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const BASE_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Admin-Secret, X-Client-Brand, X-Engine-Key, X-Engine-License, X-License-Key, x-api-key, X-User-JWT',
};

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function resolveAllowedEngineKeys(env: Env): string[] {
  const keys: string[] = [];
  const rawList = [env.ENGINE_LICENSE_KEYS, env.ALLOWED_ENGINE_KEYS].filter(Boolean).join(',');
  for (const entry of rawList.split(',')) {
    const trimmed = entry.trim();
    if (trimmed && !keys.includes(trimmed)) keys.push(trimmed);
  }
  const masterKey = (env.BRAIN_UPSTREAM_KEY || '').trim();
  if (masterKey && !keys.includes(masterKey)) {
    keys.push(masterKey);
  }
  return keys;
}

function resolveCorsHeaders(request: Request, env: Env, path: string): Record<string, string> {
  const originHeader = (request.headers.get('Origin') || '').trim();
  if (!originHeader) {
    return { ...BASE_CORS_HEADERS };
  }
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(originHeader);
  } catch {
    return { Vary: 'Origin' };
  }
  if (
    (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') ||
    parsedOrigin.username ||
    parsedOrigin.password
  ) {
    return { Vary: 'Origin' };
  }
  const normalizedOrigin = parsedOrigin.origin;
  const allowedList = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let isAllowed = allowedList.some((entry) => {
    try {
      const u = new URL(entry);
      return (
        (u.protocol === 'http:' || u.protocol === 'https:') &&
        u.origin.toLowerCase() === normalizedOrigin.toLowerCase()
      );
    } catch {
      return false;
    }
  });
  if (!isAllowed && !path.startsWith('/api/admin/')) {
    const host = parsedOrigin.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      isAllowed = true;
    }
  }
  if (!isAllowed) {
    return { Vary: 'Origin' };
  }
  return {
    ...BASE_CORS_HEADERS,
    'Access-Control-Allow-Origin': normalizedOrigin,
    Vary: 'Origin',
  };
}

function applyCorsHeaders(response: Response, request: Request, env: Env, path: string): Response {
  const corsHeaders = resolveCorsHeaders(request, env, path);
  const nextHeaders = new Headers(response.headers);
  nextHeaders.delete('Access-Control-Allow-Origin');
  nextHeaders.delete('Access-Control-Allow-Methods');
  nextHeaders.delete('Access-Control-Allow-Headers');
  for (const [k, v] of Object.entries(corsHeaders)) {
    nextHeaders.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    headers: nextHeaders,
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...BASE_CORS_HEADERS,
    },
  });
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeString(str: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, '\n');
  const b64 = normalized
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function hashPassword(password: string, existingSaltHex?: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = existingSaltHex
    ? new Uint8Array(existingSaltHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const recomputed = await hashPassword(password, parts[1]);
  if (recomputed.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < recomputed.length; i++) {
    diff |= recomputed.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return diff === 0;
}

async function signRs256Jwt(payload: Record<string, unknown>, privateKeyPem: string): Promise<string> {
  const keyData = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const header = base64UrlEncodeString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

function buildJwtClaims(user: {
  id: string;
  username: string;
  role: string;
  plan: string;
  vip_expires_at: number;
  bound_device_id: string;
  max_accounts: number;
}) {
  const nowSec = Math.floor(Date.now() / 1000);
  // JWT exp 与会员卡密到期时间同步 (取不超过 31 天的会话窗口，确保本地校验准确拦截)
  const vipExpSec = Math.floor(user.vip_expires_at / 1000);
  const sessionExpSec = Math.min(vipExpSec, nowSec + 31 * 24 * 3600);
  return {
    sub: user.id,
    username: user.username,
    role: user.role || 'member',
    plan: user.plan,
    vipExpiresAt: user.vip_expires_at,
    deviceId: user.bound_device_id,
    maxAccounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE,
    iat: nowSec,
    exp: sessionExpSec,
  };
}

function generateCardCode(plan: 'trial_3d' | 'monthly_30d'): string {
  const prefix = plan === 'trial_3d' ? 'LX3D' : 'LX30D';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let body = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) body += '-';
    body += alphabet[bytes[i] % alphabet.length];
  }
  return `${prefix}-${body}`;
}

function normalizeDeviceId(raw: unknown): string {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val || val.length < 8 || val.length > 128) return '';
  return val;
}

function base64UrlDecodeToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyRs256Jwt(
  token: string,
  publicKeyPem: string
): Promise<{ valid: boolean; payload?: Record<string, any>; error?: string }> {
  try {
    const parts = token.trim().split('.');
    if (parts.length !== 3) return { valid: false, error: 'Invalid JWT format' };
    const [encodedHeader, encodedPayload, encodedSig] = parts;
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(encodedHeader)));
    if (String(header?.alg || '').toUpperCase() !== 'RS256') {
      return { valid: false, error: 'Unsupported JWT algorithm' };
    }
    const keyData = pemToArrayBuffer(publicKeyPem);
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = base64UrlDecodeToBytes(encodedSig);
    const encodedSigningInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const signingBuf = new ArrayBuffer(encodedSigningInput.byteLength);
    new Uint8Array(signingBuf).set(encodedSigningInput);
    const isValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, signingBuf);
    if (!isValid) return { valid: false, error: 'JWT signature verification failed' };
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(encodedPayload)));
    const expSec = Number(payload?.exp || 0);
    if (!expSec || Date.now() >= expSec * 1000) {
      return { valid: false, error: 'JWT expired' };
    }
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'JWT parse error' };
  }
}

function toTursoHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('libsql://')) return 'https://' + trimmed.slice('libsql://'.length);
  if (trimmed.startsWith('wss://')) return 'https://' + trimmed.slice('wss://'.length);
  if (trimmed.startsWith('ws://')) return 'http://' + trimmed.slice('ws://'.length);
  return trimmed;
}

function encodeTursoArg(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { type: 'null' };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { type: 'integer', value: String(val) };
    return { type: 'float', value: val };
  }
  if (typeof val === 'boolean') return { type: 'integer', value: val ? '1' : '0' };
  return { type: 'text', value: String(val) };
}

function decodeTursoCell(cell: any): unknown {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer') return Number(cell.value);
  if (cell.type === 'float') return Number(cell.value);
  return cell.value ?? null;
}

interface TursoQueryEntry {
  sql: string;
  args: unknown[];
}

function createTursoDatabaseAdapter(tursoUrl: string, authToken?: string): D1Database {
  const endpoint = `${toTursoHttpUrl(tursoUrl)}/v2/pipeline`;

  async function executePipeline(queries: TursoQueryEntry[]) {
    const requests = [
      ...queries.map((q) => ({
        type: 'execute',
        stmt: {
          sql: q.sql,
          args: q.args.map(encodeTursoArg),
        },
      })),
      { type: 'close' },
    ];

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requests }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Turso HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const data = (await res.json()) as any;
    const results = Array.isArray(data?.results) ? data.results : [];
    return queries.map((_, idx) => {
      const item = results[idx];
      if (!item || item.type === 'error') {
        throw new Error(item?.error?.message || 'Turso SQL execution error');
      }
      const result = item.response?.result || {};
      const cols: Array<{ name?: string }> = Array.isArray(result.cols) ? result.cols : [];
      const rawRows: any[][] = Array.isArray(result.rows) ? result.rows : [];
      const rows = rawRows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let c = 0; c < cols.length; c++) {
          const colName = cols[c]?.name || `col_${c}`;
          obj[colName] = decodeTursoCell(row[c]);
        }
        return obj;
      });
      return {
        rows,
        changes: Number(result.affected_row_count ?? 0),
      };
    });
  }

  class TursoPreparedStatement implements D1PreparedStatement {
    sql: string;
    params: unknown[];
    constructor(sql: string, params: unknown[] = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...values: unknown[]): D1PreparedStatement {
      return new TursoPreparedStatement(this.sql, values);
    }
    async first<T = unknown>(colName?: string): Promise<T | null> {
      const [res] = await executePipeline([{ sql: this.sql, args: this.params }]);
      const row = res?.rows?.[0];
      if (!row) return null;
      if (colName) return (row[colName] as T) ?? null;
      return row as T;
    }
    async all<T = unknown>(): Promise<{ results: T[] }> {
      const [res] = await executePipeline([{ sql: this.sql, args: this.params }]);
      return { results: (res?.rows || []) as T[] };
    }
    async run(): Promise<{ success: boolean; meta: { changes?: number } }> {
      const [res] = await executePipeline([{ sql: this.sql, args: this.params }]);
      return { success: true, meta: { changes: res?.changes ?? 0 } };
    }
  }

  return {
    prepare(query: string): D1PreparedStatement {
      return new TursoPreparedStatement(query);
    },
    async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
      const entries = statements.map((s) => {
        const ts = s as TursoPreparedStatement;
        return { sql: ts.sql, args: ts.params || [] };
      });
      return await executePipeline(entries);
    },
  };
}

function resolveWorkerDb(env: Env): D1Database {
  if (env.TURSO_DATABASE_URL && env.TURSO_DATABASE_URL.trim()) {
    return createTursoDatabaseAdapter(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  }
  if (env.DB) {
    return env.DB;
  }
  throw new Error('未配置数据库：请配置 TURSO_DATABASE_URL + TURSO_AUTH_TOKEN 或绑定 Cloudflare D1 (DB)');
}

function maskApiHash(hash: string): string {
  const clean = String(hash || '').trim();
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}

function parseEnvTelegramApiPool(env: Env): Array<{ id: string; api_id: number; api_hash: string; label: string }> {
  const items: Array<{ id: string; api_id: number; api_hash: string; label: string }> = [];
  if (env.TELEGRAM_API_POOL) {
    try {
      const parsed = JSON.parse(env.TELEGRAM_API_POOL);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: any, idx: number) => {
          const idNum = Number(item?.apiId ?? item?.api_id);
          const hashStr = String(item?.apiHash ?? item?.api_hash ?? '').trim();
          if (Number.isInteger(idNum) && idNum > 0 && hashStr) {
            items.push({
              id: String(item?.id || `env_pool_${idx}`),
              api_id: idNum,
              api_hash: hashStr,
              label: String(item?.label || `cloud-env-${idx + 1}`),
            });
          }
        });
      }
    } catch {}
  }
  if (items.length === 0 && env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH) {
    const idNum = Number(env.TELEGRAM_API_ID);
    const hashStr = env.TELEGRAM_API_HASH.trim();
    if (Number.isInteger(idNum) && idNum > 0 && hashStr) {
      items.push({
        id: 'env_default',
        api_id: idNum,
        api_hash: hashStr,
        label: 'cloud-secret-default',
      });
    }
  }
  return items;
}

function isCloudBrainProxyPath(path: string): boolean {
  return (
    path === '/v1' ||
    path.startsWith('/v1/') ||
    path === '/api/knowledge' ||
    path.startsWith('/api/knowledge/') ||
    path === '/api/v1' ||
    path.startsWith('/api/v1/') ||
    path === '/api/brain/health'
  );
}

async function forwardToKnowledgeBrain(request: Request, env: Env, url: URL): Promise<Response> {
  const rawUpstream = (env.BRAIN_UPSTREAM_URL || env.KNOWLEDGE_SERVER_URL || env.RAILWAY_BRAIN_URL || '').trim();
  if (!rawUpstream) {
    return jsonResponse(
      {
        ok: false,
        code: 'BRAIN_UPSTREAM_UNCONFIGURED',
        error: '云端知识库代理尚未配置上游地址，请在 Cloudflare Worker 环境变量中设置 BRAIN_UPSTREAM_URL',
      },
      503
    );
  }

  let upstreamBase = rawUpstream.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(upstreamBase)) {
    upstreamBase = `https://${upstreamBase}`;
  }

  // 在 Cloudflare 边缘节点先行完成身份核验，未授权请求直接拦截，不穿透到后端知识库
  const adminSecret = (request.headers.get('X-Admin-Secret') || '').trim();
  const engineKey = (
    request.headers.get('X-Engine-License') ||
    request.headers.get('X-License-Key') ||
    request.headers.get('X-Engine-Key') ||
    request.headers.get('x-api-key') ||
    ''
  ).trim();
  const explicitUserJwt = (request.headers.get('X-User-JWT') || '').trim();
  const authHeader = (request.headers.get('Authorization') || '').trim();
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch?.[1]?.trim() || '';

  let edgeAuthenticated = false;
  let authenticatedByAdmin = false;
  let verifiedUserJwt = '';

  if (adminSecret) {
    if (!env.ADMIN_SECRET || !constantTimeEqual(adminSecret, env.ADMIN_SECRET)) {
      return jsonResponse({ ok: false, code: 'UNAUTHORIZED_ADMIN', error: 'Unauthorized admin request' }, 401);
    }
    edgeAuthenticated = true;
    authenticatedByAdmin = true;
  } else {
    const jwtCandidate = explicitUserJwt || (bearerToken.split('.').length === 3 ? bearerToken : '');
    if (jwtCandidate) {
      const verifyRes = await verifyRs256Jwt(jwtCandidate, env.JWT_PUBLIC_KEY || DEFAULT_JWT_PUBLIC_KEY);
      if (!verifyRes.valid || !verifyRes.payload) {
        return jsonResponse(
          { ok: false, code: 'INVALID_TOKEN', error: verifyRes.error || '会员令牌验签失败或已过期' },
          401
        );
      }
      const vipExpiresAt = Number(verifyRes.payload.vipExpiresAt || 0);
      if (vipExpiresAt > 0 && vipExpiresAt <= Date.now()) {
        return jsonResponse(
          { ok: false, code: 'VIP_EXPIRED', error: '会员卡密已到期，请续费后继续使用云端大脑' },
          401
        );
      }
      edgeAuthenticated = true;
      verifiedUserJwt = jwtCandidate;
    } else {
      const engineCandidate = engineKey || bearerToken;
      if (!engineCandidate) {
        return jsonResponse(
          { ok: false, code: 'MISSING_AUTH', error: '缺少有效的会员 RS256 令牌或引擎授权密钥' },
          401
        );
      }
      const allowedEngineKeys = resolveAllowedEngineKeys(env);
      const matchedEngineKey = allowedEngineKeys.some((k) => constantTimeEqual(engineCandidate, k));
      if (!matchedEngineKey) {
        return jsonResponse(
          {
            ok: false,
            code: engineKey ? 'INVALID_ENGINE_KEY' : 'INVALID_TOKEN',
            error: engineKey ? '无效的引擎授权密钥' : '无效的认证令牌格式或未授权密钥',
          },
          401
        );
      }
      edgeAuthenticated = true;
    }
  }

  const upstreamPath = url.pathname === '/api/brain/health' ? '/health' : url.pathname;
  const targetUrl = `${upstreamBase}${upstreamPath}${url.search}`;

  const upstreamHeaders = new Headers();
  const forwardHeaderNames = [
    'Content-Type',
    'Accept',
    'Authorization',
    'X-User-JWT',
    'X-Engine-Key',
    'X-Engine-License',
    'X-License-Key',
    'x-api-key',
    'X-Client-Brand',
    'X-Admin-Secret',
  ];
  for (const name of forwardHeaderNames) {
    const val = request.headers.get(name);
    if (val) upstreamHeaders.set(name, val);
  }

  if (!authenticatedByAdmin) {
    upstreamHeaders.delete('X-Admin-Secret');
  }
  if (!verifiedUserJwt) {
    upstreamHeaders.delete('X-User-JWT');
  }
  if (verifiedUserJwt && !upstreamHeaders.has('X-User-JWT')) {
    upstreamHeaders.set('X-User-JWT', verifiedUserJwt);
  }

  // 仅当请求在 Cloudflare 边缘节点已通过会员 RS256 JWT 或 ADMIN_SECRET 校验时，才注入上游服务密钥
  const masterEngineKey = (env.BRAIN_UPSTREAM_KEY || '').trim();
  if (edgeAuthenticated && masterEngineKey) {
    upstreamHeaders.set('Authorization', `Bearer ${masterEngineKey}`);
    upstreamHeaders.set('X-Engine-License', masterEngineKey);
    upstreamHeaders.set('X-License-Key', masterEngineKey);
    upstreamHeaders.set('X-Engine-Key', masterEngineKey);
    upstreamHeaders.set('x-api-key', masterEngineKey);
  }

  try {
    const bodyBuffer =
      request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : undefined;

    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: bodyBuffer,
      redirect: 'follow',
    });

    const respHeaders = new Headers(BASE_CORS_HEADERS);
    respHeaders.set('Content-Type', upstreamRes.headers.get('Content-Type') || 'application/json; charset=utf-8');

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: respHeaders,
    });
  } catch {
    // 严禁在错误信息中泄露上游知识库真实域名
    return jsonResponse(
      { ok: false, code: 'BRAIN_UPSTREAM_UNREACHABLE', error: '云端知识库服务暂时不可达，请稍后重试' },
      502
    );
  }
}

async function handleWorkerRequest(request: Request, env: Env, url: URL): Promise<Response> {
    const path = url.pathname;

    if (request.method === 'GET' && (path === '/' || path === '/health')) {
      const brainProxyConfigured = Boolean(
        (env.BRAIN_UPSTREAM_URL || env.KNOWLEDGE_SERVER_URL || env.RAILWAY_BRAIN_URL || '').trim()
      );
      return jsonResponse({
        ok: true,
        service: 'lingxi-auth-worker',
        status: 'running',
        dbMode: env.TURSO_DATABASE_URL ? 'turso' : env.DB ? 'd1' : 'unconfigured',
        brainProxyConfigured,
        maxAccounts: MAX_ACCOUNTS_PER_DEVICE,
        endpoints: [
          '/health',
          '/api/auth/register',
          '/api/auth/login',
          '/api/auth/redeem',
          '/api/auth/telegram-credentials',
          '/api/admin/cards/generate',
          '/api/admin/unbind-device',
          '/api/admin/telegram-pool',
          '/v1/chat/completions',
          '/api/knowledge/search',
          '/api/v1/evolution/sync',
          '/api/v1/training/feedback',
        ],
      });
    }

    // 隐形反向代理：将所有云端知识库 / 大模型请求暗中转发给后台知识库服务器（.exe 不感知真实域名）
    if (isCloudBrainProxyPath(path)) {
      return await forwardToKnowledgeBrain(request, env, url);
    }

    if (!env.JWT_PRIVATE_KEY) {
      return jsonResponse({ ok: false, error: '服务端未配置 JWT_PRIVATE_KEY' }, 500);
    }

    const db = resolveWorkerDb(env);

    try {
      // 1. 卡密注册 (一卡一账号 + 单机首次绑定)
      if (request.method === 'POST' && path === '/api/auth/register') {
        const body = (await request.json().catch(() => ({}))) as any;
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const cardKey = String(body.cardKey || '').trim().toUpperCase();
        const deviceId = normalizeDeviceId(body.deviceId);

        if (!username || username.length < 3 || username.length > 64) {
          return jsonResponse({ ok: false, error: '会员账号长度需在 3-64 个字符之间' }, 400);
        }
        if (!password || password.length < 6) {
          return jsonResponse({ ok: false, error: '登录密码至少 6 位' }, 400);
        }
        if (!cardKey) {
          return jsonResponse({ ok: false, error: '请输入有效的授权卡密（支持 3 天试用卡或 30 天包月卡）' }, 400);
        }
        if (!deviceId) {
          return jsonResponse({ ok: false, error: '缺少当前电脑设备指纹 (deviceId)，请在灵犀语境桌面端内注册' }, 400);
        }

        const existingUser = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
        if (existingUser) {
          return jsonResponse({ ok: false, error: '该会员账号已存在，请直接登录或使用“卡密续费”' }, 409);
        }

        const cardRow = await db.prepare(
          'SELECT code, plan, duration_days, status FROM card_keys WHERE code = ?'
        )
          .bind(cardKey)
          .first<{ code: string; plan: string; duration_days: number; status: string }>();

        if (!cardRow) {
          return jsonResponse({ ok: false, code: 'INVALID_CARD', error: '卡密不存在，请检查是否输入有误' }, 400);
        }
        if (cardRow.status !== 'unused') {
          return jsonResponse({ ok: false, code: 'CARD_ALREADY_USED', error: '该卡密已被使用或已作废（一卡仅限一个会员账户）' }, 409);
        }

        const now = Date.now();
        const userId = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const passwordHash = await hashPassword(password);
        const durationDays = Number(cardRow.duration_days) || (cardRow.plan === 'trial_3d' ? 3 : 30);
        const vipExpiresAt = now + durationDays * DAY_MS;

        // 原子占卡（先不写 used_by_user_id，避免 users 尚未插入前触发 SQLite 外键约束失败）
        const consumeRes = await db.prepare(
          `UPDATE card_keys
           SET status = 'used', used_by_username = ?, used_at = ?
           WHERE code = ? AND status = 'unused'`
        )
          .bind(username, now, cardRow.code)
          .run();

        if (!consumeRes.meta.changes || consumeRes.meta.changes < 1) {
          return jsonResponse({ ok: false, code: 'CARD_ALREADY_USED', error: '该卡密已被其他请求占用' }, 409);
        }

        try {
          await db.prepare(
            `INSERT INTO users (id, username, password_hash, role, plan, vip_expires_at, bound_device_id, max_accounts, created_at, updated_at)
             VALUES (?, ?, ?, 'member', ?, ?, ?, ?, ?, ?)`
          )
            .bind(userId, username, passwordHash, cardRow.plan, vipExpiresAt, deviceId, MAX_ACCOUNTS_PER_DEVICE, now, now)
            .run();

          // 用户记录写入成功后再关联外键 used_by_user_id
          await db.prepare(
            `UPDATE card_keys SET used_by_user_id = ? WHERE code = ?`
          )
            .bind(userId, cardRow.code)
            .run();
        } catch (insertErr) {
          // 回滚卡密状态与用户记录
          await db.prepare(
            `UPDATE card_keys SET status = 'unused', used_by_user_id = NULL, used_by_username = NULL, used_at = NULL WHERE code = ?`
          )
            .bind(cardRow.code)
            .run();
          await db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run().catch(() => {});
          throw insertErr;
        }

        await db.prepare(
          `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
           VALUES (?, ?, 'register', ?, ?, ?, ?)`
        )
          .bind(crypto.randomUUID(), username, deviceId, cardRow.code, `plan=${cardRow.plan},days=${durationDays}`, now)
          .run();

        const userRecord = {
          id: userId,
          username,
          role: 'member',
          plan: cardRow.plan,
          vipExpiresAt,
          boundDeviceId: deviceId,
          maxAccounts: MAX_ACCOUNTS_PER_DEVICE,
        };

        const token = await signRs256Jwt(
          buildJwtClaims({
            id: userId,
            username,
            role: 'member',
            plan: cardRow.plan,
            vip_expires_at: vipExpiresAt,
            bound_device_id: deviceId,
            max_accounts: MAX_ACCOUNTS_PER_DEVICE,
          }),
          env.JWT_PRIVATE_KEY
        );

        return jsonResponse({ ok: true, token, user: userRecord });
      }

      // 2. 会员登录 (严格校验单机绑定 + 卡密到期时间)
      if (request.method === 'POST' && path === '/api/auth/login') {
        const body = (await request.json().catch(() => ({}))) as any;
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const deviceId = normalizeDeviceId(body.deviceId);

        if (!username || !password) {
          return jsonResponse({ ok: false, error: '请输入会员账号和密码' }, 400);
        }
        if (!deviceId) {
          return jsonResponse({ ok: false, error: '缺少电脑设备指纹 (deviceId)，请在桌面客户端内登录' }, 400);
        }

        const user = await db.prepare(
          'SELECT id, username, password_hash, role, plan, vip_expires_at, bound_device_id, max_accounts FROM users WHERE username = ?'
        )
          .bind(username)
          .first<{
            id: string;
            username: string;
            password_hash: string;
            role: string;
            plan: string;
            vip_expires_at: number;
            bound_device_id: string | null;
            max_accounts: number;
          }>();

        if (!user || !(await verifyPassword(password, user.password_hash))) {
          return jsonResponse({ ok: false, code: 'INVALID_CREDENTIALS', error: '会员账号或密码错误' }, 401);
        }

        const now = Date.now();
        let activeBoundDevice = user.bound_device_id;

        if (!activeBoundDevice) {
          // 管理员解绑后首次登录自动绑定当前新电脑
          await db.prepare('UPDATE users SET bound_device_id = ?, updated_at = ? WHERE id = ?')
            .bind(deviceId, now, user.id)
            .run();
          activeBoundDevice = deviceId;
        } else if (activeBoundDevice !== deviceId) {
          return jsonResponse(
            {
              ok: false,
              code: 'DEVICE_MISMATCH',
              error: '该会员账户已绑定另一台电脑，不支持多机同时登录。如需换机请联系客服解绑设备。',
            },
            403
          );
        }

        if (!user.vip_expires_at || user.vip_expires_at <= now) {
          return jsonResponse(
            {
              ok: false,
              code: 'VIP_EXPIRED',
              error: '您的卡密授权已到期，请切换到“卡密续费”输入新卡密即可延长使用时间。',
            },
            401
          );
        }

        await db.prepare(
          `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
           VALUES (?, ?, 'login', ?, NULL, ?, ?)`
        )
          .bind(crypto.randomUUID(), username, deviceId, `plan=${user.plan}`, now)
          .run();

        const token = await signRs256Jwt(
          buildJwtClaims({
            id: user.id,
            username: user.username,
            role: user.role,
            plan: user.plan,
            vip_expires_at: user.vip_expires_at,
            bound_device_id: activeBoundDevice,
            max_accounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE,
          }),
          env.JWT_PRIVATE_KEY
        );

        return jsonResponse({
          ok: true,
          token,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            plan: user.plan,
            vipExpiresAt: user.vip_expires_at,
            boundDeviceId: activeBoundDevice,
            maxAccounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE,
          },
        });
      }

      // 3. 卡密续费激活 (同机校验 + 顺延到期时间)
      if (request.method === 'POST' && path === '/api/auth/redeem') {
        const body = (await request.json().catch(() => ({}))) as any;
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const cardKey = String(body.cardKey || '').trim().toUpperCase();
        const deviceId = normalizeDeviceId(body.deviceId);

        if (!username || !cardKey) {
          return jsonResponse({ ok: false, error: '请输入会员账号与新卡密' }, 400);
        }
        if (!deviceId) {
          return jsonResponse({ ok: false, error: '缺少设备指纹 (deviceId)' }, 400);
        }

        const user = await db.prepare(
          'SELECT id, username, password_hash, role, plan, vip_expires_at, bound_device_id, max_accounts FROM users WHERE username = ?'
        )
          .bind(username)
          .first<{
            id: string;
            username: string;
            password_hash: string;
            role: string;
            plan: string;
            vip_expires_at: number;
            bound_device_id: string | null;
            max_accounts: number;
          }>();

        if (!user) {
          return jsonResponse({ ok: false, error: '会员账号不存在' }, 404);
        }
        if (password && !(await verifyPassword(password, user.password_hash))) {
          return jsonResponse({ ok: false, error: '会员密码校验失败' }, 401);
        }

        if (user.bound_device_id && user.bound_device_id !== deviceId) {
          return jsonResponse(
            {
              ok: false,
              code: 'DEVICE_MISMATCH',
              error: '该会员账户已绑定其他电脑，无法在当前电脑续费激活。',
            },
            403
          );
        }

        const cardRow = await db.prepare(
          'SELECT code, plan, duration_days, status FROM card_keys WHERE code = ?'
        )
          .bind(cardKey)
          .first<{ code: string; plan: string; duration_days: number; status: string }>();

        if (!cardRow || cardRow.status !== 'unused') {
          return jsonResponse({ ok: false, code: 'INVALID_CARD', error: '卡密无效或已被使用' }, 400);
        }

        const now = Date.now();
        const durationDays = Number(cardRow.duration_days) || (cardRow.plan === 'trial_3d' ? 3 : 30);
        const baseTime = Math.max(now, user.vip_expires_at || 0);
        const newExpiresAt = baseTime + durationDays * DAY_MS;
        const boundDevice = user.bound_device_id || deviceId;

        const consumeRes = await db.prepare(
          `UPDATE card_keys
           SET status = 'used', used_by_user_id = ?, used_by_username = ?, used_at = ?
           WHERE code = ? AND status = 'unused'`
        )
          .bind(user.id, user.username, now, cardRow.code)
          .run();

        if (!consumeRes.meta.changes || consumeRes.meta.changes < 1) {
          return jsonResponse({ ok: false, code: 'CARD_ALREADY_USED', error: '该卡密已被占用' }, 409);
        }

        await db.prepare(
          'UPDATE users SET plan = ?, vip_expires_at = ?, bound_device_id = ?, updated_at = ? WHERE id = ?'
        )
          .bind(cardRow.plan, newExpiresAt, boundDevice, now, user.id)
          .run();

        await db.prepare(
          `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
           VALUES (?, ?, 'redeem', ?, ?, ?, ?)`
        )
          .bind(crypto.randomUUID(), user.username, deviceId, cardRow.code, `extendedDays=${durationDays}`, now)
          .run();

        const token = await signRs256Jwt(
          buildJwtClaims({
            id: user.id,
            username: user.username,
            role: user.role,
            plan: cardRow.plan,
            vip_expires_at: newExpiresAt,
            bound_device_id: boundDevice,
            max_accounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE,
          }),
          env.JWT_PRIVATE_KEY
        );

        return jsonResponse({
          ok: true,
          token,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            plan: cardRow.plan,
            vipExpiresAt: newExpiresAt,
            boundDeviceId: boundDevice,
            maxAccounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE,
          },
        });
      }

      // 4. 管理员批量制卡接口
      if (request.method === 'POST' && path === '/api/admin/cards/generate') {
        const adminSecret = request.headers.get('X-Admin-Secret') || '';
        if (!env.ADMIN_SECRET || !constantTimeEqual(adminSecret, env.ADMIN_SECRET)) {
          return jsonResponse({ ok: false, error: 'Unauthorized admin request' }, 401);
        }

        const body = (await request.json().catch(() => ({}))) as any;
        const plan = body.plan === 'trial_3d' ? 'trial_3d' : 'monthly_30d';
        const durationDays = plan === 'trial_3d' ? 3 : 30;
        const count = Math.min(Math.max(Number(body.count) || 10, 1), 200);
        const batchId = String(body.batchId || `batch_${Date.now()}`);
        const now = Date.now();

        const codes: string[] = [];
        const stmt = db.prepare(
          `INSERT INTO card_keys (code, plan, duration_days, status, batch_id, created_at)
           VALUES (?, ?, ?, 'unused', ?, ?)`
        );

        const batchStmts: D1PreparedStatement[] = [];
        for (let i = 0; i < count; i++) {
          const code = generateCardCode(plan);
          codes.push(code);
          batchStmts.push(stmt.bind(code, plan, durationDays, batchId, now));
        }

        await db.batch(batchStmts);
        return jsonResponse({ ok: true, plan, durationDays, batchId, count: codes.length, codes });
      }

      // 5. 管理员换机解绑接口
      if (request.method === 'POST' && path === '/api/admin/unbind-device') {
        const adminSecret = request.headers.get('X-Admin-Secret') || '';
        if (!env.ADMIN_SECRET || !constantTimeEqual(adminSecret, env.ADMIN_SECRET)) {
          return jsonResponse({ ok: false, error: 'Unauthorized admin request' }, 401);
        }

        const body = (await request.json().catch(() => ({}))) as any;
        const username = String(body.username || '').trim();
        if (!username) {
          return jsonResponse({ ok: false, error: '请提供要解绑的会员账号 username' }, 400);
        }

        const now = Date.now();
        const updateRes = await db.prepare(
          'UPDATE users SET bound_device_id = NULL, updated_at = ? WHERE username = ?'
        )
          .bind(now, username)
          .run();

        if (!updateRes.meta.changes) {
          return jsonResponse({ ok: false, error: '未找到该会员账号' }, 404);
        }

        await db.prepare(
          `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
           VALUES (?, ?, 'unbind_device', NULL, NULL, 'admin_reset', ?)`
        )
          .bind(crypto.randomUUID(), username, now)
          .run();

        return jsonResponse({ ok: true, message: `已清空 ${username} 的旧电脑绑定，下次登录将自动绑定新电脑` });
      }

      // 6. 模式 B：正版会员按设备动态领取 Telegram API 凭据 (RS256 验签 + 卡密有效期校验 + 单机绑定校验)
      if (request.method === 'POST' && path === '/api/auth/telegram-credentials') {
        const authHeader = request.headers.get('Authorization') || '';
        const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
        const token = tokenMatch?.[1]?.trim() || '';
        if (!token) {
          return jsonResponse({ ok: false, code: 'MISSING_TOKEN', error: '缺少会员 Bearer 令牌' }, 401);
        }

        const verifyRes = await verifyRs256Jwt(token, env.JWT_PUBLIC_KEY || DEFAULT_JWT_PUBLIC_KEY);
        if (!verifyRes.valid || !verifyRes.payload) {
          return jsonResponse({ ok: false, code: 'INVALID_TOKEN', error: verifyRes.error || '会员令牌验签失败' }, 401);
        }

        const body = (await request.json().catch(() => ({}))) as any;
        const deviceId = normalizeDeviceId(body.deviceId || verifyRes.payload.deviceId);
        const userId = String(verifyRes.payload.sub || '');

        const user = await db
          .prepare('SELECT id, username, vip_expires_at, bound_device_id FROM users WHERE id = ?')
          .bind(userId)
          .first<{ id: string; username: string; vip_expires_at: number; bound_device_id: string | null }>();

        if (!user) {
          return jsonResponse({ ok: false, code: 'USER_NOT_FOUND', error: '会员账号不存在' }, 401);
        }
        if (user.bound_device_id && deviceId && user.bound_device_id !== deviceId) {
          return jsonResponse({ ok: false, code: 'DEVICE_MISMATCH', error: '当前电脑与绑定设备不一致' }, 403);
        }
        const now = Date.now();
        if (!user.vip_expires_at || user.vip_expires_at <= now) {
          return jsonResponse({ ok: false, code: 'VIP_EXPIRED', error: '会员卡密已到期，请续费后领取凭据' }, 401);
        }

        // 优先查询 Turso/D1 中是否已为该会员绑定了池内凭据且仍处于激活状态（兼容网页后台手动改 0/1 或字符串）
        let assignedPool: { id: string; api_id: number; api_hash: string; label?: string } | null = null;
        try {
          assignedPool = await db
            .prepare(
              `SELECT p.id, p.api_id, p.api_hash, p.label
               FROM user_api_assignments ua
               JOIN telegram_api_pool p ON p.id = ua.pool_id
               WHERE ua.user_id = ? AND CAST(COALESCE(p.is_active, 1) AS INTEGER) = 1`
            )
            .bind(user.id)
            .first<{ id: string; api_id: number; api_hash: string; label?: string }>();

          if (!assignedPool) {
            const candidateStmt = db.prepare(
              `SELECT p.id, p.api_id, p.api_hash, p.label, COALESCE(p.max_devices, 50) as max_devices, COUNT(ua.user_id) as used_count
               FROM telegram_api_pool p
               LEFT JOIN user_api_assignments ua ON ua.pool_id = p.id
               WHERE CAST(COALESCE(p.is_active, 1) AS INTEGER) = 1
               GROUP BY p.id
               ORDER BY used_count ASC, COALESCE(p.created_at, 0) ASC
               LIMIT 20`
            );
            const candidatesRes = candidateStmt.all
              ? await candidateStmt.all<{
                  id: string;
                  api_id: number;
                  api_hash: string;
                  label?: string;
                  max_devices: number;
                  used_count: number;
                }>()
              : { results: [] };
            const candidates = (candidatesRes.results || []).filter(
              (c) => Number(c.api_id) > 0 && String(c.api_hash || '').trim().length > 0
            );
            const picked =
              candidates.find((c) => Number(c.used_count || 0) < (Number(c.max_devices) || 50)) ||
              candidates[0] ||
              null;

            if (picked) {
              await db
                .prepare(
                  `INSERT INTO user_api_assignments (user_id, pool_id, assigned_at, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET pool_id = excluded.pool_id, updated_at = excluded.updated_at`
                )
                .bind(user.id, picked.id, now, now)
                .run();
              await db
                .prepare(
                  `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
                   VALUES (?, ?, 'assign_api_pool', ?, NULL, ?, ?)`
                )
                .bind(crypto.randomUUID(), user.username, deviceId || null, `pool=${picked.id},apiId=${picked.api_id}`, now)
                .run();
              assignedPool = picked;
            }
          }
        } catch (poolErr: any) {
          // 若管理员暂未在数据库中建池表，继续尝试 Worker Secrets 兜底配置
          console.warn('telegram_api_pool query note:', poolErr?.message);
        }

        if (!assignedPool) {
          const envPool = parseEnvTelegramApiPool(env);
          if (envPool.length > 0) {
            let hashVal = 0;
            for (let i = 0; i < user.id.length; i++) {
              hashVal = (hashVal * 31 + user.id.charCodeAt(i)) >>> 0;
            }
            assignedPool = envPool[hashVal % envPool.length];
          }
        }

        if (!assignedPool) {
          return jsonResponse(
            {
              ok: false,
              code: 'CLOUD_POOL_EMPTY',
              error: '云端暂未配置可下发的启用状态 Telegram API 凭据，请在 Turso telegram_api_pool 表中添加 is_active = 1 的新凭据',
            },
            404
          );
        }

        return jsonResponse({
          ok: true,
          apiId: Number(assignedPool.api_id),
          apiHash: String(assignedPool.api_hash).trim(),
          source: 'cloud_authorized',
          poolLabel: assignedPool.label || assignedPool.id,
          vipExpiresAt: user.vip_expires_at,
        });
      }

      // 7. 管理员管理云端 Telegram API 凭据池 (写入/查询 Turso 或 D1)
      if (path === '/api/admin/telegram-pool') {
        const adminSecret = request.headers.get('X-Admin-Secret') || '';
        if (!env.ADMIN_SECRET || !constantTimeEqual(adminSecret, env.ADMIN_SECRET)) {
          return jsonResponse({ ok: false, error: 'Unauthorized admin request' }, 401);
        }

        if (request.method === 'GET') {
          const listStmt = db.prepare(
            `SELECT p.id, p.api_id, p.api_hash, p.label, COALESCE(p.max_devices, 50) as max_devices,
                    CAST(COALESCE(p.is_active, 1) AS INTEGER) as is_active, p.notes, p.created_at, p.updated_at,
                    COUNT(ua.user_id) as assigned_count
             FROM telegram_api_pool p
             LEFT JOIN user_api_assignments ua ON ua.pool_id = p.id
             GROUP BY p.id
             ORDER BY COALESCE(p.created_at, 0) DESC`
          );
          const rowsRes = listStmt.all ? await listStmt.all<any>() : { results: [] };
          const items = (rowsRes.results || []).map((row) => ({
            id: row.id,
            apiId: Number(row.api_id),
            maskedApiHash: maskApiHash(String(row.api_hash || '')),
            label: row.label || '',
            maxDevices: Number(row.max_devices) || 50,
            assignedCount: Number(row.assigned_count) || 0,
            isActive: Number(row.is_active) === 1,
            notes: row.notes || '',
            updatedAt: Number(row.updated_at) || 0,
          }));
          return jsonResponse({ ok: true, items });
        }

        if (request.method === 'POST') {
          const body = (await request.json().catch(() => ({}))) as any;
          const apiId = Number(body.apiId);
          const apiHash = String(body.apiHash || '').trim();
          const label = String(body.label || `pool-${apiId}`).trim();
          const maxDevices = Math.max(1, Number(body.maxDevices) || 50);
          const isActive = body.isActive === false ? 0 : 1;
          const notes = String(body.notes || '').trim();

          if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
            return jsonResponse({ ok: false, error: '请提供有效的 apiId (正整数) 与 apiHash' }, 400);
          }

          const now = Date.now();
          const id = String(body.id || `tgpool_${apiId}`);
          await db
            .prepare(
              `INSERT INTO telegram_api_pool (id, api_id, api_hash, label, max_devices, is_active, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(api_id) DO UPDATE SET
                 api_hash = excluded.api_hash,
                 label = excluded.label,
                 max_devices = excluded.max_devices,
                 is_active = excluded.is_active,
                 notes = excluded.notes,
                 updated_at = excluded.updated_at`
            )
            .bind(id, apiId, apiHash, label, maxDevices, isActive, notes, now, now)
            .run();

          return jsonResponse({
            ok: true,
            item: {
              id,
              apiId,
              maskedApiHash: maskApiHash(apiHash),
              label,
              maxDevices,
              isActive: isActive === 1,
            },
          });
        }
      }

      return jsonResponse({ ok: false, error: 'Not Found' }, 404);
    } catch (err: any) {
      return jsonResponse({ ok: false, error: err?.message || 'Worker Internal Error' }, 500);
    }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      const corsHeaders = resolveCorsHeaders(request, env, path);
      if (request.headers.get('Origin') && !corsHeaders['Access-Control-Allow-Origin']) {
        return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const response = await handleWorkerRequest(request, env, url);
    return applyCorsHeaders(response, request, env, path);
  },
};
