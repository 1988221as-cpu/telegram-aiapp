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
const DAY_MS = 24 * 60 * 60 * 1e3;
const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret, X-Client-Brand, X-Engine-Key, X-Engine-License, X-License-Key, x-api-key, X-User-JWT"
};
function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
function resolveAllowedEngineKeys(env) {
  const keys = [];
  const rawList = [env.ENGINE_LICENSE_KEYS, env.ALLOWED_ENGINE_KEYS].filter(Boolean).join(",");
  for (const entry of rawList.split(",")) {
    const trimmed = entry.trim();
    if (trimmed && !keys.includes(trimmed)) keys.push(trimmed);
  }
  const masterKey = (env.BRAIN_UPSTREAM_KEY || "").trim();
  if (masterKey && !keys.includes(masterKey)) {
    keys.push(masterKey);
  }
  return keys;
}
function resolveCorsHeaders(request, env, path) {
  const originHeader = (request.headers.get("Origin") || "").trim();
  if (!originHeader) {
    return { ...BASE_CORS_HEADERS };
  }
  let parsedOrigin;
  try {
    parsedOrigin = new URL(originHeader);
  } catch {
    return { Vary: "Origin" };
  }
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:" || parsedOrigin.username || parsedOrigin.password) {
    return { Vary: "Origin" };
  }
  const normalizedOrigin = parsedOrigin.origin;
  const allowedList = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  let isAllowed = allowedList.some((entry) => {
    try {
      const u = new URL(entry);
      return (u.protocol === "http:" || u.protocol === "https:") && u.origin.toLowerCase() === normalizedOrigin.toLowerCase();
    } catch {
      return false;
    }
  });
  if (!isAllowed && !path.startsWith("/api/admin/")) {
    const host = parsedOrigin.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
      isAllowed = true;
    }
  }
  if (!isAllowed) {
    return { Vary: "Origin" };
  }
  return {
    ...BASE_CORS_HEADERS,
    "Access-Control-Allow-Origin": normalizedOrigin,
    Vary: "Origin"
  };
}
function applyCorsHeaders(response, request, env, path) {
  const corsHeaders = resolveCorsHeaders(request, env, path);
  const nextHeaders = new Headers(response.headers);
  nextHeaders.delete("Access-Control-Allow-Origin");
  nextHeaders.delete("Access-Control-Allow-Methods");
  nextHeaders.delete("Access-Control-Allow-Headers");
  for (const [k, v] of Object.entries(corsHeaders)) {
    nextHeaders.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    headers: nextHeaders
  });
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...BASE_CORS_HEADERS
    }
  });
}
function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlEncodeString(str) {
  return base64UrlEncodeBytes(new TextEncoder().encode(str));
}
function pemToArrayBuffer(pem) {
  const normalized = pem.replace(/\\n/g, "\n");
  const b64 = normalized.replace(/-----BEGIN [A-Z0-9 ]+-----/g, "").replace(/-----END [A-Z0-9 ]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
async function hashPassword(password, existingSaltHex) {
  const enc = new TextEncoder();
  const salt = existingSaltHex ? new Uint8Array(existingSaltHex.match(/.{1,2}/g).map((b) => parseInt(b, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 1e5,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pbkdf2:${saltHex}:${hashHex}`;
}
async function verifyPassword(password, stored) {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const recomputed = await hashPassword(password, parts[1]);
  if (recomputed.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < recomputed.length; i++) {
    diff |= recomputed.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return diff === 0;
}
async function signRs256Jwt(payload, privateKeyPem) {
  const keyData = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const header = base64UrlEncodeString(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}
function buildJwtClaims(user) {
  const nowSec = Math.floor(Date.now() / 1e3);
  const vipExpSec = Math.floor(user.vip_expires_at / 1e3);
  const sessionExpSec = Math.min(vipExpSec, nowSec + 31 * 24 * 3600);
  return {
    sub: user.id,
    username: user.username,
    role: user.role || "member",
    plan: user.plan,
    vipExpiresAt: user.vip_expires_at,
    deviceId: user.bound_device_id,
    maxAccounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE,
    iat: nowSec,
    exp: sessionExpSec
  };
}
function generateCardCode(plan) {
  const prefix = plan === "trial_3d" ? "LX3D" : "LX30D";
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let body = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) body += "-";
    body += alphabet[bytes[i] % alphabet.length];
  }
  return `${prefix}-${body}`;
}
function normalizeDeviceId(raw) {
  const val = typeof raw === "string" ? raw.trim() : "";
  if (!val || val.length < 8 || val.length > 128) return "";
  return val;
}
function base64UrlDecodeToBytes(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
async function verifyRs256Jwt(token, publicKeyPem) {
  try {
    const parts = token.trim().split(".");
    if (parts.length !== 3) return { valid: false, error: "Invalid JWT format" };
    const [encodedHeader, encodedPayload, encodedSig] = parts;
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(encodedHeader)));
    if (String(header?.alg || "").toUpperCase() !== "RS256") {
      return { valid: false, error: "Unsupported JWT algorithm" };
    }
    const keyData = pemToArrayBuffer(publicKeyPem);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = base64UrlDecodeToBytes(encodedSig);
    const encodedSigningInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const signingBuf = new ArrayBuffer(encodedSigningInput.byteLength);
    new Uint8Array(signingBuf).set(encodedSigningInput);
    const isValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, sigBytes, signingBuf);
    if (!isValid) return { valid: false, error: "JWT signature verification failed" };
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(encodedPayload)));
    const expSec = Number(payload?.exp || 0);
    if (!expSec || Date.now() >= expSec * 1e3) {
      return { valid: false, error: "JWT expired" };
    }
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err?.message || "JWT parse error" };
  }
}
function toTursoHttpUrl(rawUrl) {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("libsql://")) return "https://" + trimmed.slice("libsql://".length);
  if (trimmed.startsWith("wss://")) return "https://" + trimmed.slice("wss://".length);
  if (trimmed.startsWith("ws://")) return "http://" + trimmed.slice("ws://".length);
  return trimmed;
}
function encodeTursoArg(val) {
  if (val === null || val === void 0) return { type: "null" };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { type: "integer", value: String(val) };
    return { type: "float", value: val };
  }
  if (typeof val === "boolean") return { type: "integer", value: val ? "1" : "0" };
  return { type: "text", value: String(val) };
}
function decodeTursoCell(cell) {
  if (!cell || cell.type === "null") return null;
  if (cell.type === "integer") return Number(cell.value);
  if (cell.type === "float") return Number(cell.value);
  return cell.value ?? null;
}
function createTursoDatabaseAdapter(tursoUrl, authToken) {
  const endpoint = `${toTursoHttpUrl(tursoUrl)}/v2/pipeline`;
  async function executePipeline(queries) {
    const requests = [
      ...queries.map((q) => ({
        type: "execute",
        stmt: {
          sql: q.sql,
          args: q.args.map(encodeTursoArg)
        }
      })),
      { type: "close" }
    ];
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Turso HTTP ${res.status}: ${errText || res.statusText}`);
    }
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return queries.map((_, idx) => {
      const item = results[idx];
      if (!item || item.type === "error") {
        throw new Error(item?.error?.message || "Turso SQL execution error");
      }
      const result = item.response?.result || {};
      const cols = Array.isArray(result.cols) ? result.cols : [];
      const rawRows = Array.isArray(result.rows) ? result.rows : [];
      const rows = rawRows.map((row) => {
        const obj = {};
        for (let c = 0; c < cols.length; c++) {
          const colName = cols[c]?.name || `col_${c}`;
          obj[colName] = decodeTursoCell(row[c]);
        }
        return obj;
      });
      return {
        rows,
        changes: Number(result.affected_row_count ?? 0)
      };
    });
  }
  class TursoPreparedStatement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...values) {
      return new TursoPreparedStatement(this.sql, values);
    }
    async first(colName) {
      const [res] = await executePipeline([{ sql: this.sql, args: this.params }]);
      const row = res?.rows?.[0];
      if (!row) return null;
      if (colName) return row[colName] ?? null;
      return row;
    }
    async all() {
      const [res] = await executePipeline([{ sql: this.sql, args: this.params }]);
      return { results: res?.rows || [] };
    }
    async run() {
      const [res] = await executePipeline([{ sql: this.sql, args: this.params }]);
      return { success: true, meta: { changes: res?.changes ?? 0 } };
    }
  }
  return {
    prepare(query) {
      return new TursoPreparedStatement(query);
    },
    async batch(statements) {
      const entries = statements.map((s) => {
        const ts = s;
        return { sql: ts.sql, args: ts.params || [] };
      });
      return await executePipeline(entries);
    }
  };
}
function resolveWorkerDb(env) {
  if (env.TURSO_DATABASE_URL && env.TURSO_DATABASE_URL.trim()) {
    return createTursoDatabaseAdapter(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  }
  if (env.DB) {
    return env.DB;
  }
  throw new Error("\u672A\u914D\u7F6E\u6570\u636E\u5E93\uFF1A\u8BF7\u914D\u7F6E TURSO_DATABASE_URL + TURSO_AUTH_TOKEN \u6216\u7ED1\u5B9A Cloudflare D1 (DB)");
}
function maskApiHash(hash) {
  const clean = String(hash || "").trim();
  if (clean.length <= 8) return "****";
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}
function parseEnvTelegramApiPool(env) {
  const items = [];
  if (env.TELEGRAM_API_POOL) {
    try {
      const parsed = JSON.parse(env.TELEGRAM_API_POOL);
      if (Array.isArray(parsed)) {
        parsed.forEach((item, idx) => {
          const idNum = Number(item?.apiId ?? item?.api_id);
          const hashStr = String(item?.apiHash ?? item?.api_hash ?? "").trim();
          if (Number.isInteger(idNum) && idNum > 0 && hashStr) {
            items.push({
              id: String(item?.id || `env_pool_${idx}`),
              api_id: idNum,
              api_hash: hashStr,
              label: String(item?.label || `cloud-env-${idx + 1}`)
            });
          }
        });
      }
    } catch {
    }
  }
  if (items.length === 0 && env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH) {
    const idNum = Number(env.TELEGRAM_API_ID);
    const hashStr = env.TELEGRAM_API_HASH.trim();
    if (Number.isInteger(idNum) && idNum > 0 && hashStr) {
      items.push({
        id: "env_default",
        api_id: idNum,
        api_hash: hashStr,
        label: "cloud-secret-default"
      });
    }
  }
  return items;
}
function isCloudBrainProxyPath(path) {
  return path === "/v1" || path.startsWith("/v1/") || path === "/api/knowledge" || path.startsWith("/api/knowledge/") || path === "/api/v1" || path.startsWith("/api/v1/") || path === "/api/brain/health";
}
async function forwardToKnowledgeBrain(request, env, url) {
  const rawUpstream = (env.BRAIN_UPSTREAM_URL || env.KNOWLEDGE_SERVER_URL || env.RAILWAY_BRAIN_URL || "").trim();
  if (!rawUpstream) {
    return jsonResponse(
      {
        ok: false,
        code: "BRAIN_UPSTREAM_UNCONFIGURED",
        error: "\u4E91\u7AEF\u77E5\u8BC6\u5E93\u4EE3\u7406\u5C1A\u672A\u914D\u7F6E\u4E0A\u6E38\u5730\u5740\uFF0C\u8BF7\u5728 Cloudflare Worker \u73AF\u5883\u53D8\u91CF\u4E2D\u8BBE\u7F6E BRAIN_UPSTREAM_URL"
      },
      503
    );
  }
  let upstreamBase = rawUpstream.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(upstreamBase)) {
    upstreamBase = `https://${upstreamBase}`;
  }
  const adminSecret = (request.headers.get("X-Admin-Secret") || "").trim();
  const engineKey = (request.headers.get("X-Engine-License") || request.headers.get("X-License-Key") || request.headers.get("X-Engine-Key") || request.headers.get("x-api-key") || "").trim();
  const explicitUserJwt = (request.headers.get("X-User-JWT") || "").trim();
  const authHeader = (request.headers.get("Authorization") || "").trim();
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch?.[1]?.trim() || "";
  let edgeAuthenticated = false;
  let authenticatedByAdmin = false;
  let verifiedUserJwt = "";
  if (adminSecret) {
    if (!env.ADMIN_SECRET || !constantTimeEqual(adminSecret, env.ADMIN_SECRET)) {
      return jsonResponse({ ok: false, code: "UNAUTHORIZED_ADMIN", error: "Unauthorized admin request" }, 401);
    }
    edgeAuthenticated = true;
    authenticatedByAdmin = true;
  } else {
    const jwtCandidate = explicitUserJwt || (bearerToken.split(".").length === 3 ? bearerToken : "");
    if (jwtCandidate) {
      const verifyRes = await verifyRs256Jwt(jwtCandidate, env.JWT_PUBLIC_KEY || DEFAULT_JWT_PUBLIC_KEY);
      if (!verifyRes.valid || !verifyRes.payload) {
        return jsonResponse(
          { ok: false, code: "INVALID_TOKEN", error: verifyRes.error || "\u4F1A\u5458\u4EE4\u724C\u9A8C\u7B7E\u5931\u8D25\u6216\u5DF2\u8FC7\u671F" },
          401
        );
      }
      const vipExpiresAt = Number(verifyRes.payload.vipExpiresAt || 0);
      if (vipExpiresAt > 0 && vipExpiresAt <= Date.now()) {
        return jsonResponse(
          { ok: false, code: "VIP_EXPIRED", error: "\u4F1A\u5458\u5361\u5BC6\u5DF2\u5230\u671F\uFF0C\u8BF7\u7EED\u8D39\u540E\u7EE7\u7EED\u4F7F\u7528\u4E91\u7AEF\u5927\u8111" },
          401
        );
      }
      edgeAuthenticated = true;
      verifiedUserJwt = jwtCandidate;
    } else {
      const engineCandidate = engineKey || bearerToken;
      if (!engineCandidate) {
        return jsonResponse(
          { ok: false, code: "MISSING_AUTH", error: "\u7F3A\u5C11\u6709\u6548\u7684\u4F1A\u5458 RS256 \u4EE4\u724C\u6216\u5F15\u64CE\u6388\u6743\u5BC6\u94A5" },
          401
        );
      }
      const allowedEngineKeys = resolveAllowedEngineKeys(env);
      const matchedEngineKey = allowedEngineKeys.some((k) => constantTimeEqual(engineCandidate, k));
      if (!matchedEngineKey) {
        return jsonResponse(
          {
            ok: false,
            code: engineKey ? "INVALID_ENGINE_KEY" : "INVALID_TOKEN",
            error: engineKey ? "\u65E0\u6548\u7684\u5F15\u64CE\u6388\u6743\u5BC6\u94A5" : "\u65E0\u6548\u7684\u8BA4\u8BC1\u4EE4\u724C\u683C\u5F0F\u6216\u672A\u6388\u6743\u5BC6\u94A5"
          },
          401
        );
      }
      edgeAuthenticated = true;
    }
  }
  const upstreamPath = url.pathname === "/api/brain/health" ? "/health" : url.pathname;
  const targetUrl = `${upstreamBase}${upstreamPath}${url.search}`;
  const upstreamHeaders = new Headers();
  const forwardHeaderNames = [
    "Content-Type",
    "Accept",
    "Authorization",
    "X-User-JWT",
    "X-Engine-Key",
    "X-Engine-License",
    "X-License-Key",
    "x-api-key",
    "X-Client-Brand",
    "X-Admin-Secret"
  ];
  for (const name of forwardHeaderNames) {
    const val = request.headers.get(name);
    if (val) upstreamHeaders.set(name, val);
  }
  if (!authenticatedByAdmin) {
    upstreamHeaders.delete("X-Admin-Secret");
  }
  if (!verifiedUserJwt) {
    upstreamHeaders.delete("X-User-JWT");
  }
  if (verifiedUserJwt && !upstreamHeaders.has("X-User-JWT")) {
    upstreamHeaders.set("X-User-JWT", verifiedUserJwt);
  }
  const masterEngineKey = (env.BRAIN_UPSTREAM_KEY || "").trim();
  if (edgeAuthenticated && masterEngineKey) {
    upstreamHeaders.set("Authorization", `Bearer ${masterEngineKey}`);
    upstreamHeaders.set("X-Engine-License", masterEngineKey);
    upstreamHeaders.set("X-License-Key", masterEngineKey);
    upstreamHeaders.set("X-Engine-Key", masterEngineKey);
    upstreamHeaders.set("x-api-key", masterEngineKey);
  }
  try {
    const bodyBuffer = request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : void 0;
    const upstreamRes = await fetch(targetUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: bodyBuffer,
      redirect: "follow"
    });
    const respHeaders = new Headers(BASE_CORS_HEADERS);
    respHeaders.set("Content-Type", upstreamRes.headers.get("Content-Type") || "application/json; charset=utf-8");
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: respHeaders
    });
  } catch {
    return jsonResponse(
      { ok: false, code: "BRAIN_UPSTREAM_UNREACHABLE", error: "\u4E91\u7AEF\u77E5\u8BC6\u5E93\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u8FBE\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5" },
      502
    );
  }
}
async function handleWorkerRequest(request, env, url) {
    const path = url.pathname;
    if (request.method === "GET" && (path === "/" || path === "/health")) {
      const brainProxyConfigured = Boolean(
        (env.BRAIN_UPSTREAM_URL || env.KNOWLEDGE_SERVER_URL || env.RAILWAY_BRAIN_URL || "").trim()
      );
      return jsonResponse({
        ok: true,
        service: "lingxi-auth-worker",
        status: "running",
        dbMode: env.TURSO_DATABASE_URL ? "turso" : env.DB ? "d1" : "unconfigured",
        brainProxyConfigured,
        maxAccounts: MAX_ACCOUNTS_PER_DEVICE,
        endpoints: [
          "/health",
          "/api/auth/register",
          "/api/auth/login",
          "/api/auth/redeem",
          "/api/auth/telegram-credentials",
          "/api/admin/cards/generate",
          "/api/admin/unbind-device",
          "/api/admin/telegram-pool",
          "/v1/chat/completions",
          "/api/knowledge/search",
          "/api/v1/evolution/sync",
          "/api/v1/training/feedback"
        ]
      });
    }
    if (isCloudBrainProxyPath(path)) {
      return await forwardToKnowledgeBrain(request, env, url);
    }
    if (!env.JWT_PRIVATE_KEY) {
      return jsonResponse({ ok: false, error: "\u670D\u52A1\u7AEF\u672A\u914D\u7F6E JWT_PRIVATE_KEY" }, 500);
    }
    const db = resolveWorkerDb(env);
    try {
      if (request.method === "POST" && path === "/api/auth/register") {
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const cardKey = String(body.cardKey || "").trim().toUpperCase();
        const deviceId = normalizeDeviceId(body.deviceId);
        if (!username || username.length < 3 || username.length > 64) {
          return jsonResponse({ ok: false, error: "\u4F1A\u5458\u8D26\u53F7\u957F\u5EA6\u9700\u5728 3-64 \u4E2A\u5B57\u7B26\u4E4B\u95F4" }, 400);
        }
        if (!password || password.length < 6) {
          return jsonResponse({ ok: false, error: "\u767B\u5F55\u5BC6\u7801\u81F3\u5C11 6 \u4F4D" }, 400);
        }
        if (!cardKey) {
          return jsonResponse({ ok: false, error: "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u6388\u6743\u5361\u5BC6\uFF08\u652F\u6301 3 \u5929\u8BD5\u7528\u5361\u6216 30 \u5929\u5305\u6708\u5361\uFF09" }, 400);
        }
        if (!deviceId) {
          return jsonResponse({ ok: false, error: "\u7F3A\u5C11\u5F53\u524D\u7535\u8111\u8BBE\u5907\u6307\u7EB9 (deviceId)\uFF0C\u8BF7\u5728\u7075\u7280\u8BED\u5883\u684C\u9762\u7AEF\u5185\u6CE8\u518C" }, 400);
        }
        const existingUser = await db.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
        if (existingUser) {
          return jsonResponse({ ok: false, error: "\u8BE5\u4F1A\u5458\u8D26\u53F7\u5DF2\u5B58\u5728\uFF0C\u8BF7\u76F4\u63A5\u767B\u5F55\u6216\u4F7F\u7528\u201C\u5361\u5BC6\u7EED\u8D39\u201D" }, 409);
        }
        const cardRow = await db.prepare(
          "SELECT code, plan, duration_days, status FROM card_keys WHERE code = ?"
        ).bind(cardKey).first();
        if (!cardRow) {
          return jsonResponse({ ok: false, code: "INVALID_CARD", error: "\u5361\u5BC6\u4E0D\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5\u662F\u5426\u8F93\u5165\u6709\u8BEF" }, 400);
        }
        if (cardRow.status !== "unused") {
          return jsonResponse({ ok: false, code: "CARD_ALREADY_USED", error: "\u8BE5\u5361\u5BC6\u5DF2\u88AB\u4F7F\u7528\u6216\u5DF2\u4F5C\u5E9F\uFF08\u4E00\u5361\u4EC5\u9650\u4E00\u4E2A\u4F1A\u5458\u8D26\u6237\uFF09" }, 409);
        }
        const now = Date.now();
        const userId = `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
        const passwordHash = await hashPassword(password);
        const durationDays = Number(cardRow.duration_days) || (cardRow.plan === "trial_3d" ? 3 : 30);
        const vipExpiresAt = now + durationDays * DAY_MS;
        const consumeRes = await db.prepare(
          `UPDATE card_keys
           SET status = 'used', used_by_username = ?, used_at = ?
           WHERE code = ? AND status = 'unused'`
        ).bind(username, now, cardRow.code).run();
        if (!consumeRes.meta.changes || consumeRes.meta.changes < 1) {
          return jsonResponse({ ok: false, code: "CARD_ALREADY_USED", error: "\u8BE5\u5361\u5BC6\u5DF2\u88AB\u5176\u4ED6\u8BF7\u6C42\u5360\u7528" }, 409);
        }
        try {
          await db.prepare(
            `INSERT INTO users (id, username, password_hash, role, plan, vip_expires_at, bound_device_id, max_accounts, created_at, updated_at)
             VALUES (?, ?, ?, 'member', ?, ?, ?, ?, ?, ?)`
          ).bind(userId, username, passwordHash, cardRow.plan, vipExpiresAt, deviceId, MAX_ACCOUNTS_PER_DEVICE, now, now).run();
          await db.prepare(
            `UPDATE card_keys SET used_by_user_id = ? WHERE code = ?`
          ).bind(userId, cardRow.code).run();
        } catch (insertErr) {
          await db.prepare(
            `UPDATE card_keys SET status = 'unused', used_by_user_id = NULL, used_by_username = NULL, used_at = NULL WHERE code = ?`
          ).bind(cardRow.code).run();
          await db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run().catch(() => {
          });
          throw insertErr;
        }
        await db.prepare(
          `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
           VALUES (?, ?, 'register', ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), username, deviceId, cardRow.code, `plan=${cardRow.plan},days=${durationDays}`, now).run();
        const userRecord = {
          id: userId,
          username,
          role: "member",
          plan: cardRow.plan,
          vipExpiresAt,
          boundDeviceId: deviceId,
          maxAccounts: MAX_ACCOUNTS_PER_DEVICE
        };
        const token = await signRs256Jwt(
          buildJwtClaims({
            id: userId,
            username,
            role: "member",
            plan: cardRow.plan,
            vip_expires_at: vipExpiresAt,
            bound_device_id: deviceId,
            max_accounts: MAX_ACCOUNTS_PER_DEVICE
          }),
          env.JWT_PRIVATE_KEY
        );
        return jsonResponse({ ok: true, token, user: userRecord });
      }
      if (request.method === "POST" && path === "/api/auth/login") {
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const deviceId = normalizeDeviceId(body.deviceId);
        if (!username || !password) {
          return jsonResponse({ ok: false, error: "\u8BF7\u8F93\u5165\u4F1A\u5458\u8D26\u53F7\u548C\u5BC6\u7801" }, 400);
        }
        if (!deviceId) {
          return jsonResponse({ ok: false, error: "\u7F3A\u5C11\u7535\u8111\u8BBE\u5907\u6307\u7EB9 (deviceId)\uFF0C\u8BF7\u5728\u684C\u9762\u5BA2\u6237\u7AEF\u5185\u767B\u5F55" }, 400);
        }
        const user = await db.prepare(
          "SELECT id, username, password_hash, role, plan, vip_expires_at, bound_device_id, max_accounts FROM users WHERE username = ?"
        ).bind(username).first();
        if (!user || !await verifyPassword(password, user.password_hash)) {
          return jsonResponse({ ok: false, code: "INVALID_CREDENTIALS", error: "\u4F1A\u5458\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF" }, 401);
        }
        const now = Date.now();
        let activeBoundDevice = user.bound_device_id;
        if (!activeBoundDevice) {
          await db.prepare("UPDATE users SET bound_device_id = ?, updated_at = ? WHERE id = ?").bind(deviceId, now, user.id).run();
          activeBoundDevice = deviceId;
        } else if (activeBoundDevice !== deviceId) {
          return jsonResponse(
            {
              ok: false,
              code: "DEVICE_MISMATCH",
              error: "\u8BE5\u4F1A\u5458\u8D26\u6237\u5DF2\u7ED1\u5B9A\u53E6\u4E00\u53F0\u7535\u8111\uFF0C\u4E0D\u652F\u6301\u591A\u673A\u540C\u65F6\u767B\u5F55\u3002\u5982\u9700\u6362\u673A\u8BF7\u8054\u7CFB\u5BA2\u670D\u89E3\u7ED1\u8BBE\u5907\u3002"
            },
            403
          );
        }
        if (!user.vip_expires_at || user.vip_expires_at <= now) {
          return jsonResponse(
            {
              ok: false,
              code: "VIP_EXPIRED",
              error: "\u60A8\u7684\u5361\u5BC6\u6388\u6743\u5DF2\u5230\u671F\uFF0C\u8BF7\u5207\u6362\u5230\u201C\u5361\u5BC6\u7EED\u8D39\u201D\u8F93\u5165\u65B0\u5361\u5BC6\u5373\u53EF\u5EF6\u957F\u4F7F\u7528\u65F6\u95F4\u3002"
            },
            401
          );
        }
        await db.prepare(
          `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
           VALUES (?, ?, 'login', ?, NULL, ?, ?)`
        ).bind(crypto.randomUUID(), username, deviceId, `plan=${user.plan}`, now).run();
        const token = await signRs256Jwt(
          buildJwtClaims({
            id: user.id,
            username: user.username,
            role: user.role,
            plan: user.plan,
            vip_expires_at: user.vip_expires_at,
            bound_device_id: activeBoundDevice,
            max_accounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE
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
            maxAccounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE
          }
        });
      }
      if (request.method === "POST" && path === "/api/auth/redeem") {
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const cardKey = String(body.cardKey || "").trim().toUpperCase();
        const deviceId = normalizeDeviceId(body.deviceId);
        if (!username || !cardKey) {
          return jsonResponse({ ok: false, error: "\u8BF7\u8F93\u5165\u4F1A\u5458\u8D26\u53F7\u4E0E\u65B0\u5361\u5BC6" }, 400);
        }
        if (!deviceId) {
          return jsonResponse({ ok: false, error: "\u7F3A\u5C11\u8BBE\u5907\u6307\u7EB9 (deviceId)" }, 400);
        }
        const user = await db.prepare(
          "SELECT id, username, password_hash, role, plan, vip_expires_at, bound_device_id, max_accounts FROM users WHERE username = ?"
        ).bind(username).first();
        if (!user) {
          return jsonResponse({ ok: false, error: "\u4F1A\u5458\u8D26\u53F7\u4E0D\u5B58\u5728" }, 404);
        }
        if (password && !await verifyPassword(password, user.password_hash)) {
          return jsonResponse({ ok: false, error: "\u4F1A\u5458\u5BC6\u7801\u6821\u9A8C\u5931\u8D25" }, 401);
        }
        if (user.bound_device_id && user.bound_device_id !== deviceId) {
          return jsonResponse(
            {
              ok: false,
              code: "DEVICE_MISMATCH",
              error: "\u8BE5\u4F1A\u5458\u8D26\u6237\u5DF2\u7ED1\u5B9A\u5176\u4ED6\u7535\u8111\uFF0C\u65E0\u6CD5\u5728\u5F53\u524D\u7535\u8111\u7EED\u8D39\u6FC0\u6D3B\u3002"
            },
            403
          );
        }
        const cardRow = await db.prepare(
          "SELECT code, plan, duration_days, status FROM card_keys WHERE code = ?"
        ).bind(cardKey).first();
        if (!cardRow || cardRow.status !== "unused") {
          return jsonResponse({ ok: false, code: "INVALID_CARD", error: "\u5361\u5BC6\u65E0\u6548\u6216\u5DF2\u88AB\u4F7F\u7528" }, 400);
        }
        const now = Date.now();
        const durationDays = Number(cardRow.duration_days) || (cardRow.plan === "trial_3d" ? 3 : 30);
        const baseTime = Math.max(now, user.vip_expires_at || 0);
        const newExpiresAt = baseTime + durationDays * DAY_MS;
        const boundDevice = user.bound_device_id || deviceId;
        const consumeRes = await db.prepare(
          `UPDATE card_keys
           SET status = 'used', used_by_user_id = ?, used_by_username = ?, used_at = ?
           WHERE code = ? AND status = 'unused'`
        ).bind(user.id, user.username, now, cardRow.code).run();
        if (!consumeRes.meta.changes || consumeRes.meta.changes < 1) {
          return jsonResponse({ ok: false, code: "CARD_ALREADY_USED", error: "\u8BE5\u5361\u5BC6\u5DF2\u88AB\u5360\u7528" }, 409);
        }
        await db.prepare(
          "UPDATE users SET plan = ?, vip_expires_at = ?, bound_device_id = ?, updated_at = ? WHERE id = ?"
        ).bind(cardRow.plan, newExpiresAt, boundDevice, now, user.id).run();
        await db.prepare(
          `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
           VALUES (?, ?, 'redeem', ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), user.username, deviceId, cardRow.code, `extendedDays=${durationDays}`, now).run();
        const token = await signRs256Jwt(
          buildJwtClaims({
            id: user.id,
            username: user.username,
            role: user.role,
            plan: cardRow.plan,
            vip_expires_at: newExpiresAt,
            bound_device_id: boundDevice,
            max_accounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE
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
            maxAccounts: user.max_accounts || MAX_ACCOUNTS_PER_DEVICE
          }
        });
      }
      if (request.method === "POST" && path === "/api/admin/cards/generate") {
        const adminSecret = request.headers.get("X-Admin-Secret") || "";
        if (!env.ADMIN_SECRET || !constantTimeEqual(adminSecret, env.ADMIN_SECRET)) {
          return jsonResponse({ ok: false, error: "Unauthorized admin request" }, 401);
        }
        const body = await request.json().catch(() => ({}));
        const plan = body.plan === "trial_3d" ? "trial_3d" : "monthly_30d";
        const durationDays = plan === "trial_3d" ? 3 : 30;
        const count = Math.min(Math.max(Number(body.count) || 10, 1), 200);
        const batchId = String(body.batchId || `batch_${Date.now()}`);
        const now = Date.now();
        const codes = [];
        const stmt = db.prepare(
          `INSERT INTO card_keys (code, plan, duration_days, status, batch_id, created_at)
           VALUES (?, ?, ?, 'unused', ?, ?)`
        );
        const batchStmts = [];
        for (let i = 0; i < count; i++) {
          const code = generateCardCode(plan);
          codes.push(code);
          batchStmts.push(stmt.bind(code, plan, durationDays, batchId, now));
        }
        await db.batch(batchStmts);
        return jsonResponse({ ok: true, plan, durationDays, batchId, count: codes.length, codes });
      }
      if (request.method === "POST" && path === "/api/admin/unbind-device") {
        const adminSecret = request.headers.get("X-Admin-Secret") || "";
        if (!env.ADMIN_SECRET || !constantTimeEqual(adminSecret, env.ADMIN_SECRET)) {
          return jsonResponse({ ok: false, error: "Unauthorized admin request" }, 401);
        }
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        if (!username) {
          return jsonResponse({ ok: false, error: "\u8BF7\u63D0\u4F9B\u8981\u89E3\u7ED1\u7684\u4F1A\u5458\u8D26\u53F7 username" }, 400);
        }
        const now = Date.now();
        const updateRes = await db.prepare(
          "UPDATE users SET bound_device_id = NULL, updated_at = ? WHERE username = ?"
        ).bind(now, username).run();
        if (!updateRes.meta.changes) {
          return jsonResponse({ ok: false, error: "\u672A\u627E\u5230\u8BE5\u4F1A\u5458\u8D26\u53F7" }, 404);
        }
        await db.prepare(
          `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
           VALUES (?, ?, 'unbind_device', NULL, NULL, 'admin_reset', ?)`
        ).bind(crypto.randomUUID(), username, now).run();
        return jsonResponse({ ok: true, message: `\u5DF2\u6E05\u7A7A ${username} \u7684\u65E7\u7535\u8111\u7ED1\u5B9A\uFF0C\u4E0B\u6B21\u767B\u5F55\u5C06\u81EA\u52A8\u7ED1\u5B9A\u65B0\u7535\u8111` });
      }
      if (request.method === "POST" && path === "/api/auth/telegram-credentials") {
        const authHeader = request.headers.get("Authorization") || "";
        const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
        const token = tokenMatch?.[1]?.trim() || "";
        if (!token) {
          return jsonResponse({ ok: false, code: "MISSING_TOKEN", error: "\u7F3A\u5C11\u4F1A\u5458 Bearer \u4EE4\u724C" }, 401);
        }
        const verifyRes = await verifyRs256Jwt(token, env.JWT_PUBLIC_KEY || DEFAULT_JWT_PUBLIC_KEY);
        if (!verifyRes.valid || !verifyRes.payload) {
          return jsonResponse({ ok: false, code: "INVALID_TOKEN", error: verifyRes.error || "\u4F1A\u5458\u4EE4\u724C\u9A8C\u7B7E\u5931\u8D25" }, 401);
        }
        const body = await request.json().catch(() => ({}));
        const deviceId = normalizeDeviceId(body.deviceId || verifyRes.payload.deviceId);
        const userId = String(verifyRes.payload.sub || "");
        const user = await db.prepare("SELECT id, username, vip_expires_at, bound_device_id FROM users WHERE id = ?").bind(userId).first();
        if (!user) {
          return jsonResponse({ ok: false, code: "USER_NOT_FOUND", error: "\u4F1A\u5458\u8D26\u53F7\u4E0D\u5B58\u5728" }, 401);
        }
        if (user.bound_device_id && deviceId && user.bound_device_id !== deviceId) {
          return jsonResponse({ ok: false, code: "DEVICE_MISMATCH", error: "\u5F53\u524D\u7535\u8111\u4E0E\u7ED1\u5B9A\u8BBE\u5907\u4E0D\u4E00\u81F4" }, 403);
        }
        const now = Date.now();
        if (!user.vip_expires_at || user.vip_expires_at <= now) {
          return jsonResponse({ ok: false, code: "VIP_EXPIRED", error: "\u4F1A\u5458\u5361\u5BC6\u5DF2\u5230\u671F\uFF0C\u8BF7\u7EED\u8D39\u540E\u9886\u53D6\u51ED\u636E" }, 401);
        }
        let assignedPool = null;
        try {
          assignedPool = await db.prepare(
            `SELECT p.id, p.api_id, p.api_hash, p.label
               FROM user_api_assignments ua
               JOIN telegram_api_pool p ON p.id = ua.pool_id
               WHERE ua.user_id = ? AND CAST(COALESCE(p.is_active, 1) AS INTEGER) = 1`
          ).bind(user.id).first();
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
            const candidatesRes = candidateStmt.all ? await candidateStmt.all() : { results: [] };
            const candidates = (candidatesRes.results || []).filter(
              (c) => Number(c.api_id) > 0 && String(c.api_hash || "").trim().length > 0
            );
            const picked = candidates.find((c) => Number(c.used_count || 0) < (Number(c.max_devices) || 50)) || candidates[0] || null;
            if (picked) {
              await db.prepare(
                `INSERT INTO user_api_assignments (user_id, pool_id, assigned_at, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET pool_id = excluded.pool_id, updated_at = excluded.updated_at`
              ).bind(user.id, picked.id, now, now).run();
              await db.prepare(
                `INSERT INTO auth_audit_logs (id, username, action, device_id, card_key, detail, created_at)
                   VALUES (?, ?, 'assign_api_pool', ?, NULL, ?, ?)`
              ).bind(crypto.randomUUID(), user.username, deviceId || null, `pool=${picked.id},apiId=${picked.api_id}`, now).run();
              assignedPool = picked;
            }
          }
        } catch (poolErr) {
          console.warn("telegram_api_pool query note:", poolErr?.message);
        }
        if (!assignedPool) {
          const envPool = parseEnvTelegramApiPool(env);
          if (envPool.length > 0) {
            let hashVal = 0;
            for (let i = 0; i < user.id.length; i++) {
              hashVal = hashVal * 31 + user.id.charCodeAt(i) >>> 0;
            }
            assignedPool = envPool[hashVal % envPool.length];
          }
        }
        if (!assignedPool) {
          return jsonResponse(
            {
              ok: false,
              code: "CLOUD_POOL_EMPTY",
              error: "\u4E91\u7AEF\u6682\u672A\u914D\u7F6E\u53EF\u4E0B\u53D1\u7684\u542F\u7528\u72B6\u6001 Telegram API \u51ED\u636E\uFF0C\u8BF7\u5728 Turso telegram_api_pool \u8868\u4E2D\u6DFB\u52A0 is_active = 1 \u7684\u65B0\u51ED\u636E"
            },
            404
          );
        }
        return jsonResponse({
          ok: true,
          apiId: Number(assignedPool.api_id),
          apiHash: String(assignedPool.api_hash).trim(),
          source: "cloud_authorized",
          poolLabel: assignedPool.label || assignedPool.id,
          vipExpiresAt: user.vip_expires_at
        });
      }
      if (path === "/api/admin/telegram-pool") {
        const adminSecret = request.headers.get("X-Admin-Secret") || "";
        if (!env.ADMIN_SECRET || !constantTimeEqual(adminSecret, env.ADMIN_SECRET)) {
          return jsonResponse({ ok: false, error: "Unauthorized admin request" }, 401);
        }
        if (request.method === "GET") {
          const listStmt = db.prepare(
            `SELECT p.id, p.api_id, p.api_hash, p.label, COALESCE(p.max_devices, 50) as max_devices,
                    CAST(COALESCE(p.is_active, 1) AS INTEGER) as is_active, p.notes, p.created_at, p.updated_at,
                    COUNT(ua.user_id) as assigned_count
             FROM telegram_api_pool p
             LEFT JOIN user_api_assignments ua ON ua.pool_id = p.id
             GROUP BY p.id
             ORDER BY COALESCE(p.created_at, 0) DESC`
          );
          const rowsRes = listStmt.all ? await listStmt.all() : { results: [] };
          const items = (rowsRes.results || []).map((row) => ({
            id: row.id,
            apiId: Number(row.api_id),
            maskedApiHash: maskApiHash(String(row.api_hash || "")),
            label: row.label || "",
            maxDevices: Number(row.max_devices) || 50,
            assignedCount: Number(row.assigned_count) || 0,
            isActive: Number(row.is_active) === 1,
            notes: row.notes || "",
            updatedAt: Number(row.updated_at) || 0
          }));
          return jsonResponse({ ok: true, items });
        }
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const apiId = Number(body.apiId);
          const apiHash = String(body.apiHash || "").trim();
          const label = String(body.label || `pool-${apiId}`).trim();
          const maxDevices = Math.max(1, Number(body.maxDevices) || 50);
          const isActive = body.isActive === false ? 0 : 1;
          const notes = String(body.notes || "").trim();
          if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
            return jsonResponse({ ok: false, error: "\u8BF7\u63D0\u4F9B\u6709\u6548\u7684 apiId (\u6B63\u6574\u6570) \u4E0E apiHash" }, 400);
          }
          const now = Date.now();
          const id = String(body.id || `tgpool_${apiId}`);
          await db.prepare(
            `INSERT INTO telegram_api_pool (id, api_id, api_hash, label, max_devices, is_active, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(api_id) DO UPDATE SET
                 api_hash = excluded.api_hash,
                 label = excluded.label,
                 max_devices = excluded.max_devices,
                 is_active = excluded.is_active,
                 notes = excluded.notes,
                 updated_at = excluded.updated_at`
          ).bind(id, apiId, apiHash, label, maxDevices, isActive, notes, now, now).run();
          return jsonResponse({
            ok: true,
            item: {
              id,
              apiId,
              maskedApiHash: maskApiHash(apiHash),
              label,
              maxDevices,
              isActive: isActive === 1
            }
          });
        }
      }
      return jsonResponse({ ok: false, error: "Not Found" }, 404);
    } catch (err) {
      return jsonResponse({ ok: false, error: err?.message || "Worker Internal Error" }, 500);
    }
}
var cloudflare_auth_worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      const corsHeaders = resolveCorsHeaders(request, env, path);
      if (request.headers.get("Origin") && !corsHeaders["Access-Control-Allow-Origin"]) {
        return new Response(null, { status: 403, headers: { Vary: "Origin" } });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const response = await handleWorkerRequest(request, env, url);
    return applyCorsHeaders(response, request, env, path);
  }
};
export {
  cloudflare_auth_worker_default as default
};
