import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { SocksClient } from 'socks';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import busboy from 'busboy';

export const isElectronMainProcess = Boolean(
  (process as any).versions?.electron && process.env.ELECTRON_RUN_AS_NODE !== '1'
);

// Prevent unexpected async background rejections or WebSocket/HMR errors from crashing server process
process.on('uncaughtException', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    console.error('[Fatal Error] Port is already in use (EADDRINUSE):', err.message);
    if (!isElectronMainProcess) {
      process.exit(1);
    }
    return;
  }
  console.warn('[Server UncaughtException Warning]:', err?.message || err);
});
process.on('unhandledRejection', (reason: any) => {
  console.warn('[Server UncaughtRejection Warning]:', reason?.message || reason);
});
import dns from 'dns/promises';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';
import { NewMessage, Raw } from 'telegram/events/index.js';
import { computeCheck, computeDigest } from 'telegram/Password.js';
import { CustomFile } from 'telegram/client/uploads.js';
import { returnBigInt, generateRandomLong } from 'telegram/Helpers.js';
import {
  db,
  dbPath,
  dbDir,
  initDatabase,
  isTurso,
  isRailway,
  isPersistentVolume,
  persistenceTier,
  dbType,
  exportDatabaseSnapshot,
  restoreDatabaseSnapshot,
  autoRestoreSnapshotIfAvailable,
  DEFAULT_GLOBAL_PERSONA,
  PERSONA_TEMPLATE_PRESET,
  DEFAULT_EVOLUTION_STATE,
  getGlobalPersonaFromDb,
  saveGlobalPersonaToDb,
  getEvolutionStateFromDb,
  saveEvolutionStateToDb,
  resetGlobalPersonaInDb,
} from './server/db.ts';
import { EMBEDDED_JWT_PUBLIC_KEY } from './server/authConfig.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.env.npm_lifecycle_event === 'start' ||
  process.argv.includes('--production');

// Parse command line arguments or environment variables for port and host
function getArg(key: string): string | undefined {
  const index = process.argv.indexOf(key);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return undefined;
}
const PORT = parseInt(getArg('--port') || process.env.PORT || '3000', 10);
const HOST = getArg('--host') || process.env.HOST || '0.0.0.0';

const app = express();
app.set('trust proxy', true);

// Security Headers & Content Security Policy via Helmet
app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://*.telegram.org', 'https://api.telegram.org', 'https://*.telesco.pe'],
        connectSrc: ["'self'", 'https:', 'wss:', 'ws:'],
        mediaSrc: ["'self'", 'data:', 'blob:', 'https://*.telegram.org', 'https://api.telegram.org', 'https://*.telesco.pe'],
        frameAncestors: ["'self'", '*'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

app.use(cookieParser());

// Large payload routes (Audio STT upload, knowledge file upload) require larger body limit
const largeBodyParser = express.json({ limit: '30mb' });
const largeUrlEncodedParser = express.urlencoded({ extended: true, limit: '30mb' });

// Default safe strict limit: 1MB for all general requests to prevent memory exhaustion / DoS
app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    req.path.startsWith('/api/audio/transcribe') ||
    req.path.startsWith('/api/knowledge/upload') ||
    req.path.startsWith('/api/database/restore') ||
    req.path.startsWith('/api/telegram/user/upload-avatar')
  ) {
    largeBodyParser(req, res, (err) => {
      if (err) return next(err);
      largeUrlEncodedParser(req, res, next);
    });
  } else {
    express.json({ limit: '1mb' })(req, res, (err) => {
      if (err) return next(err);
      express.urlencoded({ extended: true, limit: '1mb' })(req, res, next);
    });
  }
});

// Rate limiter for Admin Login attempts (5 attempts per minute per IP)
export const authLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Attempts',
    message: '管理员登录尝试过于频繁，已触发安全防御（单 IP 每分钟最多 5 次）。请稍后再试。',
    retryAfterSeconds: 60,
  },
  statusCode: 429,
});

// Dedicated Rate limiter for Authentication attempts (Telegram SMS/App verify code, 2FA, 5 attempts per minute per IP)
export const authAttemptLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too Many Attempts',
    message: '验证码尝试过于频繁，已触发安全防爆破限制（单 IP 每分钟最多 5 次）。请稍后再试。',
    retryAfterSeconds: 60,
  },
  statusCode: 429,
});

// Rate limiter for local pre-login Cloud Auth proxy forwarding routes
export const cloudAuthForwardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'TOO_MANY_REQUESTS',
    error: '登录或注册请求过于频繁，请稍候 1 分钟后再试',
  },
  statusCode: 429,
});

// Rate limiter for high-cost AI endpoints (Gemini LLM chat, STT transcribe, translation, TTS voice generation)
// Limits each IP to a maximum of 30 AI generation requests per minute
export const aiGenerationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // Limit each IP to 30 requests per windowMs
  standardHeaders: true, // Return standard `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    error: 'Too Many Requests',
    message: 'AI 生成请求频率过高，触发速率保护限制（单 IP 每分钟最多 30 次）。请稍后再试。',
    retryAfterSeconds: 60,
  },
  statusCode: 429,
});

// ==================== GEMINI API & CIRCUIT BREAKER ====================
let geminiQuotaBlockedUntil = 0;
let geminiQuotaBlockReason = '';

export function getGeminiCircuitStatus() {
  return {
    isAvailable: isGeminiAvailable(),
    isBlocked: Date.now() < geminiQuotaBlockedUntil,
    blockedUntil: geminiQuotaBlockedUntil,
    reason: geminiQuotaBlockReason,
  };
}

export function isGeminiAvailable(customApiKey?: string): boolean {
  if (customApiKey && typeof customApiKey === 'string' && customApiKey.trim().length > 5) {
    return true;
  }
  const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  return hasKey && Date.now() >= geminiQuotaBlockedUntil;
}

export function handleGeminiApiError(context: string, err: any): boolean {
  const msg = err?.message || String(err);
  const status = err?.status || err?.code;
  const is429 =
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Quota exceeded') ||
    msg.includes('rate-limits');

  if (is429) {
    let delaySeconds = 15 * 60; // default 15 minutes
    try {
      const match = msg.match(/retry in\s+([0-9\.]+)s/i) || msg.match(/retryDelay":"?(\d+)/i);
      if (match && match[1]) {
        delaySeconds = Math.min(Math.max(parseInt(match[1], 10), 60), 86400);
      }
    } catch {}

    geminiQuotaBlockedUntil = Date.now() + delaySeconds * 1000;
    geminiQuotaBlockReason = `Gemini 配额达到限制 (429 RESOURCE_EXHAUSTED)。熔断保护冷却中（预计 ${Math.ceil(delaySeconds / 60)} 分钟后重试），请在自定义模型配置中切换其他模型或配置专属 API Key。`;
    console.log(`[Gemini Circuit Breaker] ${context}: ${geminiQuotaBlockReason}`);
    return true;
  }

  console.warn(`[Gemini Warning] ${context}:`, msg.length > 150 ? msg.slice(0, 150) + '...' : msg);
  return false;
}

export function createGeminiClient(customApiKey?: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: customApiKey || process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function sanitizeHttpHeaderValue(val?: any): string {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[^\x20-\x7E]/g, '').trim();
}

export function buildCustomOpenAiUrls(baseUrl: string): string[] {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) {
    return [clean];
  }
  if (clean.endsWith('/v1')) {
    const root = clean.replace(/\/v1$/, '');
    return [`${clean}/chat/completions`, `${root}/chat/completions`, `${root}/api/chat/completions`];
  }
  return [
    `${clean}/v1/chat/completions`,
    `${clean}/chat/completions`,
    `${clean}/api/chat/completions`,
    `${clean}/api/v1/chat/completions`
  ];
}

export function buildCustomAnthropicUrls(baseUrl: string): string[] {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/messages')) {
    return [clean];
  }
  if (clean.endsWith('/v1')) {
    return [`${clean}/messages`];
  }
  return [`${clean}/v1/messages`, `${clean}/messages`];
}

export function formatAnthropicMessages(
  messages: Array<{ role: string; content?: string; text?: string; sender?: string }>,
  systemInstruction?: string
): { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const systemParts: string[] = [];
  if (systemInstruction && systemInstruction.trim()) {
    systemParts.push(systemInstruction.trim());
  }
  const mapped: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    const txt = (m.content || m.text || '').trim();
    if (!txt) continue;
    if (m.role === 'system') {
      systemParts.push(txt);
      continue;
    }
    const role: 'user' | 'assistant' =
      m.role === 'peer' || m.sender === 'peer' || m.role === 'user' ? 'user' : 'assistant';
    if (mapped.length > 0 && mapped[mapped.length - 1].role === role) {
      mapped[mapped.length - 1].content += `\n${txt}`;
    } else {
      mapped.push({ role, content: txt });
    }
  }
  if (mapped.length === 0) {
    mapped.push({ role: 'user', content: 'Hello' });
  } else if (mapped[0].role === 'assistant') {
    mapped.unshift({ role: 'user', content: '...' });
  }
  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: mapped,
  };
}

// Official active Gemini models (Gemini 3.1 Flash Lite and above)
export const NATIVE_GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-4-hydrogen',
  'gemini-3.1-pro-preview',
  'gemini-4-argon',
  'gemini-4-carbon',
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.5-transcribe',
  'gemini-3.8-live',
];

export function normalizeGeminiModelName(rawName?: string): string {
  if (!rawName || typeof rawName !== 'string') return '';
  const clean = rawName.trim();
  const lowered = clean.toLowerCase().replace(/\s+/g, '-');
  if (lowered === 'gemini-3.1-flash-lite' || lowered === '3.1-flash-lite' || lowered === 'gemini-3.1-flashlite' || lowered === 'flash-lite') {
    return 'gemini-3.1-flash-lite';
  }
  if (lowered === 'gemini-3.5-flash-lite' || lowered === '3.5-flash-lite' || lowered === 'gemini-3.5-flashlite') {
    return 'gemini-3.5-flash-lite';
  }
  if (lowered === 'gemini-4-hydrogen' || lowered === '4-hydrogen' || lowered === 'gemini-hydrogen' || lowered === 'gemini-4-flash') {
    return 'gemini-4-hydrogen';
  }
  if (lowered === 'gemini-3.1-pro-preview' || lowered === '3.1-pro-preview') {
    return 'gemini-3.1-pro-preview';
  }
  if (lowered === 'gemini-4-argon' || lowered === '4-argon' || lowered === 'gemini-argon' || lowered === 'gemini-4-pro') {
    return 'gemini-4-argon';
  }
  if (lowered === 'gemini-4-carbon' || lowered === '4-carbon' || lowered === 'gemini-carbon') {
    return 'gemini-4-carbon';
  }
  if (
    lowered === 'gemini-3.8-flash-tts' ||
    lowered === '3.8-flash-tts' ||
    lowered === 'gemini-3.8-tts' ||
    lowered === '3.8-tts'
  ) {
    return 'gemini-3.8-flash-tts';
  }
  if (
    lowered === 'gemini-3.8-flash-lite-tts' ||
    lowered === '3.8-flash-lite-tts' ||
    lowered === 'gemini-3.8-lite-tts' ||
    lowered === '3.8-lite-tts'
  ) {
    return 'gemini-3.8-flash-lite-tts';
  }
  if (lowered === 'gemini-3.5-transcribe' || lowered === '3.5-transcribe') {
    return 'gemini-3.5-transcribe';
  }
  if (lowered === 'gemini-3.8-live' || lowered === '3.8-live') {
    return 'gemini-3.8-live';
  }
  return clean;
}

export function resolveGeminiModel(
  requestedModel?: string,
  taskType: 'chat' | 'translate' | 'transcribe' | 'tts' | 'analysis' = 'chat'
): string {
  if (requestedModel && typeof requestedModel === 'string' && requestedModel.trim()) {
    const clean = normalizeGeminiModelName(requestedModel);
    if (clean) return clean;
  }
  if (taskType === 'tts') {
    if (process.env.GEMINI_TTS_MODEL && process.env.GEMINI_TTS_MODEL.trim()) {
      return normalizeGeminiModelName(process.env.GEMINI_TTS_MODEL.trim());
    }
    return 'gemini-3.8-flash-tts';
  }
  if (taskType === 'transcribe') {
    if (process.env.GEMINI_MODEL && process.env.GEMINI_MODEL.trim()) {
      return normalizeGeminiModelName(process.env.GEMINI_MODEL.trim());
    }
    return 'gemini-3.5-transcribe';
  }
  if (process.env.GEMINI_MODEL && process.env.GEMINI_MODEL.trim()) {
    return normalizeGeminiModelName(process.env.GEMINI_MODEL.trim());
  }
  switch (taskType) {
    case 'translate':
    case 'analysis':
    case 'chat':
    default:
      return 'gemini-4-hydrogen';
  }
}

/**
 * Strictly returns the single resolved Gemini model (disables silent multi-model waterfall polling)
 */
export function getGeminiCandidateModels(primaryModel?: string): string[] {
  const chosen = primaryModel?.trim()
    ? normalizeGeminiModelName(primaryModel.trim())
    : resolveGeminiModel();
  return [chosen];
}

export function buildCustomGeminiUrl(baseUrl: string, modelName: string = 'gemini-4-hydrogen'): string {
  let clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.includes(':generateContent')) return clean;
  if (!clean.includes('/v1beta/models') && !clean.includes('/v1/models')) {
    clean = clean.replace(/\/v1beta$/i, '').replace(/\/v1$/i, '');
    return `${clean}/v1beta/models/${modelName}:generateContent`;
  }
  return `${clean}:generateContent`;
}

export function inferGatewayProtocol(
  baseUrl?: string,
  modelName?: string,
  explicitProtocol?: string
): 'openai' | 'gemini' | 'anthropic' {
  const url = (baseUrl || '').toLowerCase();
  const model = (modelName || '').toLowerCase();
  if (url.includes('googleapis.com')) return 'gemini';
  if (url.includes('anthropic.com')) return 'anthropic';
  if (
    url &&
    !url.includes('openai.com') &&
    !url.includes('deepseek.com') &&
    (explicitProtocol === 'gemini' || explicitProtocol === 'anthropic' || explicitProtocol === 'openai')
  ) {
    return explicitProtocol;
  }
  if (!url && model.includes('claude')) return 'anthropic';
  return 'openai';
}

// Commercial Workstation Account Cap & Private Cloud Brain Helpers
export const MAX_TELEGRAM_ACCOUNTS = 20;

export function getAuthorizedAccountsList(): string[] {
  const list = ['acc_telegram_bot'];
  for (let i = 1; i <= MAX_TELEGRAM_ACCOUNTS; i++) {
    list.push(`acc_${i}`);
  }
  return list;
}

export function hasReachedTelegramAccountLimit(activeUniqueUsersCount: number): boolean {
  return activeUniqueUsersCount >= MAX_TELEGRAM_ACCOUNTS;
}

let cachedLocalDeviceId: string | null = null;

export function getLocalMachineDeviceId(): string {
  const envOverride = (process.env.LX_DEVICE_ID || '').trim();
  if (envOverride) return envOverride;
  if (cachedLocalDeviceId) return cachedLocalDeviceId;

  const deviceFile = path.join(dbDir, 'device_fingerprint.id');
  let installUuid = '';
  try {
    if (fs.existsSync(deviceFile)) {
      installUuid = fs.readFileSync(deviceFile, 'utf8').trim();
    }
    if (!installUuid) {
      installUuid = crypto.randomUUID();
      fs.mkdirSync(dbDir, { recursive: true });
      fs.writeFileSync(deviceFile, installUuid, 'utf8');
    }
  } catch {
    installUuid = `${os.hostname()}-${os.platform()}-${os.arch()}`;
  }

  const cpuModel = os.cpus()?.[0]?.model || 'cpu';
  const rawFingerprint = `${os.hostname()}|${os.platform()}|${os.arch()}|${cpuModel}|${installUuid}`;
  const digest = crypto.createHash('sha256').update(rawFingerprint).digest('hex').slice(0, 24).toUpperCase();
  cachedLocalDeviceId = `LX-DEV-${digest}`;
  return cachedLocalDeviceId;
}

export const CLOUD_AUTH_BASE_URL = (
  process.env.CLOUD_AUTH_URL ||
  process.env.VITE_CLOUD_AUTH_URL ||
  'https://telegramaiintelligence.s233099099.workers.dev'
).replace(/\/+$/, '');

export function getRailwayBrainBaseUrl(): string {
  const envUrl = (process.env.RAILWAY_BRAIN_URL || process.env.RAILWAY_KB_URL || '').trim();
  const base = envUrl || CLOUD_AUTH_BASE_URL;
  return base.replace(/\/+$/, '');
}

export function isBuiltInCloudGatewayUrl(rawUrl?: string): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.includes('railway.app')) return true;
  try {
    const authHost = new URL(CLOUD_AUTH_BASE_URL).hostname.toLowerCase();
    if (authHost && trimmed.includes(authHost)) return true;
  } catch {}
  return false;
}

function buildRailwayAuthHeaders(
  apiKey?: string,
  userJwt?: string,
  engineLicenseKey?: string
): Record<string, string> {
  const cleanUserJwt = sanitizeHttpHeaderValue(userJwt);
  const cleanEngineKey = sanitizeHttpHeaderValue(
    engineLicenseKey || process.env.RAILWAY_BRAIN_KEY || ''
  );
  const cleanApiKey = sanitizeHttpHeaderValue(apiKey);
  const bearer = cleanEngineKey || cleanApiKey || cleanUserJwt;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Brand': 'LingXiContext/v1',
  };
  if (bearer) {
    headers['Authorization'] = `Bearer ${bearer}`;
  }
  if (cleanEngineKey) {
    headers['X-Engine-License'] = cleanEngineKey;
    headers['X-License-Key'] = cleanEngineKey;
    headers['X-Engine-Key'] = cleanEngineKey;
    headers['x-api-key'] = cleanEngineKey;
  } else if (cleanApiKey) {
    headers['x-api-key'] = cleanApiKey;
  }
  if (cleanUserJwt) {
    headers['X-User-JWT'] = cleanUserJwt;
  }
  return headers;
}

function sanitizePublicCustomLlmConfig(config: any): any {
  if (!config || typeof config !== 'object') return config;
  const clean = { ...config };
  if (typeof clean.baseUrl === 'string' && isBuiltInCloudGatewayUrl(clean.baseUrl)) {
    clean.baseUrl = '';
    if (!clean.engineMode) clean.engineMode = 'cloud';
  }
  if (typeof clean.knowledgeBaseApiUrl === 'string' && isBuiltInCloudGatewayUrl(clean.knowledgeBaseApiUrl)) {
    clean.knowledgeBaseApiUrl = '';
  }
  if (clean.engineMode === 'custom' && clean.enabled) {
    clean.enableKnowledgeBaseRAG = false;
  }
  return clean;
}

// Server-side active Custom LLM config cache for persistent background tasks (e.g. Autopilot)
let activeServerCustomLlmConfig: any = null;

export async function syncServerCustomLlmConfig(config: any) {
  if (!config || typeof config !== 'object') return;
  const sanitized = sanitizePublicCustomLlmConfig(config);
  activeServerCustomLlmConfig = { ...sanitized };
  railwayKbCache.clear();
  try {
    await db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('custom_llm_config', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(sanitized), Date.now());
  } catch {}
}

// Server-side active Translation Settings cache for persistent background tasks
let activeServerTranslationSettings: any = null;
let lastActiveUserJwt: string | null = null;

export function normalizeCloudGemmaTranslateModel(rawModel?: string): 'gemma-4-26b-a4b-it' | 'gemma-4-31b-it' {
  const lowered = typeof rawModel === 'string' ? rawModel.trim().toLowerCase() : '';
  if (lowered.includes('31b')) {
    return 'gemma-4-31b-it';
  }
  return 'gemma-4-26b-a4b-it';
}

export function normalizeStrictTranslationEngine(engine?: string): 'google' | 'gemini' | 'custom_llm' | null {
  if (engine === 'google' || engine === 'gemini' || engine === 'custom_llm') {
    return engine;
  }
  return null;
}

export async function syncServerTranslationSettings(settings: any) {
  if (!settings || typeof settings !== 'object') return;
  const normalizedEngine = normalizeStrictTranslationEngine(settings.preferredEngine) || 'gemini';
  const clean = {
    defaultSourceLang: typeof settings.defaultSourceLang === 'string' ? settings.defaultSourceLang : 'Auto',
    defaultTargetLang: typeof settings.defaultTargetLang === 'string' ? settings.defaultTargetLang : 'Chinese',
    autoTranslateInbound: settings.autoTranslateInbound !== false,
    autoTranslateOutbound: settings.autoTranslateOutbound !== false,
    showOriginalAndTranslation: settings.showOriginalAndTranslation !== false,
    preferredEngine: normalizedEngine,
    geminiModel: typeof settings.geminiModel === 'string' ? settings.geminiModel.trim() : '',
    geminiApiKey: typeof settings.geminiApiKey === 'string' ? settings.geminiApiKey.trim() : '',
    googleApiKey: typeof settings.googleApiKey === 'string' ? settings.googleApiKey.trim() : '',
    customModelName: typeof settings.customModelName === 'string' ? settings.customModelName.trim() : '',
  };
  activeServerTranslationSettings = { ...clean };
  try {
    await db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('translation_settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(clean), Date.now());
  } catch {}
}

export async function getServerTranslationSettings(): Promise<any> {
  if (activeServerTranslationSettings) return activeServerTranslationSettings;
  try {
    const row = (await db.prepare("SELECT value FROM system_config WHERE key = 'translation_settings'").get()) as any;
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      const normalizedEngine = normalizeStrictTranslationEngine(parsed?.preferredEngine) || 'gemini';
      activeServerTranslationSettings = { ...parsed, preferredEngine: normalizedEngine };
      return activeServerTranslationSettings;
    }
  } catch {}
  return null;
}

export async function getServerCustomLlmConfig(): Promise<any> {
  if (activeServerCustomLlmConfig) return sanitizePublicCustomLlmConfig(activeServerCustomLlmConfig);
  try {
    const row = (await db.prepare("SELECT value FROM system_config WHERE key = 'custom_llm_config'").get()) as any;
    if (row && row.value) {
      activeServerCustomLlmConfig = sanitizePublicCustomLlmConfig(JSON.parse(row.value));
      return activeServerCustomLlmConfig;
    }
  } catch {}
  return null;
}

/**
 * Universal Custom LLM caller supporting both OpenAI, Gemini, and LingXi Private Cloud Brain protocols seamlessly.
 * - Uses local daily usage tracker + upstream x-ratelimit-remaining header extraction (no fabricated quotas).
 */
interface CustomModelDailyUsageStore {
  date: string;
  counts: Record<string, Record<string, number>>;
  rateLimits: Record<string, Record<string, { remaining?: string; limit?: string; reset?: string; updatedAt: number }>>;
}

function getTodayUsageDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getUsageBucketKey(apiKey?: string, baseUrl?: string): string {
  const normKey = (apiKey || '').trim();
  const normUrl = (baseUrl || '').trim().toLowerCase().replace(/\/+$/, '');
  return crypto.createHash('sha256').update(`${normKey}|${normUrl}`).digest('hex').slice(0, 12);
}

let customModelDailyUsageCache: CustomModelDailyUsageStore | null = null;

async function ensureDailyUsageStoreLoaded(): Promise<CustomModelDailyUsageStore> {
  const today = getTodayUsageDateKey();
  if (customModelDailyUsageCache && customModelDailyUsageCache.date === today) {
    return customModelDailyUsageCache;
  }
  try {
    const row = (await db.prepare("SELECT value FROM system_config WHERE key = 'custom_llm_daily_usage'").get()) as any;
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (parsed && parsed.date === today) {
        customModelDailyUsageCache = {
          date: today,
          counts: parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {},
          rateLimits: parsed.rateLimits && typeof parsed.rateLimits === 'object' ? parsed.rateLimits : {},
        };
        return customModelDailyUsageCache;
      }
    }
  } catch {}
  customModelDailyUsageCache = { date: today, counts: {}, rateLimits: {} };
  return customModelDailyUsageCache;
}

function persistDailyUsageStoreAsync(store: CustomModelDailyUsageStore) {
  db.prepare(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES ('custom_llm_daily_usage', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
    .run(JSON.stringify(store), Date.now())
    .catch(() => {});
}

function extractRateLimitFromHeaders(headers?: Headers | null): { remaining?: string; limit?: string; reset?: string } | null {
  if (!headers) return null;
  const remaining =
    headers.get('x-ratelimit-remaining-requests') ||
    headers.get('x-ratelimit-remaining') ||
    headers.get('anthropic-ratelimit-requests-remaining') ||
    undefined;
  const limit =
    headers.get('x-ratelimit-limit-requests') ||
    headers.get('x-ratelimit-limit') ||
    headers.get('anthropic-ratelimit-requests-limit') ||
    undefined;
  const reset =
    headers.get('x-ratelimit-reset-requests') ||
    headers.get('x-ratelimit-reset') ||
    headers.get('anthropic-ratelimit-requests-reset') ||
    undefined;
  if (!remaining && !limit) return null;
  return { remaining, limit, reset };
}

async function recordCustomLlmModelUsage({
  apiKey,
  baseUrl,
  modelName,
  headers,
  increment = true,
}: {
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  headers?: Headers | null;
  increment?: boolean;
}) {
  const cleanModel = (modelName || '').trim();
  if (!cleanModel) return;
  const store = await ensureDailyUsageStoreLoaded();
  const bucket = getUsageBucketKey(apiKey, baseUrl);
  if (!store.counts[bucket]) store.counts[bucket] = {};
  if (!store.rateLimits[bucket]) store.rateLimits[bucket] = {};

  if (increment) {
    store.counts[bucket][cleanModel] = (store.counts[bucket][cleanModel] || 0) + 1;
  }
  const rl = extractRateLimitFromHeaders(headers);
  if (rl) {
    store.rateLimits[bucket][cleanModel] = { ...rl, updatedAt: Date.now() };
  }
  persistDailyUsageStoreAsync(store);
}

export function getModelTierTag(modelId: string): string {
  const l = (modelId || '').toLowerCase();
  const isLatestAlias = l.includes('-latest') || l.endsWith('latest');
  const isPreview = l.includes('preview') || l.includes('-exp') || l.includes('experimental');
  const isNewGen =
    /(?:gemini-(?:4|3\.5|3\.1|3(?:[-.]|$))|gpt-5|gpt-4\.5|gpt-4\.1|claude-(?:4|sonnet-4|opus-4|3-7)|deepseek-v4|o[34])/.test(
      l
    ) || isLatestAlias;

  if (isPreview) return isNewGen ? '最新 · 预览版' : '预览版';
  if (l.includes('reasoner') || l.includes('thinking') || /\bo[134](?:-|$)/.test(l)) {
    return isNewGen ? '最新 · 深度推理' : '深度推理';
  }
  if (l.includes('lite') || l.includes('mini') || l.includes('nano') || l.includes('haiku')) {
    return isNewGen ? '最新 · 轻量低耗' : '轻量低耗';
  }
  if (l.includes('flash') || l.includes('chat')) {
    return isNewGen ? '最新 · 极速高配额' : '极速高配额';
  }
  if (l.includes('pro') || l.includes('opus') || l.includes('sonnet') || l.includes('gpt-4o') || l.includes('gpt-5')) {
    return isNewGen ? '最新 · 旗舰性能' : '旗舰性能';
  }
  if (isLatestAlias) return '官方最新别名';
  return isNewGen ? '最新推荐' : '通用对话';
}

async function buildModelUsageDetails({
  modelIds,
  apiKey,
  baseUrl,
}: {
  modelIds: string[];
  apiKey?: string;
  baseUrl?: string;
}): Promise<Array<{ id: string; tierTag: string; todayCount: number; rateLimitRemaining?: string; rateLimitLimit?: string }>> {
  const store = await ensureDailyUsageStoreLoaded();
  const bucket = getUsageBucketKey(apiKey, baseUrl);
  const bucketCounts = store.counts[bucket] || {};
  const bucketLimits = store.rateLimits[bucket] || {};
  return modelIds.map((id) => {
    const rl = bucketLimits[id];
    return {
      id,
      tierTag: getModelTierTag(id),
      todayCount: bucketCounts[id] || 0,
      ...(rl?.remaining ? { rateLimitRemaining: rl.remaining } : {}),
      ...(rl?.limit ? { rateLimitLimit: rl.limit } : {}),
    };
  });
}

export async function callCustomLlm({
  customConfig,
  messages,
  systemInstruction,
  temperature = 0.7,
  maxTokens = 600,
  timeoutMs = 15000,
  userJwt,
  throwOnError = false,
  skipSync = false,
  extraPayload,
}: {
  customConfig: any;
  messages: Array<{ role: string; content?: string; text?: string; sender?: string }>;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  userJwt?: string;
  throwOnError?: boolean;
  skipSync?: boolean;
  extraPayload?: Record<string, any>;
}): Promise<string | null> {
  const isCloudEngineMode =
    customConfig?.engineMode === 'cloud' ||
    (customConfig?.enabled && customConfig?.engineMode !== 'custom' && !customConfig?.baseUrl?.trim());
  if (!customConfig?.enabled && !customConfig?.engineLicenseKey) {
    if (throwOnError) throw new Error('自定义大模型未启用');
    return null;
  }
  if (!isCloudEngineMode && !customConfig?.baseUrl) {
    if (throwOnError) throw new Error('自定义大模型 Base URL 未配置');
    return null;
  }

  // Synchronize to background cache asynchronously
  if (!skipSync) {
    syncServerCustomLlmConfig(customConfig).catch(() => {});
  }

  let lastErrorMsg = '';

  try {
    const cleanBaseUrl = isCloudEngineMode
      ? `${getRailwayBrainBaseUrl()}/v1`
      : customConfig.baseUrl.trim().replace(/\/+$/, '');
    const effectiveProtocol = isCloudEngineMode
      ? 'openai'
      : inferGatewayProtocol(cleanBaseUrl, customConfig.modelName, customConfig.protocol);
    let extraHeaders: Record<string, string> = {};
    if (customConfig.customHeaders) {
      try {
        extraHeaders = typeof customConfig.customHeaders === 'string'
          ? JSON.parse(customConfig.customHeaders)
          : customConfig.customHeaders;
      } catch {}
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (!isCloudEngineMode && effectiveProtocol === 'gemini') {
        const targetUrl = buildCustomGeminiUrl(cleanBaseUrl, customConfig.modelName || 'gemini-4-hydrogen');

        const contents = messages.map((m: any) => {
          const role =
            m.role === 'peer' || m.sender === 'peer' || m.role === 'user' ? 'user' : 'model';
          const txt = m.content || m.text || '';
          return {
            role,
            parts: [{ text: txt }],
          };
        });

        const cleanKey = sanitizeHttpHeaderValue(customConfig.apiKey);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(cleanKey
            ? (cleanKey.startsWith('ya29.')
                ? { Authorization: `Bearer ${cleanKey}` }
                : { 'x-goog-api-key': cleanKey })
            : {}),
          ...extraHeaders,
        };

        const payload: any = {
          contents,
          generationConfig: {
            temperature: customConfig.temperature ?? temperature,
            maxOutputTokens: maxTokens,
          },
        };

        if (systemInstruction) {
          payload.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        try {
          const resGemini = await safeSsrfFetch(targetUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          if (resGemini.ok) {
            const d = await resGemini.json();
            const replyText = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (replyText) {
              recordCustomLlmModelUsage({
                apiKey: cleanKey,
                baseUrl: cleanBaseUrl,
                modelName: customConfig.modelName || 'gemini-4-hydrogen',
                headers: resGemini.headers,
              }).catch(() => {});
              return replyText;
            }
            lastErrorMsg = '自定义 Gemini 网关未返回有效文本内容';
          } else {
            const errBody = await resGemini.text().catch(() => '');
            lastErrorMsg = `自定义 Gemini 网关返回 HTTP ${resGemini.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`;
          }
        } catch (err: any) {
          lastErrorMsg = err?.message || String(err);
          console.warn('[Custom LLM Gemini Protocol Warning]:', lastErrorMsg);
        }
      } else if (!isCloudEngineMode && effectiveProtocol === 'anthropic') {
        const candidateUrls = buildCustomAnthropicUrls(cleanBaseUrl);
        const cleanKey = sanitizeHttpHeaderValue(customConfig.apiKey);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...(cleanKey ? { 'x-api-key': cleanKey } : {}),
          ...extraHeaders,
        };
        const { system: anthropicSystem, messages: anthropicMessages } = formatAnthropicMessages(
          messages,
          systemInstruction
        );
        const rawTemp = Number(customConfig.temperature ?? temperature);
        const anthropicTemp = Number.isFinite(rawTemp) ? Math.min(Math.max(rawTemp, 0), 1) : 0.7;

        for (const targetUrl of candidateUrls) {
          try {
            const response = await safeSsrfFetch(targetUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: customConfig.modelName || 'claude-3-5-sonnet-20241022',
                max_tokens: maxTokens,
                temperature: anthropicTemp,
                ...(anthropicSystem ? { system: anthropicSystem } : {}),
                messages: anthropicMessages,
              }),
              signal: controller.signal,
            });

            if (response.ok) {
              const data = await response.json();
              const replyText = Array.isArray(data?.content)
                ? data.content
                    .filter((c: any) => c?.type === 'text' && typeof c?.text === 'string')
                    .map((c: any) => c.text)
                    .join('')
                    .trim()
                : '';
              if (replyText) {
                recordCustomLlmModelUsage({
                  apiKey: cleanKey,
                  baseUrl: cleanBaseUrl,
                  modelName: customConfig.modelName || 'claude-3-5-sonnet-20241022',
                  headers: response.headers,
                }).catch(() => {});
                return replyText;
              }
              lastErrorMsg = 'Anthropic 模型网关返回空内容';
            } else {
              const errBody = await response.text().catch(() => '');
              lastErrorMsg = `Anthropic 模型网关返回 HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`;
            }
            if (response.status !== 404) break;
          } catch (e: any) {
            lastErrorMsg = e?.message || String(e);
          }
        }
      } else {
        // OpenAI Protocol (or Private Cloud Brain Gateway)
        const candidateUrls = buildCustomOpenAiUrls(cleanBaseUrl);
        const cleanKey = sanitizeHttpHeaderValue(customConfig.apiKey);
        const headers: Record<string, string> = isCloudEngineMode
          ? {
              ...buildRailwayAuthHeaders(cleanKey, userJwt, customConfig.engineLicenseKey),
              ...extraHeaders,
            }
          : {
              'Content-Type': 'application/json',
              ...(cleanKey ? { Authorization: `Bearer ${cleanKey}` } : {}),
              ...extraHeaders,
            };

        const formattedMessages: Array<{ role: string; content: string }> = [];
        if (systemInstruction) {
          formattedMessages.push({ role: 'system', content: systemInstruction });
        }
        for (const m of messages) {
          const role =
            m.role === 'system'
              ? 'system'
              : m.role === 'peer' || m.sender === 'peer' || m.role === 'user'
              ? 'user'
              : 'assistant';
          formattedMessages.push({
            role,
            content: m.content || m.text || '',
          });
        }

        for (const targetUrl of candidateUrls) {
          try {
            const response = await safeSsrfFetch(targetUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                ...(extraPayload || {}),
                model: customConfig.modelName || 'gpt-4o-mini',
                messages: formattedMessages,
                temperature: customConfig.temperature ?? temperature,
                max_tokens: maxTokens,
              }),
              signal: controller.signal,
            });

            if (response.ok) {
              const data = await response.json();
              const replyText = data?.choices?.[0]?.message?.content?.trim();
              if (replyText) {
                if (!isCloudEngineMode) {
                  recordCustomLlmModelUsage({
                    apiKey: cleanKey,
                    baseUrl: cleanBaseUrl,
                    modelName: customConfig.modelName || 'gpt-4o-mini',
                    headers: response.headers,
                  }).catch(() => {});
                }
                return replyText;
              }
              lastErrorMsg = '自定义模型网关返回空内容';
            } else {
              const errBody = await response.text().catch(() => '');
              lastErrorMsg = `自定义模型网关返回 HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`;
            }
            if (response.status !== 404) break;
          } catch (e: any) {
            lastErrorMsg = e?.message || String(e);
            // try next candidate url
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: any) {
    lastErrorMsg = err?.message || String(err);
    console.warn('[callCustomLlm Error]:', lastErrorMsg);
  }

  if (throwOnError) {
    throw new Error(lastErrorMsg || '自定义大模型请求失败，未能获取有效响应');
  }
  return null;
}

/**
 * Transcodes arbitrary audio (PCM WAV, MP3, etc.) to Telegram native standard OGG Opus format.
 * Telegram Bot API /sendVoice strictly requires audio/ogg with Opus codec to render native round voice bubbles with waveforms.
 */
export async function convertAudioToOggOpus(input: Buffer | string): Promise<Buffer> {
  const isFilePath = typeof input === 'string';
  if (isFilePath) {
    if (!input || !fs.existsSync(input)) {
      throw new Error('音频文件不存在，无法转码为 OGG Opus');
    }
    const stat = fs.statSync(input);
    if (stat.size === 0) {
      throw new Error('音频数据为空，无法转码为 OGG Opus');
    }
    try {
      const head = Buffer.alloc(4);
      const fd = fs.openSync(input, 'r');
      try {
        fs.readSync(fd, head, 0, 4, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (head.toString() === 'OggS') {
        return await fs.promises.readFile(input);
      }
    } catch {}
  } else {
    if (!input || input.length === 0) {
      throw new Error('音频数据为空，无法转码为 OGG Opus');
    }
    // If already Ogg container with OggS magic header, return directly
    if (input.length >= 4 && input.slice(0, 4).toString() === 'OggS') {
      return input;
    }
  }

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const ffmpegArgs = isFilePath
        ? [
            '-loglevel', 'error',
            '-i', input,
            '-c:a', 'libopus',
            '-b:a', '32k',
            '-vbr', 'on',
            '-application', 'voip',
            '-f', 'ogg',
            'pipe:1',
          ]
        : [
            '-loglevel', 'error',
            '-i', 'pipe:0',
            '-c:a', 'libopus',
            '-b:a', '32k',
            '-vbr', 'on',
            '-application', 'voip',
            '-f', 'ogg',
            'pipe:1',
          ];

      const proc = spawn('ffmpeg', ffmpegArgs);

      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      proc.stdout.on('data', (chunk) => chunks.push(chunk));
      proc.stderr.on('data', (chunk) => errChunks.push(chunk));

      let finished = false;
      proc.on('error', (err) => {
        if (!finished) {
          finished = true;
          reject(new Error(`音频转码器 ffmpeg 启动失败: ${err.message}`));
        }
      });

      proc.on('close', (code) => {
        if (!finished) {
          finished = true;
          if (code === 0 && chunks.length > 0) {
            const out = Buffer.concat(chunks);
            if (out.length > 0 && out.slice(0, 4).toString() === 'OggS') {
              return resolve(out);
            }
          }
          const stderrText = Buffer.concat(errChunks).toString('utf8').trim();
          reject(
            new Error(
              `ffmpeg OGG Opus 转码失败 (exit=${code})${stderrText ? `: ${stderrText}` : ''}`
            )
          );
        }
      });

      if (!isFilePath) {
        proc.stdin.on('error', (err) => {
          if (!finished) {
            finished = true;
            reject(new Error(`写入 ffmpeg 输入流失败: ${err.message}`));
          }
        });
        proc.stdin.end(input);
      } else {
        proc.stdin.end();
      }
    } catch (e: any) {
      reject(new Error(`音频转码异常: ${e?.message || e}`));
    }
  });
}

/**
 * High-Performance SQL-level RAG Knowledge Search.
 * Avoids dumping the entire knowledge base table into Node.js process memory.
 * Uses parameterised SQL LIKE filtering to retrieve at most top 25 candidates directly from the database,
 * then performs refined scoring in memory on the tiny candidate slice.
 */
export async function queryKnowledgeRAG(
  queryText: string,
  maxResults = 3
): Promise<{
  context: string;
  matchedCount: number;
  matchedItems: any[];
}> {
  try {
    if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
      return {
        context: '',
        matchedCount: 0,
        matchedItems: [],
      };
    }

    const cleanText = queryText.toLowerCase();
    const tokenSet = new Set<string>();

    // 1. Match English words & terms (e.g. "caxton", "hedging", "anna")
    const enWords = cleanText.match(/[a-z0-9_-]{2,20}/g) || [];
    for (const w of enWords) {
      if (w.length >= 2 && !['the', 'and', 'for', 'are', 'you', 'with', 'from'].includes(w)) {
        tokenSet.add(w);
      }
    }

    // 2. Segment CJK phrases and extract salient n-grams (do not chop ASCII English words into 2-letter substrings)
    const cjkSegments = cleanText.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (const seg of cjkSegments) {
      if (seg.length <= 4) {
        tokenSet.add(seg);
      }
      for (let len = 2; len <= Math.min(4, seg.length); len++) {
        for (let i = 0; i <= seg.length - len && tokenSet.size < 20; i++) {
          tokenSet.add(seg.substring(i, i + len));
        }
      }
    }

    const stopWords = new Set([
      '今天', '一直', '去吗', '还去', '是在', '想喝', '这个', '那个', '什么', '可以',
      '没有', '怎么', '我们', '你们', '他们', '现在', '明天', '昨天', '知道', '觉得',
      '一下', '好的', '好的呀', '哈哈', '一个', '还是', '怎么会'
    ]);
    const searchTerms = Array.from(tokenSet).filter((t) => !stopWords.has(t)).slice(0, 8);

    if (searchTerms.length === 0) {
      return {
        context: '',
        matchedCount: 0,
        matchedItems: [],
      };
    }

    // 3. Query SQL with targeted LIKE conditions strictly on searchTerms
    const whereParts = searchTerms.map(() => '(keywords LIKE ? OR title LIKE ? OR content LIKE ?)');
    const sql = `
      SELECT id, category, title, content, keywords, hit_count
      FROM knowledge_base
      WHERE is_active = 1 AND (${whereParts.join(' OR ')})
      ORDER BY hit_count DESC
      LIMIT 25
    `;
    const params: any[] = [];
    for (const t of searchTerms) {
      const pattern = `%${t}%`;
      params.push(pattern, pattern, pattern);
    }
    const candidates = (await db.prepare(sql).all(...params)) as any[];

    if (candidates.length === 0) {
      return {
        context: '',
        matchedCount: 0,
        matchedItems: [],
      };
    }

    // 4. Refined scoring on the matched candidate slice (strictly require score > 0)
    const scored = candidates.map((item) => {
      let score = 0;
      let kwList: string[] = [];
      try {
        kwList = JSON.parse(item.keywords || '[]');
      } catch {
        kwList = [];
      }

      for (const term of searchTerms) {
        if (item.title && item.title.toLowerCase().includes(term)) score += 5;
        if (kwList.some((k) => k.toLowerCase().includes(term) || term.includes(k.toLowerCase()))) score += 4;
        if (item.content && item.content.toLowerCase().includes(term)) score += 2;
      }
      return { item, score, isGenuineMatch: score > 0 };
    });

    const genuineMatches = scored.filter((s) => s.isGenuineMatch).sort((a, b) => b.score - a.score);
    if (genuineMatches.length === 0) {
      return {
        context: '',
        matchedCount: 0,
        matchedItems: [],
      };
    }

    const chosenItems = genuineMatches.slice(0, maxResults).map((s) => s.item);

    // Asynchronously update hit count counters only for genuinely matched items
    setImmediate(async () => {
      try {
        const updateHit = db.prepare('UPDATE knowledge_base SET hit_count = hit_count + 1 WHERE id = ?');
        for (const item of chosenItems) {
          await updateHit.run(item.id);
        }
      } catch {}
    });

    const context = `\n【知识库精准业务规范与话术匹配（核心参考）】：\n${chosenItems.map((k: any) => `* [${k.title}]: ${k.content}`).join('\n')}\n`;

    return {
      context,
      matchedCount: genuineMatches.length,
      matchedItems: chosenItems,
    };
  } catch (err: any) {
    console.warn('[Knowledge RAG] Retrieval error:', err.message);
    return { context: '', matchedCount: 0, matchedItems: [] };
  }
}

// Auto-recover existing valid database snapshots if available (zero fake seed data)
async function seedDatabaseIfEmpty() {
  const count = (await db.prepare('SELECT count(*) as cnt FROM messages').get()) as { cnt: number };
  if (!count || count.cnt === 0) {
    const autoRestored = await autoRestoreSnapshotIfAvailable();
    if (autoRestored) {
      console.log(`[Database Auto-Recovery] Existing customer conversation records and long-term memory restored from snapshot.`);
    }
  }
}

// ==================== IN-MEMORY CONNECTED TELEGRAM PERSONAL ACCOUNTS ====================
export interface ConnectedTelegramUser {
  client: TelegramClient;
  phone: string;
  userId: string;
  username: string;
  firstName: string;
  lastName?: string;
  avatarInitial: string;
  avatarBg: string;
  apiId: number;
  apiHash: string;
  connectedAt: number;
  dialogs: Array<{
    id: string;
    rawId: string;
    title: string;
    username: string;
    isGroup: boolean;
    lastMessage: string;
    lastTime: string;
    unreadCount: number;
    avatarUrl?: string;
    avatarInitial: string;
    avatarBg: string;
  }>;
}

// In-memory active connected Telegram personal user accounts (kept purely in local memory)
export const connectedUserClients = new Map<string, ConnectedTelegramUser>();

function formatTelegramFileSize(bytes?: number): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function summarizeTelegramDialogMedia(message: any): string {
  if (!message) return '暂无消息';
  const text = String(message.message || '').trim();
  const media = message.media;
  if (!media) return text || '暂无消息';
  if (text) return text;

  const doc = media.document;
  const attrs: any[] = Array.isArray(doc?.attributes) ? doc.attributes : [];
  const audioAttr = attrs.find((a) => a.className === 'DocumentAttributeAudio');
  const videoAttr = attrs.find((a) => a.className === 'DocumentAttributeVideo');
  const stickerAttr = attrs.find((a) => a.className === 'DocumentAttributeSticker');
  const filenameAttr = attrs.find((a) => a.className === 'DocumentAttributeFilename');
  const mimeType = String(doc?.mimeType || '').toLowerCase();

  if (audioAttr || mimeType.startsWith('audio/')) {
    return audioAttr?.voice ? '🎤 语音消息' : `🎵 音频${filenameAttr?.fileName ? `: ${filenameAttr.fileName}` : ''}`;
  }
  if (videoAttr || mimeType.startsWith('video/')) {
    return videoAttr?.roundMessage ? '🎥 视频消息' : '🎬 视频';
  }
  if (stickerAttr) {
    return stickerAttr.alt ? `${stickerAttr.alt} [贴纸]` : '🖼️ 贴纸';
  }
  if (media.photo || media.className === 'MessageMediaPhoto' || mimeType.startsWith('image/')) {
    return '🖼️ 图片';
  }
  if (doc) {
    return `📎 ${filenameAttr?.fileName || '文件'}`;
  }
  if (media.className === 'MessageMediaGeo' || media.className === 'MessageMediaGeoLive') {
    return '📍 位置信息';
  }
  if (media.className === 'MessageMediaContact') {
    return '👤 联系人名片';
  }
  if (media.className === 'MessageMediaPoll') {
    return '📊 投票';
  }
  return '📎 媒体消息';
}

function formatTelegramUserStatus(userEntity: any): { isOnline: boolean; statusText: string } {
  if (!userEntity) return { isOnline: false, statusText: '状态未知' };
  const uid = String(userEntity.id || '');
  if (uid === '777000' || uid === '42777') {
    return { isOnline: false, statusText: '官方服务通知' };
  }
  if (userEntity.bot) {
    return { isOnline: false, statusText: '机器人 (Bot)' };
  }
  const st: any = userEntity.status;
  if (!st || !st.className) {
    return { isOnline: false, statusText: '很久未上线' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (st.className === 'UserStatusOnline') {
    if (st.expires && Number(st.expires) > nowSec) {
      return { isOnline: true, statusText: '在线' };
    }
    return { isOnline: false, statusText: '刚刚在线' };
  }
  if (st.className === 'UserStatusRecently') {
    return { isOnline: false, statusText: '最近在线' };
  }
  if (st.className === 'UserStatusLastWeek') {
    return { isOnline: false, statusText: '一周内在线' };
  }
  if (st.className === 'UserStatusLastMonth') {
    return { isOnline: false, statusText: '一月内在线' };
  }
  if (st.className === 'UserStatusOffline' && st.wasOnline) {
    const wasSec = Number(st.wasOnline);
    const diff = Math.max(0, nowSec - wasSec);
    if (diff < 60) return { isOnline: false, statusText: '刚刚在线' };
    if (diff < 3600) return { isOnline: false, statusText: `${Math.floor(diff / 60)} 分钟前在线` };
    const wasDate = new Date(wasSec * 1000);
    const nowDate = new Date(nowSec * 1000);
    const hhmm = wasDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (wasDate.toDateString() === nowDate.toDateString()) {
      return { isOnline: false, statusText: `最后上线 今日 ${hhmm}` };
    }
    const yesterday = new Date((nowSec - 86400) * 1000);
    if (wasDate.toDateString() === yesterday.toDateString()) {
      return { isOnline: false, statusText: `最后上线 昨日 ${hhmm}` };
    }
    const mm = String(wasDate.getMonth() + 1).padStart(2, '0');
    const dd = String(wasDate.getDate()).padStart(2, '0');
    return { isOnline: false, statusText: `最后上线 ${mm}/${dd} ${hhmm}` };
  }
  return { isOnline: false, statusText: '很久未上线' };
}

export async function fetchTelegramUserDialogs(client: TelegramClient, limit = 150, explicitUserId?: string) {
  try {
    const ownerUserId = explicitUserId || ((client as any)?._selfId ? String((client as any)._selfId) : '');
    const accountScope = ownerUserId ? `acc_tg_${ownerUserId}` : '';
    const mainDialogs = await client.getDialogs({ limit });
    let archivedDialogs: any[] = [];
    try {
      archivedDialogs = await client.getDialogs({ limit: Math.min(limit, 80), folder: 1 });
    } catch {
      archivedDialogs = [];
    }

    const mergedMap = new Map<string, { dialog: any; forcedArchived: boolean }>();
    for (const d of mainDialogs) {
      if (!d || d.id === undefined || d.id === null) continue;
      mergedMap.set(String(d.id), { dialog: d, forcedArchived: false });
    }
    for (const d of archivedDialogs) {
      if (!d || d.id === undefined || d.id === null) continue;
      const key = String(d.id);
      mergedMap.set(key, { dialog: d, forcedArchived: true });
    }

    const nowSec = Math.floor(Date.now() / 1000);

    return Array.from(mergedMap.values()).map(({ dialog: d, forcedArchived }) => {
      const entity: any = d.entity || {};
      const isOfficial = String(d.id) === '777000' || String(entity?.id) === '777000' || String(d.id) === '42777';
      const isBroadcastChannel = Boolean(
        (entity?.className === 'Channel' && !entity?.megagroup) ||
          (d.isChannel && !d.isGroup)
      );
      const isGroup = Boolean(d.isGroup && !isBroadcastChannel);
      const isChannel = Boolean(isBroadcastChannel);
      const isBot = Boolean(entity?.className === 'User' && entity?.bot);
      const isPinned = Boolean(d.pinned || d.dialog?.pinned);
      const isArchived = Boolean(forcedArchived || d.folderId === 1 || d.dialog?.folderId === 1);
      const notify = d.dialog?.notifySettings;
      const isMuted = Boolean(
        notify?.silent ||
          (notify?.muteUntil !== undefined && notify?.muteUntil !== null && Number(notify.muteUntil) > nowSec)
      );
      const isVerified = Boolean(isOfficial || entity?.verified);
      const memberCount = entity?.participantsCount ? Number(entity.participantsCount) : undefined;
      const userStatus = !isGroup && !isChannel ? formatTelegramUserStatus(entity) : { isOnline: false, statusText: undefined };

      const title = isOfficial
        ? 'Telegram 官方服务'
        : (d.title || d.name || entity.firstName || entity.title || `TG_${d.id}`);
      const username = entity.username ? `@${entity.username}` : (isOfficial ? '@Telegram' : '');
      const lastMessage = summarizeTelegramDialogMedia(d.message);
      const timestamp = d.date
        ? new Date(d.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : '刚刚';
      const unreadCount = Number(d.unreadCount || 0) || (d.dialog?.unreadMark ? 1 : 0);
      const readOutboxMaxId = Number(d.dialog?.readOutboxMaxId || 0) || undefined;
      const readInboxMaxId = Number(d.dialog?.readInboxMaxId || 0) || undefined;
      const chatId = `tg_${d.id}`;
      const avatarUrl = signTelegramResourceUrl(`/api/telegram/user/avatar/${encodeURIComponent(String(d.id))}`, accountScope);

      return {
        id: chatId,
        rawId: String(d.id),
        title,
        username,
        isGroup,
        isChannel,
        isBot,
        isPinned,
        isArchived,
        isMuted,
        isVerified,
        isOnline: userStatus.isOnline,
        statusText: userStatus.statusText,
        memberCount,
        lastMessage,
        lastTime: timestamp,
        lastDate: d.date ? Number(d.date) : 0,
        unreadCount,
        readOutboxMaxId,
        readInboxMaxId,
        avatarUrl,
        avatarInitial: isOfficial ? 'TG' : (title || 'TG').slice(0, 2).toUpperCase(),
        avatarBg: isChannel ? '#3b5998' : isGroup ? '#1e3a5f' : isBot ? '#6b4fbb' : '#2481cc',
      };
    });
  } catch (err: any) {
    if (isTelegramSessionExpiredError(err)) {
      throw err;
    }
    console.warn('[Telegram User Dialogs Warning]:', err.message);
    return [];
  }
}

// ==================== SECURITY HARDENING & ENCRYPTION INFRASTRUCTURE ====================

// Helper to perform constant-time, fixed-length comparison of tokens preventing byte and length timing side-channel attacks
export function verifySecretToken(received: string | undefined, expected: string): boolean {
  if (!received || typeof received !== 'string' || !expected || typeof expected !== 'string') return false;
  const receivedDigest = crypto.createHash('sha256').update(received, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(receivedDigest, expectedDigest);
}

// Strict Origin & Referer validator for Windows Electron & Dev Preview (Defends against Localhost CSRF)
export function isAllowedClientOrigin(req: Request): boolean {
  const origin = (req.headers.origin as string) || (req.headers.referer as string);
  // Direct desktop requests (Electron direct IPC/HTTP without origin, or native fetch)
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    const protocol = parsed.protocol;

    // Electron local packaging protocols
    if (protocol === 'file:' || protocol === 'app:' || protocol === 'electron:' || protocol === 'vscode-webview:') {
      return true;
    }

    // Localhost / Loopback workstation addresses
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
      return true;
    }

    // Match the current Host header of this server instance (must compare Origin hostname against Host, never allow arbitrary Origin just because server runs on loopback)
    const currentHost = (req.get('host') || '').split(':')[0].toLowerCase();
    if (currentHost && hostname.toLowerCase() === currentHost) {
      return true;
    }

    // Google Cloud / AI Studio preview environments
    if (hostname.endsWith('.run.app') || hostname.endsWith('.google.com') || hostname.endsWith('.googleusercontent.com')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// Persistent Local Device Secret for Desktop Client Operation (ensures encryption key is stable across restarts)
function getOrGenerateDeviceSecret(): string {
  try {
    const secretPath = path.join(dbDir, '.device_secret');
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    const newSecret = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(secretPath, newSecret, { mode: 0o600 }); } catch {}
    return newSecret;
  } catch {
    return 'tg_pro_desktop_local_secret_' + crypto.randomBytes(16).toString('hex');
  }
}
const PERSISTENT_DEVICE_SECRET = getOrGenerateDeviceSecret();

if (
  (process.env.NODE_ENV === 'production' || isTurso) &&
  !process.env.SESSION_ENCRYPTION_KEY &&
  !process.env.APP_SESSION_SECRET
) {
  console.warn(
    isTurso && !isPersistentVolume
      ? '[Security Warning] 当前连接 Turso 云端数据库但未配置 SESSION_ENCRYPTION_KEY / APP_SESSION_SECRET 且本地无持久卷，容器重建后 .device_secret 变更将导致已加密的 Telegram 会话无法解密！请在环境变量显式配置固定强密钥。'
      : '[Security Warning] SESSION_ENCRYPTION_KEY / APP_SESSION_SECRET 未配置，当前使用本地 .device_secret 派生密钥，建议在生产环境变量中显式配置独立强密钥。'
  );
}

// Secret key for signing / verifying master administrative or instance sessions
const MASTER_SECRET = process.env.APP_SESSION_SECRET || process.env.SESSION_SECRET || PERSISTENT_DEVICE_SECRET;

// HMAC-SHA256 resource URL signing for browser-loaded <img>/<video>/<audio>/<a> assets
const TELEGRAM_RESOURCE_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signTelegramResourceUrl(
  rawPathWithQuery: string,
  accountScope = '',
  ttlMs = TELEGRAM_RESOURCE_URL_TTL_MS
): string {
  const [basePath, existingQuery] = String(rawPathWithQuery || '').split('?');
  const params = new URLSearchParams(existingQuery || '');
  if (accountScope && !params.get('accountId')) {
    params.set('accountId', accountScope);
  }
  const effectiveAcc = params.get('accountId') || '';
  const exp = Date.now() + ttlMs;
  params.set('exp', String(exp));
  const canonical = `${basePath}|${effectiveAcc}|${exp}`;
  const sig = crypto.createHmac('sha256', MASTER_SECRET).update(canonical, 'utf8').digest('base64url');
  params.set('sig', sig);
  return `${basePath}?${params.toString()}`;
}

export function verifySignedTelegramResourceRequest(req: {
  path?: string;
  originalUrl?: string;
  query?: Record<string, any>;
}): boolean {
  const sig = typeof req.query?.sig === 'string' ? req.query.sig : '';
  const expRaw = typeof req.query?.exp === 'string' ? req.query.exp : '';
  if (!sig || !expRaw) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  const rawUrl = req.originalUrl || req.path || '';
  const basePath = rawUrl.split('?')[0];
  const effectiveAcc = typeof req.query?.accountId === 'string' ? req.query.accountId : '';
  const canonical = `${basePath}|${effectiveAcc}|${exp}`;
  const expected = crypto.createHmac('sha256', MASTER_SECRET).update(canonical, 'utf8').digest('base64url');
  return verifySecretToken(sig, expected);
}

// Streaming Outbound Media Limit & Disk Storage (avoids multi-MB Base64 JSON & localStorage exhaustion)
export const TELEGRAM_MAX_MEDIA = Math.max(
  50 * 1024 * 1024,
  Number(process.env.TELEGRAM_MAX_MEDIA || process.env.TELEGRAM_MAX_MEDIA_BYTES) || 512 * 1024 * 1024
);
export const OUTBOUND_MEDIA_DIR = path.join(dbDir, 'outbound_media');
try {
  fs.mkdirSync(OUTBOUND_MEDIA_DIR, { recursive: true });
} catch {}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
};

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
};

function sanitizeMediaExtension(originalName?: string, mimeType?: string): string {
  const rawExt = path.extname(String(originalName || '')).toLowerCase();
  if (/^\.[a-z0-9]{1,10}$/.test(rawExt)) {
    return rawExt;
  }
  const cleanMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[cleanMime] || '.bin';
}

export function inferMediaMimeFromExt(filePathOrName: string): string {
  const ext = path.extname(String(filePathOrName || '')).toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

export function buildOutboundLocalMediaUrl(diskFileName: string, accountScope = ''): string {
  const safeKey = path.basename(String(diskFileName || '').trim());
  return signTelegramResourceUrl(`/api/messages/local-media/${encodeURIComponent(safeKey)}`, accountScope);
}

export function resolveLocalMediaDiskPath(mediaUrl: string): string | null {
  if (!mediaUrl || typeof mediaUrl !== 'string') return null;
  let pathname = mediaUrl.trim();
  if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      return null;
    }
  } else {
    pathname = pathname.split('?')[0];
  }
  const prefix = '/api/messages/local-media/';
  if (!pathname.startsWith(prefix)) return null;
  let fileKey = '';
  try {
    fileKey = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
  if (!fileKey || !/^[a-zA-Z0-9._-]+$/.test(fileKey) || fileKey.includes('..')) {
    return null;
  }
  const resolved = path.resolve(OUTBOUND_MEDIA_DIR, fileKey);
  const rootResolved = path.resolve(OUTBOUND_MEDIA_DIR);
  if (!resolved.startsWith(rootResolved + path.sep)) {
    return null;
  }
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  } catch {}
  return null;
}

let lastOutboundMediaPruneAt = 0;
function scheduleOutboundMediaPrune() {
  const now = Date.now();
  if (now - lastOutboundMediaPruneAt < 10 * 60 * 1000) return;
  lastOutboundMediaPruneAt = now;
  setImmediate(async () => {
    try {
      const files = await fs.promises.readdir(OUTBOUND_MEDIA_DIR);
      const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
      const maxTotalBytes = 2 * 1024 * 1024 * 1024; // 2GB disk budget
      const entries: Array<{ fullPath: string; size: number; mtimeMs: number }> = [];
      let totalSize = 0;
      for (const name of files) {
        const fullPath = path.join(OUTBOUND_MEDIA_DIR, name);
        try {
          const st = await fs.promises.stat(fullPath);
          if (!st.isFile()) continue;
          if (now - st.mtimeMs > maxAgeMs) {
            await fs.promises.unlink(fullPath).catch(() => {});
            continue;
          }
          totalSize += st.size;
          entries.push({ fullPath, size: st.size, mtimeMs: st.mtimeMs });
        } catch {}
      }
      if (totalSize > maxTotalBytes) {
        entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const entry of entries) {
          if (totalSize <= maxTotalBytes * 0.8) break;
          if (now - entry.mtimeMs < 3600 * 1000) continue;
          await fs.promises.unlink(entry.fullPath).catch(() => {});
          totalSize -= entry.size;
        }
      }
    } catch {}
  });
}

export function parseMultipartMessageUpload(req: Request, res: Response, next: NextFunction) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  try {
    fs.mkdirSync(OUTBOUND_MEDIA_DIR, { recursive: true });
  } catch {}

  let settled = false;
  let limitExceeded = false;
  let fileTooMany = false;
  let uploadErrMsg = '';
  let diskPath = '';
  let diskFileName = '';
  let originalName = '';
  let mimeType = '';
  let bytesWritten = 0;
  let writeStream: fs.WriteStream | null = null;
  let writeDonePromise: Promise<void> | null = null;
  let busboyFinished = false;
  const fields: Record<string, string> = {};

  const cleanupPartialFile = () => {
    if (writeStream) {
      try {
        writeStream.destroy();
      } catch {}
      writeStream = null;
    }
    if (diskPath) {
      const target = diskPath;
      diskPath = '';
      fs.promises.unlink(target).catch(() => {});
    }
  };

  const finishOnce = (err?: any, statusCode = 400) => {
    if (settled) return;
    settled = true;
    if (err) {
      cleanupPartialFile();
      if (!res.headersSent) {
        res.status(statusCode).json({
          success: false,
          delivered: false,
          deliveryStatus: 'failed',
          error: typeof err === 'string' ? err : err?.message || '媒体流式上传失败',
        });
      }
      return;
    }
    next();
  };

  let bb: ReturnType<typeof busboy>;
  try {
    bb = busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: {
        fileSize: TELEGRAM_MAX_MEDIA,
        files: 1,
        fields: 40,
        fieldSize: 512 * 1024,
      },
    });
  } catch (initErr: any) {
    return finishOnce(`无效的 multipart 上传请求: ${initErr?.message || initErr}`, 400);
  }

  bb.on('field', (name, val) => {
    if (typeof val === 'string') {
      fields[name] = val;
    }
  });

  bb.on('file', (_fieldName, fileStream, info) => {
    if (writeStream) {
      fileStream.resume();
      return;
    }
    originalName = String(info?.filename || 'media.bin');
    mimeType = String(info?.mimeType || 'application/octet-stream');
    const safeExt = sanitizeMediaExtension(originalName, mimeType);
    diskFileName = `media_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${safeExt}`;
    diskPath = path.join(OUTBOUND_MEDIA_DIR, diskFileName);

    const ws = fs.createWriteStream(diskPath);
    writeStream = ws;
    writeDonePromise = new Promise<void>((resolve) => {
      ws.on('close', () => resolve());
      ws.on('error', (err) => {
        uploadErrMsg = err?.message || '写入本地媒体缓存失败';
        resolve();
      });
    });

    fileStream.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
    });

    fileStream.on('limit', () => {
      limitExceeded = true;
      fileStream.unpipe(ws);
      fileStream.resume();
      ws.destroy();
    });

    fileStream.on('error', (err: any) => {
      uploadErrMsg = err?.message || '读取上传媒体流失败';
      ws.destroy();
    });

    fileStream.pipe(ws);
  });

  bb.on('filesLimit', () => {
    fileTooMany = true;
  });

  bb.on('error', (err: any) => {
    finishOnce(`解析上传流失败: ${err?.message || err}`, 400);
  });

  req.on('aborted', () => {
    if (!settled) {
      settled = true;
      cleanupPartialFile();
    }
  });

  bb.on('finish', async () => {
    busboyFinished = true;
    if (writeStream && writeDonePromise) {
      await writeDonePromise;
    }
    if (settled) return;

    if (limitExceeded) {
      const maxMb = Math.round(TELEGRAM_MAX_MEDIA / (1024 * 1024));
      return finishOnce(`媒体文件超过系统允许的最大限制 (${maxMb} MB)`, 413);
    }
    if (fileTooMany) {
      return finishOnce('单条消息仅支持流式上传单个媒体文件', 400);
    }
    if (uploadErrMsg) {
      return finishOnce(uploadErrMsg, 500);
    }

    const parsedPayload = fields.payload ? safeJsonParse<Record<string, any>>(fields.payload, {}) : {};
    const mergedBody: Record<string, any> = { ...parsedPayload };
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'payload') continue;
      if (v === 'true') mergedBody[k] = true;
      else if (v === 'false') mergedBody[k] = false;
      else if (k === 'audioDuration' || k === 'videoDuration' || k === 'createdAt' || k === 'telegramMessageId') {
        const n = Number(v);
        if (Number.isFinite(n)) mergedBody[k] = n;
      } else {
        mergedBody[k] = v;
      }
    }
    req.body = mergedBody;

    if (diskPath && fs.existsSync(diskPath)) {
      (req as any).uploadedMedia = {
        diskPath,
        diskFileName,
        originalName,
        mimeType,
        size: bytesWritten,
      };
      scheduleOutboundMediaPrune();
    }

    if (busboyFinished) {
      finishOnce();
    }
  });

  req.pipe(bb);
}

// Webhook secret validation: enforce configured secret or persist secure instance secret across restarts
export const isWebhookSecretConfigured = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_WEBHOOK_SECRET.trim().length > 0);
function getOrGenerateWebhookSecret(): string {
  if (isWebhookSecretConfigured) {
    return process.env.TELEGRAM_WEBHOOK_SECRET!.trim();
  }
  try {
    const secretPath = path.join(dbDir, '.webhook_secret');
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 16) return existing;
    }
    const newSecret = 'tg_whsec_' + crypto.randomBytes(24).toString('hex');
    try { fs.writeFileSync(secretPath, newSecret, { mode: 0o600 }); } catch {}
    return newSecret;
  } catch {
    return 'tg_whsec_' + crypto.randomBytes(24).toString('hex');
  }
}
export const TELEGRAM_WEBHOOK_SECRET = getOrGenerateWebhookSecret();
process.env.TELEGRAM_WEBHOOK_SECRET = TELEGRAM_WEBHOOK_SECRET;

// 1. Session Encryption Key for AES-256-GCM (Telegram user sessions & sensitive tokens)
// Persisted locally so sessions are preserved stably across restarts
const RAW_SESSION_KEY = process.env.SESSION_ENCRYPTION_KEY || process.env.APP_SESSION_SECRET || PERSISTENT_DEVICE_SECRET;
const AES_ENCRYPTION_KEY = crypto.createHash('sha256').update(RAW_SESSION_KEY).digest(); // Exactly 32 bytes

/**
 * Encrypt sensitive string (e.g. Telegram MTProto session string, API Keys) using AES-256-GCM
 */
export function encryptSensitiveData(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: "enc:gcm:iv:tag:ciphertext" (all hex)
  return `enc:gcm:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt sensitive string. Transparently supports legacy unencrypted strings.
 */
export function decryptSensitiveData(encryptedData: string): string {
  if (!encryptedData) return '';
  if (!encryptedData.startsWith('enc:gcm:')) {
    // Legacy unencrypted string, return as-is
    return encryptedData;
  }
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 5) return '';
    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const cipherText = Buffer.from(parts[4], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', AES_ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err: any) {
    console.error('[Session Decryption Error]:', err.message);
    return '';
  }
}

// 2. Admin Password Hash & Verification using Scrypt
// Stored format: "salt:derivedKey" (hex)
export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;
  try {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const keyBuf = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, keyBuf.length);
    return crypto.timingSafeEqual(keyBuf, derivedKey);
  } catch {
    return false;
  }
}

// Admin password configuration:
// If ADMIN_PASSWORD_HASH is provided in environment, verify against it.
// If ADMIN_PASSWORD is provided, hash it.
// Otherwise, a random admin password is generated for single-tenant isolation.
let effectiveAdminHash = process.env.ADMIN_PASSWORD_HASH || '';
let generatedAdminPlaintext = '';

if (!effectiveAdminHash) {
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0) {
    effectiveAdminHash = hashPasswordScrypt(process.env.ADMIN_PASSWORD.trim());
  } else {
    // Generate a secure random password for admin access
    generatedAdminPlaintext = crypto.randomBytes(12).toString('hex');
    effectiveAdminHash = hashPasswordScrypt(generatedAdminPlaintext);
    console.log('------------------------------------------------------------');
    console.log(`🔐 [ADMIN CREDENTIALS] Admin password initialized: ${generatedAdminPlaintext}`);
    console.log('💡 Tip: Set ADMIN_PASSWORD_HASH in environment variables to customize');
    console.log('------------------------------------------------------------');
  }
}

// 3. SSRF Defense: Check and validate target URLs before sending server-side requests
// Strictly denies: non-HTTPS, localhost/loopback, private subnets (10.x, 172.16-31.x, 192.168.x),
// link-local (169.254.x, especially cloud metadata 169.254.169.254), and prevents redirects.
export function isPrivateOrReservedIp(ip: string): boolean {
  if (!ip) return true;
  // IPv4 mapping check (e.g. ::ffff:127.0.0.1)
  const cleanIp = ip.replace(/^::ffff:/i, '');
  if (cleanIp === '127.0.0.1' || cleanIp === 'localhost' || cleanIp === '::1' || cleanIp === '0.0.0.0' || cleanIp === '::') {
    return true;
  }
  // IPv6 private & reserved ranges (ULA fc00::/7, Link-Local fe80::/10, Multicast ff00::/8)
  if (cleanIp.includes(':')) {
    const lowered = cleanIp.toLowerCase();
    if (
      lowered.startsWith('fc') ||
      lowered.startsWith('fd') ||
      lowered.startsWith('fe8') ||
      lowered.startsWith('fe9') ||
      lowered.startsWith('fea') ||
      lowered.startsWith('feb') ||
      lowered.startsWith('ff')
    ) {
      return true;
    }
    return false;
  }
  const parts = cleanIp.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link-Local & Cloud Metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return true;
  }
  return false;
}

export function isAllowedLocalhostEndpoint(hostname: string): boolean {
  if (!hostname) return false;
  const clean = hostname.toLowerCase().trim();
  return clean === 'localhost' || clean === '127.0.0.1' || clean === '::1' || clean === '[::1]';
}

/**
 * SSRF-Safe Fetch Wrapper
 * Validates protocol, resolves DNS and checks IP against blacklists,
 * permits desktop workstation local AI endpoints (Ollama at http://127.0.0.1:11434, LM Studio at http://localhost:1234),
 * while strictly blocking cloud metadata (169.254.169.254) and unauthorized private subnets.
 */
export async function safeSsrfFetch(url: string, options: RequestInit = {}): Promise<globalThis.Response> {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase();
  if (!hostname) {
    throw new Error('SSRF 安全拦截：无效的主机名');
  }

  const isLocalAiEndpoint = isAllowedLocalhostEndpoint(hostname);

  // Allow HTTP for local desktop models (e.g. Ollama http://127.0.0.1:11434, LM Studio http://localhost:1234)
  // For remote public endpoints, strictly enforce HTTPS in production
  if (isProduction && parsedUrl.protocol !== 'https:' && !isLocalAiEndpoint) {
    throw new Error(`SSRF 安全拦截：出于安全防护，远端大模型服务仅允许使用安全的 https:// 协议端点 (拒绝 ${parsedUrl.protocol})`);
  }

  // If destination is local loopback for personal AI (Ollama / LocalAI / LM Studio), safely permit it
  if (isLocalAiEndpoint) {
    return await fetch(url, {
      ...options,
      redirect: 'error',
    });
  }

  // If a local SOCKS4/SOCKS5 proxy is enabled, allow proxy-tunneled HTTPS/HTTP while still blocking private/reserved targets
  const proxy = getConfiguredTelegramProxy();
  if (proxy) {
    if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
      throw new Error(`SSRF 安全拦截：禁止访问内网或保留 IP 地址 (${hostname})`);
    }
    try {
      const lookupResult = await dns.lookup(hostname, { all: true });
      for (const address of lookupResult) {
        if (isPrivateOrReservedIp(address.address)) {
          throw new Error(`SSRF 安全拦截：禁止访问内网或保留 IP 地址 (${hostname} -> ${address.address})，保护内部云元数据与内网资产`);
        }
      }
    } catch (err: any) {
      if (err.message.includes('SSRF 安全拦截')) {
        throw err;
      }
      if (proxy.socksType !== 5) {
        throw new Error(`SSRF 安全拦截：域名无法解析 (${hostname}): ${err.message}`);
      }
    }
    return await fetchWithSystemProxySupport(url, { ...options, redirect: 'error' }, 20000);
  }

  // Resolve DNS to verify the destination IP address for remote hosts
  try {
    const lookupResult = await dns.lookup(hostname, { all: true });
    for (const address of lookupResult) {
      if (isPrivateOrReservedIp(address.address)) {
        throw new Error(`SSRF 安全拦截：禁止访问内网或保留 IP 地址 (${hostname} -> ${address.address})，保护内部云元数据与内网资产`);
      }
    }
  } catch (err: any) {
    if (err.message.includes('SSRF 安全拦截')) {
      throw err;
    }
    // DNS resolution failure
    throw new Error(`SSRF 安全拦截：域名无法解析 (${hostname}): ${err.message}`);
  }

  // Enforce redirect: 'error' (do not follow redirects)
  return await fetch(url, {
    ...options,
    redirect: 'error',
  });
}

// 4. Server-Authoritative Active Sessions Store
// Session expiration: 7 days
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionContext {
  token: string;
  accountId: string;
  authorizedAccounts: string[];
  isMaster: boolean;
  isBot: boolean;
  userId?: string;
  username?: string;
  role?: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
}

export const activeSessions = new Map<string, SessionContext>();

// Helper to clean expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of activeSessions.entries()) {
    if (now > sess.expiresAt) {
      activeSessions.delete(token);
    }
  }
}, 60 * 60 * 1000).unref();
export interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
  username?: string;
  role?: string;
  plan?: string;
  vipExpiresAt?: number;
  planExpiresAt?: number;
  expiresAt?: number;
  deviceId?: string;
  boundDeviceId?: string;
  maxAccounts?: number;
  exp?: number;
  iat?: number;
  nbf?: number;
  [key: string]: any;
}

export interface JwtVerificationConfig {
  publicKeyPem?: string;
  hs256Secret?: string;
  expectedDeviceId?: string;
}

export type JwtVerificationErrorCode =
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'VIP_EXPIRED'
  | 'DEVICE_MISMATCH'
  | 'UNCONFIGURED';

export interface JwtVerificationResult {
  valid: boolean;
  payload: JwtPayload | null;
  errorCode?: JwtVerificationErrorCode;
  errorMessage?: string;
}

/**
 * Normalizes a PEM-encoded SPKI public key (supports single-line \n escapes or bare base64 SPKI).
 */
export function normalizePemPublicKey(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const cleaned = raw.replace(/\\n/g, '\n').trim();
  if (!cleaned) return '';
  if (cleaned.includes('-----BEGIN ')) {
    return cleaned.replace(/\r\n/g, '\n');
  }
  // Bare base64 SPKI fallback: wrap into standard PEM PUBLIC KEY block
  const compact = cleaned.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return '';
  const lines = compact.match(/.{1,64}/g)?.join('\n') || compact;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

export function getActiveJwtVerificationConfig(): JwtVerificationConfig {
  const rawPublicKey = process.env.JWT_PUBLIC_KEY || EMBEDDED_JWT_PUBLIC_KEY || '';
  const publicKeyPem = normalizePemPublicKey(rawPublicKey);
  const hs256Secret = (process.env.JWT_SECRET || '').trim();
  return {
    publicKeyPem: publicKeyPem || undefined,
    hs256Secret: hs256Secret || undefined,
    expectedDeviceId: getLocalMachineDeviceId(),
  };
}

function normalizeEpochMs(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) return null;
  return val > 1e12 ? val : val * 1000;
}

function validateJwtClaimsDetailed(
  payload: JwtPayload,
  expectedDeviceId?: string
): JwtVerificationResult {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '无效的令牌载荷' };
  }

  // Strictly validate expiration (exp) claim
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '令牌缺少有效期声明' };
  }
  const nowMs = Date.now();
  const expMs = payload.exp > 1e12 ? payload.exp : payload.exp * 1000;
  if (nowMs >= expMs) {
    return { valid: false, payload: null, errorCode: 'TOKEN_EXPIRED', errorMessage: '登录会话已过期，请重新登录' };
  }

  // Validate not-before (nbf) if present (with 60s clock skew tolerance)
  if (typeof payload.nbf === 'number' && Number.isFinite(payload.nbf)) {
    const nbfMs = payload.nbf > 1e12 ? payload.nbf : payload.nbf * 1000;
    if (nowMs + 60_000 < nbfMs) {
      return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '令牌尚未生效' };
    }
  }

  // Strictly enforce card-key membership expiry if claim is present
  const vipExpMs =
    normalizeEpochMs(payload.vipExpiresAt) ??
    normalizeEpochMs(payload.planExpiresAt) ??
    normalizeEpochMs(payload.vip_expires_at) ??
    normalizeEpochMs(payload.expiresAt);
  if (vipExpMs !== null && nowMs >= vipExpMs) {
    return {
      valid: false,
      payload: null,
      errorCode: 'VIP_EXPIRED',
      errorMessage: '您的卡密会员已到期，请激活新的 3 天试用或 30 天包月卡密续费',
    };
  }

  // Strictly enforce single-computer binding if device claim is present
  const claimedDeviceId = String(
    payload.deviceId || payload.boundDeviceId || payload.device_id || ''
  ).trim();
  if (claimedDeviceId && expectedDeviceId) {
    const a = Buffer.from(claimedDeviceId, 'utf8');
    const b = Buffer.from(expectedDeviceId, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return {
        valid: false,
        payload: null,
        errorCode: 'DEVICE_MISMATCH',
        errorMessage: '该会员账号已绑定至其它电脑设备（单账号仅限 1 台电脑使用），禁止跨机登录',
      };
    }
  }

  return { valid: true, payload };
}

export function verifyJwtTokenWithReason(
  token: string,
  config?: JwtVerificationConfig
): JwtVerificationResult {
  try {
    if (!token || typeof token !== 'string') {
      return { valid: false, payload: null, errorCode: 'MISSING_TOKEN', errorMessage: '缺少认证令牌' };
    }
    const activeConfig = config || getActiveJwtVerificationConfig();
    if (!activeConfig.publicKeyPem && !activeConfig.hs256Secret) {
      return { valid: false, payload: null, errorCode: 'UNCONFIGURED', errorMessage: '未配置本地验签公钥' };
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '令牌格式无效' };
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (
      !encodedHeader ||
      !encodedPayload ||
      !encodedSignature ||
      !/^[A-Za-z0-9_-]+$/.test(encodedHeader) ||
      !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
      !/^[A-Za-z0-9_-]+$/.test(encodedSignature)
    ) {
      return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '令牌编码非法' };
    }

    const headerJson = Buffer.from(encodedHeader, 'base64url').toString('utf8');
    const header = JSON.parse(headerJson);
    if (!header || typeof header !== 'object' || typeof header.alg !== 'string') {
      return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '令牌头部无效' };
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const providedSig = Buffer.from(encodedSignature, 'base64url');
    const alg = header.alg.toUpperCase();

    if (alg === 'RS256') {
      if (!activeConfig.publicKeyPem) {
        return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '未配置 RS256 公钥' };
      }
      const keyObj = crypto.createPublicKey(activeConfig.publicKeyPem);
      if (keyObj.type !== 'public' || keyObj.asymmetricKeyType !== 'rsa') {
        return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '公钥类型非 RSA' };
      }
      const isValid = crypto.verify('sha256', Buffer.from(signingInput, 'utf8'), keyObj, providedSig);
      if (!isValid) {
        return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: 'RS256 签名校验失败' };
      }
    } else if (alg === 'ES256') {
      if (!activeConfig.publicKeyPem) {
        return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '未配置 ES256 公钥' };
      }
      const keyObj = crypto.createPublicKey(activeConfig.publicKeyPem);
      if (keyObj.type !== 'public' || keyObj.asymmetricKeyType !== 'ec') {
        return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '公钥类型非 EC' };
      }
      const isValid = crypto.verify(
        'sha256',
        Buffer.from(signingInput, 'utf8'),
        { key: keyObj, dsaEncoding: 'ieee-p1363' },
        providedSig
      );
      if (!isValid) {
        return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: 'ES256 签名校验失败' };
      }
    } else if (alg === 'HS256') {
      if (!activeConfig.hs256Secret) {
        return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '未配置 HS256 密钥' };
      }
      const expectedSig = crypto.createHmac('sha256', activeConfig.hs256Secret).update(signingInput).digest();
      if (expectedSig.length !== providedSig.length || !crypto.timingSafeEqual(expectedSig, providedSig)) {
        return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: 'HS256 签名校验失败' };
      }
    } else {
      return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '不支持的签名算法' };
    }

    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as JwtPayload;
    return validateJwtClaimsDetailed(payload, activeConfig.expectedDeviceId);
  } catch {
    return { valid: false, payload: null, errorCode: 'INVALID_TOKEN', errorMessage: '令牌解析失败' };
  }
}

/**
 * Verifies a JWT token strictly supporting:
 * - Asymmetric RS256 / ES256 (ECDSA P-256 IEEE P1363) via PEM Public Key (JWT_PUBLIC_KEY / EMBEDDED_JWT_PUBLIC_KEY)
 * - Symmetric HS256 via JWT_SECRET (never falls back to using publicKeyPem as HMAC secret)
 */
export function verifyJwtToken(token: string, config?: JwtVerificationConfig): JwtPayload | null {
  const res = verifyJwtTokenWithReason(token, config);
  return res.valid ? res.payload : null;
}

/**
 * Verifies a JWT token signed with HS256 using timing-safe HMAC-SHA256 comparison
 * and strictly checks token expiration (exp) and not-before (nbf) claims.
 */
export function verifyJwtHs256(token: string, secret: string): JwtPayload | null {
  if (!secret || typeof secret !== 'string') return null;
  return verifyJwtToken(token, { hs256Secret: secret });
}

export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string') return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

// In-memory JWT revocation blacklist populated on explicit logout
const revokedJwtTokens = new Map<string, number>();

function hashJwtForRevocation(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function loadRevokedJwtTokensFromDb(): Promise<void> {
  try {
    const now = Date.now();
    await db.prepare('DELETE FROM revoked_jwt_tokens WHERE expires_at <= ?').run(now);
    const rows = (await db.prepare('SELECT token_hash, expires_at FROM revoked_jwt_tokens WHERE expires_at > ?').all(now)) as any[];
    for (const row of rows) {
      if (row?.token_hash && typeof row?.expires_at === 'number') {
        revokedJwtTokens.set(String(row.token_hash), Number(row.expires_at));
      }
    }
  } catch {}
}

export function revokeJwtToken(token: string, expMs?: number): void {
  if (!token || typeof token !== 'string') return;
  const now = Date.now();
  for (const [k, exp] of revokedJwtTokens.entries()) {
    if (exp <= now) revokedJwtTokens.delete(k);
  }
  const effectiveExp =
    typeof expMs === 'number' && Number.isFinite(expMs) && expMs > now
      ? expMs
      : now + SESSION_MAX_AGE_MS;
  const digest = hashJwtForRevocation(token);
  revokedJwtTokens.set(digest, effectiveExp);
  void db
    .prepare('INSERT OR REPLACE INTO revoked_jwt_tokens (token_hash, expires_at) VALUES (?, ?)')
    .run(digest, effectiveExp)
    .catch(() => {});
}

export function isJwtTokenRevoked(token?: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const digest = hashJwtForRevocation(token);
  const exp = revokedJwtTokens.get(digest);
  if (!exp) return false;
  if (exp <= Date.now()) {
    revokedJwtTokens.delete(digest);
    return false;
  }
  return true;
}

function extractJwtExpMsUnsafe(token?: string): number | undefined {
  if (!token || typeof token !== 'string') return undefined;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload?.exp === 'number') {
      return payload.exp > 1e12 ? payload.exp : payload.exp * 1000;
    }
  } catch {}
  return undefined;
}

/**
 * BOLA / IDOR Defense & Tenant Isolation Middleware
 * Enforces strict JWT (RS256/ES256/HS256), card-key VIP expiry, and single-computer binding.
 */
export async function requireTenantAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // 0. Origin / CSRF Defense: Block unauthorized cross-origin browser requests
    if (!isAllowedClientOrigin(req)) {
      return res.status(403).json({
        error: 'Forbidden: Untrusted Origin',
        code: 'CSRF_ORIGIN_REJECTED',
        message: '拒绝访问：请求来源未通过安全白名单校验 (防止本地 CSRF 劫持)',
      });
    }

    const webhookSecretHeader = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    const claimedAccountId = (
      req.headers['x-account-id'] ||
      req.body?.accountId ||
      req.query?.accountId
    ) as string | undefined;

    let session: SessionContext | null = null;
    let authFailure: JwtVerificationResult | null = null;

    // 1. Authenticate via Telegram Webhook Secret Token (Server-to-Server)
    if (verifySecretToken(webhookSecretHeader, TELEGRAM_WEBHOOK_SECRET)) {
      session = {
        token: webhookSecretHeader!,
        accountId: 'acc_telegram_bot',
        authorizedAccounts: getAuthorizedAccountsList(),
        isMaster: false,
        isBot: true,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        expiresAt: Date.now() + SESSION_MAX_AGE_MS,
      };
    } else {
      // 2. Authenticate strictly via Authorization: Bearer <JWT> (RS256/ES256 Public Key or HS256 Secret)
      const bearerToken = extractBearerToken(req);
      if (bearerToken && isJwtTokenRevoked(bearerToken)) {
        return res.status(401).json({
          error: 'Unauthorized: Token Revoked',
          code: 'AUTH_SESSION_REVOKED',
          message: '登录令牌已注销失效，请重新登录',
        });
      }
      const jwtConfig = getActiveJwtVerificationConfig();
      const verification = bearerToken
        ? verifyJwtTokenWithReason(bearerToken, jwtConfig)
        : { valid: false, payload: null, errorCode: 'MISSING_TOKEN' as JwtVerificationErrorCode, errorMessage: '缺少授权令牌' };

      if (verification.valid && verification.payload && bearerToken) {
        lastActiveUserJwt = bearerToken;
        const jwtPayload = verification.payload;
        const now = Date.now();
        const expMs =
          typeof jwtPayload.exp === 'number'
            ? jwtPayload.exp > 1e12
              ? jwtPayload.exp
              : jwtPayload.exp * 1000
            : now + SESSION_MAX_AGE_MS;
        const username = String(jwtPayload.username || jwtPayload.sub || 'member');
        const userId = String(jwtPayload.sub || jwtPayload.userId || jwtPayload.id || username);
        const role = String(jwtPayload.role || 'member');

        session = {
          token: bearerToken,
          accountId: claimedAccountId || 'acc_1',
          authorizedAccounts: getAuthorizedAccountsList(),
          isMaster: true,
          isBot: false,
          userId,
          username,
          role,
          createdAt: now,
          lastActiveAt: now,
          expiresAt: expMs,
        };
      } else {
        authFailure = verification;
      }
    }

    // 3. Reject missing, forged, device-mismatched, or expired tokens immediately
    if (!session) {
      if (authFailure?.errorCode === 'DEVICE_MISMATCH') {
        return res.status(403).json({
          error: 'Forbidden: Device Binding Mismatch',
          code: 'DEVICE_MISMATCH',
          message: authFailure.errorMessage,
        });
      }
      if (authFailure?.errorCode === 'VIP_EXPIRED') {
        return res.status(401).json({
          error: 'Unauthorized: Membership Expired',
          code: 'VIP_EXPIRED',
          message: authFailure.errorMessage,
        });
      }
      return res.status(401).json({
        error: 'Unauthorized: Invalid, Expired, or Missing Bearer Token',
        code: 'AUTH_SESSION_REQUIRED',
        message: '未授权访问：缺少有效的 Authorization Bearer 令牌、签名校验失败或已过期，请重新登录',
      });
    }

    // Determine effective account ID strictly
    let effectiveAccountId = session.accountId || 'acc_1';
    if (session.isMaster) {
      if (claimedAccountId && (session.authorizedAccounts.includes(claimedAccountId) || claimedAccountId.startsWith('acc_tg_'))) {
        effectiveAccountId = claimedAccountId;
      }
    } else {
      effectiveAccountId = session.accountId;
    }

    // Attach validated auth context to request object
    (req as any).auth = {
      session,
      effectiveAccountId,
      isBot: session.isBot,
    };

    next();
  } catch (error: any) {
    console.error('[Tenant Auth Middleware Error]:', error);
    res.status(500).json({ error: 'Internal Auth Verification Error', message: error.message });
  }
}

// Global API Interceptor: Protects all local business /api routes with JWT RS256/ES256/HS256 auth
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const openPaths = [
    '/auth/logout',
    '/auth/status',
    '/auth/session-init',
    '/auth/device-id',
    '/auth/cloud-login',
    '/auth/cloud-register',
    '/auth/cloud-redeem',
    '/auth/proxy',
    '/telegram/webhook',
    '/health',
  ];

  if (openPaths.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
    return next();
  }

  // Signed resource URLs for browser <img>/<video>/<audio>/<a> assets (or fall back to Bearer auth)
  const signedResourcePrefixes = [
    '/telegram/user/avatar/',
    '/telegram/user/media/',
    '/telegram/user/sticker/',
    '/messages/local-media/',
  ];
  if (
    signedResourcePrefixes.some((p) => req.path.startsWith(p)) &&
    verifySignedTelegramResourceRequest(req)
  ) {
    if (!isAllowedClientOrigin(req)) {
      return res.status(403).send('Forbidden');
    }
    return next();
  }

  return requireTenantAuth(req, res, next);
});

// 0.0.1 Local Machine Hardware Device Fingerprint (For single-computer account binding)
app.get('/api/auth/device-id', (req: Request, res: Response) => {
  if (!isAllowedClientOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: Invalid request origin' });
  }
  const deviceId = getLocalMachineDeviceId();
  return res.json({
    ok: true,
    deviceId,
    platform: os.platform(),
    arch: os.arch(),
    hostnameLabel: os.hostname(),
    maxTelegramAccounts: MAX_TELEGRAM_ACCOUNTS,
  });
});

// 0.0.2 Pre-login Local Network Proxy Settings (allows SOCKS5/SOCKS4 setup BEFORE member login)
app.get('/api/auth/proxy', async (req: Request, res: Response) => {
  if (!isAllowedClientOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: Invalid request origin' });
  }
  try {
    const config = await loadSystemProxyConfigFromDb();
    return res.json({
      ok: true,
      config: config
        ? {
            enabled: config.enabled,
            type: config.type,
            host: config.host,
            port: config.port,
            username: config.username || '',
            hasPassword: Boolean(config.password),
          }
        : {
            enabled: false,
            type: 'socks5',
            host: '',
            port: 1080,
            username: '',
            hasPassword: false,
          },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || '读取代理设置失败' });
  }
});

app.post('/api/auth/proxy', async (req: Request, res: Response) => {
  if (!isAllowedClientOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: Invalid request origin' });
  }
  try {
    const existing = await loadSystemProxyConfigFromDb();
    const incomingPassword = typeof req.body?.password === 'string' ? req.body.password : undefined;
    const preserveExistingPassword =
      req.body?.preservePassword !== false && incomingPassword === undefined && existing?.password;

    const validated = normalizeAndValidateProxyConfig({
      enabled: req.body?.enabled,
      type: req.body?.type,
      host: req.body?.host,
      port: req.body?.port,
      username: req.body?.username,
      password: preserveExistingPassword ? existing?.password : incomingPassword,
    });
    if (!validated.ok) {
      return res.status(400).json({ ok: false, error: validated.error });
    }
    await saveSystemProxyConfigToDb(validated.config);

    let reconnecting = false;
    if (process.env.NODE_ENV !== 'test' && process.env.AIS_TEST_IMPORT !== 'true' && connectedUserClients.size > 0) {
      reconnecting = true;
      void restoreTelegramUserSessionsOnStartup(extractBearerToken(req) || lastActiveUserJwt || undefined, {
        forceReconnect: true,
      });
    }

    return res.json({
      ok: true,
      reconnecting,
      config: {
        enabled: validated.config.enabled,
        type: validated.config.type,
        host: validated.config.host,
        port: validated.config.port,
        username: validated.config.username || '',
        hasPassword: Boolean(validated.config.password),
      },
      message: validated.config.enabled
        ? `已保存 ${validated.config.type.toUpperCase()} 代理 (${validated.config.host}:${validated.config.port})`
        : '已关闭内置代理并恢复直连',
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || '保存代理设置失败' });
  }
});

// 0.0.3 Local Node Proxy-Aware Cloud Auth Forwarding (avoids Cloudflare/GFW browser fetch failures before proxy settings take effect)
async function handleCloudAuthProxyForward(
  req: Request,
  res: Response,
  action: 'login' | 'register' | 'redeem'
) {
  if (!isAllowedClientOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: Invalid request origin' });
  }

  try {
    await loadSystemProxyConfigFromDb();
    const effectiveDeviceId = getLocalMachineDeviceId() || String(req.body?.deviceId || '').trim();
    const incomingBearer = extractBearerToken(req);

    const payloadBody: Record<string, any> = {
      ...(req.body && typeof req.body === 'object' ? req.body : {}),
      deviceId: effectiveDeviceId,
    };
    if (typeof payloadBody.username === 'string') {
      payloadBody.username = payloadBody.username.trim();
    }
    if (typeof payloadBody.cardKey === 'string') {
      payloadBody.cardKey = payloadBody.cardKey.trim();
    }

    const upstreamRes = await fetchWithSystemProxySupport(
      `${CLOUD_AUTH_BASE_URL}/api/auth/${action}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(incomingBearer ? { Authorization: `Bearer ${incomingBearer}` } : {}),
        },
        body: JSON.stringify(payloadBody),
      },
      12000
    );

    const data = (await upstreamRes.json().catch(() => null)) as any;
    if (!upstreamRes.ok || !data?.token) {
      const upstreamStatus = upstreamRes.status >= 400 ? upstreamRes.status : 502;
      return res.status(upstreamStatus).json({
        ok: false,
        code: data?.code,
        error: data?.error || data?.message || `云端认证服务响应异常 (HTTP ${upstreamRes.status})`,
      });
    }

    if (process.env.NODE_ENV !== 'test' && process.env.AIS_TEST_IMPORT !== 'true') {
      const verifyCheck = verifyJwtTokenWithReason(String(data.token));
      if (verifyCheck.valid) {
        lastActiveUserJwt = String(data.token);
        void ensureCloudTelegramCredentialsIfNeeded(String(data.token)).catch(() => {});
      }
    }

    return res.json(data);
  } catch (err: any) {
    const rawMsg = String(err?.message || '');
    const isTimeout = err?.name === 'TimeoutError' || /timeout|aborted/i.test(rawMsg);
    const activeProxy = getConfiguredTelegramProxy();
    const proxyHint = activeProxy
      ? `当前已启用 ${activeProxy.socksType === 4 ? 'SOCKS4' : 'SOCKS5'} 代理 (${activeProxy.ip}:${activeProxy.port})，请确认代理节点可用。`
      : '若当前网络无法直连授权中心，请点击下方「网络代理设置」配置本地 SOCKS5 代理后重试。';

    return res.status(isTimeout ? 504 : 502).json({
      ok: false,
      code: isTimeout ? 'CLOUD_AUTH_TIMEOUT' : 'CLOUD_AUTH_UNREACHABLE',
      proxyEnabled: Boolean(activeProxy),
      error: isTimeout
        ? `连接云端会员授权中心超时（12s）。${proxyHint}`
        : `无法连接云端会员授权中心（${rawMsg || '网络异常'}）。${proxyHint}`,
    });
  }
}

app.post('/api/auth/cloud-login', cloudAuthForwardLimiter, (req: Request, res: Response) =>
  handleCloudAuthProxyForward(req, res, 'login')
);
app.post('/api/auth/cloud-register', cloudAuthForwardLimiter, (req: Request, res: Response) =>
  handleCloudAuthProxyForward(req, res, 'register')
);
app.post('/api/auth/cloud-redeem', cloudAuthForwardLimiter, (req: Request, res: Response) =>
  handleCloudAuthProxyForward(req, res, 'redeem')
);

function buildPublicMemberInfo(payload: JwtPayload) {
  const username = String(payload.username || payload.sub || 'member');
  const userId = String(payload.sub || payload.userId || payload.id || username);
  const role = String(payload.role || 'member');
  const vipExpiresAt =
    normalizeEpochMs(payload.vipExpiresAt) ??
    normalizeEpochMs(payload.planExpiresAt) ??
    normalizeEpochMs(payload.vip_expires_at) ??
    normalizeEpochMs(payload.expiresAt) ??
    undefined;
  return {
    id: userId,
    username,
    role,
    plan: payload.plan ? String(payload.plan) : undefined,
    vipExpiresAt,
    boundDeviceId: String(payload.deviceId || payload.boundDeviceId || getLocalMachineDeviceId()),
    maxAccounts: Number(payload.maxAccounts) || MAX_TELEGRAM_ACCOUNTS,
  };
}

// 0.0 Session Handshake Probe (Strictly validates Bearer JWT; never issues elevated or master sessions)
app.post('/api/auth/session-init', (req: Request, res: Response) => {
  if (!isAllowedClientOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: Invalid request origin' });
  }

  const bearerToken = extractBearerToken(req);
  if (bearerToken && isJwtTokenRevoked(bearerToken)) {
    return res.status(401).json({
      ok: false,
      authenticated: false,
      code: 'AUTH_SESSION_REVOKED',
      message: '登录令牌已注销失效，请重新登录',
      requireLogin: true,
    });
  }

  const jwtConfig = getActiveJwtVerificationConfig();
  const verification = bearerToken
    ? verifyJwtTokenWithReason(bearerToken, jwtConfig)
    : { valid: false, payload: null, errorCode: 'MISSING_TOKEN' as JwtVerificationErrorCode, errorMessage: '未登录' };

  if (!verification.valid || !verification.payload) {
    const statusCode = verification.errorCode === 'DEVICE_MISMATCH' ? 403 : 401;
    return res.status(statusCode).json({
      ok: false,
      authenticated: false,
      code: verification.errorCode || 'AUTH_SESSION_REQUIRED',
      message: verification.errorMessage || '未授权访问：请通过卡密会员系统登录后携带有效令牌访问',
      requireLogin: true,
    });
  }

  const payload = verification.payload;
  if (bearerToken) {
    lastActiveUserJwt = bearerToken;
  }
  const user = buildPublicMemberInfo(payload);

  // Mode B: Background pre-sync of cloud-authorized Telegram API credentials (RAM-only) + restore active TG sessions
  if (bearerToken && process.env.NODE_ENV !== 'test' && process.env.AIS_TEST_IMPORT !== 'true') {
    void ensureCloudTelegramCredentialsIfNeeded(bearerToken)
      .then(() => restoreTelegramUserSessionsOnStartup(bearerToken))
      .catch((err) => {
        console.warn('[Session Init Sync Warning]:', err?.message || err);
      });
  }

  return res.json({
    ok: true,
    authenticated: true,
    user,
    deviceId: getLocalMachineDeviceId(),
    maxAccounts: MAX_TELEGRAM_ACCOUNTS,
    expiresAt: payload.exp ? (payload.exp > 1e12 ? payload.exp : payload.exp * 1000) : undefined,
  });
});

let dbInitError: string | null = null;

// Health check endpoint (returns 503 if local database initialization failed so desktop launcher never opens a broken shell)
app.get('/api/health', (_req: Request, res: Response) => {
  if (dbInitError) {
    return res.status(503).json({
      status: 'error',
      error: dbInitError,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 0. Member & JWT Auth Status Check
app.get('/api/auth/status', async (req: Request, res: Response) => {
  const bearerToken = extractBearerToken(req);
  const jwtConfig = getActiveJwtVerificationConfig();
  const jwtConfigured = Boolean(jwtConfig.publicKeyPem || jwtConfig.hs256Secret);
  const jwtMode: 'asymmetric' | 'hs256' | 'unconfigured' = jwtConfig.publicKeyPem
    ? 'asymmetric'
    : jwtConfig.hs256Secret
      ? 'hs256'
      : 'unconfigured';
  const revoked = Boolean(bearerToken && isJwtTokenRevoked(bearerToken));
  const verification =
    bearerToken && jwtConfigured && !revoked
      ? verifyJwtTokenWithReason(bearerToken, jwtConfig)
      : {
          valid: false,
          payload: null,
          errorCode: revoked ? 'AUTH_SESSION_REVOKED' : undefined,
          errorMessage: revoked ? '登录令牌已注销失效' : undefined,
        };

  const user = verification.valid && verification.payload ? buildPublicMemberInfo(verification.payload) : null;

  let totalMembers = 0;
  try {
    const totalRow = (await db.prepare('SELECT count(*) as cnt FROM app_users').get()) as any;
    totalMembers = Number(totalRow?.cnt) || 0;
  } catch {}

  res.json({
    authenticated: Boolean(user),
    status: user ? 'authenticated' : 'unauthenticated',
    user,
    totalMembers,
    deviceId: getLocalMachineDeviceId(),
    maxAccounts: MAX_TELEGRAM_ACCOUNTS,
    authErrorCode: !verification.valid ? verification.errorCode : undefined,
    authErrorMessage: !verification.valid ? verification.errorMessage : undefined,
    jwtConfigured,
    jwtMode,
    telegramWebhookConfigured: isWebhookSecretConfigured,
    serverTime: new Date().toISOString(),
  });
});

// 0.2 Logout Endpoint
app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const bearerToken = extractBearerToken(req);
  const revokeTelegramSessions = Boolean(req.body?.revokeTelegramSessions);

  if (bearerToken) {
    revokeJwtToken(bearerToken, extractJwtExpMsUnsafe(bearerToken));
  }
  clearInMemoryTelegramApiCredentials(bearerToken || undefined);
  if (bearerToken && lastActiveUserJwt === bearerToken) {
    lastActiveUserJwt = '';
  } else if (!bearerToken) {
    lastActiveUserJwt = '';
  }

  // Stop all in-memory pending & connected MTProto clients on member logout so no unauthenticated background sync continues
  const uniqueClients = new Map<string, ConnectedTelegramUser>();
  for (const u of connectedUserClients.values()) {
    if (u?.userId && !uniqueClients.has(u.userId)) {
      uniqueClients.set(u.userId, u);
    }
  }
  for (const u of uniqueClients.values()) {
    if (revokeTelegramSessions && u.client) {
      try {
        await u.client.invoke(new Api.auth.LogOut());
      } catch {}
    }
    await destroyTelegramClientSafely(u.client);
  }
  connectedUserClients.clear();

  for (const pending of activeUserClients.values()) {
    if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
    await destroyTelegramClientSafely(pending.client);
  }
  activeUserClients.clear();

  for (const qr of activeQrSessions.values()) {
    qr.isStopped = true;
    if (qr.pollTimer) clearTimeout(qr.pollTimer);
    if (!qr.clientTransferred) {
      await destroyTelegramClientSafely(qr.client);
    }
  }
  activeQrSessions.clear();
  pendingLocalUpdates.length = 0;

  if (revokeTelegramSessions) {
    try {
      await db.prepare('DELETE FROM telegram_user_sessions').run();
    } catch {}
  }

  res.clearCookie('tg_session', { path: '/' });
  res.json({ ok: true, message: '已安全退出登录并断开活跃会话连接' });
});

// 0.3 Member Stats for Dashboard / Admin
app.get('/api/admin/users/stats', requireTenantAuth, async (_req: Request, res: Response) => {
  try {
    const totalRow = (await db.prepare('SELECT count(*) as cnt FROM app_users').get()) as any;
    const users = (await db.prepare('SELECT id, username, role, created_at, last_login_at FROM app_users ORDER BY created_at DESC LIMIT 50').all()) as any[];
    res.json({
      ok: true,
      totalMembers: totalRow?.cnt || 0,
      activeSessions: activeSessions.size,
      users,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== DATABASE & MESSAGES API ====================

// 1. Database Status & Metrics (Protected with requireTenantAuth)
app.get('/api/database/status', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const pingResult = await db.ping();
    const msgRes = (await db.prepare('SELECT count(*) as count FROM messages').get()) as any;
    const profileRes = (await db.prepare('SELECT count(*) as count FROM customer_profiles').get()) as any;
    const msgCount = msgRes?.count || 0;
    const profileCount = profileRes?.count || 0;
    let sizeBytes = 0;
    if (!isTurso) {
      try {
        const stats = fs.statSync(dbPath);
        sizeBytes = stats.size;
      } catch {
        // ignore
      }
    }

    res.json({
      status: 'connected',
      verified: true,
      pingLatencyMs: pingResult.latencyMs,
      dbType,
      isTurso,
      isRailway,
      isPersistentVolume,
      persistenceTier,
      tursoUrl: db.tursoUrl,
      dbDir: isTurso ? undefined : dbDir,
      dbPath: isTurso ? undefined : dbPath,
      totalMessages: Number(msgCount),
      totalProfiles: Number(profileCount),
      sizeBytes,
      walEnabled: true,
      railwayGuide: !isTurso && !isPersistentVolume
        ? '当前环境使用临时容器文件系统。若在 Railway 部署，请在服务控制台点击「Add Volume」，设置挂载路径为「/data」或「/app/data」即可确保重新部署数据永不丢失！或在环境变量配置 TURSO_DATABASE_URL 接入高可用云端数据库。'
        : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, status: 'error' });
  }
});

// 1.1 Export Database Full Snapshot (Protected: Master Administrator Only, Excludes Sessions)
app.get('/api/database/backup', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const session = (req as any).auth?.session;
    if (!session?.isMaster) {
      return res.status(403).json({ error: '权限不足：仅管理员有权导出数据库备份' });
    }
    const snapshot = await exportDatabaseSnapshot();
    res.setHeader('Content-Disposition', `attachment; filename="telegram_pro_backup_${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(snapshot, null, 2));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 1.2 Restore Database from Full Snapshot (Protected: Master Administrator Only with Two-Factor confirmation)
app.post('/api/database/restore', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const session = (req as any).auth?.session;
    if (!session?.isMaster) {
      return res.status(403).json({ error: '权限不足：仅管理员有权恢复数据库备份' });
    }

    const { confirm = false } = req.query;
    if (confirm !== 'true' && req.body?.confirm !== true) {
      return res.status(400).json({
        error: '恢复确认缺失：恢复备份将覆盖或合并现有数据，必须携带 confirm=true 进行二次确认',
        requiresConfirmation: true,
      });
    }

    const snapshot = req.body?.snapshot || req.body;
    if (!snapshot || !snapshot.tables) {
      return res.status(400).json({ error: '无效的数据快照格式，必须包含 tables 结构' });
    }
    const result = await restoreDatabaseSnapshot(snapshot);
    res.json({
      success: true,
      message: '数据快照恢复成功！',
      restoredCounts: result.restoredCounts,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== UNIFIED CONVERSATION SYNC & RESOLUTION PIPELINE ====================

export interface UnifiedChatMessage {
  id: string;
  telegramMessageId?: number;
  chatId: string;
  accountId: string;
  sender: 'me' | 'peer' | 'system';
  senderName: string;
  text: string;
  translatedText: string;
  isAudio: boolean;
  audioDuration: number;
  audioUrl: string;
  sttText: string;
  voiceTone: string;
  isImage: boolean;
  imageUrl: string;
  imageCaption: string;
  isVideo: boolean;
  videoUrl: string;
  videoDuration: number;
  isFile: boolean;
  fileName: string;
  fileSize: string;
  fileUrl: string;
  timestamp: string;
  createdAt: number;
  deliveryStatus: string;
  replyTo?: { id: string; telegramMessageId?: number; senderName?: string; text: string };
  isEdited?: boolean;
  isPinned?: boolean;
  forwardFrom?: string;
}

export function sanitizeDbMediaUrl(url: any): string {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s) return '';
  if (s.startsWith('blob:')) {
    return '';
  }
  if (s.startsWith('data:') && s.length > 512 * 1024) {
    return '';
  }
  return s;
}

export function normalizeStoredMessageRecord(
  raw: any,
  fallbackChatId = '',
  fallbackAccountId = 'acc_1'
): UnifiedChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const chatId = String(raw.chatId || raw.chat_id || fallbackChatId || '').trim();
  if (!chatId) return null;

  const createdAtRaw = Number(raw.createdAt ?? raw.created_at);
  const createdAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? createdAtRaw : Date.now();
  const tgIdRaw = Number(raw.telegramMessageId ?? raw.telegram_message_id ?? resolveTelegramMessageNumericId(raw.id) ?? 0);
  const telegramMessageId = Number.isInteger(tgIdRaw) && tgIdRaw > 0 ? tgIdRaw : undefined;
  const senderRaw = String(raw.sender || 'me');
  const sender: 'me' | 'peer' | 'system' =
    senderRaw === 'peer' ? 'peer' : senderRaw === 'system' ? 'system' : 'me';

  const id = String(
    raw.id ||
      (telegramMessageId
        ? `tg_cloud_${telegramMessageId}_${createdAt}`
        : `msg_${createdAt}_${Math.random().toString(36).slice(2, 6)}`)
  );

  const parsedReplyTo =
    raw.replyTo && typeof raw.replyTo === 'object'
      ? raw.replyTo
      : typeof raw.reply_to_json === 'string' && raw.reply_to_json
      ? safeJsonParse<{ id: string; telegramMessageId?: number; senderName?: string; text: string } | undefined>(raw.reply_to_json, undefined)
      : undefined;

  return {
    id,
    telegramMessageId,
    chatId,
    accountId: String(raw.accountId || raw.account_id || fallbackAccountId || 'acc_1'),
    sender,
    senderName: String(raw.senderName ?? raw.sender_name ?? (sender === 'peer' ? '客户' : '我方')),
    text: String(raw.text ?? ''),
    translatedText: String(raw.translatedText ?? raw.translated_text ?? ''),
    isAudio: Boolean(raw.isAudio ?? raw.is_audio),
    audioDuration: Number(raw.audioDuration ?? raw.audio_duration ?? 0) || 0,
    audioUrl: String(raw.audioUrl ?? raw.audio_url ?? ''),
    sttText: String(raw.sttText ?? raw.stt_text ?? ''),
    voiceTone: String(raw.voiceTone ?? raw.voice_tone ?? ''),
    isImage: Boolean(raw.isImage ?? raw.is_image),
    imageUrl: String(raw.imageUrl ?? raw.image_url ?? ''),
    imageCaption: String(raw.imageCaption ?? raw.image_caption ?? ''),
    isVideo: Boolean(raw.isVideo ?? raw.is_video),
    videoUrl: String(raw.videoUrl ?? raw.video_url ?? ''),
    videoDuration: Number(raw.videoDuration ?? raw.video_duration ?? 0) || 0,
    isFile: Boolean(raw.isFile ?? raw.is_file),
    fileName: String(raw.fileName ?? raw.file_name ?? ''),
    fileSize: String(raw.fileSize ?? raw.file_size ?? ''),
    fileUrl: String(raw.fileUrl ?? raw.file_url ?? ''),
    timestamp: String(
      raw.timestamp ||
        new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    ),
    createdAt,
    deliveryStatus: String(raw.deliveryStatus ?? raw.delivery_status ?? 'delivered'),
    ...(parsedReplyTo ? { replyTo: parsedReplyTo } : {}),
    isEdited: Boolean(raw.isEdited ?? raw.is_edited),
    isPinned: Boolean(raw.isPinned ?? raw.is_pinned),
    ...(raw.forwardFrom || raw.forward_from ? { forwardFrom: String(raw.forwardFrom ?? raw.forward_from) } : {}),
  };
}

export function getScopedAccountIdVariants(accountId?: string): string[] {
  const raw = String(accountId || 'acc_1').trim() || 'acc_1';
  const clean = raw.replace(/^acc_tg_/, '');
  const set = new Set<string>([raw]);
  if (clean && clean !== 'acc_1' && clean !== 'acc_telegram_bot') {
    set.add(clean);
    set.add(`acc_tg_${clean}`);
  }
  return Array.from(set);
}

export async function getScopedCustomerProfile(chatId: string, accountId?: string): Promise<any | undefined> {
  const effAcc = String(accountId || 'acc_1').trim() || 'acc_1';
  const variants = getScopedAccountIdVariants(effAcc);
  const altChatId = chatId.startsWith('tg_') ? chatId.replace(/^tg_/, '') : `tg_${chatId}`;
  const placeholders = variants.map(() => '?').join(', ');

  try {
    const scoped = (await db
      .prepare(
        `SELECT * FROM account_customer_profiles
         WHERE (chat_id = ? OR chat_id = ?) AND account_id IN (${placeholders})
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(chatId, altChatId, ...variants)) as any;
    if (scoped) return scoped;
  } catch {}

  try {
    const legacy = (await db
      .prepare(
        `SELECT * FROM customer_profiles
         WHERE (chat_id = ? OR chat_id = ?) AND account_id IN (${placeholders})
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(chatId, altChatId, ...variants)) as any;
    if (legacy) return legacy;
  } catch {}

  return undefined;
}

export async function upsertScopedCustomerProfile(params: {
  chatId: string;
  accountId: string;
  clientName: string;
  relationshipStage: string;
  ageEstimate: string;
  occupation: string;
  locationTimezone: string;
  toneStyle: string;
  likesInterests: string;
  dislikesTaboos: string;
  emotionalNeeds: string;
  keyMemories: string;
  totalMessagesCount?: number;
  lastAnalyzedAt?: number;
  updatedAt: number;
}): Promise<void> {
  const effAcc = String(params.accountId || 'acc_1').trim() || 'acc_1';
  await db
    .prepare(
      `INSERT INTO account_customer_profiles (
        account_id, chat_id, client_name, relationship_stage, age_estimate, occupation,
        location_timezone, tone_style, likes_interests, dislikes_taboos, emotional_needs,
        key_memories, total_messages_count, last_analyzed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, chat_id) DO UPDATE SET
        client_name = excluded.client_name,
        relationship_stage = excluded.relationship_stage,
        age_estimate = excluded.age_estimate,
        occupation = excluded.occupation,
        location_timezone = excluded.location_timezone,
        tone_style = excluded.tone_style,
        likes_interests = excluded.likes_interests,
        dislikes_taboos = excluded.dislikes_taboos,
        emotional_needs = excluded.emotional_needs,
        key_memories = excluded.key_memories,
        last_analyzed_at = CASE WHEN excluded.last_analyzed_at > 0 THEN excluded.last_analyzed_at ELSE account_customer_profiles.last_analyzed_at END,
        updated_at = excluded.updated_at`
    )
    .run(
      effAcc,
      params.chatId,
      params.clientName,
      params.relationshipStage,
      params.ageEstimate,
      params.occupation,
      params.locationTimezone,
      params.toneStyle,
      params.likesInterests,
      params.dislikesTaboos,
      params.emotionalNeeds,
      params.keyMemories,
      params.totalMessagesCount ?? 0,
      params.lastAnalyzedAt ?? 0,
      params.updatedAt
    );

  // Preserve compatibility with legacy customer_profiles table for single-account / bot records
  if (effAcc === 'acc_1' || effAcc === 'acc_telegram_bot') {
    await db
      .prepare(
        `INSERT INTO customer_profiles (
          chat_id, account_id, client_name, relationship_stage, age_estimate, occupation,
          location_timezone, tone_style, likes_interests, dislikes_taboos, emotional_needs,
          key_memories, total_messages_count, last_analyzed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          account_id = excluded.account_id,
          client_name = excluded.client_name,
          relationship_stage = excluded.relationship_stage,
          age_estimate = excluded.age_estimate,
          occupation = excluded.occupation,
          location_timezone = excluded.location_timezone,
          tone_style = excluded.tone_style,
          likes_interests = excluded.likes_interests,
          dislikes_taboos = excluded.dislikes_taboos,
          emotional_needs = excluded.emotional_needs,
          key_memories = excluded.key_memories,
          last_analyzed_at = CASE WHEN excluded.last_analyzed_at > 0 THEN excluded.last_analyzed_at ELSE customer_profiles.last_analyzed_at END,
          updated_at = excluded.updated_at`
      )
      .run(
        params.chatId,
        effAcc,
        params.clientName,
        params.relationshipStage,
        params.ageEstimate,
        params.occupation,
        params.locationTimezone,
        params.toneStyle,
        params.likesInterests,
        params.dislikesTaboos,
        params.emotionalNeeds,
        params.keyMemories,
        params.totalMessagesCount ?? 0,
        params.lastAnalyzedAt ?? 0,
        params.updatedAt
      );
  }
}

export async function upsertSyncedMessageToDb(
  rawMsg: any,
  fallbackChatId = '',
  fallbackAccountId = 'acc_1'
): Promise<boolean> {
  const msg = normalizeStoredMessageRecord(rawMsg, fallbackChatId, fallbackAccountId);
  if (!msg) return false;
  try {
    const altChatId = msg.chatId.startsWith('tg_') ? msg.chatId.replace(/^tg_/, '') : `tg_${msg.chatId}`;
    const accVariants = getScopedAccountIdVariants(msg.accountId);
    const accPlaceholders = accVariants.map(() => '?').join(', ');
    if (msg.telegramMessageId) {
      const existingByTg = (await db
        .prepare(
          `SELECT id FROM messages
           WHERE (chat_id = ? OR chat_id = ?) AND account_id IN (${accPlaceholders}) AND telegram_message_id = ?
           LIMIT 1`
        )
        .get(msg.chatId, altChatId, ...accVariants, msg.telegramMessageId)) as any;

      if (existingByTg?.id && existingByTg.id !== msg.id) {
        const replyToJson = msg.replyTo ? JSON.stringify(msg.replyTo) : null;
        const safeAudioUrl = sanitizeDbMediaUrl(msg.audioUrl);
        const safeImageUrl = sanitizeDbMediaUrl(msg.imageUrl);
        const safeVideoUrl = sanitizeDbMediaUrl(msg.videoUrl);
        const safeFileUrl = sanitizeDbMediaUrl(msg.fileUrl);
        await db
          .prepare(
            `UPDATE messages SET
               text = CASE WHEN ? != '' THEN ? ELSE text END,
               translated_text = CASE WHEN ? != '' THEN ? ELSE translated_text END,
               stt_text = CASE WHEN ? != '' THEN ? ELSE stt_text END,
               voice_tone = CASE WHEN ? != '' THEN ? ELSE voice_tone END,
               audio_url = CASE WHEN ? != '' THEN ? ELSE audio_url END,
               image_url = CASE WHEN ? != '' THEN ? ELSE image_url END,
               video_url = CASE WHEN ? != '' THEN ? ELSE video_url END,
               is_file = CASE WHEN ? = 1 THEN 1 ELSE is_file END,
               file_name = CASE WHEN ? != '' THEN ? ELSE file_name END,
               file_size = CASE WHEN ? != '' THEN ? ELSE file_size END,
               file_url = CASE WHEN ? != '' THEN ? ELSE file_url END,
               delivery_status = CASE WHEN ? != '' THEN ? ELSE delivery_status END,
               reply_to_json = COALESCE(?, reply_to_json),
               is_edited = CASE WHEN ? = 1 THEN 1 ELSE is_edited END,
               is_pinned = ?,
               forward_from = COALESCE(?, forward_from)
             WHERE id = ?`
          )
          .run(
            msg.text,
            msg.text,
            msg.translatedText,
            msg.translatedText,
            msg.sttText,
            msg.sttText,
            msg.voiceTone,
            msg.voiceTone,
            safeAudioUrl,
            safeAudioUrl,
            safeImageUrl,
            safeImageUrl,
            safeVideoUrl,
            safeVideoUrl,
            msg.isFile ? 1 : 0,
            msg.fileName,
            msg.fileName,
            msg.fileSize,
            msg.fileSize,
            safeFileUrl,
            safeFileUrl,
            msg.deliveryStatus,
            msg.deliveryStatus,
            replyToJson,
            msg.isEdited ? 1 : 0,
            msg.isPinned ? 1 : 0,
            msg.forwardFrom || null,
            existingByTg.id
          );
        return true;
      }
    }

    const replyToJson = msg.replyTo ? JSON.stringify(msg.replyTo) : null;
    await db
      .prepare(
        `INSERT INTO messages (
          id, chat_id, account_id, sender, sender_name, text, translated_text,
          is_audio, audio_duration, audio_url, stt_text, voice_tone,
          is_image, image_url, image_caption, is_video, video_url, video_duration,
          is_file, file_name, file_size, file_url,
          timestamp, created_at, delivery_status, telegram_message_id,
          reply_to_json, is_edited, is_pinned, forward_from
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          text = CASE WHEN excluded.text != '' THEN excluded.text ELSE messages.text END,
          translated_text = CASE WHEN excluded.translated_text != '' THEN excluded.translated_text ELSE messages.translated_text END,
          stt_text = CASE WHEN excluded.stt_text != '' THEN excluded.stt_text ELSE messages.stt_text END,
          voice_tone = CASE WHEN excluded.voice_tone != '' THEN excluded.voice_tone ELSE messages.voice_tone END,
          audio_url = CASE WHEN excluded.audio_url != '' THEN excluded.audio_url ELSE messages.audio_url END,
          image_url = CASE WHEN excluded.image_url != '' THEN excluded.image_url ELSE messages.image_url END,
          video_url = CASE WHEN excluded.video_url != '' THEN excluded.video_url ELSE messages.video_url END,
          is_file = CASE WHEN excluded.is_file = 1 THEN 1 ELSE messages.is_file END,
          file_name = CASE WHEN excluded.file_name != '' THEN excluded.file_name ELSE messages.file_name END,
          file_size = CASE WHEN excluded.file_size != '' THEN excluded.file_size ELSE messages.file_size END,
          file_url = CASE WHEN excluded.file_url != '' THEN excluded.file_url ELSE messages.file_url END,
          delivery_status = CASE WHEN excluded.delivery_status != '' THEN excluded.delivery_status ELSE messages.delivery_status END,
          telegram_message_id = COALESCE(excluded.telegram_message_id, messages.telegram_message_id),
          reply_to_json = COALESCE(excluded.reply_to_json, messages.reply_to_json),
          is_edited = CASE WHEN excluded.is_edited = 1 THEN 1 ELSE messages.is_edited END,
          is_pinned = excluded.is_pinned,
          forward_from = COALESCE(excluded.forward_from, messages.forward_from)`
      )
      .run(
        msg.id,
        msg.chatId,
        msg.accountId,
        msg.sender,
        msg.senderName,
        msg.text,
        msg.translatedText,
        msg.isAudio ? 1 : 0,
        msg.audioDuration,
        sanitizeDbMediaUrl(msg.audioUrl),
        msg.sttText,
        msg.voiceTone,
        msg.isImage ? 1 : 0,
        sanitizeDbMediaUrl(msg.imageUrl),
        msg.imageCaption,
        msg.isVideo ? 1 : 0,
        sanitizeDbMediaUrl(msg.videoUrl),
        msg.videoDuration,
        msg.isFile ? 1 : 0,
        msg.fileName,
        msg.fileSize,
        sanitizeDbMediaUrl(msg.fileUrl),
        msg.timestamp,
        msg.createdAt,
        msg.deliveryStatus,
        msg.telegramMessageId ?? null,
        replyToJson,
        msg.isEdited ? 1 : 0,
        msg.isPinned ? 1 : 0,
        msg.forwardFrom || null
      );
    return true;
  } catch (err: any) {
    console.warn('[Unified Message Store] Failed to upsert synced message:', err?.message || err);
    return false;
  }
}

export function mergeUnifiedConversationMessages(lists: Array<Array<any>>): UnifiedChatMessage[] {
  const merged: UnifiedChatMessage[] = [];
  const byId = new Map<string, number>();
  const byTgKey = new Map<string, number>();

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const item = normalizeStoredMessageRecord(raw);
      if (!item) continue;
      const canonicalChat = item.chatId.replace(/^tg_/, '');
      const tgKey = item.telegramMessageId ? `${canonicalChat}:${item.telegramMessageId}` : '';

      let matchIdx = byId.get(item.id);
      if (matchIdx === undefined && tgKey) {
        matchIdx = byTgKey.get(tgKey);
      }
      if (matchIdx === undefined) {
        const trimmedText = item.text.trim();
        if (trimmedText) {
          matchIdx = merged.findIndex(
            (m) =>
              m.chatId.replace(/^tg_/, '') === canonicalChat &&
              m.sender === item.sender &&
              m.text.trim() === trimmedText &&
              (m.timestamp === item.timestamp || Math.abs(m.createdAt - item.createdAt) < 120000)
          );
          if (matchIdx === -1) matchIdx = undefined;
        }
      }

      if (matchIdx !== undefined) {
        const prev = merged[matchIdx];
        const combined: UnifiedChatMessage = {
          ...prev,
          ...item,
          id: prev.id || item.id,
          telegramMessageId: item.telegramMessageId || prev.telegramMessageId,
          senderName: item.senderName && item.senderName !== '客户' && item.senderName !== '我方' ? item.senderName : prev.senderName,
          text: item.text || prev.text,
          translatedText: item.translatedText || prev.translatedText,
          sttText: item.sttText || prev.sttText,
          voiceTone: item.voiceTone || prev.voiceTone,
          audioUrl: item.audioUrl || prev.audioUrl,
          imageUrl: item.imageUrl || prev.imageUrl,
          videoUrl: item.videoUrl || prev.videoUrl,
          isFile: Boolean(item.isFile || prev.isFile),
          fileName: item.fileName || prev.fileName,
          fileSize: item.fileSize || prev.fileSize,
          fileUrl: item.fileUrl || prev.fileUrl,
          deliveryStatus: item.deliveryStatus === 'delivered' || prev.deliveryStatus === 'delivered'
            ? 'delivered'
            : (item.deliveryStatus || prev.deliveryStatus),
          createdAt: Math.min(prev.createdAt, item.createdAt),
        };
        merged[matchIdx] = combined;
        byId.set(item.id, matchIdx);
        byId.set(combined.id, matchIdx);
        if (tgKey) byTgKey.set(tgKey, matchIdx);
      } else {
        const idx = merged.length;
        merged.push(item);
        byId.set(item.id, idx);
        if (tgKey) byTgKey.set(tgKey, idx);
      }
    }
  }

  return merged.sort((a, b) => a.createdAt - b.createdAt);
}

export async function resolveUnifiedChatMessages(params: {
  chatId: string;
  accountId?: string;
  clientMessages?: any[];
  limit?: number;
  syncCloud?: boolean;
  persistClientMessages?: boolean;
}): Promise<{
  messages: UnifiedChatMessage[];
  sourcesUsed: { db: number; client: number; cloud: number };
}> {
  const {
    chatId,
    accountId = 'acc_1',
    clientMessages = [],
    limit = 50,
    syncCloud = true,
    persistClientMessages = true,
  } = params;

  const altChatId = chatId.startsWith('tg_') ? chatId.replace(/^tg_/, '') : `tg_${chatId}`;
  const accVariants = getScopedAccountIdVariants(accountId);
  const accPlaceholders = accVariants.map(() => '?').join(', ');

  let dbRows: any[] = [];
  try {
    dbRows = (await db
      .prepare(
        `SELECT
          id, chat_id as chatId, account_id as accountId, sender, sender_name as senderName,
          text, translated_text as translatedText, is_audio as isAudio, audio_duration as audioDuration,
          audio_url as audioUrl, stt_text as sttText, voice_tone as voiceTone,
          is_image as isImage, image_url as imageUrl, image_caption as imageCaption,
          is_video as isVideo, video_url as videoUrl, video_duration as videoDuration,
          is_file as isFile, file_name as fileName, file_size as fileSize, file_url as fileUrl,
          timestamp, created_at as createdAt, delivery_status as deliveryStatus,
          telegram_message_id as telegramMessageId
        FROM (
          SELECT * FROM messages
          WHERE (chat_id = ? OR chat_id = ?) AND account_id IN (${accPlaceholders})
          ORDER BY created_at DESC
          LIMIT ?
        ) ORDER BY created_at ASC`
      )
      .all(chatId, altChatId, ...accVariants, Math.max(1, limit))) as any[];
  } catch (err: any) {
    console.warn('[Unified Chat Resolver] DB query failed:', err?.message || err);
  }

  const normalizedClient = Array.isArray(clientMessages)
    ? clientMessages
        .slice(-limit)
        .map((m) => normalizeStoredMessageRecord(m, chatId, accountId))
        .filter((m): m is UnifiedChatMessage => Boolean(m))
    : [];

  if (persistClientMessages && normalizedClient.length > 0) {
    for (const cm of normalizedClient.slice(-30)) {
      await upsertSyncedMessageToDb(cm, chatId, accountId);
    }
  }

  let cloudRows: any[] = [];
  const isTelegramPersonalChat =
    (chatId.startsWith('tg_') || /^-?\d+$/.test(chatId)) && accountId !== 'acc_telegram_bot';
  if (syncCloud && isTelegramPersonalChat) {
    const connected =
      resolveConnectedTelegramUser(accountId) ||
      (accountId === 'acc_1' ? Array.from(connectedUserClients.values())[0] : undefined);
    if (connected?.client) {
      try {
        const timeoutPromise = new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 6000));
        cloudRows = await Promise.race([
          syncTelegramUserChatMessages(connected.client, chatId, Math.min(limit, 50), connected.userId),
          timeoutPromise,
        ]);
      } catch (err: any) {
        console.warn(`[Unified Chat Resolver] Cloud sync failed for ${chatId}:`, err?.message || err);
      }
    }
  }

  const unified = mergeUnifiedConversationMessages([dbRows, cloudRows, normalizedClient]);
  return {
    messages: unified.slice(-limit),
    sourcesUsed: {
      db: dbRows.length,
      client: normalizedClient.length,
      cloud: cloudRows.length,
    },
  };
}

export async function resolveUnifiedEvolutionCorpus(params: {
  sampleTexts?: any[];
  clientMessages?: any[];
  accountId?: string;
  limit?: number;
}): Promise<{
  corpusText: string;
  analyzedConversationsCount: number;
  totalMessagesCount: number;
}> {
  const { sampleTexts = [], clientMessages = [], accountId, limit = 50 } = params;
  const cleanAccountId = typeof accountId === 'string' ? accountId.trim() : '';
  const accVariants = cleanAccountId ? getScopedAccountIdVariants(cleanAccountId) : [];

  let dbMsgs: any[] = [];
  try {
    if (accVariants.length > 0) {
      const accPlaceholders = accVariants.map(() => '?').join(', ');
      dbMsgs = (await db
        .prepare(
          `SELECT
            id, chat_id as chatId, account_id as accountId, sender, sender_name as senderName,
            text, translated_text as translatedText, stt_text as sttText, timestamp, created_at as createdAt,
            telegram_message_id as telegramMessageId
          FROM messages WHERE account_id IN (${accPlaceholders}) ORDER BY created_at DESC LIMIT ?`
        )
        .all(...accVariants, limit)) as any[];
    } else {
      dbMsgs = (await db
        .prepare(
          `SELECT
            id, chat_id as chatId, account_id as accountId, sender, sender_name as senderName,
            text, translated_text as translatedText, stt_text as sttText, timestamp, created_at as createdAt,
            telegram_message_id as telegramMessageId
          FROM messages ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit)) as any[];
    }
  } catch {}

  const accVariantSet = new Set(accVariants);
  const filteredClientMessages = Array.isArray(clientMessages)
    ? clientMessages.filter((m) => {
        if (!cleanAccountId) return true;
        if (!m?.accountId) return true;
        const msgAcc = String(m.accountId).trim();
        return msgAcc === cleanAccountId || accVariantSet.has(msgAcc);
      })
    : [];

  const normalizedClient = filteredClientMessages
    .slice(-limit)
    .map((m) => normalizeStoredMessageRecord(m, m?.chatId || 'client_synced', cleanAccountId || 'acc_1'))
    .filter((m): m is UnifiedChatMessage => Boolean(m));

  if (normalizedClient.length > 0) {
    for (const cm of normalizedClient.slice(-30)) {
      if (cm.chatId && cm.chatId !== 'client_synced') {
        await upsertSyncedMessageToDb(cm, cm.chatId, cm.accountId);
      }
    }
  }

  let cloudMsgs: any[] = [];
  if (dbMsgs.length + normalizedClient.length < 6 && connectedUserClients.size > 0) {
    const connected = cleanAccountId
      ? resolveConnectedTelegramUser(cleanAccountId)
      : Array.from(connectedUserClients.values())[0];
    if (connected?.client) {
      try {
        const dialogs = await Promise.race([
          connected.client.getDialogs({ limit: 8 }),
          new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 5000)),
        ]);
        const targetDialogs = (Array.isArray(dialogs) ? dialogs : [])
          .filter((d: any) => {
            const idStr = String(d?.id || '');
            return idStr && idStr !== '777000' && idStr !== '42777' && idStr !== String(connected.userId);
          })
          .slice(0, 4);
        for (const dlg of targetDialogs) {
          const synced = await syncTelegramUserChatMessages(connected.client, `tg_${dlg.id}`, 12, connected.userId);
          if (synced.length > 0) {
            cloudMsgs.push(...synced);
          }
        }
      } catch (err: any) {
        console.warn('[Unified Evolution Corpus] Cloud dialog fetch non-fatal:', err?.message || err);
      }
    }
  }

  const merged = mergeUnifiedConversationMessages([dbMsgs, cloudMsgs, normalizedClient]);
  const distinctChatIds = new Set<string>();
  const dialogueLines: string[] = [];
  for (const m of merged) {
    const rawText = String(m.sttText || m.text || '').trim();
    if (!rawText || /^\[(语音|图片|视频|多媒体)消息\]$|^Voice Message$/i.test(rawText)) continue;
    if (m.chatId) distinctChatIds.add(m.chatId);
    dialogueLines.push(`${m.sender === 'peer' ? '客户' : '我方'}: ${rawText}`);
  }

  const validSampleTexts = Array.isArray(sampleTexts)
    ? sampleTexts.map((t: any) => String(t || '').trim()).filter(Boolean)
    : [];

  const corpusText = [...dialogueLines, ...validSampleTexts].join('\n').trim();
  const analyzedConversationsCount = distinctChatIds.size + (validSampleTexts.length > 0 ? 1 : 0);

  return {
    corpusText,
    analyzedConversationsCount,
    totalMessagesCount: dialogueLines.length,
  };
}

// 1.3 Fetch Chats List for active tenant/account
app.get('/api/chats', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const authContext = (req as any).auth;
    const effectiveAccountId = authContext?.effectiveAccountId || 'acc_1';
    const accVariants = getScopedAccountIdVariants(effectiveAccountId);
    const accPlaceholders = accVariants.map(() => '?').join(', ');

    // Query account-isolated profiles first, then merge legacy customer_profiles rows
    const [scopedRows, legacyRows] = await Promise.all([
      db.prepare(`
        SELECT chat_id, account_id, client_name, relationship_stage, total_messages_count, updated_at
        FROM account_customer_profiles
        WHERE account_id IN (${accPlaceholders})
        ORDER BY updated_at DESC
      `).all(...accVariants) as Promise<any[]>,
      db.prepare(`
        SELECT chat_id, account_id, client_name, relationship_stage, total_messages_count, updated_at
        FROM customer_profiles
        WHERE account_id IN (${accPlaceholders})
           OR (account_id = 'acc_telegram_bot' AND ? IN ('acc_telegram_bot', 'acc_1'))
        ORDER BY updated_at DESC
      `).all(...accVariants, effectiveAccountId) as Promise<any[]>,
    ]);

    const mergedProfilesMap = new Map<string, any>();
    for (const row of legacyRows || []) {
      const key = `${row.account_id}::${row.chat_id}`;
      mergedProfilesMap.set(key, row);
    }
    for (const row of scopedRows || []) {
      const key = `${row.account_id}::${row.chat_id}`;
      mergedProfilesMap.set(key, row);
    }
    const profiles = Array.from(mergedProfilesMap.values()).sort(
      (a, b) => Number(b?.updated_at || 0) - Number(a?.updated_at || 0)
    );

    // Retrieve latest message for each chat strictly scoped to this account
    const chatsData = await Promise.all(
      profiles.map(async (p: any) => {
        const lastMsg = (await db.prepare(`
          SELECT text, translated_text, is_audio, timestamp, created_at, sender
          FROM messages
          WHERE chat_id = ? AND account_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `).get(p.chat_id, p.account_id)) as any;

        const isTgOfficial = p.chat_id.startsWith('tg_');
        return {
          id: p.chat_id,
          accountId: p.account_id,
          title: p.client_name || (isTgOfficial ? `Telegram 用户 (${p.chat_id.replace('tg_', '')})` : p.chat_id),
          avatarBg: isTgOfficial ? '#2481cc' : '#ec4899',
          avatarInitial: (p.client_name || 'TG').slice(0, 2).toUpperCase(),
          isGroup: false,
          isVerified: isTgOfficial,
          lastMessage: lastMsg?.is_audio ? '🎤 语音消息' : (lastMsg?.translated_text || lastMsg?.text || '暂无消息'),
          lastTime: lastMsg?.timestamp || '刚刚',
          unreadCount: 0,
          sourceLang: 'Auto',
          targetLang: 'Chinese',
          aiEnabled: true,
          aiMode: 'adaptive',
          typingDelayMin: 2,
          typingDelayMax: 5,
        };
      })
    );

    res.json(chatsData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Fetch Chat Messages from Database (Strict Tenant Filter)
app.get('/api/messages/:chatId', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const authContext = (req as any).auth;
    const effectiveAccountId = authContext?.effectiveAccountId || 'acc_1';
    const isMaster = authContext?.session?.isMaster;

    const accVariants = getScopedAccountIdVariants(effectiveAccountId);
    const includeBotFallback = effectiveAccountId === 'acc_telegram_bot' || effectiveAccountId === 'acc_1';
    if (includeBotFallback && !accVariants.includes('acc_telegram_bot')) {
      accVariants.push('acc_telegram_bot');
    }

    // Verify whether this chat belongs to effectiveAccountId
    const scopedProfile = await getScopedCustomerProfile(chatId, effectiveAccountId);
    if (!scopedProfile && !isMaster) {
      const foreignProfile = (await db.prepare('SELECT account_id FROM customer_profiles WHERE chat_id = ?').get(chatId)) as any;
      if (foreignProfile && !accVariants.includes(foreignProfile.account_id)) {
        return res.status(403).json({ error: '无权查看不属于当前账号的聊天记录' });
      }
    }

    const altChatId = chatId.startsWith('tg_') ? chatId.replace(/^tg_/, '') : `tg_${chatId}`;
    const accPlaceholders = accVariants.map(() => '?').join(', ');
    const rawLimit = Number(req.query.limit);
    const rawBeforeCreatedAt = Number(req.query.beforeCreatedAt);
    const hasPagination =
      (Number.isFinite(rawLimit) && rawLimit > 0) ||
      (Number.isFinite(rawBeforeCreatedAt) && rawBeforeCreatedAt > 0);
    const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(200, Math.floor(rawLimit)) : 100;

    let rows: any[] = [];
    if (hasPagination) {
      const beforeClause =
        Number.isFinite(rawBeforeCreatedAt) && rawBeforeCreatedAt > 0 ? 'AND created_at < ?' : '';
      const queryArgs: any[] = [chatId, altChatId, ...accVariants];
      if (beforeClause) queryArgs.push(Math.floor(rawBeforeCreatedAt));
      queryArgs.push(safeLimit);

      const descRows = (await db.prepare(`
        SELECT 
          id, chat_id as chatId, account_id as accountId, sender, sender_name as senderName,
          text, translated_text as translatedText, is_audio as isAudio, audio_duration as audioDuration,
          audio_url as audioUrl, stt_text as sttText, voice_tone as voiceTone,
          is_image as isImage, image_url as imageUrl, image_caption as imageCaption,
          is_video as isVideo, video_url as videoUrl, video_duration as videoDuration,
          is_file as isFile, file_name as fileName, file_size as fileSize, file_url as fileUrl,
          timestamp, created_at as createdAt, delivery_status as deliveryStatus,
          telegram_message_id as telegramMessageId,
          reply_to_json as replyToJson,
          is_edited as isEdited,
          is_pinned as isPinned,
          forward_from as forwardFrom
        FROM messages
        WHERE (chat_id = ? OR chat_id = ?) AND account_id IN (${accPlaceholders}) ${beforeClause}
        ORDER BY created_at DESC
        LIMIT ?
      `).all(...queryArgs)) as any[];
      rows = descRows.reverse();
    } else {
      rows = (await db.prepare(`
        SELECT 
          id, chat_id as chatId, account_id as accountId, sender, sender_name as senderName,
          text, translated_text as translatedText, is_audio as isAudio, audio_duration as audioDuration,
          audio_url as audioUrl, stt_text as sttText, voice_tone as voiceTone,
          is_image as isImage, image_url as imageUrl, image_caption as imageCaption,
          is_video as isVideo, video_url as videoUrl, video_duration as videoDuration,
          is_file as isFile, file_name as fileName, file_size as fileSize, file_url as fileUrl,
          timestamp, created_at as createdAt, delivery_status as deliveryStatus,
          telegram_message_id as telegramMessageId,
          reply_to_json as replyToJson,
          is_edited as isEdited,
          is_pinned as isPinned,
          forward_from as forwardFrom
        FROM messages
        WHERE (chat_id = ? OR chat_id = ?) AND account_id IN (${accPlaceholders})
        ORDER BY created_at ASC
      `).all(chatId, altChatId, ...accVariants)) as any[];
    }

    const resignLocalUrl = (rawUrl?: string, msgAcc?: string) => {
      if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
      if (rawUrl.startsWith('/api/messages/local-media/')) {
        const basePath = rawUrl.split('?')[0];
        return signTelegramResourceUrl(basePath, msgAcc || effectiveAccountId);
      }
      return rawUrl;
    };

    const formatted = rows.map((r: any) => {
      const { replyToJson, ...rest } = r;
      const replyTo = replyToJson ? safeJsonParse(replyToJson, undefined) : undefined;
      return {
        ...rest,
        audioUrl: resignLocalUrl(r.audioUrl, r.accountId),
        imageUrl: resignLocalUrl(r.imageUrl, r.accountId),
        videoUrl: resignLocalUrl(r.videoUrl, r.accountId),
        fileUrl: resignLocalUrl(r.fileUrl, r.accountId),
        isAudio: Boolean(r.isAudio),
        isImage: Boolean(r.isImage),
        isVideo: Boolean(r.isVideo),
        isFile: Boolean(r.isFile),
        isEdited: Boolean(r.isEdited),
        isPinned: Boolean(r.isPinned),
        ...(replyTo ? { replyTo } : {}),
        ...(r.forwardFrom ? { forwardFrom: r.forwardFrom } : {}),
        deliveryStatus: r.deliveryStatus || 'delivered',
      };
    });

    // If local messages are empty, attempt real-time cloud sync from connected MTProto client
    if (formatted.length === 0) {
      const personalAccount = effectiveAccountId
        ? connectedUserClients.get(effectiveAccountId) ||
          Array.from(connectedUserClients.values()).find(
            (u) => u.userId === effectiveAccountId || u.phone === effectiveAccountId || `acc_tg_${u.userId}` === effectiveAccountId
          )
        : null;

      if (personalAccount && personalAccount.client) {
        try {
          const cloudMessages = await syncTelegramUserChatMessages(personalAccount.client, chatId, 30, personalAccount.userId);
          if (cloudMessages && cloudMessages.length > 0) {
            return res.json(cloudMessages);
          }
        } catch (e: any) {
          if (isTelegramSessionExpiredError(e)) {
            await markTelegramSessionExpired({
              accountId: effectiveAccountId,
              userId: personalAccount.userId,
              phone: personalAccount.phone,
              reason: formatTelegramError(e),
            });
            return res.status(401).json({
              ok: false,
              code: 'TELEGRAM_SESSION_EXPIRED',
              error: 'Telegram 登录会话已失效，请重新扫码或验证码登录',
            });
          }
          console.warn(`[Auto-Sync Cloud Messages Failed] chat ${chatId}:`, e.message);
        }
      }
    }

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Serve disk-backed outbound media with HTTP Range streaming (zero RAM buffering)
app.get('/api/messages/local-media/:fileKey', async (req: Request, res: Response) => {
  try {
    if (!isAllowedClientOrigin(req)) {
      return res.status(403).send('Forbidden');
    }
    if (!verifySignedTelegramResourceRequest(req) && !(req as any).auth) {
      return res.status(401).send('Unauthorized');
    }

    const fileKey = String(req.params.fileKey || '').trim();
    const diskPath = resolveLocalMediaDiskPath(`/api/messages/local-media/${encodeURIComponent(fileKey)}`);
    if (!diskPath) {
      return res.status(404).send('Media not found');
    }

    const stat = await fs.promises.stat(diskPath);
    const total = stat.size;
    const mime = inferMediaMimeFromExt(diskPath);
    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=1800');
    if (req.query.download === '1' || req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(diskPath))}`);
    }

    const rangeHeader = req.headers.range;
    if (rangeHeader && /^bytes=/i.test(rangeHeader)) {
      const match = rangeHeader.replace(/bytes=/i, '').split('-');
      const start = match[0] ? parseInt(match[0], 10) : 0;
      const end = match[1] ? Math.min(parseInt(match[1], 10), total - 1) : total - 1;
      if (!Number.isNaN(start) && !Number.isNaN(end) && start >= 0 && start <= end && start < total) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(end - start + 1));
        const stream = fs.createReadStream(diskPath, { start, end });
        stream.on('error', () => {
          if (!res.headersSent) res.status(500).end();
          else res.destroy();
        });
        return stream.pipe(res);
      }
    }

    res.setHeader('Content-Length', String(total));
    const stream = fs.createReadStream(diskPath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    return stream.pipe(res);
  } catch {
    return res.status(404).send('Media not found');
  }
});

async function resolveOutboundMediaSource(
  mediaUrl: string,
  localDiskPath?: string,
  label = '媒体'
): Promise<{ diskPath?: string; buffer?: Buffer; size: number }> {
  if (localDiskPath && fs.existsSync(localDiskPath)) {
    const stat = await fs.promises.stat(localDiskPath);
    if (stat.size > 0) {
      return { diskPath: localDiskPath, size: stat.size };
    }
  }
  const resolvedFromUrl = resolveLocalMediaDiskPath(mediaUrl);
  if (resolvedFromUrl) {
    const stat = await fs.promises.stat(resolvedFromUrl);
    if (stat.size > 0) {
      return { diskPath: resolvedFromUrl, size: stat.size };
    }
  }
  const buffer = await readMediaBufferStrict(mediaUrl, label);
  return { buffer, size: buffer.length };
}

async function readMediaBufferStrict(mediaUrl: string, label: string): Promise<Buffer> {
  if (!mediaUrl || typeof mediaUrl !== 'string') {
    throw new Error(`${label}地址为空`);
  }
  const resolvedLocal = resolveLocalMediaDiskPath(mediaUrl);
  if (resolvedLocal) {
    const buf = await fs.promises.readFile(resolvedLocal);
    if (!buf || buf.length === 0) throw new Error(`${label}数据为空`);
    return buf;
  }
  let buf: Buffer | null = null;
  if (mediaUrl.startsWith('data:')) {
    const commaIdx = mediaUrl.indexOf(',');
    const base64Data = commaIdx >= 0 ? mediaUrl.slice(commaIdx + 1) : '';
    buf = Buffer.from(base64Data, 'base64');
  } else if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
    const resp = await fetch(mediaUrl);
    if (!resp.ok) {
      throw new Error(`拉取${label}资源失败 (HTTP ${resp.status})`);
    }
    const arrayBuf = await resp.arrayBuffer();
    buf = Buffer.from(arrayBuf);
  } else if (fs.existsSync(mediaUrl)) {
    buf = fs.readFileSync(mediaUrl);
  } else {
    throw new Error(`不支持或不存在的${label}资源路径`);
  }
  if (!buf || buf.length === 0) {
    throw new Error(`${label}数据为空`);
  }
  return buf;
}

async function deliverOutboundTelegramMessage(
  payload: any,
  effectiveAccountId: string,
  msgId: string
): Promise<{
  delivered: boolean;
  channel: 'mtproto' | 'bot' | 'local' | 'none';
  telegramMessageId?: number;
  error?: string;
  sessionExpired?: boolean;
}> {
  const {
    chatId,
    sender,
    text,
    translatedText,
    isAudio = false,
    audioDuration = 0,
    audioUrl = '',
    sttText = '',
    isImage = false,
    imageUrl = '',
    imageCaption = '',
    isVideo = false,
    videoDuration = 0,
    videoUrl = '',
    isFile = false,
    fileName = '',
    fileUrl = '',
    replyTo,
    replyToMsgId,
    _localDiskPath,
  } = payload || {};

  const resolvedReplyToTgId =
    resolveTelegramMessageNumericId(replyTo?.id, replyTo?.telegramMessageId ?? replyToMsgId) || undefined;

  const isExplicitBotChannel = effectiveAccountId === 'acc_telegram_bot';
  const isTelegramChat = Boolean(chatId && (String(chatId).startsWith('tg_') || isExplicitBotChannel));
  if (sender !== 'me' || !isTelegramChat) {
    return { delivered: true, channel: 'local' };
  }

  try {
    const outText = text || translatedText || '';

    // 1. Explicit Bot channel (only when user explicitly selected acc_telegram_bot; never auto-fallback from personal MTProto)
    if (isExplicitBotChannel) {
      if (!process.env.TELEGRAM_BOT_TOKEN) {
        return { delivered: false, channel: 'bot', error: '未配置 TELEGRAM_BOT_TOKEN，Bot 通道无法发送' };
      }

      let botResult: any = null;
      let failDetail = 'Telegram Bot API 投递失败';
      const botOpts: TelegramSendOptions = {
        messageId: msgId,
        ...(resolvedReplyToTgId ? { replyToMessageId: resolvedReplyToTgId } : {}),
      };
      const BOT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
      const diskPathForBot =
        (_localDiskPath && fs.existsSync(_localDiskPath) ? _localDiskPath : null) ||
        resolveLocalMediaDiskPath(audioUrl || imageUrl || videoUrl || fileUrl);
      if (diskPathForBot) {
        const st = await fs.promises.stat(diskPathForBot).catch(() => null);
        if (st && st.size > BOT_MAX_UPLOAD_BYTES) {
          return {
            delivered: false,
            channel: 'bot',
            error: `Telegram Bot API 单文件上限 50MB（当前约 ${Math.round(st.size / (1024 * 1024))}MB），请切换个人号发送大文件`,
          };
        }
      }

      if (isAudio) {
        const mediaInput = diskPathForBot || audioUrl;
        if (!mediaInput) {
          return { delivered: false, channel: 'bot', error: '语音消息缺少音频地址，无法通过 Bot 发送' };
        }
        console.log(`[Telegram Outbound] Bot sending voice message to ${chatId} (${audioDuration}s)...`);
        botResult = await sendTelegramVoice(chatId, mediaInput, sttText || text || translatedText, audioDuration, botOpts);
        failDetail = 'Telegram Bot API 语音发送失败（请检查音频转码或 Bot 权限）';
      } else if (isImage) {
        const mediaInput = diskPathForBot || imageUrl;
        if (!mediaInput) {
          return { delivered: false, channel: 'bot', error: '图片消息缺少图片地址，无法通过 Bot 发送' };
        }
        console.log(`[Telegram Outbound] Bot sending photo to ${chatId}...`);
        botResult = await sendTelegramPhoto(chatId, mediaInput, text || imageCaption || translatedText, botOpts);
        failDetail = 'Telegram Bot API 图片发送失败';
      } else if (isVideo) {
        const mediaInput = diskPathForBot || videoUrl;
        if (!mediaInput) {
          return { delivered: false, channel: 'bot', error: '视频消息缺少视频地址，无法通过 Bot 发送' };
        }
        console.log(`[Telegram Outbound] Bot sending video to ${chatId} (${videoDuration}s)...`);
        botResult = await sendTelegramVideo(chatId, mediaInput, text || translatedText, videoDuration, botOpts);
        failDetail = 'Telegram Bot API 视频发送失败';
      } else if (isFile) {
        const mediaInput = diskPathForBot || fileUrl;
        if (!mediaInput) {
          return { delivered: false, channel: 'bot', error: '文件消息缺少文件地址，无法通过 Bot 发送' };
        }
        console.log(`[Telegram Outbound] Bot sending document to ${chatId}: ${fileName}...`);
        botResult = await sendTelegramDocument(chatId, mediaInput, fileName, text !== `[文件] ${fileName}` ? text : undefined, botOpts);
        failDetail = 'Telegram Bot API 文件发送失败';
      } else {
        if (!outText) {
          return { delivered: false, channel: 'bot', error: '消息内容为空，未能发送至 Telegram' };
        }
        console.log(`[Telegram Outbound] Bot sending text message to ${chatId}: "${outText.slice(0, 30)}..."`);
        botResult = await sendTelegramMessage(chatId, outText, botOpts);
      }

      if (botResult && botResult.ok !== false) {
        return {
          delivered: true,
          channel: 'bot',
          telegramMessageId: Number(botResult?.result?.message_id) || undefined,
        };
      }
      return { delivered: false, channel: 'bot', error: failDetail };
    }

    // 2. Personal MTProto account channel — strictly no silent Bot fallback when offline
    const personalAccount =
      connectedUserClients.get(effectiveAccountId) ||
      Array.from(connectedUserClients.values()).find(
        (u) => u.userId === effectiveAccountId || u.phone === effectiveAccountId || `acc_tg_${u.userId}` === effectiveAccountId
      );

    if (!personalAccount?.client) {
      const normalizedUid = effectiveAccountId.replace(/^acc_tg_/, '');
      let expiredInfo =
        recentlyExpiredAccounts.get(normalizedUid) ||
        recentlyExpiredAccounts.get(effectiveAccountId);
      if (!expiredInfo && normalizedUid) {
        try {
          const row = (await db
            .prepare('SELECT user_id, phone, is_active, expired_reason FROM telegram_user_sessions WHERE (user_id = ? OR phone = ?) AND is_active = 0 LIMIT 1')
            .get(normalizedUid, effectiveAccountId)) as any;
          if (row) {
            expiredInfo = {
              accountId: `acc_tg_${row.user_id || normalizedUid}`,
              userId: row.user_id || normalizedUid,
              phone: row.phone || undefined,
              reason: row.expired_reason || 'Telegram 登录会话已失效，请重新扫码或验证码登录',
              expiredAt: Date.now(),
            };
          }
        } catch {}
      }
      if (expiredInfo) {
        return {
          delivered: false,
          channel: 'mtproto',
          sessionExpired: true,
          error: expiredInfo.reason || 'Telegram 登录会话已失效，请重新扫码或验证码登录',
        };
      }
      return {
        delivered: false,
        channel: 'mtproto',
        error: '当前个人账号未在线连接 Telegram MTProto，消息未送达（已禁用跨通道 Bot 代发）',
      };
    }

    const rawTgId = String(chatId).replace(/^tg_/, '');
    const rawPeer: any = rawTgId === personalAccount.userId ? 'me' : (/^-?\d+$/.test(rawTgId) ? Number(rawTgId) : rawTgId);

    if (isAudio) {
      if (!audioUrl && !_localDiskPath) {
        return { delivered: false, channel: 'mtproto', error: '语音消息缺少音频地址，无法发送至 Telegram' };
      }
      console.log(`[MTProto Outbound] Personal account sending native voice note to ${rawTgId} (${audioDuration || 5}s)...`);
      try {
        const source = await resolveOutboundMediaSource(audioUrl, _localDiskPath, '语音');
        const oggBuffer = await convertAudioToOggOpus(source.diskPath || source.buffer!);
        const voiceFile = new CustomFile('voice.ogg', oggBuffer.length, '', oggBuffer);
        const sentVoice: any = await personalAccount.client.sendFile(rawPeer, {
          file: voiceFile,
          voiceNote: true,
          caption: sttText || text || undefined,
          ...(resolvedReplyToTgId ? { replyTo: resolvedReplyToTgId } : {}),
        });
        console.log(`[MTProto Outbound] Successfully delivered native OGG Opus voice note to ${rawTgId}`);
        return { delivered: true, channel: 'mtproto', telegramMessageId: Number(sentVoice?.id) || undefined };
      } catch (voiceErr: any) {
        const errMsg = formatTelegramError(voiceErr);
        console.error(`[MTProto Voice Send Error]:`, errMsg);
        if (isTelegramSessionExpiredError(voiceErr)) {
          await markTelegramSessionExpired({
            accountId: effectiveAccountId,
            userId: personalAccount.userId,
            phone: personalAccount.phone,
            reason: errMsg,
          });
          return { delivered: false, channel: 'mtproto', sessionExpired: true, error: 'Telegram 登录会话已失效，请重新扫码或验证码登录' };
        }
        return { delivered: false, channel: 'mtproto', error: `语音发送失败: ${errMsg}` };
      }
    }

    if (isImage) {
      if (!imageUrl && !_localDiskPath) {
        return { delivered: false, channel: 'mtproto', error: '图片消息缺少图片地址，无法发送至 Telegram' };
      }
      console.log(`[MTProto Outbound] Personal account sending photo to ${rawTgId}...`);
      try {
        const source = await resolveOutboundMediaSource(imageUrl, _localDiskPath, '图片');
        const uploadExt = source.diskPath ? path.extname(source.diskPath) || '.jpg' : '.jpg';
        const uploadName = `photo${/^\.(jpg|jpeg|png|gif|webp)$/i.test(uploadExt) ? uploadExt : '.jpg'}`;
        const photoFile = source.diskPath
          ? new CustomFile(uploadName, source.size, source.diskPath)
          : new CustomFile(uploadName, source.buffer!.length, '', source.buffer);
        const isFileNameCaption = (s?: string) => {
          if (!s || typeof s !== 'string') return true;
          const trimmed = s.trim();
          if (!trimmed || trimmed.startsWith('[照片]')) return true;
          return /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/i.test(trimmed);
        };
        const explicitCaption = (!isFileNameCaption(text) ? text : undefined) ||
          (!isFileNameCaption(imageCaption) ? imageCaption : undefined) ||
          (!isFileNameCaption(translatedText) ? translatedText : undefined);

        const sentPhoto: any = await personalAccount.client.sendFile(rawPeer, {
          file: photoFile,
          caption: explicitCaption || undefined,
          ...(resolvedReplyToTgId ? { replyTo: resolvedReplyToTgId } : {}),
        });
        console.log(`[MTProto Outbound] Successfully delivered photo to ${rawTgId}`);
        return { delivered: true, channel: 'mtproto', telegramMessageId: Number(sentPhoto?.id) || undefined };
      } catch (photoErr: any) {
        const errMsg = formatTelegramError(photoErr);
        console.error(`[MTProto Photo Send Error]:`, errMsg);
        if (isTelegramSessionExpiredError(photoErr)) {
          await markTelegramSessionExpired({
            accountId: effectiveAccountId,
            userId: personalAccount.userId,
            phone: personalAccount.phone,
            reason: errMsg,
          });
          return { delivered: false, channel: 'mtproto', sessionExpired: true, error: 'Telegram 登录会话已失效，请重新扫码或验证码登录' };
        }
        return { delivered: false, channel: 'mtproto', error: `图片发送失败: ${errMsg}` };
      }
    }

    if (isVideo) {
      if (!videoUrl && !_localDiskPath) {
        return { delivered: false, channel: 'mtproto', error: '视频消息缺少视频地址，无法发送至 Telegram' };
      }
      console.log(`[MTProto Outbound] Personal account sending video to ${rawTgId} (${videoDuration || 0}s)...`);
      try {
        const source = await resolveOutboundMediaSource(videoUrl, _localDiskPath, '视频');
        const uploadExt = source.diskPath ? path.extname(source.diskPath) || '.mp4' : '.mp4';
        const uploadName = `video${/^\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(uploadExt) ? uploadExt : '.mp4'}`;
        const videoFile = source.diskPath
          ? new CustomFile(uploadName, source.size, source.diskPath)
          : new CustomFile(uploadName, source.buffer!.length, '', source.buffer);
        const isFileNameCaption = (s?: string) => {
          if (!s || typeof s !== 'string') return true;
          const trimmed = s.trim();
          if (!trimmed || trimmed.startsWith('[视频]')) return true;
          return /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(trimmed);
        };
        const explicitCaption = (!isFileNameCaption(text) ? text : undefined) ||
          (!isFileNameCaption(translatedText) ? translatedText : undefined);

        const sentVideo: any = await personalAccount.client.sendFile(rawPeer, {
          file: videoFile,
          supportsStreaming: true,
          workers: source.size > 10 * 1024 * 1024 ? 4 : 1,
          caption: explicitCaption || undefined,
          ...(resolvedReplyToTgId ? { replyTo: resolvedReplyToTgId } : {}),
        });
        console.log(`[MTProto Outbound] Successfully delivered video to ${rawTgId}`);
        return { delivered: true, channel: 'mtproto', telegramMessageId: Number(sentVideo?.id) || undefined };
      } catch (vidErr: any) {
        const errMsg = formatTelegramError(vidErr);
        console.error(`[MTProto Video Send Error]:`, errMsg);
        if (isTelegramSessionExpiredError(vidErr)) {
          await markTelegramSessionExpired({
            accountId: effectiveAccountId,
            userId: personalAccount.userId,
            phone: personalAccount.phone,
            reason: errMsg,
          });
          return { delivered: false, channel: 'mtproto', sessionExpired: true, error: 'Telegram 登录会话已失效，请重新扫码或验证码登录' };
        }
        return { delivered: false, channel: 'mtproto', error: `视频发送失败: ${errMsg}` };
      }
    }

    if (isFile) {
      if (!fileUrl && !_localDiskPath) {
        return { delivered: false, channel: 'mtproto', error: '文件消息缺少文件地址，无法发送至 Telegram' };
      }
      console.log(`[MTProto Outbound] Personal account sending document to ${rawTgId}: ${fileName}...`);
      try {
        const source = await resolveOutboundMediaSource(fileUrl, _localDiskPath, '文件');
        const resolvedDocName = fileName || (source.diskPath ? path.basename(source.diskPath) : 'file.bin');
        const docFile = source.diskPath
          ? new CustomFile(resolvedDocName, source.size, source.diskPath)
          : new CustomFile(resolvedDocName, source.buffer!.length, '', source.buffer);
        const sentDoc: any = await personalAccount.client.sendFile(rawPeer, {
          file: docFile,
          caption: text !== `[文件] ${fileName}` ? (text || undefined) : undefined,
          forceDocument: true,
          workers: source.size > 10 * 1024 * 1024 ? 4 : 1,
          ...(resolvedReplyToTgId ? { replyTo: resolvedReplyToTgId } : {}),
        });
        console.log(`[MTProto Outbound] Successfully delivered document to ${rawTgId}`);
        return { delivered: true, channel: 'mtproto', telegramMessageId: Number(sentDoc?.id) || undefined };
      } catch (fileErr: any) {
        const errMsg = formatTelegramError(fileErr);
        console.error(`[MTProto File Send Error]:`, errMsg);
        if (isTelegramSessionExpiredError(fileErr)) {
          await markTelegramSessionExpired({
            accountId: effectiveAccountId,
            userId: personalAccount.userId,
            phone: personalAccount.phone,
            reason: errMsg,
          });
          return { delivered: false, channel: 'mtproto', sessionExpired: true, error: 'Telegram 登录会话已失效，请重新扫码或验证码登录' };
        }
        return { delivered: false, channel: 'mtproto', error: `文件发送失败: ${errMsg}` };
      }
    }

    if (!outText) {
      return { delivered: false, channel: 'mtproto', error: '消息内容为空，未能发送至 Telegram' };
    }

    console.log(`[MTProto Outbound] Personal account sending text message to ${rawTgId}: "${outText.slice(0, 30)}..."`);
    markOutboundMessageSent(chatId, outText, effectiveAccountId);
    const sentMsg: any = await personalAccount.client.sendMessage(rawPeer, {
      message: outText,
      ...(resolvedReplyToTgId ? { replyTo: resolvedReplyToTgId } : {}),
    });
    return { delivered: true, channel: 'mtproto', telegramMessageId: Number(sentMsg?.id) || undefined };
  } catch (tgSyncErr: any) {
    const errMsg = formatTelegramError(tgSyncErr);
    console.warn(`[Telegram Outbound Push Error]:`, errMsg);
    if (effectiveAccountId !== 'acc_telegram_bot' && isTelegramSessionExpiredError(tgSyncErr)) {
      await markTelegramSessionExpired({
        accountId: effectiveAccountId,
        reason: errMsg,
      });
      return {
        delivered: false,
        channel: 'mtproto',
        sessionExpired: true,
        error: 'Telegram 登录会话已失效，请重新扫码或验证码登录',
      };
    }
    return {
      delivered: false,
      channel: effectiveAccountId === 'acc_telegram_bot' ? 'bot' : 'mtproto',
      error: errMsg || 'Telegram 投递失败',
    };
  }
}

function applyUploadedMediaToMessagePayload(
  rawPayload: Record<string, any>,
  uploadedMedia: { diskPath: string; diskFileName: string; originalName: string; mimeType: string; size: number } | undefined,
  effectiveAccountId: string
): { payload: Record<string, any>; mediaUrl?: string } {
  if (!uploadedMedia) {
    return { payload: rawPayload };
  }
  const mediaUrl = buildOutboundLocalMediaUrl(uploadedMedia.diskFileName, effectiveAccountId);
  const next: Record<string, any> = {
    ...rawPayload,
    _localDiskPath: uploadedMedia.diskPath,
  };
  if (next.isVideo) {
    next.videoUrl = mediaUrl;
  } else if (next.isImage) {
    next.imageUrl = mediaUrl;
  } else if (next.isAudio) {
    next.audioUrl = mediaUrl;
  } else {
    next.isFile = true;
    next.fileUrl = mediaUrl;
    if (!next.fileName && uploadedMedia.originalName) {
      next.fileName = uploadedMedia.originalName;
    }
    if (!next.fileSize) {
      next.fileSize =
        uploadedMedia.size >= 1024 * 1024
          ? `${(uploadedMedia.size / (1024 * 1024)).toFixed(1)} MB`
          : `${(uploadedMedia.size / 1024).toFixed(1)} KB`;
    }
  }
  return { payload: next, mediaUrl };
}

// 3. Relay Message to Telegram & Persist to Unified Conversation Store (supports streaming multipart/form-data & lightweight text JSON)
app.post('/api/messages', requireTenantAuth, parseMultipartMessageUpload, async (req: Request, res: Response) => {
  try {
    const authContext = (req as any).auth;
    const msgId = req.body?.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const effectiveAccountId = authContext?.effectiveAccountId || req.body?.accountId || 'acc_1';
    const uploadedMedia = (req as any).uploadedMedia;
    const { payload: outboundPayload, mediaUrl } = applyUploadedMediaToMessagePayload(
      req.body && typeof req.body === 'object' ? req.body : {},
      uploadedMedia,
      effectiveAccountId
    );

    const deliveryResult = await deliverOutboundTelegramMessage(outboundPayload, effectiveAccountId, msgId);
    const deliveryStatus = deliveryResult.delivered ? 'delivered' : 'failed';

    let syncedToStore = false;
    if (outboundPayload?.chatId) {
      syncedToStore = await upsertSyncedMessageToDb(
        {
          ...outboundPayload,
          id: msgId,
          accountId: effectiveAccountId,
          deliveryStatus,
          telegramMessageId: deliveryResult.telegramMessageId ?? outboundPayload?.telegramMessageId,
        },
        String(outboundPayload.chatId),
        effectiveAccountId
      );
    }

    res.status(deliveryResult.sessionExpired ? 401 : 200).json({
      success: deliveryResult.delivered,
      id: msgId,
      telegramMessageId: deliveryResult.telegramMessageId,
      syncedToStore,
      localOnly: false,
      delivered: deliveryResult.delivered,
      deliveryStatus,
      channel: deliveryResult.channel,
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(outboundPayload.imageUrl ? { imageUrl: outboundPayload.imageUrl } : {}),
      ...(outboundPayload.videoUrl ? { videoUrl: outboundPayload.videoUrl } : {}),
      ...(outboundPayload.audioUrl ? { audioUrl: outboundPayload.audioUrl } : {}),
      ...(outboundPayload.fileUrl ? { fileUrl: outboundPayload.fileUrl } : {}),
      ...(deliveryResult.sessionExpired ? { code: 'TELEGRAM_SESSION_EXPIRED' } : {}),
      error: deliveryResult.error,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3.1 Retry Delivery of a Failed Message (Unified payload + streaming multipart/form-data + DB sync)
app.post('/api/messages/:id/retry', requireTenantAuth, parseMultipartMessageUpload, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authContext = (req as any).auth;
    const effectiveAccountId = authContext?.effectiveAccountId || 'acc_1';
    const isMaster = Boolean(authContext?.session?.isMaster);
    const uploadedMedia = (req as any).uploadedMedia;

    const rawBody = req.body && typeof req.body === 'object' ? req.body : null;
    const clientMsg = rawBody && rawBody.chatId ? rawBody : null;
    if (clientMsg) {
      if (!isMaster && clientMsg.accountId && clientMsg.accountId !== effectiveAccountId) {
        return res.status(403).json({ error: '无权操作不属于当前账号的消息记录' });
      }
      const targetAcc = clientMsg.accountId || effectiveAccountId;
      let mergedClientMsg: Record<string, any> = { ...clientMsg };
      if (
        !uploadedMedia &&
        !mergedClientMsg.audioUrl &&
        !mergedClientMsg.imageUrl &&
        !mergedClientMsg.videoUrl &&
        !mergedClientMsg.fileUrl
      ) {
        try {
          const existingRow = (await db
            .prepare(
              'SELECT account_id, audio_url, image_url, video_url, file_url, file_name, file_size FROM messages WHERE id = ?'
            )
            .get(id)) as any;
          if (
            existingRow &&
            (isMaster || !existingRow.account_id || existingRow.account_id === effectiveAccountId)
          ) {
            if (existingRow.audio_url) mergedClientMsg.audioUrl = existingRow.audio_url;
            if (existingRow.image_url) mergedClientMsg.imageUrl = existingRow.image_url;
            if (existingRow.video_url) mergedClientMsg.videoUrl = existingRow.video_url;
            if (existingRow.file_url) mergedClientMsg.fileUrl = existingRow.file_url;
            if (!mergedClientMsg.fileName && existingRow.file_name) {
              mergedClientMsg.fileName = existingRow.file_name;
            }
            if (!mergedClientMsg.fileSize && existingRow.file_size) {
              mergedClientMsg.fileSize = existingRow.file_size;
            }
          }
        } catch {}
      }
      const { payload: outboundPayload, mediaUrl } = applyUploadedMediaToMessagePayload(
        mergedClientMsg,
        uploadedMedia,
        targetAcc
      );
      const retryResult = await deliverOutboundTelegramMessage(
        { ...outboundPayload, sender: outboundPayload.sender || 'me' },
        targetAcc,
        id
      );
      const nextStatus = retryResult.delivered ? 'delivered' : 'failed';
      await upsertSyncedMessageToDb(
        {
          ...outboundPayload,
          id,
          sender: outboundPayload.sender || 'me',
          accountId: targetAcc,
          deliveryStatus: nextStatus,
          telegramMessageId: retryResult.telegramMessageId ?? outboundPayload.telegramMessageId,
        },
        String(outboundPayload.chatId),
        targetAcc
      );
      return res.status(retryResult.sessionExpired ? 401 : 200).json({
        success: retryResult.delivered,
        delivered: retryResult.delivered,
        telegramMessageId: retryResult.telegramMessageId,
        deliveryStatus: nextStatus,
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(outboundPayload.imageUrl ? { imageUrl: outboundPayload.imageUrl } : {}),
        ...(outboundPayload.videoUrl ? { videoUrl: outboundPayload.videoUrl } : {}),
        ...(outboundPayload.audioUrl ? { audioUrl: outboundPayload.audioUrl } : {}),
        ...(outboundPayload.fileUrl ? { fileUrl: outboundPayload.fileUrl } : {}),
        ...(retryResult.sessionExpired ? { code: 'TELEGRAM_SESSION_EXPIRED' } : {}),
        error: retryResult.error,
        message: retryResult.delivered ? 'Message retry delivered' : (retryResult.error || 'Message retry failed'),
      });
    }

    const msg = (await db.prepare('SELECT * FROM messages WHERE id = ?').get(id)) as any;
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Tenant isolation: if not master, message must belong to effectiveAccountId
    if (!isMaster && msg.account_id && msg.account_id !== effectiveAccountId) {
      return res.status(403).json({ error: '无权操作不属于当前账号的消息记录' });
    }

    if (isMaster) {
      await db.prepare('UPDATE messages SET delivery_status = ? WHERE id = ?').run('retrying', id);
    } else {
      await db.prepare('UPDATE messages SET delivery_status = ? WHERE id = ? AND account_id = ?').run('retrying', id, effectiveAccountId);
    }

    const dbBasePayload = {
      chatId: msg.chat_id,
      accountId: msg.account_id,
      sender: msg.sender || 'me',
      text: msg.text,
      translatedText: msg.translated_text,
      isAudio: Boolean(msg.is_audio),
      audioDuration: msg.audio_duration,
      audioUrl: msg.audio_url,
      sttText: msg.stt_text,
      isImage: Boolean(msg.is_image),
      imageUrl: msg.image_url,
      imageCaption: msg.image_caption,
      isVideo: Boolean(msg.is_video),
      videoDuration: msg.video_duration,
      videoUrl: msg.video_url,
      isFile: Boolean(msg.is_file),
      fileName: msg.file_name,
      fileSize: msg.file_size,
      fileUrl: msg.file_url,
      replyTo: msg.reply_to_json ? safeJsonParse(msg.reply_to_json, undefined) : undefined,
    };
    const { payload: dbOutboundPayload, mediaUrl: dbMediaUrl } = applyUploadedMediaToMessagePayload(
      dbBasePayload,
      uploadedMedia,
      msg.account_id || effectiveAccountId
    );

    const dbRetryResult = await deliverOutboundTelegramMessage(
      dbOutboundPayload,
      msg.account_id || effectiveAccountId,
      id
    );

    const nextStatus = dbRetryResult.delivered ? 'delivered' : 'failed';
    try {
      if (isMaster) {
        await db
          .prepare(
            `UPDATE messages SET
               delivery_status = ?,
               telegram_message_id = COALESCE(?, telegram_message_id),
               audio_url = CASE WHEN ? != '' THEN ? ELSE audio_url END,
               image_url = CASE WHEN ? != '' THEN ? ELSE image_url END,
               video_url = CASE WHEN ? != '' THEN ? ELSE video_url END,
               file_url = CASE WHEN ? != '' THEN ? ELSE file_url END
             WHERE id = ?`
          )
          .run(
            nextStatus,
            dbRetryResult.telegramMessageId ?? null,
            dbOutboundPayload.audioUrl || '',
            dbOutboundPayload.audioUrl || '',
            dbOutboundPayload.imageUrl || '',
            dbOutboundPayload.imageUrl || '',
            dbOutboundPayload.videoUrl || '',
            dbOutboundPayload.videoUrl || '',
            dbOutboundPayload.fileUrl || '',
            dbOutboundPayload.fileUrl || '',
            id
          );
      } else {
        await db
          .prepare(
            `UPDATE messages SET
               delivery_status = ?,
               telegram_message_id = COALESCE(?, telegram_message_id),
               audio_url = CASE WHEN ? != '' THEN ? ELSE audio_url END,
               image_url = CASE WHEN ? != '' THEN ? ELSE image_url END,
               video_url = CASE WHEN ? != '' THEN ? ELSE video_url END,
               file_url = CASE WHEN ? != '' THEN ? ELSE file_url END
             WHERE id = ? AND account_id = ?`
          )
          .run(
            nextStatus,
            dbRetryResult.telegramMessageId ?? null,
            dbOutboundPayload.audioUrl || '',
            dbOutboundPayload.audioUrl || '',
            dbOutboundPayload.imageUrl || '',
            dbOutboundPayload.imageUrl || '',
            dbOutboundPayload.videoUrl || '',
            dbOutboundPayload.videoUrl || '',
            dbOutboundPayload.fileUrl || '',
            dbOutboundPayload.fileUrl || '',
            id,
            effectiveAccountId
          );
      }
    } catch {}

    res.status(dbRetryResult.sessionExpired ? 401 : 200).json({
      success: dbRetryResult.delivered,
      delivered: dbRetryResult.delivered,
      telegramMessageId: dbRetryResult.telegramMessageId,
      deliveryStatus: nextStatus,
      ...(dbMediaUrl ? { mediaUrl: dbMediaUrl } : {}),
      ...(dbOutboundPayload.imageUrl ? { imageUrl: dbOutboundPayload.imageUrl } : {}),
      ...(dbOutboundPayload.videoUrl ? { videoUrl: dbOutboundPayload.videoUrl } : {}),
      ...(dbOutboundPayload.audioUrl ? { audioUrl: dbOutboundPayload.audioUrl } : {}),
      ...(dbOutboundPayload.fileUrl ? { fileUrl: dbOutboundPayload.fileUrl } : {}),
      ...(dbRetryResult.sessionExpired ? { code: 'TELEGRAM_SESSION_EXPIRED' } : {}),
      error: dbRetryResult.error,
      message: dbRetryResult.delivered ? 'Message retry delivered' : (dbRetryResult.error || 'Message retry failed'),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: Extract integer Telegram message ID from explicit field or known message ID formats
export function resolveTelegramMessageNumericId(messageId?: string, explicitTelegramMessageId?: number | string): number | null {
  if (explicitTelegramMessageId !== undefined && explicitTelegramMessageId !== null && explicitTelegramMessageId !== '') {
    const n = Number(explicitTelegramMessageId);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const raw = String(messageId || '').trim();
  const cloudMatch = raw.match(/^tg_cloud_(\d+)(?:_|$)/);
  if (cloudMatch) return Number(cloudMatch[1]);
  const msgTgMatch = raw.match(/^msg_tg_(?:\d+_)?(\d+)$/);
  if (msgTgMatch) return Number(msgTgMatch[1]);
  const tgNumericMatch = raw.match(/^tg_(\d+)_\d+$/);
  if (tgNumericMatch) return Number(tgNumericMatch[1]);
  return null;
}

// Helper: Resolve GramJS InputPeer and raw peer target from canonical chatId
async function resolveTelegramInputPeer(
  client: TelegramClient,
  rawChatId: string,
  selfUserId?: string
): Promise<{ inputPeer: Api.TypeInputPeer; rawPeer: any }> {
  const clean = String(rawChatId || '').replace(/^tg_/, '').trim();
  if (!clean || clean === 'me' || (selfUserId && clean === selfUserId)) {
    return { inputPeer: new Api.InputPeerSelf(), rawPeer: 'me' };
  }
  const rawPeer: any = /^-?\d+$/.test(clean) ? Number(clean) : clean;
  try {
    const inputPeer = await client.getInputEntity(rawPeer);
    return { inputPeer, rawPeer };
  } catch {
    // Refresh dialog entity cache once before failing
    await client.getDialogs({ limit: 60 });
    const inputPeer = await client.getInputEntity(rawPeer);
    return { inputPeer, rawPeer };
  }
}

// 3.2 Delete Message by ID (Real Telegram Cloud Revoke + DB Cleanup; never silently fake localOnly success for Telegram messages)
app.delete('/api/messages/:id', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authContext = (req as any).auth;
    const effectiveAccountId = authContext?.effectiveAccountId || (req.query.accountId as string) || 'acc_1';
    const isMaster = Boolean(authContext?.session?.isMaster);

    const msg = (await db.prepare('SELECT * FROM messages WHERE id = ?').get(id)) as any;
    if (msg && !isMaster && msg.account_id && msg.account_id !== effectiveAccountId) {
      return res.status(403).json({ success: false, deleted: false, error: '无权删除不属于当前账号的消息记录' });
    }

    const chatId = String((req.query.chatId as string) || msg?.chat_id || '').trim();
    const explicitTgId = req.query.telegramMessageId as string | undefined;
    const tgMsgId = resolveTelegramMessageNumericId(id, explicitTgId ?? msg?.telegram_message_id);
    const revoke = req.query.revoke === 'false' || req.query.revoke === '0' ? false : true;
    const isLocalOnlyRequested = req.query.localOnly === 'true' || req.query.localOnly === '1';

    const isTelegramChat = Boolean(chatId.startsWith('tg_') || effectiveAccountId.startsWith('acc_tg_') || effectiveAccountId === 'acc_telegram_bot');
    const isLocalFailedOrDraft = Boolean(
      !tgMsgId && (isLocalOnlyRequested || msg?.delivery_status === 'failed' || msg?.delivery_status === 'pending' || String(id).startsWith('msg_'))
    );
    let cloudSynced = false;

    if (isTelegramChat && !isLocalFailedOrDraft) {
      if (!tgMsgId) {
        return res.status(400).json({
          success: false,
          deleted: false,
          error: '该消息缺少 Telegram 云端消息 ID，无法从 Telegram 服务器撤回删除',
        });
      }

      if (effectiveAccountId === 'acc_telegram_bot' && process.env.TELEGRAM_BOT_TOKEN) {
        const cleanChatId = chatId.replace(/^tg_/, '');
        const botRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: /^-?\d+$/.test(cleanChatId) ? Number(cleanChatId) : cleanChatId, message_id: tgMsgId }),
        });
        const botJson: any = await botRes.json();
        if (!botJson.ok) {
          return res.status(502).json({
            success: false,
            deleted: false,
            error: botJson.description || 'Telegram Bot 撤回消息失败（Bot 仅能撤回 48 小时内消息或需管理员删帖权限）',
          });
        }
        cloudSynced = true;
      } else {
        const connected = resolveConnectedTelegramUser(effectiveAccountId);
        if (!connected || !connected.client) {
          return res.status(400).json({
            success: false,
            deleted: false,
            error: '当前账号未在线连接 Telegram MTProto，无法从云端撤回删除消息',
          });
        }
        const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
        await connected.client.deleteMessages(inputPeer, [tgMsgId], { revoke });
        cloudSynced = true;
      }
    }

    let changes = 0;
    if (msg) {
      const result = isMaster
        ? await db.prepare('DELETE FROM messages WHERE id = ?').run(id)
        : await db.prepare('DELETE FROM messages WHERE id = ? AND account_id = ?').run(id, effectiveAccountId);
      changes = (result as any)?.changes ?? 1;
    } else if (tgMsgId && chatId) {
      const altChatId = chatId.startsWith('tg_') ? chatId.replace(/^tg_/, '') : `tg_${chatId}`;
      const result = isMaster
        ? await db.prepare('DELETE FROM messages WHERE (chat_id = ? OR chat_id = ?) AND telegram_message_id = ?').run(chatId, altChatId, tgMsgId)
        : await db.prepare('DELETE FROM messages WHERE (chat_id = ? OR chat_id = ?) AND telegram_message_id = ? AND account_id = ?').run(chatId, altChatId, tgMsgId, effectiveAccountId);
      changes = (result as any)?.changes ?? 0;
    }

    res.json({ success: true, deleted: true, cloudSynced, revoke, id, changes });
  } catch (err: any) {
    res.status(500).json({ success: false, deleted: false, error: formatTelegramError(err) });
  }
});

// 4. Fetch Customer Profile & Long-Term Memory
app.get('/api/customer/profile/:chatId', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const authContext = (req as any).auth;
    const effectiveAccountId = authContext?.effectiveAccountId || 'acc_1';
    let profile = await getScopedCustomerProfile(chatId, effectiveAccountId);

    if (!profile) {
      // Create a clean baseline profile without any fabricated attributes
      const now = Date.now();
      const defaultName = (req.query.title as string) || (req.query.clientName as string) || '新联系人';
      await upsertScopedCustomerProfile({
        chatId,
        accountId: effectiveAccountId,
        clientName: defaultName,
        relationshipStage: '尚未沟通',
        ageEstimate: '待分析',
        occupation: '待分析',
        locationTimezone: '待确认',
        toneStyle: '待沟通分析',
        likesInterests: JSON.stringify([]),
        dislikesTaboos: JSON.stringify([]),
        emotionalNeeds: '暂无记录（待真实沟通后提炼）',
        keyMemories: JSON.stringify([]),
        totalMessagesCount: 0,
        lastAnalyzedAt: now,
        updatedAt: now,
      });

      profile = await getScopedCustomerProfile(chatId, effectiveAccountId);
    }

    res.json({
      chatId: profile.chat_id,
      accountId: profile.account_id,
      clientName: profile.client_name,
      relationshipStage: profile.relationship_stage,
      ageEstimate: profile.age_estimate,
      occupation: profile.occupation,
      locationTimezone: profile.location_timezone,
      toneStyle: profile.tone_style,
      likesInterests: safeJsonParse(profile.likes_interests, []),
      dislikesTaboos: safeJsonParse(profile.dislikes_taboos, []),
      emotionalNeeds: profile.emotional_needs,
      keyMemories: safeJsonParse(profile.key_memories, []),
      totalMessagesCount: profile.total_messages_count,
      lastAnalyzedAt: profile.last_analyzed_at,
      updatedAt: profile.updated_at,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Update Customer Profile & Memory Manually (UPSERT so new records are saved)
app.post('/api/customer/profile/:chatId', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const {
      clientName, relationshipStage, ageEstimate, occupation, locationTimezone,
      toneStyle, likesInterests, dislikesTaboos, emotionalNeeds, keyMemories
    } = req.body;
    const authContext = (req as any).auth;
    const effectiveAccountId = authContext?.effectiveAccountId || 'acc_1';

    const now = Date.now();
    await upsertScopedCustomerProfile({
      chatId,
      accountId: effectiveAccountId,
      clientName: clientName || 'VIP客户',
      relationshipStage: relationshipStage || '初次结识',
      ageEstimate: ageEstimate || '',
      occupation: occupation || '',
      locationTimezone: locationTimezone || '',
      toneStyle: toneStyle || '',
      likesInterests: JSON.stringify(likesInterests || []),
      dislikesTaboos: JSON.stringify(dislikesTaboos || []),
      emotionalNeeds: emotionalNeeds || '',
      keyMemories: JSON.stringify(keyMemories || []),
      totalMessagesCount: 0,
      lastAnalyzedAt: 0,
      updatedAt: now,
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. AI Deep Analysis: Extract Customer Persona & Key Memories from Unified Cloud + Local + DB History
app.post('/api/customer/analyze/:chatId', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const { customConfig, messages: clientMessages, chatTitle } = req.body;
    const authContext = (req as any).auth;
    const effectiveAccountId = authContext?.effectiveAccountId || req.body?.accountId || 'acc_1';

    // Unify messages from DB cache, Telegram Official Cloud, and client real-time local state
    const resolved = await resolveUnifiedChatMessages({
      chatId,
      accountId: effectiveAccountId,
      clientMessages,
      limit: 50,
      syncCloud: true,
      persistClientMessages: true,
    });
    const messageList = resolved.messages.map((m) => ({
      sender: m.sender,
      sender_name: m.senderName || (m.sender === 'peer' ? (chatTitle || '客户') : '我方'),
      text: m.text || '',
      stt_text: m.sttText || '',
    }));

    const now = Date.now();

    // If completely no messages exist (new contact), initialize a clean baseline profile without fake memories
    if (messageList.length === 0) {
      const cleanEmptyProfile = {
        clientName: chatTitle || '联系人',
        relationshipStage: '尚未沟通',
        ageEstimate: '待分析',
        occupation: '待分析',
        locationTimezone: '待确认',
        toneStyle: '暂无对话数据',
        likesInterests: [],
        dislikesTaboos: [],
        emotionalNeeds: '暂无足够对话记录',
        keyMemories: [],
      };

      await upsertScopedCustomerProfile({
        chatId,
        accountId: effectiveAccountId,
        clientName: cleanEmptyProfile.clientName,
        relationshipStage: cleanEmptyProfile.relationshipStage,
        ageEstimate: cleanEmptyProfile.ageEstimate,
        occupation: cleanEmptyProfile.occupation,
        locationTimezone: cleanEmptyProfile.locationTimezone,
        toneStyle: cleanEmptyProfile.toneStyle,
        likesInterests: '[]',
        dislikesTaboos: '[]',
        emotionalNeeds: cleanEmptyProfile.emotionalNeeds,
        keyMemories: '[]',
        lastAnalyzedAt: now,
        updatedAt: now,
      });

      return res.json({
        success: true,
        profile: {
          chatId,
          accountId: effectiveAccountId,
          ...cleanEmptyProfile,
          lastAnalyzedAt: now,
        },
        message: '当前会话暂无对话记录。真实沟通后系统将自动提炼全息画像与长效记忆。',
      });
    }

    // If conversation is too sparse (fewer than 2 messages or under 12 characters), return clean objective baseline without AI hallucination
    const totalCharCount = messageList.reduce((acc, m) => acc + (m.text || '').length, 0);
    if (messageList.length < 2 || totalCharCount < 12) {
      const sparseProfile = {
        clientName: chatTitle || '联系人',
        relationshipStage: '初次接触',
        ageEstimate: '未知',
        occupation: '未知',
        locationTimezone: '未提及',
        toneStyle: '初次沟通，待积累更多对话数据',
        likesInterests: [],
        dislikesTaboos: [],
        emotionalNeeds: '暂无足够对话记录',
        keyMemories: [],
      };
      await upsertScopedCustomerProfile({
        chatId,
        accountId: effectiveAccountId,
        clientName: sparseProfile.clientName,
        relationshipStage: sparseProfile.relationshipStage,
        ageEstimate: sparseProfile.ageEstimate,
        occupation: sparseProfile.occupation,
        locationTimezone: sparseProfile.locationTimezone,
        toneStyle: sparseProfile.toneStyle,
        likesInterests: '[]',
        dislikesTaboos: '[]',
        emotionalNeeds: sparseProfile.emotionalNeeds,
        keyMemories: '[]',
        lastAnalyzedAt: now,
        updatedAt: now,
      });

      return res.json({
        success: true,
        profile: {
          chatId,
          accountId: effectiveAccountId,
          ...sparseProfile,
          lastAnalyzedAt: now,
        },
        message: '当前会话对话记录过少（少于2条），已初始化客观基础档案，待深入沟通后提炼。',
      });
    }

    const conversationTranscript = messageList.map((m) => {
      const sender = m.sender === 'peer' ? (m.sender_name || '客户') : '我方';
      const content = m.text === 'Voice Message' && m.stt_text ? `[语音]: ${m.stt_text}` : m.text;
      return `${sender}: ${content}`;
    }).join('\n');

    const analysisPrompt = `作为客观严谨的客户画像与长期记忆提炼助手，请深度客观分析以下真实客户与我方的聊天历史（最近50条消息）。
【严格规则 - 禁止任何假设与虚假编造】：
1. 只能提取对话中真实明确提及或明确体现的事实。未在对话中出现的年龄、职业或时区必须返回"未知"或"未提及"，严禁擅自猜测或套用模板！
2. 喜好偏好(likesInterests)与敏感雷区(dislikesTaboos)若对话中未明确表达，必须返回空数组 []，严禁添加未讨论的假标签。
3. 关键记忆(keyMemories)必须基于真实对话中的事件或约定，若无明确约定则返回空数组 []。

请返回严格的 JSON 格式（不要包含任何 markdown 代码块或额外文字）：
{
  "clientName": "从聊天推断的真实称谓或称呼",
  "relationshipStage": "例如：初次沟通 / 需求咨询 / 合作推进 / 长期稳定合作",
  "ageEstimate": "对话中明确提及的年龄，未提及则填'未知'",
  "occupation": "对话中明确提及的职业或行业，未提及则填'未知'",
  "locationTimezone": "对话中明确提及的所在地或时区，未提及则填'未提及'",
  "toneStyle": "客观分析得出的说话用词与沟通风格（如：严谨专业 / 简洁直接 / 热情礼貌 / 随和日常）",
  "likesInterests": ["真实聊到的具体兴趣或业务关注点，无则空数组"],
  "dislikesTaboos": ["真实表达的反感情绪或避讳雷区，无则空数组"],
  "emotionalNeeds": "真实的沟通与业务诉求，无则填'待进一步沟通交流'",
  "keyMemories": [
    { "id": "mem_1", "date": "日期或近期", "topic": "关键话题", "summary": "真实事实或约定简述", "emotion": "正常交流" }
  ]
}

真实聊天历史记录：
${conversationTranscript}`;

    let extractedData: any = null;
    let analysisErrorMsg = '';
    const bearerJwt = extractBearerToken(req);
    if (bearerJwt) {
      lastActiveUserJwt = bearerJwt;
    }
    const serverCustomCfg = await getServerCustomLlmConfig().catch(() => null);
    const effectiveAnalyzeConfig =
      customConfig && typeof customConfig === 'object'
        ? {
            ...(serverCustomCfg || {}),
            ...customConfig,
            baseUrl: (customConfig.baseUrl || serverCustomCfg?.baseUrl || '').trim(),
            apiKey: (customConfig.apiKey || serverCustomCfg?.apiKey || '').trim(),
            modelName: (customConfig.modelName || serverCustomCfg?.modelName || 'gpt-4o-mini').trim(),
          }
        : serverCustomCfg;

    const useCustomPriorityMemory = Boolean(
      effectiveAnalyzeConfig?.enabled && effectiveAnalyzeConfig?.engineMode === 'custom'
    );

    const effectiveLicenseKey =
      (typeof customConfig?.engineLicenseKey === 'string' && customConfig.engineLicenseKey.trim()) ||
      (typeof serverCustomCfg?.engineLicenseKey === 'string' && serverCustomCfg.engineLicenseKey.trim()) ||
      (process.env.RAILWAY_BRAIN_KEY || '').trim() ||
      undefined;
    const effectiveUserJwt = bearerJwt || lastActiveUserJwt || undefined;

    if (useCustomPriorityMemory) {
      const cleanCustomUrl = (effectiveAnalyzeConfig?.baseUrl || '').trim().replace(/\/+$/, '');
      const cleanCustomKey = sanitizeHttpHeaderValue(effectiveAnalyzeConfig?.apiKey);
      if (!cleanCustomUrl || isBuiltInCloudGatewayUrl(cleanCustomUrl)) {
        return res.status(400).json({
          success: false,
          error: '已开启「优先自有密钥回复」，请先在「模型 → 接入自有模型网关」填写有效的大模型接入网址 (Base URL)。',
        });
      }
      let isLocalCustomUrl = false;
      try {
        const parsed = new URL(cleanCustomUrl);
        isLocalCustomUrl = isAllowedLocalhostEndpoint(parsed.hostname);
      } catch {
        return res.status(400).json({
          success: false,
          error: '自有模型网关 Base URL 无效，请填写合法的 http:// 或 https:// 地址。',
        });
      }
      if (!cleanCustomKey && !isLocalCustomUrl) {
        return res.status(400).json({
          success: false,
          error: '已开启「优先自有密钥回复」，记忆提炼缺少 API 密钥，请在「模型 → 接入自有模型网关」填写 API 密钥。',
        });
      }

      const customModel = (effectiveAnalyzeConfig?.modelName || '').trim() || 'gpt-4o-mini';
      const inferredProto = inferGatewayProtocol(cleanCustomUrl, customModel, effectiveAnalyzeConfig?.protocol);
      try {
        const txt = await callCustomLlm({
          customConfig: {
            ...effectiveAnalyzeConfig,
            enabled: true,
            engineMode: 'custom',
            protocol: inferredProto,
            baseUrl: cleanCustomUrl,
            apiKey: cleanCustomKey,
            modelName: customModel,
            temperature: 0.1,
          },
          messages: [{ role: 'user', content: analysisPrompt }],
          temperature: 0.1,
          maxTokens: 1000,
          timeoutMs: 20000,
          throwOnError: true,
          skipSync: true,
        });
        if (txt) {
          const jsonMatch = txt.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            extractedData = JSON.parse(jsonMatch[0]);
          } else {
            analysisErrorMsg = '自有模型网关返回内容未能解析为有效的客户画像 JSON';
          }
        } else {
          analysisErrorMsg = '自有模型网关未返回有效画像数据';
        }
      } catch (err: any) {
        analysisErrorMsg = err?.message || '自有模型网关记忆提炼请求失败';
        console.warn('[CustomerMemoryAnalysis Custom Gateway Error]:', analysisErrorMsg);
      }

      if (!extractedData) {
        return res.status(503).json({
          success: false,
          error: `客户全息记忆提炼失败（优先自有密钥模式）：${analysisErrorMsg || '未返回有效画像数据'}`,
        });
      }
    } else {
      // 未开启优先自有密钥模式时，客户全息记忆提炼严格走 HumanSense 云端引擎通道
      if (!effectiveUserJwt && !effectiveLicenseKey) {
        return res.status(401).json({
          success: false,
          error: '客户全息记忆提炼（HumanSense 云端引擎）未获取到会员授权令牌，请先登录会员账号。',
        });
      }

      try {
        const txt = await callCustomLlm({
          customConfig: {
            enabled: true,
            engineMode: 'cloud',
            protocol: 'openai',
            baseUrl: '',
            apiKey: '',
            modelName: 'gemini-4-hydrogen',
            temperature: 0.1,
            engineLicenseKey: effectiveLicenseKey,
          },
          messages: [{ role: 'user', content: analysisPrompt }],
          temperature: 0.1,
          maxTokens: 1000,
          timeoutMs: 20000,
          userJwt: effectiveUserJwt,
          throwOnError: true,
          skipSync: true,
          extraPayload: { purpose: 'memory_extraction' },
        });
        if (txt) {
          const jsonMatch = txt.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            extractedData = JSON.parse(jsonMatch[0]);
          } else {
            analysisErrorMsg = 'HumanSense 云端引擎返回内容未能解析为有效的客户画像 JSON';
          }
        } else {
          analysisErrorMsg = 'HumanSense 云端引擎未返回有效画像数据';
        }
      } catch (err: any) {
        analysisErrorMsg = err?.message || 'HumanSense 云端引擎分析请求失败';
        console.warn('[CustomerMemoryAnalysis Cloud Engine Error]:', analysisErrorMsg);
      }

      if (!extractedData) {
        return res.status(503).json({
          success: false,
          error: `客户全息记忆提炼服务不可用（HumanSense 云端引擎）：${analysisErrorMsg || '未返回有效画像数据'}`,
        });
      }
    }

    // Save into database via account-isolated UPSERT
    await upsertScopedCustomerProfile({
      chatId,
      accountId: effectiveAccountId,
      clientName: extractedData.clientName || chatTitle || '客户',
      relationshipStage: extractedData.relationshipStage || '初次接触',
      ageEstimate: extractedData.ageEstimate || '',
      occupation: extractedData.occupation || '',
      locationTimezone: extractedData.locationTimezone || '',
      toneStyle: extractedData.toneStyle || '',
      likesInterests: JSON.stringify(extractedData.likesInterests || []),
      dislikesTaboos: JSON.stringify(extractedData.dislikesTaboos || []),
      emotionalNeeds: extractedData.emotionalNeeds || '',
      keyMemories: JSON.stringify(extractedData.keyMemories || []),
      lastAnalyzedAt: now,
      updatedAt: now,
    });

    res.json({
      success: true,
      profile: {
        chatId,
        ...extractedData,
        lastAnalyzedAt: now,
      },
    });
  } catch (error: any) {
    console.error('Customer analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Synchronize custom LLM configuration between client workspace and server background workers
app.post('/api/llm/config', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const config = req.body;
    if (config && typeof config === 'object') {
      await syncServerCustomLlmConfig(config);
      return res.json({ success: true, message: '自定义大模型配置已成功持久化至系统配置' });
    }
    return res.status(400).json({ error: '无效的配置参数' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/llm/config', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const config = await getServerCustomLlmConfig();
    const publicConfig = config && typeof config === 'object' ? { ...config, engineLicenseKey: '' } : config;
    return res.json({ success: true, config: publicConfig });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Synchronize user's translation settings (strict single engine & local keys) for background workers
app.post('/api/translate/settings', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    if (settings && typeof settings === 'object') {
      await syncServerTranslationSettings(settings);
      return res.json({ success: true });
    }
    return res.status(400).json({ error: '无效的翻译设置参数' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/translate/settings', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const settings = await getServerTranslationSettings();
    return res.json({ success: true, settings });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ==================== AI KNOWLEDGE BASE & TRAINING API ====================

// Fetch all knowledge items, training logs, and intelligence metrics (Protected with requireTenantAuth)
app.get('/api/knowledge', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const rawItems = (await db.prepare(`
      SELECT id, category, title, content, keywords, source_type as sourceType,
             source_file as sourceFile, is_active as isActive, hit_count as hitCount,
             created_at as createdAt, updated_at as updatedAt
      FROM knowledge_base
      ORDER BY updated_at DESC
    `).all()) as any[];

    const items = rawItems.map((r) => ({
      ...r,
      isActive: Boolean(r.isActive),
      keywords: JSON.parse(r.keywords || '[]'),
    }));

    const logs = (await db.prepare(`
      SELECT id, log_type as logType, details, items_learned as itemsLearned, created_at as createdAt
      FROM training_logs
      ORDER BY created_at DESC
      LIMIT 25
    `).all()) as any[];

    const totalItems = items.length;
    const activeItemsCount = items.filter((i) => i.isActive).length;
    const autoLearnedCount = items.filter((i) => i.sourceType === 'auto_chat_distill').length;
    const customDocCount = items.filter((i) => i.sourceType === 'file_upload').length;
    const totalHits = items.reduce((acc, i) => acc + (i.hitCount || 0), 0);

    res.json({
      items,
      logs,
      stats: {
        totalItems,
        activeItemsCount,
        autoLearnedCount,
        customDocCount,
        totalHits,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Add manual knowledge item (Protected with requireTenantAuth)
app.post('/api/knowledge', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { category = 'dating_playbook', title, content, keywords = [] } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: '标题与知识内容为必填项' });
    }

    const id = `know_${Date.now()}`;
    const now = Date.now();

    await db.prepare(`
      INSERT INTO knowledge_base (
        id, category, title, content, keywords, source_type, source_file, is_active, hit_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      category,
      title,
      content,
      JSON.stringify(Array.isArray(keywords) ? keywords : [keywords]),
      'manual_text',
      'manual_input',
      1,
      0,
      now,
      now
    );

    await db.prepare(`
      INSERT INTO training_logs (id, log_type, details, items_learned, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `log_${now}`,
      'manual_add',
      `人工添加并训练新知识条目: 【${title}】`,
      1,
      now
    );

    res.json({ success: true, id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upload and train custom file knowledge with real AI categorization (no regex fallback)
app.post('/api/knowledge/upload', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { fileName, fileContent, category = 'auto', customConfig } = req.body;
    if (!fileContent || typeof fileContent !== 'string' || !fileContent.trim()) {
      return res.status(400).json({ success: false, error: '文件内容不能为空' });
    }
    if (fileContent.length > 40000) {
      return res.status(400).json({
        success: false,
        error: '文档内容超过 40000 字符上限，请拆分后再上传以确保大模型准确切片与分类',
      });
    }

    const now = Date.now();
    const baseName = (fileName || '文档知识').replace(/\.[^/.]+$/, '');
    const bearerJwt = extractBearerToken(req);
    const isExplicitCategory = Boolean(
      category && category !== 'auto' && category !== 'custom_doc' &&
      ['icebreaker', 'life_emotion', 'wealth_investment', 'trust_defense'].includes(category)
    );

    const prompt = `你是一个专业的人设知识库与客服话术解析分类引擎。
请将以下整篇文档内容进行智能切片，提炼成若干条独立的知识点/话术对${
      isExplicitCategory
        ? `（用户指定归属分类为 "${category}"）`
        : `，并为每一条指定最契合的阶段分类：
- 严格必须从以下4个标准分类中选择其一：
  1. "icebreaker": 初识破冰、打招呼、兴趣试探、开场聊客。
  2. "life_emotion": 生活美学、美食咖啡、情绪价值、日常关怀、暧昧拉扯。
  3. "wealth_investment": 资产投资、量化波段、理财逻辑、宏观分析、生息配置。
  4. "trust_defense": 安全感化解、身份疑虑、真实性背书、消除顾虑与戒备。`
    }

文档内容：
${fileContent}

请严格返回以下格式的合法 JSON 数组，严禁返回任何多余的解释或包裹字符：
[
  {
    "title": "简练标题（20字以内）",
    "category": "${isExplicitCategory ? category : 'icebreaker 或 life_emotion 或 wealth_investment 或 trust_defense'}",
    "content": "切片正文内容",
    "keywords": ["关键词1", "关键词2", "关键词3"]
  }
]`;

    let parsedItems: Array<{ title: string; category: string; content: string; keywords: string[] }> = [];
    let modelUsed = '';
    try {
      const llmRes = await invokeEvolutionOrAnalysisLlm({
        prompt,
        customConfig,
        userJwt: bearerJwt,
        timeoutMs: 25000,
      });
      modelUsed = llmRes.source;
      const rawJson = llmRes.text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
      const jsonMatch = rawJson.match(/\[[\s\S]*\]/);
      const result = JSON.parse(jsonMatch ? jsonMatch[0] : rawJson);
      if (!Array.isArray(result) || result.length === 0) {
        return res.status(502).json({
          success: false,
          error: `大模型 (${modelUsed}) 未返回有效的知识切片数组，已中止入库（严禁正则降级分类）`,
        });
      }
      parsedItems = result.filter((item) => item?.content && String(item.content).trim().length > 5);
      if (parsedItems.length === 0) {
        return res.status(502).json({
          success: false,
          error: `大模型 (${modelUsed}) 解析出的有效知识条目为空，已中止入库`,
        });
      }
    } catch (llmErr: any) {
      const msg = llmErr?.message || String(llmErr);
      const isUnconfigured = /未配置|未启用/.test(msg);
      return res.status(isUnconfigured ? 400 : 503).json({
        success: false,
        error: `大模型知识切片与分类失败（已禁用正则降级）：${msg}`,
      });
    }

    const insert = db.prepare(`
      INSERT INTO knowledge_base (
        id, category, title, content, keywords, source_type, source_file, is_active, hit_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    const validCategories = ['icebreaker', 'life_emotion', 'wealth_investment', 'trust_defense'];
    for (let i = 0; i < parsedItems.length; i++) {
      const item = parsedItems[i];
      const finalCat = isExplicitCategory
        ? category
        : validCategories.includes(item.category)
        ? item.category
        : 'life_emotion';

      await insert.run(
        `know_doc_${now}_${i}`,
        finalCat,
        String(item.title || `${baseName} (第${i + 1}条)`).trim(),
        String(item.content).trim(),
        JSON.stringify(Array.isArray(item.keywords) ? item.keywords : []),
        'file_upload',
        fileName || 'uploaded_doc.txt',
        1,
        0,
        now,
        now
      );
      count++;
    }

    await db.prepare(`
      INSERT INTO training_logs (id, log_type, details, items_learned, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `log_upload_${now}`,
      'file_import',
      `导入文档《${fileName || '知识文档'}》，经大模型 (${modelUsed}) 智能分类入库 ${count} 个知识切片`,
      count,
      now
    );

    res.json({ success: true, itemsLearned: count, autoClassified: true, modelUsed });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle knowledge item active (Protected with requireTenantAuth)
app.patch('/api/knowledge/:id/toggle', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.prepare(`
      UPDATE knowledge_base
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update existing knowledge item (Protected with requireTenantAuth)
app.put('/api/knowledge/:id', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, category, content, keywords, isActive } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: '标题与知识内容为必填项' });
    }

    const kwJson = JSON.stringify(Array.isArray(keywords) ? keywords : [keywords].filter(Boolean));
    const now = Date.now();

    await db.prepare(`
      UPDATE knowledge_base
      SET title = ?, category = ?, content = ?, keywords = ?, is_active = COALESCE(?, is_active), updated_at = ?
      WHERE id = ?
    `).run(
      String(title).trim(),
      category || 'life_emotion',
      String(content).trim(),
      kwJson,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      now,
      id
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Clear all or category knowledge items (Protected with requireTenantAuth)
app.delete('/api/knowledge/clear-all', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    if (category && typeof category === 'string' && category !== 'all') {
      await db.prepare('DELETE FROM knowledge_base WHERE category = ?').run(category);
    } else {
      await db.prepare('DELETE FROM knowledge_base').run();
    }
    // Record seed flag so deleted records are never resurrected on server restart
    await db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('knowledge_initial_seeded', '1', ?)
      ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at
    `).run(Date.now());
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete knowledge item (Protected with requireTenantAuth)
app.delete('/api/knowledge/:id', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(id);
    // Record seed flag so deleting default records does not cause them to be recreated on reboot
    await db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES ('knowledge_initial_seeded', '1', ?)
      ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at
    `).run(Date.now());
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Auto-train & distill endpoint (Zero-DB compliant: accepts text payload, never injects hardcoded fake data)
app.post('/api/knowledge/train-auto', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { sampleTexts = [] } = req.body;
    const now = Date.now();

    if (!Array.isArray(sampleTexts) || sampleTexts.length === 0) {
      return res.json({
        success: true,
        newItemsCount: 0,
        message: '【纯本地零数据库模式】：系统未在数据库保存任何聊天记录。如需扩充知识库，请通过手动新增或导入话术范本。',
      });
    }

    let addedCount = 0;
    const insert = db.prepare(`
      INSERT INTO knowledge_base (
        id, category, title, content, keywords, source_type, source_file, is_active, hit_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < sampleTexts.length; i++) {
      const text = String(sampleTexts[i] || '').trim();
      if (text.length < 5) continue;
      const itemId = `know_user_${now}_${i + 1}`;
      const title = text.slice(0, 30);
      const keywords = JSON.stringify(text.split(/[\s,，。！？]+/).filter(w => w.length >= 2).slice(0, 6));
      await insert.run(
        itemId,
        'custom_playbook',
        title,
        text,
        keywords,
        'manual_distill',
        'user_local_input',
        1,
        0,
        now,
        now
      );
      addedCount++;
    }

    res.json({
      success: true,
      newItemsCount: addedCount,
      message: `已成功将 ${addedCount} 条自定义知识库规则同步至本地工作站`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== GLOBAL PERSONA & EVOLUTION ENGINE APIS ====================

// 1. Fetch Global Persona Configuration
app.get('/api/persona/config', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const persona = await getGlobalPersonaFromDb();
    res.json({ success: true, persona });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Save Global Persona Configuration
app.post('/api/persona/config', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const persona = req.body;
    if (!persona || typeof persona !== 'object') {
      return res.status(400).json({ error: '无效的人设配置数据' });
    }
    const ok = await saveGlobalPersonaToDb(persona);
    if (!ok) {
      return res.status(500).json({ error: '保存人设配置到数据库失败' });
    }
    res.json({ success: true, persona });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2.1 Reset Global Persona Configuration to Clean Blank Initial State
app.post('/api/persona/reset', requireTenantAuth, async (_req: Request, res: Response) => {
  try {
    const persona = await resetGlobalPersonaInDb();
    res.json({ success: true, persona });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2.2 Explicit User Action: Import Reference Persona Template
app.post('/api/persona/import-template', requireTenantAuth, async (_req: Request, res: Response) => {
  try {
    const templatePersona = {
      ...PERSONA_TEMPLATE_PRESET,
      personalityTraits: [...PERSONA_TEMPLATE_PRESET.personalityTraits],
      tabooKeywords: [...PERSONA_TEMPLATE_PRESET.tabooKeywords],
      stagedPrompts: { ...PERSONA_TEMPLATE_PRESET.stagedPrompts },
    };
    const ok = await saveGlobalPersonaToDb(templatePersona);
    if (!ok) {
      return res.status(500).json({ error: '导入参考人设模板到数据库失败' });
    }
    res.json({ success: true, persona: templatePersona });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function buildActivePersonaAndEvolutionContext(
  persona: any,
  evolutionState: any,
  stageOverride?: string,
  maxHabits = 3
): {
  context: string;
  activeStage: string;
  activeHabitIds: string[];
  activeHabitItems: any[];
  hasConfiguredPersona: boolean;
} {
  const activeStage = stageOverride || persona?.activeStage || 'icebreaker';
  const personaName = String(persona?.personaName || '').trim();
  const personaRole = String(persona?.personaRole || '').trim();
  const age = String(persona?.age || '').trim();
  const location = String(persona?.location || '').trim();
  const traits = Array.isArray(persona?.personalityTraits)
    ? persona.personalityTraits.map((t: any) => String(t || '').trim()).filter(Boolean)
    : [];
  const lifeStyleDetails = String(persona?.lifeStyleDetails || '').trim();
  const investmentPhilosophy = String(persona?.investmentPhilosophy || '').trim();
  const customSystemInstruction = String(persona?.customSystemInstruction || '').trim();
  const stagePrompt = String(persona?.stagedPrompts?.[activeStage] || persona?.stagedPrompts?.icebreaker || '').trim();
  const tabooKeywords = Array.isArray(persona?.tabooKeywords)
    ? persona.tabooKeywords.map((k: any) => String(k || '').trim()).filter(Boolean)
    : [];

  const profileLines: string[] = [];
  if (personaName || personaRole || age || location) {
    const identityParts = [
      personaName || undefined,
      personaRole ? `身份职业：${personaRole}` : undefined,
      age ? `年龄：${age}` : undefined,
      location ? `常居地：${location}` : undefined,
    ].filter(Boolean);
    if (identityParts.length > 0) {
      profileLines.push(`- 姓名与身份设定：${identityParts.join('，')}`);
    }
  }
  if (traits.length > 0) {
    profileLines.push(`- 性格特征：${traits.join('、')}`);
  }
  if (lifeStyleDetails) {
    profileLines.push(`- 生活方式与日常：${lifeStyleDetails}`);
  }
  if (investmentPhilosophy) {
    profileLines.push(`- 核心理念与专业视角：${investmentPhilosophy}`);
  }

  const activeHabitItems = (Array.isArray(evolutionState?.habits) ? evolutionState.habits : [])
    .filter((h: any) => h && h.isActive)
    .slice(0, maxHabits);
  const activeHabitIds = activeHabitItems.map((h: any) => String(h.id || '')).filter(Boolean);
  const habitList = activeHabitItems
    .map((h: any) => `* [${h.title}]${h.description ? `(${h.description})` : ''}${h.examplePattern ? `: 示范 “${h.examplePattern}”` : ''}`)
    .join('\n');

  const sections: string[] = [];
  if (profileLines.length > 0) {
    sections.push(`【全局活跃角色人设档案】：\n${profileLines.join('\n')}`);
  }
  if (customSystemInstruction) {
    sections.push(`【自定义全局系统指令】：\n${customSystemInstruction}`);
  }
  if (stagePrompt) {
    sections.push(`【当前沟通阶段（${activeStage}）指导原则】：\n${stagePrompt}`);
  }
  if (habitList) {
    sections.push(`【自进化引擎萃取的活跃沟通习惯】：\n${habitList}`);
  }
  if (tabooKeywords.length > 0) {
    sections.push(`【绝对违禁词与红线（严禁出现）】：${tabooKeywords.join('、')}`);
  }

  const hasConfiguredPersona = Boolean(
    profileLines.length > 0 || customSystemInstruction || stagePrompt || tabooKeywords.length > 0
  );

  return {
    context: sections.join('\n\n'),
    activeStage,
    activeHabitIds,
    activeHabitItems,
    hasConfiguredPersona,
  };
}

// 3. Sandbox Real-time Simulation Test Reply
app.post('/api/persona/test-reply', aiGenerationLimiter, requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { message, stage = 'icebreaker', chatTranscript, recentChatHistory, customConfig } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: '测试客户发言不能为空' });
    }

    const persona = await getGlobalPersonaFromDb();
    const evolution = await getEvolutionStateFromDb();
    const rag = await queryKnowledgeRAG(message, 3);

    const personaCtx = buildActivePersonaAndEvolutionContext(persona, evolution, stage, 5);
    const activeStage = personaCtx.activeStage;
    const activeHabitItems = personaCtx.activeHabitItems;
    const activeHabitIds = personaCtx.activeHabitIds;

    const customerRecordText = typeof chatTranscript === 'string' && chatTranscript.trim()
      ? chatTranscript.trim()
      : typeof recentChatHistory === 'string' && recentChatHistory.trim()
      ? recentChatHistory.trim()
      : Array.isArray(recentChatHistory) && recentChatHistory.length > 0
      ? recentChatHistory.map((m: any) => `${m.sender || '客户'}: ${m.text || m.content || ''}`).join('\n')
      : '';

    const oralHabitMirrorDirective = customerRecordText ? `
【客户整篇真实聊天记录（口语习惯与语气画像核心对照样本）】：
"""
${customerRecordText.slice(0, 2500)}
"""

【对照客户整篇记录的口语习惯进行同频沟通】：
1. 使用自然生活化的手机私聊短句，避免生硬的 AI 模板腔、分点列项（1. 2. 3.）与客套套话。
2. 观察上述上下文中对方的打字节奏、句式长短与语气特点，保持自然一致的回应温度。
` : `
【自然沟通与反 AI 机械感守则】：
1. 使用自然真人口语化表达，避免 AI 助手说明书腔调、客套问候（“您好”、“有什么能帮您”）或分点列项（1. 2. 3.）。
2. 回复简短自然（1~2 句），留出对话呼吸感。
`;

    const systemInstruction = `
${personaCtx.hasConfiguredPersona ? personaCtx.context : '你是一位真诚自然、高效有温度的沟通助手，请严格依据用户的真实上下文进行自然回复。'}
${!personaCtx.hasConfiguredPersona && personaCtx.context ? `\n${personaCtx.context}` : ''}

${oralHabitMirrorDirective}

${rag.matchedCount > 0 && rag.context ? `【专属知识库命中参考（自然融入，切勿生硬背书）】：\n${rag.context}` : ''}
`.trim();

    let reply = '';
    let replySource = '';
    const bearerJwt = extractBearerToken(req);

    // 1. Strictly enforce Custom LLM / Cloud Brain when enabled — NEVER fall back to Gemini or fake templates
    if (customConfig?.enabled) {
      try {
        const customRes = await callCustomLlm({
          customConfig,
          systemInstruction,
          messages: [{ role: 'user', content: message }],
          temperature: 0.7,
          maxTokens: 240,
          userJwt: bearerJwt,
          throwOnError: true,
          skipSync: true,
        });
        if (!customRes || !customRes.trim()) {
          return res.status(502).json({
            success: false,
            error: '自定义大模型 / 云端引擎未返回有效回复内容（严禁降级代答）',
          });
        }
        reply = customRes.trim();
        replySource =
          customConfig?.engineMode === 'cloud' || (customConfig?.engineMode !== 'custom' && !customConfig?.baseUrl?.trim())
            ? 'lingxi_cloud_brain'
            : `custom_llm:${customConfig.modelName || 'custom'}`;
      } catch (err: any) {
        return res.status(503).json({
          success: false,
          error: `自定义大模型 / 云端引擎调用失败（严禁降级切回 Gemini 或使用模板假回复）: ${err?.message || String(err)}`,
        });
      }
    } else {
      // 2. Single official Gemini model (no blind multi-model waterfall, no hardcoded template fake replies)
      const selectedModel = resolveGeminiModel(req.body.model || customConfig?.geminiModel, 'chat');
      if (!isGeminiAvailable()) {
        const circuit = getGeminiCircuitStatus();
        return res.status(circuit.isBlocked ? 503 : 400).json({
          success: false,
          error: circuit.isBlocked
            ? `Gemini 大模型当前不可用: ${circuit.reason}`
            : '未配置可用的大模型（请配置 GEMINI_API_KEY 或启用自定义大模型）',
        });
      }

      try {
        const ai = createGeminiClient();
        const resp = await ai.models.generateContent({
          model: selectedModel,
          contents: message,
          config: {
            systemInstruction,
            temperature: 0.75,
          },
        });
        const txt = resp.text?.trim();
        if (!txt) {
          return res.status(502).json({
            success: false,
            error: `Gemini(${selectedModel}) 未返回有效回复内容`,
          });
        }
        reply = txt;
        replySource = selectedModel;
      } catch (modelErr: any) {
        handleGeminiApiError(`test-reply model ${selectedModel}`, modelErr);
        return res.status(503).json({
          success: false,
          error: `Gemini(${selectedModel}) 调用失败: ${modelErr?.message || String(modelErr)}`,
        });
      }
    }

    if (reply) {
      void incrementEvolutionHabitUsage(activeHabitIds);
    }

    res.json({
      success: true,
      reply,
      stage: activeStage,
      personaName: persona.personaName,
      matchedKnowledge: rag.matchedItems,
      appliedHabits: activeHabitItems,
      source: replySource,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Fetch Evolution Engine Status & Logs
app.get('/api/evolution/status', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const state = await getEvolutionStateFromDb();
    const logs = (await db.prepare(`
      SELECT id, log_type as logType, details, items_learned as itemsLearned, created_at as createdAt
      FROM training_logs
      WHERE log_type IN ('evolution_learn', 'habit_toggle', 'manual_add', 'system_init')
      ORDER BY created_at DESC
      LIMIT 15
    `).all()) as any[];

    res.json({ success: true, state, logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: Strictly invoke configured Backend/Custom LLM or single official Gemini model for learning/analysis
export async function invokeEvolutionOrAnalysisLlm({
  prompt,
  customConfig,
  userJwt,
  timeoutMs = 20000,
}: {
  prompt: string;
  customConfig?: any;
  userJwt?: string;
  timeoutMs?: number;
}): Promise<{ text: string; source: string; usedBackendCustomLlm: boolean }> {
  const effectiveCustomConfig = customConfig?.enabled ? customConfig : await getServerCustomLlmConfig();

  if (effectiveCustomConfig?.enabled) {
    const reply = await callCustomLlm({
      customConfig: effectiveCustomConfig,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens: 1200,
      timeoutMs,
      userJwt,
      throwOnError: true,
      skipSync: true,
    });
    if (!reply || !reply.trim()) {
      throw new Error('后台/自定义大模型未返回有效分析内容');
    }
    const isCloud =
      effectiveCustomConfig.engineMode === 'cloud' ||
      (effectiveCustomConfig.engineMode !== 'custom' && !effectiveCustomConfig.baseUrl?.trim());
    return {
      text: reply.trim(),
      source: isCloud ? 'lingxi_cloud_brain' : `custom_llm:${effectiveCustomConfig.modelName || 'custom'}`,
      usedBackendCustomLlm: true,
    };
  }

  const selectedModel = resolveGeminiModel(
    customConfig?.geminiModel || customConfig?.modelName || effectiveCustomConfig?.geminiModel,
    'analysis'
  );
  if (!isGeminiAvailable()) {
    const circuit = getGeminiCircuitStatus();
    throw new Error(
      circuit.isBlocked
        ? `Gemini 大模型不可用: ${circuit.reason}`
        : '未配置可用的大模型（请配置 GEMINI_API_KEY 或启用后台/自定义大模型）'
    );
  }

  try {
    const ai = createGeminiClient();
    const resp = await Promise.race([
      ai.models.generateContent({
        model: selectedModel,
        contents: prompt,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Gemini(${selectedModel}) analysis timeout`)), timeoutMs)
      ),
    ]);
    const text = (resp as any)?.text?.trim();
    if (!text) {
      throw new Error(`Gemini(${selectedModel}) 未返回有效内容`);
    }
    return {
      text,
      source: selectedModel,
      usedBackendCustomLlm: false,
    };
  } catch (err: any) {
    handleGeminiApiError(`EvolutionAnalysis(${selectedModel})`, err);
    throw err;
  }
}

// Helper: Push newly distilled chat skills & styles to the user's Backend LLM Brain so it learns across conversations
export async function syncLearnedPatternsToBackendLlm({
  patterns,
  source = 'evolution_learn',
  userJwt,
  customConfig,
}: {
  patterns: Array<{
    id?: string;
    type?: string;
    title: string;
    description: string;
    examplePattern?: string;
    stage?: string;
    confidenceScore?: number;
  }>;
  source?: string;
  userJwt?: string;
  customConfig?: any;
}): Promise<{ synced: boolean; syncedCount: number; endpoint?: string; error?: string }> {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return { synced: false, syncedCount: 0, error: '没有可同步的习得模式' };
  }

  const serverCfg = customConfig?.enabled ? customConfig : await getServerCustomLlmConfig();
  const engineLicenseKey = customConfig?.engineLicenseKey || serverCfg?.engineLicenseKey || '';
  const hasExplicitBackendAuth = Boolean(
    userJwt ||
    engineLicenseKey ||
    process.env.RAILWAY_BRAIN_KEY ||
    process.env.RAILWAY_BRAIN_URL ||
    serverCfg?.engineMode === 'cloud'
  );

  if (!hasExplicitBackendAuth) {
    return {
      synced: false,
      syncedCount: 0,
      error: '未配置云端后台大模型授权令牌或服务地址（仅保存在本地进化库中）',
    };
  }

  const baseUrl = getRailwayBrainBaseUrl();
  const headers = buildRailwayAuthHeaders(serverCfg?.apiKey, userJwt, engineLicenseKey);
  const syncUrl = `${baseUrl}/api/v1/evolution/sync`;

  try {
    const syncRes = await safeSsrfFetch(syncUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source,
        patterns: patterns.map((p) => ({
          ...p,
          learnedAt: Date.now(),
        })),
      }),
      signal: AbortSignal.timeout(7000),
    });

    if (syncRes.ok) {
      return { synced: true, syncedCount: patterns.length, endpoint: '/api/v1/evolution/sync' };
    }

    // Backward compatibility with existing deployed railway-brain-server.ts that only mounts /api/v1/training/feedback
    if (syncRes.status === 404) {
      let fbCount = 0;
      const feedbackUrl = `${baseUrl}/api/v1/training/feedback`;
      for (const p of patterns.slice(0, 5)) {
        const fbRes = await safeSsrfFetch(feedbackUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            stage: `evolution_${p.type || 'chat_skill'}`,
            personaRole: p.title,
            peerCue: p.title,
            snippet: `${p.description}${p.examplePattern ? ` 示例：${p.examplePattern}` : ''}`,
          }),
          signal: AbortSignal.timeout(6000),
        });
        if (fbRes.ok) fbCount++;
      }
      if (fbCount > 0) {
        return { synced: true, syncedCount: fbCount, endpoint: '/api/v1/training/feedback' };
      }
      return { synced: false, syncedCount: 0, error: '后台大模型反馈同步返回非 2xx 状态' };
    }

    const errText = await syncRes.text().catch(() => '');
    return {
      synced: false,
      syncedCount: 0,
      error: `后台大模型同步失败 (HTTP ${syncRes.status})${errText ? `: ${errText.slice(0, 120)}` : ''}`,
    };
  } catch (err: any) {
    return {
      synced: false,
      syncedCount: 0,
      error: err?.message || '连接后台大模型训练接口超时/失败',
    };
  }
}

// Helper: Increment real appliedCount for active habits actually used in a live reply
async function incrementEvolutionHabitUsage(habitIds: string[]): Promise<void> {
  if (!Array.isArray(habitIds) || habitIds.length === 0) return;
  try {
    const state = await getEvolutionStateFromDb();
    if (!state || !Array.isArray(state.habits)) return;
    const idSet = new Set(habitIds);
    let modified = false;
    const updatedHabits = state.habits.map((h: any) => {
      if (idSet.has(h.id)) {
        modified = true;
        return { ...h, appliedCount: (Number(h.appliedCount) || 0) + 1 };
      }
      return h;
    });
    if (modified) {
      await saveEvolutionStateToDb({ ...state, habits: updatedHabits });
    }
  } catch {}
}

// 5. Trigger Self-Training & Habit Self-Evolution Engine (Unified Cloud + Local + DB corpus + Real LLM)
app.post('/api/evolution/learn', aiGenerationLimiter, requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { sampleTexts = [], messages: clientMessages, customConfig, accountId: bodyAccountId } = req.body || {};
    const authContext = (req as any).auth;
    const targetEvolutionAccountId =
      typeof bodyAccountId === 'string' && bodyAccountId.trim()
        ? bodyAccountId.trim()
        : authContext?.effectiveAccountId;
    const currentState = await getEvolutionStateFromDb();
    const now = Date.now();
    const bearerJwt = extractBearerToken(req);

    // Collect genuine unified conversation corpus from DB, client synced messages, Telegram cloud, and sampleTexts
    const corpusResult = await resolveUnifiedEvolutionCorpus({
      sampleTexts,
      clientMessages,
      accountId: targetEvolutionAccountId,
      limit: 50,
    });
    const messagesCorpus = corpusResult.corpusText;
    const analyzedConversationsCount = corpusResult.analyzedConversationsCount;

    // Strictly refuse to inject hardcoded Elena fake conversations when real data is insufficient
    if (!messagesCorpus || messagesCorpus.length < 50) {
      return res.status(400).json({
        success: false,
        error: '当前真实聊天语料不足（少于 50 字），请先积累真实会话记录或输入示范语料后再执行进化学习（严禁注入虚假对话）',
      });
    }

    const prompt = `
请深入分析以下真实对话语料，萃取 2 到 3 个最值得后台大模型持续学习的【真实沟通技巧、大白话聊天习惯与风格镜像范式】：
- 重点分析维度：
  1. 口语助词与自然表达（oral_slang）：贴近真实人类手机私聊的口吻、语气词与节奏。
  2. 对话同频镜像（chat_mirroring）：根据对方句式长短、情绪和表达风格做自然呼应。
  3. 呼吸感与短句节奏（pacing_breath）：避免长篇大论说教与 AI 模板腔。
  4. 情绪共鸣与业务/价值自然过渡（emotional_bonding / wealth_transition / objection_handling）
- 真实语料内容：
${messagesCorpus.slice(0, 3500)}

请严格按以下 JSON 数组格式返回，严禁返回任何多余代码块或解释：
[
  {
    "type": "oral_slang 或 chat_mirroring 或 pacing_breath 或 emotional_bonding 或 wealth_transition 或 objection_handling",
    "title": "简明技巧名称",
    "description": "核心沟通技巧或表达风格机制解析",
    "examplePattern": "从语料总结提炼出的代表性真人口吻范例",
    "confidenceScore": 0.92
  }
]
`;

    let newlyLearnedHabits: any[] = [];
    let extractionSource = '';
    try {
      const llmRes = await invokeEvolutionOrAnalysisLlm({
        prompt,
        customConfig,
        userJwt: bearerJwt,
        timeoutMs: 22000,
      });
      extractionSource = llmRes.source;
      const rawJson = llmRes.text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
      const jsonMatch = rawJson.match(/\[[\s\S]*\]/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawJson);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return res.status(502).json({
          success: false,
          error: `大模型 (${extractionSource}) 未返回有效的进化学习习惯数组（严禁写入虚假兜底习惯）`,
        });
      }

      newlyLearnedHabits = parsed
        .filter((item) => item && (item.title || item.description))
        .map((item, idx) => {
          const rawScore = Number(item.confidenceScore);
          const boundedScore = Number.isFinite(rawScore) ? Math.min(1, Math.max(0, rawScore)) : 0;
          return {
            id: `h_evolved_${now}_${idx + 1}`,
            type: item.type || 'oral_slang',
            title: String(item.title || '实战沟通习惯').trim(),
            description: String(item.description || '').trim(),
            examplePattern: String(item.examplePattern || '').trim(),
            confidenceScore: boundedScore,
            appliedCount: 0,
            isActive: true,
            extractedAt: now,
          };
        });

      if (newlyLearnedHabits.length === 0) {
        return res.status(502).json({
          success: false,
          error: `大模型 (${extractionSource}) 提取出的有效习惯为空，已中止写入`,
        });
      }
    } catch (aiErr: any) {
      const msg = aiErr?.message || String(aiErr);
      const isUnconfigured = /未配置|未启用/.test(msg);
      return res.status(isUnconfigured ? 400 : 503).json({
        success: false,
        error: `大模型自进化提炼失败（严禁伪造习惯数据）：${msg}`,
      });
    }

    // 2. Sync distilled chat skills & styles directly into the Backend LLM Brain
    const backendSyncResult = await syncLearnedPatternsToBackendLlm({
      patterns: newlyLearnedHabits,
      source: 'evolution_learn',
      userJwt: bearerJwt,
      customConfig,
    });

    // 3. Merge into local evolution state with real counters
    const mergedHabits = [...newlyLearnedHabits, ...(currentState.habits || [])].slice(0, 30);
    const updatedState = {
      ...currentState,
      version: `v1.${Math.floor(now / 100000) % 100}.0-adaptive`,
      lastEvolvedAt: now,
      totalConversationsAnalyzed: (currentState.totalConversationsAnalyzed || 0) + analyzedConversationsCount,
      totalHabitsLearned: (currentState.totalHabitsLearned || 0) + newlyLearnedHabits.length,
      habits: mergedHabits,
    };

    await saveEvolutionStateToDb(updatedState);

    // 4. Record truthful training log
    await db.prepare(`
      INSERT INTO training_logs (id, log_type, details, items_learned, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `log_evo_${now}`,
      'evolution_learn',
      `经大模型 (${extractionSource}) 从 ${analyzedConversationsCount} 组真实会话语料提炼 ${newlyLearnedHabits.length} 项沟通技巧与风格${
        backendSyncResult.synced ? '，并已同步强化云端后台大模型' : ''
      }`,
      newlyLearnedHabits.length,
      now
    );

    res.json({
      success: true,
      newHabitsLearned: newlyLearnedHabits.length,
      analyzedConversationsCount,
      modelUsed: extractionSource,
      syncedToBackendLlm: backendSyncResult.synced,
      backendSyncMessage: backendSyncResult.synced
        ? `已同步 ${backendSyncResult.syncedCount} 项技巧至后台大模型 (${backendSyncResult.endpoint})`
        : backendSyncResult.error,
      state: updatedState,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Toggle Habit Item Active Status
app.post('/api/evolution/toggle-habit', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { habitId } = req.body;
    if (!habitId) {
      return res.status(400).json({ error: '缺少 habitId' });
    }
    const state = await getEvolutionStateFromDb();
    let found = false;
    const updatedHabits = (state.habits || []).map((h: any) => {
      if (h.id === habitId) {
        found = true;
        return { ...h, isActive: !h.isActive };
      }
      return h;
    });

    if (!found) {
      return res.status(404).json({ error: '未找到指定习惯条目' });
    }

    const updatedState = { ...state, habits: updatedHabits };
    await saveEvolutionStateToDb(updatedState);
    res.json({ success: true, state: updatedState });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Seed Love & Investment Knowledge Presets
app.post('/api/knowledge/seed-defaults', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const now = Date.now();
    const defaults = [
      {
        id: `know_seed_${now}_1`,
        category: 'icebreaker',
        title: '新好友初识：朋友圈日常与美术馆话题',
        content: '“刚去看了新加坡国家美术馆的特展，有幅光影作品让我驻足了好久。翻列表看到你，感觉你的审美也很有品味，今天过得开心吗？”保持松弛与边界感。',
        keywords: JSON.stringify(['初识', '美术馆', '朋友圈', '松弛感', '好品味']),
      },
      {
        id: `know_seed_${now}_2`,
        category: 'life_emotion',
        title: '生活美学：顶级黑皮诺红酒与慢生活',
        content: '“晚上下厨煎了份和牛眼肉，醒了一瓶勃艮第的黑皮诺。红果香气慢慢化开的感觉太解压了。平时工作那么拼，生活里一定要留点取悦自己的时刻呢。”',
        keywords: JSON.stringify(['红酒', '黑皮诺', '慢生活', '和牛', '解压']),
      },
      {
        id: `know_seed_${now}_3`,
        category: 'wealth_investment',
        title: '投资探讨：以防守为核心的跨资产对冲',
        content: '“在资本市场生存的第一准则就是‘敬畏不确定性’。把主资金放在稳健对冲策略里，只拿极小的风险敞口去博取确定性波段。这样不论牛熊，每晚都能睡个踏实觉。”',
        keywords: JSON.stringify(['跨资产对冲', '风险控制', '稳健收益', '敬畏市场', '安心']),
      },
      {
        id: `know_seed_${now}_4`,
        category: 'trust_defense',
        title: '安全感建设：从容面对试探的君子之交',
        content: '“投资和感情一样，最忌讳勉强和急躁。我从不劝身边朋友做任何投资决策，认知到了自然就同频了。哪怕只是单纯聊聊美食生活，我也觉得很投缘呀。”',
        keywords: JSON.stringify(['不勉强', '认知同频', '君子之交', '安全感', '真诚']),
      },
    ];

    const insert = db.prepare(`
      INSERT INTO knowledge_base (
        id, category, title, content, keywords, source_type, source_file, is_active, hit_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `);

    for (const d of defaults) {
      await insert.run(d.id, d.category, d.title, d.content, d.keywords, 'manual_text', 'preset_pack.md', now, now);
    }

    res.json({ success: true, count: defaults.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== RAILWAY KNOWLEDGE BASE ADAPTER & LRU CACHE ====================

export interface RemoteKbSearchResult {
  ok: boolean;
  connected: boolean;
  context: string;
  matchedCount: number;
  source: string;
  error?: string;
  statusCode?: number;
}

interface CachedKbResult {
  context: string;
  matchedCount: number;
  source: string;
  timestamp: number;
}
const railwayKbCache = new Map<string, CachedKbResult>();
const RAILWAY_KB_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache
const MAX_RAILWAY_KB_CACHE_SIZE = 200;

export function clearRailwayKbCache(): void {
  railwayKbCache.clear();
}

export function isCloudKnowledgeBaseEnabled(config?: any): boolean {
  if (config && typeof config === 'object') {
    if (config.engineMode === 'custom') {
      return false;
    }
    if (typeof config.knowledgeBaseApiUrl === 'string' && config.knowledgeBaseApiUrl.trim()) {
      return true;
    }
    if (typeof config.enableKnowledgeBaseRAG === 'boolean') {
      return config.enableKnowledgeBaseRAG;
    }
    if (config.enabled && (config.engineMode === 'cloud' || !config.baseUrl?.trim())) {
      return true;
    }
    return false;
  }
  return Boolean(
    (process.env.RAILWAY_BRAIN_URL || process.env.RAILWAY_KB_URL || process.env.RAILWAY_BRAIN_KEY || '').trim()
  );
}

function formatRemoteKbHttpError(status: number, rawBody: string): string {
  let detail = '';
  const trimmed = (rawBody || '').trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      detail = String(parsed?.error || parsed?.message || '').trim();
    } catch {
      detail = trimmed.slice(0, 180);
    }
  }
  if (status === 401 || status === 403) {
    return `云端知识库鉴权失败 (HTTP ${status})${detail ? `: ${detail}` : '，请检查会员令牌或引擎授权密钥'}`;
  }
  return `云端知识库服务异常 (HTTP ${status})${detail ? `: ${detail}` : ''}`;
}

export async function searchRailwayKnowledgeBase(
  query: string,
  apiUrl?: string,
  apiKey?: string,
  timeoutMs = 7000,
  userJwt?: string,
  engineLicenseKey?: string
): Promise<RemoteKbSearchResult> {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return { ok: true, connected: false, context: '', matchedCount: 0, source: 'remote_cloud_kb_empty_query' };
  }

  const cleanQuery = query.trim();
  const useCustomNonDefault =
    apiUrl && typeof apiUrl === 'string' && apiUrl.trim() && !isBuiltInCloudGatewayUrl(apiUrl);
  const targetUrl = useCustomNonDefault
    ? apiUrl.trim()
    : `${getRailwayBrainBaseUrl()}/api/knowledge/search`;

  const authSuffix = sanitizeHttpHeaderValue(engineLicenseKey || apiKey || '') ? ':keyed' : ':std';
  const cacheKey = `${targetUrl}${authSuffix}:::${cleanQuery.toLowerCase()}`;
  const now = Date.now();
  const cached = railwayKbCache.get(cacheKey);
  if (cached && (now - cached.timestamp < RAILWAY_KB_CACHE_TTL_MS)) {
    return {
      ok: true,
      connected: true,
      context: cached.context,
      matchedCount: cached.matchedCount,
      source: 'remote_cloud_kb_cache',
    };
  }

  const headers = buildRailwayAuthHeaders(apiKey, userJwt, engineLicenseKey);

  const payload = JSON.stringify({
    query: cleanQuery,
    text: cleanQuery,
    maxResults: 5,
  });

  let responseData: any = null;
  let lastError = '';
  let lastStatusCode = 0;

  const parseJsonSafely = async (res: globalThis.Response): Promise<any> => {
    try {
      return await res.json();
    } catch {
      lastStatusCode = res.status || 502;
      lastError = `云端知识库返回非有效 JSON 响应 (HTTP ${res.status})`;
      return null;
    }
  };

  const executeAttempt = async (attemptTimeoutMs: number): Promise<{ retryable: boolean }> => {
    try {
      const res = await safeSsrfFetch(targetUrl, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });

      if (res.ok) {
        responseData = await parseJsonSafely(res);
        return { retryable: false };
      }

      if (res.status === 404 || res.status === 405) {
        const sep = targetUrl.includes('?') ? '&' : '?';
        const getUrl = `${targetUrl}${sep}query=${encodeURIComponent(cleanQuery)}&q=${encodeURIComponent(cleanQuery)}`;
        const getRes = await safeSsrfFetch(getUrl, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(attemptTimeoutMs),
        });
        if (getRes.ok) {
          responseData = await parseJsonSafely(getRes);
          return { retryable: false };
        }
        const getBody = await getRes.text().catch(() => '');
        lastStatusCode = getRes.status;
        lastError = formatRemoteKbHttpError(getRes.status, getBody);
        return { retryable: getRes.status >= 500 || getRes.status === 429 };
      }

      const errBody = await res.text().catch(() => '');
      lastStatusCode = res.status;
      lastError = formatRemoteKbHttpError(res.status, errBody);
      return { retryable: res.status >= 500 || res.status === 429 };
    } catch (err: any) {
      const msg = err?.message || String(err);
      const isTimeout =
        err?.name === 'TimeoutError' ||
        err?.name === 'AbortError' ||
        /timeout|timed out|aborted/i.test(msg);
      const isSsrf = msg.includes('SSRF 安全拦截');
      lastStatusCode = isSsrf ? 400 : isTimeout ? 504 : 502;
      lastError = isSsrf
        ? msg
        : isTimeout
          ? `云端知识库检索超时 (${attemptTimeoutMs}ms): ${msg}`
          : `云端知识库网络断连: ${msg}`;
      return { retryable: !isSsrf };
    }
  };

  // 1. First search attempt with primary timeout (POST with payload, and GET fallback on 404/405)
  const firstAttempt = await executeAttempt(timeoutMs);
  if (!responseData && firstAttempt.retryable) {
    console.warn(`[Cloud Brain KB search attempt 1 warning]: ${lastError}`);
    // 2. Cold-start / transient failure retry
    const retryTimeoutMs = Math.min(Math.max(timeoutMs * 2, timeoutMs), 13000);
    await executeAttempt(retryTimeoutMs);
    if (!responseData && lastError) {
      console.warn(`[Cloud Brain KB search retry warning]: ${lastError}`);
    }
  }

  if (responseData) {
    const resData = responseData.data || responseData;
    const resultList = Array.isArray(resData.results)
      ? resData.results
      : Array.isArray(resData.items)
        ? resData.items
        : null;
    const rawContext =
      resData.context ||
      resData.text ||
      resData.knowledge ||
      (resultList
        ? resultList
            .map((r: any) => `* [${r.title || '话术'}]: ${r.content || r.text || ''}`)
            .filter((line: string) => !line.endsWith(': '))
            .join('\n')
        : '');

    if (responseData.ok === false || (typeof responseData.error === 'string' && responseData.error && !rawContext)) {
      return {
        ok: false,
        connected: false,
        context: '',
        matchedCount: 0,
        source: 'remote_cloud_kb_error',
        error: String(responseData.error || '云端知识库返回错误状态'),
        statusCode: 502,
      };
    }

    const context = rawContext ? `\n【HumanSense 云端训练引擎 · 专属聊天技巧与话术检索结果】：\n${rawContext}\n` : '';
    const matchedCount = resData.matchedCount ?? (resultList ? resultList.length : (context ? 1 : 0));
    const result: RemoteKbSearchResult = { ok: true, connected: true, context, matchedCount, source: 'remote_cloud_kb' };

    if (railwayKbCache.size >= MAX_RAILWAY_KB_CACHE_SIZE) {
      const oldestKey = railwayKbCache.keys().next().value;
      if (oldestKey) railwayKbCache.delete(oldestKey);
    }
    railwayKbCache.set(cacheKey, { context, matchedCount, source: result.source, timestamp: now });
    return result;
  }

  return {
    ok: false,
    connected: false,
    context: '',
    matchedCount: 0,
    source: 'remote_cloud_kb_error',
    error: lastError || '云端知识库检索失败或无响应',
    statusCode: lastStatusCode || 502,
  };
}

// Private Cloud Knowledge Base Search Proxy (upstream URL strictly hidden from client)
app.post('/api/knowledge/remote-search', aiGenerationLimiter, requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { query, apiUrl, apiKey, customConfig } = req.body;
    const userJwt = extractBearerToken(req);
    const engineKey = customConfig?.engineLicenseKey || req.body?.engineLicenseKey;
    const result = await searchRailwayKnowledgeBase(query, apiUrl, apiKey, 7000, userJwt, engineKey);
    if (!result.ok) {
      return res.status(result.statusCode && result.statusCode >= 400 && result.statusCode < 600 ? result.statusCode : 502).json(result);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ ok: false, connected: false, context: '', matchedCount: 0, source: 'remote_cloud_kb_error', error: error.message });
  }
});

// Anonymized Human-Like Pattern Training Feedback Endpoint (forwards zero-PII winning reply snippets to private training engine)
app.post('/api/training/feedback', aiGenerationLimiter, requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { stage, personaRole, snippet, peerCue, engineLicenseKey } = req.body || {};
    if (!snippet || typeof snippet !== 'string' || !snippet.trim()) {
      return res.status(400).json({ ok: false, error: '反馈语料不能为空' });
    }
    const cleanSnippet = snippet.trim().slice(0, 600);
    const cleanCue = typeof peerCue === 'string' ? peerCue.trim().slice(0, 300) : '';
    const userJwt = extractBearerToken(req);
    const serverCfg = await getServerCustomLlmConfig();
    const effectiveEngineKey = engineLicenseKey || serverCfg?.engineLicenseKey || '';
    const targetUrl = `${getRailwayBrainBaseUrl()}/api/v1/training/feedback`;

    try {
      const upstreamRes = await safeSsrfFetch(targetUrl, {
        method: 'POST',
        headers: buildRailwayAuthHeaders(serverCfg?.apiKey, userJwt, effectiveEngineKey),
        body: JSON.stringify({
          stage: String(stage || 'general'),
          personaRole: String(personaRole || '伴侣客服'),
          snippet: cleanSnippet,
          peerCue: cleanCue,
          adoptedAt: Date.now(),
        }),
        signal: AbortSignal.timeout(6000),
      });
      return res.json({
        ok: true,
        syncedToCloud: upstreamRes.ok,
        status: upstreamRes.status,
      });
    } catch {
      return res.json({ ok: true, syncedToCloud: false });
    }
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// ==================== FULL CHAT DIALOGUE CORPUS & STYLE LEARNING ====================

// 1. Get all dialogue transcripts (Protected with requireTenantAuth)
app.get('/api/transcripts', requireTenantAuth, async (_req: Request, res: Response) => {
  try {
    const transcripts = (await db.prepare(`
      SELECT id, title, description, dialogue_text, learned_style, round_count, character_count, is_active, created_at, updated_at
      FROM chat_transcripts
      ORDER BY created_at DESC
    `).all()) as any[];

    const mapped = transcripts.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description || '',
      dialogueText: t.dialogue_text,
      learnedStyle: t.learned_style || '',
      roundCount: t.round_count || 0,
      characterCount: t.character_count || 0,
      isActive: t.is_active === 1,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }));

    res.json(mapped);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Add or upload full chat transcript with genuine LLM style distillation & backend LLM sync
app.post('/api/transcripts', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { title, description = '', dialogueText, learnedStyle, customConfig } = req.body;
    if (!title || !dialogueText || !String(dialogueText).trim()) {
      return res.status(400).json({ success: false, error: '标题与整篇对话文本为必填项' });
    }

    const now = Date.now();
    const id = `trans_${now}`;
    const bearerJwt = extractBearerToken(req);

    const lines = String(dialogueText).split('\n').filter((l: string) => l.trim().length > 0);
    const roundCount = Math.max(1, Math.round(lines.length / 2));
    const characterCount = String(dialogueText).length;

    let extractedStyle = typeof learnedStyle === 'string' ? learnedStyle.trim() : '';
    let styleModelUsed = '';
    if (!extractedStyle) {
      const stylePrompt = `请客观深入地分析以下整篇对话实录，提炼出其中说话人的真实聊天技巧、口语语气词偏好、句式节奏与情感推进策略（用 2~3 句简洁中文概括，直接输出总结正文，不要套话或 Markdown）：

对话实录：
${String(dialogueText).slice(0, 5000)}`;

      try {
        const llmRes = await invokeEvolutionOrAnalysisLlm({
          prompt: stylePrompt,
          customConfig,
          userJwt: bearerJwt,
          timeoutMs: 20000,
        });
        extractedStyle = llmRes.text.trim();
        styleModelUsed = llmRes.source;
      } catch (llmErr: any) {
        const msg = llmErr?.message || String(llmErr);
        const isUnconfigured = /未配置|未启用/.test(msg);
        return res.status(isUnconfigured ? 400 : 503).json({
          success: false,
          error: `大模型整文对话风格提炼失败（严禁使用固定正则套话代替）：${msg}`,
        });
      }
    }

    await db.prepare(`
      INSERT INTO chat_transcripts (
        id, title, description, dialogue_text, learned_style, round_count, character_count, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      description,
      dialogueText,
      extractedStyle,
      roundCount,
      characterCount,
      1,
      now,
      now
    );

    const syncRes = await syncLearnedPatternsToBackendLlm({
      patterns: [
        {
          id,
          type: 'transcript_style',
          title: String(title).trim(),
          description: extractedStyle,
          examplePattern: lines.slice(-2).join(' / ').slice(0, 220),
        },
      ],
      source: 'transcript_style',
      userJwt: bearerJwt,
      customConfig,
    });

    await db.prepare(`
      INSERT INTO training_logs (id, log_type, details, items_learned, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `log_trans_${now}`,
      'transcript_import',
      `新增整篇对话示范《${title}》（共 ${roundCount} 轮，${characterCount} 字），经${styleModelUsed ? `大模型 (${styleModelUsed})` : '人工指定'}提炼沟通风格${syncRes.synced ? '并同步至后台大模型' : ''}`,
      1,
      now
    );

    res.json({
      success: true,
      id,
      learnedStyle: extractedStyle,
      modelUsed: styleModelUsed || undefined,
      syncedToBackendLlm: syncRes.synced,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Import full transcript directly from an existing customer's unified cloud + local + DB chat with real LLM style distillation
app.post('/api/transcripts/import-from-chat/:chatId', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const { customTitle, chatTitle, customConfig, messages: clientMessages, accountId } = req.body || {};
    const authContext = (req as any).auth;
    const effectiveAccountId = authContext?.effectiveAccountId || accountId || 'acc_1';
    const bearerJwt = extractBearerToken(req);

    const resolved = await resolveUnifiedChatMessages({
      chatId,
      accountId: effectiveAccountId,
      clientMessages,
      limit: 100,
      syncCloud: true,
      persistClientMessages: true,
    });
    const messages = resolved.messages;

    if (!messages || messages.length === 0) {
      return res.status(400).json({ success: false, error: '该客户暂无对话记录，无法导入整文知识库' });
    }

    const clientProfile = await getScopedCustomerProfile(chatId, effectiveAccountId);
    const clientName = clientProfile?.client_name || chatTitle || chatId;

    const formattedLines = messages.map((m) => {
      const role = m.sender === 'peer' ? `[客户 ${clientName}]` : '[我]';
      const content = m.text === 'Voice Message' && m.sttText ? `[语音]: ${m.sttText}` : m.text;
      return `${role}: ${content}`;
    });

    const dialogueText = formattedLines.join('\n');
    const now = Date.now();
    const id = `trans_from_chat_${now}`;
    const title = customTitle || `与客户【${clientName}】的历史真实整文聊天记录 (${messages.length} 条消息)`;
    const roundCount = Math.max(1, Math.round(messages.length / 2));
    const characterCount = dialogueText.length;

    let learnedStyle = '';
    let styleModelUsed = '';
    try {
      const llmRes = await invokeEvolutionOrAnalysisLlm({
        prompt: `请客观总结以下真实历史对话中我方与客户【${clientName}】互动时的真实聊天技巧、口语特点与风格节奏（2~3 句简洁中文，直接输出正文）：\n\n${dialogueText.slice(-5000)}`,
        customConfig,
        userJwt: bearerJwt,
        timeoutMs: 20000,
      });
      learnedStyle = llmRes.text.trim();
      styleModelUsed = llmRes.source;
    } catch (llmErr: any) {
      const msg = llmErr?.message || String(llmErr);
      const isUnconfigured = /未配置|未启用/.test(msg);
      return res.status(isUnconfigured ? 400 : 503).json({
        success: false,
        error: `大模型会话风格提炼失败（严禁使用固定套话模板）：${msg}`,
      });
    }

    await db.prepare(`
      INSERT INTO chat_transcripts (
        id, title, description, dialogue_text, learned_style, round_count, character_count, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      `从数据库导出与客户 ${clientName} 的完整对话并由大模型 (${styleModelUsed}) 提炼沟通习惯。`,
      dialogueText,
      learnedStyle,
      roundCount,
      characterCount,
      1,
      now,
      now
    );

    const syncRes = await syncLearnedPatternsToBackendLlm({
      patterns: [
        {
          id,
          type: 'chat_transcript_style',
          title,
          description: learnedStyle,
          examplePattern: formattedLines.slice(-2).join(' / ').slice(0, 220),
        },
      ],
      source: 'chat_to_transcript',
      userJwt: bearerJwt,
      customConfig,
    });

    await db.prepare(`
      INSERT INTO training_logs (id, log_type, details, items_learned, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `log_chat_import_${now}`,
      'chat_to_transcript',
      `成功将客户 ${clientName} 的全篇对话（共 ${messages.length} 条）转化为整文示范并经 (${styleModelUsed}) 提炼习惯${syncRes.synced ? '，已同步强化后台大模型' : ''}`,
      1,
      now
    );

    res.json({ success: true, id, title, roundCount, characterCount, learnedStyle, syncedToBackendLlm: syncRes.synced });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Toggle transcript active (Protected with requireTenantAuth)
app.patch('/api/transcripts/:id/toggle', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.prepare(`
      UPDATE chat_transcripts
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Delete transcript (Protected with requireTenantAuth)
app.delete('/api/transcripts/:id', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.prepare('DELETE FROM chat_transcripts WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TRANSLATE & TTS & AUDIO ====================

// Language code helper for Google Translate (supports all 130+ Google Cloud Translation languages)
export function mapLanguageCode(lang: string): string {
  if (!lang) return 'en';
  const clean = lang.trim();
  const map: Record<string, string> = {
    Chinese: 'zh-CN',
    'zh-CN': 'zh-CN',
    zh: 'zh-CN',
    '中文': 'zh-CN',
    '中文 (简体)': 'zh-CN',
    '中文 (简体 · zh-CN)': 'zh-CN',
    'Traditional Chinese': 'zh-TW',
    'zh-TW': 'zh-TW',
    'zh-HK': 'zh-TW',
    '中文 (繁体)': 'zh-TW',
    '中文 (繁体 · zh-TW)': 'zh-TW',
    Cantonese: 'yue',
    yue: 'yue',
    '粤语': 'yue',
    English: 'en',
    en: 'en',
    '英语': 'en',
    Russian: 'ru',
    ru: 'ru',
    '俄语': 'ru',
    Spanish: 'es',
    es: 'es',
    '西班牙语': 'es',
    French: 'fr',
    fr: 'fr',
    '法语': 'fr',
    German: 'de',
    de: 'de',
    '德语': 'de',
    Japanese: 'ja',
    ja: 'ja',
    '日语': 'ja',
    Korean: 'ko',
    ko: 'ko',
    '韩语': 'ko',
    Arabic: 'ar',
    ar: 'ar',
    '阿拉伯语': 'ar',
    Portuguese: 'pt',
    pt: 'pt',
    '葡萄牙语': 'pt',
    Italian: 'it',
    it: 'it',
    '意大利语': 'it',
    Dutch: 'nl',
    nl: 'nl',
    '荷兰语': 'nl',
    Polish: 'pl',
    pl: 'pl',
    '波兰语': 'pl',
    Ukrainian: 'uk',
    uk: 'uk',
    '乌克兰语': 'uk',
    Hindi: 'hi',
    hi: 'hi',
    '印地语': 'hi',
    Malay: 'ms',
    ms: 'ms',
    '马来语': 'ms',
    Filipino: 'tl',
    Tagalog: 'tl',
    fil: 'tl',
    tl: 'tl',
    '菲律宾语': 'tl',
    Burmese: 'my',
    my: 'my',
    '缅甸语': 'my',
    Khmer: 'km',
    km: 'km',
    '高棉语': 'km',
    Lao: 'lo',
    lo: 'lo',
    '老挝语': 'lo',
    Persian: 'fa',
    Farsi: 'fa',
    fa: 'fa',
    '波斯语': 'fa',
    Hebrew: 'he',
    he: 'he',
    iw: 'he',
    '希伯来语': 'he',
    Greek: 'el',
    el: 'el',
    '希腊语': 'el',
    Swedish: 'sv',
    sv: 'sv',
    '瑞典语': 'sv',
    Danish: 'da',
    da: 'da',
    '丹麦语': 'da',
    Norwegian: 'no',
    no: 'no',
    '挪威语': 'no',
    Finnish: 'fi',
    fi: 'fi',
    '芬兰语': 'fi',
    Czech: 'cs',
    cs: 'cs',
    '捷克语': 'cs',
    Hungarian: 'hu',
    hu: 'hu',
    '匈牙利语': 'hu',
    Romanian: 'ro',
    ro: 'ro',
    '罗马尼亚语': 'ro',
    Bulgarian: 'bg',
    bg: 'bg',
    '保加利亚语': 'bg',
    Slovak: 'sk',
    sk: 'sk',
    '斯洛伐克语': 'sk',
    Croatian: 'hr',
    hr: 'hr',
    '克罗地亚语': 'hr',
    Serbian: 'sr',
    sr: 'sr',
    '塞尔维亚语': 'sr',
    Slovenian: 'sl',
    sl: 'sl',
    '斯洛文尼亚语': 'sl',
    Bengali: 'bn',
    bn: 'bn',
    '孟加拉语': 'bn',
    Urdu: 'ur',
    ur: 'ur',
    '乌尔都语': 'ur',
    Tamil: 'ta',
    ta: 'ta',
    '泰米尔语': 'ta',
    Telugu: 'te',
    te: 'te',
    '泰卢固语': 'te',
    Marathi: 'mr',
    mr: 'mr',
    Punjabi: 'pa',
    pa: 'pa',
    Gujarati: 'gu',
    gu: 'gu',
    Kannada: 'kn',
    kn: 'kn',
    Malayalam: 'ml',
    ml: 'ml',
    Nepali: 'ne',
    ne: 'ne',
    Sinhala: 'si',
    si: 'si',
    Kazakh: 'kk',
    kk: 'kk',
    Uzbek: 'uz',
    uz: 'uz',
    Azerbaijani: 'az',
    az: 'az',
    Georgian: 'ka',
    ka: 'ka',
    Armenian: 'hy',
    hy: 'hy',
    Mongolian: 'mn',
    mn: 'mn',
    Swahili: 'sw',
    sw: 'sw',
    Afrikaans: 'af',
    af: 'af',
    Albanian: 'sq',
    sq: 'sq',
    Amharic: 'am',
    am: 'am',
    Estonian: 'et',
    et: 'et',
    Latvian: 'lv',
    lv: 'lv',
    Lithuanian: 'lt',
    lt: 'lt',
    Belarusian: 'be',
    be: 'be',
    Turkish: 'tr',
    'Türkçe': 'tr',
    'Türkçe (土耳其语)': 'tr',
    '土耳其语': 'tr',
    tr: 'tr',
    Vietnamese: 'vi',
    vi: 'vi',
    '越南语': 'vi',
    Thai: 'th',
    th: 'th',
    '泰语': 'th',
    Indonesian: 'id',
    id: 'id',
    '印尼语': 'id',
    bho: 'bho',
    ceb: 'ceb',
    gom: 'gom',
    haw: 'haw',
    hmn: 'hmn',
    ilo: 'ilo',
    kri: 'kri',
    ckb: 'ckb',
    lus: 'lus',
    mai: 'mai',
    'mni-Mtei': 'mni-Mtei',
    nso: 'nso',
    jw: 'jv',
  };
  if (map[clean]) return map[clean];
  // Preserve valid 2/3-letter ISO-639 codes or BCP-47 subtags (e.g. "mni-Mtei", "ceb", "pt-BR")
  if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(clean)) return clean;
  return clean.toLowerCase().slice(0, 2);
}

const PROMPT_LANGUAGE_NAMES: Record<string, string> = {
  Chinese: 'Simplified Chinese (简体中文)',
  'zh-CN': 'Simplified Chinese (简体中文)',
  'Traditional Chinese': 'Traditional Chinese (繁體中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  yue: 'Cantonese (粵語)',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  uk: 'Ukrainian',
  hi: 'Hindi',
  ms: 'Malay',
  tl: 'Filipino / Tagalog',
  my: 'Burmese (Myanmar)',
  km: 'Khmer (Cambodian)',
  lo: 'Lao',
  fa: 'Persian (Farsi)',
  he: 'Hebrew',
  el: 'Greek',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  cs: 'Czech',
  hu: 'Hungarian',
  ro: 'Romanian',
  bg: 'Bulgarian',
  sk: 'Slovak',
  hr: 'Croatian',
  sr: 'Serbian',
  sl: 'Slovenian',
  bn: 'Bengali',
  ur: 'Urdu',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  pa: 'Punjabi',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  ne: 'Nepali',
  si: 'Sinhala',
  kk: 'Kazakh',
  uz: 'Uzbek',
  az: 'Azerbaijani',
  ka: 'Georgian',
  hy: 'Armenian',
  mn: 'Mongolian',
  sw: 'Swahili',
  af: 'Afrikaans',
  sq: 'Albanian',
  am: 'Amharic',
  be: 'Belarusian',
  bs: 'Bosnian',
  ca: 'Catalan',
  ceb: 'Cebuano',
  ckb: 'Kurdish (Sorani)',
  ku: 'Kurdish (Kurmanji)',
  et: 'Estonian',
  gl: 'Galician',
  ha: 'Hausa',
  is: 'Icelandic',
  ig: 'Igbo',
  ga: 'Irish',
  jv: 'Javanese',
  ky: 'Kyrgyz',
  lv: 'Latvian',
  lt: 'Lithuanian',
  mk: 'Macedonian',
  mg: 'Malagasy',
  mt: 'Maltese',
  mi: 'Māori',
  'mni-Mtei': 'Meiteilon (Manipuri)',
  ps: 'Pashto',
  so: 'Somali',
  su: 'Sundanese',
  tg: 'Tajik',
  tt: 'Tatar',
  ti: 'Tigrinya',
  tk: 'Turkmen',
  ug: 'Uyghur',
  cy: 'Welsh',
  yo: 'Yoruba',
  zu: 'Zulu',
};

function resolvePromptLanguageName(lang: string): string {
  const clean = (lang || '').trim();
  if (!clean) return 'English';
  return PROMPT_LANGUAGE_NAMES[clean] || clean;
}

export function detectSourceLangCode(text: string): string {
  if (!text || typeof text !== 'string') return 'en';
  const clean = text.trim();
  if (/[\u4e00-\u9fa5]/.test(clean)) return 'zh-CN';
  if (/[іїєґІЇЄҐ]/.test(clean) && /[\u0400-\u04FF]/.test(clean)) return 'uk';
  if (/[\u0400-\u04FF]/.test(clean)) return 'ru';
  if (/[\u3040-\u30ff]/.test(clean)) return 'ja';
  if (/[\uac00-\ud7af]/.test(clean)) return 'ko';
  if (/[پچژگک]/.test(clean) && /[\u0600-\u06FF]/.test(clean)) return 'fa';
  if (/[\u0600-\u06FF]/.test(clean)) return 'ar';
  if (/[\u0590-\u05FF]/.test(clean)) return 'he';
  if (/[\u0370-\u03FF]/.test(clean)) return 'el';
  if (/[\u0e00-\u0e7f]/.test(clean)) return 'th';
  if (/[\u0900-\u097F]/.test(clean)) return 'hi';
  if (/[\u0980-\u09FF]/.test(clean)) return 'bn';
  if (/[\u0B80-\u0BFF]/.test(clean)) return 'ta';
  if (/[\u0C00-\u0C7F]/.test(clean)) return 'te';
  if (/[\u1000-\u109F]/.test(clean)) return 'my';
  if (/[\u1780-\u17FF]/.test(clean)) return 'km';
  if (/[\u0E80-\u0EFF]/.test(clean)) return 'lo';
  if (/[\u10A0-\u10FF]/.test(clean)) return 'ka';
  if (/[\u0530-\u058F]/.test(clean)) return 'hy';
  if (/[\u1200-\u137F]/.test(clean)) return 'am';
  if (
    /[ãõ]/i.test(clean) ||
    /\b(olá|ola|bom dia|boa tarde|boa noite|obrigado|obrigada|você|voce|tudo bem)\b/i.test(clean)
  ) {
    return 'pt';
  }
  if (
    /\b(ciao|buongiorno|buonasera|grazie|come stai|arrivederci|prego)\b/i.test(clean)
  ) {
    return 'it';
  }
  if (
    /[¿¡ñÑ]/i.test(clean) ||
    /\b(hola|buenos días|buenas noches|gracias|amigo|amiga|por favor|cómo estás|como estas|adiós|adios|qué tal|que tal)\b/i.test(clean)
  ) {
    return 'es';
  }
  if (
    /[œæ]/i.test(clean) ||
    /\b(bonjour|bonsoir|merci|salut|comment|s'il vous plaît|sil vous plait|oui|non|mon ami|mon amour|très bien|tres bien|ça va|ca va)\b/i.test(clean)
  ) {
    return 'fr';
  }
  if (
    /[çÇğĞıİşŞ]/.test(clean) ||
    /\b(merhaba|günaydın|gunaydin|nasılsın|nasilsin|teşekkür|tesekkur|evet|hayır|hayir|tamam|lütfen|lutfen|görüşürüz|gorusuruz|harika|canım|canim|iyiyim|selam|nasılsınız|nasilsiniz)\b/i.test(clean)
  ) {
    return 'tr';
  }
  if (
    /[ăắằẳẵặâầấẩẫậêềếểễệôồốổỗộơờớởỡợưừứửữựđẢảẼẽĨĩÕõŨũỸỹẠạẸẹỊịỌọỤụỴỵẢảẺẻỈỉỎỏỦủỶỷàáèéìíòóùúỳý]/i.test(clean) ||
    /\b(xin chào|cảm ơn|cam on|chào|bạn|ơi|vâng|không|tạm biệt|chúc)\b/i.test(clean)
  ) {
    return 'vi';
  }
  if (
    /[äöüß]/i.test(clean) ||
    /\b(guten tag|guten morgen|danke|bitte|wie geht|hallo|tschüss|tschuess|auf wiedersehen)\b/i.test(clean)
  ) {
    return 'de';
  }
  if (
    /\b(selamat pagi|selamat siang|terima kasih|apa kabar|sama-sama|tidak|iya|halo|bagaimana)\b/i.test(clean)
  ) {
    return 'id';
  }
  return 'en';
}

/**
 * Unescapes all HTML character entities (named, decimal, and hexadecimal)
 * preventing garbled entities like &#39;, &quot;, &amp;, &lt;, &gt; from appearing in translation output.
 */
export function decodeHtmlEntities(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&euro;/g, '€')
    .replace(/&pound;/g, '£')
    .replace(/&yen;/g, '¥')
    .replace(/&copy;/g, '©')
    .replace(/&reg;/g, '®')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&#38;/g, '&');
}

export async function performGoogleTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  googleApiKey?: string
): Promise<string> {
  const targetCode = mapLanguageCode(targetLang);
  const isAutoSource = !sourceLang || sourceLang === 'Auto';
  const srcCode = isAutoSource ? detectSourceLangCode(text) : mapLanguageCode(sourceLang);

  if (!isAutoSource && srcCode && targetCode && srcCode.toLowerCase() === targetCode.toLowerCase()) {
    return text;
  }

  // Use Official Google Cloud Translation API v2 if an explicit key is configured,
  // otherwise use keyless Google Machine Translation endpoint directly.
  const apiKey =
    (typeof googleApiKey === 'string' && googleApiKey.trim())
      ? googleApiKey.trim()
      : (process.env.GOOGLE_TRANSLATE_API_KEY || '').trim();

  if (!apiKey) {
    const sl = isAutoSource ? 'auto' : srcCode;
    const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(targetCode)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(gtxUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err: any = new Error(`谷歌机器翻译请求失败: HTTP ${res.status}`);
      err.statusCode = res.status >= 400 && res.status < 500 ? res.status : 502;
      throw err;
    }

    const json = await res.json();
    const segments = Array.isArray(json?.[0]) ? json[0] : [];
    const trans = segments
      .map((seg: any) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('');

    if (!trans || !trans.trim()) {
      const err: any = new Error('谷歌机器翻译未返回有效译文');
      err.statusCode = 502;
      throw err;
    }

    return decodeHtmlEntities(trans);
  }

  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      target: targetCode,
      source: isAutoSource ? undefined : srcCode,
      format: 'text',
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const apiErrMsg = errJson?.error?.message || `HTTP ${res.status}`;
    const err: any = new Error(`Google Cloud Translation API 请求失败: ${apiErrMsg}`);
    err.statusCode = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }

  const json = await res.json();
  const trans = json?.data?.translations?.[0]?.translatedText;
  if (!trans || typeof trans !== 'string' || !trans.trim()) {
    const err: any = new Error('Google Cloud Translation API 未返回有效译文');
    err.statusCode = 502;
    throw err;
  }

  return decodeHtmlEntities(trans);
}

/**
 * Strict single-engine translation router.
 * - Never cascades across engines or 10 candidate models.
 * - Never calls unofficial scrapers (gtx) or third-party free endpoints (MyMemory).
 * - Strictly prohibits using Cloud Training Brain or Knowledge Base (engineMode === 'cloud' / railway.app) for translation.
 * - Always uses local user-configured keys/gateways as standard; throws explicit errors on failure.
 */
export async function performStrictTranslation({
  text,
  sourceLang = 'Auto',
  targetLang = 'Chinese',
  engine,
  googleApiKey,
  geminiModel,
  geminiApiKey: _geminiApiKey,
  customModelName,
  customConfig,
  userJwt,
  engineLicenseKey,
}: {
  text: string;
  sourceLang?: string;
  targetLang?: string;
  engine?: string;
  googleApiKey?: string;
  geminiModel?: string;
  geminiApiKey?: string;
  customModelName?: string;
  customConfig?: any;
  userJwt?: string;
  engineLicenseKey?: string;
}): Promise<{ translatedText: string; engine: string }> {
  const strictEngine = normalizeStrictTranslationEngine(engine);
  if (!strictEngine) {
    const err: any = new Error('请明确指定唯一翻译引擎（google / gemini / custom_llm），系统已禁用 auto 级联降级');
    err.statusCode = 400;
    throw err;
  }

  // 1. Google Machine Translation (keyless gtx by default, or official Cloud Translation v2 if key configured)
  if (strictEngine === 'google') {
    const translatedText = await performGoogleTranslate(text, sourceLang, targetLang, googleApiKey);
    return { translatedText, engine: 'google_translate' };
  }

  // 2. Local Custom LLM Gateway (Strictly uses Tab 3 Base URL + Key and Tab 1 model, never Railway Cloud Brain)
  if (strictEngine === 'custom_llm') {
    if (!customConfig || typeof customConfig !== 'object') {
      const err: any = new Error('自定义模型翻译通道未配置，请在「模型 → 接入自有模型网关」填写接入网址与 API 密钥');
      err.statusCode = 400;
      throw err;
    }

    const baseUrl = typeof customConfig.baseUrl === 'string' ? customConfig.baseUrl.trim() : '';
    if (!baseUrl || isBuiltInCloudGatewayUrl(baseUrl)) {
      const err: any = new Error('翻译通道禁止使用云端训练引擎或知识库，请在「模型 → 接入自有模型网关」填写自定义接入网址 Base URL 与 API 密钥');
      err.statusCode = 400;
      throw err;
    }

    let isLocalhostUrl = false;
    try {
      const parsed = new URL(baseUrl);
      isLocalhostUrl = isAllowedLocalhostEndpoint(parsed.hostname);
    } catch {
      const err: any = new Error('自定义模型 Base URL 格式无效，请填写合法的 http:// 或 https:// 地址');
      err.statusCode = 400;
      throw err;
    }

    const apiKey = typeof customConfig.apiKey === 'string' ? customConfig.apiKey.trim() : '';
    if (!apiKey && !isLocalhostUrl) {
      const err: any = new Error('自定义模型翻译通道缺少本机 API 密钥，请在「模型 → 接入自有模型网关」填写 API 密钥');
      err.statusCode = 400;
      throw err;
    }

    const resolvedModel =
      (typeof customModelName === 'string' && customModelName.trim()) ||
      (typeof customConfig.modelName === 'string' && customConfig.modelName.trim()) ||
      'gpt-4o-mini';
    const inferredProtocol = inferGatewayProtocol(baseUrl, resolvedModel, customConfig.protocol);

    const targetLabel = resolvePromptLanguageName(targetLang);
    const prompt = `Translate the following text into ${targetLabel}. Keep emojis, slang, linebreaks, and casual style. Return ONLY the translated text:\n\n${text}`;
    const translatedText = await callCustomLlm({
      customConfig: {
        ...customConfig,
        enabled: true,
        engineMode: 'custom',
        protocol: inferredProtocol,
        modelName: resolvedModel,
      },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: 600,
      timeoutMs: 12000,
      throwOnError: true,
      skipSync: true,
    });

    if (!translatedText || !translatedText.trim()) {
      const err: any = new Error('自定义大模型未返回有效译文');
      err.statusCode = 502;
      throw err;
    }

    return {
      translatedText: translatedText.trim(),
      engine: `custom_llm:${resolvedModel}`,
    };
  }

  // 3. Google Large Model Translation (Gemma 4 26B / 31B) routed via Cloud Knowledge Base LLM
  const selectedModel = normalizeCloudGemmaTranslateModel(geminiModel);
  const serverCustomCfg = await getServerCustomLlmConfig().catch(() => null);
  const effectiveLicenseKey =
    (typeof engineLicenseKey === 'string' && engineLicenseKey.trim()) ||
    (typeof customConfig?.engineLicenseKey === 'string' && customConfig.engineLicenseKey.trim()) ||
    (typeof serverCustomCfg?.engineLicenseKey === 'string' && serverCustomCfg.engineLicenseKey.trim()) ||
    (process.env.RAILWAY_BRAIN_KEY || '').trim() ||
    undefined;
  const effectiveUserJwt =
    (typeof userJwt === 'string' && userJwt.trim()) ||
    lastActiveUserJwt ||
    undefined;

  if (!effectiveUserJwt && !effectiveLicenseKey) {
    const err: any = new Error('谷歌大模型翻译通道（知识库大模型）未获取到会员授权令牌，请先登录会员账号或在「大模型配置」中填写引擎密钥');
    err.statusCode = 401;
    throw err;
  }

  const srcDesc = sourceLang === 'Auto' ? 'auto-detected language' : resolvePromptLanguageName(sourceLang);
  const targetLabel = resolvePromptLanguageName(targetLang);
  const translationSystemPrompt =
    `[STRICT TRANSLATION TASK - DO NOT CHAT OR ADD FILLER]\n` +
    `You are a high-precision real-time translator for Telegram. Translate the user's message accurately into ${targetLabel} (from ${srcDesc}).\n` +
    `Preserve exact meaning, tone, emojis, and line breaks. Output ONLY the translated text without quotes, explanations, or conversational filler.`;

  const translatedText = await callCustomLlm({
    customConfig: {
      enabled: true,
      engineMode: 'cloud',
      protocol: 'openai',
      baseUrl: '',
      apiKey: '',
      modelName: selectedModel,
      temperature: 0.2,
      engineLicenseKey: effectiveLicenseKey,
    },
    systemInstruction: translationSystemPrompt,
    messages: [{ role: 'user', content: text }],
    temperature: 0.2,
    maxTokens: 800,
    timeoutMs: 15000,
    userJwt: effectiveUserJwt,
    throwOnError: true,
    skipSync: true,
    extraPayload: { purpose: 'translation' },
  });

  if (!translatedText || !translatedText.trim()) {
    const err: any = new Error(`知识库大模型 (${selectedModel}) 未返回有效译文`);
    err.statusCode = 502;
    throw err;
  }

  return {
    translatedText: translatedText.trim(),
    engine: `cloud_kb:${selectedModel}`,
  };
}

// 7. Translation Endpoint (Strictly single selected engine, zero cascading or unofficial scraping)
app.post('/api/translate', aiGenerationLimiter, async (req: Request, res: Response) => {
  try {
    const {
      text,
      sourceLang = 'Auto',
      targetLang = 'Chinese',
      customConfig,
      engine,
      googleApiKey,
      geminiModel,
      geminiApiKey,
      customModelName,
      engineLicenseKey,
    } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: '待翻译文本不能为空' });
    }

    const strictEngine = normalizeStrictTranslationEngine(engine);
    if (!strictEngine) {
      return res.status(400).json({
        error: '请明确指定唯一翻译引擎（google / gemini / custom_llm），系统已禁用 auto 级联降级',
      });
    }

    const userJwt = extractBearerToken(req);
    if (userJwt) {
      lastActiveUserJwt = userJwt;
    }

    // Resolve saved local user keys/gateways as fallback ONLY if not passed in body
    const savedTransSettings = await getServerTranslationSettings();
    const savedCustomConfig = await getServerCustomLlmConfig();

    const effectiveGoogleKey =
      typeof googleApiKey === 'string' && googleApiKey.trim()
        ? googleApiKey.trim()
        : savedTransSettings?.googleApiKey;

    const effectiveGeminiModel =
      typeof geminiModel === 'string' && geminiModel.trim()
        ? geminiModel.trim()
        : savedTransSettings?.geminiModel;

    const effectiveGeminiKey =
      typeof geminiApiKey === 'string' && geminiApiKey.trim()
        ? geminiApiKey.trim()
        : savedTransSettings?.geminiApiKey;

    const effectiveCustomModelName =
      typeof customModelName === 'string' && customModelName.trim()
        ? customModelName.trim()
        : savedTransSettings?.customModelName;

    const effectiveCustomConfig =
      customConfig && typeof customConfig === 'object'
        ? {
            ...(savedCustomConfig || {}),
            ...customConfig,
            baseUrl: customConfig.baseUrl || savedCustomConfig?.baseUrl || '',
            apiKey: customConfig.apiKey || savedCustomConfig?.apiKey || '',
          }
        : savedCustomConfig;

    const isPriorityCustomGateway = Boolean(
      effectiveCustomConfig?.enabled && effectiveCustomConfig?.engineMode === 'custom'
    );
    if (strictEngine === 'custom_llm' && !isPriorityCustomGateway) {
      return res.status(400).json({ error: '请开启自定义优先回复' });
    }
    const resolvedTranslateEngine: 'google' | 'gemini' | 'custom_llm' = isPriorityCustomGateway
      ? 'custom_llm'
      : strictEngine;
    const resolvedCustomModelName = isPriorityCustomGateway && strictEngine !== 'custom_llm'
      ? (effectiveCustomConfig?.modelName || effectiveCustomModelName || 'gpt-4o-mini')
      : effectiveCustomModelName;

    const effectiveLicenseKey =
      (typeof engineLicenseKey === 'string' && engineLicenseKey.trim()) ||
      (typeof effectiveCustomConfig?.engineLicenseKey === 'string' && effectiveCustomConfig.engineLicenseKey.trim()) ||
      (typeof savedCustomConfig?.engineLicenseKey === 'string' && savedCustomConfig.engineLicenseKey.trim()) ||
      undefined;

    const result = await performStrictTranslation({
      text,
      sourceLang,
      targetLang,
      engine: resolvedTranslateEngine,
      googleApiKey: effectiveGoogleKey,
      geminiModel: effectiveGeminiModel,
      geminiApiKey: effectiveGeminiKey,
      customModelName: resolvedCustomModelName,
      customConfig: effectiveCustomConfig,
      userJwt,
      engineLicenseKey: effectiveLicenseKey,
    });

    return res.json(result);
  } catch (error: any) {
    const status = typeof error?.statusCode === 'number' ? error.statusCode : 503;
    return res.status(status).json({ error: error?.message || '翻译请求失败' });
  }
});

// 8. Audio Transcription (STT) - Strictly single resolved official Gemini model
app.post('/api/audio/transcribe', aiGenerationLimiter, async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType = 'audio/webm', model, customConfig } = req.body;
    if (!audioBase64) return res.status(400).json({ error: 'Audio data is required' });

    const customApiKey = (customConfig?.enabled && customConfig?.protocol === 'gemini' && customConfig?.apiKey) ? customConfig.apiKey : undefined;
    const selectedModel = resolveGeminiModel(model, 'transcribe');
    if (!isGeminiAvailable(customApiKey)) {
      const circuit = getGeminiCircuitStatus();
      return res.status(circuit.isBlocked ? 503 : 400).json({
        error: circuit.isBlocked
          ? `语音转文字引擎不可用: ${circuit.reason}`
          : '未配置 Gemini API 密钥，无法执行语音识别',
      });
    }

    try {
      let cleanBase64 = String(audioBase64);
      let effectiveMimeType = mimeType;
      const localAudioPath = resolveLocalMediaDiskPath(cleanBase64);
      if (localAudioPath) {
        const audioBuf = await fs.promises.readFile(localAudioPath);
        cleanBase64 = audioBuf.toString('base64');
        effectiveMimeType = inferMediaMimeFromExt(localAudioPath);
      } else {
        const dataMatch = cleanBase64.match(/^data:([^;]+);base64,(.+)$/);
        if (dataMatch) {
          effectiveMimeType = dataMatch[1] || mimeType;
          cleanBase64 = dataMatch[2];
        } else {
          cleanBase64 = cleanBase64.replace(/^data:audio\/[^;]+;base64,/, '');
        }
      }
      const ai = createGeminiClient(customApiKey);
      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: {
          parts: [
            { inlineData: { mimeType: effectiveMimeType, data: cleanBase64 } },
            { text: 'Transcribe this voice message accurately into text verbatim.' },
          ],
        },
      });
      const text = response.text?.trim();
      if (!text) {
        return res.status(502).json({ error: `Gemini(${selectedModel}) 未返回有效语音识别文本` });
      }
      return res.json({ text, modelUsed: selectedModel });
    } catch (e: any) {
      handleGeminiApiError(`AudioTranscribe(${selectedModel})`, e);
      return res.status(503).json({ error: `语音识别失败 (${selectedModel}): ${e?.message || String(e)}` });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: Determine Smart Dynamic Model Routing for text conversations
export function determineChatRouting(
  recentText: string,
  messages: any[],
  matchedKnowledgeCount: number
): {
  selectedModel: 'gemini-3.1-flash-lite' | 'gemini-4-hydrogen';
  reason: string;
  category: 'simple' | 'complex';
  estimatedRatio: '80%_flash_lite' | '20%_flash';
} {
  const text = (recentText || '').trim().toLowerCase();

  // 1. High Complexity / High Empathy Triggers -> Gemini 4 Hydrogen (20% Scenario)
  const emotionalKeywords = /(累|疲惫|委屈|难过|伤心|哭|被骂|吵架|不开心|抱抱|想你|喜欢你|爱我|难受|压力大|压力|失眠|好心烦|生病|头痛|不要走|冷淡|还记得|心里难受|走开|分手)/;
  const businessComplexKeywords = /(对冲|清算|tranche|保证金|合约|条款|风控|违约|净额结算|结算政策|杠杆|合规|机构客户)/i;

  const isEmotionallyIntense = emotionalKeywords.test(text);
  const isBusinessComplex = businessComplexKeywords.test(text);
  const isKnowledgeHeavy = matchedKnowledgeCount >= 2;
  const isLongContext = text.length >= 45 || messages.length >= 14;

  if (isEmotionallyIntense || isBusinessComplex || isKnowledgeHeavy || isLongContext) {
    let reason = '复杂关系和上下文理解';
    if (isEmotionallyIntense) reason = '情绪低落/安慰/共情走心回复';
    else if (isBusinessComplex) reason = '大额业务合规与高门槛专业咨询';
    else if (isKnowledgeHeavy) reason = '复杂知识库多条款精准检索问答';
    else if (isLongContext) reason = '长聊天历史跨轮深度上下文分析';

    return {
      selectedModel: 'gemini-4-hydrogen',
      reason,
      category: 'complex',
      estimatedRatio: '20%_flash',
    };
  }

  // 2. Routine Daily / Lightweight / Humor -> Gemini 3.1 Flash Lite (80% Scenario)
  let simpleReason = '普通生活日常闲聊';
  if (/(早安|晚安|早上好|晚上好|中午好|早呀|hi|hello|嗨|在干嘛|吃了吗|起床没)/i.test(text)) {
    simpleReason = '早安、晚安、日常问候与生活作息';
  } else if (/(哈哈|嘻嘻|嘿嘿|搞笑|笑死|好玩|逗|绝绝子|调侃)/i.test(text)) {
    simpleReason = '幽默、调侃、轻松情绪交流';
  } else if (/(好的|好滴|收到|ok|拜拜|bye|嗯嗯|行|知道了)/i.test(text)) {
    simpleReason = '高频短消息极速确认回复';
  }

  return {
    selectedModel: 'gemini-3.1-flash-lite',
    reason: simpleReason,
    category: 'simple',
    estimatedRatio: '80%_flash_lite',
  };
}

// 9. Text to Speech (TTS) - Strictly routed through user's Tab 3 Custom Gateway (Base URL + Key) & Tab 2 TTS Model
app.post('/api/audio/tts-clone', aiGenerationLimiter, async (req: Request, res: Response) => {
  try {
    const {
      text,
      voiceName = 'Kore',
      toneStyle = 'Natural, friendly and conversational',
      model: requestedModel,
      customConfig,
    } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }

    const savedCustomConfig = await getServerCustomLlmConfig().catch(() => null);
    const cleanBaseUrl = (
      (typeof customConfig?.baseUrl === 'string' && customConfig.baseUrl.trim()) ||
      (typeof savedCustomConfig?.baseUrl === 'string' && savedCustomConfig.baseUrl.trim()) ||
      ''
    ).replace(/\/+$/, '');
    const cleanApiKey = sanitizeHttpHeaderValue(
      (typeof customConfig?.apiKey === 'string' && customConfig.apiKey.trim()) ||
      (typeof savedCustomConfig?.apiKey === 'string' && savedCustomConfig.apiKey.trim()) ||
      ''
    );

    if (!cleanBaseUrl || isBuiltInCloudGatewayUrl(cleanBaseUrl)) {
      return res.status(400).json({
        ok: false,
        error: '音色克隆需使用自有模型网关',
        message: '音色克隆统一走「模型 → 接入自有模型网关」，请先填写大模型接入网址 (Base URL) 与 API 密钥。',
      });
    }

    let isLocalhostUrl = false;
    try {
      const parsed = new URL(cleanBaseUrl);
      isLocalhostUrl = isAllowedLocalhostEndpoint(parsed.hostname);
    } catch {
      return res.status(400).json({
        ok: false,
        error: '自有模型网关 Base URL 无效',
        message: '请填写合法的 http:// 或 https:// 接入网址。',
      });
    }

    if (!cleanApiKey && !isLocalhostUrl) {
      return res.status(400).json({
        ok: false,
        error: '音色克隆缺少 API 密钥',
        message: '请先在「模型 → 接入自有模型网关」填写 API 密钥。',
      });
    }

    const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
    const chosenVoice = allowedVoices.includes(voiceName) ? voiceName : 'Kore';
    const selectedTtsModel =
      typeof requestedModel === 'string' && requestedModel.trim()
        ? requestedModel.trim()
        : 'gemini-3.8-flash-tts';

    const openAiVoiceMap: Record<string, string> = {
      Kore: 'nova',
      Zephyr: 'shimmer',
      Fenrir: 'onyx',
      Puck: 'echo',
      Charon: 'fable',
    };
    const mappedOpenAiVoice = openAiVoiceMap[chosenVoice] || 'nova';

    const isOfficialGeminiUrl = cleanBaseUrl.toLowerCase().includes('googleapis.com');
    const isGeminiStyleModel = selectedTtsModel.toLowerCase().includes('gemini');
    const preferGeminiNative = isOfficialGeminiUrl || (isGeminiStyleModel && !cleanBaseUrl.endsWith('/v1'));

    const invokeGeminiNativeTts = async (): Promise<Response | { audioUrl: string; format: string; modelUsed: string } | { status: number; message: string }> => {
      try {
        const sdkBaseUrl = cleanBaseUrl.replace(/\/v1beta.*$/i, '').replace(/\/v1$/i, '');
        const ai = new GoogleGenAI({
          apiKey: cleanApiKey || 'local-key',
          httpOptions: {
            baseUrl: sdkBaseUrl,
            headers: { 'User-Agent': 'aistudio-build' },
          },
        });
        const response = await ai.models.generateContent({
          model: selectedTtsModel,
          contents: [{ role: 'user', parts: [{ text }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: chosenVoice } } },
            systemInstruction: toneStyle
              ? `Please speak in an authentic, natural voice with tone and style: ${toneStyle}`
              : undefined,
          },
        });
        const audioPart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const base64Audio = audioPart?.data;
        const audioBytes = base64Audio ? Buffer.from(base64Audio, 'base64').length : 0;
        if (!base64Audio || audioBytes === 0) {
          return { status: 502, message: `TTS 模型 ${selectedTtsModel} 未返回有效音频数据` };
        }
        const mimeType = audioPart?.mimeType || 'audio/wav';
        return {
          audioUrl: `data:${mimeType};base64,${base64Audio}`,
          format: mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp3') ? 'mp3' : 'wav',
          modelUsed: selectedTtsModel,
        };
      } catch (err: any) {
        const msg = err?.message || String(err);
        const status = /429|quota|resource_exhausted/i.test(msg) ? 429 : /404/.test(msg) ? 404 : 503;
        return { status, message: msg };
      }
    };

    const invokeOpenAiSpeechTts = async (): Promise<{ audioUrl: string; format: string; modelUsed: string } | { status: number; message: string }> => {
      const candidateUrls = cleanBaseUrl.endsWith('/audio/speech')
        ? [cleanBaseUrl]
        : cleanBaseUrl.endsWith('/v1')
        ? [`${cleanBaseUrl}/audio/speech`]
        : [`${cleanBaseUrl}/v1/audio/speech`, `${cleanBaseUrl}/audio/speech`];

      let lastStatus = 502;
      let lastMessage = '网关未返回有效音频响应';

      for (const targetUrl of candidateUrls) {
        try {
          const ttsRes = await safeSsrfFetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(cleanApiKey ? { Authorization: `Bearer ${cleanApiKey}` } : {}),
            },
            body: JSON.stringify({
              model: selectedTtsModel,
              input: text,
              voice: mappedOpenAiVoice,
              response_format: 'mp3',
            }),
            signal: AbortSignal.timeout(25000),
          });

          lastStatus = ttsRes.status;
          if (!ttsRes.ok) {
            const errTxt = await ttsRes.text().catch(() => '');
            lastMessage = `HTTP ${ttsRes.status}${errTxt ? `: ${errTxt.slice(0, 180)}` : ''}`;
            if (ttsRes.status !== 404) break;
            continue;
          }

          const contentType = (ttsRes.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('application/json')) {
            const json = await ttsRes.json().catch(() => null);
            const rawB64 = json?.audio || json?.data?.[0]?.b64_json || json?.audioBase64;
            if (typeof rawB64 === 'string' && rawB64.trim()) {
              const dataUrl = rawB64.startsWith('data:') ? rawB64 : `data:audio/mp3;base64,${rawB64}`;
              return { audioUrl: dataUrl, format: 'mp3', modelUsed: selectedTtsModel };
            }
            lastStatus = 502;
            lastMessage = json?.error?.message || '网关返回 JSON 但未包含音频数据';
            break;
          }

          const arrBuf = await ttsRes.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          if (buf.length === 0) {
            lastStatus = 502;
            lastMessage = '网关返回空音频文件';
            break;
          }
          const mimeType = contentType.includes('wav')
            ? 'audio/wav'
            : contentType.includes('ogg')
            ? 'audio/ogg'
            : 'audio/mpeg';
          const format = mimeType === 'audio/wav' ? 'wav' : mimeType === 'audio/ogg' ? 'ogg' : 'mp3';
          return {
            audioUrl: `data:${mimeType};base64,${buf.toString('base64')}`,
            format,
            modelUsed: selectedTtsModel,
          };
        } catch (err: any) {
          lastStatus = 503;
          lastMessage = err?.message || String(err);
        }
      }
      return { status: lastStatus, message: lastMessage };
    };

    let result: any;
    if (preferGeminiNative) {
      result = await invokeGeminiNativeTts();
    } else {
      result = await invokeOpenAiSpeechTts();
      if (!('audioUrl' in result) && result.status === 404 && isGeminiStyleModel) {
        result = await invokeGeminiNativeTts();
      }
    }

    if ('audioUrl' in result) {
      return res.json({
        audioUrl: result.audioUrl,
        format: result.format,
        voiceName: chosenVoice,
        toneStyle,
        modelUsed: result.modelUsed,
        routingReason: `通过自有模型网关 (${result.modelUsed}) 合成语音`,
      });
    }

    const isQuota = result.status === 429 || /429|quota|resource_exhausted/i.test(result.message);
    return res.status(isQuota ? 429 : result.status || 503).json({
      ok: false,
      error: isQuota ? '语音配额不足' : `语音合成失败 (${selectedTtsModel}): ${result.message}`,
      message: isQuota ? '语音配额不足，请检查自有模型网关账户余额或配额' : result.message,
      isQuotaExceeded: isQuota,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function getCnTranslationIfForeign(text: string, overrideCustomConfig?: any): Promise<string> {
  if (!text || typeof text !== 'string') return '';
  const hasForeign = /[a-zA-Z\u0400-\u04FF\u0600-\u06FF]/.test(text);
  if (!hasForeign) return '';
  try {
    const transSettings = await getServerTranslationSettings();
    const customConfig = overrideCustomConfig || (await getServerCustomLlmConfig());
    const isPriorityCustom = Boolean(customConfig?.enabled && customConfig?.engineMode === 'custom');
    const configuredEngine = normalizeStrictTranslationEngine(transSettings?.preferredEngine) || 'gemini';
    const engine: 'google' | 'gemini' | 'custom_llm' = isPriorityCustom ? 'custom_llm' : configuredEngine;
    const resolvedCustomModel = isPriorityCustom && configuredEngine !== 'custom_llm'
      ? (customConfig?.modelName || transSettings?.customModelName || 'gpt-4o-mini')
      : (transSettings?.customModelName || customConfig?.modelName);
    const result = await performStrictTranslation({
      text,
      sourceLang: 'Auto',
      targetLang: transSettings?.defaultTargetLang && transSettings.defaultTargetLang !== 'Auto' ? transSettings.defaultTargetLang : 'Chinese',
      engine,
      googleApiKey: transSettings?.googleApiKey,
      geminiModel: transSettings?.geminiModel,
      geminiApiKey: transSettings?.geminiApiKey,
      customModelName: resolvedCustomModel,
      customConfig,
      userJwt: lastActiveUserJwt || undefined,
      engineLicenseKey: customConfig?.engineLicenseKey,
    });
    return result.translatedText || '';
  } catch (err: any) {
    console.warn('[Background Translation Error]:', err?.message || err);
    return '';
  }
}

// ==================== 9-STEP REPLY PIPELINE HELPERS ====================

export interface NormalizedChatTurn {
  id?: string;
  sender: 'me' | 'peer';
  role: 'assistant' | 'user';
  text: string;
  mediaType: 'text' | 'voice' | 'image';
  timestamp?: string;
  createdAt?: number;
}

export interface StructuredPersonaPayload {
  personaName: string;
  personaRole: string;
  age: string;
  location: string;
  personalityTraits: string[];
  lifeStyleDetails: string;
  investmentPhilosophy: string;
  activeStage: string;
  stagePrompt: string;
  customSystemInstruction: string;
  tabooKeywords: string[];
  activeHabits: Array<{ id: string; title: string; description: string; examplePattern: string }>;
  hasConfiguredPersona: boolean;
  fallbackPrompt: string;
}

export interface StructuredHolographicProfile {
  found: boolean;
  customerId: string;
  clientName: string;
  relationshipStage: string;
  ageEstimate: string;
  occupation: string;
  locationTimezone: string;
  toneStyle: string;
  likesInterests: string[];
  dislikesTaboos: string[];
  emotionalNeeds: string;
  keyMemories: Array<{ date?: string; topic?: string; summary?: string; emotion?: string }>;
  isColdStart: boolean;
}

export interface StructuredReplyJsonRequest {
  version: '1.0';
  requestId: string;
  customerId: string;
  accountId: string;
  targetLanguage: string;
  datingMode: boolean;
  persona: StructuredPersonaPayload;
  holographicProfile: StructuredHolographicProfile;
  recentMessages: NormalizedChatTurn[];
  messageCount: number;
  integrityVerified: boolean;
}

export function resolveCanonicalChatIds(
  chatId?: string | number | null,
  accountId?: string | null
): { customerId: string; altCustomerId: string; accountId: string } {
  const raw = String(chatId ?? '').trim();
  const altCustomerId = raw
    ? raw.startsWith('tg_')
      ? raw.replace(/^tg_/, '')
      : `tg_${raw}`
    : '';
  return {
    customerId: raw,
    altCustomerId,
    accountId: String(accountId || 'acc_1').trim() || 'acc_1',
  };
}

function normalizeMessageTurn(raw: any, fallbackSeq: number): NormalizedChatTurn | null {
  if (!raw || typeof raw !== 'object') return null;
  const senderRaw = String(raw.sender || raw.role || '').trim().toLowerCase();
  const sender: 'me' | 'peer' | null =
    senderRaw === 'me' || senderRaw === 'assistant' || senderRaw === 'model'
      ? 'me'
      : senderRaw === 'peer' || senderRaw === 'user' || senderRaw === 'client'
        ? 'peer'
        : null;
  if (!sender) return null;

  const sttText = typeof raw.stt_text === 'string' ? raw.stt_text : typeof raw.sttText === 'string' ? raw.sttText : '';
  const imageCaption =
    typeof raw.image_caption === 'string'
      ? raw.image_caption
      : typeof raw.imageCaption === 'string'
        ? raw.imageCaption
        : '';
  const bodyText = typeof raw.text === 'string' ? raw.text : typeof raw.content === 'string' ? raw.content : '';
  const resolvedText = (bodyText || sttText || imageCaption || '').trim();
  if (!resolvedText) return null;

  const mediaType: 'text' | 'voice' | 'image' = sttText && !bodyText ? 'voice' : imageCaption && !bodyText ? 'image' : 'text';
  const rawCreatedAt = Number(raw.created_at ?? raw.createdAt);
  const createdAt = Number.isFinite(rawCreatedAt) && rawCreatedAt > 0 ? rawCreatedAt : fallbackSeq;

  return {
    id: raw.id ? String(raw.id) : undefined,
    sender,
    role: sender === 'me' ? 'assistant' : 'user',
    text: resolvedText,
    mediaType,
    timestamp: raw.timestamp ? String(raw.timestamp) : undefined,
    createdAt,
  };
}

export async function extractRecentTwoWayMessages(
  customerId: string,
  altCustomerId: string,
  clientMessages: any[] = [],
  limit = 30
): Promise<NormalizedChatTurn[]> {
  const cappedLimit = Math.min(Math.max(1, Number(limit) || 30), 30);
  const dbTurns: NormalizedChatTurn[] = [];

  if (customerId) {
    try {
      const rows = (await db
        .prepare(
          `SELECT id, sender, text, stt_text, image_caption, timestamp, created_at
           FROM messages
           WHERE (chat_id = ? OR chat_id = ?)
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(customerId, altCustomerId || customerId, Math.max(cappedLimit * 2, 60))) as any[];

      const orderedRows = [...rows].reverse();
      orderedRows.forEach((row, idx) => {
        const turn = normalizeMessageTurn(row, idx + 1);
        if (turn) dbTurns.push(turn);
      });
    } catch (err: any) {
      console.warn('[Pipeline Step 5] Failed reading recent messages from DB:', err?.message || err);
    }
  }

  const clientTurns: NormalizedChatTurn[] = [];
  if (Array.isArray(clientMessages)) {
    const baseSeq = Date.now() - clientMessages.length;
    clientMessages.forEach((msg, idx) => {
      const turn = normalizeMessageTurn(msg, baseSeq + idx);
      if (turn) clientTurns.push(turn);
    });
  }

  const merged: NormalizedChatTurn[] = [];
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();

  for (const turn of [...dbTurns, ...clientTurns]) {
    if (turn.id) {
      if (seenIds.has(turn.id)) continue;
      seenIds.add(turn.id);
    }
    const fp = `${turn.sender}::${turn.text}::${turn.timestamp || ''}`;
    if (!turn.id && seenFingerprints.has(fp)) continue;
    seenFingerprints.add(fp);
    merged.push(turn);
  }

  merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return merged.slice(-cappedLimit);
}

export function validateReplyPipelineData(input: {
  customerId: string;
  recentMessages: NormalizedChatTurn[];
  persona: StructuredPersonaPayload;
  holographicProfile: StructuredHolographicProfile;
}): { ok: true } | { ok: false; error: string } {
  if (!input.customerId || !input.customerId.trim()) {
    return { ok: false, error: '数据完整性校验失败：缺少有效的当前客户 ID (chatId)' };
  }
  if (!Array.isArray(input.recentMessages) || input.recentMessages.length === 0) {
    return { ok: false, error: '数据完整性校验失败：当前会话暂无可用的双方聊天记录，请先同步历史或发送消息' };
  }
  if (input.recentMessages.length > 30) {
    return { ok: false, error: '数据完整性校验失败：消息上下文超出最近 30 条上限' };
  }
  const hasInvalidTurn = input.recentMessages.some(
    (m) => !m || (m.sender !== 'me' && m.sender !== 'peer') || !String(m.text || '').trim()
  );
  if (hasInvalidTurn) {
    return { ok: false, error: '数据完整性校验失败：存在角色或正文无效的对话记录' };
  }
  if (!input.persona || !Array.isArray(input.persona.personalityTraits) || !Array.isArray(input.persona.tabooKeywords)) {
    return { ok: false, error: '数据完整性校验失败：真实人设数据结构异常' };
  }
  if (
    !input.holographicProfile ||
    !Array.isArray(input.holographicProfile.likesInterests) ||
    !Array.isArray(input.holographicProfile.dislikesTaboos) ||
    !Array.isArray(input.holographicProfile.keyMemories)
  ) {
    return { ok: false, error: '数据完整性校验失败：客户全息档案结构异常' };
  }
  return { ok: true };
}

export function buildCloudReplyJsonRequest(params: {
  customerId: string;
  accountId: string;
  targetLanguage: string;
  datingMode: boolean;
  persona: StructuredPersonaPayload;
  holographicProfile: StructuredHolographicProfile;
  recentMessages: NormalizedChatTurn[];
}): StructuredReplyJsonRequest {
  return {
    version: '1.0',
    requestId: `req_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    customerId: params.customerId,
    accountId: params.accountId,
    targetLanguage: params.targetLanguage || 'Auto',
    datingMode: Boolean(params.datingMode),
    persona: params.persona,
    holographicProfile: params.holographicProfile,
    recentMessages: params.recentMessages.slice(-30),
    messageCount: Math.min(params.recentMessages.length, 30),
    integrityVerified: true,
  };
}

export async function fetchWithRetry(
  targetUrl: string,
  init: RequestInit,
  options?: {
    timeoutMs?: number;
    maxRetries?: number;
    baseDelayMs?: number;
    fetcher?: (url: string, opts: RequestInit) => Promise<globalThis.Response>;
  }
): Promise<globalThis.Response> {
  const timeoutMs = Math.max(1000, options?.timeoutMs ?? 15000);
  const maxRetries = Math.max(0, Math.min(3, options?.maxRetries ?? 2));
  const baseDelayMs = Math.max(50, options?.baseDelayMs ?? 350);
  const fetcher = options?.fetcher ?? safeSsrfFetch;

  let lastErr: any = null;
  let lastRes: globalThis.Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptController = new AbortController();
    const timer = setTimeout(() => attemptController.abort(), timeoutMs);
    const parentSignal = init.signal;
    const onParentAbort = () => attemptController.abort();
    if (parentSignal) {
      if (parentSignal.aborted) {
        clearTimeout(timer);
        throw new Error('Request aborted');
      }
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const res = await fetcher(targetUrl, {
        ...init,
        signal: attemptController.signal,
      });
      lastRes = res;
      const isRetryableStatus = res.status === 429 || res.status >= 500;
      if (!isRetryableStatus || attempt === maxRetries) {
        return res;
      }
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message || String(err);
      const isNonRetryable = msg.includes('SSRF 安全拦截') || Boolean(parentSignal?.aborted);
      if (isNonRetryable || attempt === maxRetries) {
        throw err;
      }
    } finally {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }

    const delay = baseDelayMs * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  if (lastRes) return lastRes;
  throw lastErr || new Error('Cloud API request failed after retries');
}

// 10. AI Chat with Full 9-Step Pipeline: Customer ID -> Real Persona -> Holographic Profile -> Recent 30 Messages -> Integrity Validation -> JSON Request -> Cloud API / Gemini
app.post('/api/llm/chat', aiGenerationLimiter, requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const {
      chatId,
      accountId: reqAccountId,
      messages = [],
      customConfig,
      personaPrompt,
      datingMode = false,
      targetLanguage,
      language,
    } = req.body || {};

    const authContext = (req as any).auth;

    // Step 2: Read & normalize current Customer ID + Account ID
    const { customerId, altCustomerId, accountId } = resolveCanonicalChatIds(
      chatId,
      reqAccountId || authContext?.effectiveAccountId
    );

    // Step 3: Read real Persona & active evolution habits from DB
    const globalPersona = await getGlobalPersonaFromDb().catch(() => DEFAULT_GLOBAL_PERSONA);
    const evolutionState = await getEvolutionStateFromDb().catch(() => DEFAULT_EVOLUTION_STATE);
    const personaCtx = buildActivePersonaAndEvolutionContext(globalPersona, evolutionState, undefined, 3);
    const globalPersonaContext = personaCtx.context;
    const injectedHabitIds = personaCtx.activeHabitIds;

    const personaPayload: StructuredPersonaPayload = {
      personaName: String(globalPersona?.personaName || '').trim(),
      personaRole: String(globalPersona?.personaRole || '').trim(),
      age: String(globalPersona?.age || '').trim(),
      location: String(globalPersona?.location || '').trim(),
      personalityTraits: Array.isArray(globalPersona?.personalityTraits)
        ? globalPersona.personalityTraits.map((t: any) => String(t || '').trim()).filter(Boolean)
        : [],
      lifeStyleDetails: String(globalPersona?.lifeStyleDetails || '').trim(),
      investmentPhilosophy: String(globalPersona?.investmentPhilosophy || '').trim(),
      activeStage: personaCtx.activeStage,
      stagePrompt: String(
        globalPersona?.stagedPrompts?.[personaCtx.activeStage] ||
          globalPersona?.stagedPrompts?.icebreaker ||
          ''
      ).trim(),
      customSystemInstruction: String(globalPersona?.customSystemInstruction || '').trim(),
      tabooKeywords: Array.isArray(globalPersona?.tabooKeywords)
        ? globalPersona.tabooKeywords.map((k: any) => String(k || '').trim()).filter(Boolean)
        : [],
      activeHabits: personaCtx.activeHabitItems.map((h: any) => ({
        id: String(h?.id || ''),
        title: String(h?.title || ''),
        description: String(h?.description || ''),
        examplePattern: String(h?.examplePattern || ''),
      })),
      hasConfiguredPersona: personaCtx.hasConfiguredPersona,
      fallbackPrompt: String(personaPrompt || '').trim(),
    };

    // Step 4: Read current Customer Holographic Profile from DB
    let profileContext = '';
    let customerProfileData: any = null;
    let holographicPayload: StructuredHolographicProfile = {
      found: false,
      customerId,
      clientName: '',
      relationshipStage: '尚未沟通',
      ageEstimate: '-',
      occupation: '',
      locationTimezone: '',
      toneStyle: '',
      likesInterests: [],
      dislikesTaboos: [],
      emotionalNeeds: '',
      keyMemories: [],
      isColdStart: true,
    };

    if (customerId) {
      try {
        const p = await getScopedCustomerProfile(customerId, accountId);

        if (p) {
          customerProfileData = p;
          const likes = safeJsonParse<string[]>(p.likes_interests, []);
          const taboos = safeJsonParse<string[]>(p.dislikes_taboos, []);
          const memories = safeJsonParse<any[]>(p.key_memories, []);

          const isColdStart =
            p.relationship_stage === '尚未沟通' ||
            p.relationship_stage === '初次接触' ||
            (likes.length === 0 && memories.length === 0);

          holographicPayload = {
            found: true,
            customerId: String(p.chat_id || customerId),
            clientName: String(p.client_name || '').trim(),
            relationshipStage: String(p.relationship_stage || '活跃联系人').trim(),
            ageEstimate: String(p.age_estimate || '-').trim(),
            occupation: String(p.occupation || '').trim(),
            locationTimezone: String(p.location_timezone || '').trim(),
            toneStyle: String(p.tone_style || '').trim(),
            likesInterests: Array.isArray(likes) ? likes : [],
            dislikesTaboos: Array.isArray(taboos) ? taboos : [],
            emotionalNeeds: String(p.emotional_needs || '').trim(),
            keyMemories: Array.isArray(memories) ? memories : [],
            isColdStart,
          };

          const memoryGuideline = isColdStart
            ? `【冷启动客观留白准则】：当前客户处于初次结识/冷启动阶段，双方尚未深入交流。你必须保持礼貌得体、自然轻快、适度破冰的初识沟通风格，切勿凭空编造不存在的过往羁绊、熟人玩笑或虚假记忆！`
            : `【极高要求】：
1. 你与对方已建立深入联系，必须完全自然地在对话中融入对客户真实爱好（${likes.slice(0, 2).join('、') || '沟通重点'}）与真实约定的感知，绝对不能说“作为AI”，回复毫无破绽，亲切自然！
2. 篇幅短小精炼（1~2句短句），语气生动，适度使用微表情。`;

          profileContext = `
【数据库已载入该客户的全息专属画像与长期记忆档案】：
- 客户 ID：${holographicPayload.customerId}
- 客户昵称/称谓：${p.client_name}
- 当前关系阶段：${p.relationship_stage}
- 客户性格与语气风格：${p.tone_style}
- 客户的核心喜好与爱聊话题：${likes.join('、')}
- 客户的忌讳与敏感雷区：${taboos.join('、')}
- 客户内心深层情感诉求：${p.emotional_needs}
- 过去双方经历的关键记忆与约定：
${memories.map((m: any) => `  * [${m.date}] ${m.topic}: ${m.summary} (当时情绪: ${m.emotion || '共鸣'})`).join('\n')}

${memoryGuideline}`;
        }
      } catch (err) {
        console.warn('Could not read customer profile from db:', err);
      }
    }

    // Step 5: Extract recent 30 two-way messages (DB + client buffer, deduplicated & ordered)
    const recent30Messages = await extractRecentTwoWayMessages(customerId, altCustomerId, messages, 30);

    // Step 6: Validate Data Integrity before constructing Cloud API / LLM request
    const validation = validateReplyPipelineData({
      customerId,
      recentMessages: recent30Messages,
      persona: personaPayload,
      holographicProfile: holographicPayload,
    });

    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        blocked: true,
        source: 'pipeline_integrity_validation',
      });
    }

    // Optional Cloud KB / Local RAG / Transcript style context (unchanged core architecture)
    let knowledgeContext = '';
    let matchedKnowledgeCount = 0;
    const recentChatText = recent30Messages.slice(-4).map((m) => m.text).join(' ');
    const userJwt = extractBearerToken(req);

    if (isCloudKnowledgeBaseEnabled(customConfig)) {
      const kbUrl = customConfig?.knowledgeBaseApiUrl;
      const kbApiKey = customConfig?.knowledgeBaseApiKey || customConfig?.apiKey;
      const engineKey = customConfig?.engineLicenseKey;
      let kbResult: RemoteKbSearchResult;
      try {
        kbResult = await searchRailwayKnowledgeBase(recentChatText, kbUrl, kbApiKey, 5000, userJwt, engineKey);
      } catch (kbErr: any) {
        kbResult = {
          ok: false,
          connected: false,
          context: '',
          matchedCount: 0,
          source: 'remote_cloud_kb_error',
          error: kbErr?.message || '云端知识库检索异常',
          statusCode: 502,
        };
      }

      if (!kbResult.ok) {
        const reason = kbResult.error || '云端知识库检索未连通或超时';
        console.warn(`[Cloud KB Disconnection Guard] /api/llm/chat blocked: ${reason}`);
        const httpStatus = kbResult.statusCode && kbResult.statusCode >= 400 && kbResult.statusCode < 600
          ? kbResult.statusCode
          : 503;
        return res.status(httpStatus).json({
          error: `云端知识库检索断连或失败 (${reason})，已触发安全阻断并暂停生成回复（如需纯本地回复，请在“大脑与引擎设置”关闭 Cloud RAG 开关）。`,
          blocked: true,
          source: 'cloud_kb_disconnection_guard',
          kbError: reason,
          kbStatusCode: httpStatus,
        });
      }

      if (kbResult.context) {
        knowledgeContext += `\n${kbResult.context}\n`;
        matchedKnowledgeCount += kbResult.matchedCount;
      }
    }

    try {
      const ragResult = await queryKnowledgeRAG(recentChatText, 3);
      if (ragResult.context) {
        knowledgeContext += ragResult.context;
        matchedKnowledgeCount += ragResult.matchedCount;
      }
    } catch (err) {
      console.warn('Knowledge RAG retrieval failed:', err);
    }

    let transcriptContext = '';
    try {
      const activeTranscripts = (await db.prepare(`
        SELECT id, title, description, dialogue_text, learned_style
        FROM chat_transcripts
        WHERE is_active = 1
        ORDER BY created_at DESC
        LIMIT 2
      `).all()) as any[];

      if (activeTranscripts.length > 0) {
        transcriptContext = `
【核心学习范本：整文知识库全篇对话实录与真实人类回复习惯】：
系统内置了我们过去的真实聊天整文全篇记录。你必须深度学习这些整文中【我方】的打字口癖、口语助词、回复节奏和互动习惯，绝对不要使用任何死板生硬的机器人腔调！

${activeTranscripts.map((t, idx) => `
[整文示范 ${idx + 1}]：《${t.title}》
* 提炼的口语习惯与风格画像：${t.learned_style || '极其生活化、高情商、爱用轻快语气助词与简短回复'}
* 真实整文示范片段：
${t.dialogue_text.split('\n').slice(-14).join('\n')}
`).join('\n')}

【回复习惯强制复刻准则】：
1. 语言自然口语化：像在手机 Telegram/微信私聊一样打字，频繁自然使用“哈哈”、“呀”、“啦”、“呢”、“好滴好滴”、“小笨蛋”、“~”等口语助词。
2. 严禁死板长文：禁止输出大段说教或使用 1. 2. 3. 这种客服机器人列点！手机聊天要短小精悍（1~2短句），偶尔分行。
3. 真实接梗共情：对方累了先给情绪抚慰，对方开玩笑了调侃接梗，绝不答非所问，完全复刻上述整文样本中的说话习惯。
`;
      }
    } catch (err) {
      console.warn('Transcript retrieval failed:', err);
    }

    // Intelligent foreign-language detection & anti-drift lock
    let resolvedLang = targetLanguage || language;
    if (!resolvedLang) {
      const lastPeerMsg = [...recent30Messages].reverse().find((m) => m.sender === 'peer');
      const peerText = lastPeerMsg?.text || '';
      const detectedCode = detectSourceLangCode(peerText);
      if (detectedCode && detectedCode !== 'zh-CN') {
        resolvedLang = detectedCode === 'tr' ? 'Turkish' : detectedCode === 'ru' ? 'Russian' : detectedCode === 'en' ? 'English' : detectedCode;
      } else if (customerProfileData?.location_timezone) {
        const tz = String(customerProfileData.location_timezone).toLowerCase();
        if (tz.includes('istanbul') || tz.includes('turkey') || tz.includes('土耳其')) resolvedLang = 'Turkish';
        else if (tz.includes('moscow') || tz.includes('russia') || tz.includes('俄')) resolvedLang = 'Russian';
        else if (tz.includes('utc+') || tz.includes('london') || tz.includes('america')) resolvedLang = 'English';
      }
    }

    const langRequirement = (resolvedLang && resolvedLang !== 'Chinese' && resolvedLang !== 'zh-CN')
      ? `\n\n【语言强制防漂移锁定】：当前客户的沟通语言/母语为 ${resolvedLang}（如土耳其语、英语等）。你必须 100% 严格使用地道纯正的 ${resolvedLang} 回复对方，绝对禁止回复中文！`
      : '';

    const oralAntiAiDirective = `
【极简大白话与真人打字口吻（最高军规 · 严禁违背）】：
1. 绝对杜绝 AI 机械感与客服腔调：
   - 严禁出现“您好”、“有什么能帮您”、“希望以上信息对您有所帮助”、“综上所述”等任何客服机器人问答套话。
   - 严禁使用 1. 2. 3.、小标题、分点列项或写成小作文。
2. 纯正生活大白话与情绪呼吸感：
   - 像一个活生生的人在用手机给微信或 Telegram 上的朋友打字，自然随性。
   - 篇幅节奏克制：手机私聊单次通常为 1~2 个口语短句，言简意赅，留白让对方接话。
3. 严格对照客户最近30条真实聊天记录进行【口语习惯同频镜像】：
   - 仔细观察上方对话上下文中客户的打字习惯（对方说话字数多还是少、爱用什么语气、情绪是疲惫还是兴奋、是否爱用标点或表情）。
   - 1:1 同频克隆对方的口语风格与聊天温度，让对方感受到高度投契的真实人类共鸣。
`;

    const fullSystemInstruction = `${globalPersonaContext || personaPrompt || '你是一位真诚自然、高效有温度的沟通助手。'}
${oralAntiAiDirective}
${profileContext}
${knowledgeContext}
${transcriptContext}${langRequirement}`;

    // Step 7: Build standardized structured JSON request payload
    const structuredJsonRequest = buildCloudReplyJsonRequest({
      customerId,
      accountId,
      targetLanguage: resolvedLang || 'Auto',
      datingMode: Boolean(datingMode),
      persona: personaPayload,
      holographicProfile: holographicPayload,
      recentMessages: recent30Messages,
    });

    const pipelineMeta = {
      requestId: structuredJsonRequest.requestId,
      customerId: structuredJsonRequest.customerId,
      messageCount: structuredJsonRequest.messageCount,
      integrityVerified: structuredJsonRequest.integrityVerified,
      hasHolographicProfile: holographicPayload.found,
    };

    // Step 8: Send to Cloud API / Custom LLM Gateway with HTTPS Timeout & Exponential Backoff Retry
    const isCloudBrainChat =
      customConfig?.engineMode === 'cloud' ||
      (customConfig?.enabled && customConfig?.engineMode !== 'custom' && !customConfig?.baseUrl?.trim());
    if (customConfig?.enabled) {
      if (!isCloudBrainChat) {
        const customUrl = (customConfig?.baseUrl || '').trim();
        if (!customUrl || isBuiltInCloudGatewayUrl(customUrl)) {
          return res.status(400).json({
            error: '已启用优先自有密钥回复，但 Base URL 未配置或无效，严禁降级自动回复。',
            blocked: true,
            source: 'custom_llm_disconnection_guard',
          });
        }
        let isLocalUrl = false;
        try {
          isLocalUrl = isAllowedLocalhostEndpoint(new URL(customUrl).hostname);
        } catch {
          return res.status(400).json({
            error: '已启用优先自有密钥回复，但大模型接入网址格式无效。',
            blocked: true,
            source: 'custom_llm_disconnection_guard',
          });
        }
        if (!String(customConfig?.apiKey || '').trim() && !isLocalUrl) {
          return res.status(400).json({
            error: '已启用优先自有密钥回复，但缺少 API 密钥，严禁降级自动回复。',
            blocked: true,
            source: 'custom_llm_disconnection_guard',
          });
        }
      }
      try {
        const cleanBaseUrl = isCloudBrainChat
          ? `${getRailwayBrainBaseUrl()}/v1`
          : customConfig.baseUrl.trim().replace(/\/+$/, '');
        const effectiveChatProtocol = isCloudBrainChat
          ? 'openai'
          : inferGatewayProtocol(cleanBaseUrl, customConfig.modelName, customConfig.protocol);
        let extraHeaders: Record<string, string> = {};
        if (customConfig.customHeaders) {
          try { extraHeaders = JSON.parse(customConfig.customHeaders); } catch {}
        }

        if (!isCloudBrainChat && effectiveChatProtocol === 'gemini') {
          const targetUrl = buildCustomGeminiUrl(cleanBaseUrl, customConfig.modelName);

          const contents = recent30Messages.map((m) => ({
            role: m.sender === 'peer' ? 'user' : 'model',
            parts: [{ text: m.text }],
          }));

          const cleanKey = sanitizeHttpHeaderValue(customConfig.apiKey);
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(cleanKey
              ? (cleanKey.startsWith('ya29.')
                  ? { Authorization: `Bearer ${cleanKey}` }
                  : { 'x-goog-api-key': cleanKey })
              : {}),
            ...extraHeaders,
          };

          const resGemini = await fetchWithRetry(
            targetUrl,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                contents,
                systemInstruction: { parts: [{ text: fullSystemInstruction }] },
                generationConfig: {
                  temperature: customConfig.temperature ?? 0.7,
                  maxOutputTokens: 500,
                },
              }),
            },
            { timeoutMs: 15000, maxRetries: 2 }
          );

          if (resGemini.ok) {
            const d = await resGemini.json();
            const replyText = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (replyText) {
              void incrementEvolutionHabitUsage(injectedHabitIds);
              const cnTranslation = await getCnTranslationIfForeign(replyText, customConfig);
              return res.json({
                replyText,
                cnTranslation,
                source: 'custom_llm',
                model: customConfig.modelName,
                pipeline: pipelineMeta,
              });
            }
          }
        } else if (!isCloudBrainChat && effectiveChatProtocol === 'anthropic') {
          const candidateUrls = buildCustomAnthropicUrls(cleanBaseUrl);
          const cleanKey = sanitizeHttpHeaderValue(customConfig.apiKey);
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            ...(cleanKey ? { 'x-api-key': cleanKey } : {}),
            ...extraHeaders,
          };
          const { system: anthropicSystem, messages: anthropicMessages } = formatAnthropicMessages(
            recent30Messages,
            fullSystemInstruction
          );
          const rawTemp = Number(customConfig.temperature ?? 0.7);
          const anthropicTemp = Number.isFinite(rawTemp) ? Math.min(Math.max(rawTemp, 0), 1) : 0.7;

          for (const targetUrl of candidateUrls) {
            try {
              const response = await fetchWithRetry(
                targetUrl,
                {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({
                    model: customConfig.modelName || 'claude-3-5-sonnet-20241022',
                    max_tokens: 500,
                    temperature: anthropicTemp,
                    ...(anthropicSystem ? { system: anthropicSystem } : {}),
                    messages: anthropicMessages,
                  }),
                },
                { timeoutMs: 15000, maxRetries: 2 }
              );

              if (response.ok) {
                const data = await response.json();
                const replyText = Array.isArray(data?.content)
                  ? data.content
                      .filter((c: any) => c?.type === 'text' && typeof c?.text === 'string')
                      .map((c: any) => c.text)
                      .join('')
                      .trim()
                  : '';
                if (replyText) {
                  void incrementEvolutionHabitUsage(injectedHabitIds);
                  const cnTranslation = await getCnTranslationIfForeign(replyText, customConfig);
                  return res.json({
                    replyText,
                    cnTranslation,
                    source: 'custom_llm',
                    model: customConfig.modelName,
                    pipeline: pipelineMeta,
                  });
                }
              }
              if (response.status !== 404) break;
            } catch {}
          }
        } else {
          // OpenAI Protocol or LingXi Private Cloud Brain Gateway (carries structuredJsonRequest + 30 two-way turns)
          const candidateUrls = buildCustomOpenAiUrls(cleanBaseUrl);

          const headers: Record<string, string> = isCloudBrainChat
            ? {
                ...buildRailwayAuthHeaders(customConfig.apiKey, userJwt, customConfig.engineLicenseKey),
                ...extraHeaders,
              }
            : {
                'Content-Type': 'application/json',
                ...(customConfig.apiKey ? { Authorization: `Bearer ${customConfig.apiKey}` } : {}),
                ...extraHeaders,
              };

          const formattedMessages = [
            { role: 'system', content: fullSystemInstruction },
            ...recent30Messages.map((m) => ({
              role: m.sender === 'peer' ? 'user' : 'assistant',
              content: m.text,
            })),
          ];

          const requestBody: Record<string, any> = {
            model: customConfig.modelName || (isCloudBrainChat ? 'gemini-4-hydrogen' : 'gpt-4o-mini'),
            messages: formattedMessages,
            temperature: customConfig.temperature ?? 0.7,
            max_tokens: 500,
            ...(isCloudBrainChat ? { contextPayload: structuredJsonRequest } : {}),
          };

          for (const targetUrl of candidateUrls) {
            try {
              const response = await fetchWithRetry(
                targetUrl,
                {
                  method: 'POST',
                  headers,
                  body: JSON.stringify(requestBody),
                },
                { timeoutMs: 15000, maxRetries: 2 }
              );

              if (response.ok) {
                const data = await response.json();
                const replyText = data?.choices?.[0]?.message?.content?.trim();
                if (replyText) {
                  void incrementEvolutionHabitUsage(injectedHabitIds);
                  const cnTranslation = await getCnTranslationIfForeign(replyText, customConfig);
                  return res.json({
                    replyText,
                    cnTranslation,
                    source: isCloudBrainChat ? 'lingxi_cloud_brain' : 'custom_llm',
                    model: data?.model || customConfig.modelName,
                    pipeline: pipelineMeta,
                  });
                }
              }
              if (response.status !== 404) break;
            } catch {
              // try next candidate
            }
          }
        }

        return res.status(503).json({
          error: isCloudBrainChat
            ? '云端训练引擎未连通或密钥未授权，严禁降级自动回复。控制台已保持静默防护。'
            : '自有模型网关未连通、模型不可用或 API 密钥无效，已触发安全阻断并暂停自动回复。',
          blocked: true,
          source: 'custom_llm_disconnection_guard',
        });
      } catch (err: any) {
        console.warn('Custom LLM proxy failed:', err.message);
        return res.status(503).json({
          error: isCloudBrainChat
            ? `云端训练引擎连通失败 (${err.message})，防护机制开启并暂停自动回复。`
            : `自有模型网关连通失败 (${err.message})，防护机制开启并暂停自动回复。`,
          blocked: true,
          source: 'custom_llm_disconnection_guard',
        });
      }
    }

    // Step 8b & 9: Direct Server-Side Gemini Execution with 30-Message Context & Transient Retry
    const lastUserMsg = recent30Messages[recent30Messages.length - 1]?.text || '';
    const routeDecision = determineChatRouting(lastUserMsg, recent30Messages, matchedKnowledgeCount);
    const targetModel = resolveGeminiModel(
      req.body.model || customConfig?.geminiModel || customConfig?.modelName || routeDecision.selectedModel,
      'chat'
    );
    let chatErrorMsg = '';

    if (isGeminiAvailable()) {
      const ai = createGeminiClient();
      const contextTranscript = recent30Messages
        .map((m) => `${m.sender === 'peer' ? '对方' : '我'}: ${m.text}`)
        .join('\n');

      const promptText = `最近 ${recent30Messages.length} 条真实双方对话：\n${contextTranscript}\n\n请严格结合真实人设与客户全息档案记忆直接输出最新一条自然回复：`;

      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Gemini(${targetModel}) chat timeout`)), 15000)
          );

          const geminiRes = await Promise.race([
            ai.models.generateContent({
              model: targetModel,
              contents: promptText,
              config: {
                systemInstruction: fullSystemInstruction,
              },
            }),
            timeoutPromise,
          ]);

          const rawText = geminiRes.text?.trim() || '';

          if (rawText) {
            void incrementEvolutionHabitUsage(injectedHabitIds);
            const cnTranslation = await getCnTranslationIfForeign(rawText);
            return res.json({
              replyText: rawText,
              cnTranslation,
              source: targetModel,
              routing: {
                model: targetModel,
                reason: routeDecision.reason,
                category: routeDecision.category,
                ratioGroup: routeDecision.estimatedRatio,
              },
              pipeline: pipelineMeta,
            });
          }
          chatErrorMsg = `Gemini(${targetModel}) 未返回有效回复内容`;
          break;
        } catch (e: any) {
          const is429 = handleGeminiApiError(`RoutedChat(${targetModel})`, e);
          chatErrorMsg = e?.message || String(e);
          const isTransient = !is429 && /timeout|503|502|500|fetch failed|ECONNRESET/i.test(chatErrorMsg);
          if (!isTransient || attempt === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 400 * Math.pow(2, attempt)));
        }
      }
    } else {
      const circuit = getGeminiCircuitStatus();
      chatErrorMsg = circuit.isBlocked ? circuit.reason : '未配置可用的 Gemini API 密钥';
    }

    return res.status(503).json({
      error: `AI回复生成失败 (${targetModel}): ${chatErrorMsg || '模型未配置或服务不可用'}`,
      source: 'system_error',
      routing: {
        model: targetModel,
        reason: routeDecision.reason,
        category: routeDecision.category,
        ratioGroup: routeDecision.estimatedRatio,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 11. Real-time Live Duplex Voice Conversation Info (Gemini 3.8 Live for Telegram Mini Apps)
app.get('/api/live/info', (_req: Request, res: Response) => {
  res.json({
    liveModel: 'gemini-3.8-live',
    description: 'Gemini 3.8 Live 实时全双工低延迟语音通话与多模态交互引擎',
    supportedProtocols: ['WebSocket', 'WebRTC'],
    features: ['全双工双向打断', '超低延迟实时音频流', '真人语调情绪实时反馈'],
  });
});

function isNonChatModelId(modelId: string): boolean {
  const lower = (modelId || '').toLowerCase();
  return (
    lower.includes('-image') ||
    lower.includes('imagen') ||
    lower.includes('-tts') ||
    lower.includes('native-audio') ||
    lower.includes('-audio') ||
    lower.includes('whisper') ||
    lower.includes('dall-e') ||
    lower.includes('veo') ||
    lower.includes('lyria') ||
    lower.includes('embedding') ||
    lower.includes('moderation') ||
    lower.includes('rerank') ||
    lower.includes('aqa') ||
    lower.includes('computer-use') ||
    lower.includes('robotics') ||
    lower.includes('deep-research') ||
    lower.includes('bison') ||
    lower.includes('gecko') ||
    lower.includes('palm') ||
    /(?:^|-)live(?:-|$)/.test(lower)
  );
}

function computeModelRecencyScore(modelId: string, protocol: 'openai' | 'gemini' | 'anthropic'): number {
  const l = (modelId || '').toLowerCase();
  let majorMinor = 0;

  if (protocol === 'gemini') {
    if (l === 'gemini-flash-latest' || l === 'gemini-pro-latest') majorMinor = 3.85;
    else if (l === 'gemini-flash-lite-latest') majorMinor = 3.8;
    else {
      const m = l.match(/(?:gemini|gemma)-(\d+(?:\.\d+)?)/);
      if (m) majorMinor = parseFloat(m[1]);
    }
    if (l.startsWith('gemma')) majorMinor -= 1.0;
  } else if (protocol === 'anthropic') {
    const m = l.match(/claude-(?:[a-z]+-)?(\d+)(?:[-.](\d+))?/);
    if (m) majorMinor = parseFloat(`${m[1]}.${m[2] || 0}`);
  } else {
    const gptM = l.match(/gpt-(\d+(?:\.\d+)?)/);
    const oM = l.match(/\bo(\d+)\b/);
    const claudeM = l.match(/claude-(?:[a-z]+-)?(\d+)(?:[-.](\d+))?/);
    const dsM = l.match(/deepseek-(?:v)?(\d+(?:\.\d+)?)/);
    const gemM = l.match(/gemini-(\d+(?:\.\d+)?)/);
    if (gptM) majorMinor = parseFloat(gptM[1]) + (l.includes('4o') ? 0.3 : 0);
    else if (oM) majorMinor = 4.0 + parseFloat(oM[1]) * 0.2;
    else if (claudeM) majorMinor = parseFloat(`${claudeM[1]}.${claudeM[2] || 0}`);
    else if (dsM) majorMinor = parseFloat(dsM[1]);
    else if (l.includes('deepseek-reasoner') || l.includes('deepseek-chat')) majorMinor = 3.5;
    else if (gemM) majorMinor = parseFloat(gemM[1]);
  }

  let bonus = 0;
  if (l.includes('preview') || l.includes('-exp')) bonus -= 0.08;
  if (l.includes('flash') && !l.includes('lite')) bonus += 0.04;
  else if (l.includes('pro') || l.includes('gpt-4o') || l.includes('sonnet')) bonus += 0.03;
  else if (l.includes('lite') || l.includes('mini')) bonus += 0.01;
  if (l.includes('001') || l.includes('002')) bonus -= 0.05;

  return majorMinor + bonus;
}

function extractModelIdsFromListPayload(protocol: 'openai' | 'gemini' | 'anthropic', payload: any): string[] {
  const rawList: string[] = [];
  if (protocol === 'gemini' && Array.isArray(payload?.models)) {
    for (const m of payload.models) {
      const methods: string[] | undefined = Array.isArray(m?.supportedGenerationMethods)
        ? m.supportedGenerationMethods
        : undefined;
      if (methods && !methods.includes('generateContent')) continue;
      const id = typeof m?.name === 'string' ? m.name.replace(/^models\//i, '').trim() : '';
      if (!id || isNonChatModelId(id)) continue;
      rawList.push(id);
    }
  } else {
    const arr = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
      ? payload.models
      : [];
    for (const item of arr) {
      const id =
        typeof item === 'string'
          ? item.trim()
          : typeof item?.id === 'string'
          ? item.id.trim()
          : typeof item?.name === 'string'
          ? item.name.trim()
          : '';
      if (!id || isNonChatModelId(id)) continue;
      rawList.push(id);
    }
  }

  const deduped = Array.from(new Set(rawList));
  deduped.sort((a, b) => computeModelRecencyScore(b, protocol) - computeModelRecencyScore(a, protocol));
  return deduped.slice(0, 12);
}

async function fetchAvailableModelsForGateway({
  protocol,
  cleanBaseUrl,
  cleanKey,
  extraHeaders,
}: {
  protocol: 'openai' | 'gemini' | 'anthropic';
  cleanBaseUrl: string;
  cleanKey: string;
  extraHeaders: Record<string, string>;
}): Promise<string[]> {
  const probeController = new AbortController();
  const probeTimer = setTimeout(() => probeController.abort(), 4500);
  try {
    if (protocol === 'gemini') {
      const cleanGeminiBase = cleanBaseUrl.replace(/\/v1$/, '').replace(/\/v1beta.*$/i, '');
      const modelsUrl = `${cleanGeminiBase}/v1beta/models`;
      const geminiHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(cleanKey
          ? cleanKey.startsWith('ya29.')
            ? { Authorization: `Bearer ${cleanKey}` }
            : { 'x-goog-api-key': cleanKey }
          : {}),
        ...extraHeaders,
      };
      const res = await safeSsrfFetch(modelsUrl, {
        method: 'GET',
        headers: geminiHeaders,
        signal: probeController.signal,
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      return extractModelIdsFromListPayload('gemini', data);
    }

    if (protocol === 'anthropic') {
      const stripped = cleanBaseUrl.replace(/\/messages.*$/i, '').replace(/\/+$/, '');
      const candidateModelUrls = stripped.endsWith('/v1')
        ? [`${stripped}/models`]
        : [`${stripped}/v1/models`, `${stripped}/models`];
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...(cleanKey ? { 'x-api-key': cleanKey, Authorization: `Bearer ${cleanKey}` } : {}),
        ...extraHeaders,
      };
      for (const mUrl of candidateModelUrls) {
        try {
          const res = await safeSsrfFetch(mUrl, {
            method: 'GET',
            headers,
            signal: probeController.signal,
          });
          if (res.ok) {
            const data = await res.json().catch(() => null);
            const list = extractModelIdsFromListPayload('anthropic', data);
            if (list.length > 0) return list;
          }
        } catch {}
      }
      return [];
    }

    // OpenAI-compatible (OpenAI, DeepSeek, OneAPI, NewAPI, OpenRouter, etc.)
    const modelsUrls = cleanBaseUrl.endsWith('/models')
      ? [cleanBaseUrl]
      : cleanBaseUrl.endsWith('/v1')
      ? [`${cleanBaseUrl}/models`]
      : [`${cleanBaseUrl}/v1/models`, `${cleanBaseUrl}/models`];
    const headers: Record<string, string> = {
      ...(cleanKey ? { Authorization: `Bearer ${cleanKey}` } : {}),
      ...extraHeaders,
    };
    for (const mUrl of modelsUrls) {
      try {
        const res = await safeSsrfFetch(mUrl, {
          method: 'GET',
          headers,
          signal: probeController.signal,
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const list = extractModelIdsFromListPayload('openai', data);
          if (list.length > 0) return list;
        }
      } catch {}
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(probeTimer);
  }
}

function formatFriendlyPingError({
  protocol,
  status,
  errText,
  modelName,
  availableModels,
}: {
  protocol: 'openai' | 'gemini' | 'anthropic';
  status: number;
  errText: string;
  modelName?: string;
  availableModels: string[];
}): string {
  const lowerErr = (errText || '').toLowerCase();
  const cleanModel = (modelName || '').trim();
  const hasSpaces = Boolean(cleanModel && /\s/.test(cleanModel));

  let parsedErrMsg = '';
  try {
    const parsed = JSON.parse(errText);
    parsedErrMsg = parsed?.error?.message || parsed?.message || '';
  } catch {}
  const detailText = (parsedErrMsg || errText || '').replace(/\s+/g, ' ').trim();

  if (
    status === 401 ||
    status === 403 ||
    lowerErr.includes('api_key_invalid') ||
    lowerErr.includes('invalid_api_key') ||
    lowerErr.includes('authentication_error') ||
    lowerErr.includes('incorrect api key')
  ) {
    return `API 密钥鉴权失败 (${status})：请检查密钥是否正确粘贴、是否已过期或是否具备该接口访问权限。`;
  }

  if (
    status === 429 ||
    lowerErr.includes('resource_exhausted') ||
    lowerErr.includes('insufficient_quota') ||
    lowerErr.includes('rate_limit')
  ) {
    return `请求频次超限或账号配额/余额不足 (429)：请检查当前密钥的额度或稍后重试。`;
  }

  const isModelFormatOrMissing =
    lowerErr.includes('unexpected model name format') ||
    lowerErr.includes('model_not_found') ||
    lowerErr.includes('invalid model') ||
    lowerErr.includes('invalid_model') ||
    lowerErr.includes('does not exist') ||
    lowerErr.includes('is not found for api version') ||
    lowerErr.includes('not supported for generatecontent') ||
    (status === 400 && (hasSpaces || lowerErr.includes('model'))) ||
    status === 404;

  if (isModelFormatOrMissing) {
    const exampleModel =
      availableModels[0] ||
      (protocol === 'gemini'
        ? 'gemini-3.1-flash-lite'
        : protocol === 'anthropic'
        ? 'claude-3-5-sonnet-20241022'
        : 'gpt-4o-mini');

    let reason = '';
    if (hasSpaces || lowerErr.includes('unexpected model name format')) {
      reason = `模型型号「${cleanModel || '当前填写'}」格式无效：接口要求填写无空格的标准模型 ID（例如 ${exampleModel}），请勿包含空格或展示别名。`;
    } else if (status === 404 && !lowerErr.includes('model')) {
      reason = `接口路径或模型「${cleanModel || '当前填写'}」未找到 (404)：请检查接入网址 (Base URL) 是否正确，或确认模型名称是否受当前密钥支持。`;
    } else {
      reason = `模型「${cleanModel || '当前填写'}」不存在、已下线或当前密钥无权调用 (${status})。`;
    }

    if (availableModels.length > 0) {
      return `${reason} 已为您探测到当前密钥可用模型，点击下方推荐型号即可一键切换。`;
    }
    return `${reason}${detailText ? `（详情: ${detailText.slice(0, 120)}）` : ''}`;
  }

  return `连接异常 (${status})：${detailText.slice(0, 160) || '请检查接入网址、API 密钥或模型名称'}`;
}

// 11. Ping Custom LLM or Private Cloud Brain (Rate-limited, SSRF protected, Key in header, URL hidden for cloud mode)
app.post('/api/llm/ping', aiGenerationLimiter, requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { baseUrl, apiKey, modelName, protocol = 'openai', customHeaders, engineMode, engineLicenseKey } = req.body;
    const isCloudPing =
      engineMode === 'cloud' ||
      (!baseUrl && Boolean(engineLicenseKey || process.env.RAILWAY_BRAIN_KEY || extractBearerToken(req)));
    if (!baseUrl && !isCloudPing) return res.status(400).json({ ok: false, error: 'Base URL is required' });

    const cleanBaseUrl = isCloudPing
      ? `${getRailwayBrainBaseUrl()}/v1`
      : (typeof baseUrl === 'string' ? baseUrl : '').replace(/[^\x20-\x7E]/g, '').trim().replace(/\/+$/, '');
    const cleanKey = sanitizeHttpHeaderValue(apiKey);
    const hasExplicitModel = Boolean(modelName && typeof modelName === 'string' && modelName.trim());
    const effectiveModel = hasExplicitModel
      ? modelName.trim()
      : (protocol === 'gemini' ? 'gemini-4-hydrogen' : 'gpt-4o-mini');

    let extraHeaders: Record<string, string> = {};
    if (customHeaders) {
      try { extraHeaders = JSON.parse(customHeaders); } catch {}
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      if (!isCloudPing && protocol === 'gemini') {
        const cleanGeminiBase = cleanBaseUrl.replace(/\/v1$/, '');
        const geminiHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(cleanKey
            ? (cleanKey.startsWith('ya29.')
                ? { Authorization: `Bearer ${cleanKey}` }
                : { 'x-goog-api-key': cleanKey })
            : {}),
          ...extraHeaders,
        };

        if (!hasExplicitModel) {
          try {
            const modelsUrl = `${cleanGeminiBase.replace(/\/v1beta.*$/i, '')}/v1beta/models`;
            const modelsRes = await safeSsrfFetch(modelsUrl, {
              method: 'GET',
              headers: geminiHeaders,
              signal: controller.signal,
            });
            const latency = Date.now() - startTime;
            if (modelsRes.ok) {
              const payload = await modelsRes.json().catch(() => null);
              const availableModels = extractModelIdsFromListPayload('gemini', payload);
              const modelDetails = await buildModelUsageDetails({
                modelIds: availableModels,
                apiKey: cleanKey,
                baseUrl: cleanBaseUrl,
              });
              return res.json({
                ok: true,
                latencyMs: latency,
                suggestedModels: availableModels,
                modelDetails,
                message: `Gemini 网关鉴权与连通测试通过！(延迟 ${latency}ms${availableModels.length > 0 ? ` · 探测到 ${availableModels.length} 个最新对话模型` : ''})`,
              });
            }
            if (modelsRes.status === 401 || modelsRes.status === 403) {
              const errTxt = await modelsRes.text().catch(() => '');
              return res.status(modelsRes.status).json({
                ok: false,
                latencyMs: latency,
                error: formatFriendlyPingError({
                  protocol: 'gemini',
                  status: modelsRes.status,
                  errText: errTxt,
                  modelName,
                  availableModels: [],
                }),
              });
            }
          } catch {}
        }

        let targetUrl = cleanGeminiBase;
        if (!targetUrl.includes(':generateContent')) {
          if (!targetUrl.includes('/v1beta/models') && !targetUrl.includes('/v1/models')) {
            targetUrl = `${targetUrl.replace(/\/v1beta$/i, '').replace(/\/v1$/i, '')}/v1beta/models/${effectiveModel}:generateContent`;
          } else {
            targetUrl = `${targetUrl}:generateContent`;
          }
        }

        const testRes = await safeSsrfFetch(targetUrl, {
          method: 'POST',
          headers: geminiHeaders,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Ping' }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
          signal: controller.signal,
        });
        const latency = Date.now() - startTime;
        if (testRes.ok) {
          await recordCustomLlmModelUsage({
            apiKey: cleanKey,
            baseUrl: cleanBaseUrl,
            modelName: effectiveModel,
            headers: testRes.headers,
          });
          const [currentUsage] = await buildModelUsageDetails({
            modelIds: [effectiveModel],
            apiKey: cleanKey,
            baseUrl: cleanBaseUrl,
          });
          return res.json({
            ok: true,
            latencyMs: latency,
            currentModelUsage: currentUsage,
            message: `Gemini 协议握手成功！响应延迟 ${latency}ms`,
          });
        } else {
          const errText = await testRes.text();
          const availableModels =
            testRes.status === 400 || testRes.status === 404
              ? await fetchAvailableModelsForGateway({
                  protocol: 'gemini',
                  cleanBaseUrl,
                  cleanKey,
                  extraHeaders,
                })
              : [];
          const modelDetails = await buildModelUsageDetails({
            modelIds: availableModels,
            apiKey: cleanKey,
            baseUrl: cleanBaseUrl,
          });
          return res.status(testRes.status).json({
            ok: false,
            latencyMs: latency,
            suggestedModels: availableModels,
            modelDetails,
            error: formatFriendlyPingError({
              protocol: 'gemini',
              status: testRes.status,
              errText,
              modelName: effectiveModel,
              availableModels,
            }),
          });
        }
      } else if (!isCloudPing && protocol === 'anthropic') {
        const candidateUrls = buildCustomAnthropicUrls(cleanBaseUrl);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...(cleanKey ? { 'x-api-key': cleanKey } : {}),
          ...extraHeaders,
        };

        let lastStatus = 404;
        let lastErrText = '';
        const anthropicModel = (modelName && typeof modelName === 'string' && modelName.trim())
          ? modelName.trim()
          : 'claude-3-5-sonnet-20241022';

        for (const targetUrl of candidateUrls) {
          try {
            const testRes = await safeSsrfFetch(targetUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: anthropicModel,
                max_tokens: 5,
                messages: [{ role: 'user', content: 'Ping' }],
              }),
              signal: controller.signal,
            });
            const latency = Date.now() - startTime;
            lastStatus = testRes.status;

            if (testRes.ok) {
              await recordCustomLlmModelUsage({
                apiKey: cleanKey,
                baseUrl: cleanBaseUrl,
                modelName: anthropicModel,
                headers: testRes.headers,
              });
              const [currentUsage] = await buildModelUsageDetails({
                modelIds: [anthropicModel],
                apiKey: cleanKey,
                baseUrl: cleanBaseUrl,
              });
              return res.json({
                ok: true,
                latencyMs: latency,
                currentModelUsage: currentUsage,
                message: `Anthropic 协议握手成功！(匹配路由: ${targetUrl}) 延迟 ${latency}ms`,
              });
            }

            lastErrText = await testRes.text();
            if (testRes.status !== 404) {
              break;
            }
          } catch (e: any) {
            lastErrText = e.message;
          }
        }

        const latency = Date.now() - startTime;
        const availableModels =
          lastStatus === 400 || lastStatus === 404
            ? await fetchAvailableModelsForGateway({
                protocol: 'anthropic',
                cleanBaseUrl,
                cleanKey,
                extraHeaders,
              })
            : [];
        const modelDetails = await buildModelUsageDetails({
          modelIds: availableModels,
          apiKey: cleanKey,
          baseUrl: cleanBaseUrl,
        });
        return res.status(lastStatus).json({
          ok: false,
          latencyMs: latency,
          suggestedModels: availableModels,
          modelDetails,
          error: formatFriendlyPingError({
            protocol: 'anthropic',
            status: lastStatus,
            errText: lastErrText,
            modelName: anthropicModel,
            availableModels,
          }),
        });
      } else {
        // OpenAI Protocol or LingXi Cloud Brain
        const hasExplicitModel = Boolean(modelName && typeof modelName === 'string' && modelName.trim());

        // When pinging custom gateway without a specific model (图3 gateway-only verification),
        // test GET /v1/models first so we verify URL + Key auth without guessing a model name.
        if (!isCloudPing && !hasExplicitModel) {
          const modelsUrls = cleanBaseUrl.endsWith('/models')
            ? [cleanBaseUrl]
            : cleanBaseUrl.endsWith('/v1')
            ? [`${cleanBaseUrl}/models`]
            : [`${cleanBaseUrl}/v1/models`, `${cleanBaseUrl}/models`];

          for (const mUrl of modelsUrls) {
            try {
              const mRes = await safeSsrfFetch(mUrl, {
                method: 'GET',
                headers: {
                  ...(cleanKey ? { Authorization: `Bearer ${cleanKey}` } : {}),
                  ...extraHeaders,
                },
                signal: controller.signal,
              });
              const latency = Date.now() - startTime;
              if (mRes.ok) {
                const payload = await mRes.json().catch(() => null);
                const availableModels = extractModelIdsFromListPayload('openai', payload);
                const modelDetails = await buildModelUsageDetails({
                  modelIds: availableModels,
                  apiKey: cleanKey,
                  baseUrl: cleanBaseUrl,
                });
                return res.json({
                  ok: true,
                  latencyMs: latency,
                  suggestedModels: availableModels,
                  modelDetails,
                  message: `自有模型网关鉴权与连通测试通过！(延迟 ${latency}ms${availableModels.length > 0 ? ` · 探测到 ${availableModels.length} 个最新对话模型` : ''})`,
                });
              }
              if (mRes.status === 401 || mRes.status === 403) {
                const errTxt = await mRes.text().catch(() => '');
                return res.status(mRes.status).json({
                  ok: false,
                  latencyMs: latency,
                  error: formatFriendlyPingError({
                    protocol: 'openai',
                    status: mRes.status,
                    errText: errTxt,
                    modelName,
                    availableModels: [],
                  }),
                });
              }
            } catch {}
          }
        }

        let candidateUrls: string[] = [];
        if (cleanBaseUrl.endsWith('/chat/completions')) {
          candidateUrls = [cleanBaseUrl];
        } else if (cleanBaseUrl.endsWith('/v1')) {
          candidateUrls = [`${cleanBaseUrl}/chat/completions`];
        } else {
          candidateUrls = [`${cleanBaseUrl}/v1/chat/completions`, `${cleanBaseUrl}/chat/completions`];
        }

        const userJwt = extractBearerToken(req);
        const headers: Record<string, string> = isCloudPing
          ? {
              ...buildRailwayAuthHeaders(cleanKey, userJwt, engineLicenseKey),
              ...extraHeaders,
            }
          : {
              'Content-Type': 'application/json',
              ...(cleanKey ? { Authorization: `Bearer ${cleanKey}` } : {}),
              ...extraHeaders,
            };

        let lastStatus = 404;
        let lastErrText = '';

        for (const targetUrl of candidateUrls) {
          try {
            const testRes = await safeSsrfFetch(targetUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: effectiveModel,
                messages: [{ role: 'user', content: 'Ping' }],
                max_tokens: 5,
              }),
              signal: controller.signal,
            });
            const latency = Date.now() - startTime;
            lastStatus = testRes.status;

            if (testRes.ok) {
              if (!isCloudPing) {
                await recordCustomLlmModelUsage({
                  apiKey: cleanKey,
                  baseUrl: cleanBaseUrl,
                  modelName: effectiveModel,
                  headers: testRes.headers,
                });
              }
              const [currentUsage] = !isCloudPing
                ? await buildModelUsageDetails({
                    modelIds: [effectiveModel],
                    apiKey: cleanKey,
                    baseUrl: cleanBaseUrl,
                  })
                : [undefined];
              return res.json({
                ok: true,
                latencyMs: latency,
                currentModelUsage: currentUsage,
                message: isCloudPing
                  ? `HumanSense 云端训练引擎加密通道握手成功！延迟 ${latency}ms`
                  : `自有模型网关握手成功！(匹配路由: ${targetUrl}) 延迟 ${latency}ms`,
              });
            }

            lastErrText = await testRes.text();
            if (testRes.status !== 404) {
              // Not a 404 (e.g. 401 Unauthorized or 500), stop trying fallbacks
              break;
            }
          } catch (e: any) {
            lastErrText = e.message;
          }
        }

        const latency = Date.now() - startTime;
        const availableModels =
          !isCloudPing && (lastStatus === 400 || lastStatus === 404)
            ? await fetchAvailableModelsForGateway({
                protocol: 'openai',
                cleanBaseUrl,
                cleanKey,
                extraHeaders,
              })
            : [];
        const modelDetails = !isCloudPing
          ? await buildModelUsageDetails({
              modelIds: availableModels,
              apiKey: cleanKey,
              baseUrl: cleanBaseUrl,
            })
          : [];
        return res.status(lastStatus).json({
          ok: false,
          latencyMs: latency,
          suggestedModels: availableModels,
          modelDetails,
          error: isCloudPing
            ? `云端引擎异常 (${lastStatus}): ${lastErrText.slice(0, 180)}`
            : formatFriendlyPingError({
                protocol: 'openai',
                status: lastStatus,
                errText: lastErrText,
                modelName: effectiveModel,
                availableModels,
              }),
        });
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: any) {
    res.status(500).json({ ok: false, error: `无法连接: ${error.message}` });
  }
});

// Query honest local daily call count, model tier tag, and any captured x-ratelimit-remaining header
app.post('/api/llm/usage-stats', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { baseUrl = '', apiKey = '', modelName = '' } = req.body || {};
    const cleanModel = typeof modelName === 'string' ? modelName.trim() : '';
    if (!cleanModel) {
      return res.json({ ok: true, usage: null });
    }
    const [usage] = await buildModelUsageDetails({
      modelIds: [cleanModel],
      apiKey: typeof apiKey === 'string' ? apiKey : '',
      baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
    });
    return res.json({ ok: true, date: getTodayUsageDateKey(), usage });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || '查询失败' });
  }
});

// ==================== TELEGRAM BOT WEBHOOK & INGESTION PIPELINE ====================

// Update ID in-memory deduplication cache with sliding expiration
const processedUpdateIds = new Map<number, number>();
const UPDATE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

function isDuplicateUpdate(updateId: number): boolean {
  const now = Date.now();
  // Evict expired entries periodically if cache grows
  if (processedUpdateIds.size > 2000) {
    for (const [id, timestamp] of processedUpdateIds.entries()) {
      if (now - timestamp > UPDATE_CACHE_TTL_MS) {
        processedUpdateIds.delete(id);
      }
    }
  }

  if (processedUpdateIds.has(updateId)) {
    return true;
  }
  processedUpdateIds.set(updateId, now);
  return false;
}

// ==================== RESILIENT TELEGRAM OUTBOUND SENDER & RETRY PIPELINE ====================

export interface TelegramSendOptions {
  messageId?: string;
  replyToMessageId?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  fetcher?: typeof fetch;
}

/**
 * Robust Telegram API Request Dispatcher with Exponential Backoff and 429 Rate Limit Handling.
 * Retries up to maxRetries times on HTTP 429 (respecting retry_after), 5xx server errors, or network errors.
 * Automatically marks message delivery_status ('retrying' -> 'delivered' or 'failed') in the database.
 */
export async function executeTelegramApiWithRetry(
  endpointUrl: string,
  requestInit: RequestInit,
  options: TelegramSendOptions = {}
): Promise<{ ok: boolean; data?: any; error?: string; retries: number; status: number }> {
  const { maxRetries = 3, initialBackoffMs = 500, messageId, fetcher = fetch } = options;
  let attempt = 0;
  let lastError = '';
  let lastStatus = 0;

  while (attempt <= maxRetries) {
    try {
      if (attempt > 0 && messageId) {
        try {
          await db.prepare('UPDATE messages SET delivery_status = ? WHERE id = ?').run('retrying', messageId);
        } catch {}
      }

      const res = await fetcher(endpointUrl, requestInit);
      lastStatus = res.status;

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        json = { ok: false, description: `HTTP ${res.status} non-JSON response` };
      }

      // 1. Success check
      if (res.ok && json?.ok) {
        if (messageId) {
          try {
            await db.prepare('UPDATE messages SET delivery_status = ? WHERE id = ?').run('delivered', messageId);
          } catch {}
        }
        return { ok: true, data: json, retries: attempt, status: res.status };
      }

      // 2. Telegram Rate Limit (429 or error_code === 429)
      if (res.status === 429 || json?.error_code === 429) {
        const retryAfterSeconds = json?.parameters?.retry_after ??
          (parseInt(res.headers?.get?.('retry-after') || '1', 10) || 1);
        const waitMs = Math.min(Math.max(retryAfterSeconds * 1000, 500), 60000);
        console.warn(`[Telegram API 429 Rate Limit] Retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})...`);

        if (attempt < maxRetries) {
          attempt++;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
      }

      // 3. Transient 5xx server error
      if (res.status >= 500 && attempt < maxRetries) {
        const backoffMs = initialBackoffMs * Math.pow(2, attempt);
        console.warn(`[Telegram API ${res.status}] Server error, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      // 4. Non-retryable client error (e.g. 400 Bad Request, 403 Forbidden)
      lastError = json?.description || `HTTP ${res.status}`;
      break;
    } catch (err: any) {
      lastError = err.message || 'Network fetch exception';
      console.warn(`[Telegram API Network Error] ${lastError} (attempt ${attempt + 1}/${maxRetries})...`);
      if (attempt < maxRetries) {
        const backoffMs = initialBackoffMs * Math.pow(2, attempt);
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      break;
    }
  }

  // Final failure: mark message delivery_status as 'failed' in SQLite
  if (messageId) {
    try {
      await db.prepare('UPDATE messages SET delivery_status = ? WHERE id = ?').run('failed', messageId);
    } catch {}
  }

  return { ok: false, error: lastError, retries: attempt, status: lastStatus };
}

// Helper: send message back to Telegram Bot API with automatic retry
export async function sendTelegramMessage(chatId: string | number, text: string, options?: TelegramSendOptions) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[Telegram API] Cannot send message: TELEGRAM_BOT_TOKEN is not configured.');
    return null;
  }

  // Clean internal 'tg_' prefix so Telegram receives a valid numeric or channel chat_id
  const cleanChatId = String(chatId).replace(/^tg_/, '');
  const numericId = Number(cleanChatId);
  const targetChatId = Number.isSafeInteger(numericId) && !cleanChatId.startsWith('0') ? numericId : cleanChatId;

  const result = await executeTelegramApiWithRetry(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text,
        ...(options?.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
      }),
    },
    options
  );

  if (!result.ok) {
    console.warn(`[Telegram API Error] Failed to send message to ${targetChatId} after ${result.retries} retries:`, result.error);
    return null;
  }
  return result.data;
}

async function markMessageDeliveryFailed(messageId?: string) {
  if (!messageId) return;
  try {
    await db.prepare('UPDATE messages SET delivery_status = ? WHERE id = ?').run('failed', messageId);
  } catch {}
}

// Helper: send photo back to Telegram Bot API with caption and automatic retry (no silent text fallback)
export async function sendTelegramPhoto(chatId: string | number, photoUrl: string, caption?: string, options?: TelegramSendOptions) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[Telegram API] Cannot send photo: TELEGRAM_BOT_TOKEN is not configured.');
    await markMessageDeliveryFailed(options?.messageId);
    return null;
  }

  const cleanChatId = String(chatId).replace(/^tg_/, '');
  const numericId = Number(cleanChatId);
  const targetChatId = Number.isSafeInteger(numericId) && !cleanChatId.startsWith('0') ? numericId : cleanChatId;

  try {
    const resolvedDiskPhoto =
      (typeof photoUrl === 'string' && fs.existsSync(photoUrl) ? photoUrl : null) ||
      resolveLocalMediaDiskPath(photoUrl);

    if (resolvedDiskPhoto) {
      const mimeType = inferMediaMimeFromExt(resolvedDiskPhoto);
      const fileBlob: Blob =
        typeof (fs as any).openAsBlob === 'function'
          ? await (fs as any).openAsBlob(resolvedDiskPhoto, { type: mimeType })
          : new Blob([new Uint8Array(await fs.promises.readFile(resolvedDiskPhoto))], { type: mimeType });
      const formData = new FormData();
      formData.append('chat_id', String(targetChatId));
      if (caption) formData.append('caption', caption);
      if (options?.replyToMessageId) formData.append('reply_to_message_id', String(options.replyToMessageId));
      formData.append('photo', fileBlob, path.basename(resolvedDiskPhoto));

      const uploadResult = await executeTelegramApiWithRetry(
        `https://api.telegram.org/bot${botToken}/sendPhoto`,
        { method: 'POST', body: formData },
        options
      );
      if (!uploadResult.ok) {
        console.warn(`[Telegram API Error] Telegram sendPhoto disk upload failed for ${targetChatId} after ${uploadResult.retries} retries:`, uploadResult.error);
        return null;
      }
      return uploadResult.data;
    }

    if (typeof photoUrl === 'string' && photoUrl.startsWith('data:')) {
      const match = photoUrl.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = match ? match[1] : 'image/jpeg';
      const base64Data = match ? match[2] : photoUrl.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0) {
        await markMessageDeliveryFailed(options?.messageId);
        return null;
      }
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : mimeType.includes('gif') ? 'gif' : 'jpg';
      const formData = new FormData();
      formData.append('chat_id', String(targetChatId));
      if (caption) formData.append('caption', caption);
      if (options?.replyToMessageId) formData.append('reply_to_message_id', String(options.replyToMessageId));
      formData.append('photo', new Blob([new Uint8Array(buffer)], { type: mimeType }), `photo.${ext}`);

      const uploadResult = await executeTelegramApiWithRetry(
        `https://api.telegram.org/bot${botToken}/sendPhoto`,
        { method: 'POST', body: formData },
        options
      );
      if (!uploadResult.ok) {
        console.warn(`[Telegram API Error] Telegram sendPhoto upload failed for ${targetChatId} after ${uploadResult.retries} retries:`, uploadResult.error);
        return null;
      }
      return uploadResult.data;
    }

    const result = await executeTelegramApiWithRetry(
      `https://api.telegram.org/bot${botToken}/sendPhoto`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          photo: photoUrl,
          caption: caption || '',
          ...(options?.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
        }),
      },
      options
    );

    if (!result.ok) {
      console.warn(`[Telegram API Error] Telegram sendPhoto failed for ${targetChatId} after ${result.retries} retries:`, result.error);
      return null;
    }
    return result.data;
  } catch (err: any) {
    console.warn('[Telegram Photo Send Error]:', err?.message || err);
    await markMessageDeliveryFailed(options?.messageId);
    return null;
  }
}

// Helper: send video back to Telegram Bot API using /sendVideo (no silent text fallback)
export async function sendTelegramVideo(
  chatId: string | number,
  videoData: string | Buffer,
  caption?: string,
  duration?: number,
  options?: TelegramSendOptions
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[Telegram API] Cannot send video: TELEGRAM_BOT_TOKEN is not configured.');
    await markMessageDeliveryFailed(options?.messageId);
    return null;
  }

  const cleanChatId = String(chatId).replace(/^tg_/, '');
  const numericId = Number(cleanChatId);
  const targetChatId = Number.isSafeInteger(numericId) && !cleanChatId.startsWith('0') ? numericId : cleanChatId;

  try {
    if (typeof videoData === 'string' && (videoData.startsWith('http://') || videoData.startsWith('https://'))) {
      const payload: any = {
        chat_id: targetChatId,
        video: videoData,
        caption: caption || '',
        ...(options?.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
      };
      if (duration && duration > 0) payload.duration = Math.round(duration);

      const result = await executeTelegramApiWithRetry(
        `https://api.telegram.org/bot${botToken}/sendVideo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        options
      );
      if (!result.ok) {
        console.warn(`[Telegram API Error] Telegram sendVideo (URL) failed for ${targetChatId}:`, result.error);
        return null;
      }
      return result.data;
    }

    const resolvedDiskVideo =
      (typeof videoData === 'string' && fs.existsSync(videoData) ? videoData : null) ||
      (typeof videoData === 'string' ? resolveLocalMediaDiskPath(videoData) : null);

    if (resolvedDiskVideo) {
      const mimeType = inferMediaMimeFromExt(resolvedDiskVideo);
      const videoBlob: Blob =
        typeof (fs as any).openAsBlob === 'function'
          ? await (fs as any).openAsBlob(resolvedDiskVideo, { type: mimeType })
          : new Blob([new Uint8Array(await fs.promises.readFile(resolvedDiskVideo))], { type: mimeType });
      const formData = new FormData();
      formData.append('chat_id', String(targetChatId));
      if (caption) formData.append('caption', caption);
      if (duration && duration > 0) formData.append('duration', String(Math.round(duration)));
      if (options?.replyToMessageId) formData.append('reply_to_message_id', String(options.replyToMessageId));
      formData.append('video', videoBlob, path.basename(resolvedDiskVideo));

      const result = await executeTelegramApiWithRetry(
        `https://api.telegram.org/bot${botToken}/sendVideo`,
        { method: 'POST', body: formData },
        options
      );
      if (!result.ok) {
        console.warn(`[Telegram API Error] Telegram sendVideo disk upload failed for ${targetChatId}:`, result.error);
        return null;
      }
      return result.data;
    }

    let buffer: Buffer;
    if (Buffer.isBuffer(videoData)) {
      buffer = videoData;
    } else if (typeof videoData === 'string' && videoData.startsWith('data:')) {
      const base64Data = videoData.split(',')[1] || '';
      buffer = Buffer.from(base64Data, 'base64');
    } else if (typeof videoData === 'string') {
      buffer = Buffer.from(videoData, 'base64');
    } else {
      buffer = Buffer.from([]);
    }

    if (buffer.length === 0) {
      console.warn('[Telegram API Error] Cannot send video: video buffer is empty.');
      await markMessageDeliveryFailed(options?.messageId);
      return null;
    }

    const formData = new FormData();
    formData.append('chat_id', String(targetChatId));
    if (caption) formData.append('caption', caption);
    if (duration && duration > 0) formData.append('duration', String(Math.round(duration)));
    if (options?.replyToMessageId) formData.append('reply_to_message_id', String(options.replyToMessageId));
    const videoBlob = new Blob([new Uint8Array(buffer)]);
    formData.append('video', videoBlob, 'video.mp4');

    const result = await executeTelegramApiWithRetry(
      `https://api.telegram.org/bot${botToken}/sendVideo`,
      { method: 'POST', body: formData },
      options
    );
    if (!result.ok) {
      console.warn(`[Telegram API Error] Telegram sendVideo failed for ${targetChatId}:`, result.error);
      return null;
    }
    return result.data;
  } catch (err: any) {
    console.warn(`[Telegram Video Send Error]:`, err.message);
    await markMessageDeliveryFailed(options?.messageId);
    return null;
  }
}

// Helper: send document/file back to Telegram Bot API with automatic retry (no silent text fallback)
export async function sendTelegramDocument(
  chatId: string | number,
  fileData: string | Buffer,
  filename?: string,
  caption?: string,
  options?: TelegramSendOptions
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[Telegram API] Cannot send document: TELEGRAM_BOT_TOKEN is not configured.');
    await markMessageDeliveryFailed(options?.messageId);
    return null;
  }

  const cleanChatId = String(chatId).replace(/^tg_/, '');
  const numericId = Number(cleanChatId);
  const targetChatId = Number.isSafeInteger(numericId) && !cleanChatId.startsWith('0') ? numericId : cleanChatId;

  try {
    if (typeof fileData === 'string' && (fileData.startsWith('http://') || fileData.startsWith('https://'))) {
      const result = await executeTelegramApiWithRetry(
        `https://api.telegram.org/bot${botToken}/sendDocument`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChatId,
            document: fileData,
            caption: caption || '',
            ...(options?.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
          }),
        },
        options
      );
      if (!result.ok) {
        console.warn(`[Telegram API Error] Telegram sendDocument (URL) failed for ${targetChatId}:`, result.error);
        return null;
      }
      return result.data;
    }

    const resolvedDiskFile =
      (typeof fileData === 'string' && fs.existsSync(fileData) ? fileData : null) ||
      (typeof fileData === 'string' ? resolveLocalMediaDiskPath(fileData) : null);

    if (resolvedDiskFile) {
      const mimeType = inferMediaMimeFromExt(resolvedDiskFile);
      const docBlob: Blob =
        typeof (fs as any).openAsBlob === 'function'
          ? await (fs as any).openAsBlob(resolvedDiskFile, { type: mimeType })
          : new Blob([new Uint8Array(await fs.promises.readFile(resolvedDiskFile))], { type: mimeType });
      const formData = new FormData();
      formData.append('chat_id', String(targetChatId));
      if (caption) formData.append('caption', caption);
      if (options?.replyToMessageId) formData.append('reply_to_message_id', String(options.replyToMessageId));
      formData.append('document', docBlob, filename || path.basename(resolvedDiskFile) || 'file.bin');

      const result = await executeTelegramApiWithRetry(
        `https://api.telegram.org/bot${botToken}/sendDocument`,
        { method: 'POST', body: formData },
        options
      );
      if (!result.ok) {
        console.warn(`[Telegram API Error] Telegram sendDocument disk upload failed for ${targetChatId}:`, result.error);
        return null;
      }
      return result.data;
    }

    let buffer: Buffer;
    if (Buffer.isBuffer(fileData)) {
      buffer = fileData;
    } else if (typeof fileData === 'string' && fileData.startsWith('data:')) {
      const base64Data = fileData.split(',')[1] || '';
      buffer = Buffer.from(base64Data, 'base64');
    } else if (typeof fileData === 'string') {
      buffer = Buffer.from(fileData, 'base64');
    } else {
      buffer = Buffer.from([]);
    }

    if (buffer.length === 0) {
      console.warn('[Telegram API Error] Cannot send document: file buffer is empty.');
      await markMessageDeliveryFailed(options?.messageId);
      return null;
    }

    const formData = new FormData();
    formData.append('chat_id', String(targetChatId));
    if (caption) formData.append('caption', caption);
    if (options?.replyToMessageId) formData.append('reply_to_message_id', String(options.replyToMessageId));
    const docBlob = new Blob([new Uint8Array(buffer)]);
    formData.append('document', docBlob, filename || 'file.bin');

    const result = await executeTelegramApiWithRetry(
      `https://api.telegram.org/bot${botToken}/sendDocument`,
      { method: 'POST', body: formData },
      options
    );
    if (!result.ok) {
      console.warn(`[Telegram API Error] Telegram sendDocument failed for ${targetChatId}:`, result.error);
      return null;
    }
    return result.data;
  } catch (err: any) {
    console.warn(`[Telegram Document Send Error]:`, err.message);
    await markMessageDeliveryFailed(options?.messageId);
    return null;
  }
}

// Helper: send voice message back to Telegram Bot API using /sendVoice (strict OGG Opus transcode, no silent sendAudio or text fallback)
export async function sendTelegramVoice(
  chatId: string | number,
  audioData: string | Buffer,
  caption?: string,
  duration?: number,
  options?: TelegramSendOptions
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[Telegram API] Cannot send voice: TELEGRAM_BOT_TOKEN is not configured.');
    await markMessageDeliveryFailed(options?.messageId);
    return null;
  }

  const cleanChatId = String(chatId).replace(/^tg_/, '');
  const numericId = Number(cleanChatId);
  const targetChatId = Number.isSafeInteger(numericId) && !cleanChatId.startsWith('0') ? numericId : cleanChatId;

  try {
    // 1. Remote HTTP/HTTPS URL or direct file_id
    if (typeof audioData === 'string' && (audioData.startsWith('http://') || audioData.startsWith('https://'))) {
      const result = await executeTelegramApiWithRetry(
        `https://api.telegram.org/bot${botToken}/sendVoice`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChatId,
            voice: audioData,
            caption: caption || '',
            duration: duration && duration > 0 ? Math.round(duration) : undefined,
            ...(options?.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
          }),
        },
        options
      );

      if (!result.ok) {
        console.warn(`[Telegram API Error] sendVoice (URL) failed for chat_id ${targetChatId}:`, result.error);
        return null;
      }
      return result.data;
    }

    const resolvedDiskAudio =
      (typeof audioData === 'string' && fs.existsSync(audioData) ? audioData : null) ||
      (typeof audioData === 'string' ? resolveLocalMediaDiskPath(audioData) : null);

    let oggBuffer: Buffer;
    if (resolvedDiskAudio) {
      oggBuffer = await convertAudioToOggOpus(resolvedDiskAudio);
    } else {
      // 2. Base64 data URL, raw base64 string, or Buffer
      let buffer: Buffer;

      if (Buffer.isBuffer(audioData)) {
        buffer = audioData;
      } else if (typeof audioData === 'string' && audioData.startsWith('data:')) {
        const match = audioData.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          buffer = Buffer.from(match[2], 'base64');
        } else {
          buffer = Buffer.from(audioData.replace(/^data:[^;]+;base64,/, ''), 'base64');
        }
      } else if (typeof audioData === 'string') {
        buffer = Buffer.from(audioData, 'base64');
      } else {
        buffer = Buffer.from([]);
      }

      if (buffer.length === 0) {
        console.warn('[Telegram API Error] Cannot send voice: audio buffer is empty.');
        await markMessageDeliveryFailed(options?.messageId);
        return null;
      }

      // Strictly transcode to native OGG Opus format (throws if ffmpeg is missing or fails)
      oggBuffer = await convertAudioToOggOpus(buffer);
    }

    const formData = new FormData();
    formData.append('chat_id', String(targetChatId));
    if (caption) {
      formData.append('caption', caption);
    }
    if (duration && duration > 0) {
      formData.append('duration', String(Math.round(duration)));
    }
    if (options?.replyToMessageId) {
      formData.append('reply_to_message_id', String(options.replyToMessageId));
    }

    const audioBlob = new Blob([new Uint8Array(oggBuffer)], { type: 'audio/ogg' });
    formData.append('voice', audioBlob, 'voice.ogg');

    const voiceResult = await executeTelegramApiWithRetry(
      `https://api.telegram.org/bot${botToken}/sendVoice`,
      {
        method: 'POST',
        body: formData,
      },
      options
    );

    if (!voiceResult.ok) {
      console.warn(`[Telegram API Error] Telegram sendVoice failed for chat_id ${targetChatId}:`, voiceResult.error);
      return null;
    }

    return voiceResult.data;
  } catch (e: any) {
    console.error(`[Telegram API Error] Failed to send voice to ${targetChatId}:`, e.message);
    await markMessageDeliveryFailed(options?.messageId);
    return null;
  }
}

// Helper: generate TTS audio for Telegram voice replies
async function generateTtsAudio(
  text: string,
  voiceName = 'Kore',
  toneStyle = 'Warm, authentic human tone'
): Promise<{ audioUrl: string; duration: number }> {
  const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
  const chosenVoice = allowedVoices.includes(voiceName) ? voiceName : 'Kore';
  const duration = Math.min(Math.max(Math.round(text.length * 0.2), 2), 30);

  if (!isGeminiAvailable()) {
    const circuit = getGeminiCircuitStatus();
    throw new Error(circuit.reason || 'TTS voice generation failed: Gemini API unavailable or unconfigured');
  }

  const ttsModel = resolveGeminiModel(undefined, 'tts');
  let lastError = '';
  try {
    const ai = createGeminiClient();
    const response = await ai.models.generateContent({
      model: ttsModel,
      contents: [
        {
          role: 'user',
          parts: [{ text, speechMetadata: { style: toneStyle || 'Warm, authentic human tone' } }],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: chosenVoice } } },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio && Buffer.from(base64Audio, 'base64').length > 0) {
      return {
        audioUrl: `data:audio/wav;base64,${base64Audio}`,
        duration,
      };
    }
    lastError = `TTS 模型 ${ttsModel} 未返回有效音频数据`;
  } catch (e: any) {
    handleGeminiApiError(`TelegramTTS(${ttsModel})`, e);
    lastError = e?.message || String(e);
  }

  throw new Error(`TTS voice generation failed (${ttsModel}): ${lastError}`);
}

// Helper: Download voice file from Telegram and transcribe via Gemini STT (gemini-3.5-transcribe)
export async function downloadAndTranscribeTelegramVoice(
  fileId: string
): Promise<{ ok: boolean; text: string; audioUrl: string; error?: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !fileId) {
    return {
      ok: false,
      text: '',
      audioUrl: '',
      error: !botToken ? '未配置 TELEGRAM_BOT_TOKEN，无法获取 Telegram 语音文件' : '缺少 Telegram voice file_id',
    };
  }

  try {
    // 1. Get file path from Telegram getFile API
    const fileInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const fileInfo = await fileInfoRes.json();
    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      console.warn(`[Telegram Voice] Failed to get file path for file_id ${fileId}:`, fileInfo);
      return {
        ok: false,
        text: '',
        audioUrl: '',
        error: `Telegram getFile 失败: ${fileInfo?.description || `HTTP ${fileInfoRes.status}`}`,
      };
    }

    const filePath = fileInfo.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    // 2. Download the binary audio data
    const audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) {
      console.warn(`[Telegram Voice] Failed to download audio from ${downloadUrl}, status: ${audioRes.status}`);
      return {
        ok: false,
        text: '',
        audioUrl: '',
        error: `Telegram 语音文件下载失败 (HTTP ${audioRes.status})`,
      };
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      return {
        ok: false,
        text: '',
        audioUrl: '',
        error: '下载到的 Telegram 语音文件为空',
      };
    }
    const base64Audio = buffer.toString('base64');
    const mimeType = filePath.endsWith('.mp3') ? 'audio/mp3' : filePath.endsWith('.wav') ? 'audio/wav' : 'audio/ogg';
    const audioDataUrl = `data:${mimeType};base64,${base64Audio}`;

    // 3. Transcribe using Gemini STT model (strict error propagation, never fake text)
    if (!isGeminiAvailable()) {
      const circuit = getGeminiCircuitStatus();
      return {
        ok: false,
        text: '',
        audioUrl: audioDataUrl,
        error: circuit.reason || '未配置 Gemini API 密钥，无法执行语音转写',
      };
    }

    const sttModel = resolveGeminiModel(undefined, 'transcribe');
    try {
      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: sttModel,
        contents: {
          parts: [
            { inlineData: { mimeType, data: base64Audio } },
            { text: 'Transcribe this voice message accurately into text verbatim. Output only the verbatim transcribed spoken words without markdown, explanation or quotes.' },
          ],
        },
      });

      const transcribedText = response.text?.trim() || '';
      if (!transcribedText) {
        return {
          ok: false,
          text: '',
          audioUrl: audioDataUrl,
          error: `Gemini STT (${sttModel}) 未识别出有效文字内容`,
        };
      }
      return {
        ok: true,
        text: transcribedText,
        audioUrl: audioDataUrl,
      };
    } catch (geminiErr: any) {
      handleGeminiApiError('TelegramVoiceSTT', geminiErr);
      return {
        ok: false,
        text: '',
        audioUrl: audioDataUrl,
        error: `语音转写失败 (${sttModel}): ${geminiErr?.message || String(geminiErr)}`,
      };
    }
  } catch (err: any) {
    console.error(`[Telegram Voice] Failed to process voice file ${fileId}:`, err.message);
    return {
      ok: false,
      text: '',
      audioUrl: '',
      error: `Telegram 语音处理异常: ${err?.message || String(err)}`,
    };
  }
}

// Session-level FIFO serial queue manager to eliminate race conditions, out-of-order replies, and context interleaving
class ChatQueueManager {
  private queues = new Map<string, Array<() => Promise<any>>>();
  private running = new Set<string>();

  /**
   * Enqueues an async task for a given chatId, guaranteeing FIFO sequential execution
   * per chat session while allowing distinct chat sessions to process concurrently.
   */
  public enqueue<T>(chatId: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          const res = await task();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      };

      if (!this.queues.has(chatId)) {
        this.queues.set(chatId, []);
      }
      this.queues.get(chatId)!.push(wrappedTask);

      this.processNext(chatId);
    });
  }

  private async processNext(chatId: string) {
    if (this.running.has(chatId)) return;
    const queue = this.queues.get(chatId);
    if (!queue || queue.length === 0) {
      this.queues.delete(chatId);
      return;
    }

    this.running.add(chatId);
    const nextTask = queue.shift()!;

    try {
      await nextTask();
    } catch (err: any) {
      console.warn(`[ChatQueueManager] Task execution error for chat ${chatId}:`, err?.message || err);
    } finally {
      this.running.delete(chatId);
      const remaining = this.queues.get(chatId);
      if (remaining && remaining.length > 0) {
        setImmediate(() => this.processNext(chatId));
      } else {
        this.queues.delete(chatId);
      }
    }
  }

  public getActiveQueueCount(): number {
    return this.running.size + Array.from(this.queues.values()).reduce((sum, q) => sum + q.length, 0);
  }

  public isChatBusy(chatId: string): boolean {
    return this.running.has(chatId) || (this.queues.get(chatId)?.length ?? 0) > 0;
  }
}

const chatQueueManager = new ChatQueueManager();

// Asynchronous background AI processing for incoming Telegram messages
async function processTelegramMessageAsync(
  chatId: string,
  incomingText: string,
  senderName: string,
  voiceFileId?: string,
  internalMsgId?: string
) {
  try {
    const now = Date.now();
    let effectiveIncomingText = incomingText;

    // 0. If this is a voice message with voiceFileId, download and transcribe it
    if (voiceFileId) {
      console.log(`[Telegram Webhook] Voice message received with file_id: ${voiceFileId}, downloading & transcribing...`);
      const voiceResult = await downloadAndTranscribeTelegramVoice(voiceFileId);
      if (voiceResult.ok && voiceResult.text) {
        effectiveIncomingText = voiceResult.text;
        console.log(`[Telegram Webhook] Voice transcription complete: "${effectiveIncomingText}"`);

        // Update database message record with the real transcribed text and audio URL
        if (internalMsgId) {
          try {
            await db.prepare(`
              UPDATE messages
              SET text = ?,
                  stt_text = ?,
                  audio_url = ?
              WHERE id = ?
            `).run(
              `[语音]: ${effectiveIncomingText}`,
              effectiveIncomingText,
              voiceResult.audioUrl || '',
              internalMsgId
            );
          } catch (dbErr: any) {
            console.warn(`[Telegram Webhook] Failed to update voice message in database:`, dbErr.message);
          }
        }
      } else {
        console.warn(`[Telegram Webhook] Voice download/STT failed (${voiceFileId}):`, voiceResult.error);
        if (internalMsgId) {
          try {
            await db.prepare(`
              UPDATE messages
              SET audio_url = ?,
                  stt_text = ''
              WHERE id = ?
            `).run(voiceResult.audioUrl || '', internalMsgId);
          } catch (dbErr: any) {
            console.warn(`[Telegram Webhook] Failed to persist voice audio_url after STT failure:`, dbErr.message);
          }
        }
        // Do not feed placeholder/failed voice text into auto-translate or AI auto-reply
        return;
      }
    }

    // 0.1 Auto-translate incoming foreign message using user's strictly configured translation engine
    if (internalMsgId && effectiveIncomingText && effectiveIncomingText !== 'Voice Message') {
      try {
        const transSettings = await getServerTranslationSettings();
        if (transSettings?.autoTranslateInbound !== false) {
          const customConfig = await getServerCustomLlmConfig();
          const isPriorityCustom = Boolean(customConfig?.enabled && customConfig?.engineMode === 'custom');
          const configuredEngine = normalizeStrictTranslationEngine(transSettings?.preferredEngine) || 'gemini';
          const engine: 'google' | 'gemini' | 'custom_llm' = isPriorityCustom ? 'custom_llm' : configuredEngine;
          const resolvedCustomModel = isPriorityCustom && configuredEngine !== 'custom_llm'
            ? (customConfig?.modelName || transSettings?.customModelName || 'gpt-4o-mini')
            : (transSettings?.customModelName || customConfig?.modelName);
          const targetLang =
            transSettings?.defaultTargetLang && transSettings.defaultTargetLang !== 'Auto'
              ? transSettings.defaultTargetLang
              : 'Chinese';
          const transRes = await performStrictTranslation({
            text: effectiveIncomingText,
            sourceLang: 'Auto',
            targetLang,
            engine,
            googleApiKey: transSettings?.googleApiKey,
            geminiModel: transSettings?.geminiModel,
            geminiApiKey: transSettings?.geminiApiKey,
            customModelName: resolvedCustomModel,
            customConfig,
            userJwt: lastActiveUserJwt || undefined,
            engineLicenseKey: customConfig?.engineLicenseKey,
          });
          const translatedInbound = transRes.translatedText;
          if (translatedInbound && translatedInbound.toLowerCase() !== effectiveIncomingText.toLowerCase()) {
            await db.prepare(`
              UPDATE messages
              SET translated_text = ?
              WHERE id = ?
            `).run(translatedInbound, internalMsgId);
          }
        }
      } catch (transErr: any) {
        console.warn('[Telegram Webhook] Auto-translating incoming message failed:', transErr.message);
      }
    }

    // 1. Fetch the most recent 15 conversation messages for this chat in chronological order
    const recentMessages = (await db.prepare(`
      SELECT sender, sender_name, text, stt_text, created_at
      FROM (
        SELECT sender, sender_name, text, stt_text, created_at
        FROM messages
        WHERE chat_id = ?
        ORDER BY created_at DESC
        LIMIT 15
      ) sub
      ORDER BY created_at ASC
    `).all(chatId)) as any[];

    // 2. Fetch customer profile or create default profile if not exists (Bot scope)
    let profile = await getScopedCustomerProfile(chatId, 'acc_telegram_bot');
    if (!profile) {
      await upsertScopedCustomerProfile({
        chatId,
        accountId: 'acc_telegram_bot',
        clientName: senderName || `TG用户_${chatId.slice(-4)}`,
        relationshipStage: '初次沟通',
        ageEstimate: '待分析',
        occupation: '待分析',
        locationTimezone: '待确认',
        toneStyle: '待沟通分析',
        likesInterests: JSON.stringify([]),
        dislikesTaboos: JSON.stringify([]),
        emotionalNeeds: '暂无记录（待真实沟通后提炼）',
        keyMemories: JSON.stringify([]),
        totalMessagesCount: 1,
        lastAnalyzedAt: now,
        updatedAt: now,
      });
      profile = await getScopedCustomerProfile(chatId, 'acc_telegram_bot');
    }

    // 3. Assemble full multi-turn conversational history
    const conversationHistory: Array<{ role: 'user' | 'assistant'; text: string; sender: string }> = recentMessages.map((m: any) => {
      const isPeer = m.sender === 'peer';
      const displayText = (m.text === 'Voice Message' || m.text === '[语音消息]') && m.stt_text
        ? `[语音]: ${m.stt_text}`
        : (m.text || m.stt_text || '');
      return {
        role: isPeer ? 'user' : 'assistant',
        text: displayText,
        sender: isPeer ? (m.sender_name || profile?.client_name || '对方') : '我',
      };
    });

    // Ensure current incoming message is the final user turn in history without duplicate
    if (conversationHistory.length === 0 || conversationHistory[conversationHistory.length - 1].text !== effectiveIncomingText) {
      conversationHistory.push({
        role: 'user',
        text: effectiveIncomingText,
        sender: senderName || profile?.client_name || '对方',
      });
    }

    const dialogueTranscript = conversationHistory.map((item) => `${item.sender}: ${item.text}`).join('\n');
    const recentConvoText = conversationHistory.slice(-4).map((m) => m.text).join(' ');

    // 5. Build holographic memory prompt context
    let profileContext = '';
    try {
      const likes = safeJsonParse<string[]>(profile.likes_interests, []);
      const taboos = safeJsonParse<string[]>(profile.dislikes_taboos, []);
      const memories = safeJsonParse<any[]>(profile.key_memories, []);

      profileContext = `
【全息客户画像与长期记忆档案】：
- 客户姓名/称谓: ${profile.client_name}
- 当前关系阶段: ${profile.relationship_stage || '初次结识'}
- 性格与互动特征: ${profile.tone_style || '真实自然、随和礼貌'}
- 核心喜好与兴趣: ${Array.isArray(likes) ? likes.join('、') : ''}
- 敏感雷区与禁忌: ${Array.isArray(taboos) ? taboos.join('、') : ''}
- 核心情感需求: ${profile.emotional_needs || '渴望真诚及时的陪伴与真实人类共鸣'}
- 过往核心共同记忆: ${Array.isArray(memories) ? memories.slice(-3).map((mem: any) => `[${mem.topic || '约定'}]: ${mem.summary || ''}`).join('；') : ''}
`;
    } catch {
      // ignore JSON parse error
    }

    // 6. RAG Knowledge Base Retrieval (Cloud Brain KB if enabled + Local SQL-level RAG — strictly genuine matches only)
    const serverCustomConfig = await getServerCustomLlmConfig();
    let knowledgeContext = '';
    let genuineMatchedKnowledge: any[] = [];
    const combinedText = `${recentConvoText} ${effectiveIncomingText}`.trim();
    if (isCloudKnowledgeBaseEnabled(serverCustomConfig)) {
      let railwayRes: RemoteKbSearchResult;
      try {
        railwayRes = await searchRailwayKnowledgeBase(
          combinedText,
          serverCustomConfig?.knowledgeBaseApiUrl,
          serverCustomConfig?.knowledgeBaseApiKey || serverCustomConfig?.apiKey,
          7000,
          lastActiveUserJwt || undefined,
          serverCustomConfig?.engineLicenseKey
        );
      } catch (kbErr: any) {
        railwayRes = {
          ok: false,
          connected: false,
          context: '',
          matchedCount: 0,
          source: 'remote_cloud_kb_error',
          error: kbErr?.message || '云端知识库检索异常',
          statusCode: 502,
        };
      }
      if (!railwayRes.ok) {
        console.warn(
          `[Telegram Webhook Cloud KB Guard] Chat ${chatId}: 云端知识库检索断连或失败 (${railwayRes.error || '未知网络错误'})，触发安全阻断并保持静默（严禁降级自动回复）`
        );
        return;
      }
      if (railwayRes.matchedCount > 0 && railwayRes.context) {
        knowledgeContext += `\n${railwayRes.context}\n`;
      }
    }
    try {
      const ragResult = await queryKnowledgeRAG(combinedText, 3);
      if (ragResult.matchedCount > 0 && ragResult.context) {
        knowledgeContext += ragResult.context;
        genuineMatchedKnowledge = ragResult.matchedItems;
      }
    } catch (knowErr: any) {
      console.warn('[Telegram Webhook RAG] Knowledge retrieval failed:', knowErr.message);
    }

    // 7. Full Dialogue Transcripts & Authentic Demonstrations
    let transcriptContext = '';
    try {
      const activeTranscripts = (await db.prepare(`
        SELECT id, title, description, dialogue_text, learned_style
        FROM chat_transcripts
        WHERE is_active = 1
        ORDER BY created_at DESC
        LIMIT 2
      `).all()) as any[];

      if (activeTranscripts.length > 0) {
        transcriptContext = `
【核心对话整文实录示范（真人回复习惯范本）】：
${activeTranscripts.map((t, idx) => `
[整文示范 ${idx + 1}]：《${t.title}》
* 提炼说话习惯：${t.learned_style || '自然生活化、简短口语表达'}
* 真实整文示范片段：
${t.dialogue_text.split('\n').slice(-12).join('\n')}
`).join('\n')}
`;
      }
    } catch (transErr: any) {
      console.warn('[Telegram Webhook RAG] Transcript retrieval failed:', transErr.message);
    }

    // 8. Generate intelligent AI response aligned with active Global Persona, Evolution Habits & Custom LLM
    let replyText = '';
    let isImage = false;
    let imageUrl = '';
    let webhookPersonaContext = {
      context: '',
      activeStage: 'icebreaker',
      activeHabitIds: [] as string[],
      activeHabitItems: [] as any[],
      hasConfiguredPersona: false,
    };
    try {
      const globalPersona = await getGlobalPersonaFromDb();
      const webhookEvo = await getEvolutionStateFromDb();
      webhookPersonaContext = buildActivePersonaAndEvolutionContext(globalPersona, webhookEvo, undefined, 3);
    } catch {}
    const webhookHabitIds = webhookPersonaContext.activeHabitIds;

    let webhookTargetLangCode = detectSourceLangCode(effectiveIncomingText);
    if ((!webhookTargetLangCode || webhookTargetLangCode === 'zh-CN') && profile?.location_timezone) {
      const tz = String(profile.location_timezone).toLowerCase();
      if (tz.includes('istanbul') || tz.includes('turkey') || tz.includes('土耳其')) webhookTargetLangCode = 'tr';
      else if (tz.includes('moscow') || tz.includes('russia') || tz.includes('俄')) webhookTargetLangCode = 'ru';
      else if (tz.includes('utc+') || tz.includes('london') || tz.includes('america')) webhookTargetLangCode = 'en';
    }
    const webhookLangConstraint = (webhookTargetLangCode && webhookTargetLangCode !== 'zh-CN')
      ? `\n【母语强制约束】：检测到对方当前发送的消息语言为 ${webhookTargetLangCode}。你必须 100% 严格使用地道纯正的对应母语回复对方，绝不允许漂移为中文！`
      : '';

    const webhookSystemPrompt = `${
      webhookPersonaContext.hasConfiguredPersona
        ? webhookPersonaContext.context
        : '你是一位真诚自然、高效有温度的 Telegram 沟通助手。'
    }${
      !webhookPersonaContext.hasConfiguredPersona && webhookPersonaContext.context
        ? `\n\n${webhookPersonaContext.context}`
        : ''
    }
${profileContext}
${knowledgeContext}
${transcriptContext}${webhookLangConstraint}
【回复核心准则】：
1. 【多轮上下文与真人感】：结合多轮历史对话与客户真实需求，使用自然短句回复，避免 AI 机械客服腔调或 1.2.3. 分点列项。
2. 【专业与真诚】：针对业务或日常交流提供清晰真诚的回应，绝不说“作为AI”。
3. 【同语种地道原则】：若对方最新发送的消息是外语，使用同语种回复。`;

    const webhookPromptText = `【历史多轮连续对话记录】：
${dialogueTranscript}

对方最新发送的消息: "${effectiveIncomingText}"
请直接回复最新一条消息：`;

    if (serverCustomConfig?.enabled) {
      try {
        const customReply = await callCustomLlm({
          customConfig: serverCustomConfig,
          systemInstruction: webhookSystemPrompt,
          messages: [{ role: 'user', content: webhookPromptText }],
          temperature: 0.7,
          maxTokens: 500,
          userJwt: lastActiveUserJwt || undefined,
          skipSync: true,
        });
        if (customReply?.trim()) {
          replyText = customReply.trim();
        }
      } catch (err: any) {
        console.warn('[Telegram Webhook Custom LLM Guard]: 自定义大模型失败，严格保持静默（严禁切回 Gemini）:', err?.message || err);
      }
    } else if (isGeminiAvailable()) {
      const targetModel = resolveGeminiModel(serverCustomConfig?.geminiModel, 'chat');
      try {
        const ai = createGeminiClient();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini Telegram generation timeout')), 8000)
        );

        const response = await Promise.race([
          ai.models.generateContent({
            model: targetModel,
            contents: webhookPromptText,
            config: { systemInstruction: webhookSystemPrompt },
          }),
          timeoutPromise,
        ]);

        replyText = response.text?.trim() || '';
      } catch (err: any) {
        handleGeminiApiError('TelegramPersonaReply', err);
      }
    }

    if (!replyText) {
      // 纯净静默防护：大模型未连通或未返回有效回复时，严格执行静默，绝不生搬硬套知识库文章切片胡乱回复
      console.warn(`[Telegram Webhook Silent Protection] Chat ${chatId}: 大模型未连通或未返回有效回复，触发静默熔断保护，保持静默并等待人工接管`);
      return;
    }

    void incrementEvolutionHabitUsage(webhookHabitIds);

    // 5. Intelligent Voice Routing: Detect if user sent voice or requested voice
    const isVoiceRequested = Boolean(voiceFileId) || /(想听.*声音|发语音|语音|发条语音|说句话|录音|打电话|听听你的声音|voice note|voice message)/i.test(effectiveIncomingText);
    let isReplyVoice = isVoiceRequested && !isImage;
    let replyAudioUrl = '';
    let replyAudioDuration = 0;

    if (isReplyVoice) {
      try {
        console.log(`[Telegram Webhook] Voice requested for chat ${chatId}, synthesizing voice note...`);
        const tts = await generateTtsAudio(replyText, 'Kore', profile?.tone_style || '温柔亲昵，带轻快波浪号和笑意');
        replyAudioUrl = tts.audioUrl;
        replyAudioDuration = tts.duration;
      } catch (ttsErr: any) {
        console.warn('[Telegram Webhook] TTS generation failed, falling back to text:', ttsErr.message);
        isReplyVoice = false;
      }
    }

    // 6. Save AI reply to database (strictly obeying user's configured translation engine)
    let replyTranslatedToChinese = '';
    try {
      if (replyText && !/[\u4e00-\u9fa5]/.test(replyText)) {
        replyTranslatedToChinese = await getCnTranslationIfForeign(replyText);
      }
    } catch {
      // non-fatal
    }

    const replyCreatedAt = Date.now();
    const replyTimestamp = new Date(replyCreatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const replyMsgId = `tg_bot_reply_${replyCreatedAt}`;
    await db.prepare(`
      INSERT INTO messages (
        id, chat_id, account_id, sender, sender_name, text, translated_text,
        is_audio, audio_duration, audio_url, stt_text, voice_tone,
        is_image, image_url, image_caption, timestamp, created_at, delivery_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      replyMsgId,
      chatId,
      'acc_telegram_bot',
      'me',
      'AI 助手',
      replyText,
      replyTranslatedToChinese,
      isReplyVoice ? 1 : 0,
      replyAudioDuration,
      replyAudioUrl,
      isReplyVoice ? replyText : '',
      isReplyVoice ? (profile?.tone_style || '温柔磁性') : '',
      isImage ? 1 : 0,
      imageUrl,
      isImage ? replyText : '',
      replyTimestamp,
      replyCreatedAt,
      'pending'
    );

    // 7. Push message back to Telegram chat with automatic retry and delivery tracking
    let sentBotRes: any = null;
    if (isReplyVoice && replyAudioUrl) {
      sentBotRes = await sendTelegramVoice(chatId, replyAudioUrl, replyText, replyAudioDuration, { messageId: replyMsgId });
      if (sentBotRes) {
        console.log(`[Telegram Webhook] Successfully sent voice note (sendVoice) to chat ${chatId}: duration ${replyAudioDuration}s, caption: "${replyText.slice(0, 30)}..."`);
      } else {
        console.warn(`[Telegram Webhook] Voice reply failed for chat ${chatId} (marked failed, no text fallback)`);
      }
    } else if (isImage && imageUrl) {
      sentBotRes = await sendTelegramPhoto(chatId, imageUrl, replyText, { messageId: replyMsgId });
      if (sentBotRes) {
        console.log(`[Telegram Webhook] Successfully sent photo (sendPhoto) to chat ${chatId}: ${imageUrl} with caption: "${replyText.slice(0, 40)}..."`);
      } else {
        console.warn(`[Telegram Webhook] Photo reply failed for chat ${chatId} (marked failed, no text fallback)`);
      }
    } else {
      sentBotRes = await sendTelegramMessage(chatId, replyText, { messageId: replyMsgId });
      if (sentBotRes) {
        console.log(`[Telegram Webhook] Successfully processed and replied (sendMessage) to chat ${chatId}: "${replyText.slice(0, 40)}..."`);
      } else {
        console.warn(`[Telegram Webhook] Text reply failed for chat ${chatId}`);
      }
    }

    const sentBotTgId = Number(sentBotRes?.result?.message_id) || undefined;
    if (sentBotTgId) {
      try {
        await db.prepare('UPDATE messages SET telegram_message_id = ? WHERE id = ?').run(sentBotTgId, replyMsgId);
      } catch {}
    }

    pushPendingLocalUpdate({
      id: replyMsgId,
      telegramMessageId: sentBotTgId,
      chatId,
      accountId: 'acc_telegram_bot',
      sender: 'me',
      senderName: 'AI 助手',
      text: replyText,
      translatedText: replyTranslatedToChinese,
      timestamp: replyTimestamp,
      createdAt: replyCreatedAt,
      isAudio: isReplyVoice,
      audioDuration: replyAudioDuration,
      audioUrl: replyAudioUrl,
      sttText: isReplyVoice ? replyText : undefined,
      isImage,
      imageUrl,
      imageCaption: isImage ? replyText : undefined,
    });
  } catch (error: any) {
    console.error('[Telegram Webhook] Async processing failed:', error);
  }
}

// Shared processor for incoming Telegram Bot updates (used by both Webhook & desktop getUpdates long-polling)
async function processIncomingBotUpdate(
  update: any
): Promise<{ ok: boolean; duplicate?: boolean; ignored?: boolean; reason?: string; update_id?: number; chat_id?: string; message_id?: number; queued?: boolean }> {
  const updateId = Number(update?.update_id);
  if (!updateId) {
    return { ok: false, reason: 'Missing update_id' };
  }

  if (isDuplicateUpdate(updateId)) {
    console.log(`[Telegram Bot Update] Ignored duplicate update_id: ${updateId}`);
    return { ok: true, duplicate: true, update_id: updateId };
  }

  const isEditedUpdate = Boolean(update.edited_message);
  const msg = update.message || update.edited_message || update.channel_post;
  if (!msg) {
    return { ok: true, ignored: true, reason: 'No message in update', update_id: updateId };
  }

  const tgChatId = `tg_${msg.chat?.id}`;
  const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || `TG用户_${msg.chat?.id}`;
  const isAudio = Boolean(msg.voice || msg.audio);
  const voiceFileId = msg.voice?.file_id || msg.audio?.file_id || '';
  const audioDuration = msg.voice?.duration || msg.audio?.duration || 0;
  const isVideo = Boolean(msg.video || msg.video_note);
  const videoDuration = msg.video?.duration || msg.video_note?.duration || 0;
  const isImage = Boolean(msg.photo && msg.photo.length > 0);
  const now = Date.now();
  const internalMsgId = `tg_${msg.message_id}_${updateId}`;

  let textContent = msg.text || msg.caption;
  if (!textContent) {
    if (isAudio) {
      textContent = '[语音消息]';
    } else if (isVideo) {
      textContent = '[视频消息]';
    } else if (isImage) {
      textContent = '[图片消息]';
    } else {
      textContent = '[多媒体消息]';
    }
  }

  const incomingMsgTimestamp = new Date(msg.date ? msg.date * 1000 : now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const incomingTgMsgId = Number(msg.message_id) || null;

  if (isEditedUpdate && incomingTgMsgId) {
    try {
      await db
        .prepare('UPDATE messages SET text = ?, is_edited = 1 WHERE chat_id = ? AND account_id = ? AND telegram_message_id = ?')
        .run(textContent, tgChatId, 'acc_telegram_bot', incomingTgMsgId);
    } catch {}
    pushPendingLocalUpdate({
      id: `bot_edit_${tgChatId}_${incomingTgMsgId}_${updateId}`,
      type: 'edit',
      telegramMessageId: incomingTgMsgId,
      chatId: tgChatId,
      accountId: 'acc_telegram_bot',
      sender: 'peer',
      senderName,
      text: textContent,
      timestamp: incomingMsgTimestamp,
      createdAt: now,
      isEdited: true,
    });
    return {
      ok: true,
      update_id: updateId,
      chat_id: tgChatId,
      message_id: msg.message_id,
      queued: false,
    };
  }

  await db.prepare(`
    INSERT OR REPLACE INTO messages (
      id, chat_id, account_id, sender, sender_name, text, translated_text,
      is_audio, audio_duration, audio_url, stt_text, voice_tone,
      is_image, image_url, image_caption,
      is_video, video_url, video_duration,
      timestamp, created_at, telegram_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    internalMsgId,
    tgChatId,
    'acc_telegram_bot',
    'peer',
    senderName,
    textContent,
    '',
    isAudio ? 1 : 0,
    audioDuration,
    '',
    '',
    '',
    isImage ? 1 : 0,
    '',
    isImage ? (msg.caption || '') : '',
    isVideo ? 1 : 0,
    '',
    videoDuration,
    incomingMsgTimestamp,
    now,
    incomingTgMsgId
  );

  pushPendingLocalUpdate({
    id: internalMsgId,
    telegramMessageId: incomingTgMsgId ?? undefined,
    chatId: tgChatId,
    accountId: 'acc_telegram_bot',
    sender: 'peer',
    senderName,
    text: textContent,
    timestamp: incomingMsgTimestamp,
    createdAt: now,
    isAudio,
    audioDuration,
    isImage,
    imageCaption: isImage ? (msg.caption || '') : undefined,
    isVideo,
    videoDuration,
  });

  await db.prepare(`
    INSERT INTO customer_profiles (
      chat_id, account_id, client_name, relationship_stage, total_messages_count, updated_at
    ) VALUES (?, ?, ?, '初次结识', 1, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      total_messages_count = total_messages_count + 1,
      updated_at = excluded.updated_at
  `).run(tgChatId, 'acc_telegram_bot', senderName, now);

  setImmediate(() => {
    chatQueueManager
      .enqueue(tgChatId, async () => {
        await processTelegramMessageAsync(tgChatId, textContent, senderName, voiceFileId, internalMsgId);
      })
      .catch((err) => {
        console.error(`[Telegram Bot Queue] Background dispatch failed for chat ${tgChatId}:`, err);
      });
  });

  return {
    ok: true,
    update_id: updateId,
    chat_id: tgChatId,
    message_id: msg.message_id,
    queued: true,
  };
}

let isBotPollingStarted = false;
async function startTelegramBotLongPolling() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || isBotPollingStarted) return;
  if (process.env.TELEGRAM_AUTO_REGISTER_WEBHOOK === 'true' || process.env.AUTO_REGISTER_WEBHOOK === 'true') {
    return;
  }
  isBotPollingStarted = true;
  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const infoJson: any = await infoRes.json().catch(() => null);
    if (infoJson?.ok && infoJson?.result?.url) {
      console.log(`[Telegram Bot Polling] Skipped because active webhook is set: ${infoJson.result.url}`);
      return;
    }
  } catch {
    // Proceed to poll only if no webhook configured
  }

  console.log('[Telegram Bot Polling] Started desktop getUpdates long-polling loop.');
  let offset = 0;
  const pollLoop = async () => {
    while (isBotPollingStarted) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=20&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'edited_message', 'channel_post']))}`
        );
        if (res.status === 409 || res.status === 401) {
          console.warn(`[Telegram Bot Polling] Stopped due to Telegram API HTTP ${res.status} (webhook active or invalid token).`);
          isBotPollingStarted = false;
          return;
        }
        const data: any = await res.json().catch(() => null);
        if (data?.ok && Array.isArray(data.result)) {
          for (const upd of data.result) {
            if (typeof upd.update_id === 'number' && upd.update_id >= offset) {
              offset = upd.update_id + 1;
            }
            await processIncomingBotUpdate(upd);
          }
        }
      } catch (err: any) {
        console.warn('[Telegram Bot Polling Warning]:', err?.message || err);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };
  void pollLoop();
}

// 12. Telegram Webhook Endpoint
app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
  try {
    // 1. Header Validation: X-Telegram-Bot-Api-Secret-Token (Mandatory signature verification)
    const secretTokenHeader = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    const bearerToken = extractBearerToken(req);
    const jwtConfig = getActiveJwtVerificationConfig();

    const isWebhookAuthorized =
      verifySecretToken(secretTokenHeader, TELEGRAM_WEBHOOK_SECRET) ||
      Boolean(bearerToken && verifyJwtToken(bearerToken, jwtConfig));

    if (!isWebhookAuthorized) {
      console.warn(`[Telegram Webhook] Blocked unauthorized request from ${req.ip || 'unknown'}: missing or invalid X-Telegram-Bot-Api-Secret-Token`);
      return res.status(403).json({
        ok: false,
        error: 'Forbidden: Missing or Invalid X-Telegram-Bot-Api-Secret-Token',
        code: 'WEBHOOK_SECRET_UNAUTHORIZED',
        message: '拒绝访问：Webhook 请求缺少有效签名密钥 (X-Telegram-Bot-Api-Secret-Token)',
      });
    }

    const update = req.body;
    if (!update || typeof update !== 'object') {
      return res.status(400).json({ error: 'Invalid update payload' });
    }
    if (!Number(update.update_id)) {
      return res.status(400).json({ error: 'Missing update_id' });
    }

    const result = await processIncomingBotUpdate(update);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('[Telegram Webhook Error]:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 13. Telegram Webhook Status & Diagnostics endpoint (Protected with requireTenantAuth)
app.get('/api/telegram/webhook/status', requireTenantAuth, (_req: Request, res: Response) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  res.json({
    status: 'active',
    endpoint: '/api/telegram/webhook',
    isBotTokenConfigured: Boolean(botToken),
    isSecretTokenProtected: true,
    isWebhookSecretConfigured,
    isInstanceRandomSecret: !isWebhookSecretConfigured,
    cachedUpdateCount: processedUpdateIds.size,
    dedupTtlSeconds: UPDATE_CACHE_TTL_MS / 1000,
    activeSessionQueues: chatQueueManager.getActiveQueueCount(),
    serverTime: new Date().toISOString(),
  });
});

// 14. Telegram Webhook Registration Endpoint (Protected with requireTenantAuth)
app.post('/api/telegram/webhook/register', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const targetBotToken = req.body.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!targetBotToken) {
      return res.status(400).json({
        ok: false,
        error: 'Missing TELEGRAM_BOT_TOKEN. Please set it in environment variables or provide in request body.',
      });
    }

    // Determine target webhook URL
    let webhookUrl = req.body.webhookUrl || process.env.TELEGRAM_WEBHOOK_URL;
    if (!webhookUrl) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.get('host') || `localhost:${PORT}`;
      webhookUrl = `${proto}://${host}/api/telegram/webhook`;
    }

    // Ensure valid URL syntax
    try {
      const parsed = new URL(webhookUrl);
      if (!parsed.protocol.startsWith('http')) {
        return res.status(400).json({ ok: false, error: 'Invalid Webhook URL protocol (must be http or https)' });
      }
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid Webhook URL syntax' });
    }

    const secretToken = req.body.secretToken ?? process.env.TELEGRAM_WEBHOOK_SECRET;
    const dropPendingUpdates = Boolean(req.body.dropPendingUpdates);

    // Call Telegram setWebhook API
    const payload: Record<string, any> = {
      url: webhookUrl,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query'],
      drop_pending_updates: dropPendingUpdates,
    };
    if (secretToken) {
      payload.secret_token = secretToken;
    }

    console.log(`[Telegram Webhook Register] Registering webhook to Telegram API: ${webhookUrl} (dropPending: ${dropPendingUpdates})`);
    const tgRes = await fetch(`https://api.telegram.org/bot${targetBotToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const tgData = await tgRes.json();

    // Verify registration by calling getWebhookInfo
    let webhookInfo = null;
    try {
      const infoRes = await fetch(`https://api.telegram.org/bot${targetBotToken}/getWebhookInfo`);
      webhookInfo = await infoRes.json();
    } catch (e: any) {
      console.warn('[Telegram Webhook Info Warning]:', e.message);
    }

    if (!tgData.ok) {
      console.error('[Telegram Webhook Register Error]:', tgData);
      return res.status(400).json({
        ok: false,
        error: tgData.description || 'Failed to register webhook with Telegram',
        telegramResponse: tgData,
        webhookUrl,
      });
    }

    console.log('[Telegram Webhook Register] Webhook successfully registered with Telegram:', tgData);
    res.json({
      ok: true,
      message: 'Webhook registered successfully with Telegram API',
      webhookUrl,
      isSecretTokenConfigured: Boolean(secretToken),
      dropPendingUpdates,
      telegramResponse: tgData,
      webhookInfo: webhookInfo?.result || null,
    });
  } catch (err: any) {
    console.error('[Telegram Webhook Register Exception]:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 15. Telegram Webhook Live Info Endpoint (Protected with requireTenantAuth)
app.get('/api/telegram/webhook/info', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const targetBotToken = (req.query.botToken as string) || process.env.TELEGRAM_BOT_TOKEN;
    if (!targetBotToken) {
      return res.status(400).json({
        ok: false,
        error: 'Missing TELEGRAM_BOT_TOKEN. Please set it in environment variables or query parameter.',
      });
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${targetBotToken}/getWebhookInfo`);
    const data = await tgRes.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 16. Telegram Webhook Delete / Reset Endpoint (Protected with requireTenantAuth)
app.post('/api/telegram/webhook/delete', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const targetBotToken = req.body.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!targetBotToken) {
      return res.status(400).json({
        ok: false,
        error: 'Missing TELEGRAM_BOT_TOKEN. Please set it in environment variables.',
      });
    }

    const dropPendingUpdates = Boolean(req.body.dropPendingUpdates);
    const tgRes = await fetch(`https://api.telegram.org/bot${targetBotToken}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: dropPendingUpdates }),
    });
    const data = await tgRes.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 17. Send Voice Message directly to Telegram User (Protected with requireTenantAuth)
app.post('/api/telegram/send-voice', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { chatId, audioUrl, text, caption, duration, messageId } = req.body;
    if (!chatId || !audioUrl) {
      return res.status(400).json({ ok: false, error: 'chatId and audioUrl are required' });
    }

    const result = await sendTelegramVoice(chatId, audioUrl, caption || text, duration, { messageId });
    if (!result || !result.ok) {
      return res.status(502).json({ ok: false, error: result?.description || 'Failed to send voice to Telegram', result });
    }

    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== REAL TELEGRAM USER ACCOUNT LOGIN (MTPROTO / GRAMJS) ====================

// Cache active personal MTProto clients
interface PendingUserClient {
  client: TelegramClient;
  phone: string;
  phoneCodeHash?: string;
  apiId: number;
  apiHash: string;
  createdAt: number;
  timeoutTimer?: NodeJS.Timeout;
  needsPassword?: boolean;
}

const activeUserClients = new Map<string, PendingUserClient>();

// CLOUD_AUTH_BASE_URL defined near top of file so getRailwayBrainBaseUrl() routes through Cloudflare Worker without TDZ.

export type TelegramCredentialSource = 'request' | 'custom' | 'env' | 'cloud_authorized' | 'cloud_offline_grace' | 'none';

export interface ResolvedTelegramCredentials {
  ok: boolean;
  apiId?: number;
  apiHash?: string;
  source: TelegramCredentialSource;
  poolLabel?: string;
  isOfflineGrace?: boolean;
  code?: string;
  error?: string;
}

export function maskTelegramApiHash(hash: string): string {
  const clean = String(hash || '').trim();
  if (!clean) return '';
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}

export function getEnvTelegramApiCredentials(): { apiId: number; apiHash: string } | null {
  const idNum = Number(process.env.TELEGRAM_API_ID);
  const hashStr = String(process.env.TELEGRAM_API_HASH || '').trim();
  if (Number.isInteger(idNum) && idNum > 0 && hashStr) {
    return { apiId: idNum, apiHash: hashStr };
  }
  return null;
}

// Strict volatile RAM-only cache for cloud-distributed Telegram API credentials (never written to SQLite/frontend)
interface InMemoryCloudTelegramCredentials {
  apiId: number;
  apiHash: string;
  source: 'cloud_authorized' | 'cloud_offline_grace';
  poolLabel?: string;
  fetchedAt: number;
}
const CLOUD_CREDS_RAM_TTL_MS = 12 * 60 * 60 * 1000;
const OFFLINE_GRACE_CREDS_MAX_TTL_MS = 24 * 60 * 60 * 1000;
const inMemoryCloudTelegramCreds = new Map<string, InMemoryCloudTelegramCredentials>();
let lastCloudCredsError: { code?: string; error: string; isAuthRejection?: boolean; at: number } | null = null;

function getOfflineGraceCredsFilePath(): string {
  return path.join(dbDir, '.tg_creds_grace.enc');
}

function deriveOfflineGraceEncryptionKey(deviceId: string): Buffer {
  return crypto
    .createHash('sha256')
    .update(`${RAW_SESSION_KEY}::${deviceId}::hs_tg_offline_grace_v1`)
    .digest();
}

export function clearOfflineGraceTelegramCredentials(): void {
  try {
    const filePath = getOfflineGraceCredsFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

export function writeOfflineGraceTelegramCredentials(params: {
  bearerToken: string;
  apiId: number;
  apiHash: string;
  poolLabel?: string;
}): void {
  try {
    const cleanToken = String(params.bearerToken || '').trim();
    if (!cleanToken) return;
    // Strictly require a locally verified JWT matching hardware deviceId & unexpired VIP before persisting offline grace cache
    const verified = verifyJwtTokenWithReason(cleanToken);
    if (!verified.valid || !verified.payload) return;

    const now = Date.now();
    const deviceId = getLocalMachineDeviceId();
    const jwtExpMs = normalizeEpochMs(verified.payload.exp) ?? (now + OFFLINE_GRACE_CREDS_MAX_TTL_MS);
    const vipExpMs =
      normalizeEpochMs(verified.payload.vipExpiresAt) ??
      normalizeEpochMs(verified.payload.planExpiresAt) ??
      normalizeEpochMs(verified.payload.vip_expires_at) ??
      normalizeEpochMs(verified.payload.expiresAt) ??
      jwtExpMs;

    const expiresAt = Math.min(now + OFFLINE_GRACE_CREDS_MAX_TTL_MS, jwtExpMs, vipExpMs);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return;

    const userId = String(
      verified.payload.sub || verified.payload.userId || verified.payload.id || verified.payload.username || ''
    ).trim();
    const payloadJson = JSON.stringify({
      v: 1,
      apiId: params.apiId,
      apiHash: params.apiHash,
      poolLabel: params.poolLabel,
      deviceId,
      userId,
      tokenDigest: getCloudCredsCacheKey(cleanToken),
      cachedAt: now,
      expiresAt,
    });

    const key = deriveOfflineGraceEncryptionKey(deviceId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(payloadJson, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const envelope = `grace:gcm:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;

    const filePath = getOfflineGraceCredsFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, envelope, { encoding: 'utf8', mode: 0o600 });
  } catch {}
}

export function readOfflineGraceTelegramCredentials(bearerToken?: string): {
  apiId: number;
  apiHash: string;
  poolLabel?: string;
  expiresAt: number;
} | null {
  try {
    const cleanToken = String(bearerToken || '').trim();
    if (!cleanToken || isJwtTokenRevoked(cleanToken)) return null;

    const verified = verifyJwtTokenWithReason(cleanToken);
    if (!verified.valid || !verified.payload) return null;

    const filePath = getOfflineGraceCredsFilePath();
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw.startsWith('grace:gcm:')) return null;

    const parts = raw.split(':');
    if (parts.length !== 5) return null;
    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const cipherText = Buffer.from(parts[4], 'hex');
    const deviceId = getLocalMachineDeviceId();
    const key = deriveOfflineGraceEncryptionKey(deviceId);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain);

    const now = Date.now();
    if (!parsed || parsed.v !== 1) return null;
    if (String(parsed.deviceId || '') !== deviceId) return null;
    if (!Number.isFinite(parsed.expiresAt) || now >= Number(parsed.expiresAt)) {
      clearOfflineGraceTelegramCredentials();
      return null;
    }

    const tokenUserId = String(
      verified.payload.sub || verified.payload.userId || verified.payload.id || verified.payload.username || ''
    ).trim();
    const tokenDigest = getCloudCredsCacheKey(cleanToken);
    const userMatches =
      (parsed.userId && tokenUserId && String(parsed.userId) === tokenUserId) ||
      String(parsed.tokenDigest || '') === tokenDigest;
    if (!userMatches) return null;

    const apiId = Number(parsed.apiId);
    const apiHash = String(parsed.apiHash || '').trim();
    if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) return null;

    return {
      apiId,
      apiHash,
      poolLabel: parsed.poolLabel ? String(parsed.poolLabel) : undefined,
      expiresAt: Number(parsed.expiresAt),
    };
  } catch {
    return null;
  }
}

export interface TelegramSessionRestoreState {
  inProgress: boolean;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  restoredCount: number;
  lastError: string | null;
}

export const telegramSessionRestoreState: TelegramSessionRestoreState = {
  inProgress: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  restoredCount: 0,
  lastError: null,
};
let activeRestorePromise: Promise<number> | null = null;
let activeRestoreMeta: { hasBearerToken: boolean; forceReconnect: boolean } | null = null;

export interface SystemProxyConfig {
  enabled: boolean;
  type: 'socks5' | 'socks4';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

let cachedSystemProxyConfig: SystemProxyConfig | null = null;

export function parseSocksProxyEnvString(raw?: string | null): SystemProxyConfig | null {
  const val = String(raw || '').trim();
  if (!val) return null;
  try {
    const parsed = new URL(val);
    const proto = parsed.protocol.replace(':', '').toLowerCase();
    if (proto !== 'socks5' && proto !== 'socks4') return null;
    const host = parsed.hostname;
    const port = Number(parsed.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      enabled: true,
      type: proto,
      host,
      port,
      ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
      ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    };
  } catch {
    return null;
  }
}

export function normalizeAndValidateProxyConfig(input: any): { ok: true; config: SystemProxyConfig } | { ok: false; error: string } {
  const enabled = Boolean(input?.enabled);
  const rawType = String(input?.type || 'socks5').toLowerCase().trim();
  const type = rawType === 'socks4' ? 'socks4' : 'socks5';
  const host = String(input?.host || '').trim();
  const port = Number(input?.port);
  const username = typeof input?.username === 'string' && input.username.trim() ? input.username.trim() : undefined;
  const password = typeof input?.password === 'string' && input.password.trim() ? input.password.trim() : undefined;

  if (!enabled) {
    return {
      ok: true,
      config: {
        enabled: false,
        type,
        host,
        port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 1080,
        username,
        password,
      },
    };
  }

  if (rawType !== 'socks5' && rawType !== 'socks4') {
    return { ok: false, error: '当前仅支持 SOCKS5 / SOCKS4 代理协议' };
  }
  if (!host || /\s/.test(host)) {
    return { ok: false, error: '请输入有效的代理服务器地址（如 127.0.0.1）' };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: '请输入有效的代理端口（1 - 65535）' };
  }

  return {
    ok: true,
    config: {
      enabled: true,
      type,
      host,
      port,
      username,
      password,
    },
  };
}

export async function loadSystemProxyConfigFromDb(): Promise<SystemProxyConfig | null> {
  try {
    const row = (await db.prepare("SELECT value FROM system_config WHERE key = 'network_proxy'").get()) as any;
    if (row?.value) {
      const parsed = JSON.parse(String(row.value));
      const validated = normalizeAndValidateProxyConfig(parsed);
      if (validated.ok) {
        cachedSystemProxyConfig = validated.config;
        return cachedSystemProxyConfig;
      }
    }
  } catch {}
  const envProxy = parseSocksProxyEnvString(process.env.TG_SOCKS_PROXY);
  if (envProxy) {
    cachedSystemProxyConfig = envProxy;
    return envProxy;
  }
  cachedSystemProxyConfig = null;
  return null;
}

export async function saveSystemProxyConfigToDb(config: SystemProxyConfig): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('network_proxy', ?, ?)")
    .run(JSON.stringify(config), Date.now());
  cachedSystemProxyConfig = config;
}

export function getConfiguredTelegramProxy():
  | { ip: string; port: number; socksType: 4 | 5; timeout?: number; username?: string; password?: string }
  | undefined {
  const active = cachedSystemProxyConfig || parseSocksProxyEnvString(process.env.TG_SOCKS_PROXY);
  if (!active || !active.enabled || !active.host || !active.port) {
    return undefined;
  }
  return {
    ip: active.host,
    port: active.port,
    socksType: active.type === 'socks4' ? 4 : 5,
    timeout: 15,
    ...(active.username ? { username: active.username } : {}),
    ...(active.password ? { password: active.password } : {}),
  };
}

function getCloudCredsCacheKey(bearerToken?: string): string {
  if (!bearerToken || !bearerToken.trim()) return '__default__';
  return crypto.createHash('sha256').update(bearerToken.trim()).digest('hex').slice(0, 24);
}

export function getInMemoryTelegramApiCredentials(bearerToken?: string): InMemoryCloudTelegramCredentials | null {
  const now = Date.now();
  const key = getCloudCredsCacheKey(bearerToken);
  const entry = inMemoryCloudTelegramCreds.get(key) || (bearerToken ? null : inMemoryCloudTelegramCreds.get('__default__'));
  if (!entry) return null;
  if (now - entry.fetchedAt > CLOUD_CREDS_RAM_TTL_MS) {
    inMemoryCloudTelegramCreds.delete(key);
    return null;
  }
  return entry;
}

export function clearInMemoryTelegramApiCredentials(bearerToken?: string): void {
  if (bearerToken) {
    inMemoryCloudTelegramCreds.delete(getCloudCredsCacheKey(bearerToken));
  } else {
    inMemoryCloudTelegramCreds.clear();
  }
  clearOfflineGraceTelegramCredentials();
}

export async function purgePersistedTelegramApiCredentialsFromDb(): Promise<void> {
  try {
    await db.prepare("DELETE FROM system_config WHERE key = 'telegram_api_credentials'").run();
  } catch {}
  try {
    await db
      .prepare('UPDATE telegram_user_sessions SET api_id = NULL, api_hash = NULL WHERE api_id IS NOT NULL OR api_hash IS NOT NULL')
      .run();
  } catch {}
}

export async function fetchWithSystemProxySupport(
  urlStr: string,
  options: RequestInit = {},
  timeoutMs = 12000
): Promise<globalThis.Response> {
  const parsedUrl = new URL(urlStr);
  const hostname = parsedUrl.hostname;
  const proxy = getConfiguredTelegramProxy();

  // Never route local loopback traffic through external SOCKS proxy
  if (!proxy || isAllowedLocalhostEndpoint(hostname)) {
    return await fetch(urlStr, {
      ...options,
      signal: options.signal || AbortSignal.timeout(timeoutMs),
    });
  }

  const targetPort = parsedUrl.port
    ? Number(parsedUrl.port)
    : parsedUrl.protocol === 'https:'
      ? 443
      : 80;
  const isHttps = parsedUrl.protocol === 'https:';

  const { socket: rawSocket } = await SocksClient.createConnection({
    proxy: {
      host: proxy.ip,
      port: proxy.port,
      type: proxy.socksType,
      ...(proxy.username ? { userId: proxy.username } : {}),
      ...(proxy.password ? { password: proxy.password } : {}),
    },
    command: 'connect',
    destination: {
      host: hostname,
      port: targetPort,
    },
    timeout: timeoutMs,
  });

  const reqHeaders: Record<string, string> = {};
  if (options.headers) {
    const h = new Headers(options.headers);
    h.forEach((v, k) => {
      reqHeaders[k] = v;
    });
  }
  const bodyRaw =
    typeof options.body === 'string'
      ? Buffer.from(options.body, 'utf8')
      : Buffer.isBuffer(options.body)
        ? options.body
        : options.body instanceof Uint8Array
          ? Buffer.from(options.body)
          : undefined;
  if (bodyRaw && !Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-length')) {
    reqHeaders['Content-Length'] = String(bodyRaw.length);
  }
  reqHeaders['Connection'] = 'close';

  return await new Promise<globalThis.Response>((resolve, reject) => {
    let settled = false;
    let activeSocket: net.Socket | tls.TLSSocket = rawSocket;
    const finishErr = (err: any) => {
      if (settled) return;
      settled = true;
      try {
        activeSocket.destroy();
      } catch {}
      try {
        rawSocket.destroy();
      } catch {}
      reject(err);
    };

    const signal = options.signal;
    const onAbort = () => {
      const abortErr: any = new Error('The operation was aborted due to timeout');
      abortErr.name = 'TimeoutError';
      finishErr(abortErr);
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const reqTimer = setTimeout(() => {
      const tErr: any = new Error(`Request timeout (${timeoutMs}ms)`);
      tErr.name = 'TimeoutError';
      finishErr(tErr);
    }, timeoutMs);

    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        hostname,
        port: targetPort,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method || 'GET',
        headers: reqHeaders,
        agent: false,
        createConnection: () => {
          activeSocket = isHttps
            ? tls.connect({ socket: rawSocket, servername: hostname })
            : rawSocket;
          return activeSocket;
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          clearTimeout(reqTimer);
          if (signal) signal.removeEventListener('abort', onAbort);
          if (settled) return;
          settled = true;
          const respHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) {
              v.forEach((item) => respHeaders.append(k, item));
            } else if (typeof v === 'string') {
              respHeaders.set(k, v);
            }
          }
          const fullBuf = Buffer.concat(chunks);
          const status = res.statusCode || 502;
          const responseBody = status === 204 || status === 304 ? null : fullBuf;
          resolve(
            new Response(responseBody, {
              status,
              statusText: res.statusMessage || '',
              headers: respHeaders,
            })
          );
        });
        res.on('error', (err) => {
          clearTimeout(reqTimer);
          if (signal) signal.removeEventListener('abort', onAbort);
          finishErr(err);
        });
      }
    );

    req.on('error', (err) => {
      clearTimeout(reqTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      finishErr(err);
    });

    if (bodyRaw) {
      req.write(bodyRaw);
    }
    req.end();
  });
}

export async function fetchCloudAuthorizedTelegramCredentials(
  bearerToken: string
): Promise<ResolvedTelegramCredentials> {
  if (!bearerToken) {
    const errObj = {
      ok: false as const,
      source: 'none' as const,
      code: 'TELEGRAM_API_CREDENTIALS_REQUIRED',
      error: '尚未登录会员，无法自动分发 Telegram 接入凭据',
    };
    lastCloudCredsError = { code: errObj.code, error: errObj.error, at: Date.now() };
    return errObj;
  }
  try {
    const res = await fetchWithSystemProxySupport(
      `${CLOUD_AUTH_BASE_URL}/api/auth/telegram-credentials`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          deviceId: getLocalMachineDeviceId(),
        }),
      },
      12000
    );
    const data = (await res.json().catch(() => ({}))) as any;
    const apiId = Number(data?.apiId);
    const apiHash = String(data?.apiHash || '').trim();
    if (!res.ok || !data?.ok || !Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
      const code = String(data?.code || 'CLOUD_CREDENTIALS_UNAVAILABLE');
      const isAuthRejection =
        res.status === 401 ||
        res.status === 403 ||
        code === 'VIP_EXPIRED' ||
        code === 'DEVICE_MISMATCH' ||
        code === 'AUTH_SESSION_REVOKED' ||
        code === 'AUTH_SESSION_REQUIRED';
      if (isAuthRejection) {
        clearOfflineGraceTelegramCredentials();
      }
      const errObj = {
        ok: false as const,
        source: 'none' as const,
        code,
        error: data?.error || `云端授权分配接入凭据失败 (HTTP ${res.status})`,
      };
      lastCloudCredsError = { code: errObj.code, error: errObj.error, isAuthRejection, at: Date.now() };
      return errObj;
    }

    // Store in RAM + short-term hardware-fingerprint & valid-JWT encrypted grace cache (never in SQLite or sent to frontend)
    const record: InMemoryCloudTelegramCredentials = {
      apiId,
      apiHash,
      source: 'cloud_authorized',
      poolLabel: data?.poolLabel ? String(data.poolLabel) : undefined,
      fetchedAt: Date.now(),
    };
    inMemoryCloudTelegramCreds.set(getCloudCredsCacheKey(bearerToken), record);
    inMemoryCloudTelegramCreds.set('__default__', record);
    writeOfflineGraceTelegramCredentials({
      bearerToken,
      apiId,
      apiHash,
      poolLabel: record.poolLabel,
    });
    lastCloudCredsError = null;

    return {
      ok: true,
      apiId,
      apiHash,
      source: 'cloud_authorized',
      poolLabel: record.poolLabel,
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || /aborted|timeout/i.test(String(err?.message || ''));
    const errObj = {
      ok: false as const,
      source: 'none' as const,
      code: 'CLOUD_CREDENTIALS_UNAVAILABLE',
      error: isTimeout
        ? '连接云端授权中心超时（12s），请检查本机网络或代理后重试'
        : `连接云端授权中心获取接入凭据失败: ${err?.message || '网络异常'}`,
    };
    lastCloudCredsError = { code: errObj.code, error: errObj.error, isAuthRejection: false, at: Date.now() };
    return errObj;
  }
}

export async function ensureCloudTelegramCredentialsIfNeeded(bearerToken: string): Promise<void> {
  if (getInMemoryTelegramApiCredentials(bearerToken)) return;
  if (getEnvTelegramApiCredentials()) return;
  await resolveTelegramApiCredentials({ bearerToken });
}

export async function resolveTelegramApiCredentials(options: {
  reqApiId?: unknown;
  reqApiHash?: unknown;
  bearerToken?: string;
  forceCloudRefresh?: boolean;
}): Promise<ResolvedTelegramCredentials> {
  if (options.bearerToken) {
    if (!options.forceCloudRefresh) {
      const cachedMem = getInMemoryTelegramApiCredentials(options.bearerToken);
      if (cachedMem) {
        return {
          ok: true,
          apiId: cachedMem.apiId,
          apiHash: cachedMem.apiHash,
          source: cachedMem.source,
          isOfflineGrace: cachedMem.source === 'cloud_offline_grace',
          poolLabel: cachedMem.poolLabel,
        };
      }
    }
    const cloudRes = await fetchCloudAuthorizedTelegramCredentials(options.bearerToken);
    if (cloudRes.ok) {
      return cloudRes;
    }

    // Offline grace cache fallback when cloud auth server is temporarily unreachable/offline (never on auth rejection)
    if (!lastCloudCredsError?.isAuthRejection) {
      const grace = readOfflineGraceTelegramCredentials(options.bearerToken);
      if (grace) {
        const record: InMemoryCloudTelegramCredentials = {
          apiId: grace.apiId,
          apiHash: grace.apiHash,
          source: 'cloud_offline_grace',
          poolLabel: grace.poolLabel,
          fetchedAt: Date.now(),
        };
        inMemoryCloudTelegramCreds.set(getCloudCredsCacheKey(options.bearerToken), record);
        inMemoryCloudTelegramCreds.set('__default__', record);
        return {
          ok: true,
          apiId: grace.apiId,
          apiHash: grace.apiHash,
          source: 'cloud_offline_grace',
          isOfflineGrace: true,
          poolLabel: grace.poolLabel,
        };
      }
    }

    const envFallback = getEnvTelegramApiCredentials();
    if (envFallback) {
      return {
        ok: true,
        apiId: envFallback.apiId,
        apiHash: envFallback.apiHash,
        source: 'env',
      };
    }
    return cloudRes;
  }

  const cachedDefault = !options.forceCloudRefresh ? getInMemoryTelegramApiCredentials() : null;
  if (cachedDefault) {
    return {
      ok: true,
      apiId: cachedDefault.apiId,
      apiHash: cachedDefault.apiHash,
      source: cachedDefault.source,
      isOfflineGrace: cachedDefault.source === 'cloud_offline_grace',
      poolLabel: cachedDefault.poolLabel,
    };
  }

  if (lastActiveUserJwt) {
    const graceFromLastJwt = readOfflineGraceTelegramCredentials(lastActiveUserJwt);
    if (graceFromLastJwt) {
      return {
        ok: true,
        apiId: graceFromLastJwt.apiId,
        apiHash: graceFromLastJwt.apiHash,
        source: 'cloud_offline_grace',
        isOfflineGrace: true,
        poolLabel: graceFromLastJwt.poolLabel,
      };
    }
  }

  const envCreds = getEnvTelegramApiCredentials();
  if (envCreds) {
    return {
      ok: true,
      apiId: envCreds.apiId,
      apiHash: envCreds.apiHash,
      source: 'env',
    };
  }

  return {
    ok: false,
    source: 'none',
    code: 'TELEGRAM_API_CREDENTIALS_REQUIRED',
    error: '云端暂未为当前会员分发可用的 Telegram 接入凭据，请确认已登录有效会员或联系管理员检查云端凭据池。',
  };
}

// Telegram API Credentials Readiness Status (Strictly boolean only — NEVER exposes apiId or apiHash to browser)
app.get('/api/telegram/credentials/status', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const refresh = req.query.refresh === '1';
    const bearerToken = extractBearerToken(req);
    const resolved = await resolveTelegramApiCredentials({
      bearerToken,
      forceCloudRefresh: refresh,
    });
    return res.json({
      ok: true,
      configured: Boolean(resolved.ok && resolved.apiId && resolved.apiHash),
      source: resolved.ok ? resolved.source : 'none',
      isOfflineGrace: Boolean(resolved.isOfflineGrace),
      cloudSyncError: !resolved.ok ? resolved.error : lastCloudCredsError?.error || undefined,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || '读取凭据状态失败' });
  }
});

// Refresh Mode B cloud-authorized Telegram API credentials in RAM (never stores locally, never returns apiId/apiHash)
app.post('/api/telegram/credentials/sync-cloud', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const bearerToken = extractBearerToken(req);
    if (!bearerToken) {
      return res.status(401).json({ ok: false, error: '缺少会员 Bearer 授权令牌' });
    }
    const cloudRes = await fetchCloudAuthorizedTelegramCredentials(bearerToken);
    if (!cloudRes.ok) {
      return res.status(400).json({
        ok: false,
        code: cloudRes.code,
        error: cloudRes.error,
      });
    }
    // Automatically restore persisted DB sessions once cloud credentials succeed
    void restoreTelegramUserSessionsOnStartup(bearerToken);
    return res.json({
      ok: true,
      configured: true,
      source: 'cloud_authorized',
      message: '已从云端授权中心同步接入状态',
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || '同步云端凭据失败' });
  }
});

// Desktop MTProto Network Proxy Settings (SOCKS5 / SOCKS4)
app.get('/api/system/proxy', requireTenantAuth, async (_req: Request, res: Response) => {
  try {
    const config = await loadSystemProxyConfigFromDb();
    return res.json({
      ok: true,
      config: config
        ? {
            enabled: config.enabled,
            type: config.type,
            host: config.host,
            port: config.port,
            username: config.username || '',
            hasPassword: Boolean(config.password),
          }
        : {
            enabled: false,
            type: 'socks5',
            host: '',
            port: 1080,
            username: '',
            hasPassword: false,
          },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || '读取代理设置失败' });
  }
});

app.post('/api/system/proxy', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const existing = await loadSystemProxyConfigFromDb();
    const incomingPassword = typeof req.body?.password === 'string' ? req.body.password : undefined;
    const preserveExistingPassword =
      req.body?.preservePassword !== false && incomingPassword === undefined && existing?.password;

    const validated = normalizeAndValidateProxyConfig({
      enabled: req.body?.enabled,
      type: req.body?.type,
      host: req.body?.host,
      port: req.body?.port,
      username: req.body?.username,
      password: preserveExistingPassword ? existing?.password : incomingPassword,
    });
    if (!validated.ok) {
      return res.status(400).json({ ok: false, error: validated.error });
    }
    await saveSystemProxyConfigToDb(validated.config);
    let reconnecting = false;
    if (process.env.NODE_ENV !== 'test' && process.env.AIS_TEST_IMPORT !== 'true') {
      const bearerToken = extractBearerToken(req) || lastActiveUserJwt || undefined;
      reconnecting = true;
      void restoreTelegramUserSessionsOnStartup(bearerToken, { forceReconnect: true });
    }
    return res.json({
      ok: true,
      reconnecting,
      config: {
        enabled: validated.config.enabled,
        type: validated.config.type,
        host: validated.config.host,
        port: validated.config.port,
        username: validated.config.username || '',
        hasPassword: Boolean(validated.config.password),
      },
      message: validated.config.enabled
        ? `已保存 ${validated.config.type.toUpperCase()} 代理 (${validated.config.host}:${validated.config.port})，正自动重连活跃 Telegram 会话`
        : '已关闭内置代理并恢复直连，正自动重连活跃 Telegram 会话',
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || '保存代理设置失败' });
  }
});

export interface ExpiredTelegramAccountInfo {
  accountId: string;
  userId?: string;
  phone?: string;
  reason: string;
  expiredAt: number;
}

export const recentlyExpiredAccounts = new Map<string, ExpiredTelegramAccountInfo>();

export function isTelegramSessionExpiredError(err: any): boolean {
  const msg = String(err?.errorMessage || err?.message || err || '').toUpperCase();
  return (
    msg.includes('AUTH_KEY_UNREGISTERED') ||
    msg.includes('AUTH_KEY_INVALID') ||
    msg.includes('AUTH_KEY_PERM_EMPTY') ||
    msg.includes('SESSION_REVOKED') ||
    msg.includes('SESSION_EXPIRED') ||
    msg.includes('USER_DEACTIVATED') ||
    msg.includes('AUTH_KEY_DUPLICATED')
  );
}

export async function withTelegramTimeout<T>(promise: Promise<T>, timeoutMs = 15000, timeoutMessage = '连接 Telegram 服务器超时，请检查网络或代理设置后重试'): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function markTelegramSessionExpired(opts: {
  accountId?: string;
  userId?: string;
  phone?: string;
  reason?: string;
}) {
  const { accountId, userId, phone, reason } = opts;
  const connected = resolveConnectedTelegramUser(accountId, phone, userId);
  const resolvedUserId = userId || connected?.userId || (accountId?.startsWith('acc_tg_') ? accountId.replace(/^acc_tg_/, '') : '');
  const resolvedPhone = phone || connected?.phone || '';
  const resolvedAccountId = accountId || (resolvedUserId ? `acc_tg_${resolvedUserId}` : resolvedPhone);

  if (connected) {
    connectedUserClients.delete(connected.userId);
    connectedUserClients.delete(connected.phone);
    connectedUserClients.delete(`acc_tg_${connected.userId}`);
    if (connected.client) {
      await destroyTelegramClientSafely(connected.client);
    }
  }

  if (resolvedPhone || resolvedUserId) {
    const normPhone = resolvedPhone ? normalizePhoneNumber(resolvedPhone) : '';
    const expiredReasonText = reason || 'Telegram 会话已失效或在其他设备注销';
    try {
      await db
        .prepare("UPDATE telegram_user_sessions SET is_active = 0, session_string = '', expired_reason = ?, updated_at = ? WHERE phone = ? OR phone = ? OR user_id = ?")
        .run(expiredReasonText, Date.now(), resolvedPhone || '', normPhone || '', resolvedUserId || '');
    } catch {}
  }

  const key = resolvedUserId || resolvedPhone || resolvedAccountId;
  if (key) {
    recentlyExpiredAccounts.set(key, {
      accountId: resolvedAccountId || `acc_tg_${key}`,
      userId: resolvedUserId || undefined,
      phone: resolvedPhone || undefined,
      reason: reason || 'Telegram 会话已失效或在其他设备注销',
      expiredAt: Date.now(),
    });
    const now = Date.now();
    for (const [k, v] of recentlyExpiredAccounts.entries()) {
      if (now - v.expiredAt > 30 * 60 * 1000) {
        recentlyExpiredAccounts.delete(k);
      }
    }
  }
}

async function handleMtprotoRouteError(
  res: Response,
  err: any,
  ctx: { accountId?: string; userId?: string; phone?: string },
  statusWhenNotExpired = 400
) {
  const errMsg = formatTelegramError(err);
  if (isTelegramSessionExpiredError(err)) {
    await markTelegramSessionExpired({
      accountId: ctx.accountId,
      userId: ctx.userId,
      phone: ctx.phone,
      reason: errMsg,
    });
    return res.status(401).json({
      ok: false,
      cloudSynced: false,
      code: 'TELEGRAM_SESSION_EXPIRED',
      error: 'Telegram 登录会话已失效，请重新扫码或验证码登录',
    });
  }
  return res.status(statusWhenNotExpired).json({ ok: false, error: errMsg });
}

function clearExpiredAccountRecord(userId?: string, phone?: string) {
  if (userId) {
    recentlyExpiredAccounts.delete(userId);
    recentlyExpiredAccounts.delete(`acc_tg_${userId}`);
  }
  if (phone) {
    recentlyExpiredAccounts.delete(phone);
    recentlyExpiredAccounts.delete(normalizePhoneNumber(phone));
  }
  if (userId || phone) {
    const normPhone = phone ? normalizePhoneNumber(phone) : '';
    void db
      .prepare('UPDATE telegram_user_sessions SET expired_reason = NULL WHERE phone = ? OR phone = ? OR user_id = ?')
      .run(phone || '', normPhone || '', userId || '')
      .catch(() => {});
  }
}

function configureTelegramClientErrorGuard(
  client: TelegramClient,
  context: string,
  meta?: { userId?: string; phone?: string; accountId?: string }
) {
  try {
    // GramJS LogLevel 'warn' still enables LogLevel.ERROR, which prints raw `Error: TIMEOUT` via console.error in _updateLoop.
    client.setLogLevel('none' as any);
    client.onError = async (err: any) => {
      const msg = String(err?.errorMessage || err?.message || err || '');
      if (isTelegramSessionExpiredError(err)) {
        console.warn(`[Telegram Client Session Expired] (${context}):`, msg);
        await markTelegramSessionExpired({
          accountId: meta?.accountId,
          userId: meta?.userId,
          phone: meta?.phone || (context.startsWith('+') ? context : undefined),
          reason: formatTelegramError(err),
        });
        return;
      }
      if (msg === 'TIMEOUT' || msg.includes('TIMEOUT') || msg.includes('Not connected')) {
        return;
      }
      console.warn(`[Telegram Client Warning] (${context}):`, msg);
    };
  } catch {}
}

async function destroyTelegramClientSafely(client?: TelegramClient | null) {
  if (!client) return;
  try {
    await client.destroy();
  } catch {
    try {
      await client.disconnect();
    } catch {}
  }
}

// Helper to safely disconnect pending user client
async function cleanupPendingUserClient(phone: string) {
  const existing = activeUserClients.get(phone);
  if (existing) {
    if (existing.timeoutTimer) {
      clearTimeout(existing.timeoutTimer);
    }
    await destroyTelegramClientSafely(existing.client);
    activeUserClients.delete(phone);
  }
}

// Format raw Telegram errors into clear, actionable messages
export function formatTelegramError(err: any): string {
  const msg = String(err?.errorMessage || err?.message || '');
  const floodMatch = msg.match(/FLOOD_WAIT_(\d+)/i);
  if (floodMatch) {
    const secs = parseInt(floodMatch[1], 10);
    const mins = Math.ceil(secs / 60);
    return `请求过于频繁，Telegram 官方风控限制：请等待 ${mins} 分钟后再试 (${secs} 秒)`;
  }
  if (isTelegramSessionExpiredError(err)) {
    return 'Telegram 登录会话已失效或在其他设备被注销，请重新登录该账号';
  }
  if (msg === 'TIMEOUT' || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return '连接 Telegram 服务器超时或网络异常，请检查网络或代理设置后重试';
  }
  if (msg.includes('PHONE_NUMBER_INVALID')) {
    return '手机号码格式无效，请输入正确的国际手机号码 (例如 +8613800000000)';
  }
  if (msg.includes('PHONE_NUMBER_BANNED')) {
    return '该手机号码已被 Telegram 官方封禁，无法登录';
  }
  if (msg.includes('PHONE_CODE_INVALID')) {
    return '验证码错误，请核对后重新输入';
  }
  if (msg.includes('PHONE_CODE_EXPIRED')) {
    return '验证码已过期，请重新获取';
  }
  if (msg.includes('PASSWORD_HASH_INVALID')) {
    return '当前两步验证密码错误，请核对后重新输入';
  }
  if (msg.includes('NEW_PASSWORD_BAD')) {
    return '新两步验证密码不符合 Telegram 安全要求（例如过于简单或与旧密码冲突），请更换更复杂的密码';
  }
  if (msg.includes('PASSWORD_EMPTY')) {
    return '两步验证密码不能为空';
  }
  if (msg.includes('SRP_ID_INVALID')) {
    return '两步验证安全会话已过期，请重新提交操作';
  }
  if (msg.includes('SRP_PASSWORD_CHANGED')) {
    return '账号两步验证密码已在其他设备变更，请刷新后重试';
  }
  if (msg.includes('EMAIL_INVALID')) {
    return '恢复邮箱格式无效，请输入真实可用的邮箱地址';
  }
  if (msg.includes('EMAIL_NOT_ALLOWED')) {
    return 'Telegram 暂不支持该域名邮箱作为恢复邮箱，请更换常用邮箱';
  }
  if (msg.includes('EMAIL_UNCONFIRMED')) {
    return '恢复邮箱尚未完成验证码确认，请输入发送至该邮箱的验证码或取消绑定';
  }
  if (msg.includes('EMAIL_HASH_EXPIRED')) {
    return '邮箱验证链接或验证码已过期，请点击重新发送验证码';
  }
  if (msg.includes('CODE_INVALID')) {
    return '邮箱验证码错误，请核对后重新输入';
  }
  if (msg.includes('CODE_EXPIRED')) {
    return '邮箱验证码已过期，请重新发送';
  }
  if (msg.includes('PASSWORD_RECOVERY_NA') || msg.includes('PASSWORD_RECOVERY_EXPIRED')) {
    return '未设置有效的恢复邮箱或恢复会话已过期';
  }
  if (msg.includes('SESSION_PASSWORD_NEEDED')) {
    return '该账号开启了两步验证，需要输入云端密码';
  }
  if (msg.includes('PREMIUM_ACCOUNT_REQUIRED') || msg.includes('PRIVACY_PREMIUM_REQUIRED')) {
    return '此高级隐私限制需当前账号具备 Telegram Premium 会员资格才能修改，其他通用安全设置可正常保存';
  }
  if (msg.includes('PRIVACY_KEY_INVALID')) {
    return '当前账号暂不支持修改该项隐私规则';
  }
  return msg || 'Telegram 请求失败，请检查网络或配置';
}

// Robust international phone number standardizer
export function normalizePhoneNumber(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return '+' + cleaned.slice(1).replace(/\D/g, '');
}

// 18. Send Verification Code to Personal Telegram Account
app.post('/api/telegram/user/send-code', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { phone, apiId, apiHash } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ ok: false, error: '请输入正确的国际格式手机号码 (例如: +8613800000000 或 +12125550123)' });
    }

    const cleanPhone = normalizePhoneNumber(phone);
    if (!cleanPhone || cleanPhone.length < 6) {
      return res.status(400).json({ ok: false, error: '手机号码格式无效，请输入正确的国际手机号码 (例如: +8613800000000 或 +12125550123)' });
    }

    const activeUniqueUsers = new Set(Array.from(connectedUserClients.values()).map((u) => u.userId));
    if (hasReachedTelegramAccountLimit(activeUniqueUsers.size) && !connectedUserClients.has(cleanPhone)) {
      return res.status(400).json({
        ok: false,
        error: `已达到单机多账号关联上限（最多同时关联 ${MAX_TELEGRAM_ACCOUNTS} 个账号）。如需添加新账号，请先退出注销闲置账号。`,
      });
    }

    const resolvedCreds = await resolveTelegramApiCredentials({
      bearerToken: extractBearerToken(req),
    });
    if (!resolvedCreds.ok || !resolvedCreds.apiId || !resolvedCreds.apiHash) {
      return res.status(400).json({
        ok: false,
        code: resolvedCreds.code || 'TELEGRAM_API_CREDENTIALS_REQUIRED',
        error: resolvedCreds.error || '云端授权暂未分发 Telegram 接入凭据，请重新登录会员或联系管理员',
      });
    }
    const useApiId = resolvedCreds.apiId;
    const useApiHash = resolvedCreds.apiHash;

    // Disconnect existing client for this phone if any
    await cleanupPendingUserClient(cleanPhone);

    const stringSession = new StringSession('');
    const telegramProxy = getConfiguredTelegramProxy();
    const client = new TelegramClient(stringSession, useApiId, useApiHash, {
      connectionRetries: 5,
      useWSS: false,
      autoReconnect: true,
      deviceModel: 'Telegram Desktop Pro',
      systemVersion: 'Windows 11',
      appVersion: '4.16.8',
      langCode: 'zh-CN',
      systemLangCode: 'zh-CN',
      ...(telegramProxy ? { proxy: telegramProxy } : {}),
    });

    configureTelegramClientErrorGuard(client, cleanPhone);

    console.log(`[Telegram User Auth] Connecting to MTProto DC for ${cleanPhone}...`);
    let sendResult: any;
    try {
      await withTelegramTimeout(
        client.connect(),
        15000,
        '连接 Telegram 服务器超时，请检查网络或代理设置后重试'
      );

      console.log(`[Telegram User Auth] Requesting official login code for ${cleanPhone}...`);
      try {
        sendResult = await withTelegramTimeout(
          client.invoke(
            new Api.auth.SendCode({
              phoneNumber: cleanPhone,
              apiId: useApiId,
              apiHash: useApiHash,
              settings: new Api.CodeSettings({}),
            })
          ),
          15000,
          '发送验证码请求超时，请检查网络后重试'
        );
      } catch (invokeErr: any) {
        if (invokeErr.errorMessage === 'AUTH_RESTART') {
          sendResult = await withTelegramTimeout(
            client.invoke(
              new Api.auth.SendCode({
                phoneNumber: cleanPhone,
                apiId: useApiId,
                apiHash: useApiHash,
                settings: new Api.CodeSettings({}),
              })
            ),
            15000,
            '发送验证码请求超时，请检查网络后重试'
          );
        } else {
          throw invokeErr;
        }
      }
    } catch (sendCodeErr) {
      await destroyTelegramClientSafely(client);
      throw sendCodeErr;
    }

    // Save session string representation so DC migration is preserved
    const sessionString = client.session.save() as unknown as string;
    const phoneCodeHash = sendResult.phoneCodeHash;

    // Auto timeout cleanup timer (10 minutes max for code entry)
    const timeoutTimer = setTimeout(() => {
      console.log(`[Telegram User Auth] Code verification timed out (10 mins) for ${cleanPhone}, releasing connection socket...`);
      cleanupPendingUserClient(cleanPhone);
    }, 10 * 60 * 1000);

    activeUserClients.set(cleanPhone, {
      client,
      phone: cleanPhone,
      phoneCodeHash,
      apiId: useApiId,
      apiHash: useApiHash,
      createdAt: Date.now(),
      timeoutTimer,
    });

    const typeObj = (sendResult.type as any) || {};
    const typeClassName = typeObj.className || typeObj.constructor?.name || '';
    const emailPattern = typeObj.emailPattern || '';

    let deliveryChannel = 'app';
    let deliveryNote = '';

    if (typeClassName.includes('SentCodeTypeApp')) {
      deliveryChannel = 'app';
      deliveryNote = '验证码已发送至您手机/电脑上已登录的官方 Telegram App（请查看官方服务通知「Telegram」会话，官方验证码不会发送到短信）';
    } else if (typeClassName.includes('SentCodeTypeEmailCode')) {
      deliveryChannel = 'email';
      deliveryNote = `验证码已发送至您的绑定邮箱 (${emailPattern || '关联邮箱'})，请查收邮件`;
    } else if (typeClassName.includes('SentCodeTypeSms')) {
      deliveryChannel = 'sms';
      deliveryNote = '验证码已通过国际短信发送至手机号码，请注意查收手机短信（跨国短信可能有 1-2 分钟延迟）';
    } else if (typeClassName.includes('SentCodeTypeCall') || typeClassName.includes('FlashCall')) {
      deliveryChannel = 'call';
      deliveryNote = '验证码将通过电话来电播报或来电号码后几位，请注意接听来电';
    } else if (typeClassName.includes('Fragment')) {
      deliveryChannel = 'fragment';
      deliveryNote = '该号码属于 Fragment 匿名号码，验证码已发送至 fragment.com';
    } else {
      deliveryChannel = typeClassName.toLowerCase().includes('sms') ? 'sms' : 'app';
      deliveryNote = `验证码已发送！方式: ${typeClassName || '官方通道'}`;
    }

    console.log(`[Telegram User Auth] Verification code successfully sent to ${cleanPhone} (DC: ${client.session.dcId}, Channel: ${deliveryChannel}, Type: ${typeClassName}, Source: ${resolvedCreds.source})!`);
    res.json({
      ok: true,
      message: deliveryNote,
      deliveryChannel,
      deliveryType: typeClassName,
      emailPattern,
      timeout: sendResult.timeout || 60,
      phone: cleanPhone,
      phoneCodeHash,
      isCodeViaApp: deliveryChannel === 'app',
      credentialSource: resolvedCreds.source,
    });
  } catch (err: any) {
    console.error('[Telegram User Auth SendCode Error]:', err);
    res.status(400).json({
      ok: false,
      error: formatTelegramError(err),
      code: err.code,
    });
  }
});

// 18.1 Resend Verification Code via SMS / Voice Call
app.post('/api/telegram/user/resend-code', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ ok: false, error: '手机号码为必填项' });
    }
    const cleanPhone = normalizePhoneNumber(phone);
    const userSession = activeUserClients.get(cleanPhone);
    if (!userSession || !userSession.client || !userSession.phoneCodeHash) {
      return res.status(400).json({ ok: false, code: 'TELEGRAM_AUTH_SESSION_EXPIRED', error: '会话已过期，请重新点击发送验证码' });
    }

    console.log(`[Telegram User Auth] Requesting resendCode for ${cleanPhone}...`);
    const resendResult = (await withTelegramTimeout(
      userSession.client.invoke(
        new Api.auth.ResendCode({
          phoneNumber: cleanPhone,
          phoneCodeHash: userSession.phoneCodeHash,
        })
      ),
      15000,
      '重发验证码请求超时，请检查网络后重试'
    )) as any;

    const resendType = resendResult?.type?.className || '';
    let deliveryNote = '重发请求已提交';
    let deliveryChannel = 'sms';
    if (resendType.includes('Sms')) {
      deliveryChannel = 'sms';
      deliveryNote = '已申请通过国际短信重发验证码，请查收手机短信';
    } else if (resendType.includes('Call')) {
      deliveryChannel = 'call';
      deliveryNote = '已申请通过电话呼叫播报验证码，请留意来电';
    }

    res.json({
      ok: true,
      message: deliveryNote,
      deliveryChannel,
      type: resendType,
      timeout: resendResult?.timeout || 60,
    });
  } catch (err: any) {
    console.error('[Telegram User Auth ResendCode Error]:', err);
    const errMsg = String(err?.errorMessage || err?.message || '');
    const isExpired = errMsg.includes('PHONE_CODE_EXPIRED') || isTelegramSessionExpiredError(err);
    if (isExpired && req.body?.phone) {
      await cleanupPendingUserClient(normalizePhoneNumber(req.body.phone));
    }
    res.status(400).json({
      ok: false,
      ...(isExpired ? { code: 'TELEGRAM_AUTH_SESSION_EXPIRED' } : {}),
      error: formatTelegramError(err),
    });
  }
});
// 18.1.1 Cancel Pending Code Verification Auth (Release socket connection immediately)
app.post('/api/telegram/user/cancel-auth', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (phone) {
      const cleanPhone = normalizePhoneNumber(String(phone));
      await cleanupPendingUserClient(cleanPhone);
    }
    res.json({ ok: true, message: '已安全关闭未完成的验证连接' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Cache active QR login sessions
interface QrSessionContext {
  client: TelegramClient;
  sessionId: string;
  token?: Buffer;
  qrUrl?: string;
  expires?: number;
  apiId: number;
  apiHash: string;
  isAuthorized: boolean;
  clientTransferred?: boolean;
  authorizedAt?: number;
  isScanned?: boolean;
  needsPassword?: boolean;
  passwordHint?: string;
  user?: any;
  error?: string;
  createdAt: number;
  pollTimer?: NodeJS.Timeout;
  isStopped?: boolean;
  pollErrorCount?: number;
}

const activeQrSessions = new Map<string, QrSessionContext>();

async function finishQrLogin(sessionObj: QrSessionContext, user: any) {
  console.log(`[Telegram QR Auth] User confirmed scan and authorized: ${user.firstName} (@${user.username || user.id})`);
  const sessionString = sessionObj.client.session.save() as unknown as string;
  const rawPhone = user.phone ? String(user.phone).trim() : '';
  const cleanPhone = rawPhone ? normalizePhoneNumber(rawPhone) : (user.username ? String(user.username).trim() : String(user.id));
  const now = Date.now();

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS telegram_user_sessions (
        phone TEXT PRIMARY KEY,
        session_string TEXT NOT NULL,
        user_id TEXT,
        username TEXT,
        first_name TEXT,
        api_id INTEGER DEFAULT NULL,
        api_hash TEXT DEFAULT NULL,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  } catch {}

  // Deduplicate any stale row for the same Telegram user_id (e.g. un-normalized phone from earlier QR login)
  try {
    await db
      .prepare('DELETE FROM telegram_user_sessions WHERE user_id = ? AND phone != ?')
      .run(String(user.id), cleanPhone);
  } catch {}

  await db.prepare(`
    INSERT OR REPLACE INTO telegram_user_sessions (
      phone, session_string, user_id, username, first_name, api_id, api_hash, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?)
  `).run(
    cleanPhone,
    encryptSensitiveData(sessionString), // Encrypted with AES-256-GCM
    String(user.id),
    user.username || '',
    user.firstName || '',
    now,
    now
  );

  sessionObj.clientTransferred = true;
  sessionObj.authorizedAt = now;
  sessionObj.isAuthorized = true;
  sessionObj.needsPassword = false;
  sessionObj.isScanned = true;
  sessionObj.user = {
    id: String(user.id),
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username ? `@${user.username}` : '',
    phone: user.phone ? (user.phone.startsWith('+') ? user.phone : `+${user.phone}`) : cleanPhone,
  };

  // Register in-memory connected user client session
  const userConnectedObj: ConnectedTelegramUser = {
    client: sessionObj.client,
    phone: cleanPhone,
    userId: String(user.id),
    username: user.username ? `@${user.username}` : '',
    firstName: user.firstName || 'Telegram 用户',
    lastName: user.lastName || '',
    avatarInitial: (user.firstName || 'TG').slice(0, 2).toUpperCase(),
    avatarBg: '#2481cc',
    apiId: sessionObj.apiId,
    apiHash: sessionObj.apiHash,
    connectedAt: now,
    dialogs: [],
  };

  connectedUserClients.set(String(user.id), userConnectedObj);
  connectedUserClients.set(cleanPhone, userConnectedObj);
  connectedUserClients.set(`acc_tg_${user.id}`, userConnectedObj);
  clearExpiredAccountRecord(String(user.id), cleanPhone);

  configureTelegramClientErrorGuard(sessionObj.client, cleanPhone, {
    userId: String(user.id),
    phone: cleanPhone,
    accountId: `acc_tg_${user.id}`,
  });
  attachTelegramClientMessageListener(sessionObj.client, cleanPhone, String(user.id));

  // Asynchronously sync real dialogs into local memory
  fetchTelegramUserDialogs(sessionObj.client, 150, String(user.id))
    .then((dialogs) => {
      userConnectedObj.dialogs = dialogs;
      console.log(`[Telegram QR Auth] Synced ${dialogs.length} real dialogs into memory for user ${user.id}`);
    })
    .catch((err) => {
      console.warn('[Telegram QR Auth] Dialog fetch note:', err.message);
    });
}

// 18.2 Request Telegram Official QR Code Login Token
app.post('/api/telegram/user/qr-token', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const resolvedCreds = await resolveTelegramApiCredentials({
      bearerToken: extractBearerToken(req),
    });
    if (!resolvedCreds.ok || !resolvedCreds.apiId || !resolvedCreds.apiHash) {
      return res.status(400).json({
        ok: false,
        code: resolvedCreds.code || 'TELEGRAM_API_CREDENTIALS_REQUIRED',
        error: resolvedCreds.error || '云端授权暂未分发 Telegram 接入凭据，请重新登录会员或联系管理员',
      });
    }
    const useApiId = resolvedCreds.apiId;
    const useApiHash = resolvedCreds.apiHash;
    const activeUniqueUsers = new Set(Array.from(connectedUserClients.values()).map((u) => u.userId));
    if (hasReachedTelegramAccountLimit(activeUniqueUsers.size)) {
      return res.status(400).json({
        ok: false,
        error: `已达到单机多账号关联上限（最多同时关联 ${MAX_TELEGRAM_ACCOUNTS} 个账号）。如需添加新账号，请先退出注销闲置账号。`,
      });
    }
    const sessionId = 'qr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Clean up stale QR sessions safely: NEVER destroy a client already transferred to connectedUserClients!
    const now = Date.now();
    for (const [oldId, oldSession] of activeQrSessions.entries()) {
      if (oldSession.isAuthorized || oldSession.clientTransferred) {
        if (now - (oldSession.authorizedAt || oldSession.createdAt) > 15000) {
          if (oldSession.pollTimer) clearTimeout(oldSession.pollTimer);
          activeQrSessions.delete(oldId);
        }
        continue;
      }
      const isStaleUnscanned = now - oldSession.createdAt > 45 * 1000 && !oldSession.isScanned;
      if (isStaleUnscanned || now - oldSession.createdAt > 2 * 60 * 1000 || oldSession.isStopped) {
        if (oldSession.pollTimer) clearTimeout(oldSession.pollTimer);
        oldSession.isStopped = true;
        void destroyTelegramClientSafely(oldSession.client);
        activeQrSessions.delete(oldId);
      }
    }

    const stringSession = new StringSession('');
    const telegramProxy = getConfiguredTelegramProxy();
    const client = new TelegramClient(stringSession, useApiId, useApiHash, {
      connectionRetries: 5,
      useWSS: false,
      autoReconnect: true,
      deviceModel: 'LingXi Context Workstation',
      systemVersion: 'Web/Node',
      appVersion: '10.14.0',
      langCode: 'zh-CN',
      systemLangCode: 'zh-CN',
      ...(telegramProxy ? { proxy: telegramProxy } : {}),
    });
    configureTelegramClientErrorGuard(client, sessionId);
    let exportRes: any;
    try {
      await withTelegramTimeout(
        client.connect(),
        15000,
        '连接 Telegram 服务器超时，请检查网络或代理设置后重试'
      );

      // Export initial login token directly from MTProto
      exportRes = await withTelegramTimeout(
        client.invoke(
          new Api.auth.ExportLoginToken({
            apiId: useApiId,
            apiHash: useApiHash,
            exceptIds: [],
          })
        ),
        15000,
        '生成登录二维码超时，请检查网络后重试'
      );

      if (!(exportRes instanceof Api.auth.LoginToken)) {
        throw new Error('Telegram 未能返回有效的登录 Token');
      }
    } catch (qrInitErr) {
      await destroyTelegramClientSafely(client);
      throw qrInitErr;
    }

    const sessionObj: QrSessionContext = {
      client,
      sessionId,
      apiId: useApiId,
      apiHash: useApiHash,
      token: exportRes.token,
      expires: exportRes.expires,
      qrUrl: `tg://login?token=${exportRes.token.toString('base64url')}`,
      isAuthorized: false,
      createdAt: Date.now(),
      pollErrorCount: 0,
    };
    activeQrSessions.set(sessionId, sessionObj);

    console.log(`[Telegram QR Auth] Generated live QR token for session ${sessionId}, expires at ${exportRes.expires}`);

    // Active MTProto polling loop: checks every 2500ms (2.5s interval to prevent rate limit)
    const checkQrStatusLoop = async () => {
      if (sessionObj.isStopped || sessionObj.isAuthorized || sessionObj.clientTransferred) return;

      try {
        const checkRes = await client.invoke(
          new Api.auth.ExportLoginToken({
            apiId: sessionObj.apiId,
            apiHash: sessionObj.apiHash,
            exceptIds: [],
          })
        );
        sessionObj.pollErrorCount = 0;

        if (checkRes instanceof Api.auth.LoginToken) {
          // Token is alive and still waiting for mobile scan
          sessionObj.token = checkRes.token;
          sessionObj.expires = checkRes.expires;
          sessionObj.qrUrl = `tg://login?token=${checkRes.token.toString('base64url')}`;
        } else if (checkRes instanceof Api.auth.LoginTokenMigrateTo) {
          console.log(`[Telegram QR Auth] Session ${sessionId}: User scanned! Migrating to DC ${checkRes.dcId}...`);
          sessionObj.isScanned = true;
          await client._switchDC(checkRes.dcId);
          try {
            const importRes = await client.invoke(
              new Api.auth.ImportLoginToken({
                token: checkRes.token,
              })
            );
            if (importRes instanceof Api.auth.LoginTokenSuccess && (importRes.authorization as any)?.user) {
              await finishQrLogin(sessionObj, (importRes.authorization as any).user);
              return;
            }
          } catch (importErr: any) {
            if (importErr.errorMessage === 'SESSION_PASSWORD_NEEDED') {
              console.log(`[Telegram QR Auth] Session ${sessionId}: 2FA Password needed after DC migration`);
              sessionObj.needsPassword = true;
              sessionObj.isScanned = true;
              try {
                const pwdInfo = await client.invoke(new Api.account.GetPassword());
                sessionObj.passwordHint = (pwdInfo as any).hint || '';
              } catch { /* ignore */ }
              return;
            }
            throw importErr;
          }
        } else if (checkRes instanceof Api.auth.LoginTokenSuccess && (checkRes.authorization as any)?.user) {
          console.log(`[Telegram QR Auth] Session ${sessionId}: User scanned and authorized successfully!`);
          sessionObj.isScanned = true;
          await finishQrLogin(sessionObj, (checkRes.authorization as any).user);
          return;
        }
      } catch (err: any) {
        if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          console.log(`[Telegram QR Auth] Session ${sessionId}: 2FA Password needed`);
          sessionObj.needsPassword = true;
          sessionObj.isScanned = true;
          try {
            const pwdInfo = await client.invoke(new Api.account.GetPassword());
            sessionObj.passwordHint = (pwdInfo as any).hint || '';
          } catch { /* ignore */ }
          return;
        } else if (err.errorMessage === 'AUTH_TOKEN_EXPIRED') {
          console.log(`[Telegram QR Auth] Session ${sessionId}: Token expired, refreshing...`);
        } else {
          sessionObj.pollErrorCount = (sessionObj.pollErrorCount || 0) + 1;
          console.warn(`[Telegram QR Auth] Session ${sessionId} poll check note (${sessionObj.pollErrorCount}):`, err.message || err);
          if (sessionObj.pollErrorCount >= 8) {
            sessionObj.error = '与 Telegram 服务器通信持续异常，请检查网络或代理后刷新二维码';
            sessionObj.isStopped = true;
            if (sessionObj.pollTimer) clearTimeout(sessionObj.pollTimer);
            if (!sessionObj.isAuthorized && !sessionObj.clientTransferred) {
              void destroyTelegramClientSafely(sessionObj.client);
            }
            return;
          }
        }
      }

      // Schedule next check if still active
      if (!sessionObj.isStopped && !sessionObj.isAuthorized && !sessionObj.clientTransferred && !sessionObj.needsPassword) {
        // Enforce 2 minutes maximum session wait time
        if (Date.now() - sessionObj.createdAt > 2 * 60 * 1000) {
          sessionObj.error = '二维码已超时（2分钟未扫码），已自动断开连接。请刷新重新获取。';
          sessionObj.isStopped = true;
          if (sessionObj.pollTimer) clearTimeout(sessionObj.pollTimer);
          if (!sessionObj.isAuthorized && !sessionObj.clientTransferred) {
            void destroyTelegramClientSafely(sessionObj.client);
            activeQrSessions.delete(sessionId);
          }
          return;
        }
        sessionObj.pollTimer = setTimeout(checkQrStatusLoop, 2500);
      }
    };

    sessionObj.pollTimer = setTimeout(checkQrStatusLoop, 2500);

    res.json({
      ok: true,
      sessionId,
      qrUrl: sessionObj.qrUrl,
      expires: sessionObj.expires,
      expiresIn: sessionObj.expires ? Math.max(5, Math.floor(sessionObj.expires - Date.now() / 1000)) : 30,
      message: '请使用手机 Telegram App 扫码关联登录',
    });
  } catch (err: any) {
    console.error('[Telegram QR Auth Error]:', err);
    res.status(400).json({
      ok: false,
      error: formatTelegramError(err),
    });
  }
});

// 18.2.1 Immediately Cancel QR Session and Disconnect Socket (only if not yet authorized/transferred)
app.post('/api/telegram/user/cancel-qr', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    if (sessionId && activeQrSessions.has(sessionId)) {
      const sessionObj = activeQrSessions.get(sessionId)!;
      sessionObj.isStopped = true;
      if (sessionObj.pollTimer) {
        clearTimeout(sessionObj.pollTimer);
      }
      if (!sessionObj.isAuthorized && !sessionObj.clientTransferred) {
        await destroyTelegramClientSafely(sessionObj.client);
      }
      activeQrSessions.delete(sessionId);
      console.log(`[Telegram QR Auth] Session ${sessionId} cancelled (transferred=${Boolean(sessionObj.clientTransferred)}).`);
    }
    res.json({ ok: true, message: '二维码轮询已终止' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 18.3 Check QR Code Scan & Authorization Status
app.get('/api/telegram/user/qr-status', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId || !activeQrSessions.has(sessionId)) {
      return res.status(400).json({ ok: false, error: '二维码已失效，请刷新重新获取' });
    }

    const session = activeQrSessions.get(sessionId)!;

    if (session.isAuthorized && session.user) {
      return res.json({
        ok: true,
        isAuthorized: true,
        user: session.user,
      });
    }

    if (session.needsPassword) {
      return res.json({
        ok: true,
        isAuthorized: false,
        needsPassword: true,
        passwordHint: session.passwordHint || '',
        message: '您的账号开启了 2FA 云端密码，请输入两步验证密码完成登录',
      });
    }

    if (session.error) {
      return res.json({
        ok: false,
        error: session.error,
      });
    }

    res.json({
      ok: true,
      isAuthorized: false,
      isScanned: session.isScanned || false,
      waitingForScan: !session.isScanned,
      qrUrl: session.qrUrl,
      expires: session.expires,
      expiresIn: session.expires ? Math.max(0, Math.floor(session.expires - Date.now() / 1000)) : 30,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, isAuthorized: false, error: err?.message || '二维码状态检测异常，请稍后重试' });
  }
});

// 18.4 Submit 2FA Password for QR Code Login (Protected with authAttemptLimiter)
app.post('/api/telegram/user/qr-password', requireTenantAuth, authAttemptLimiter, async (req: Request, res: Response) => {
  try {
    const { sessionId, password } = req.body;
    if (!sessionId || !activeQrSessions.has(sessionId)) {
      return res.status(400).json({ ok: false, error: '二维码会话已过期，请重新扫码' });
    }

    const session = activeQrSessions.get(sessionId)!;
    if (!session.needsPassword) {
      return res.status(400).json({ ok: false, error: '当前会话无需输入两步验证密码' });
    }

    const cleanPwd = String(password || '').trim();
    if (!cleanPwd) {
      return res.status(400).json({ ok: false, error: '请输入两步验证密码' });
    }

    console.log(`[Telegram QR Auth] Checking 2FA password for session ${sessionId}...`);
    const pwdRes = await withTelegramTimeout(
      session.client.invoke(new Api.account.GetPassword()),
      15000,
      '两步验证请求超时，请检查网络后重试'
    );
    const pwdCheck = await computeCheck(pwdRes, cleanPwd);
    const authRes = await withTelegramTimeout(
      session.client.invoke(new Api.auth.CheckPassword({ password: pwdCheck })),
      15000,
      '两步验证密码校验超时，请检查网络后重试'
    );

    if (authRes && (authRes as any).user) {
      await finishQrLogin(session, (authRes as any).user);
      return res.json({
        ok: true,
        isAuthorized: true,
        user: session.user,
        message: '两步验证通过，账号已成功关联！',
      });
    }

    throw new Error('两步验证密码未能完成鉴权');
  } catch (err: any) {
    console.error(`[Telegram QR Auth] 2FA Password Error:`, err);
    res.status(400).json({
      ok: false,
      error: err.errorMessage === 'PASSWORD_HASH_INVALID' ? '两步验证密码错误，请检查后重新输入' : formatTelegramError(err),
    });
  }
});

// 19. Verify Code and Login Personal Telegram Account (Protected with authAttemptLimiter anti-brute-force)
app.post('/api/telegram/user/verify-code', requireTenantAuth, authAttemptLimiter, async (req: Request, res: Response) => {
  try {
    const { phone, code, password } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ ok: false, error: '手机号和验证码为必填项' });
    }

    const cleanPhone = normalizePhoneNumber(phone);
    const userSession = activeUserClients.get(cleanPhone);
    if (!userSession || !userSession.client) {
      return res.status(400).json({ ok: false, code: 'TELEGRAM_AUTH_SESSION_EXPIRED', error: '会话已过期，请重新点击发送验证码' });
    }

    const { client, phoneCodeHash } = userSession;

    try {
      // If 2FA password was already requested on this active session, skip re-calling SignIn with single-use code
      if (!userSession.needsPassword) {
        console.log(`[Telegram User Auth] Signing in with code for ${cleanPhone}...`);
        await withTelegramTimeout(
          client.invoke(
            new Api.auth.SignIn({
              phoneNumber: cleanPhone,
              phoneCodeHash: phoneCodeHash || '',
              phoneCode: String(code).trim(),
            })
          ),
          15000,
          '验证码校验超时，请检查网络后重试'
        );
      }
    } catch (authErr: any) {
      if (authErr.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        userSession.needsPassword = true;
        if (!password) {
          return res.status(200).json({
            ok: false,
            needsPassword: true,
            message: '该账号开启了两步验证 (2FA Cloud Password)，请输入您的云端两步密码',
          });
        }
      } else {
        throw authErr;
      }
    }

    if (userSession.needsPassword) {
      if (!password) {
        return res.status(200).json({
          ok: false,
          needsPassword: true,
          message: '该账号开启了两步验证 (2FA Cloud Password)，请输入您的云端两步密码',
        });
      }
      console.log(`[Telegram User Auth] Submitting 2FA Cloud password for ${cleanPhone}...`);
      const cleanPwd = String(password || '').trim();
      try {
        const pwdRes = await withTelegramTimeout(
          client.invoke(new Api.account.GetPassword()),
          15000,
          '获取两步验证参数超时，请重试'
        );
        const pwdCheck = await computeCheck(pwdRes, cleanPwd);
        await withTelegramTimeout(
          client.invoke(new Api.auth.CheckPassword({ password: pwdCheck })),
          15000,
          '两步验证校验超时，请重试'
        );
      } catch (pwdErr: any) {
        console.error('[Telegram User Auth] 2FA Password Check Error:', pwdErr);
        if (pwdErr.errorMessage === 'PASSWORD_HASH_INVALID') {
          return res.status(400).json({
            ok: false,
            needsPassword: true,
            error: '两步验证密码错误，请检查后重新输入',
          });
        }
        throw pwdErr;
      }
    }

    // Successfully logged in! Get logged in user details
    const me = (await withTelegramTimeout(client.getMe(), 15000, '读取账号信息超时，请重试')) as any;
    const sessionString = client.session.save() as unknown as string;

    const now = Date.now();
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS telegram_user_sessions (
          phone TEXT PRIMARY KEY,
          session_string TEXT NOT NULL,
          user_id TEXT,
          username TEXT,
          first_name TEXT,
          api_id INTEGER DEFAULT NULL,
          api_hash TEXT DEFAULT NULL,
          is_active INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    } catch {}

    try {
      await db
        .prepare('DELETE FROM telegram_user_sessions WHERE user_id = ? AND phone != ?')
        .run(String(me.id), cleanPhone);
    } catch {}

    await db.prepare(`
      INSERT OR REPLACE INTO telegram_user_sessions (
        phone, session_string, user_id, username, first_name, api_id, api_hash, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?)
    `).run(
      cleanPhone,
      encryptSensitiveData(sessionString), // Encrypted with AES-256-GCM
      String(me.id),
      me.username || '',
      me.firstName || '',
      now,
      now
    );

    // Register in-memory connected user client session
    const userConnectedObj: ConnectedTelegramUser = {
      client,
      phone: cleanPhone,
      userId: String(me.id),
      username: me.username ? `@${me.username}` : '',
      firstName: me.firstName || 'Telegram 用户',
      lastName: me.lastName || '',
      avatarInitial: (me.firstName || 'TG').slice(0, 2).toUpperCase(),
      avatarBg: '#2481cc',
      apiId: userSession.apiId,
      apiHash: userSession.apiHash,
      connectedAt: now,
      dialogs: [],
    };

    connectedUserClients.set(String(me.id), userConnectedObj);
    connectedUserClients.set(cleanPhone, userConnectedObj);
    connectedUserClients.set(`acc_tg_${me.id}`, userConnectedObj);
    clearExpiredAccountRecord(String(me.id), cleanPhone);

    configureTelegramClientErrorGuard(client, cleanPhone, {
      userId: String(me.id),
      phone: cleanPhone,
      accountId: `acc_tg_${me.id}`,
    });
    attachTelegramClientMessageListener(client, cleanPhone, String(me.id));

    fetchTelegramUserDialogs(client, 150, String(me.id))
      .then((dialogs) => {
        userConnectedObj.dialogs = dialogs;
        console.log(`[Telegram User Auth] Synced ${dialogs.length} real dialogs into memory for user ${me.id}`);
      })
      .catch((err) => {
        console.warn('[Telegram User Auth] Dialog fetch note:', err.message);
      });

    if (userSession.timeoutTimer) clearTimeout(userSession.timeoutTimer);
    activeUserClients.delete(cleanPhone);

    console.log(`[Telegram User Auth] User successfully logged in: ${me.firstName} (@${me.username || me.id})`);

    res.json({
      ok: true,
      message: '个人真实电报账号授权登录成功！',
      user: {
        id: String(me.id),
        firstName: me.firstName,
        lastName: me.lastName,
        username: me.username ? `@${me.username}` : '',
        phone: cleanPhone,
      },
    });
  } catch (err: any) {
    console.error('[Telegram User Auth Verify Error]:', err);
    const errMsg = String(err?.errorMessage || err?.message || '');
    const isExpired = errMsg.includes('PHONE_CODE_EXPIRED') || isTelegramSessionExpiredError(err);
    if (isExpired && req.body?.phone) {
      await cleanupPendingUserClient(normalizePhoneNumber(req.body.phone));
    }
    res.status(400).json({
      ok: false,
      ...(isExpired ? { code: 'TELEGRAM_AUTH_SESSION_EXPIRED' } : {}),
      error: formatTelegramError(err),
    });
  }
});

// 20. Check Real Telegram Personal Account Login Status
app.get('/api/telegram/user/status', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const bearerToken = extractBearerToken(req);
    const hasCredsInMemory = Boolean(getInMemoryTelegramApiCredentials(bearerToken) || getEnvTelegramApiCredentials());

    let sessionRows: any[] = [];
    try {
      sessionRows = (await db.prepare(`
        SELECT phone, user_id, username, first_name, is_active, updated_at
        FROM telegram_user_sessions
        WHERE is_active = 1
        ORDER BY updated_at DESC
      `).all()) as any[];
    } catch {
      sessionRows = [];
    }

    // Merge in-memory active clients with genuine MTProto socket connected state
    const inMemoryActiveList: any[] = [];
    const seenUserIds = new Set<string>();

    for (const u of connectedUserClients.values()) {
      if (!seenUserIds.has(u.userId)) {
        seenUserIds.add(u.userId);
        const realConnected = Boolean(u.client?.connected);
        inMemoryActiveList.push({
          id: `acc_tg_${u.userId}`,
          phone: u.phone,
          userId: u.userId,
          username: u.username,
          firstName: u.firstName,
          updatedAt: u.connectedAt,
          dialogsCount: u.dialogs.length,
          isInMemoryConnected: true,
          isConnected: realConnected,
          status: realConnected ? 'online' : 'away',
        });
      }
    }

    const defaultOfflineReason = !hasCredsInMemory
      ? lastCloudCredsError?.error || '云端 Telegram 接入凭据尚未同步，请检查网络或代理后重试同步'
      : telegramSessionRestoreState.inProgress
        ? '正在后台恢复本地加密会话，请稍候...'
        : telegramSessionRestoreState.lastError || 'MTProto 连接尚未建立，请点击重新连接';

    for (const r of sessionRows) {
      if (!seenUserIds.has(r.user_id)) {
        seenUserIds.add(r.user_id);
        inMemoryActiveList.push({
          id: `acc_tg_${r.user_id}`,
          phone: r.phone,
          userId: r.user_id,
          username: r.username ? `@${r.username}` : '',
          firstName: r.first_name,
          updatedAt: r.updated_at,
          dialogsCount: 0,
          isInMemoryConnected: false,
          isConnected: false,
          status: 'offline',
          offlineReason: defaultOfflineReason,
        });
      }
    }

    let expiredRows: any[] = [];
    try {
      expiredRows = (await db.prepare(`
        SELECT phone, user_id, expired_reason, updated_at
        FROM telegram_user_sessions
        WHERE is_active = 0 AND expired_reason IS NOT NULL AND TRIM(expired_reason) != ''
        ORDER BY updated_at DESC
      `).all()) as any[];
    } catch {
      expiredRows = [];
    }

    const expiredMap = new Map<string, ExpiredTelegramAccountInfo>();
    for (const row of expiredRows) {
      const uid = row.user_id ? String(row.user_id) : '';
      const accId = uid ? `acc_tg_${uid}` : String(row.phone || '');
      if (accId && !seenUserIds.has(uid)) {
        expiredMap.set(accId, {
          accountId: accId,
          userId: uid || undefined,
          phone: row.phone ? String(row.phone) : undefined,
          reason: String(row.expired_reason || 'Telegram 登录会话已失效，请重新登录'),
          expiredAt: Number(row.updated_at) || Date.now(),
        });
      }
    }
    for (const exp of recentlyExpiredAccounts.values()) {
      const accId = exp.accountId || (exp.userId ? `acc_tg_${exp.userId}` : exp.phone || '');
      if (accId && !seenUserIds.has(exp.userId || '')) {
        expiredMap.set(accId, exp);
      }
    }

    res.json({
      ok: true,
      hasActiveSession: inMemoryActiveList.some((u) => u.isConnected),
      activeUsers: inMemoryActiveList,
      expiredAccounts: Array.from(expiredMap.values()),
      credentialsConfigured: hasCredsInMemory,
      credentialsError: !hasCredsInMemory ? lastCloudCredsError?.error || null : null,
      isRestoringSessions: telegramSessionRestoreState.inProgress,
      restoreError: telegramSessionRestoreState.lastError,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 20.0.1 On-demand Reconnect for Persisted / Offline Telegram Sessions (and sync cloud creds if missing)
app.post('/api/telegram/user/reconnect', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const bearerToken = extractBearerToken(req);
    const forceCredsRefresh = Boolean(req.body?.forceCredsRefresh);
    const forceReconnect = Boolean(req.body?.forceReconnect);
    const creds = await resolveTelegramApiCredentials({
      bearerToken,
      forceCloudRefresh: forceCredsRefresh,
    });
    if (!creds.ok || !creds.apiId || !creds.apiHash) {
      return res.status(400).json({
        ok: false,
        code: creds.code || 'CLOUD_CREDENTIALS_UNAVAILABLE',
        error: creds.error || '未能从云端获取 Telegram 接入凭据，请检查网络后重试',
      });
    }

    await loadSystemProxyConfigFromDb();
    const restoredCount = await restoreTelegramUserSessionsOnStartup(bearerToken, { forceReconnect });
    const activeOnlineCount = Array.from(connectedUserClients.values()).filter((u) => Boolean(u.client?.connected)).length;

    if (telegramSessionRestoreState.lastError && restoredCount === 0 && activeOnlineCount === 0) {
      return res.status(502).json({
        ok: false,
        restoredCount,
        error: telegramSessionRestoreState.lastError,
      });
    }

    return res.json({
      ok: true,
      restoredCount,
      hasActiveSession: activeOnlineCount > 0,
      restoreError: telegramSessionRestoreState.lastError,
      message:
        restoredCount > 0
          ? `已成功恢复 ${restoredCount} 个 Telegram 账号连接`
          : activeOnlineCount > 0
            ? '所有已登录 Telegram 账号均处于在线状态'
            : '当前没有可恢复的离线账号',
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || '重连 Telegram 会话失败' });
  }
});

// 20.1 Fetch Real Dialogs for Connected Telegram Personal Account
app.get('/api/telegram/user/dialogs', requireTenantAuth, async (req: Request, res: Response) => {
  const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string);
  const phone = req.query.phone as string;
  let connected: ConnectedTelegramUser | undefined;
  try {
    if (accountId) {
      const normalized = accountId.replace(/^acc_tg_/, '');
      const exp = recentlyExpiredAccounts.get(normalized) || recentlyExpiredAccounts.get(accountId);
      if (exp) {
        return res.status(401).json({
          ok: false,
          code: 'TELEGRAM_SESSION_EXPIRED',
          dialogs: [],
          error: exp.reason || 'Telegram 登录会话已失效，请重新登录',
        });
      }
    }

    connected =
      (accountId ? connectedUserClients.get(accountId) : undefined) ||
      (phone ? connectedUserClients.get(phone) : undefined);

    if (!connected && accountId) {
      connected = Array.from(connectedUserClients.values()).find(
        (c) => c.userId === accountId || c.phone === accountId || `acc_tg_${c.userId}` === accountId
      );
    }

    // Strict multi-account isolation: only allow default fallback when neither accountId nor phone was requested AND strictly 1 account is connected
    if (!connected && !accountId && !phone && connectedUserClients.size > 0) {
      const uniqueConnected = Array.from(
        new Map(Array.from(connectedUserClients.values()).map((u) => [u.userId, u])).values()
      );
      if (uniqueConnected.length > 1) {
        return res.status(400).json({
          ok: false,
          dialogs: [],
          error: '多账号模式下必须指定 accountId',
        });
      }
      connected = uniqueConnected[0];
    }

    if (!connected || !connected.client) {
      return res.json({
        ok: false,
        dialogs: [],
        message: accountId ? `账号 ${accountId} 尚未连接或已离线` : '当前无活动的个人 Telegram 客户端会话',
      });
    }

    // Refresh dialogs directly from Telegram MTProto
    const dialogs = await fetchTelegramUserDialogs(connected.client, 150, connected.userId);
    connected.dialogs = dialogs;

    res.json({
      ok: true,
      dialogs,
      userId: connected.userId,
      phone: connected.phone,
      isConnected: Boolean(connected.client.connected),
      totalCount: dialogs.length,
    });
  } catch (err: any) {
    if (isTelegramSessionExpiredError(err)) {
      await markTelegramSessionExpired({
        accountId,
        userId: connected?.userId,
        phone: connected?.phone || phone,
        reason: formatTelegramError(err),
      });
      return res.status(401).json({
        ok: false,
        code: 'TELEGRAM_SESSION_EXPIRED',
        error: 'Telegram 登录会话已失效，请重新扫码或验证码登录',
        dialogs: [],
      });
    }
    res.status(500).json({ ok: false, error: formatTelegramError(err), dialogs: [] });
  }
});

// 20.1.1 In-Memory Telegram Contact Avatar Cache (TTL: 1 hour)
const telegramAvatarCache = new Map<string, { buffer: Buffer; mime: string; expiresAt: number }>();

app.get('/api/telegram/user/avatar/:chatId', async (req: Request, res: Response) => {
  try {
    if (!isAllowedClientOrigin(req)) {
      return res.status(403).send('Forbidden');
    }
    if (!verifySignedTelegramResourceRequest(req) && !(req as any).auth) {
      return res.status(401).send('Unauthorized');
    }

    const { chatId } = req.params;
    const cleanId = chatId.replace(/^tg_/, '');
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';

    // 1. Resolve matching active Telegram user client strictly isolated by accountId
    const peer: any = /^-?\d+$/.test(cleanId) ? Number(cleanId) : cleanId;
    const primaryConnected = accountId ? resolveConnectedTelegramUser(accountId) : undefined;
    const candidates: ConnectedTelegramUser[] = [];
    if (primaryConnected) {
      candidates.push(primaryConnected);
    } else if (!accountId) {
      const uniqueConnected = Array.from(
        new Map(Array.from(connectedUserClients.values()).map((u) => [u.userId, u])).values()
      );
      if (uniqueConnected.length > 1) {
        return res.status(400).send('accountId is required in multi-account mode');
      }
      if (uniqueConnected.length === 1) {
        candidates.push(uniqueConnected[0]);
      }
    }
    if (candidates.length === 0) {
      return res.status(404).send('Avatar not found');
    }

    const cacheAccountScope = accountId || `acc_tg_${candidates[0].userId}`;
    const cacheKey = `${cacheAccountScope}:${cleanId}`;
    const now = Date.now();

    // 2. Check in-memory avatar cache strictly scoped by account
    const cached = telegramAvatarCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.setHeader('Content-Type', cached.mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(cached.buffer);
    }

    for (const connected of candidates) {
      if (connected.client) {
        try {
          const photo = await connected.client.downloadProfilePhoto(peer, { isBig: false });
          if (photo && Buffer.isBuffer(photo) && photo.length > 0) {
            telegramAvatarCache.set(cacheKey, {
              buffer: photo,
              mime: 'image/jpeg',
              expiresAt: now + 3600 * 1000,
            });
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'private, max-age=3600');
            return res.send(photo);
          }
        } catch {
          // peer might not exist on this client
        }
      }
    }

    // 3. Avatar not found or user offline
    return res.status(404).send('Avatar not found');
  } catch (err: any) {
    return res.status(404).send('Avatar not found');
  }
});

// 20.1.2 Real Telegram Message Media Proxy Route (Photos, Videos, Voice/Audio, Stickers, Documents with HTTP Range)
const telegramMediaCache = new Map<string, { buffer: Buffer; mime: string; fileName: string; expiresAt: number }>();

function sendMediaBufferResponse(
  req: Request,
  res: Response,
  entry: { buffer: Buffer; mime: string; fileName: string },
  forceDownload: boolean
) {
  const { buffer, mime, fileName } = entry;
  const total = buffer.length;
  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=1800');
  if (forceDownload) {
    const safeName = encodeURIComponent(fileName || 'telegram_file');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
  }

  const rangeHeader = req.headers.range;
  if (rangeHeader && /^bytes=/i.test(rangeHeader)) {
    const match = rangeHeader.replace(/bytes=/i, '').split('-');
    const start = match[0] ? parseInt(match[0], 10) : 0;
    const end = match[1] ? Math.min(parseInt(match[1], 10), total - 1) : total - 1;
    if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && start < total) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      return res.send(buffer.subarray(start, end + 1));
    }
  }

  res.setHeader('Content-Length', String(total));
  return res.send(buffer);
}

app.get('/api/telegram/user/media/:chatId/:msgId', async (req: Request, res: Response) => {
  try {
    if (!isAllowedClientOrigin(req)) {
      return res.status(403).send('Forbidden');
    }
    if (!verifySignedTelegramResourceRequest(req) && !(req as any).auth) {
      return res.status(401).send('Unauthorized');
    }

    const { chatId, msgId } = req.params;
    const tgMsgId = Number(msgId);
    if (!Number.isInteger(tgMsgId) || tgMsgId <= 0) {
      return res.status(400).send('Invalid message ID');
    }

    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const forceDownload = req.query.download === '1' || req.query.download === 'true';
    const wantThumb = req.query.thumb === '1' || req.query.thumb === 'true';
    const cleanChatId = String(chatId || '').replace(/^tg_/, '');

    const primaryConnected = accountId ? resolveConnectedTelegramUser(accountId) : undefined;
    const candidates: ConnectedTelegramUser[] = [];
    if (primaryConnected) {
      candidates.push(primaryConnected);
    } else if (!accountId) {
      const uniqueConnected = Array.from(
        new Map(Array.from(connectedUserClients.values()).map((u) => [u.userId, u])).values()
      );
      if (uniqueConnected.length > 1) {
        return res.status(400).send('accountId is required in multi-account mode');
      }
      if (uniqueConnected.length === 1) {
        candidates.push(uniqueConnected[0]);
      }
    }

    if (candidates.length === 0) {
      return res.status(404).send('No active Telegram client connected');
    }

    const cacheAccountScope = accountId || `acc_tg_${candidates[0].userId}`;
    const cacheKey = `${cacheAccountScope}:${cleanChatId}:${tgMsgId}${wantThumb ? ':thumb' : ''}`;
    const now = Date.now();

    const cached = telegramMediaCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return sendMediaBufferResponse(req, res, cached, forceDownload);
    }

    for (const candidate of candidates) {
      if (!candidate.client) continue;
      try {
        const { inputPeer } = await resolveTelegramInputPeer(candidate.client, chatId, candidate.userId);
        const msgs = await candidate.client.getMessages(inputPeer, { ids: [tgMsgId] });
        const msg: any = msgs?.[0];
        if (!msg || !msg.media) continue;

        const doc: any = msg.media.document;
        const attrs: any[] = Array.isArray(doc?.attributes) ? doc.attributes : [];
        const filenameAttr = attrs.find((a) => a.className === 'DocumentAttributeFilename');
        const audioAttr = attrs.find((a) => a.className === 'DocumentAttributeAudio');
        const videoAttr = attrs.find((a) => a.className === 'DocumentAttributeVideo');
        const stickerAttr = attrs.find((a) => a.className === 'DocumentAttributeSticker');

        let downloaded: Buffer | undefined;
        let mime = String(doc?.mimeType || '').trim();
        let fileName = String(filenameAttr?.fileName || '').trim();

        if (wantThumb && doc && Array.isArray(doc.thumbs) && doc.thumbs.length > 0) {
          const validThumbs = doc.thumbs.filter((t: any) => t && t.className !== 'PhotoPathSize');
          const bestThumb = validThumbs[validThumbs.length - 1];
          if (bestThumb) {
            downloaded = (await candidate.client.downloadMedia(doc, { thumb: bestThumb })) as Buffer;
            mime = 'image/webp';
          }
        }
        if (!downloaded || !Buffer.isBuffer(downloaded) || downloaded.length === 0) {
          downloaded = (await candidate.client.downloadMedia(msg.media, {})) as Buffer;
        }
        if (!downloaded || !Buffer.isBuffer(downloaded) || downloaded.length === 0) continue;

        if (!mime) {
          if (msg.photo || msg.media.className === 'MessageMediaPhoto') {
            mime = 'image/jpeg';
          } else if (audioAttr) {
            mime = 'audio/ogg';
          } else if (videoAttr) {
            mime = 'video/mp4';
          } else if (stickerAttr) {
            mime = 'image/webp';
          } else {
            mime = 'application/octet-stream';
          }
        }
        if (!fileName) {
          if (mime === 'image/jpeg') fileName = `tg_photo_${tgMsgId}.jpg`;
          else if (mime === 'image/webp') fileName = `tg_sticker_${tgMsgId}.webp`;
          else if (mime.startsWith('video/')) fileName = `tg_video_${tgMsgId}.mp4`;
          else if (mime.startsWith('audio/')) fileName = `tg_audio_${tgMsgId}.ogg`;
          else fileName = `tg_file_${tgMsgId}`;
        }

        const entry = {
          buffer: downloaded,
          mime,
          fileName,
          expiresAt: now + 30 * 60 * 1000,
        };
        telegramMediaCache.set(cacheKey, entry);
        if (telegramMediaCache.size > 60) {
          const oldestKey = telegramMediaCache.keys().next().value;
          if (oldestKey) telegramMediaCache.delete(oldestKey);
        }

        return sendMediaBufferResponse(req, res, entry, forceDownload);
      } catch {
        // Try next candidate client if peer doesn't belong to this session
      }
    }

    return res.status(404).send('Media not found');
  } catch {
    return res.status(404).send('Media not found');
  }
});

// 20.2 List all active connected in-memory user accounts
app.get('/api/telegram/user/active-accounts', requireTenantAuth, async (_req: Request, res: Response) => {
  try {
    const unique = new Map<string, any>();
    for (const u of connectedUserClients.values()) {
      const realConnected = Boolean(u.client?.connected);
      unique.set(u.userId, {
        id: `acc_tg_${u.userId}`,
        userId: u.userId,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Telegram 账号',
        username: u.username || `@user_${u.userId.slice(-4)}`,
        phone: u.phone,
        avatarBg: u.avatarBg,
        avatarInitial: u.avatarInitial,
        connectedAt: u.connectedAt,
        dialogsCount: u.dialogs.length,
        isConnected: realConnected,
        status: realConnected ? 'online' : 'away',
      });
    }
    res.json({
      ok: true,
      accounts: Array.from(unique.values()),
      expiredAccounts: Array.from(recentlyExpiredAccounts.values()),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 20.3 Disconnect / Logout Telegram User Account
app.post('/api/telegram/user/disconnect', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { accountId, phone, userId, forceLocalOnly } = req.body || {};
    const targetClient = resolveConnectedTelegramUser(accountId, phone, userId);
    const p = phone || targetClient?.phone;
    const normPhone = p ? normalizePhoneNumber(p) : '';
    const uid = userId || targetClient?.userId || (accountId?.startsWith('acc_tg_') ? String(accountId).replace(/^acc_tg_/, '') : '');

    let cloudLoggedOut = false;

    if (targetClient && targetClient.client) {
      console.log(`[Telegram User Auth] Invoking native auth.LogOut on Telegram Cloud for user ${targetClient.userId} (@${targetClient.username})...`);
      try {
        await withTelegramTimeout(
          targetClient.client.invoke(new Api.auth.LogOut()),
          10000,
          'Telegram 云端注销超时'
        );
        cloudLoggedOut = true;
        console.log(`[Telegram User Auth] Native auth.LogOut confirmed by Telegram Cloud for user ${targetClient.userId}`);
      } catch (logoutErr: any) {
        if (isTelegramSessionExpiredError(logoutErr)) {
          cloudLoggedOut = true;
        } else {
          console.warn(`[Telegram User Auth] Native auth.LogOut failed:`, logoutErr?.message || logoutErr);
          if (!forceLocalOnly) {
            return res.status(502).json({
              ok: false,
              cloudLoggedOut: false,
              canForceLocal: true,
              error: `云端注销失败（${formatTelegramError(logoutErr)}），请检查网络后重试或确认仅清除本地记录`,
            });
          }
        }
      }
      await destroyTelegramClientSafely(targetClient.client);
      connectedUserClients.delete(targetClient.userId);
      connectedUserClients.delete(targetClient.phone);
      connectedUserClients.delete(normalizePhoneNumber(targetClient.phone));
      connectedUserClients.delete(`acc_tg_${targetClient.userId}`);
    } else if (p || uid) {
      // Account not in RAM — check if DB still holds an active encrypted session and revoke it on Telegram Cloud
      try {
        const storedRow = (await db
          .prepare('SELECT phone, session_string, user_id FROM telegram_user_sessions WHERE (phone = ? OR phone = ? OR user_id = ?) AND is_active = 1 LIMIT 1')
          .get(p || '', normPhone || '', uid || '')) as any;

        if (storedRow?.session_string) {
          const decrypted = decryptSensitiveData(storedRow.session_string);
          const creds = await resolveTelegramApiCredentials({ bearerToken: extractBearerToken(req) });
          if (decrypted && creds.ok && creds.apiId && creds.apiHash) {
            const telegramProxy = getConfiguredTelegramProxy();
            const tempClient = new TelegramClient(new StringSession(decrypted), creds.apiId, creds.apiHash, {
              connectionRetries: 2,
              ...(telegramProxy ? { proxy: telegramProxy } : {}),
            });
            configureTelegramClientErrorGuard(tempClient, `logout_${storedRow.phone || uid}`);
            try {
              await withTelegramTimeout(tempClient.connect(), 10000, '连接 Telegram 云端注销超时');
              await withTelegramTimeout(tempClient.invoke(new Api.auth.LogOut()), 10000, 'Telegram 云端注销超时');
              cloudLoggedOut = true;
            } catch (tempErr: any) {
              if (isTelegramSessionExpiredError(tempErr)) {
                cloudLoggedOut = true;
              } else if (!forceLocalOnly) {
                await destroyTelegramClientSafely(tempClient);
                return res.status(502).json({
                  ok: false,
                  cloudLoggedOut: false,
                  canForceLocal: true,
                  error: `离线会话云端注销失败（${formatTelegramError(tempErr)}），请检查网络后重试或确认仅清除本地记录`,
                });
              }
            } finally {
              await destroyTelegramClientSafely(tempClient);
            }
          }
        }
      } catch {}
    }

    clearExpiredAccountRecord(uid, p);

    if (p || uid) {
      try {
        await db.prepare('DELETE FROM telegram_user_sessions WHERE phone = ? OR phone = ? OR user_id = ?').run(p || '', normPhone || '', uid || '');
      } catch {}
    }

    // Purge any queued real-time updates belonging to the logged-out account
    const targetAccountIds = new Set<string>(
      [accountId, uid, uid ? `acc_tg_${uid}` : '', p, normPhone].filter(Boolean) as string[]
    );
    if (targetAccountIds.size > 0 && pendingLocalUpdates.length > 0) {
      for (let i = pendingLocalUpdates.length - 1; i >= 0; i--) {
        if (targetAccountIds.has(pendingLocalUpdates[i].accountId)) {
          pendingLocalUpdates.splice(i, 1);
        }
      }
    }

    res.json({
      ok: true,
      cloudLoggedOut,
      message: cloudLoggedOut
        ? 'Telegram 账号已在云端安全注销 (auth.LogOut) 并彻底清除本地会话'
        : '已断开连接并彻底清除本地 Telegram 会话记录',
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 20.3.1 Update Telegram User Profile & Username via MTProto (account.UpdateProfile / account.UpdateUsername)
app.post('/api/telegram/user/update-profile', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const { name, username, bio } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);

    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        cloudSynced: false,
        error: '当前账号未在线连接 Telegram MTProto，无法同步云端个人资料，请先连接登录该账号。',
      });
    }

    const cleanName = typeof name === 'string' ? name.trim() : '';
    const nameParts = cleanName ? cleanName.split(/\s+/) : [];
    const firstName = nameParts[0] || connected.firstName || 'Telegram';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : cleanName ? '' : (connected.lastName || '');
    const cleanBio = typeof bio === 'string' ? bio.trim() : undefined;

    await connected.client.invoke(
      new Api.account.UpdateProfile({
        firstName,
        lastName,
        ...(cleanBio !== undefined ? { about: cleanBio } : {}),
      })
    );

    connected.firstName = firstName;
    connected.lastName = lastName;
    if (cleanName) {
      connected.avatarInitial = cleanName.slice(0, 2).toUpperCase();
    }

    if (typeof username === 'string') {
      const normalizedNewUsername = username.trim().replace(/^@/, '');
      const currentUsername = (connected.username || '').replace(/^@/, '');
      if (normalizedNewUsername !== currentUsername) {
        try {
          await connected.client.invoke(
            new Api.account.UpdateUsername({
              username: normalizedNewUsername,
            })
          );
          connected.username = normalizedNewUsername ? `@${normalizedNewUsername}` : '';
        } catch (userErr: any) {
          const msg = String(userErr?.errorMessage || userErr?.message || userErr || '用户名更新失败');
          if (!msg.includes('USERNAME_NOT_MODIFIED')) {
            return res.status(400).json({
              ok: false,
              cloudSynced: false,
              profileUpdated: true,
              error: msg.includes('USERNAME_OCCUPIED')
                ? '该用户名已被其他 Telegram 用户占用'
                : msg.includes('USERNAME_INVALID')
                  ? '用户名格式无效（仅支持 5-32 位字母、数字与下划线）'
                  : `用户名云端同步失败: ${msg}`,
            });
          }
        }
      }
    }

    try {
      await db.prepare(
        'UPDATE telegram_user_sessions SET first_name = ?, username = ?, updated_at = ? WHERE user_id = ? OR phone = ?'
      ).run(
        `${connected.firstName} ${connected.lastName}`.trim(),
        (connected.username || '').replace(/^@/, ''),
        Date.now(),
        connected.userId,
        connected.phone
      );
    } catch {}

    return res.json({
      ok: true,
      cloudSynced: true,
      profile: {
        name: `${connected.firstName || ''} ${connected.lastName || ''}`.trim(),
        username: connected.username,
        bio: cleanBio ?? '',
        phone: connected.phone,
      },
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 500);
  }
});

// 20.3.1a Upload Official Telegram Profile Avatar (photos.UploadProfilePhoto)
app.post('/api/telegram/user/upload-avatar', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const imageDataUrl = (req.body?.imageDataUrl as string) || '';

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        error: '当前账号未在线连接 Telegram MTProto，无法上传云端头像。',
      });
    }

    const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
    if (!match) {
      return res.status(400).json({
        ok: false,
        error: '头像格式无效，请上传 PNG、JPG 或 WEBP 图片文件。',
      });
    }

    const mime = match[1].toLowerCase();
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const imgBuf = Buffer.from(match[2], 'base64');
    if (!imgBuf || imgBuf.length === 0) {
      return res.status(400).json({ ok: false, error: '头像图片内容为空' });
    }

    const customFile = new CustomFile(`avatar_${connected.userId}.${ext}`, imgBuf.length, '', imgBuf);
    const uploadedFile = await connected.client.uploadFile({
      file: customFile,
      workers: 1,
    });

    await connected.client.invoke(
      new Api.photos.UploadProfilePhoto({
        file: uploadedFile,
      })
    );

    telegramAvatarCache.delete(connected.userId);
    telegramAvatarCache.delete(`acc_tg_${connected.userId}:${connected.userId}`);
    telegramAvatarCache.delete(`${connected.userId}:${connected.userId}`);
    telegramAvatarCache.delete(`shared:${connected.userId}`);
    if (connected.username) {
      telegramAvatarCache.delete(connected.username.replace(/^@/, ''));
    }

    return res.json({
      ok: true,
      cloudSynced: true,
      avatarUrl: signTelegramResourceUrl(
        `/api/telegram/user/avatar/${connected.userId}?t=${Date.now()}`,
        `acc_tg_${connected.userId}`
      ),
      message: 'Telegram 官方头像已上传并同步至云端',
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 500);
  }
});

// 20.3.1b Official Change Phone Number (account.SendChangePhoneCode / account.ChangePhone)
const pendingChangePhoneSessions = new Map<string, {
  userId: string;
  newPhone: string;
  phoneCodeHash: string;
  createdAt: number;
}>();

app.post('/api/telegram/user/change-phone/send-code', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const rawNewPhone = (req.body?.newPhone as string) || '';

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法发送换绑验证码。' });
    }

    const cleanNewPhone = normalizePhoneNumber(rawNewPhone);
    if (!cleanNewPhone || cleanNewPhone.length < 6) {
      return res.status(400).json({ ok: false, error: '请输入正确的新手机号码（含国际区号，如 +8613800000000）。' });
    }

    const sent: any = await connected.client.invoke(
      new Api.account.SendChangePhoneCode({
        phoneNumber: cleanNewPhone,
        settings: new Api.CodeSettings({}),
      })
    );

    pendingChangePhoneSessions.set(connected.userId, {
      userId: connected.userId,
      newPhone: cleanNewPhone,
      phoneCodeHash: sent.phoneCodeHash,
      createdAt: Date.now(),
    });

    return res.json({
      ok: true,
      newPhone: cleanNewPhone,
      phoneCodeHash: sent.phoneCodeHash,
      message: `换绑验证码已发送至新号码 ${cleanNewPhone} 对应的终端/短信，请查收并输入确认。`,
    });
  } catch (err: any) {
    const msg = String(err?.errorMessage || err?.message || '');
    if (msg.includes('PHONE_NUMBER_OCCUPIED')) {
      return res.status(400).json({ ok: false, error: '该新手机号已被其他 Telegram 账号占用，无法换绑。' });
    }
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 400);
  }
});

app.post('/api/telegram/user/change-phone/confirm', requireTenantAuth, authAttemptLimiter, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const code = String(req.body?.code || '').trim();
    const rawNewPhone = (req.body?.newPhone as string) || '';

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法完成手机号换绑。' });
    }

    const pending = pendingChangePhoneSessions.get(connected.userId);
    const cleanNewPhone = normalizePhoneNumber(rawNewPhone || pending?.newPhone || '');
    const phoneCodeHash = String(req.body?.phoneCodeHash || pending?.phoneCodeHash || '').trim();

    if (!cleanNewPhone || !phoneCodeHash || !code) {
      return res.status(400).json({ ok: false, error: '换绑会话不完整或已过期，请重新发送验证码。' });
    }

    const oldPhone = connected.phone;
    const updatedUser: any = await connected.client.invoke(
      new Api.account.ChangePhone({
        phoneNumber: cleanNewPhone,
        phoneCodeHash,
        phoneCode: code,
      })
    );

    const verifiedPhone = updatedUser?.phone
      ? (String(updatedUser.phone).startsWith('+') ? String(updatedUser.phone) : `+${updatedUser.phone}`)
      : cleanNewPhone;

    connected.phone = verifiedPhone;
    if (oldPhone && oldPhone !== verifiedPhone) {
      connectedUserClients.delete(oldPhone);
    }
    connectedUserClients.set(verifiedPhone, connected);
    pendingChangePhoneSessions.delete(connected.userId);

    try {
      await db.prepare(
        'UPDATE telegram_user_sessions SET phone = ?, updated_at = ? WHERE user_id = ? OR phone = ?'
      ).run(verifiedPhone, Date.now(), connected.userId, oldPhone);
    } catch {}

    return res.json({
      ok: true,
      cloudSynced: true,
      phone: verifiedPhone,
      message: `Telegram 官方绑定手机号已成功变更为 ${verifiedPhone}`,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 400);
  }
});

export type TelegramPrivacyRuleKey =
  | 'status'
  | 'phone'
  | 'addedByPhone'
  | 'profilePhoto'
  | 'bio'
  | 'forwards'
  | 'calls'
  | 'p2p'
  | 'chatInvite'
  | 'voiceMessages';

export interface ParsedPrivacyExceptionUser {
  id: string;
  name: string;
  username?: string;
}

export interface ParsedPrivacyRuleDetail {
  mode: 'everybody' | 'contacts' | 'nobody';
  summary: string;
  allowUsers: ParsedPrivacyExceptionUser[];
  disallowUsers: ParsedPrivacyExceptionUser[];
}

function createInputPrivacyKey(key: TelegramPrivacyRuleKey): Api.TypeInputPrivacyKey {
  switch (key) {
    case 'status':
      return new Api.InputPrivacyKeyStatusTimestamp();
    case 'phone':
      return new Api.InputPrivacyKeyPhoneNumber();
    case 'addedByPhone':
      return new Api.InputPrivacyKeyAddedByPhone();
    case 'profilePhoto':
      return new Api.InputPrivacyKeyProfilePhoto();
    case 'bio':
      return new Api.InputPrivacyKeyAbout();
    case 'forwards':
      return new Api.InputPrivacyKeyForwards();
    case 'calls':
      return new Api.InputPrivacyKeyPhoneCall();
    case 'p2p':
      return new Api.InputPrivacyKeyPhoneP2P();
    case 'chatInvite':
      return new Api.InputPrivacyKeyChatInvite();
    case 'voiceMessages':
      return new Api.InputPrivacyKeyVoiceMessages();
  }
}

const VALID_PRIVACY_KEYS: TelegramPrivacyRuleKey[] = [
  'status',
  'phone',
  'addedByPhone',
  'profilePhoto',
  'bio',
  'forwards',
  'calls',
  'p2p',
  'chatInvite',
  'voiceMessages',
];

function serializeTwoFactorState(pwdObj: any) {
  return {
    hasPassword: Boolean(pwdObj?.hasPassword),
    hint: pwdObj?.hint || '',
    hasRecovery: Boolean(pwdObj?.hasRecovery),
    emailUnconfirmedPattern: pwdObj?.emailUnconfirmedPattern || '',
    pendingResetDate: Number(pwdObj?.pendingResetDate || 0),
  };
}

// Helper: parse Telegram privacy rules to canonical mode + custom exception users
export function parsePrivacyRulesToMode(rules: any[], users?: any[]): ParsedPrivacyRuleDetail {
  const list = Array.isArray(rules) ? rules : [];
  const userMap = new Map<string, ParsedPrivacyExceptionUser>();
  if (Array.isArray(users)) {
    for (const u of users) {
      if (!u || u.id === undefined || u.id === null) continue;
      const uid = String(u.id);
      const displayName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || (u.username ? `@${u.username}` : `用户 ${uid}`);
      userMap.set(uid, {
        id: uid,
        name: displayName,
        username: u.username ? `@${u.username}` : undefined,
      });
    }
  }

  let mode: 'everybody' | 'contacts' | 'nobody' = 'nobody';
  let baseSummary = '自定义规则';
  let foundBase = false;
  const allowUsers: ParsedPrivacyExceptionUser[] = [];
  const disallowUsers: ParsedPrivacyExceptionUser[] = [];
  const seenAllow = new Set<string>();
  const seenDisallow = new Set<string>();

  for (const r of list) {
    const cls = r?.className || r?.constructor?.name || '';
    if (!foundBase && cls === 'PrivacyValueAllowAll') {
      mode = 'everybody';
      baseSummary = '所有人可见';
      foundBase = true;
    } else if (!foundBase && cls === 'PrivacyValueAllowContacts') {
      mode = 'contacts';
      baseSummary = '仅我的联系人可见';
      foundBase = true;
    } else if (!foundBase && cls === 'PrivacyValueDisallowAll') {
      mode = 'nobody';
      baseSummary = '没有人可见';
      foundBase = true;
    } else if (cls === 'PrivacyValueAllowUsers' && Array.isArray(r?.users)) {
      for (const rawId of r.users) {
        const uid = String(rawId);
        if (seenAllow.has(uid)) continue;
        seenAllow.add(uid);
        allowUsers.push(userMap.get(uid) || { id: uid, name: `用户 ${uid}` });
      }
    } else if (cls === 'PrivacyValueDisallowUsers' && Array.isArray(r?.users)) {
      for (const rawId of r.users) {
        const uid = String(rawId);
        if (seenDisallow.has(uid)) continue;
        seenDisallow.add(uid);
        disallowUsers.push(userMap.get(uid) || { id: uid, name: `用户 ${uid}` });
      }
    }
  }

  const extraTags: string[] = [];
  if (allowUsers.length > 0) extraTags.push(`+${allowUsers.length} 始终允许`);
  if (disallowUsers.length > 0) extraTags.push(`-${disallowUsers.length} 永不允许`);
  const summary = extraTags.length > 0 ? `${baseSummary}（${extraTags.join(' / ')}）` : baseSummary;

  return { mode, summary, allowUsers, disallowUsers };
}

export function buildPrivacyInputRules(
  mode: string,
  allowUsers: Api.TypeInputUser[] = [],
  disallowUsers: Api.TypeInputUser[] = []
): Api.TypeInputPrivacyRule[] {
  const rules: Api.TypeInputPrivacyRule[] = [];
  if (Array.isArray(allowUsers) && allowUsers.length > 0) {
    rules.push(new Api.InputPrivacyValueAllowUsers({ users: allowUsers }));
  }
  if (Array.isArray(disallowUsers) && disallowUsers.length > 0) {
    rules.push(new Api.InputPrivacyValueDisallowUsers({ users: disallowUsers }));
  }
  if (mode === 'everybody') {
    rules.push(new Api.InputPrivacyValueAllowAll());
  } else if (mode === 'contacts') {
    rules.push(new Api.InputPrivacyValueAllowContacts());
  } else {
    rules.push(new Api.InputPrivacyValueDisallowAll());
  }
  return rules;
}

function extractDialogFilterTitle(rawTitle: any): string {
  if (typeof rawTitle === 'string') return rawTitle;
  if (rawTitle && typeof rawTitle.text === 'string') return rawTitle.text;
  return '未命名分组';
}

function serializeDialogFilter(f: any) {
  return {
    id: Number(f.id),
    title: extractDialogFilterTitle(f.title),
    emoticon: f.emoticon || '',
    color: typeof f.color === 'number' ? f.color : undefined,
    contacts: Boolean(f.contacts),
    nonContacts: Boolean(f.nonContacts),
    groups: Boolean(f.groups),
    broadcasts: Boolean(f.broadcasts),
    bots: Boolean(f.bots),
    excludeMuted: Boolean(f.excludeMuted),
    excludeRead: Boolean(f.excludeRead),
    excludeArchived: Boolean(f.excludeArchived),
    pinnedCount: Array.isArray(f.pinnedPeers) ? f.pinnedPeers.length : 0,
    includeCount: Array.isArray(f.includePeers) ? f.includePeers.length : 0,
    excludeCount: Array.isArray(f.excludePeers) ? f.excludePeers.length : 0,
    isChatlist: (f.className || '').includes('DialogFilterChatlist'),
  };
}

// 20.3.1c Fetch Complete Official Telegram Account Settings via MTProto
app.get('/api/telegram/user/settings', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.query.phone as string) || '';
    const userId = (req.query.userId as string) || '';

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        error: '当前账号未在线连接 Telegram MTProto，无法拉取官方云端设置。请先在多账号管理器中登录/重连该账号。',
      });
    }

    const client = connected.client;

    const settled = await Promise.allSettled([
      client.invoke(new Api.users.GetFullUser({ id: new Api.InputUserSelf() })),
      client.invoke(new Api.account.GetPassword()),
      client.invoke(new Api.account.GetAuthorizations()),
      client.invoke(new Api.account.GetNotifySettings({ peer: new Api.InputNotifyUsers() })),
      client.invoke(new Api.account.GetNotifySettings({ peer: new Api.InputNotifyChats() })),
      client.invoke(new Api.messages.GetDialogFilters()),
      client.invoke(new Api.account.GetGlobalPrivacySettings()),
      client.invoke(new Api.account.GetAccountTTL()),
      ...VALID_PRIVACY_KEYS.map((k) => client.invoke(new Api.account.GetPrivacy({ key: createInputPrivacyKey(k) }))),
    ]);

    const [
      fullUserSettled,
      passwordSettled,
      authorizationsSettled,
      usersNotifySettled,
      chatsNotifySettled,
      dialogFiltersSettled,
      globalPrivacySettled,
      accountTtlSettled,
      ...privacySettledList
    ] = settled;

    // If core MTProto connection failed completely across profile/password/sessions, surface real Telegram error
    if (
      fullUserSettled.status === 'rejected' &&
      passwordSettled.status === 'rejected' &&
      authorizationsSettled.status === 'rejected'
    ) {
      return await handleMtprotoRouteError(
        res,
        passwordSettled.reason || fullUserSettled.reason,
        {
          accountId,
          userId: connected.userId,
          phone: connected.phone,
        },
        500
      );
    }

    const fullUserRes = fullUserSettled.status === 'fulfilled' ? fullUserSettled.value : null;
    const passwordRes = passwordSettled.status === 'fulfilled' ? passwordSettled.value : null;
    const authorizationsRes = authorizationsSettled.status === 'fulfilled' ? authorizationsSettled.value : null;
    const usersNotifyRes = usersNotifySettled.status === 'fulfilled' ? usersNotifySettled.value : null;
    const chatsNotifyRes = chatsNotifySettled.status === 'fulfilled' ? chatsNotifySettled.value : null;
    const dialogFiltersRes = dialogFiltersSettled.status === 'fulfilled' ? dialogFiltersSettled.value : null;
    const globalPrivacyRes = globalPrivacySettled.status === 'fulfilled' ? (globalPrivacySettled.value as any) : null;
    const accountTtlRes = accountTtlSettled.status === 'fulfilled' ? (accountTtlSettled.value as any) : null;

    const meUser: any = Array.isArray((fullUserRes as any)?.users)
      ? (fullUserRes as any).users.find((u: any) => u?.self || String(u?.id) === connected.userId) || (fullUserRes as any).users[0]
      : null;
    const fullUserObj: any = (fullUserRes as any)?.fullUser || {};

    if (meUser) {
      connected.firstName = meUser.firstName || connected.firstName;
      connected.lastName = meUser.lastName || '';
      connected.username = meUser.username ? `@${meUser.username}` : '';
      if (meUser.phone) {
        connected.phone = String(meUser.phone).startsWith('+') ? String(meUser.phone) : `+${meUser.phone}`;
      }
    }

    const privacyRules: Partial<Record<TelegramPrivacyRuleKey, ParsedPrivacyRuleDetail>> = {};
    VALID_PRIVACY_KEYS.forEach((key, idx) => {
      const item = privacySettledList[idx];
      if (item && item.status === 'fulfilled') {
        const val: any = item.value;
        privacyRules[key] = parsePrivacyRulesToMode(val?.rules, val?.users);
      }
    });

    const statusPrivacy = privacyRules.status || { mode: 'nobody' as const, summary: '未获取', allowUsers: [], disallowUsers: [] };
    const phonePrivacy = privacyRules.phone || { mode: 'nobody' as const, summary: '未获取', allowUsers: [], disallowUsers: [] };

    const authList = Array.isArray((authorizationsRes as any)?.authorizations)
      ? (authorizationsRes as any).authorizations.map((a: any) => ({
          hash: String(a.hash),
          current: Boolean(a.current),
          officialApp: Boolean(a.officialApp),
          deviceModel: a.deviceModel || 'Unknown Device',
          platform: a.platform || '',
          systemVersion: a.systemVersion || '',
          appName: a.appName || 'Telegram',
          appVersion: a.appVersion || '',
          dateCreated: Number(a.dateCreated || 0),
          dateActive: Number(a.dateActive || 0),
          ip: a.ip || '',
          country: a.country || '',
          region: a.region || '',
        }))
      : [];

    const nowSec = Math.floor(Date.now() / 1000);
    const parseNotify = (n: any) => {
      const muteUntil = Number(n?.muteUntil || 0);
      const isMuted = Boolean(n?.silent) || (muteUntil > nowSec);
      return {
        enabled: !isMuted,
        silent: Boolean(n?.silent),
        muteUntil,
        showPreviews: n?.showPreviews !== false,
      };
    };

    const rawFilters: any[] = Array.isArray((dialogFiltersRes as any)?.filters)
      ? (dialogFiltersRes as any).filters
      : Array.isArray(dialogFiltersRes)
        ? (dialogFiltersRes as any)
        : [];
    const folders = rawFilters
      .filter((f: any) => f && f.className !== 'DialogFilterDefault' && typeof f.id === 'number')
      .map(serializeDialogFilter);

    return res.json({
      ok: true,
      cloudSynced: true,
      profile: {
        userId: connected.userId,
        name: `${connected.firstName || ''} ${connected.lastName || ''}`.trim() || 'Telegram 用户',
        username: connected.username || '',
        phone: connected.phone || '',
        bio: fullUserObj?.about || '',
        hasAvatar: Boolean(fullUserObj?.profilePhoto || meUser?.photo),
        avatarUrl: signTelegramResourceUrl(
          `/api/telegram/user/avatar/${connected.userId}`,
          `acc_tg_${connected.userId}`
        ),
      },
      twoFactor: passwordRes ? serializeTwoFactorState(passwordRes) : undefined,
      privacy: {
        lastSeen: statusPrivacy.mode,
        lastSeenSummary: statusPrivacy.summary,
        phoneNumber: phonePrivacy.mode,
        phoneNumberSummary: phonePrivacy.summary,
      },
      privacyRules,
      globalPrivacy: globalPrivacyRes
        ? {
            archiveAndMuteNewNoncontactPeers: Boolean(globalPrivacyRes.archiveAndMuteNewNoncontactPeers),
            keepArchivedUnmuted: Boolean(globalPrivacyRes.keepArchivedUnmuted),
            keepArchivedFolders: Boolean(globalPrivacyRes.keepArchivedFolders),
            hideReadMarks: Boolean(globalPrivacyRes.hideReadMarks),
            newNoncontactPeersRequirePremium: Boolean(globalPrivacyRes.newNoncontactPeersRequirePremium),
          }
        : undefined,
      accountTtlDays: accountTtlRes && typeof accountTtlRes.days === 'number' ? Number(accountTtlRes.days) : undefined,
      sessions: authorizationsRes ? authList : undefined,
      notifications:
        usersNotifyRes || chatsNotifyRes
          ? {
              users: parseNotify(usersNotifyRes),
              chats: parseNotify(chatsNotifyRes),
            }
          : undefined,
      folders: dialogFiltersRes ? folders : undefined,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.query.phone as string) || '',
      userId: (req.query.userId as string) || '',
    }, 500);
  }
});

// 20.3.1d Update Official Telegram 2FA Cloud Password (UpdatePasswordSettings / Email Confirmation / Reset)
app.post('/api/telegram/user/settings/two-factor', requireTenantAuth, authAttemptLimiter, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const { action, currentPassword, newPassword, hint, email, code } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法修改两步验证密码。' });
    }
    const client = connected.client;

    if (action === 'confirm_email') {
      const cleanCode = String(code || '').trim();
      if (!cleanCode) {
        return res.status(400).json({ ok: false, error: '请输入发送至恢复邮箱的验证码。' });
      }
      await client.invoke(new Api.account.ConfirmPasswordEmail({ code: cleanCode }));
      const updatedPwdInfo: any = await client.invoke(new Api.account.GetPassword());
      return res.json({
        ok: true,
        cloudSynced: true,
        message: '恢复邮箱验证成功，已正式绑定为您的 2FA 找回邮箱',
        twoFactor: serializeTwoFactorState(updatedPwdInfo),
      });
    }

    if (action === 'resend_email') {
      await client.invoke(new Api.account.ResendPasswordEmail());
      const updatedPwdInfo: any = await client.invoke(new Api.account.GetPassword());
      return res.json({
        ok: true,
        cloudSynced: true,
        message: '恢复邮箱验证码已重新发送，请查收邮箱（含垃圾邮件箱）',
        twoFactor: serializeTwoFactorState(updatedPwdInfo),
      });
    }

    if (action === 'cancel_email') {
      await client.invoke(new Api.account.CancelPasswordEmail());
      const updatedPwdInfo: any = await client.invoke(new Api.account.GetPassword());
      return res.json({
        ok: true,
        cloudSynced: true,
        message: '已取消待验证的恢复邮箱绑定请求',
        twoFactor: serializeTwoFactorState(updatedPwdInfo),
      });
    }

    if (action === 'reset_password') {
      const resetRes: any = await client.invoke(new Api.account.ResetPassword());
      const updatedPwdInfo: any = await client.invoke(new Api.account.GetPassword());
      const cls = resetRes?.className || '';
      if (cls.includes('ResetPasswordOk')) {
        return res.json({
          ok: true,
          cloudSynced: true,
          resetStatus: 'ok',
          message: '原两步验证密码已清除重置，您现在可以重新设置新密码',
          twoFactor: serializeTwoFactorState(updatedPwdInfo),
        });
      }
      if (cls.includes('ResetPasswordRequestedWait')) {
        return res.json({
          ok: true,
          cloudSynced: true,
          resetStatus: 'waiting',
          untilDate: Number(resetRes?.untilDate || updatedPwdInfo?.pendingResetDate || 0),
          message: '已向 Telegram 官方提交 7 天安全重置申请，冷却期满后原密码将自动清除',
          twoFactor: serializeTwoFactorState(updatedPwdInfo),
        });
      }
      return res.json({
        ok: true,
        cloudSynced: true,
        resetStatus: 'failed_wait',
        retryDate: Number(resetRes?.retryDate || 0),
        message: '近期已取消或执行过重置操作，需等待冷却期结束后才可再次申请重置',
        twoFactor: serializeTwoFactorState(updatedPwdInfo),
      });
    }

    if (action !== 'disable' && action !== 'enable' && action !== 'change') {
      return res.status(400).json({ ok: false, error: '无效的 2FA 操作类型' });
    }

    const executePasswordUpdate = async (): Promise<{ emailConfirmationRequired: boolean }> => {
      const pwdInfo: any = await client.invoke(new Api.account.GetPassword());
      let passwordCheck: Api.TypeInputCheckPasswordSRP = new Api.InputCheckPasswordEmpty();

      if (pwdInfo.hasPassword) {
        const cur = String(currentPassword || '');
        if (!cur) {
          throw new Error('当前账号已开启两步验证，必须输入原云端密码才能修改或关闭。');
        }
        passwordCheck = await computeCheck(pwdInfo, cur);
      }

      if (action === 'disable') {
        await client.invoke(
          new Api.account.UpdatePasswordSettings({
            password: passwordCheck,
            newSettings: new Api.account.PasswordInputSettings({
              newAlgo: new Api.PasswordKdfAlgoUnknown(),
              newPasswordHash: Buffer.alloc(0),
              hint: '',
            }),
          })
        );
        return { emailConfirmationRequired: false };
      }

      const nextPwd = String(newPassword || '');
      if (!nextPwd || nextPwd.length < 1) {
        throw new Error('请输入新的两步验证密码。');
      }
      const srcAlgo = pwdInfo.newAlgo;
      if (!(srcAlgo instanceof Api.PasswordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow)) {
        throw new Error('Telegram 返回的密码加密算法不受支持，无法设置密码。');
      }
      const nextAlgo = new Api.PasswordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow({
        salt1: Buffer.concat([Buffer.from(srcAlgo.salt1), crypto.randomBytes(32)]),
        salt2: Buffer.from(srcAlgo.salt2),
        g: srcAlgo.g,
        p: Buffer.from(srcAlgo.p),
      });
      const newPasswordHash = await computeDigest(nextAlgo, nextPwd);
      const cleanEmail = typeof email === 'string' && email.trim() ? email.trim() : undefined;
      try {
        await client.invoke(
          new Api.account.UpdatePasswordSettings({
            password: passwordCheck,
            newSettings: new Api.account.PasswordInputSettings({
              newAlgo: nextAlgo,
              newPasswordHash,
              hint: typeof hint === 'string' ? hint.trim() : '',
              ...(cleanEmail ? { email: cleanEmail } : {}),
            }),
          })
        );
        return { emailConfirmationRequired: false };
      } catch (innerErr: any) {
        const errText = String(innerErr?.errorMessage || innerErr?.message || '');
        if (errText.includes('EMAIL_UNCONFIRMED')) {
          return { emailConfirmationRequired: true };
        }
        throw innerErr;
      }
    };

    let updateOutcome: { emailConfirmationRequired: boolean };
    try {
      updateOutcome = await executePasswordUpdate();
    } catch (firstErr: any) {
      const firstMsg = String(firstErr?.errorMessage || firstErr?.message || '');
      if (firstMsg.includes('SRP_ID_INVALID')) {
        updateOutcome = await executePasswordUpdate();
      } else {
        throw firstErr;
      }
    }

    const updatedPwdInfo: any = await client.invoke(new Api.account.GetPassword());
    const serialized = serializeTwoFactorState(updatedPwdInfo);
    const needsEmailConfirm = updateOutcome.emailConfirmationRequired || Boolean(serialized.emailUnconfirmedPattern);

    return res.json({
      ok: true,
      cloudSynced: true,
      emailConfirmationRequired: needsEmailConfirm,
      message: needsEmailConfirm
        ? '云端两步验证密码已设置，请输入发送至恢复邮箱的验证码以完成邮箱绑定'
        : serialized.hasPassword
          ? 'Telegram 云端两步验证密码已更新生效'
          : '已关闭 Telegram 云端两步验证',
      twoFactor: serialized,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 400);
  }
});

// 20.3.1e Update Official Telegram Privacy Settings (account.SetPrivacy with full keys & user exceptions)
app.post('/api/telegram/user/settings/privacy', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const rawKey = String(req.body?.key || '').trim() as TelegramPrivacyRuleKey;
    const mode = req.body?.mode;

    if (!VALID_PRIVACY_KEYS.includes(rawKey)) {
      return res.status(400).json({ ok: false, error: `不支持的隐私规则项目: ${rawKey || '未知'}` });
    }

    if (!['everybody', 'contacts', 'nobody'].includes(mode)) {
      return res.status(400).json({ ok: false, error: '隐私模式必须为 everybody / contacts / nobody' });
    }

    if (rawKey === 'addedByPhone' && mode === 'nobody') {
      return res.status(400).json({ ok: false, error: '「通过手机号找到我」按 Telegram 官方限制仅支持所有人或仅联系人' });
    }

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法修改云端隐私设置。' });
    }

    const resolveExceptionList = async (rawRefs: unknown, label: string): Promise<Api.TypeInputUser[]> => {
      if (!Array.isArray(rawRefs) || rawRefs.length === 0) return [];
      const uniqueRefs = Array.from(new Set(rawRefs.map((r) => String(r || '').trim()).filter(Boolean)));
      const resolved: Api.TypeInputUser[] = [];
      const seenUserIds = new Set<string>();
      for (const ref of uniqueRefs) {
        const inputUser = await resolveTelegramInputUser(connected.client, ref);
        if (!inputUser) {
          throw new Error(`${label}中的用户「${ref}」无法在当前账号中解析，请确认对方 @用户名 或数字 ID 正确且已有交互记录`);
        }
        const uid = String((inputUser as any).userId || ref);
        if (!seenUserIds.has(uid)) {
          seenUserIds.add(uid);
          resolved.push(inputUser);
        }
      }
      return resolved;
    };

    const allowInputUsers = await resolveExceptionList(req.body?.allowUserRefs, '始终允许名单');
    const disallowInputUsers = await resolveExceptionList(req.body?.disallowUserRefs, '永不允许名单');

    const result: any = await connected.client.invoke(
      new Api.account.SetPrivacy({
        key: createInputPrivacyKey(rawKey),
        rules: buildPrivacyInputRules(mode, allowInputUsers, disallowInputUsers),
      })
    );

    const parsed = parsePrivacyRulesToMode(result?.rules, result?.users);
    return res.json({
      ok: true,
      cloudSynced: true,
      key: rawKey,
      mode: parsed.mode,
      summary: parsed.summary,
      allowUsers: parsed.allowUsers,
      disallowUsers: parsed.disallowUsers,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 400);
  }
});

// 20.3.1e-2 Update Official Telegram Global Privacy & Anti-Harassment Settings (account.SetGlobalPrivacySettings)
app.post('/api/telegram/user/settings/global-privacy', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法修改全局安全设置。' });
    }

    const updated: any = await connected.client.invoke(
      new Api.account.SetGlobalPrivacySettings({
        settings: new Api.GlobalPrivacySettings({
          archiveAndMuteNewNoncontactPeers: Boolean(req.body?.archiveAndMuteNewNoncontactPeers),
          keepArchivedUnmuted: Boolean(req.body?.keepArchivedUnmuted),
          keepArchivedFolders: Boolean(req.body?.keepArchivedFolders),
          hideReadMarks: Boolean(req.body?.hideReadMarks),
          newNoncontactPeersRequirePremium: Boolean(req.body?.newNoncontactPeersRequirePremium),
        }),
      })
    );

    return res.json({
      ok: true,
      cloudSynced: true,
      globalPrivacy: {
        archiveAndMuteNewNoncontactPeers: Boolean(updated?.archiveAndMuteNewNoncontactPeers),
        keepArchivedUnmuted: Boolean(updated?.keepArchivedUnmuted),
        keepArchivedFolders: Boolean(updated?.keepArchivedFolders),
        hideReadMarks: Boolean(updated?.hideReadMarks),
        newNoncontactPeersRequirePremium: Boolean(updated?.newNoncontactPeersRequirePremium),
      },
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 400);
  }
});

// 20.3.1e-3 Update Official Telegram Account Self-Destruct Inactivity TTL (account.SetAccountTTL)
app.post('/api/telegram/user/settings/account-ttl', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const days = Number(req.body?.days);

    if (!Number.isInteger(days) || days < 30 || days > 730) {
      return res.status(400).json({ ok: false, error: '账号自动注销周期必须为 30 至 730 天之间的整数' });
    }

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法修改账号自毁周期。' });
    }

    await connected.client.invoke(
      new Api.account.SetAccountTTL({
        ttl: new Api.AccountDaysTTL({ days }),
      })
    );

    return res.json({
      ok: true,
      cloudSynced: true,
      accountTtlDays: days,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 400);
  }
});

// 20.3.1f Terminate Official Active Telegram Session(s) (account.ResetAuthorization / auth.ResetAuthorizations)
app.post('/api/telegram/user/settings/sessions/terminate', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const { hash, terminateAllOthers } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法注销远程设备。' });
    }

    if (terminateAllOthers) {
      await connected.client.invoke(new Api.auth.ResetAuthorizations());
    } else if (hash !== undefined && hash !== null && String(hash).trim() !== '') {
      await connected.client.invoke(
        new Api.account.ResetAuthorization({
          hash: BigInt(String(hash).trim()) as any,
        })
      );
    } else {
      return res.status(400).json({ ok: false, error: '请提供要注销的设备会话标识 hash' });
    }

    const authRes: any = await connected.client.invoke(new Api.account.GetAuthorizations());
    const sessions = Array.isArray(authRes?.authorizations)
      ? authRes.authorizations.map((a: any) => ({
          hash: String(a.hash),
          current: Boolean(a.current),
          officialApp: Boolean(a.officialApp),
          deviceModel: a.deviceModel || 'Unknown Device',
          platform: a.platform || '',
          systemVersion: a.systemVersion || '',
          appName: a.appName || 'Telegram',
          appVersion: a.appVersion || '',
          dateCreated: Number(a.dateCreated || 0),
          dateActive: Number(a.dateActive || 0),
          ip: a.ip || '',
          country: a.country || '',
          region: a.region || '',
        }))
      : [];

    return res.json({
      ok: true,
      cloudSynced: true,
      sessions,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 400);
  }
});

// 20.3.1g Update Official Telegram Notification Settings (account.UpdateNotifySettings)
app.post('/api/telegram/user/settings/notifications', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const scope: 'users' | 'chats' | 'both' = req.body?.scope || 'both';
    const enabled = Boolean(req.body?.enabled);
    const previewText = req.body?.previewText !== false;

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法同步云端通知设置。' });
    }

    const inputSettings = new Api.InputPeerNotifySettings({
      showPreviews: previewText,
      silent: !enabled,
      muteUntil: enabled ? 0 : 2147483647,
    });

    if (scope === 'users' || scope === 'both') {
      await connected.client.invoke(
        new Api.account.UpdateNotifySettings({
          peer: new Api.InputNotifyUsers(),
          settings: inputSettings,
        })
      );
    }
    if (scope === 'chats' || scope === 'both') {
      await connected.client.invoke(
        new Api.account.UpdateNotifySettings({
          peer: new Api.InputNotifyChats(),
          settings: inputSettings,
        })
      );
    }

    const [usersNotifyRes, chatsNotifyRes] = await Promise.all([
      connected.client.invoke(new Api.account.GetNotifySettings({ peer: new Api.InputNotifyUsers() })),
      connected.client.invoke(new Api.account.GetNotifySettings({ peer: new Api.InputNotifyChats() })),
    ]);

    const nowSec = Math.floor(Date.now() / 1000);
    const parseNotify = (n: any) => {
      const muteUntil = Number(n?.muteUntil || 0);
      const isMuted = Boolean(n?.silent) || (muteUntil > nowSec);
      return {
        enabled: !isMuted,
        silent: Boolean(n?.silent),
        muteUntil,
        showPreviews: n?.showPreviews !== false,
      };
    };

    return res.json({
      ok: true,
      cloudSynced: true,
      notifications: {
        users: parseNotify(usersNotifyRes),
        chats: parseNotify(chatsNotifyRes),
      },
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 400);
  }
});

// 20.3.1h Create/Update Official Telegram Dialog Folder (messages.UpdateDialogFilter)
app.post('/api/telegram/user/settings/folders', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.body?.phone as string) || '';
    const userId = (req.body?.userId as string) || '';
    const folder = req.body?.filter;

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法操作云端对话文件夹。' });
    }

    const cleanTitle = String(folder?.title || '').trim();
    if (!cleanTitle) {
      return res.status(400).json({ ok: false, error: '文件夹名称不能为空' });
    }

    const existingRes: any = await connected.client.invoke(new Api.messages.GetDialogFilters());
    const rawFilters: any[] = Array.isArray(existingRes?.filters)
      ? existingRes.filters
      : Array.isArray(existingRes)
        ? existingRes
        : [];

    let targetId = Number(folder?.id || 0);
    const existingObj = targetId >= 2 ? rawFilters.find((f: any) => Number(f?.id) === targetId) : null;
    if (!targetId || targetId < 2) {
      const usedIds = new Set(rawFilters.map((f: any) => Number(f?.id || 0)));
      targetId = 2;
      while (usedIds.has(targetId) && targetId < 255) targetId += 1;
    }

    const tlFilter = new Api.DialogFilter({
      id: targetId,
      title: new Api.TextWithEntities({ text: cleanTitle.slice(0, 12), entities: [] }),
      emoticon: folder?.emoticon ?? existingObj?.emoticon,
      color: folder?.color ?? existingObj?.color,
      contacts: Boolean(folder?.contacts),
      nonContacts: Boolean(folder?.nonContacts),
      groups: Boolean(folder?.groups),
      broadcasts: Boolean(folder?.broadcasts),
      bots: Boolean(folder?.bots),
      excludeMuted: Boolean(folder?.excludeMuted),
      excludeRead: Boolean(folder?.excludeRead),
      excludeArchived: Boolean(folder?.excludeArchived),
      pinnedPeers: Array.isArray(existingObj?.pinnedPeers) ? existingObj.pinnedPeers : [],
      includePeers: Array.isArray(existingObj?.includePeers) ? existingObj.includePeers : [],
      excludePeers: Array.isArray(existingObj?.excludePeers) ? existingObj.excludePeers : [],
    });

    await connected.client.invoke(
      new Api.messages.UpdateDialogFilter({
        id: targetId,
        filter: tlFilter,
      })
    );

    const updatedRes: any = await connected.client.invoke(new Api.messages.GetDialogFilters());
    const updatedRaw: any[] = Array.isArray(updatedRes?.filters)
      ? updatedRes.filters
      : Array.isArray(updatedRes)
        ? updatedRes
        : [];
    const folders = updatedRaw
      .filter((f: any) => f && f.className !== 'DialogFilterDefault' && typeof f.id === 'number')
      .map(serializeDialogFilter);

    return res.json({
      ok: true,
      cloudSynced: true,
      folders,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.body?.phone as string) || '',
      userId: (req.body?.userId as string) || '',
    }, 400);
  }
});

// 20.3.1i Delete Official Telegram Dialog Folder (messages.UpdateDialogFilter without filter)
app.delete('/api/telegram/user/settings/folders/:id', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.query.phone as string) || '';
    const userId = (req.query.userId as string) || '';
    const filterId = Number(req.params.id);

    if (!filterId || filterId < 2) {
      return res.status(400).json({ ok: false, error: '无效的文件夹 ID' });
    }

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法删除云端文件夹。' });
    }

    await connected.client.invoke(
      new Api.messages.UpdateDialogFilter({
        id: filterId,
      })
    );

    const updatedRes: any = await connected.client.invoke(new Api.messages.GetDialogFilters());
    const updatedRaw: any[] = Array.isArray(updatedRes?.filters)
      ? updatedRes.filters
      : Array.isArray(updatedRes)
        ? updatedRes
        : [];
    const folders = updatedRaw
      .filter((f: any) => f && f.className !== 'DialogFilterDefault' && typeof f.id === 'number')
      .map(serializeDialogFilter);

    return res.json({
      ok: true,
      cloudSynced: true,
      folders,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.query.phone as string) || '',
      userId: (req.query.userId as string) || '',
    }, 400);
  }
});

// 20.3.1j Real Telegram Saved Messages ('me' / InputPeerSelf)
app.get('/api/telegram/user/saved-messages', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const phone = (req.query.phone as string) || '';
    const userId = (req.query.userId as string) || '';

    const connected = resolveConnectedTelegramUser(accountId, phone, userId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        error: '当前账号未在线连接 Telegram MTProto，无法打开官方云端收藏夹 (Saved Messages)。',
      });
    }

    const canonicalSavedChatId = `tg_${connected.userId}`;
    const messages = await syncTelegramUserChatMessages(connected.client, 'me', 30, connected.userId);
    const last = messages.length > 0 ? messages[messages.length - 1] : null;

    return res.json({
      ok: true,
      cloudSynced: true,
      chat: {
        id: canonicalSavedChatId,
        accountId: accountId || `acc_tg_${connected.userId}`,
        title: '已保存消息 (Saved Messages)',
        avatarBg: '#2ba0ff',
        avatarInitial: 'SM',
        isGroup: false,
        isVerified: false,
        lastMessage: last ? (last.isAudio ? '🎤 语音消息' : last.isImage ? '🖼️ 图片' : last.text) : 'Telegram 官方云端收藏与备忘录',
        lastTime: last?.timestamp || '刚刚',
        unreadCount: 0,
        sourceLang: 'Auto',
        targetLang: 'Chinese',
      },
      messages,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '',
      phone: (req.query.phone as string) || '',
      userId: (req.query.userId as string) || '',
    }, 500);
  }
});

// 20.3.1k Edit Telegram Message in Cloud (MTProto messages.EditMessage / Bot editMessageText)
app.post('/api/telegram/user/messages/edit', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, messageId, telegramMessageId, newText, translatedText } = req.body || {};

    if (!chatId || !newText || !String(newText).trim()) {
      return res.status(400).json({ ok: false, error: '目标会话与修改后的消息文本不能为空' });
    }

    const tgMsgId = resolveTelegramMessageNumericId(messageId, telegramMessageId);
    if (!tgMsgId) {
      return res.status(400).json({ ok: false, error: '该消息缺少 Telegram 云端消息 ID，无法同步云端编辑' });
    }

    if (accountId === 'acc_telegram_bot' && process.env.TELEGRAM_BOT_TOKEN) {
      const cleanChatId = String(chatId).replace(/^tg_/, '');
      let isMediaMsg = Boolean(req.body?.isMedia);
      if (!isMediaMsg && messageId) {
        try {
          const existingRow = (await db
            .prepare('SELECT is_image, is_video, is_file, is_audio FROM messages WHERE id = ? LIMIT 1')
            .get(String(messageId))) as any;
          if (existingRow && (existingRow.is_image || existingRow.is_video || existingRow.is_file || existingRow.is_audio)) {
            isMediaMsg = true;
          }
        } catch {}
      }
      const botMethod = isMediaMsg ? 'editMessageCaption' : 'editMessageText';
      const botPayload: Record<string, any> = {
        chat_id: /^-?\d+$/.test(cleanChatId) ? Number(cleanChatId) : cleanChatId,
        message_id: tgMsgId,
        ...(isMediaMsg ? { caption: String(newText).trim() } : { text: String(newText).trim() }),
      };
      const botRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${botMethod}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(botPayload),
      });
      const botJson: any = await botRes.json();
      if (!botJson.ok) {
        return res.status(400).json({ ok: false, error: botJson.description || 'Telegram Bot 编辑消息失败' });
      }
    } else {
      const connected = resolveConnectedTelegramUser(accountId);
      if (!connected || !connected.client) {
        return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法编辑云端消息' });
      }
      const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
      await connected.client.editMessage(inputPeer, {
        message: tgMsgId,
        text: String(newText).trim(),
      });
    }

    try {
      const altChatId = String(chatId).startsWith('tg_') ? String(chatId).replace(/^tg_/, '') : `tg_${chatId}`;
      const scopedAcc = accountId || (req as any).auth?.effectiveAccountId || '';
      const accVariants = scopedAcc ? getScopedAccountIdVariants(scopedAcc) : [];
      const hasTranslatedPatch = typeof translatedText === 'string';
      const nextTransVal = hasTranslatedPatch ? translatedText : '';
      if (accVariants.length > 0) {
        const accPlaceholders = accVariants.map(() => '?').join(', ');
        if (hasTranslatedPatch) {
          await db
            .prepare(
              `UPDATE messages SET text = ?, translated_text = ?, is_edited = 1 WHERE (id = ? OR ((chat_id = ? OR chat_id = ?) AND telegram_message_id = ?)) AND account_id IN (${accPlaceholders})`
            )
            .run(String(newText).trim(), nextTransVal, messageId || '', String(chatId), altChatId, tgMsgId, ...accVariants);
        } else {
          await db
            .prepare(
              `UPDATE messages SET text = ?, is_edited = 1 WHERE (id = ? OR ((chat_id = ? OR chat_id = ?) AND telegram_message_id = ?)) AND account_id IN (${accPlaceholders})`
            )
            .run(String(newText).trim(), messageId || '', String(chatId), altChatId, tgMsgId, ...accVariants);
        }
      } else if (hasTranslatedPatch) {
        await db
          .prepare('UPDATE messages SET text = ?, translated_text = ?, is_edited = 1 WHERE id = ?')
          .run(String(newText).trim(), nextTransVal, messageId || '');
      } else {
        await db
          .prepare('UPDATE messages SET text = ?, is_edited = 1 WHERE id = ?')
          .run(String(newText).trim(), messageId || '');
      }
    } catch {}

    return res.json({ ok: true, cloudSynced: true, telegramMessageId: tgMsgId });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1l Send / Remove Official Telegram Message Reaction (messages.SendReaction)
app.post('/api/telegram/user/messages/react', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, messageId, telegramMessageId, emoji, remove } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法同步云端表情回应' });
    }

    const tgMsgId = resolveTelegramMessageNumericId(messageId, telegramMessageId);
    if (!tgMsgId) {
      return res.status(400).json({ ok: false, error: '该消息缺少 Telegram 云端消息 ID，无法发送表情回应' });
    }

    const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
    await connected.client.invoke(
      new Api.messages.SendReaction({
        peer: inputPeer,
        msgId: tgMsgId,
        reaction: remove || !emoji ? [] : [new Api.ReactionEmoji({ emoticon: String(emoji) })],
        addToRecent: !remove && Boolean(emoji),
      })
    );

    return res.json({ ok: true, cloudSynced: true, telegramMessageId: tgMsgId });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1m Pin / Unpin Telegram Message in Cloud (messages.UpdatePinnedMessage)
app.post('/api/telegram/user/messages/pin', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, messageId, telegramMessageId, pin } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法在云端置顶消息' });
    }

    const tgMsgId = resolveTelegramMessageNumericId(messageId, telegramMessageId);
    if (!tgMsgId) {
      return res.status(400).json({ ok: false, error: '该消息缺少 Telegram 云端消息 ID，无法置顶' });
    }

    const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
    await connected.client.invoke(
      new Api.messages.UpdatePinnedMessage({
        peer: inputPeer,
        id: tgMsgId,
        unpin: !pin,
        silent: false,
      })
    );

    try {
      const altChatId = String(chatId).startsWith('tg_') ? String(chatId).replace(/^tg_/, '') : `tg_${chatId}`;
      const scopedAcc = accountId || (req as any).auth?.effectiveAccountId || '';
      const accVariants = scopedAcc ? getScopedAccountIdVariants(scopedAcc) : [];
      const pinnedFlag = pin ? 1 : 0;
      if (accVariants.length > 0) {
        const accPlaceholders = accVariants.map(() => '?').join(', ');
        await db
          .prepare(
            `UPDATE messages SET is_pinned = ? WHERE (id = ? OR ((chat_id = ? OR chat_id = ?) AND telegram_message_id = ?)) AND account_id IN (${accPlaceholders})`
          )
          .run(pinnedFlag, messageId || '', String(chatId), altChatId, tgMsgId, ...accVariants);
      } else {
        await db
          .prepare('UPDATE messages SET is_pinned = ? WHERE id = ?')
          .run(pinnedFlag, messageId || '');
      }
    } catch {}

    return res.json({ ok: true, cloudSynced: true, pinned: Boolean(pin), telegramMessageId: tgMsgId });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1n Toggle Dialog Pin in Telegram Cloud (messages.ToggleDialogPin)
app.post('/api/telegram/user/dialogs/pin', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, pinned } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法置顶对话' });
    }

    const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
    await connected.client.invoke(
      new Api.messages.ToggleDialogPin({
        peer: new Api.InputDialogPeer({ peer: inputPeer }),
        pinned: Boolean(pinned),
      })
    );

    return res.json({ ok: true, cloudSynced: true, pinned: Boolean(pinned) });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1o Mute / Unmute Specific Dialog in Telegram Cloud (account.UpdateNotifySettings)
app.post('/api/telegram/user/dialogs/mute', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, muted } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法修改对话静音状态' });
    }

    const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
    await connected.client.invoke(
      new Api.account.UpdateNotifySettings({
        peer: new Api.InputNotifyPeer({ peer: inputPeer }),
        settings: new Api.InputPeerNotifySettings({
          silent: Boolean(muted),
          muteUntil: muted ? 2147483647 : 0,
          showPreviews: true,
        }),
      })
    );

    return res.json({ ok: true, cloudSynced: true, muted: Boolean(muted) });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1p Archive / Unarchive Dialog in Telegram Cloud (folders.EditPeerFolders)
app.post('/api/telegram/user/dialogs/archive', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, archived } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法归档对话' });
    }

    const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
    await connected.client.invoke(
      new Api.folders.EditPeerFolders({
        folderPeers: [
          new Api.InputFolderPeer({
            peer: inputPeer,
            folderId: archived ? 1 : 0,
          }),
        ],
      })
    );

    return res.json({ ok: true, cloudSynced: true, archived: Boolean(archived) });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1q Mark Dialog Unread / Read in Telegram Cloud (messages.MarkDialogUnread / markAsRead)
app.post('/api/telegram/user/dialogs/unread', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, unread } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法同步未读状态' });
    }

    const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
    await connected.client.invoke(
      new Api.messages.MarkDialogUnread({
        peer: new Api.InputDialogPeer({ peer: inputPeer }),
        unread: Boolean(unread),
      })
    );
    if (!unread) {
      try {
        await connected.client.markAsRead(inputPeer);
      } catch {}
    }

    return res.json({ ok: true, cloudSynced: true, unread: Boolean(unread) });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1r Clear Chat History in Telegram Cloud (messages.DeleteHistory justClear=true)
app.post('/api/telegram/user/dialogs/clear-history', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, revoke } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法清空云端记录' });
    }

    const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
    await connected.client.invoke(
      new Api.messages.DeleteHistory({
        peer: inputPeer,
        maxId: 0,
        justClear: true,
        revoke: Boolean(revoke),
      })
    );

    try {
      const altChatId = String(chatId).startsWith('tg_') ? String(chatId).replace(/^tg_/, '') : `tg_${chatId}`;
      const accVariants = getScopedAccountIdVariants(accountId || `acc_tg_${connected.userId}`);
      const accPlaceholders = accVariants.map(() => '?').join(', ');
      await db
        .prepare(`DELETE FROM messages WHERE (chat_id = ? OR chat_id = ?) AND account_id IN (${accPlaceholders})`)
        .run(String(chatId), altChatId, ...accVariants);
    } catch {}

    return res.json({ ok: true, cloudSynced: true });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1s Delete Dialog / Leave Group or Channel in Telegram Cloud
app.post('/api/telegram/user/dialogs/delete', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, revoke } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法删除/退出云端对话' });
    }

    const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
    if (inputPeer instanceof Api.InputPeerChannel) {
      await connected.client.invoke(new Api.channels.LeaveChannel({ channel: inputPeer }));
    } else if (inputPeer instanceof Api.InputPeerChat) {
      try {
        await connected.client.invoke(
          new Api.messages.DeleteChatUser({
            chatId: inputPeer.chatId,
            userId: new Api.InputUserSelf(),
            revokeHistory: Boolean(revoke),
          })
        );
      } catch {
        await connected.client.invoke(
          new Api.messages.DeleteHistory({
            peer: inputPeer,
            maxId: 0,
            justClear: false,
            revoke: Boolean(revoke),
          })
        );
      }
    } else {
      await connected.client.invoke(
        new Api.messages.DeleteHistory({
          peer: inputPeer,
          maxId: 0,
          justClear: false,
          revoke: Boolean(revoke),
        })
      );
    }

    try {
      const altChatId = String(chatId).startsWith('tg_') ? String(chatId).replace(/^tg_/, '') : `tg_${chatId}`;
      const accVariants = getScopedAccountIdVariants(accountId || `acc_tg_${connected.userId}`);
      const accPlaceholders = accVariants.map(() => '?').join(', ');
      await db
        .prepare(`DELETE FROM messages WHERE (chat_id = ? OR chat_id = ?) AND account_id IN (${accPlaceholders})`)
        .run(String(chatId), altChatId, ...accVariants);
    } catch {}

    return res.json({ ok: true, cloudSynced: true });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1s2 Mark Dialog Read in Telegram Cloud (markAsRead + clear unread badge)
app.post('/api/telegram/user/dialogs/read', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, maxId } = req.body || {};
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'chatId 不能为空' });
    }

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.json({ ok: false, cloudSynced: false, error: '当前账号未在线连接 Telegram MTProto' });
    }

    const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
    const numericMaxId = Number(maxId);
    await connected.client.markAsRead(
      inputPeer,
      undefined,
      Number.isInteger(numericMaxId) && numericMaxId > 0 ? { maxId: numericMaxId, clearMentions: true } : { clearMentions: true }
    );
    try {
      await connected.client.invoke(
        new Api.messages.MarkDialogUnread({
          peer: new Api.InputDialogPeer({ peer: inputPeer }),
          unread: false,
        })
      );
    } catch {}

    return res.json({ ok: true, cloudSynced: true });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1s3 Batch Delete Messages in Telegram Cloud & DB (supports revoke: boolean + local failed items)
app.post('/api/telegram/user/messages/batch-delete', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const authContext = (req as any).auth;
    const accountId =
      (req.body?.accountId as string) ||
      (req.headers['x-account-id'] as string) ||
      authContext?.effectiveAccountId ||
      '';
    const isMaster = Boolean(authContext?.session?.isMaster);
    const { chatId, items, revoke = true } = req.body || {};

    if (!chatId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: '目标会话与待删除消息列表不能为空' });
    }

    const normalizedItems = items
      .filter((item: any) => item && item.id)
      .map((item: any) => {
        const id = String(item.id);
        const tgId = resolveTelegramMessageNumericId(id, item.telegramMessageId);
        return {
          id,
          tgId,
          isLocalOnly: Boolean(item.localOnly) || !tgId,
        };
      });

    const tgIds = Array.from(
      new Set(normalizedItems.filter((i) => !i.isLocalOnly && i.tgId).map((i) => Number(i.tgId)))
    );
    const isTelegramChat = Boolean(
      String(chatId).startsWith('tg_') || accountId.startsWith('acc_tg_') || accountId === 'acc_telegram_bot'
    );
    let cloudSynced = false;

    if (isTelegramChat && tgIds.length > 0) {
      if (accountId === 'acc_telegram_bot' && process.env.TELEGRAM_BOT_TOKEN) {
        const cleanChatId = String(chatId).replace(/^tg_/, '');
        const numericChatId = /^-?\d+$/.test(cleanChatId) ? Number(cleanChatId) : cleanChatId;
        for (const tgMsgId of tgIds) {
          const botRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: numericChatId, message_id: tgMsgId }),
          });
          const botJson: any = await botRes.json();
          if (!botJson.ok) {
            return res.status(400).json({
              ok: false,
              error: botJson.description || 'Telegram Bot 批量删除失败',
            });
          }
        }
        cloudSynced = true;
      } else {
        const connected = resolveConnectedTelegramUser(accountId);
        if (!connected || !connected.client) {
          return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法批量删除云端消息' });
        }
        const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
        for (let i = 0; i < tgIds.length; i += 100) {
          const chunk = tgIds.slice(i, i + 100);
          await connected.client.deleteMessages(inputPeer, chunk, { revoke: Boolean(revoke) });
        }
        cloudSynced = true;
      }
    }

    try {
      const altChatId = String(chatId).startsWith('tg_') ? String(chatId).replace(/^tg_/, '') : `tg_${chatId}`;
      const accVariants = accountId ? getScopedAccountIdVariants(accountId) : [];
      for (const item of normalizedItems) {
        if (isMaster || accVariants.length === 0) {
          await db.prepare('DELETE FROM messages WHERE id = ?').run(item.id);
          if (item.tgId) {
            await db.prepare('DELETE FROM messages WHERE (chat_id = ? OR chat_id = ?) AND telegram_message_id = ?').run(String(chatId), altChatId, item.tgId);
          }
        } else {
          const accPlaceholders = accVariants.map(() => '?').join(', ');
          await db.prepare(`DELETE FROM messages WHERE id = ? AND account_id IN (${accPlaceholders})`).run(item.id, ...accVariants);
          if (item.tgId) {
            await db.prepare(`DELETE FROM messages WHERE (chat_id = ? OR chat_id = ?) AND telegram_message_id = ? AND account_id IN (${accPlaceholders})`).run(String(chatId), altChatId, item.tgId, ...accVariants);
          }
        }
      }
    } catch {}

    return res.json({
      ok: true,
      cloudSynced,
      deletedCount: normalizedItems.length,
      deletedIds: normalizedItems.map((i) => i.id),
      revoke: Boolean(revoke),
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1s4 Forward Messages in Telegram Cloud (client.forwardMessages)
app.post('/api/telegram/user/messages/forward', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { fromChatId, toChatId, messageIds, telegramMessageIds, dropAuthor = false } = req.body || {};

    if (!fromChatId || !toChatId) {
      return res.status(400).json({ ok: false, error: '来源会话与目标会话不能为空' });
    }

    const tgIdsSet = new Set<number>();
    if (Array.isArray(telegramMessageIds)) {
      for (const raw of telegramMessageIds) {
        const n = Number(raw);
        if (Number.isInteger(n) && n > 0) tgIdsSet.add(n);
      }
    }
    if (Array.isArray(messageIds)) {
      for (const id of messageIds) {
        const n = resolveTelegramMessageNumericId(String(id));
        if (n) tgIdsSet.add(n);
      }
    }

    const tgIds = Array.from(tgIdsSet);
    if (tgIds.length === 0) {
      return res.status(400).json({ ok: false, error: '所选消息缺少有效的 Telegram 云端消息 ID，无法转发' });
    }

    if (accountId === 'acc_telegram_bot' && process.env.TELEGRAM_BOT_TOKEN) {
      const cleanFrom = String(fromChatId).replace(/^tg_/, '');
      const cleanTo = String(toChatId).replace(/^tg_/, '');
      const fromPeerBot = /^-?\d+$/.test(cleanFrom) ? Number(cleanFrom) : cleanFrom;
      const toPeerBot = /^-?\d+$/.test(cleanTo) ? Number(cleanTo) : cleanTo;
      const botMethod = dropAuthor ? 'copyMessage' : 'forwardMessage';
      let forwardedCount = 0;
      for (const tgMsgId of tgIds) {
        const botRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${botMethod}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: toPeerBot,
            from_chat_id: fromPeerBot,
            message_id: tgMsgId,
          }),
        });
        const botJson: any = await botRes.json();
        if (!botJson.ok) {
          return res.status(400).json({
            ok: false,
            error: botJson.description || 'Telegram Bot 转发消息失败',
          });
        }
        forwardedCount++;
      }
      return res.json({ ok: true, cloudSynced: true, forwardedCount });
    }

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法转发消息' });
    }

    const { inputPeer: fromPeer } = await resolveTelegramInputPeer(connected.client, fromChatId, connected.userId);
    const { inputPeer: toPeer } = await resolveTelegramInputPeer(connected.client, toChatId, connected.userId);

    const forwarded = await connected.client.forwardMessages(toPeer, {
      messages: tgIds,
      fromPeer,
      dropAuthor: Boolean(dropAuthor),
    });

    return res.json({
      ok: true,
      cloudSynced: true,
      forwardedCount: Array.isArray(forwarded) ? forwarded.length : tgIds.length,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1t Rename Telegram Contact Remark in Cloud (contacts.AddContact)
app.post('/api/telegram/user/contacts/rename', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, newTitle } = req.body || {};
    const cleanTitle = String(newTitle || '').trim();

    if (!chatId || !cleanTitle) {
      return res.status(400).json({ ok: false, error: '联系人 ID 与新备注名称不能为空' });
    }

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto，无法同步云端联系人备注' });
    }

    const inputUser = await resolveTelegramInputUser(connected.client, chatId);
    if (!inputUser) {
      return res.status(400).json({
        ok: false,
        error: '仅支持为个人 Telegram 联系人设置云端备注名（群组/频道无法直接改备注）',
      });
    }

    let phoneStr = '';
    try {
      const entity: any = await connected.client.getEntity(inputUser);
      if (entity?.phone) {
        phoneStr = String(entity.phone);
      }
    } catch {}

    const parts = cleanTitle.split(/\s+/);
    const firstName = parts[0] || cleanTitle;
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';

    await connected.client.invoke(
      new Api.contacts.AddContact({
        id: inputUser,
        firstName,
        lastName,
        phone: phoneStr,
      })
    );

    try {
      const scopedAccountId =
        (req.body?.accountId as string) ||
        (req.headers['x-account-id'] as string) ||
        `acc_tg_${connected.userId}`;
      const now = Date.now();
      await db
        .prepare('UPDATE account_customer_profiles SET client_name = ?, updated_at = ? WHERE account_id = ? AND chat_id = ?')
        .run(cleanTitle, now, scopedAccountId, chatId);
      await db
        .prepare('UPDATE customer_profiles SET client_name = ?, updated_at = ? WHERE chat_id = ? AND account_id = ?')
        .run(cleanTitle, now, chatId, scopedAccountId);
    } catch {}

    return res.json({ ok: true, cloudSynced: true, title: cleanTitle });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1u Fetch Real Telegram Chat Full Info & Participants (users.GetFullUser / messages.GetFullChat / channels.GetFullChannel + channels.GetParticipants)
app.get('/api/telegram/user/chat-info/:chatId', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        chatId,
        error: '当前账号未在线连接 Telegram MTProto，无法获取真实详情与成员列表',
      });
    }

    const client = connected.client;
    const { inputPeer, rawPeer } = await resolveTelegramInputPeer(client, chatId, connected.userId);
    let entity: any = null;
    try {
      entity = await client.getEntity(rawPeer === 'me' ? 'me' : inputPeer);
    } catch {
      entity = await client.getEntity(rawPeer);
    }

    const canonicalId = chatId.startsWith('tg_') ? chatId : `tg_${chatId}`;

    if (entity instanceof Api.Channel) {
      const isChannel = !entity.megagroup;
      const isGroup = Boolean(entity.megagroup);
      const fullRes: any = await client.invoke(new Api.channels.GetFullChannel({ channel: inputPeer }));
      const fullChat: any = fullRes?.fullChat || {};
      const chatsList: any[] = Array.isArray(fullRes?.chats) ? fullRes.chats : [];
      const channelObj: any = chatsList.find((c) => String(c?.id) === String(entity.id)) || entity;

      const memberCount =
        fullChat?.participantsCount !== undefined && fullChat?.participantsCount !== null
          ? Number(fullChat.participantsCount)
          : (channelObj?.participantsCount ? Number(channelObj.participantsCount) : undefined);
      const onlineCount =
        fullChat?.onlineCount !== undefined && fullChat?.onlineCount !== null
          ? Number(fullChat.onlineCount)
          : undefined;

      const participants: any[] = [];
      let participantsError: string | undefined;

      try {
        const partRes: any = await client.invoke(
          new Api.channels.GetParticipants({
            channel: inputPeer,
            filter: new Api.ChannelParticipantsRecent(),
            offset: 0,
            limit: 100,
            hash: returnBigInt(0),
          })
        );
        const usersMap = new Map<string, any>();
        for (const u of Array.isArray(partRes?.users) ? partRes.users : []) {
          usersMap.set(String(u.id), u);
        }
        for (const p of Array.isArray(partRes?.participants) ? partRes.participants : []) {
          const uid = String(p.userId ?? p.peer?.userId ?? '');
          if (!uid) continue;
          const u = usersMap.get(uid) || {};
          const uStatus = formatTelegramUserStatus(u);
          const displayName =
            [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
            (u.username ? `@${u.username}` : `用户 ${uid}`);
          const role =
            p.className === 'ChannelParticipantCreator'
              ? 'creator'
              : p.className === 'ChannelParticipantAdmin'
                ? 'admin'
                : 'member';
          participants.push({
            id: `tg_${uid}`,
            name: displayName,
            username: u.username ? `@${u.username}` : undefined,
            role,
            isBot: Boolean(u.bot),
            isOnline: uStatus.isOnline,
            statusText: uStatus.statusText,
            avatarUrl: signTelegramResourceUrl(
              `/api/telegram/user/avatar/${encodeURIComponent(uid)}`,
              `acc_tg_${connected.userId}`
            ),
          });
        }
      } catch (pErr: any) {
        const rawErr = String(pErr?.errorMessage || pErr?.message || '');
        participantsError = rawErr.includes('CHAT_ADMIN_REQUIRED')
          ? '需要管理员权限才能查看完整成员列表（Telegram 官方权限限制）'
          : formatTelegramError(pErr);
      }

      return res.json({
        ok: true,
        chatId: canonicalId,
        title: String(channelObj?.title || entity.title || ''),
        username: channelObj?.username ? `@${channelObj.username}` : undefined,
        description: String(fullChat?.about || ''),
        isGroup,
        isChannel,
        isBot: false,
        isVerified: Boolean(channelObj?.verified || entity.verified),
        memberCount,
        onlineCount,
        inviteLink: fullChat?.exportedInvite?.link ? String(fullChat.exportedInvite.link) : undefined,
        participants,
        participantsError,
      });
    }

    if (entity instanceof Api.Chat) {
      const fullRes: any = await client.invoke(new Api.messages.GetFullChat({ chatId: entity.id }));
      const fullChat: any = fullRes?.fullChat || {};
      const chatsList: any[] = Array.isArray(fullRes?.chats) ? fullRes.chats : [];
      const chatObj: any = chatsList.find((c) => String(c?.id) === String(entity.id)) || entity;
      const usersMap = new Map<string, any>();
      for (const u of Array.isArray(fullRes?.users) ? fullRes.users : []) {
        usersMap.set(String(u.id), u);
      }

      const rawParticipants: any[] = Array.isArray(fullChat?.participants?.participants)
        ? fullChat.participants.participants
        : [];
      const participants = rawParticipants.map((p: any) => {
        const uid = String(p.userId ?? '');
        const u = usersMap.get(uid) || {};
        const uStatus = formatTelegramUserStatus(u);
        const displayName =
          [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
          (u.username ? `@${u.username}` : `用户 ${uid}`);
        const role =
          p.className === 'ChatParticipantCreator'
            ? 'creator'
            : p.className === 'ChatParticipantAdmin'
              ? 'admin'
              : 'member';
        return {
          id: `tg_${uid}`,
          name: displayName,
          username: u.username ? `@${u.username}` : undefined,
          role,
          isBot: Boolean(u.bot),
          isOnline: uStatus.isOnline,
          statusText: uStatus.statusText,
          avatarUrl: signTelegramResourceUrl(
            `/api/telegram/user/avatar/${encodeURIComponent(uid)}`,
            `acc_tg_${connected.userId}`
          ),
        };
      });
      const onlineCount = participants.filter((p) => p.isOnline).length;
      const memberCount =
        participants.length > 0
          ? participants.length
          : (chatObj?.participantsCount ? Number(chatObj.participantsCount) : undefined);

      return res.json({
        ok: true,
        chatId: canonicalId,
        title: String(chatObj?.title || entity.title || ''),
        description: String(fullChat?.about || ''),
        isGroup: true,
        isChannel: false,
        isBot: false,
        isVerified: false,
        memberCount,
        onlineCount,
        inviteLink: fullChat?.exportedInvite?.link ? String(fullChat.exportedInvite.link) : undefined,
        participants,
      });
    }

    // Private User / Bot / Saved Messages
    let fullUserRes: any = null;
    try {
      fullUserRes = await client.invoke(
        new Api.users.GetFullUser({
          id: rawPeer === 'me' ? new Api.InputUserSelf() : inputPeer,
        })
      );
    } catch {
      fullUserRes = null;
    }
    const targetUser: any = fullUserRes?.users?.[0] || entity || {};
    const uStatus = formatTelegramUserStatus(targetUser);
    const fullName =
      [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ').trim() ||
      (targetUser.username ? `@${targetUser.username}` : undefined);
    const rawPhone = targetUser.phone ? String(targetUser.phone).trim() : '';
    const formattedPhone = rawPhone ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`) : undefined;

    return res.json({
      ok: true,
      chatId: canonicalId,
      title: fullName,
      username: targetUser.username ? `@${targetUser.username}` : undefined,
      phone: formattedPhone,
      description: String(fullUserRes?.fullUser?.about || ''),
      isGroup: false,
      isChannel: false,
      isBot: Boolean(targetUser.bot),
      isVerified: Boolean(targetUser.verified || String(targetUser.id) === '777000'),
      isOnline: uStatus.isOnline,
      statusText: uStatus.statusText,
      isBlocked: Boolean(fullUserRes?.fullUser?.blocked),
      isContact: Boolean(targetUser.contact),
    });
  } catch (err: any) {
    if (isTelegramSessionExpiredError(err)) {
      const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';
      await markTelegramSessionExpired({ accountId, reason: formatTelegramError(err) });
      return res.status(401).json({ ok: false, code: 'TELEGRAM_SESSION_EXPIRED', error: formatTelegramError(err) });
    }
    return res.status(400).json({ ok: false, error: formatTelegramError(err) });
  }
});

// 20.3.1v Fetch Official Installed Telegram Stickers (messages.GetAllStickers + messages.GetStickerSet)
const telegramStickerThumbCache = new Map<string, { buffer: Buffer; mime: string; expiresAt: number }>();

app.get('/api/telegram/user/stickers', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        packs: [],
        error: '当前账号未在线连接 Telegram MTProto，无法拉取官方贴纸库',
      });
    }

    const client = connected.client;
    const allRes: any = await client.invoke(new Api.messages.GetAllStickers({ hash: returnBigInt(0) }));
    const sets: any[] = Array.isArray(allRes?.sets) ? allRes.sets : [];

    if (sets.length === 0) {
      return res.json({ ok: true, packs: [] });
    }

    const limitSets = sets.slice(0, 12);
    const packs: any[] = [];

    for (const s of limitSets) {
      try {
        const setRes: any = await client.invoke(
          new Api.messages.GetStickerSet({
            stickerset: new Api.InputStickerSetID({
              id: s.id,
              accessHash: s.accessHash,
            }),
            hash: 0,
          })
        );
        const setObj: any = setRes?.set || s;
        const docs: any[] = Array.isArray(setRes?.documents) ? setRes.documents : [];
        const emojiPacks: any[] = Array.isArray(setRes?.packs) ? setRes.packs : [];

        const docEmojiMap = new Map<string, string>();
        for (const ep of emojiPacks) {
          const emoticon = String(ep?.emoticon || '').trim();
          if (!emoticon) continue;
          for (const did of Array.isArray(ep?.documents) ? ep.documents : []) {
            if (!docEmojiMap.has(String(did))) {
              docEmojiMap.set(String(did), emoticon);
            }
          }
        }

        const stickers = docs
          .filter((doc) => doc && doc.id && doc.accessHash)
          .slice(0, 40)
          .map((doc) => {
            const attrs: any[] = Array.isArray(doc.attributes) ? doc.attributes : [];
            const stickerAttr = attrs.find((a) => a.className === 'DocumentAttributeSticker');
            const mimeType = String(doc.mimeType || 'image/webp');
            const docId = String(doc.id);
            const setId = String(setObj.id);
            const setAccessHash = String(setObj.accessHash);
            return {
              docId,
              accessHash: String(doc.accessHash),
              fileReferenceBase64: Buffer.isBuffer(doc.fileReference)
                ? doc.fileReference.toString('base64')
                : '',
              setId,
              setAccessHash,
              shortName: String(setObj.shortName || ''),
              emoji: String(stickerAttr?.alt || docEmojiMap.get(docId) || '✨'),
              mimeType,
              isAnimated: mimeType.includes('tgsticker'),
              isVideo: mimeType.includes('webm'),
              thumbUrl: signTelegramResourceUrl(
                `/api/telegram/user/sticker/${encodeURIComponent(setId)}/${encodeURIComponent(docId)}?accountId=${encodeURIComponent(`acc_tg_${connected.userId}`)}&setAccessHash=${encodeURIComponent(setAccessHash)}`
              ),
            };
          });

        if (stickers.length > 0) {
          packs.push({
            id: String(setObj.id),
            accessHash: String(setObj.accessHash),
            shortName: String(setObj.shortName || ''),
            title: String(setObj.title || setObj.shortName || 'Telegram Sticker Pack'),
            count: Number(setObj.count || stickers.length),
            stickers,
          });
        }
      } catch {
        // skip individual inaccessible sticker pack
      }
    }

    return res.json({ ok: true, packs });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// 20.3.1w Proxy Official Telegram Sticker Preview / Image from MTProto
app.get('/api/telegram/user/sticker/:setId/:docId', async (req: Request, res: Response) => {
  try {
    if (!isAllowedClientOrigin(req)) {
      return res.status(403).send('Forbidden');
    }
    if (!verifySignedTelegramResourceRequest(req) && !(req as any).auth) {
      return res.status(401).send('Unauthorized');
    }

    const { setId, docId } = req.params;
    const setAccessHash = String(req.query.setAccessHash || '');
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';

    const primaryConnected = accountId ? resolveConnectedTelegramUser(accountId) : undefined;
    const candidates: ConnectedTelegramUser[] = [];
    if (primaryConnected) {
      candidates.push(primaryConnected);
    } else if (!accountId) {
      const uniqueConnected = Array.from(
        new Map(Array.from(connectedUserClients.values()).map((u) => [u.userId, u])).values()
      );
      if (uniqueConnected.length > 1) {
        return res.status(400).send('accountId is required in multi-account mode');
      }
      if (uniqueConnected.length === 1) {
        candidates.push(uniqueConnected[0]);
      }
    }
    if (candidates.length === 0) {
      return res.status(404).send('No active Telegram client connected');
    }

    const cacheAccountScope = accountId || `acc_tg_${candidates[0].userId}`;
    const cacheKey = `${cacheAccountScope}:${setId}:${docId}`;
    const now = Date.now();

    const cached = telegramStickerThumbCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.setHeader('Content-Type', cached.mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(cached.buffer);
    }

    for (const candidate of candidates) {
      if (!candidate.client || !setAccessHash) continue;
      try {
        const setRes: any = await candidate.client.invoke(
          new Api.messages.GetStickerSet({
            stickerset: new Api.InputStickerSetID({
              id: returnBigInt(setId),
              accessHash: returnBigInt(setAccessHash),
            }),
            hash: 0,
          })
        );
        const doc: any = (Array.isArray(setRes?.documents) ? setRes.documents : []).find(
          (d: any) => String(d?.id) === String(docId)
        );
        if (!doc) continue;

        const mimeType = String(doc.mimeType || '').toLowerCase();
        let buffer: Buffer | undefined;
        let outMime = 'image/webp';

        if (!mimeType || mimeType === 'image/webp' || mimeType === 'image/png' || mimeType === 'image/jpeg') {
          buffer = (await candidate.client.downloadMedia(doc, {})) as Buffer;
          outMime = mimeType || 'image/webp';
        } else if (Array.isArray(doc.thumbs) && doc.thumbs.length > 0) {
          const validThumbs = doc.thumbs.filter((t: any) => t && t.className !== 'PhotoPathSize');
          const bestThumb = validThumbs[validThumbs.length - 1];
          if (bestThumb) {
            buffer = (await candidate.client.downloadMedia(doc, { thumb: bestThumb })) as Buffer;
            outMime = 'image/webp';
          }
        }

        if (buffer && Buffer.isBuffer(buffer) && buffer.length > 0) {
          telegramStickerThumbCache.set(cacheKey, {
            buffer,
            mime: outMime,
            expiresAt: now + 3600 * 1000,
          });
          if (telegramStickerThumbCache.size > 200) {
            const oldestKey = telegramStickerThumbCache.keys().next().value;
            if (oldestKey) telegramStickerThumbCache.delete(oldestKey);
          }
          res.setHeader('Content-Type', outMime);
          res.setHeader('Cache-Control', 'private, max-age=3600');
          return res.send(buffer);
        }
      } catch {
        // try next candidate
      }
    }

    return res.status(404).send('Sticker not found');
  } catch {
    return res.status(404).send('Sticker not found');
  }
});

// 20.3.1x Send Real Official Telegram Sticker via messages.SendMedia
app.post('/api/telegram/user/send-sticker', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const {
      chatId,
      docId,
      accessHash,
      fileReferenceBase64,
      setId,
      setAccessHash,
      replyToMsgId,
    } = req.body || {};

    if (!chatId || !docId || !accessHash) {
      return res.status(400).json({ ok: false, error: '目标会话与官方贴纸文档参数不能为空' });
    }

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        error: '当前账号未在线连接 Telegram MTProto，无法发送官方贴纸',
      });
    }

    const client = connected.client;
    const { inputPeer } = await resolveTelegramInputPeer(client, chatId, connected.userId);

    const invokeSendSticker = async (fileRefBuf: Buffer) => {
      return await client.invoke(
        new Api.messages.SendMedia({
          peer: inputPeer,
          ...(replyToMsgId
            ? { replyTo: new Api.InputReplyToMessage({ replyToMsgId: Number(replyToMsgId) }) }
            : {}),
          media: new Api.InputMediaDocument({
            id: new Api.InputDocument({
              id: returnBigInt(String(docId)),
              accessHash: returnBigInt(String(accessHash)),
              fileReference: fileRefBuf,
            }),
          }),
          message: '',
          randomId: generateRandomLong(),
        })
      );
    };

    let updates: any;
    try {
      updates = await invokeSendSticker(Buffer.from(String(fileReferenceBase64 || ''), 'base64'));
    } catch (sendErr: any) {
      const msg = String(sendErr?.errorMessage || sendErr?.message || '');
      if (msg.includes('FILE_REFERENCE_EXPIRED') && setId && setAccessHash) {
        const refreshedSet: any = await client.invoke(
          new Api.messages.GetStickerSet({
            stickerset: new Api.InputStickerSetID({
              id: returnBigInt(String(setId)),
              accessHash: returnBigInt(String(setAccessHash)),
            }),
            hash: 0,
          })
        );
        const refreshedDoc: any = (Array.isArray(refreshedSet?.documents) ? refreshedSet.documents : []).find(
          (d: any) => String(d?.id) === String(docId)
        );
        if (!refreshedDoc || !Buffer.isBuffer(refreshedDoc.fileReference)) {
          throw sendErr;
        }
        updates = await invokeSendSticker(refreshedDoc.fileReference);
      } else {
        throw sendErr;
      }
    }

    let telegramMessageId: number | undefined;
    if (typeof updates?.id === 'number') {
      telegramMessageId = updates.id;
    } else if (Array.isArray(updates?.updates)) {
      for (const u of updates.updates) {
        if (typeof u?.id === 'number' && u.className === 'UpdateMessageID') {
          telegramMessageId = u.id;
          break;
        }
        if (typeof u?.message?.id === 'number') {
          telegramMessageId = u.message.id;
          break;
        }
      }
    }

    return res.json({
      ok: true,
      cloudSynced: true,
      deliveryStatus: 'delivered',
      telegramMessageId,
    });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 400);
  }
});

// Helper to resolve connected MTProto client by accountId / phone / userId
function resolveConnectedTelegramUser(accountId?: string, phone?: string, userId?: string): ConnectedTelegramUser | undefined {
  let connected: ConnectedTelegramUser | undefined =
    (accountId ? connectedUserClients.get(accountId) : undefined) ||
    (phone ? connectedUserClients.get(phone) : undefined) ||
    (userId ? connectedUserClients.get(String(userId)) : undefined);

  if (!connected && (accountId || phone || userId)) {
    const normalizedAccId = accountId ? String(accountId).replace(/^acc_tg_/, '').replace(/^tg_/, '') : '';
    connected = Array.from(connectedUserClients.values()).find(
      (u) =>
        (accountId &&
          (u.userId === accountId ||
            u.userId === normalizedAccId ||
            u.phone === accountId ||
            `acc_tg_${u.userId}` === accountId ||
            `tg_${u.userId}` === accountId)) ||
        (phone && u.phone === phone) ||
        (userId && u.userId === String(userId))
    );
  }
  return connected;
}

async function resolveTelegramInputUser(client: TelegramClient, peerRef: string): Promise<Api.InputUser | null> {
  const clean = String(peerRef || '').trim();
  if (!clean) return null;
  const candidates: any[] = [];
  const stripped = clean.replace(/^tg_/, '').replace(/^chat_contact_/, '');
  const isNumericId = /^-?\d+$/.test(stripped);
  if (isNumericId) {
    candidates.push(Number(stripped));
  }
  if (clean.startsWith('@')) {
    candidates.push(clean.slice(1));
  } else {
    candidates.push(clean);
  }
  const cleanLower = clean.replace(/^@/, '').toLowerCase();

  const matchUserFromList = (users: any[]): Api.InputUser | null => {
    for (const u of users) {
      if (!u || u.id === undefined) continue;
      const uidStr = String(u.id);
      const uname = typeof u.username === 'string' ? u.username.toLowerCase() : '';
      if ((isNumericId && uidStr === stripped) || (cleanLower && uname && uname === cleanLower)) {
        if (u.accessHash !== undefined && u.accessHash !== null) {
          return new Api.InputUser({
            userId: u.id,
            accessHash: u.accessHash,
          });
        }
      }
    }
    return null;
  };

  const tryResolve = async (): Promise<Api.InputUser | null> => {
    for (const cand of candidates) {
      try {
        const inputEntity = await client.getInputEntity(cand);
        if (inputEntity instanceof Api.InputUser) return inputEntity;
        if (inputEntity instanceof Api.InputPeerUser) {
          return new Api.InputUser({
            userId: inputEntity.userId,
            accessHash: inputEntity.accessHash,
          });
        }
      } catch {}
    }
    return null;
  };

  const direct = await tryResolve();
  if (direct) return direct;

  // Fallback 1: refresh contacts entity cache and scan returned users directly
  try {
    const contactsRes: any = await client.invoke(new Api.contacts.GetContacts({ hash: BigInt(0) as any }));
    const matched = matchUserFromList(Array.isArray(contactsRes?.users) ? contactsRes.users : []);
    if (matched) return matched;
  } catch {}
  const afterContacts = await tryResolve();
  if (afterContacts) return afterContacts;

  // Fallback 2: scan Telegram cloud blacklist so deleted-chat strangers can still be unblocked after restart
  try {
    let offset = 0;
    const pageLimit = 100;
    for (let page = 0; page < 10; page++) {
      const blockedRes: any = await client.invoke(
        new Api.contacts.GetBlocked({ offset, limit: pageLimit })
      );
      const users: any[] = Array.isArray(blockedRes?.users) ? blockedRes.users : [];
      const matched = matchUserFromList(users);
      if (matched) return matched;
      if (users.length < pageLimit) break;
      offset += pageLimit;
    }
  } catch {}
  const afterBlocked = await tryResolve();
  if (afterBlocked) return afterBlocked;

  // Fallback 3: resolve public @username via contacts.ResolveUsername
  if (!isNumericId && cleanLower) {
    try {
      const resolved: any = await client.invoke(
        new Api.contacts.ResolveUsername({ username: cleanLower })
      );
      const matched = matchUserFromList(Array.isArray(resolved?.users) ? resolved.users : []);
      if (matched) return matched;
    } catch {}
  }

  // Fallback 4: refresh recent dialogs entity cache
  try {
    await client.getDialogs({ limit: 80 });
  } catch {}
  return await tryResolve();
}

async function fetchAllBlockedUsers(client: TelegramClient): Promise<{
  users: any[];
  blockedIdSet: Set<string>;
}> {
  const userMap = new Map<string, any>();
  const blockedIdSet = new Set<string>();
  const pageLimit = 100;
  let offset = 0;

  for (let page = 0; page < 10; page++) {
    const blockedRes: any = await client.invoke(
      new Api.contacts.GetBlocked({
        offset,
        limit: pageLimit,
      })
    );
    const users: any[] = Array.isArray(blockedRes?.users) ? blockedRes.users : [];
    const peers: any[] = Array.isArray(blockedRes?.blocked) ? blockedRes.blocked : [];
    for (const bp of peers) {
      if (bp?.peerId?.userId !== undefined) {
        blockedIdSet.add(String(bp.peerId.userId));
      }
    }
    for (const u of users) {
      if (u && u.id !== undefined) {
        const uid = String(u.id);
        userMap.set(uid, u);
        if (peers.length === 0) {
          blockedIdSet.add(uid);
        }
      }
    }
    const totalCount = typeof blockedRes?.count === 'number' ? blockedRes.count : undefined;
    offset += peers.length > 0 ? peers.length : users.length;
    if (users.length === 0 && peers.length === 0) break;
    if (totalCount !== undefined && offset >= totalCount) break;
    if (peers.length < pageLimit && users.length < pageLimit) break;
  }

  return {
    users: Array.from(userMap.values()),
    blockedIdSet,
  };
}

function pickAvatarBg(idStr: string): string {
  const palette = ['#2481cc', '#7bc862', '#e17076', '#a695e7', '#65aadd', '#ee7aae', '#6ec9cb', '#faa774'];
  let sum = 0;
  for (let i = 0; i < idStr.length; i++) sum += idStr.charCodeAt(i);
  return palette[sum % palette.length];
}

function mapTelegramUserToContact(
  u: any,
  ownerUserId?: string,
  options?: { isBlocked?: boolean; isContact?: boolean }
) {
  const uid = String(u.id);
  const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || (u.username ? `@${u.username}` : `TG_${uid}`);
  const uStatus = formatTelegramUserStatus(u);

  return {
    id: `tg_${uid}`,
    name: fullName,
    phone: u.phone ? (String(u.phone).startsWith('+') ? String(u.phone) : `+${u.phone}`) : undefined,
    username: u.username ? `@${u.username}` : undefined,
    avatarUrl: signTelegramResourceUrl(
      `/api/telegram/user/avatar/${encodeURIComponent(uid)}`,
      ownerUserId ? `acc_tg_${ownerUserId}` : ''
    ),
    avatarBg: pickAvatarBg(uid),
    avatarInitial: (fullName.slice(0, 2) || 'TG').toUpperCase(),
    status: uStatus.isOnline ? ('online' as const) : ('offline' as const),
    statusText: uStatus.statusText,
    ...(typeof options?.isBlocked === 'boolean' ? { isBlocked: options.isBlocked } : {}),
    ...(typeof options?.isContact === 'boolean' ? { isContact: options.isContact } : { isContact: Boolean(u.contact) }),
  };
}

// 20.3.2 Sync real contacts from Telegram Cloud MTProto (contacts.GetContacts + contacts.GetBlocked)
app.get('/api/telegram/user/contacts', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.json({
        ok: false,
        cloudSynced: false,
        contacts: [],
        error: '当前账号未在线连接 Telegram MTProto，请先登录后再同步云端通讯录',
      });
    }

    const [contactsSettled, blockedSettled] = await Promise.allSettled([
      connected.client.invoke(new Api.contacts.GetContacts({ hash: BigInt(0) as any })),
      fetchAllBlockedUsers(connected.client),
    ]);

    if (contactsSettled.status === 'rejected') {
      throw contactsSettled.reason;
    }

    const result: any = contactsSettled.value;
    const blockedIdSet =
      blockedSettled.status === 'fulfilled' ? blockedSettled.value.blockedIdSet : new Set<string>();

    const users: any[] = Array.isArray(result?.users) ? result.users : [];
    const contacts = users
      .filter((u) => u && !u.deleted && !u.self && String(u.id) !== connected.userId)
      .map((u) =>
        mapTelegramUserToContact(u, connected.userId, {
          isBlocked: blockedIdSet.has(String(u.id)),
          isContact: true,
        })
      );

    return res.json({ ok: true, cloudSynced: true, contacts });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 500);
  }
});

// 20.3.2.1 Search global Telegram users & contacts via MTProto (contacts.Search + contacts.ResolvePhone)
app.get('/api/telegram/user/contacts/search', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return res.json({ ok: true, contacts: [] });
    }
    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        contacts: [],
        error: '当前账号未在线连接 Telegram MTProto，无法执行云端用户搜索',
      });
    }

    const compactPhone = q.replace(/[\s\-\(\)\.]/g, '');
    const isInternationalPhoneQuery = /^(\+|00)\d{6,15}$/.test(compactPhone);

    const [searchSettled, phoneSettled, blockedSettled] = await Promise.allSettled([
      connected.client.invoke(
        new Api.contacts.Search({
          q: q.replace(/^@/, ''),
          limit: 20,
        })
      ),
      isInternationalPhoneQuery
        ? connected.client.invoke(
            new Api.contacts.ResolvePhone({
              phone: normalizePhoneNumber(compactPhone),
            })
          )
        : Promise.resolve(null),
      fetchAllBlockedUsers(connected.client),
    ]);

    if (searchSettled.status === 'rejected' && (!isInternationalPhoneQuery || phoneSettled.status === 'rejected')) {
      throw searchSettled.reason;
    }

    const searchUsers: any[] =
      searchSettled.status === 'fulfilled' && Array.isArray((searchSettled.value as any)?.users)
        ? (searchSettled.value as any).users
        : [];
    const phoneUsers: any[] =
      phoneSettled.status === 'fulfilled' && Array.isArray((phoneSettled.value as any)?.users)
        ? (phoneSettled.value as any).users
        : [];
    const blockedIdSet =
      blockedSettled.status === 'fulfilled' ? blockedSettled.value.blockedIdSet : new Set<string>();

    const seen = new Set<string>();
    const combinedUsers = [...phoneUsers, ...searchUsers];
    const contacts = combinedUsers
      .filter((u) => {
        if (!u || u.deleted || u.self || String(u.id) === connected.userId) return false;
        const uid = String(u.id);
        if (seen.has(uid)) return false;
        seen.add(uid);
        return true;
      })
      .map((u) =>
        mapTelegramUserToContact(u, connected.userId, {
          isContact: Boolean(u.contact),
          isBlocked: blockedIdSet.has(String(u.id)),
        })
      );

    return res.json({ ok: true, cloudSynced: true, contacts });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 500);
  }
});

// 20.3.2.2 Fetch real Telegram Blacklist / Blocked Users via MTProto (contacts.GetBlocked paginated)
app.get('/api/telegram/user/contacts/blocked', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        blocked: [],
        error: '当前账号未在线连接 Telegram MTProto，无法拉取黑名单列表',
      });
    }

    const { users, blockedIdSet } = await fetchAllBlockedUsers(connected.client);
    const blocked = users
      .filter((u) => u && !u.deleted && (blockedIdSet.size === 0 || blockedIdSet.has(String(u.id))))
      .map((u) => mapTelegramUserToContact(u, connected.userId, { isBlocked: true }));

    return res.json({ ok: true, cloudSynced: true, blocked });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.query.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 500);
  }
});

// 20.3.3 Add/Import real contact to Telegram Cloud MTProto (contacts.ImportContacts / contacts.AddContact)
app.post('/api/telegram/user/contacts/add', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { name, phone, username } = req.body || {};
    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        cloudSynced: false,
        error: '当前账号未在线连接 Telegram MTProto，无法添加至云端通讯录。请先登录个人 Telegram 账号。',
      });
    }

    const cleanName = typeof name === 'string' ? name.trim() : '';
    const nameParts = cleanName ? cleanName.split(/\s+/) : ['Telegram'];
    const firstName = nameParts[0] || 'Telegram';
    const lastName = nameParts.slice(1).join(' ');
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    const cleanUsername = typeof username === 'string' ? username.trim().replace(/^@/, '') : '';

    if (!cleanPhone && !cleanUsername) {
      return res.status(400).json({
        ok: false,
        cloudSynced: false,
        error: '同步至 Telegram 云端通讯录需要填写对方的手机号或 @用户名',
      });
    }

    if (cleanPhone) {
      const compactPhone = cleanPhone.replace(/[\s\-\(\)\.]/g, '');
      if (!/^(\+|00)\d{6,15}$/.test(compactPhone)) {
        return res.status(400).json({
          ok: false,
          cloudSynced: false,
          error: '手机号必须包含国际区号（例如 +8613800000000）',
        });
      }
    }

    let resolvedUser: any = null;

    if (cleanPhone) {
      const normalized = normalizePhoneNumber(cleanPhone) || cleanPhone;
      const importRes: any = await connected.client.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({
              clientId: BigInt(Date.now()) as any,
              phone: normalized,
              firstName,
              lastName,
            }),
          ],
        })
      );
      if (Array.isArray(importRes?.users) && importRes.users.length > 0) {
        resolvedUser = importRes.users[0];
      }
    }

    if (!resolvedUser && cleanUsername) {
      try {
        const inputUser = await resolveTelegramInputUser(connected.client, cleanUsername);
        if (inputUser) {
          const addRes: any = await connected.client.invoke(
            new Api.contacts.AddContact({
              id: inputUser,
              firstName,
              lastName,
              phone: cleanPhone || '',
              addPhonePrivacyException: false,
            })
          );
          if (Array.isArray(addRes?.users) && addRes.users.length > 0) {
            resolvedUser = addRes.users[0];
          } else {
            resolvedUser = await connected.client.getEntity(cleanUsername);
          }
        }
      } catch (uErr: any) {
        return res.status(400).json({
          ok: false,
          cloudSynced: false,
          error: `无法通过用户名 @${cleanUsername} 添加联系人: ${uErr?.message || '用户不存在'}`,
        });
      }
    }

    if (!resolvedUser) {
      return res.status(404).json({
        ok: false,
        cloudSynced: false,
        error: '该手机号尚未注册 Telegram，或对方隐私设置禁止通过手机号匹配添加（可尝试填写对方 @用户名）',
      });
    }

    const contact = mapTelegramUserToContact(resolvedUser, connected.userId, { isContact: true });
    return res.json({ ok: true, cloudSynced: true, contact });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 500);
  }
});

// 20.3.3.1 Delete contact from Telegram Cloud MTProto (contacts.DeleteContacts)
app.post('/api/telegram/user/contacts/delete', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const chatId = req.body?.chatId;
    if (!chatId) {
      return res.status(400).json({ ok: false, error: '联系人 ID 为必填项' });
    }
    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto' });
    }
    const inputUser = await resolveTelegramInputUser(connected.client, String(chatId));
    if (!inputUser) {
      return res.status(400).json({ ok: false, error: '未能解析该联系人的 Telegram 输入用户对象' });
    }
    await connected.client.invoke(
      new Api.contacts.DeleteContacts({
        id: [inputUser],
      })
    );
    return res.json({ ok: true, cloudSynced: true });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 500);
  }
});

// 20.3.3.2 Block contact in Telegram Cloud MTProto (contacts.Block)
app.post('/api/telegram/user/contacts/block', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const chatId = req.body?.chatId;
    if (!chatId) {
      return res.status(400).json({ ok: false, error: '联系人 ID 为必填项' });
    }
    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto' });
    }
    const inputUser = await resolveTelegramInputUser(connected.client, String(chatId));
    if (!inputUser) {
      return res.status(400).json({ ok: false, error: '未能解析该联系人的 Telegram 输入用户对象' });
    }
    await connected.client.invoke(
      new Api.contacts.Block({
        id: inputUser,
      })
    );
    return res.json({ ok: true, cloudSynced: true });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 500);
  }
});

// 20.3.3.3 Unblock contact in Telegram Cloud MTProto (contacts.Unblock)
app.post('/api/telegram/user/contacts/unblock', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const chatId = req.body?.chatId;
    if (!chatId) {
      return res.status(400).json({ ok: false, error: '联系人 ID 为必填项' });
    }
    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({ ok: false, error: '当前账号未在线连接 Telegram MTProto' });
    }
    const inputUser = await resolveTelegramInputUser(connected.client, String(chatId));
    if (!inputUser) {
      return res.status(400).json({ ok: false, error: '未能解析该联系人的 Telegram 输入用户对象' });
    }
    await connected.client.invoke(
      new Api.contacts.Unblock({
        id: inputUser,
      })
    );
    return res.json({ ok: true, cloudSynced: true });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 500);
  }
});

// 20.3.4 Create real group / supergroup on Telegram Cloud MTProto
app.post('/api/telegram/user/create-group', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const memberPeers: Array<{ id?: string; username?: string; phone?: string }> = Array.isArray(req.body?.memberPeers)
      ? req.body.memberPeers
      : [];

    if (!title) {
      return res.status(400).json({ ok: false, cloudSynced: false, error: '群组名称不能为空' });
    }

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        cloudSynced: false,
        error: '当前账号未在线连接 Telegram MTProto，无法在云端创建真实群组',
      });
    }

    const resolvedInputUsers: Api.InputUser[] = [];
    for (const peer of memberPeers) {
      let inputUser: Api.InputUser | null = null;
      if (peer.username) inputUser = await resolveTelegramInputUser(connected.client, peer.username);
      if (!inputUser && peer.id && /^tg_-?\d+$/.test(peer.id)) {
        inputUser = await resolveTelegramInputUser(connected.client, peer.id);
      }
      if (!inputUser && peer.phone) {
        inputUser = await resolveTelegramInputUser(connected.client, peer.phone);
      }
      if (inputUser) resolvedInputUsers.push(inputUser);
    }

    let rawDialogId = '';
    let invitedCount = 0;
    if (resolvedInputUsers.length > 0) {
      const createRes: any = await connected.client.invoke(
        new Api.messages.CreateChat({
          users: resolvedInputUsers,
          title,
        })
      );
      const chatObj = createRes?.updates?.chats?.[0] || createRes?.chats?.[0];
      if (!chatObj?.id) {
        throw new Error('Telegram 云端未返回新群组 ID');
      }
      rawDialogId = chatObj.className === 'Channel' ? `-100${chatObj.id}` : `-${chatObj.id}`;
      invitedCount = resolvedInputUsers.length;
    } else {
      const superRes: any = await connected.client.invoke(
        new Api.channels.CreateChannel({
          megagroup: true,
          title,
          about: '',
        })
      );
      const chObj = superRes?.chats?.[0];
      if (!chObj?.id) {
        throw new Error('Telegram 云端未返回新超级群组 ID');
      }
      rawDialogId = `-100${chObj.id}`;
    }

    const chat = {
      id: `tg_${rawDialogId}`,
      accountId: `acc_tg_${connected.userId}`,
      title,
      avatarUrl: signTelegramResourceUrl(
        `/api/telegram/user/avatar/${encodeURIComponent(rawDialogId)}`,
        `acc_tg_${connected.userId}`
      ),
      avatarBg: pickAvatarBg(rawDialogId),
      avatarInitial: title.slice(0, 2).toUpperCase(),
      isGroup: true,
      memberCount: invitedCount + 1,
      lastMessage: invitedCount > 0 ? `已在 Telegram 云端建群并邀请 ${invitedCount} 位成员` : '已在 Telegram 云端创建超级群组',
      lastTime: '刚刚',
      unreadCount: 0,
      sourceLang: 'Auto',
      targetLang: 'Chinese',
    };

    return res.json({ ok: true, cloudSynced: true, invitedCount, chat });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 500);
  }
});

// 20.3.5 Create real broadcast channel on Telegram Cloud MTProto
app.post('/api/telegram/user/create-channel', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const channelType = req.body?.channelType === 'private' ? 'private' : 'public';
    const customLink = typeof req.body?.customLink === 'string' ? req.body.customLink.trim() : '';

    if (!title) {
      return res.status(400).json({ ok: false, cloudSynced: false, error: '频道名称不能为空' });
    }

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        cloudSynced: false,
        error: '当前账号未在线连接 Telegram MTProto，无法在云端创建真实频道',
      });
    }

    const createRes: any = await connected.client.invoke(
      new Api.channels.CreateChannel({
        broadcast: true,
        title,
        about: description,
      })
    );
    const createdChannel = createRes?.chats?.[0];
    if (!createdChannel?.id) {
      throw new Error('Telegram 云端未返回新频道 ID');
    }

    const rawDialogId = `-100${createdChannel.id}`;
    let finalUsername: string | undefined;
    let usernameWarning: string | undefined;

    if (channelType === 'public' && customLink) {
      const cleanUsername = customLink
        .replace(/^https?:\/\/t\.me\//i, '')
        .replace(/^t\.me\//i, '')
        .replace(/^@/, '')
        .trim();
      if (cleanUsername) {
        try {
          await connected.client.invoke(
            new Api.channels.UpdateUsername({
              channel: new Api.InputChannel({
                channelId: createdChannel.id,
                accessHash: createdChannel.accessHash,
              }),
              username: cleanUsername,
            })
          );
          finalUsername = `@${cleanUsername}`;
        } catch (uErr: any) {
          const msg = String(uErr?.message || uErr || '');
          usernameWarning = msg.includes('USERNAME_OCCUPIED')
            ? `频道已在云端创建，但公开链接 @${cleanUsername} 已被占用`
            : msg.includes('USERNAME_INVALID')
              ? `频道已在云端创建，但公开链接 @${cleanUsername} 格式无效`
              : msg.includes('CHANNELS_ADMIN_PUBLIC_TOO_MUCH')
                ? '频道已在云端创建，但该账号名下公开频道数量已达 Telegram 上限'
                : `频道已在云端创建，但设置公开链接失败: ${msg}`;
        }
      }
    }

    const chat = {
      id: `tg_${rawDialogId}`,
      accountId: `acc_tg_${connected.userId}`,
      title,
      avatarUrl: signTelegramResourceUrl(
        `/api/telegram/user/avatar/${encodeURIComponent(rawDialogId)}`,
        `acc_tg_${connected.userId}`
      ),
      avatarBg: pickAvatarBg(rawDialogId),
      avatarInitial: title.slice(0, 2).toUpperCase(),
      isGroup: false,
      isChannel: true,
      description,
      username: finalUsername,
      memberCount: 1,
      lastMessage: '已在 Telegram 云端创建频道，可立即发布广播消息',
      lastTime: '刚刚',
      unreadCount: 0,
      sourceLang: 'Auto',
      targetLang: 'Chinese',
    };

    return res.json({ ok: true, cloudSynced: true, chat, usernameWarning });
  } catch (err: any) {
    return await handleMtprotoRouteError(res, err, {
      accountId: (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '',
    }, 500);
  }
});

// 20.3.6 Real Telegram VoIP Call Signaling via MTProto (messages.GetDhConfig + phone.RequestCall / DiscardCall)
interface ActiveTelegramCallSession {
  callId: string;
  tgCallId: any;
  accessHash: any;
  client: TelegramClient;
  status: 'ringing' | 'accepted' | 'discarded' | 'failed';
  startedAt: number;
  acceptedAt?: number;
  endedReason?: string;
}
const activeTelegramCalls = new Map<string, ActiveTelegramCallSession>();

function bufferToBigInt(buf: Buffer): bigint {
  if (!buf || buf.length === 0) return 0n;
  return BigInt('0x' + buf.toString('hex'));
}

function bigIntTo256ByteBuffer(val: bigint): Buffer {
  let hex = val.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  const raw = Buffer.from(hex, 'hex');
  if (raw.length === 256) return raw;
  if (raw.length > 256) return raw.subarray(raw.length - 256);
  const out = Buffer.alloc(256, 0);
  raw.copy(out, 256 - raw.length);
  return out;
}

function modPowBigInt(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function ensurePhoneCallListener(client: TelegramClient) {
  if ((client as any)._hasTgProCallListener) return;
  (client as any)._hasTgProCallListener = true;
  client.addEventHandler((update: any) => {
    try {
      if (update?.className !== 'UpdatePhoneCall' && !(update instanceof Api.UpdatePhoneCall)) return;
      const phoneCall = update.phoneCall;
      if (!phoneCall?.id) return;
      const tgIdStr = String(phoneCall.id);
      for (const session of activeTelegramCalls.values()) {
        if (String(session.tgCallId) === tgIdStr) {
          if (phoneCall.className === 'PhoneCallAccepted' || phoneCall.className === 'PhoneCall') {
            session.status = 'accepted';
            if (!session.acceptedAt) session.acceptedAt = Date.now();
          } else if (phoneCall.className === 'PhoneCallDiscarded') {
            session.status = 'discarded';
            const reasonClass = phoneCall.reason?.className || '';
            session.endedReason =
              reasonClass === 'PhoneCallDiscardReasonBusy'
                ? '对方忙线或已拒接'
                : reasonClass === 'PhoneCallDiscardReasonMissed'
                  ? '对方未接听'
                  : '通话已挂断';
          } else if (phoneCall.className === 'PhoneCallWaiting') {
            session.status = 'ringing';
          }
        }
      }
    } catch {}
  }, new Raw({}));
}

app.post('/api/telegram/user/call/start', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const accountId = (req.body?.accountId as string) || (req.headers['x-account-id'] as string) || '';
    const { chatId, username, phone } = req.body || {};

    const connected = resolveConnectedTelegramUser(accountId);
    if (!connected || !connected.client) {
      return res.status(400).json({
        ok: false,
        cloudSynced: false,
        error: '当前账号未在线连接 Telegram MTProto，无法向对方客户端发起真实语音呼叫',
      });
    }

    let inputUser: Api.InputUser | null = null;
    if (chatId) inputUser = await resolveTelegramInputUser(connected.client, String(chatId));
    if (!inputUser && username) inputUser = await resolveTelegramInputUser(connected.client, String(username));
    if (!inputUser && phone) inputUser = await resolveTelegramInputUser(connected.client, String(phone));

    if (!inputUser) {
      return res.status(400).json({
        ok: false,
        cloudSynced: false,
        error: '未匹配到有效的 Telegram 个人用户（仅支持向真实私聊联系人发起 1 对 1 语音呼叫，不支持群组/频道）',
      });
    }

    ensurePhoneCallListener(connected.client);

    const dhConfig: any = await connected.client.invoke(
      new Api.messages.GetDhConfig({ version: 0, randomLength: 256 })
    );
    const pBuf = Buffer.isBuffer(dhConfig?.p) ? dhConfig.p : Buffer.from(dhConfig?.p || []);
    const pBig = bufferToBigInt(pBuf);
    const gBig = BigInt(dhConfig?.g || 2);
    const aBig = bufferToBigInt(crypto.randomBytes(256));
    const gABuf = bigIntTo256ByteBuffer(modPowBigInt(gBig, aBig, pBig));
    const gAHash = crypto.createHash('sha256').update(gABuf).digest();

    const callRes: any = await connected.client.invoke(
      new Api.phone.RequestCall({
        userId: inputUser,
        randomId: crypto.randomInt(1, 0x7fffffff),
        gAHash,
        protocol: new Api.PhoneCallProtocol({
          minLayer: 92,
          maxLayer: 92,
          udpP2p: true,
          udpReflector: true,
          libraryVersions: ['4.0.0'],
        }),
      })
    );

    const phoneCallObj = callRes?.phoneCall;
    if (!phoneCallObj?.id) {
      throw new Error('Telegram 云端未返回通话信令句柄');
    }

    const callId = `call_${String(phoneCallObj.id)}_${Date.now()}`;
    activeTelegramCalls.set(callId, {
      callId,
      tgCallId: phoneCallObj.id,
      accessHash: phoneCallObj.accessHash,
      client: connected.client,
      status: 'ringing',
      startedAt: Date.now(),
    });

    return res.json({
      ok: true,
      cloudSynced: true,
      callId,
      tgCallId: String(phoneCallObj.id),
      status: 'ringing',
    });
  } catch (err: any) {
    const msg = String(err?.message || err || '发起 Telegram 语音呼叫失败');
    const friendly = msg.includes('USER_PRIVACY_RESTRICTED')
      ? '对方隐私设置限制了语音来电'
      : msg.includes('PARTICIPANT_VERSION_OUTDATED')
        ? '对方客户端版本不支持当前呼叫协议'
        : msg.includes('CALL_PROTOCOL_FLAGS_INVALID')
          ? '呼叫协议参数不受支持'
          : msg;
    return res.status(400).json({ ok: false, cloudSynced: false, error: friendly });
  }
});

app.get('/api/telegram/user/call/status/:callId', requireTenantAuth, (req: Request, res: Response) => {
  const session = activeTelegramCalls.get(req.params.callId);
  if (!session) {
    return res.json({ ok: true, status: 'discarded', endedReason: '通话会话已结束', elapsedSeconds: 0 });
  }
  const elapsedSeconds = session.acceptedAt ? Math.max(0, Math.floor((Date.now() - session.acceptedAt) / 1000)) : 0;
  return res.json({
    ok: true,
    status: session.status,
    endedReason: session.endedReason,
    elapsedSeconds,
  });
});

app.post('/api/telegram/user/call/end', requireTenantAuth, async (req: Request, res: Response) => {
  try {
    const callId = String(req.body?.callId || '');
    const duration = Number(req.body?.duration || 0);
    const session = activeTelegramCalls.get(callId);
    if (!session) {
      return res.json({ ok: true, cloudSynced: false });
    }
    if (session.status !== 'discarded') {
      try {
        await session.client.invoke(
          new Api.phone.DiscardCall({
            peer: new Api.InputPhoneCall({
              id: session.tgCallId,
              accessHash: session.accessHash,
            }),
            duration: Math.max(0, Math.floor(duration)),
            reason: new Api.PhoneCallDiscardReasonHangup(),
            connectionId: BigInt(0) as any,
          })
        );
      } catch {}
      session.status = 'discarded';
      session.endedReason = '已挂断';
    }
    setTimeout(() => activeTelegramCalls.delete(callId), 30000);
    return res.json({ ok: true, cloudSynced: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || '挂断失败' });
  }
});

function parseTelegramReactions(m: any): {
  reactions?: Record<string, number>;
  myReactions?: string[];
} {
  const results = Array.isArray(m?.reactions?.results) ? m.reactions.results : [];
  if (results.length === 0) return {};
  const reactions: Record<string, number> = {};
  const myReactions: string[] = [];
  for (const rc of results) {
    const emoji = rc?.reaction?.emoticon ? String(rc.reaction.emoticon) : '';
    if (!emoji) continue;
    reactions[emoji] = Number(rc.count || 1);
    if (rc.chosenOrder !== undefined && rc.chosenOrder !== null) {
      myReactions.push(emoji);
    }
  }
  return {
    reactions: Object.keys(reactions).length > 0 ? reactions : undefined,
    myReactions: myReactions.length > 0 ? myReactions : undefined,
  };
}

function getTelegramMessageSenderName(m: any, isOut: boolean): string {
  if (isOut) return '我方';
  const sender = m?.sender;
  if (sender) {
    const full = [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim() || sender.title || sender.username;
    if (full) return String(full);
  }
  return '客户';
}

function extractTelegramMediaFields(m: any, canonicalId: string, accountId: string) {
  const media = m?.media;
  const doc = media?.document;
  const attrs: any[] = Array.isArray(doc?.attributes) ? doc.attributes : [];
  const audioAttr = attrs.find((a) => a.className === 'DocumentAttributeAudio');
  const videoAttr = attrs.find((a) => a.className === 'DocumentAttributeVideo');
  const stickerAttr = attrs.find((a) => a.className === 'DocumentAttributeSticker');
  const filenameAttr = attrs.find((a) => a.className === 'DocumentAttributeFilename');
  const animatedAttr = attrs.find((a) => a.className === 'DocumentAttributeAnimated');
  const mimeType = String(doc?.mimeType || '').toLowerCase();

  const mediaProxyUrl = signTelegramResourceUrl(
    `/api/telegram/user/media/${encodeURIComponent(canonicalId)}/${Number(m.id)}?accountId=${encodeURIComponent(accountId)}`
  );

  const isVideo = Boolean(videoAttr || animatedAttr || mimeType.startsWith('video/'));
  const isAudio = Boolean(!isVideo && (audioAttr || mimeType.startsWith('audio/')));
  const isStickerThumb = Boolean(stickerAttr && mimeType.includes('tgsticker'));
  const isStickerImage = Boolean(
    stickerAttr && (!mimeType || mimeType === 'image/webp' || mimeType === 'image/png' || mimeType === 'image/jpeg')
  );
  const isImage = Boolean(
    !isVideo &&
      !isAudio &&
      (m.photo || media?.className === 'MessageMediaPhoto' || isStickerImage || isStickerThumb || mimeType.startsWith('image/'))
  );
  const isFile = Boolean(doc && !isImage && !isVideo && !isAudio);

  const fileName = filenameAttr?.fileName
    ? String(filenameAttr.fileName)
    : stickerAttr
      ? `sticker_${m.id}.webp`
      : isFile
        ? `file_${m.id}`
        : undefined;
  const fileSize = doc?.size ? formatTelegramFileSize(Number(doc.size)) : undefined;

  const caption = String(m.message || '').trim();
  let text = caption;
  if (!text) {
    if (isAudio) text = '🎤 语音消息';
    else if (isVideo) text = videoAttr?.roundMessage ? '🎥 视频消息' : '🎬 视频';
    else if (stickerAttr) text = stickerAttr.alt ? `${stickerAttr.alt} [贴纸]` : '🖼️ 贴纸';
    else if (isImage) text = '🖼️ 图片消息';
    else if (isFile) text = `📎 ${fileName || '文件附件'}`;
    else if (media?.className === 'MessageMediaGeo' || media?.className === 'MessageMediaGeoLive') text = '📍 位置信息';
    else if (media?.className === 'MessageMediaContact') {
      text = `👤 联系人名片: ${[media.firstName, media.lastName, media.phoneNumber].filter(Boolean).join(' ')}`.trim();
    } else if (media?.className === 'MessageMediaPoll') {
      text = `📊 投票: ${media.poll?.question?.text || media.poll?.question || ''}`.trim();
    } else if (media?.className === 'MessageMediaWebPage') {
      text = media.webpage?.title || media.webpage?.url || '🔗 网页链接';
    } else if (media) {
      text = '📎 媒体消息';
    }
  }

  return {
    text,
    isAudio,
    audioDuration: isAudio ? Number(audioAttr?.duration || 0) : 0,
    audioUrl: isAudio ? mediaProxyUrl : '',
    isImage,
    imageUrl: isImage ? (isStickerThumb ? `${mediaProxyUrl}&thumb=1` : mediaProxyUrl) : '',
    imageCaption: isImage ? caption : '',
    isVideo,
    videoDuration: isVideo ? Number(videoAttr?.duration || 0) : 0,
    videoWidth: isVideo ? Number(videoAttr?.w || 0) : undefined,
    videoHeight: isVideo ? Number(videoAttr?.h || 0) : undefined,
    videoUrl: isVideo ? mediaProxyUrl : '',
    isFile,
    fileName,
    fileSize,
    fileUrl: isFile ? `${mediaProxyUrl}&download=1` : '',
  };
}

// Sync real historical chat messages from Telegram Cloud MTProto (supports offsetId pagination & cloud search)
export async function syncTelegramUserChatMessages(
  client: TelegramClient,
  rawChatId: string,
  limit = 40,
  explicitUserId?: string,
  options?: { offsetId?: number; search?: string }
) {
  try {
    const rawId = rawChatId.startsWith('tg_') ? rawChatId.replace('tg_', '') : rawChatId;
    let peerTarget: any = rawId;
    if (/^-?\d+$/.test(rawId)) {
      try {
        peerTarget = Number(rawId);
      } catch {
        peerTarget = rawId;
      }
    }

    const iterParams: any = { limit };
    if (options?.offsetId && Number.isInteger(options.offsetId) && options.offsetId > 0) {
      iterParams.offsetId = options.offsetId;
    }
    if (options?.search && options.search.trim()) {
      iterParams.search = options.search.trim();
    }

    const messages = await client.getMessages(peerTarget, iterParams);

    const canonicalId =
      rawId === 'me' && explicitUserId
        ? `tg_${explicitUserId}`
        : rawChatId.startsWith('tg_')
          ? rawChatId
          : `tg_${rawChatId}`;
    const accountId = `acc_tg_${explicitUserId || (client as any)._selfId || 'user'}`;

    const allFetched: any[] = Array.isArray(messages) ? [...messages] : [];

    // On initial sync (not pagination/search), also include up to 5 latest pinned messages so older pinned banners appear
    if (!options?.offsetId && !options?.search) {
      try {
        const pinnedMsgs = await client.getMessages(peerTarget, {
          limit: 5,
          filter: new Api.InputMessagesFilterPinned(),
        });
        if (Array.isArray(pinnedMsgs)) {
          const existingIds = new Set(allFetched.map((m) => Number(m?.id)).filter(Boolean));
          for (const pm of pinnedMsgs) {
            if (pm && pm.id && !existingIds.has(Number(pm.id))) {
              allFetched.push(pm);
            }
          }
        }
      } catch {}
    }

    if (allFetched.length === 0) return [];

    const msgById = new Map<number, any>();
    const missingReplyIds = new Set<number>();
    for (const m of allFetched) {
      if (!m || !m.id) continue;
      msgById.set(Number(m.id), m);
    }
    for (const m of allFetched) {
      const replyId = Number((m as any)?.replyTo?.replyToMsgId || 0);
      if (replyId > 0 && !msgById.has(replyId)) {
        missingReplyIds.add(replyId);
      }
    }
    if (missingReplyIds.size > 0) {
      try {
        const extraReplies = await client.getMessages(peerTarget, {
          ids: Array.from(missingReplyIds).slice(0, 30),
        });
        for (const rm of extraReplies || []) {
          if (rm && rm.id) msgById.set(Number(rm.id), rm);
        }
      } catch {}
    }

    const synced: any[] = [];
    for (const m of allFetched) {
      if (!m) continue;
      const mediaParsed = extractTelegramMediaFields(m, canonicalId, accountId);
      if (!mediaParsed.text && !m.media) continue;

      const isOut = Boolean(m.out);
      const createdAt = m.date ? m.date * 1000 : Date.now();
      const timestamp = new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const internalId = `tg_cloud_${m.id}_${createdAt}_${accountId}`;
      const senderName = getTelegramMessageSenderName(m, isOut);

      let replyTo: { id: string; telegramMessageId?: number; senderName?: string; text: string } | undefined = undefined;
      const replyToId = Number((m as any).replyTo?.replyToMsgId || 0);
      if (replyToId > 0) {
        const targetReply = msgById.get(replyToId);
        const quoteText = String((m as any).replyTo?.quoteText || '').trim();
        const replySummary = quoteText || (targetReply ? summarizeTelegramDialogMedia(targetReply) : `消息 #${replyToId}`);
        const replySenderName = targetReply
          ? (targetReply.out ? '我' : getTelegramMessageSenderName(targetReply, false))
          : '回复消息';
        replyTo = {
          id: targetReply
            ? `tg_cloud_${targetReply.id}_${(targetReply.date || 0) * 1000}_${accountId}`
            : `msg_tg_${explicitUserId || (client as any)._selfId || 'user'}_${replyToId}`,
          telegramMessageId: replyToId,
          senderName: replySenderName,
          text: replySummary,
        };
      }

      const { reactions, myReactions } = parseTelegramReactions(m);
      const fwdFrom = (m as any).fwdFrom;
      const forwardFrom = fwdFrom?.fromName ? String(fwdFrom.fromName) : undefined;

      synced.push({
        id: internalId,
        telegramMessageId: Number(m.id),
        chatId: canonicalId,
        accountId,
        sender: isOut ? 'me' : 'peer',
        senderName,
        text: mediaParsed.text,
        translatedText: '',
        isAudio: mediaParsed.isAudio,
        audioDuration: mediaParsed.audioDuration,
        audioUrl: mediaParsed.audioUrl,
        sttText: '',
        voiceTone: '',
        isImage: mediaParsed.isImage,
        imageUrl: mediaParsed.imageUrl,
        imageCaption: mediaParsed.imageCaption,
        isVideo: mediaParsed.isVideo,
        videoUrl: mediaParsed.videoUrl,
        videoDuration: mediaParsed.videoDuration,
        videoWidth: mediaParsed.videoWidth,
        videoHeight: mediaParsed.videoHeight,
        isFile: mediaParsed.isFile,
        fileName: mediaParsed.fileName,
        fileSize: mediaParsed.fileSize,
        fileUrl: mediaParsed.fileUrl,
        replyTo,
        reactions,
        myReactions,
        isPinned: Boolean((m as any).pinned),
        isEdited: Boolean((m as any).editDate),
        forwardFrom,
        timestamp,
        createdAt,
        deliveryStatus: 'delivered',
      });
    }

    // Save to unified database cache (skip when searching subset only)
    if (!options?.search) {
      for (const msg of synced) {
        await upsertSyncedMessageToDb(msg, canonicalId, accountId);
      }
    }

    return synced.sort((a, b) => a.createdAt - b.createdAt);
  } catch (err: any) {
    if (isTelegramSessionExpiredError(err)) {
      throw err;
    }
    console.warn(`[Sync Telegram Cloud Messages Warning] for ${rawChatId}:`, err.message);
    return [];
  }
}

// 20.4 Fetch real cloud messages from Telegram for a specific conversation (supports offsetId pagination, search & readOutboxMaxId)
app.get('/api/telegram/user/messages/:chatId', requireTenantAuth, async (req: Request, res: Response) => {
  const { chatId } = req.params;
  const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string);
  let connected: ConnectedTelegramUser | undefined;
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offsetId = req.query.offsetId ? Number(req.query.offsetId) : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;

    connected = accountId
      ? connectedUserClients.get(accountId) ||
        Array.from(connectedUserClients.values()).find(
          (u) => u.userId === accountId || u.phone === accountId || `acc_tg_${u.userId}` === accountId
        )
      : undefined;

    if (!connected || !connected.client) {
      return res.json({ ok: false, messages: [], hasMore: false, message: '未找到在线的 Telegram 客户端会话' });
    }

    const messages = await syncTelegramUserChatMessages(connected.client, chatId, limit, connected.userId, {
      offsetId: offsetId && Number.isInteger(offsetId) && offsetId > 0 ? offsetId : undefined,
      search,
    });

    let readOutboxMaxId: number | undefined;
    if (!offsetId && !search) {
      try {
        const { inputPeer } = await resolveTelegramInputPeer(connected.client, chatId, connected.userId);
        const peerDialogs: any = await connected.client.invoke(
          new Api.messages.GetPeerDialogs({ peers: [new Api.InputDialogPeer({ peer: inputPeer })] })
        );
        const d = peerDialogs?.dialogs?.[0];
        if (d && typeof d.readOutboxMaxId === 'number') {
          readOutboxMaxId = d.readOutboxMaxId;
        }
      } catch {}
    }

    res.json({
      ok: true,
      messages,
      hasMore: messages.length >= limit,
      ...(typeof readOutboxMaxId === 'number' ? { readOutboxMaxId } : {}),
    });
  } catch (err: any) {
    if (isTelegramSessionExpiredError(err)) {
      await markTelegramSessionExpired({
        accountId,
        userId: connected?.userId,
        phone: connected?.phone,
        reason: formatTelegramError(err),
      });
      return res.status(401).json({
        ok: false,
        code: 'TELEGRAM_SESSION_EXPIRED',
        error: formatTelegramError(err),
        messages: [],
      });
    }
    res.status(500).json({ ok: false, error: err.message, messages: [] });
  }
});

// Autopilot state storage (strictly isolated per accountId::chatId)
export const activeAutonomousChats = new Set<string>();

export function normalizeAutopilotAccountScope(accountId?: string): string {
  const clean = String(accountId || '').trim();
  if (!clean) return 'default';
  if (/^\d+$/.test(clean)) return `acc_tg_${clean}`;
  return clean;
}

function buildAutopilotScopedKeys(accountId: string | undefined, chatId: string): string[] {
  const scope = normalizeAutopilotAccountScope(accountId);
  const raw = String(chatId || '').trim();
  const bare = raw.replace(/^tg_/, '');
  if (!bare) return [];
  const prefixed = `tg_${bare}`;
  return [`${scope}::${prefixed}`, `${scope}::${bare}`];
}

export function isAutopilotEnabledForChat(accountId: string | undefined, chatId: string): boolean {
  const keys = buildAutopilotScopedKeys(accountId, chatId);
  return keys.some((k) => activeAutonomousChats.has(k));
}

export function setAutopilotEnabledForChat(accountId: string | undefined, chatId: string, enabled: boolean): boolean {
  const keys = buildAutopilotScopedKeys(accountId, chatId);
  if (keys.length === 0) return false;
  for (const k of keys) {
    if (enabled) activeAutonomousChats.add(k);
    else activeAutonomousChats.delete(k);
  }
  return isAutopilotEnabledForChat(accountId, chatId);
}

// 20.5 Autopilot Status & Toggle Endpoints (strictly scoped per accountId)
app.get('/api/telegram/autopilot/status', requireTenantAuth, (req: Request, res: Response) => {
  const chatId = String(req.query.chatId || '').trim();
  const accountId =
    (req.query.accountId as string) ||
    (req as any).auth?.effectiveAccountId ||
    (req.headers['x-account-id'] as string) ||
    undefined;
  const scopePrefix = `${normalizeAutopilotAccountScope(accountId)}::`;
  const scopedActiveChats = Array.from(activeAutonomousChats)
    .filter((k) => k.startsWith(scopePrefix))
    .map((k) => k.slice(scopePrefix.length));

  res.json({
    ok: true,
    accountId: normalizeAutopilotAccountScope(accountId),
    activeChats: scopedActiveChats,
    isChatEnabled: chatId ? isAutopilotEnabledForChat(accountId, chatId) : false,
  });
});

app.post('/api/telegram/autopilot/toggle', requireTenantAuth, (req: Request, res: Response) => {
  const { chatId, enabled, accountId: bodyAccountId } = req.body || {};
  if (!chatId) return res.status(400).json({ ok: false, error: 'chatId is required' });
  const accountId =
    bodyAccountId ||
    (req as any).auth?.effectiveAccountId ||
    (req.headers['x-account-id'] as string) ||
    undefined;

  const currentEnabled = setAutopilotEnabledForChat(accountId, String(chatId), Boolean(enabled));
  const scopePrefix = `${normalizeAutopilotAccountScope(accountId)}::`;
  const scopedCount = Array.from(activeAutonomousChats).filter((k) => k.startsWith(scopePrefix)).length;

  res.json({
    ok: true,
    accountId: normalizeAutopilotAccountScope(accountId),
    chatId,
    enabled: currentEnabled,
    activeCount: scopedCount,
  });
});

// Real-time MTProto NewMessage event listener for personal Telegram account
export interface LocalIncomingUpdate {
  id: string;
  type?: 'message' | 'edit' | 'delete' | 'read_outbox' | 'pin' | 'user_status' | 'peer_blocked';
  telegramMessageId?: number;
  deletedMessageIds?: number[];
  readOutboxMaxId?: number;
  pinnedMessageIds?: number[];
  pinned?: boolean;
  isOnline?: boolean;
  statusText?: string;
  isBlocked?: boolean;
  chatId: string;
  rawChatId?: string;
  accountId: string;
  sender: 'me' | 'peer';
  senderName: string;
  text: string;
  translatedText?: string;
  sttText?: string;
  timestamp: string;
  createdAt: number;
  isAudio?: boolean;
  audioDuration?: number;
  audioUrl?: string;
  isVideo?: boolean;
  videoDuration?: number;
  videoWidth?: number;
  videoHeight?: number;
  videoUrl?: string;
  isImage?: boolean;
  imageUrl?: string;
  imageCaption?: string;
  isFile?: boolean;
  fileName?: string;
  fileSize?: string;
  fileUrl?: string;
  replyTo?: { id: string; telegramMessageId?: number; senderName?: string; text: string };
  isEdited?: boolean;
  isPinned?: boolean;
}
export const pendingLocalUpdates: LocalIncomingUpdate[] = [];

export function pushPendingLocalUpdate(upd: LocalIncomingUpdate, maxPerAccount = 200, maxTotal = 1000) {
  pendingLocalUpdates.push(upd);
  let accountCount = 0;
  for (let i = 0; i < pendingLocalUpdates.length; i++) {
    if (pendingLocalUpdates[i].accountId === upd.accountId) accountCount++;
  }
  if (accountCount > maxPerAccount) {
    const oldestIdx = pendingLocalUpdates.findIndex((item) => item.accountId === upd.accountId);
    if (oldestIdx >= 0) pendingLocalUpdates.splice(oldestIdx, 1);
  }
  while (pendingLocalUpdates.length > maxTotal) {
    const countsByAcc = new Map<string, number>();
    for (const item of pendingLocalUpdates) {
      countsByAcc.set(item.accountId, (countsByAcc.get(item.accountId) || 0) + 1);
    }
    let busiestAcc = pendingLocalUpdates[0].accountId;
    let busiestCount = 0;
    for (const [acc, cnt] of countsByAcc.entries()) {
      if (cnt > busiestCount) {
        busiestCount = cnt;
        busiestAcc = acc;
      }
    }
    const evictIdx = pendingLocalUpdates.findIndex((item) => item.accountId === busiestAcc);
    pendingLocalUpdates.splice(evictIdx >= 0 ? evictIdx : 0, 1);
  }
}

// Endpoint for local desktop app to poll new incoming Telegram messages non-destructively (ACK required to dequeue)
app.get('/api/telegram/user/poll-updates', (req: Request, res: Response) => {
  const targetAccount = (req.query.accountId as string) || (req.headers['x-account-id'] as string);
  if (targetAccount) {
    const matched = pendingLocalUpdates.filter(
      (upd) =>
        upd.accountId === targetAccount ||
        upd.accountId === `acc_tg_${targetAccount}` ||
        targetAccount === `acc_tg_${upd.accountId}`
    );
    return res.json({ ok: true, updates: matched });
  }
  res.json({ ok: true, updates: [...pendingLocalUpdates] });
});

// Explicit client acknowledgement endpoint: removes delivered update IDs only after client persists them
app.post('/api/telegram/user/ack-updates', (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (ids.length === 0) {
    return res.json({ ok: true, ackedCount: 0 });
  }
  const ackSet = new Set<string>(ids);
  const beforeLen = pendingLocalUpdates.length;
  const remaining = pendingLocalUpdates.filter((upd) => !ackSet.has(String(upd.id)));
  pendingLocalUpdates.length = 0;
  pendingLocalUpdates.push(...remaining);
  res.json({ ok: true, ackedCount: beforeLen - remaining.length });
});

// In-memory cache of recently sent outbound messages and processed MTProto message IDs to prevent echo duplicates
const recentlySentOutboundCache = new Map<string, { count: number; expiresAt: number }>();
const processedMtprotoMsgIds = new Map<string, number>();

function buildOutboundEchoKey(chatId: string, text: string, accountId?: string): string {
  const scope = accountId ? normalizeAutopilotAccountScope(accountId) : 'shared';
  return `${scope}:${chatId.replace(/^tg_/, '')}:${text.trim()}`;
}

export function markOutboundMessageSent(chatId: string, text: string, accountId?: string) {
  if (!text) return;
  const key = buildOutboundEchoKey(chatId, text, accountId);
  const now = Date.now();
  const prev = recentlySentOutboundCache.get(key);
  const nextCount = prev && now < prev.expiresAt ? prev.count + 1 : 1;
  recentlySentOutboundCache.set(key, { count: nextCount, expiresAt: now + 25000 });
  if (recentlySentOutboundCache.size > 300) {
    for (const [k, item] of recentlySentOutboundCache.entries()) {
      if (now >= item.expiresAt) recentlySentOutboundCache.delete(k);
    }
  }
}

export function isRecentOutboundEcho(chatId: string, text: string, accountId?: string): boolean {
  if (!text) return false;
  const key = buildOutboundEchoKey(chatId, text, accountId);
  const entry = recentlySentOutboundCache.get(key);
  if (!entry) return false;
  if (Date.now() < entry.expiresAt && entry.count > 0) {
    if (entry.count <= 1) {
      recentlySentOutboundCache.delete(key);
    } else {
      recentlySentOutboundCache.set(key, { count: entry.count - 1, expiresAt: entry.expiresAt });
    }
    return true;
  }
  recentlySentOutboundCache.delete(key);
  return false;
}

// Real-time MTProto NewMessage event listener for personal Telegram account (Zero-Database local buffer + Autopilot)
export function attachTelegramClientMessageListener(client: TelegramClient, phone: string, userId: string) {
  try {
    if ((client as any)._hasTgProListener) {
      return;
    }
    (client as any)._hasTgProListener = true;

    client.addEventHandler(async (event: any) => {
      try {
        const message = event.message;
        if (!message) return;

        const senderId = message.senderId ? String(message.senderId) : null;
        const rawChatId = String(message.chatId || senderId || 'unknown');

        // Deduplicate MTProto events per chat+message ID (channel/supergroup IDs are only unique per chat)
        const mtprotoMsgKey = `${userId}_${rawChatId}_${message.id}`;
        if (processedMtprotoMsgIds.has(mtprotoMsgKey)) {
          return;
        }
        processedMtprotoMsgIds.set(mtprotoMsgKey, Date.now());
        if (processedMtprotoMsgIds.size > 500) {
          const now = Date.now();
          for (const [k, ts] of processedMtprotoMsgIds.entries()) {
            if (now - ts > 60000) processedMtprotoMsgIds.delete(k);
          }
        }
        // Always enforce canonical tg_ prefix matching the desktop dialog list
        const canonicalChatId = rawChatId.startsWith('tg_') ? rawChatId : `tg_${rawChatId}`;
        const isOut = Boolean(message.out);
        const createdAt = message.date ? message.date * 1000 : Date.now();
        const messageId = `msg_tg_${userId}_${message.id}`;
        const accountId = `acc_tg_${userId}`;
        const timestamp = new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        const parsedMedia = extractTelegramMediaFields(message, canonicalChatId, accountId);
        const isAudio = parsedMedia.isAudio;
        const audioDuration = parsedMedia.audioDuration;
        let audioUrl: string | undefined = parsedMedia.audioUrl || undefined;
        const isVideo = parsedMedia.isVideo;
        const videoDuration = parsedMedia.videoDuration;
        const videoUrl: string | undefined = parsedMedia.videoUrl || undefined;
        const isImage = parsedMedia.isImage;
        const imageUrl: string | undefined = parsedMedia.imageUrl || undefined;
        const isFile = parsedMedia.isFile;
        const fileUrl: string | undefined = parsedMedia.fileUrl || undefined;

        // If audio voice note, keep compact data URL when small so auto-STT works immediately
        if (isAudio && message.media) {
          try {
            const buffer = (await client.downloadMedia(message.media, {})) as Buffer;
            if (buffer && buffer.length > 0 && buffer.length <= 1500 * 1024) {
              audioUrl = `data:audio/ogg;base64,${buffer.toString('base64')}`;
            }
          } catch (dlErr: any) {
            console.warn('[MTProto Audio Download Non-Fatal]:', dlErr.message);
          }
        }

        const text = parsedMedia.text || '';

        // Filter out echo duplicates for outbound messages already sent by this applet (scoped per account)
        if (isOut && isRecentOutboundEcho(canonicalChatId, text, accountId)) {
          return;
        }

        const isOfficialService =
          rawChatId === '777000' ||
          senderId === '777000' ||
          canonicalChatId === 'tg_777000' ||
          rawChatId === '42777' ||
          senderId === '42777' ||
          canonicalChatId === 'tg_42777';

        let replyTo: { id: string; senderName?: string; text: string } | undefined = undefined;
        const replyToId = Number((message as any).replyTo?.replyToMsgId || 0);
        if (replyToId > 0) {
          const quoteText = String((message as any).replyTo?.quoteText || '').trim();
          replyTo = {
            id: `msg_tg_${userId}_${replyToId}`,
            senderName: '回复消息',
            text: quoteText || `消息 #${replyToId}`,
          };
        }

        const realtimeUpdate: LocalIncomingUpdate = {
          id: messageId,
          telegramMessageId: Number(message.id),
          chatId: canonicalChatId,
          rawChatId,
          accountId,
          sender: isOut ? 'me' : 'peer',
          senderName: isOfficialService ? 'Telegram 官方服务通知' : getTelegramMessageSenderName(message, isOut),
          text,
          timestamp,
          createdAt,
          isAudio,
          audioDuration,
          audioUrl,
          isVideo,
          videoDuration,
          videoWidth: parsedMedia.videoWidth,
          videoHeight: parsedMedia.videoHeight,
          videoUrl,
          isImage,
          imageUrl,
          imageCaption: parsedMedia.imageCaption || undefined,
          isFile,
          fileName: parsedMedia.fileName,
          fileSize: parsedMedia.fileSize,
          fileUrl,
          replyTo,
          isEdited: Boolean((message as any).editDate),
          isPinned: Boolean((message as any).pinned),
        };
        pushPendingLocalUpdate(realtimeUpdate);

        // Persist real-time MTProto message into unified conversation store so customer analysis/evolution/transcripts never read stale empty tables
        void upsertSyncedMessageToDb(realtimeUpdate, canonicalChatId, accountId);

        // Check if Autopilot is enabled for this chat strictly scoped by accountId (NEVER run Autopilot on official notifications)
        const isAutopilotOn =
          !isOfficialService &&
          (isAutopilotEnabledForChat(accountId, canonicalChatId) || isAutopilotEnabledForChat(accountId, rawChatId));

        if (!isOut && isAutopilotOn) {
          console.log(`[HumanSense Autopilot] Auto-generating holographic memory reply for chat ${canonicalChatId}...`);
          setImmediate(async () => {
            try {
              // 1. Get customer profile from database strictly scoped by accountId
              const p =
                (await getScopedCustomerProfile(canonicalChatId, accountId)) ||
                (await getScopedCustomerProfile(rawChatId, accountId)) ||
                (await getScopedCustomerProfile(`tg_${rawChatId}`, accountId));
              const likes = p ? safeJsonParse<string[]>(p.likes_interests, []) : [];
              const taboos = p ? safeJsonParse<string[]>(p.dislikes_taboos, []) : [];
              const memories = p ? safeJsonParse<any[]>(p.key_memories, []) : [];

              // Retrieve active Global Persona & Evolution state using unified builder
              let autoPersonaContext = '';
              let autoHabitIds: string[] = [];
              let hasAutoConfiguredPersona = false;
              try {
                const autoPersona = await getGlobalPersonaFromDb();
                const autoEvo = await getEvolutionStateFromDb();
                const autoCtx = buildActivePersonaAndEvolutionContext(autoPersona, autoEvo, undefined, 3);
                autoPersonaContext = autoCtx.context;
                autoHabitIds = autoCtx.activeHabitIds;
                hasAutoConfiguredPersona = autoCtx.hasConfiguredPersona;
              } catch {}

              const serverCustomConfig = await getServerCustomLlmConfig();

              // Retrieve Cloud Brain Knowledge Base (if enabled) & local RAG context
              let kbContext = '';
              if (isCloudKnowledgeBaseEnabled(serverCustomConfig)) {
                let railwayRes: RemoteKbSearchResult;
                try {
                  railwayRes = await searchRailwayKnowledgeBase(
                    text,
                    serverCustomConfig?.knowledgeBaseApiUrl,
                    serverCustomConfig?.knowledgeBaseApiKey || serverCustomConfig?.apiKey,
                    7000,
                    lastActiveUserJwt || undefined,
                    serverCustomConfig?.engineLicenseKey
                  );
                } catch (kbErr: any) {
                  railwayRes = {
                    ok: false,
                    connected: false,
                    context: '',
                    matchedCount: 0,
                    source: 'remote_cloud_kb_error',
                    error: kbErr?.message || '云端知识库检索异常',
                    statusCode: 502,
                  };
                }
                if (!railwayRes.ok) {
                  console.warn(
                    `[HumanSense Autopilot Cloud KB Guard] Chat ${canonicalChatId}: 云端知识库检索断连或失败 (${railwayRes.error || '未知网络错误'})，触发安全阻断并保持静默（严禁降级自动回复）`
                  );
                  return;
                }
                if (railwayRes.matchedCount > 0 && railwayRes.context) {
                  kbContext += `\n${railwayRes.context}\n`;
                }
              }
              try {
                const localRag = await queryKnowledgeRAG(text, 2);
                if (localRag.matchedCount > 0 && localRag.context) {
                  kbContext += `\n${localRag.context}\n`;
                }
              } catch {}

              let targetLangCode = detectSourceLangCode(text);
              if ((!targetLangCode || targetLangCode === 'zh-CN') && p?.location_timezone) {
                const tz = String(p.location_timezone).toLowerCase();
                if (tz.includes('istanbul') || tz.includes('turkey') || tz.includes('土耳其')) targetLangCode = 'tr';
                else if (tz.includes('moscow') || tz.includes('russia') || tz.includes('俄')) targetLangCode = 'ru';
                else if (tz.includes('utc+') || tz.includes('london') || tz.includes('america')) targetLangCode = 'en';
              }
              const langConstraint = (targetLangCode && targetLangCode !== 'zh-CN')
                ? `\n【母语强制约束】：检测到客户当前发送的消息语言为 ${targetLangCode}（如土耳其语、英语等）。你必须 100% 严格使用地道纯正的对应母语回复对方，绝不允许使用中文回复客户！`
                : '';

              const isColdStartAutopilot = !p || p.relationship_stage === '尚未沟通' || p.relationship_stage === '初次接触' || (likes.length === 0 && memories.length === 0);
              const autopilotFamiliarity = isColdStartAutopilot
                ? '当前客户处于初次结识冷启动阶段，回复请保持礼貌友好、自然破冰，严禁虚构未发生的熟人交情与过往记忆！'
                : `自然融入对客户真实爱好（${likes.slice(0, 2).join('、') || '业务关注点'}）的了解与关心。`;

              const memoryPrompt = `${
                hasAutoConfiguredPersona
                  ? autoPersonaContext
                  : '你是一位真诚自然、高效有温度的沟通助手。'
              }${
                !hasAutoConfiguredPersona && autoPersonaContext
                  ? `\n\n${autoPersonaContext}`
                  : ''
              }

【客户全息画像与长期记忆档案】：
- 客户称谓: ${p?.client_name || '好友'}
- 性格风格: ${p?.tone_style || '自然亲切、口语化交流'}
- 喜好: ${likes.join('、')}
- 忌讳雷区: ${taboos.join('、')}
- 关键约定与共同记忆:
${memories.slice(-3).map((m: any) => `  * [${m.date}] ${m.topic}: ${m.summary}`).join('\n')}
${kbContext}${langConstraint}

【强制要求】：
1. 彻底使用纯正生活大白话，严禁任何 AI 客服机器人腔调（如“您好”、“有什么能帮您”）、严禁 1. 2. 3. 列点或长篇大论！
2. 篇幅短小精炼（1~2句日常短句），像真人用手机 Telegram 私聊！
3. ${autopilotFamiliarity}，绝不要说“作为AI”。`;

              let replyText = "";
              if (serverCustomConfig?.enabled) {
                try {
                  const candidate = await callCustomLlm({
                    customConfig: serverCustomConfig,
                    systemInstruction: memoryPrompt,
                    messages: [{ role: "user", content: `客户刚才发来消息：“${text}”\n请直接生成最新一句回复：` }],
                    temperature: 0.7,
                    maxTokens: 200,
                    userJwt: lastActiveUserJwt || undefined,
                    skipSync: true,
                  });
                  if (candidate?.trim()) {
                    replyText = candidate.trim();
                  }
                } catch (autoLlmErr: any) {
                  console.warn("[HumanSense Autopilot Custom LLM Guard]: 自定义大模型/云端引擎未连通，严格保持静默（严禁切回 Gemini）:", autoLlmErr.message);
                }
              } else if (isGeminiAvailable()) {
                const targetModel = resolveGeminiModel(serverCustomConfig?.geminiModel, 'chat');
                try {
                  const ai = createGeminiClient();
                  const response = await ai.models.generateContent({
                    model: targetModel,
                    contents: `客户刚才发来消息：“${text}”\n请直接生成最新一句回复：`,
                    config: { systemInstruction: memoryPrompt },
                  });
                  const candidate = response.text?.trim();
                  if (candidate) {
                    replyText = candidate;
                  }
                } catch (modelErr: any) {
                  handleGeminiApiError(`Autopilot(${targetModel})`, modelErr);
                }
              }

                if (replyText) {
                  const cleanPeer = rawChatId.replace(/^tg_/, '');
                  const rawPeer: any = /^-?\d+$/.test(cleanPeer) ? Number(cleanPeer) : cleanPeer;
                  markOutboundMessageSent(canonicalChatId, replyText, accountId);
                  await client.sendMessage(rawPeer, { message: replyText });
                  void incrementEvolutionHabitUsage(autoHabitIds);
                  const replyMsgId = `msg_auto_${Date.now()}`;
                  let replyZh = '';
                  try {
                    if (replyText && !/[\u4e00-\u9fa5]/.test(replyText)) {
                      replyZh = await getCnTranslationIfForeign(replyText, serverCustomConfig);
                    }
                  } catch {}
                  const replyTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

                  // Save to database
                  try {
                    await db.prepare(`
                      INSERT INTO messages (
                        id, chat_id, account_id, sender, sender_name, text, translated_text,
                        timestamp, created_at, delivery_status
                      ) VALUES (?, ?, ?, 'me', '我方 (AI托管)', ?, ?, ?, ?, 'delivered')
                    `).run(replyMsgId, canonicalChatId, accountId, replyText, replyZh, replyTime, Date.now());
                  } catch {}

                  pushPendingLocalUpdate({
                    id: replyMsgId,
                    chatId: canonicalChatId,
                    rawChatId,
                    accountId,
                    sender: 'me',
                    senderName: '我方 (AI托管)',
                    text: replyText,
                    translatedText: replyZh,
                    timestamp: replyTime,
                    createdAt: Date.now(),
                  });
                  console.log(`[HumanSense Autopilot] Sent auto-reply to ${canonicalChatId}: "${replyText}"`);
                }
            } catch (autoErr: any) {
              console.warn('[HumanSense Autopilot Exception]:', autoErr.message);
            }
          });
        }
      } catch (e: any) {
        console.warn('[MTProto Message Listener Event Error]:', e.message);
      }
    }, new NewMessage({}));

    // Real-time MTProto Raw updates for Message Edits, Deletions, Outbox Read Receipts & Pinned Changes
    const resolveRawPeerChatId = (peer: any): string => {
      if (!peer) return '';
      if (peer.userId !== undefined) return `tg_${String(peer.userId)}`;
      if (peer.chatId !== undefined) return `tg_-${String(peer.chatId)}`;
      if (peer.channelId !== undefined) return `tg_-100${String(peer.channelId)}`;
      return '';
    };

    client.addEventHandler(async (update: any) => {
      try {
        const accountId = `acc_tg_${userId}`;
        if (update instanceof Api.UpdateEditMessage || update instanceof Api.UpdateEditChannelMessage) {
          const msgObj: any = update.message;
          if (!msgObj || !msgObj.id) return;
          const peerChatId = resolveRawPeerChatId(msgObj.peerId);
          if (!peerChatId) return;
          const tgMsgId = Number(msgObj.id);
          const editedText = typeof msgObj.message === 'string' ? msgObj.message : '';
          pushPendingLocalUpdate({
            id: `edit_${userId}_${tgMsgId}_${Date.now()}`,
            type: 'edit',
            telegramMessageId: tgMsgId,
            chatId: peerChatId,
            accountId,
            sender: msgObj.out ? 'me' : 'peer',
            senderName: msgObj.out ? '我方' : '对方',
            text: editedText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            createdAt: Date.now(),
            isEdited: true,
          });
          try {
            const altChatId = peerChatId.replace(/^tg_/, '');
            await db
              .prepare(`UPDATE messages SET text = CASE WHEN ? != '' THEN ? ELSE text END, is_edited = 1 WHERE (chat_id = ? OR chat_id = ?) AND telegram_message_id = ? AND account_id = ?`)
              .run(editedText, editedText, peerChatId, altChatId, tgMsgId, accountId);
          } catch {}
          return;
        }

        if (update instanceof Api.UpdateDeleteMessages) {
          const delIds = (update.messages || []).map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0);
          if (delIds.length === 0) return;
          pushPendingLocalUpdate({
            id: `del_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            type: 'delete',
            deletedMessageIds: delIds,
            chatId: '',
            accountId,
            sender: 'peer',
            senderName: '',
            text: '',
            timestamp: '',
            createdAt: Date.now(),
          });
          try {
            const placeholders = delIds.map(() => '?').join(', ');
            await db
              .prepare(
                `DELETE FROM messages WHERE account_id = ? AND chat_id NOT LIKE 'tg_-100%' AND chat_id NOT LIKE '-100%' AND telegram_message_id IN (${placeholders})`
              )
              .run(accountId, ...delIds);
          } catch {}
          return;
        }

        if (update instanceof Api.UpdateDeleteChannelMessages) {
          const delIds = (update.messages || []).map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0);
          const channelChatId = update.channelId ? `tg_-100${String(update.channelId)}` : '';
          if (delIds.length === 0) return;
          pushPendingLocalUpdate({
            id: `delch_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            type: 'delete',
            deletedMessageIds: delIds,
            chatId: channelChatId,
            accountId,
            sender: 'peer',
            senderName: '',
            text: '',
            timestamp: '',
            createdAt: Date.now(),
          });
          try {
            const placeholders = delIds.map(() => '?').join(', ');
            if (channelChatId) {
              const alt = channelChatId.replace(/^tg_/, '');
              await db
                .prepare(`DELETE FROM messages WHERE account_id = ? AND (chat_id = ? OR chat_id = ?) AND telegram_message_id IN (${placeholders})`)
                .run(accountId, channelChatId, alt, ...delIds);
            }
          } catch {}
          return;
        }

        if (update instanceof Api.UpdateReadHistoryOutbox) {
          const peerChatId = resolveRawPeerChatId(update.peer);
          const maxId = Number(update.maxId || 0);
          if (!peerChatId || !maxId) return;
          pushPendingLocalUpdate({
            id: `readout_${userId}_${peerChatId}_${maxId}`,
            type: 'read_outbox',
            chatId: peerChatId,
            readOutboxMaxId: maxId,
            accountId,
            sender: 'peer',
            senderName: '',
            text: '',
            timestamp: '',
            createdAt: Date.now(),
          });
          return;
        }

        if (update instanceof Api.UpdateReadChannelOutbox) {
          const channelChatId = update.channelId ? `tg_-100${String(update.channelId)}` : '';
          const maxId = Number(update.maxId || 0);
          if (!channelChatId || !maxId) return;
          pushPendingLocalUpdate({
            id: `readchout_${userId}_${channelChatId}_${maxId}`,
            type: 'read_outbox',
            chatId: channelChatId,
            readOutboxMaxId: maxId,
            accountId,
            sender: 'peer',
            senderName: '',
            text: '',
            timestamp: '',
            createdAt: Date.now(),
          });
          return;
        }

        if (update instanceof Api.UpdatePinnedMessages || update instanceof Api.UpdatePinnedChannelMessages) {
          const pinIds = (update.messages || []).map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0);
          const peerChatId =
            update instanceof Api.UpdatePinnedChannelMessages
              ? (update.channelId ? `tg_-100${String(update.channelId)}` : '')
              : resolveRawPeerChatId((update as Api.UpdatePinnedMessages).peer);
          if (!peerChatId || pinIds.length === 0) return;
          const pinnedVal = Boolean(update.pinned);
          pushPendingLocalUpdate({
            id: `pin_${userId}_${peerChatId}_${Date.now()}`,
            type: 'pin',
            chatId: peerChatId,
            pinnedMessageIds: pinIds,
            pinned: pinnedVal,
            accountId,
            sender: 'peer',
            senderName: '',
            text: '',
            timestamp: '',
            createdAt: Date.now(),
          });
          try {
            const alt = peerChatId.replace(/^tg_/, '');
            const placeholders = pinIds.map(() => '?').join(', ');
            await db
              .prepare(`UPDATE messages SET is_pinned = ? WHERE account_id = ? AND (chat_id = ? OR chat_id = ?) AND telegram_message_id IN (${placeholders})`)
              .run(pinnedVal ? 1 : 0, accountId, peerChatId, alt, ...pinIds);
          } catch {}
          return;
        }

        if (update instanceof Api.UpdateUserStatus) {
          const targetUid = update.userId !== undefined ? String(update.userId) : '';
          if (!targetUid) return;
          const uStatus = formatTelegramUserStatus({ id: targetUid, status: update.status });
          pushPendingLocalUpdate({
            id: `status_${userId}_${targetUid}_${Date.now()}`,
            type: 'user_status',
            chatId: `tg_${targetUid}`,
            accountId,
            isOnline: uStatus.isOnline,
            statusText: uStatus.statusText,
            sender: 'peer',
            senderName: '',
            text: '',
            timestamp: '',
            createdAt: Date.now(),
          });
          return;
        }

        if (update instanceof Api.UpdatePeerBlocked) {
          const peerChatId = resolveRawPeerChatId(update.peerId);
          if (!peerChatId) return;
          pushPendingLocalUpdate({
            id: `blk_${userId}_${peerChatId}_${Date.now()}`,
            type: 'peer_blocked',
            chatId: peerChatId,
            accountId,
            isBlocked: Boolean(update.blocked),
            sender: 'peer',
            senderName: '',
            text: '',
            timestamp: '',
            createdAt: Date.now(),
          });
        }
      } catch {}
    }, new Raw({}));
  } catch (err: any) {
    console.warn('[Attach Telegram Listener Error]:', err.message);
  }
}

// On-demand/startup restoration of encrypted Telegram user sessions (uses RAM-only/grace credentials, deduplicated & token-upgrade safe)
export async function restoreTelegramUserSessionsOnStartup(
  bearerToken?: string,
  options?: { forceReconnect?: boolean }
): Promise<number> {
  const effectiveBearer = (bearerToken && bearerToken.trim()) || lastActiveUserJwt || undefined;
  const forceReconnect = Boolean(options?.forceReconnect);

  if (activeRestorePromise) {
    const needsTokenUpgrade = Boolean(effectiveBearer && !activeRestoreMeta?.hasBearerToken);
    const needsForceUpgrade = Boolean(forceReconnect && !activeRestoreMeta?.forceReconnect);
    if (needsTokenUpgrade || needsForceUpgrade) {
      const inflight = activeRestorePromise;
      try {
        await inflight;
      } catch {}
      return restoreTelegramUserSessionsOnStartup(effectiveBearer, options);
    }
    return activeRestorePromise;
  }

  activeRestoreMeta = {
    hasBearerToken: Boolean(effectiveBearer),
    forceReconnect,
  };

  activeRestorePromise = (async () => {
    telegramSessionRestoreState.inProgress = true;
    telegramSessionRestoreState.lastAttemptAt = Date.now();
    telegramSessionRestoreState.lastError = null;

    try {
      await purgePersistedTelegramApiCredentialsFromDb();
      await loadSystemProxyConfigFromDb();

      let rows: any[] = [];
      try {
        rows = (await db.prepare(`
          SELECT phone, session_string, user_id, username, first_name
          FROM telegram_user_sessions
          WHERE is_active = 1
          ORDER BY updated_at DESC
          LIMIT ${MAX_TELEGRAM_ACCOUNTS * 2}
        `).all()) as any[];
      } catch (dbErr: any) {
        telegramSessionRestoreState.lastError = dbErr?.message || '读取本地 Telegram 会话表失败';
        return 0;
      }

      if (!rows || rows.length === 0) {
        telegramSessionRestoreState.restoredCount = 0;
        return 0;
      }

      // Deduplicate rows by user_id (keep newest updated_at row, clean up stale duplicate keys)
      const dedupedRows: any[] = [];
      const seenDbUserIds = new Set<string>();
      for (const r of rows) {
        const uid = r.user_id ? String(r.user_id).trim() : '';
        if (uid) {
          if (seenDbUserIds.has(uid)) {
            try {
              await db
                .prepare('DELETE FROM telegram_user_sessions WHERE user_id = ? AND phone = ?')
                .run(uid, r.phone);
            } catch {}
            continue;
          }
          seenDbUserIds.add(uid);
        }
        dedupedRows.push(r);
        if (dedupedRows.length >= MAX_TELEGRAM_ACCOUNTS) break;
      }

      const creds = await resolveTelegramApiCredentials({ bearerToken: effectiveBearer });
      if (!creds.ok || !creds.apiId || !creds.apiHash) {
        telegramSessionRestoreState.lastError = creds.error || '云端 Telegram 接入凭据暂不可用，请检查会员登录或网络连接';
        return 0;
      }

      const useApiId = creds.apiId;
      const useApiHash = creds.apiHash;
      const telegramProxy = getConfiguredTelegramProxy();
      let restoredCount = 0;
      let lastFailureMsg: string | null = null;

      const restoreSingleRow = async (row: any) => {
        const cleanPhone = row.phone;
        const uidStr = row.user_id ? String(row.user_id) : '';
        const existingConn =
          connectedUserClients.get(cleanPhone) ||
          (uidStr ? connectedUserClients.get(uidStr) : undefined) ||
          (uidStr ? connectedUserClients.get(`acc_tg_${uidStr}`) : undefined);

        if (existingConn) {
          if (!forceReconnect && existingConn.client?.connected) {
            return;
          }
          // Tear down disconnected or proxy-stale client cleanly before reconnecting
          if (existingConn.phone) connectedUserClients.delete(existingConn.phone);
          if (existingConn.userId) {
            connectedUserClients.delete(existingConn.userId);
            connectedUserClients.delete(`acc_tg_${existingConn.userId}`);
          }
          connectedUserClients.delete(cleanPhone);
          await destroyTelegramClientSafely(existingConn.client);
        }

        const rawEncryptedSession = row.session_string;
        const decryptedSession = decryptSensitiveData(rawEncryptedSession);
        if (!decryptedSession) return;

        let client: TelegramClient | null = null;
        try {
          client = new TelegramClient(
            new StringSession(decryptedSession),
            useApiId,
            useApiHash,
            {
              connectionRetries: 5,
              useWSS: false,
              autoReconnect: true,
              deviceModel: 'HumanSense Desktop',
              systemVersion: 'Windows 11',
              appVersion: '4.16.8',
              langCode: 'zh-CN',
              systemLangCode: 'zh-CN',
              ...(telegramProxy ? { proxy: telegramProxy } : {}),
            }
          );
          configureTelegramClientErrorGuard(client, cleanPhone, {
            userId: uidStr || undefined,
            phone: cleanPhone,
            accountId: uidStr ? `acc_tg_${uidStr}` : undefined,
          });
          await withTelegramTimeout(client.connect(), 15000, '启动恢复 Telegram 连接超时');
          const isAuth = await withTelegramTimeout(client.isUserAuthorized(), 10000, '校验 Telegram 会话超时');
          if (isAuth) {
            if (typeof rawEncryptedSession === 'string' && !rawEncryptedSession.startsWith('enc:gcm:')) {
              try {
                await db
                  .prepare('UPDATE telegram_user_sessions SET session_string = ?, updated_at = ? WHERE phone = ?')
                  .run(encryptSensitiveData(decryptedSession), Date.now(), cleanPhone);
              } catch {}
            }

            const userObj: ConnectedTelegramUser = {
              client,
              phone: cleanPhone,
              userId: uidStr,
              username: row.username ? (row.username.startsWith('@') ? row.username : `@${row.username}`) : '',
              firstName: row.first_name || 'Telegram 用户',
              avatarInitial: (row.first_name || 'TG').slice(0, 2).toUpperCase(),
              avatarBg: '#2481cc',
              apiId: useApiId,
              apiHash: useApiHash,
              connectedAt: Date.now(),
              dialogs: [],
            };
            if (uidStr) {
              connectedUserClients.set(uidStr, userObj);
              connectedUserClients.set(`acc_tg_${uidStr}`, userObj);
            }
            connectedUserClients.set(cleanPhone, userObj);
            clearExpiredAccountRecord(uidStr, cleanPhone);

            attachTelegramClientMessageListener(client, cleanPhone, uidStr);

            fetchTelegramUserDialogs(client, 150, uidStr)
              .then((dialogs) => {
                userObj.dialogs = dialogs;
              })
              .catch(() => {});

            restoredCount++;
          } else {
            await destroyTelegramClientSafely(client);
            await markTelegramSessionExpired({
              accountId: uidStr ? `acc_tg_${uidStr}` : cleanPhone,
              userId: uidStr || undefined,
              phone: cleanPhone,
              reason: '启动恢复时检测到 Telegram 会话已失效，请重新登录',
            });
            lastFailureMsg = `账号 ${cleanPhone} 会话已失效，请重新登录`;
          }
        } catch (clientErr: any) {
          await destroyTelegramClientSafely(client);
          const formatted = formatTelegramError(clientErr);
          lastFailureMsg = formatted || '连接 Telegram MTProto 超时';
          console.warn(`[Telegram User Auth Recovery] Could not restore session for ${cleanPhone}:`, clientErr.message);
          if (isTelegramSessionExpiredError(clientErr)) {
            await markTelegramSessionExpired({
              accountId: uidStr ? `acc_tg_${uidStr}` : cleanPhone,
              userId: uidStr || undefined,
              phone: cleanPhone,
              reason: formatted,
            });
          }
        }
      };

      // Restore accounts with bounded concurrency (3) so multiple accounts don't serialize startup
      const CONCURRENCY = 3;
      for (let i = 0; i < dedupedRows.length; i += CONCURRENCY) {
        const batch = dedupedRows.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map((r) => restoreSingleRow(r)));
      }

      telegramSessionRestoreState.restoredCount = restoredCount;
      if (restoredCount > 0) {
        telegramSessionRestoreState.lastSuccessAt = Date.now();
        telegramSessionRestoreState.lastError = null;
        console.log(`[Telegram User Auth Recovery] Successfully restored ${restoredCount} active personal user session(s) from encrypted storage.`);
      } else if (lastFailureMsg) {
        telegramSessionRestoreState.lastError = lastFailureMsg;
      }
      return restoredCount;
    } catch (err: any) {
      telegramSessionRestoreState.lastError = err?.message || '恢复 Telegram 会话失败';
      console.warn('[Telegram User Auth Recovery Exception]:', err.message);
      return 0;
    } finally {
      telegramSessionRestoreState.inProgress = false;
      activeRestorePromise = null;
      activeRestoreMeta = null;
    }
  })();

  return activeRestorePromise;
}

// Background Connection Health Watchdog (every 25s): rebuilds dropped non-expired MTProto sessions
let telegramWatchdogInterval: NodeJS.Timeout | null = null;
let lastWatchdogFailureAt = 0;

export async function runTelegramConnectionWatchdogCycle(): Promise<number> {
  if (telegramSessionRestoreState.inProgress || activeRestorePromise) return 0;
  // Require either active user JWT or configured env/RAM credentials before attempting reconnect
  const hasCredsPath = Boolean(
    lastActiveUserJwt || getEnvTelegramApiCredentials() || getInMemoryTelegramApiCredentials()
  );
  if (!hasCredsPath) return 0;

  let activeRows: any[] = [];
  try {
    activeRows = (await db
      .prepare('SELECT phone, user_id FROM telegram_user_sessions WHERE is_active = 1 LIMIT ?')
      .all(MAX_TELEGRAM_ACCOUNTS * 2)) as any[];
  } catch {
    return 0;
  }
  if (!Array.isArray(activeRows) || activeRows.length === 0) return 0;

  let needsReconnect = false;
  for (const row of activeRows) {
    const uid = row?.user_id ? String(row.user_id).trim() : '';
    const phone = row?.phone ? String(row.phone).trim() : '';
    if (!uid && !phone) continue;

    const isExpired = Boolean(
      (uid && (recentlyExpiredAccounts.has(uid) || recentlyExpiredAccounts.has(`acc_tg_${uid}`))) ||
        (phone && recentlyExpiredAccounts.has(phone))
    );
    if (isExpired) continue;

    const conn = resolveConnectedTelegramUser(uid ? `acc_tg_${uid}` : phone, phone, uid);
    if (!conn || !conn.client || conn.client.connected === false) {
      needsReconnect = true;
      break;
    }
  }

  if (!needsReconnect) {
    lastWatchdogFailureAt = 0;
    return 0;
  }

  // Cooldown 45s after a failed reconnect attempt so offline environments don't thrash
  if (lastWatchdogFailureAt > 0 && Date.now() - lastWatchdogFailureAt < 45000) {
    return 0;
  }

  const restored = await restoreTelegramUserSessionsOnStartup(lastActiveUserJwt || undefined);
  if (restored > 0) {
    lastWatchdogFailureAt = 0;
  } else {
    lastWatchdogFailureAt = Date.now();
  }
  return restored;
}

export function startTelegramConnectionWatchdog(): void {
  if (telegramWatchdogInterval) return;
  telegramWatchdogInterval = setInterval(() => {
    void runTelegramConnectionWatchdogCycle().catch(() => {});
  }, 25000);
  telegramWatchdogInterval.unref?.();
}

export function stopTelegramConnectionWatchdog(): void {
  if (telegramWatchdogInterval) {
    clearInterval(telegramWatchdogInterval);
    telegramWatchdogInterval = null;
  }
}

let activeHttpServer: http.Server | null = null;

export async function gracefulShutdownServer(reason = 'shutdown'): Promise<void> {
  console.log(`[Server Shutdown] Initiating graceful cleanup (${reason})...`);
  stopTelegramConnectionWatchdog();
  try {
    for (const qrSession of activeQrSessions.values()) {
      try {
        if (qrSession.pollTimer) clearTimeout(qrSession.pollTimer);
        qrSession.isStopped = true;
        await destroyTelegramClientSafely(qrSession.client);
      } catch {}
    }
    activeQrSessions.clear();

    for (const pending of activeUserClients.values()) {
      try {
        await destroyTelegramClientSafely(pending.client);
      } catch {}
    }
    activeUserClients.clear();

    const uniqueClients = new Set<TelegramClient>();
    for (const conn of connectedUserClients.values()) {
      if (conn?.client) uniqueClients.add(conn.client);
    }
    await Promise.allSettled(Array.from(uniqueClients).map((c) => destroyTelegramClientSafely(c)));
    connectedUserClients.clear();
  } catch {}

  if (activeHttpServer) {
    const srv = activeHttpServer;
    activeHttpServer = null;
    await new Promise<void>((resolve) => {
      try {
        srv.close(() => resolve());
        try {
          (srv as any).closeIdleConnections?.();
          (srv as any).closeAllConnections?.();
        } catch {}
        setTimeout(resolve, 1500).unref();
      } catch {
        resolve();
      }
    });
  }
}

// Expose graceful cleanup hook for Electron in-process main.cjs before-quit handler
(globalThis as any).__humansenseGracefulShutdown = gracefulShutdownServer;

// Start server
async function startServer() {
  try {
    dbInitError = null;
    await initDatabase();
    await loadRevokedJwtTokensFromDb();
    await purgePersistedTelegramApiCredentialsFromDb();
    await loadSystemProxyConfigFromDb();
    await seedDatabaseIfEmpty();
  } catch (err: any) {
    dbInitError = err?.message || '本地 SQLite 数据库初始化失败';
    console.error('[Database Init Error]:', dbInitError);
  }

  // Automatic webhook registration on server startup if configured
  const autoRegister = process.env.TELEGRAM_AUTO_REGISTER_WEBHOOK === 'true' || process.env.AUTO_REGISTER_WEBHOOK === 'true';
  const autoBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const autoWebhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (autoRegister && autoBotToken && autoWebhookUrl) {
    try {
      console.log(`[Telegram Auto-Register] Auto-registering Webhook URL: ${autoWebhookUrl}...`);
      const payload: Record<string, any> = {
        url: autoWebhookUrl,
        allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query'],
      };
      if (process.env.TELEGRAM_WEBHOOK_SECRET) {
        payload.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
      }
      const tgRes = await fetch(`https://api.telegram.org/bot${autoBotToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const tgData = await tgRes.json();
      console.log('[Telegram Auto-Register] Telegram response:', tgData);
    } catch (autoErr: any) {
      console.warn('[Telegram Auto-Register Warning]:', autoErr.message);
    }
  } else if (autoBotToken) {
    void startTelegramBotLongPolling();
  }

  const httpServer = http.createServer(app);
  activeHttpServer = httpServer;

  if (!isProduction) {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isHmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    // SPA fallback in development mode
    app.use('*', async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        if (fs.existsSync(indexPath)) {
          let html = fs.readFileSync(indexPath, 'utf-8');
          html = await vite.transformIndexHtml(req.originalUrl, html);
          res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
          return;
        }
      } catch (e: any) {
        vite.ssrFixStacktrace?.(e);
        return next(e);
      }
      next();
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const staticDir = fs.existsSync(path.resolve(distDir, 'index.html'))
      ? distDir
      : __dirname;
    app.use(express.static(staticDir));
    app.get('*', (req: Request, res: Response) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        return res.status(404).json({ ok: false, error: '请求的 API 接口不存在' });
      }
      return res.sendFile(path.resolve(staticDir, 'index.html'));
    });
  }

  httpServer.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[Fatal Server Error] Port ${PORT} on ${HOST} is already in use.`);
      if (!isElectronMainProcess) {
        process.exit(1);
      } else {
        void gracefulShutdownServer('eaddrinuse');
      }
    }
  });

  if (!isElectronMainProcess) {
    const onShutdown = (sig: string) => {
      void gracefulShutdownServer(sig).finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 2500).unref();
    };
    process.on('SIGTERM', () => onShutdown('SIGTERM'));
    process.on('SIGINT', () => onShutdown('SIGINT'));
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`HumanSense Server running at http://${HOST}:${PORT}`);
    // Run Telegram MTProto session recovery asynchronously AFTER HTTP port is bound so /api/health responds immediately
    void restoreTelegramUserSessionsOnStartup();
    startTelegramConnectionWatchdog();
  });
}

const isTestMode =
  process.env.AIS_TEST_IMPORT === 'true' ||
  process.env.NODE_ENV === 'test';

if (!isTestMode) {
  startServer();
}
