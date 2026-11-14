import {
  CustomLLMConfig,
  Message,
  CustomerProfile,
  GlobalPersonaConfig,
  EvolutionEngineState,
  KnowledgeBaseItem,
  ChatTranscriptItem,
  MemberUser,
  TelegramContact,
  Chat,
  TelegramChatFullInfo,
  TelegramStickerPack,
  TelegramStickerItem,
  TranslationSettings,
  SystemProxyConfig,
} from '../types';

// ==================== SESSION TOKEN & TENANT AUTHENTICATION HELPERS ====================

export const CLOUD_AUTH_BASE_URL = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_CLOUD_AUTH_URL) ||
  'https://telegramaiintelligence.s233099099.workers.dev'
).replace(/\/+$/, '');

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

const SESSION_STORAGE_KEY = 'tg_pro_session_token';
const MEMBER_USER_STORAGE_KEY = 'tg_pro_member_user';
const ACTIVE_ACCOUNT_STORAGE_KEY = 'tg_pro_active_account_id';

let currentSessionToken: string = (() => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(SESSION_STORAGE_KEY) || '';
  }
  return '';
})();

let currentActiveAccountId: string = (() => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY) || '';
  }
  return '';
})();

export function setActiveApiAccount(accountId: string) {
  currentActiveAccountId = accountId;
  if (typeof window !== 'undefined') {
    if (accountId) {
      localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, accountId);
    } else {
      localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY);
    }
  }
}

export function getActiveApiAccount(): string {
  return currentActiveAccountId;
}

export function getSessionToken(): string {
  return currentSessionToken;
}

export function setSessionToken(token: string) {
  currentSessionToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }
}

let cachedDeviceId = '';

export async function fetchLocalDeviceId(): Promise<{ deviceId: string; maxTelegramAccounts: number }> {
  if (cachedDeviceId) {
    return { deviceId: cachedDeviceId, maxTelegramAccounts: 20 };
  }
  try {
    const res = await fetchWithTimeout('/api/auth/device-id', { credentials: 'include' }, 8000);
    if (res.ok) {
      const data = await res.json();
      if (data?.deviceId) {
        cachedDeviceId = String(data.deviceId);
        return {
          deviceId: cachedDeviceId,
          maxTelegramAccounts: Number(data.maxTelegramAccounts) || 20,
        };
      }
    }
  } catch (err) {
    console.warn('Failed to fetch device id:', err);
  }
  return { deviceId: '', maxTelegramAccounts: 20 };
}

export function getStoredMemberUser(): MemberUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(MEMBER_USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredMemberUser(user: MemberUser | null) {
  if (typeof window === 'undefined') return;
  if (user) {
    localStorage.setItem(MEMBER_USER_STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(MEMBER_USER_STORAGE_KEY);
  }
}

export async function initSessionHandshake(): Promise<{
  authenticated: boolean;
  token?: string;
  user?: MemberUser;
  code?: string;
  message?: string;
}> {
  if (!currentSessionToken) {
    return { authenticated: false };
  }
  try {
    const res = await fetchWithTimeout(
      '/api/auth/session-init',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
      },
      10000
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.authenticated && data.user) {
      return { authenticated: true, token: currentSessionToken, user: data.user };
    }
    if (res.status === 401 || res.status === 403) {
      setSessionToken('');
      setStoredMemberUser(null);
      return { authenticated: false, code: data?.code, message: data?.message };
    }
  } catch (err) {
    console.warn('[Session Handshake Warning]:', err);
  }
  return { authenticated: false };
}

export const TELEGRAM_MAX_MEDIA = 512 * 1024 * 1024;

export function getAuthHeaders(accountId?: string, options?: { omitContentType?: boolean }): Record<string, string> {
  const effectiveAcc = accountId || currentActiveAccountId;
  const headers: Record<string, string> = {};
  if (!options?.omitContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (effectiveAcc) {
    headers['X-Account-Id'] = effectiveAcc;
  }
  if (currentSessionToken) {
    headers['Authorization'] = `Bearer ${currentSessionToken}`;
  }
  return headers;
}

const SIGNED_RESOURCE_PATH_PREFIXES = [
  '/api/telegram/user/media/',
  '/api/telegram/user/avatar/',
  '/api/telegram/user/sticker/',
  '/api/messages/local-media/',
];

const signedResourceRefreshInFlight = new Map<string, Promise<string>>();
const signedResourceRefreshCooldown = new Map<string, number>();
const SIGNED_RESOURCE_REFRESH_COOLDOWN_MS = 60 * 1000;

export function isSignedResourceUrl(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false;
  try {
    const parsed = new URL(trimmed, 'http://localhost');
    return SIGNED_RESOURCE_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return SIGNED_RESOURCE_PATH_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
  }
}

export function parseSignedResourceExpiry(rawUrl?: string): number | null {
  if (!isSignedResourceUrl(rawUrl) || !rawUrl) return null;
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const expStr = parsed.searchParams.get('exp');
    if (!expStr) return 0;
    const expMs = Number(expStr);
    return Number.isFinite(expMs) && expMs > 0 ? expMs : 0;
  } catch {
    return null;
  }
}

export function isSignedResourceUrlExpiringSoon(
  rawUrl?: string,
  bufferMs: number = 24 * 60 * 60 * 1000
): boolean {
  const expMs = parseSignedResourceExpiry(rawUrl);
  if (expMs === null) return false;
  return expMs <= Date.now() + bufferMs;
}

export async function refreshSignedResourceUrlsApi(
  urls: string[],
  accountId?: string
): Promise<Record<string, string>> {
  const uniqueUrls = Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [])
        .map((u) => (typeof u === 'string' ? u.trim() : ''))
        .filter((u) => isSignedResourceUrl(u))
    )
  ).slice(0, 60);

  if (uniqueUrls.length === 0) return {};

  try {
    const effectiveAccountId = accountId || currentActiveAccountId || undefined;
    const res = await fetchWithTimeout(
      '/api/telegram/resource/refresh-url',
      {
        method: 'POST',
        headers: getAuthHeaders(effectiveAccountId),
        credentials: 'include',
        body: JSON.stringify({
          urls: uniqueUrls,
          accountId: effectiveAccountId,
        }),
      },
      10000
    );
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok && data.refreshed && typeof data.refreshed === 'object') {
      return data.refreshed as Record<string, string>;
    }
  } catch (err) {
    console.warn('Silent signed URL refresh failed:', err);
  }
  return {};
}

export async function ensureFreshSignedResourceUrl(
  rawUrl: string,
  accountId?: string,
  options?: { force?: boolean; bufferMs?: number }
): Promise<string> {
  if (!rawUrl || !isSignedResourceUrl(rawUrl)) return rawUrl;
  const force = Boolean(options?.force);
  if (!force && !isSignedResourceUrlExpiringSoon(rawUrl, options?.bufferMs)) {
    return rawUrl;
  }

  const lastAttempt = signedResourceRefreshCooldown.get(rawUrl) || 0;
  if (Date.now() - lastAttempt < SIGNED_RESOURCE_REFRESH_COOLDOWN_MS) {
    return rawUrl;
  }

  const cacheKey = `${accountId || currentActiveAccountId || ''}::${rawUrl}`;
  const existingPromise = signedResourceRefreshInFlight.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async () => {
    signedResourceRefreshCooldown.set(rawUrl, Date.now());
    const refreshedMap = await refreshSignedResourceUrlsApi([rawUrl], accountId);
    const nextUrl = refreshedMap[rawUrl];
    if (nextUrl && typeof nextUrl === 'string') {
      signedResourceRefreshCooldown.set(nextUrl, Date.now());
      return nextUrl;
    }
    return rawUrl;
  })().finally(() => {
    signedResourceRefreshInFlight.delete(cacheKey);
  });

  signedResourceRefreshInFlight.set(cacheKey, promise);
  return promise;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  status: string;
  user?: MemberUser | null;
  deviceId?: string;
  maxAccounts?: number;
  authErrorCode?: string;
  authErrorMessage?: string;
  totalMembers?: number;
  jwtConfigured?: boolean;
  jwtMode?: 'asymmetric' | 'hs256' | 'unconfigured';
  hasConfiguredAdminHash?: boolean;
  telegramWebhookConfigured: boolean;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  clearLegacyLocalTelegramCredentials();
  try {
    const res = await fetchWithTimeout(
      '/api/auth/status',
      {
        headers: getAuthHeaders(),
        credentials: 'include',
      },
      10000
    );
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Failed to fetch auth status:', err);
  }
  return {
    authenticated: false,
    status: 'unauthenticated',
    totalMembers: 0,
    jwtConfigured: false,
    jwtMode: 'unconfigured',
    telegramWebhookConfigured: false,
  };
}

function normalizeCloudUser(data: any, fallbackUsername: string): MemberUser {
  const raw = data?.user && typeof data.user === 'object' ? data.user : {};
  const username = String(raw.username || data?.username || fallbackUsername);
  const id = String(raw.id || raw.userId || raw.sub || data?.userId || data?.id || username);
  const role = String(raw.role || data?.role || 'member');
  const vipRaw = raw.vipExpiresAt ?? data?.vipExpiresAt ?? raw.planExpiresAt ?? data?.planExpiresAt;
  const vipExpiresAt =
    typeof vipRaw === 'number' && Number.isFinite(vipRaw)
      ? vipRaw > 1e12
        ? vipRaw
        : vipRaw * 1000
      : undefined;
  return {
    id,
    username,
    role,
    plan: raw.plan || data?.plan,
    vipExpiresAt,
    boundDeviceId: raw.boundDeviceId || raw.deviceId || data?.deviceId,
    maxAccounts: Number(raw.maxAccounts || data?.maxAccounts) || 20,
  };
}

export async function getPreLoginProxyApi(): Promise<{
  ok: boolean;
  config?: SystemProxyConfig;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/auth/proxy', { credentials: 'include' }, 8000);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok && data.config) {
      return { ok: true, config: data.config };
    }
    return { ok: false, error: data?.error || `读取代理配置失败 (HTTP ${res.status})` };
  } catch (err: any) {
    return { ok: false, error: err?.message || '读取代理配置失败' };
  }
}

export async function savePreLoginProxyApi(payload: SystemProxyConfig & { preservePassword?: boolean }): Promise<{
  ok: boolean;
  config?: SystemProxyConfig;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout(
      '/api/auth/proxy',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      },
      10000
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || `保存代理设置失败 (HTTP ${res.status})` };
    }
    return data;
  } catch (err: any) {
    return { ok: false, error: err?.message || '保存代理设置失败' };
  }
}

export async function memberRegister(
  username: string,
  password: string,
  cardKey: string
): Promise<{ ok: boolean; message?: string; error?: string; code?: string; proxyEnabled?: boolean; token?: string; user?: MemberUser }> {
  try {
    const { deviceId } = await fetchLocalDeviceId();
    const res = await fetchWithTimeout(
      '/api/auth/cloud-register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password, cardKey: cardKey.trim(), deviceId }),
      },
      16000
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      return {
        ok: false,
        code: data?.code,
        proxyEnabled: typeof data?.proxyEnabled === 'boolean' ? data.proxyEnabled : undefined,
        error: data?.error || data?.message || `注册失败 (HTTP ${res.status})`,
      };
    }

    const normalizedUser = normalizeCloudUser(data, username);
    setSessionToken(data.token);
    setStoredMemberUser(normalizedUser);

    return {
      ok: true,
      message: data.message || '卡密激活并注册成功！',
      token: data.token,
      user: normalizedUser,
    };
  } catch (err: any) {
    const rawMsg = String(err?.message || '');
    const friendly = /failed to fetch|network|超时/i.test(rawMsg)
      ? '无法连接云端会员授权中心，请检查网络或在下方配置 SOCKS5 代理后重试'
      : rawMsg || '云端认证服务连接异常';
    return { ok: false, code: 'CLOUD_AUTH_UNREACHABLE', error: friendly };
  }
}

export async function memberLogin(
  username: string,
  password: string
): Promise<{ ok: boolean; message?: string; error?: string; code?: string; proxyEnabled?: boolean; token?: string; user?: MemberUser }> {
  try {
    const { deviceId } = await fetchLocalDeviceId();
    const res = await fetchWithTimeout(
      '/api/auth/cloud-login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password, deviceId }),
      },
      16000
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      return {
        ok: false,
        code: data?.code,
        proxyEnabled: typeof data?.proxyEnabled === 'boolean' ? data.proxyEnabled : undefined,
        error: data?.error || data?.message || `登录失败 (HTTP ${res.status})`,
      };
    }

    const normalizedUser = normalizeCloudUser(data, username);
    setSessionToken(data.token);
    setStoredMemberUser(normalizedUser);

    return {
      ok: true,
      message: data.message || '云端会员登录成功！',
      token: data.token,
      user: normalizedUser,
    };
  } catch (err: any) {
    const rawMsg = String(err?.message || '');
    const friendly = /failed to fetch|network|超时/i.test(rawMsg)
      ? '无法连接云端会员授权中心，请检查网络或在下方配置 SOCKS5 代理后重试'
      : rawMsg || '云端认证服务连接异常';
    return { ok: false, code: 'CLOUD_AUTH_UNREACHABLE', error: friendly };
  }
}

export async function memberRedeemCardKey(
  username: string,
  cardKey: string,
  password?: string
): Promise<{ ok: boolean; message?: string; error?: string; code?: string; proxyEnabled?: boolean; token?: string; user?: MemberUser }> {
  try {
    const { deviceId } = await fetchLocalDeviceId();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (currentSessionToken) {
      headers['Authorization'] = `Bearer ${currentSessionToken}`;
    }
    const res = await fetchWithTimeout(
      '/api/auth/cloud-redeem',
      {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          username: username.trim(),
          cardKey: cardKey.trim(),
          ...(password ? { password } : {}),
          deviceId,
        }),
      },
      16000
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      return {
        ok: false,
        code: data?.code,
        proxyEnabled: typeof data?.proxyEnabled === 'boolean' ? data.proxyEnabled : undefined,
        error: data?.error || data?.message || `卡密续费失败 (HTTP ${res.status})`,
      };
    }

    const normalizedUser = normalizeCloudUser(data, username);
    setSessionToken(data.token);
    setStoredMemberUser(normalizedUser);

    return {
      ok: true,
      message: data.message || '卡密激活续费成功！',
      token: data.token,
      user: normalizedUser,
    };
  } catch (err: any) {
    const rawMsg = String(err?.message || '');
    const friendly = /failed to fetch|network|超时/i.test(rawMsg)
      ? '无法连接云端会员授权中心，请检查网络或在下方配置 SOCKS5 代理后重试'
      : rawMsg || '云端认证服务连接异常';
    return { ok: false, code: 'CLOUD_AUTH_UNREACHABLE', error: friendly };
  }
}

export async function adminLogin(password: string): Promise<{ ok: boolean; message?: string; error?: string; user?: any }> {
  return memberLogin('admin', password);
}

let lastMemberAuthExpiredEventAt = 0;

export function notifyIfMemberAuthExpired(res: Response, parsedBody?: any): void {
  if (typeof window === 'undefined') return;
  if (res.status !== 401 && res.status !== 403) return;
  const code = String(parsedBody?.code || '');
  const isMemberAuthError =
    code === 'VIP_EXPIRED' ||
    code === 'AUTH_SESSION_REQUIRED' ||
    code === 'AUTH_SESSION_REVOKED' ||
    code === 'DEVICE_MISMATCH';
  if (!isMemberAuthError) return;

  const now = Date.now();
  if (now - lastMemberAuthExpiredEventAt < 1500) return;
  lastMemberAuthExpiredEventAt = now;

  setSessionToken('');
  setStoredMemberUser(null);
  window.dispatchEvent(
    new CustomEvent('hs_member_auth_expired', {
      detail: {
        code,
        message: parsedBody?.message || parsedBody?.error || '会员会话已失效，请重新登录或续费卡密',
      },
    })
  );
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const callerSignal = init.signal;
  if (callerSignal?.aborted) {
    const abortErr = new Error('请求已取消');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = () => {
    controller.abort();
  };
  if (callerSignal) {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    const urlStr = typeof input === 'string' ? input : '';
    const isPreAuthRoute =
      urlStr.startsWith('/api/auth/cloud-') ||
      urlStr === '/api/auth/status' ||
      urlStr === '/api/auth/session-init';
    if ((res.status === 401 || res.status === 403) && urlStr.startsWith('/api/') && !isPreAuthRoute) {
      try {
        const cloned = res.clone();
        const errData = await cloned.json().catch(() => ({}));
        notifyIfMemberAuthExpired(res, errData);
      } catch {}
    }
    return res;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      if (timedOut && !callerSignal?.aborted) {
        throw new Error('请求超时，请检查网络连接后重试');
      }
      const abortErr = new Error('请求已取消');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

export async function adminLogout(options?: { revokeTelegramSessions?: boolean }): Promise<{ ok: boolean }> {
  clearLegacyLocalTelegramCredentials();
  try {
    const res = await fetchWithTimeout(
      '/api/auth/logout',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          revokeTelegramSessions: Boolean(options?.revokeTelegramSessions),
        }),
      },
      10000
    );
    setSessionToken('');
    setStoredMemberUser(null);
    currentActiveAccountId = '';
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY);
    }
    return res.ok ? await res.json() : { ok: true };
  } catch {
    setSessionToken('');
    setStoredMemberUser(null);
    currentActiveAccountId = '';
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY);
    }
    return { ok: true };
  }
}

export async function fetchRegisteredUsersStats(): Promise<{ ok: boolean; totalMembers: number; users: any[] }> {
  try {
    const res = await fetchWithTimeout(
      '/api/admin/users/stats',
      {
        headers: getAuthHeaders(),
        credentials: 'include',
      },
      10000
    );
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return { ok: false, totalMembers: 0, users: [] };
}

export async function fetchSessionStatus(): Promise<any> {
  return await fetchAuthStatus();
}

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

export function inferGatewayProtocolFromUrlAndModel(
  baseUrl?: string,
  modelName?: string
): 'openai' | 'gemini' | 'anthropic' {
  const url = (baseUrl || '').toLowerCase();
  const model = (modelName || '').toLowerCase();
  if (url.includes('googleapis.com')) return 'gemini';
  if (url.includes('anthropic.com')) return 'anthropic';
  if (!url && model.includes('claude')) return 'anthropic';
  return 'openai';
}

const MAX_TRANSLATE_CACHE = 300;
const TRANSLATE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_TRANSLATE_CONCURRENCY = 3;

const translateCache = new Map<string, { value: string; expiresAt: number }>();
const inFlightTranslations = new Map<string, Promise<string>>();
let activeTranslationRequests = 0;
const translationWaitQueue: Array<() => void> = [];

function getTranslateCache(key: string): string | null {
  const hit = translateCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    translateCache.delete(key);
    return null;
  }
  translateCache.delete(key);
  translateCache.set(key, hit);
  return hit.value;
}

function setTranslateCache(key: string, value: string): void {
  if (!value) return;
  if (translateCache.has(key)) translateCache.delete(key);
  while (translateCache.size >= MAX_TRANSLATE_CACHE) {
    const oldestKey = translateCache.keys().next().value;
    if (oldestKey === undefined) break;
    translateCache.delete(oldestKey);
  }
  translateCache.set(key, { value, expiresAt: Date.now() + TRANSLATE_CACHE_TTL_MS });
}

function normalizeClientLangCode(lang?: string): string {
  const raw = (lang || '').trim();
  if (!raw) return 'auto';
  const low = raw.toLowerCase();
  if (low === 'auto') return 'auto';
  if (low === 'chinese' || low === 'zh' || low === 'zh-cn' || low === 'zh-hans') return 'zh-cn';
  if (low === 'traditional chinese' || low === 'zh-tw' || low === 'zh-hant' || low === 'zh-hk') return 'zh-tw';
  if (low === 'english' || low === 'en' || low === 'en-us' || low === 'en-gb') return 'en';
  if (low === 'japanese' || low === 'ja' || low === 'jp') return 'ja';
  if (low === 'korean' || low === 'ko' || low === 'kr') return 'ko';
  if (low === 'russian' || low === 'ru') return 'ru';
  if (low === 'spanish' || low === 'es') return 'es';
  if (low === 'french' || low === 'fr') return 'fr';
  if (low === 'german' || low === 'de') return 'de';
  if (low === 'portuguese' || low === 'pt' || low === 'pt-br') return 'pt';
  if (low === 'italian' || low === 'it') return 'it';
  if (low === 'arabic' || low === 'ar') return 'ar';
  if (low === 'turkish' || low === 'türkçe' || low === 'tr') return 'tr';
  if (low === 'vietnamese' || low === 'vi') return 'vi';
  if (low === 'thai' || low === 'th') return 'th';
  if (low === 'indonesian' || low === 'id') return 'id';
  return low;
}

async function runQueuedTranslation<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    const abortErr = new Error('请求已取消');
    abortErr.name = 'AbortError';
    throw abortErr;
  }
  if (activeTranslationRequests >= MAX_TRANSLATE_CONCURRENCY) {
    await new Promise<void>((resolve, reject) => {
      const release = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const idx = translationWaitQueue.indexOf(release);
        if (idx >= 0) translationWaitQueue.splice(idx, 1);
        const abortErr = new Error('请求已取消');
        abortErr.name = 'AbortError';
        reject(abortErr);
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      translationWaitQueue.push(release);
    });
  }
  activeTranslationRequests++;
  try {
    return await fn();
  } finally {
    activeTranslationRequests = Math.max(0, activeTranslationRequests - 1);
    const next = translationWaitQueue.shift();
    if (next) next();
  }
}

export async function translateText(
  text: string,
  sourceLang: string = 'Auto',
  targetLang: string = 'Chinese',
  customConfig?: CustomLLMConfig,
  engine: 'gemini' | 'google' | 'custom_llm' = 'gemini',
  googleApiKey?: string,
  geminiModel?: string,
  geminiApiKey?: string,
  customModelName?: string,
  options?: { signal?: AbortSignal; bypassCache?: boolean }
): Promise<string> {
  const trimmedText = typeof text === 'string' ? text.trim() : '';
  if (!trimmedText) return '';

  const normSrc = normalizeClientLangCode(sourceLang);
  const normTarget = normalizeClientLangCode(targetLang);
  if (normSrc !== 'auto' && normTarget !== 'auto' && normSrc === normTarget) {
    return text;
  }

  const isDualOff = Boolean(
    customConfig && (customConfig.enabled === false || customConfig.explicitlyDisabled)
  );
  const isPriorityCustom = Boolean(
    !isDualOff && customConfig?.enabled && customConfig?.engineMode === 'custom'
  );
  const strictEngine: 'gemini' | 'google' | 'custom_llm' =
    engine === 'google' || engine === 'custom_llm' || engine === 'gemini' ? engine : 'gemini';

  if (isDualOff && strictEngine !== 'google') {
    throw new Error('当前处于双关状态（云端与自有大模型均已关闭），仅支持「谷歌机翻」；如需使用大模型翻译，请前往「模型」开启对应引擎');
  }
  if (isPriorityCustom && strictEngine !== 'custom_llm') {
    throw new Error('已开启「优先自有密钥回复」，当前仅允许使用「自定义模型」翻译；请切换为自定义模型或切回云端主引擎');
  }
  if (!isPriorityCustom && strictEngine === 'custom_llm') {
    throw new Error('当前未开启「优先自有密钥回复」，不可选择自定义模型翻译；请前往「模型」开启「启用优先自有密钥回复」');
  }

  const cleanBaseUrl = (customConfig?.baseUrl || '').trim();
  const cleanApiKey = (customConfig?.apiKey || '').trim();
  const effectiveCustomModel =
    (customModelName || '').trim() || (customConfig?.modelName || '').trim() || 'gpt-4o-mini';

  if (strictEngine === 'custom_llm') {
    if (!customConfig || !cleanBaseUrl || isBuiltInCloudGatewayUrl(cleanBaseUrl)) {
      throw new Error(
        '已开启「优先自有密钥回复」，请先在「模型 → 接入自有模型网关」填写大模型接入网址 (Base URL) 与 API 密钥'
      );
    }
    const isLocalhost =
      cleanBaseUrl.includes('localhost') ||
      cleanBaseUrl.includes('127.0.0.1') ||
      cleanBaseUrl.includes('[::1]');
    if (!cleanApiKey && !isLocalhost) {
      throw new Error('自定义翻译/自有密钥通道缺少 API 密钥，请在「模型 → 接入自有模型网关」填写 API 密钥');
    }
  }

  const inferredProtocol = inferGatewayProtocolFromUrlAndModel(cleanBaseUrl, effectiveCustomModel);
  const safeCustomConfigForTranslation =
    strictEngine === 'custom_llm'
      ? {
          ...customConfig,
          enabled: true,
          explicitlyDisabled: false,
          engineMode: 'custom' as const,
          protocol: inferredProtocol,
          modelName: effectiveCustomModel,
          knowledgeBaseApiUrl: '',
          knowledgeBaseApiKey: '',
          enableKnowledgeBaseRAG: false,
        }
      : undefined;

  const modelCacheTag =
    strictEngine === 'gemini'
      ? geminiModel || ''
      : strictEngine === 'custom_llm'
      ? `${cleanBaseUrl}|${effectiveCustomModel}`
      : '';
  const cacheKey = `${strictEngine}|${normSrc}|${normTarget}|${modelCacheTag}|${trimmedText}`;

  if (!options?.bypassCache) {
    const cached = getTranslateCache(cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  const executeRequest = async (): Promise<string> => {
    const res = await fetchWithTimeout(
      '/api/translate',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        signal: options?.signal,
        body: JSON.stringify({
          text,
          sourceLang,
          targetLang,
          engine: strictEngine,
          googleApiKey,
          geminiModel: strictEngine === 'gemini' ? geminiModel : undefined,
          geminiApiKey: strictEngine === 'gemini' ? geminiApiKey : undefined,
          customModelName: strictEngine === 'custom_llm' ? effectiveCustomModel : undefined,
          engineLicenseKey: strictEngine === 'gemini' ? customConfig?.engineLicenseKey : undefined,
          customConfig: safeCustomConfigForTranslation,
        }),
      },
      30000
    );

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      throw new Error(errData?.error || `当前翻译通道不可用 (${res.status})`);
    }
    const data = await res.json();
    if (typeof data?.translatedText !== 'string' || !data.translatedText.trim()) {
      throw new Error(data?.error || '翻译服务未返回有效译文');
    }
    const decoded = decodeHtmlEntities(data.translatedText);
    setTranslateCache(cacheKey, decoded);
    return decoded;
  };

  if (!options?.signal && !options?.bypassCache) {
    const inFlight = inFlightTranslations.get(cacheKey);
    if (inFlight) return inFlight;
    const promise = runQueuedTranslation(executeRequest).finally(() => {
      inFlightTranslations.delete(cacheKey);
    });
    inFlightTranslations.set(cacheKey, promise);
    return promise;
  }

  return await runQueuedTranslation(executeRequest, options?.signal);
}

export async function transcribeAudio(audioBase64: string, mimeType: string = 'audio/webm', customConfig?: CustomLLMConfig): Promise<string> {
  let payloadAudio = audioBase64;
  let effectiveMime = mimeType;
  if (
    typeof audioBase64 === 'string' &&
    (audioBase64.startsWith('blob:') ||
      audioBase64.startsWith('/') ||
      audioBase64.startsWith('http://') ||
      audioBase64.startsWith('https://'))
  ) {
    let targetAudioUrl = audioBase64;
    if (isSignedResourceUrlExpiringSoon(targetAudioUrl)) {
      targetAudioUrl = await ensureFreshSignedResourceUrl(targetAudioUrl);
    }
    const fetchMediaRes = (targetUrl: string) =>
      fetchWithTimeout(
        targetUrl,
        targetUrl.startsWith('/')
          ? {
              headers: getAuthHeaders(undefined, { omitContentType: true }),
              credentials: 'include',
            }
          : { credentials: 'include' },
        20000
      );
    let mediaRes = await fetchMediaRes(targetAudioUrl);
    if ((mediaRes.status === 401 || mediaRes.status === 403) && isSignedResourceUrl(targetAudioUrl)) {
      const refreshedUrl = await ensureFreshSignedResourceUrl(targetAudioUrl, undefined, { force: true });
      if (refreshedUrl && refreshedUrl !== targetAudioUrl) {
        mediaRes = await fetchMediaRes(refreshedUrl);
      }
    }
    if (!mediaRes.ok) {
      throw new Error(`读取语音音频失败 (HTTP ${mediaRes.status})`);
    }
    const blob = await mediaRes.blob();
    effectiveMime = blob.type || mimeType;
    payloadAudio = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('读取本地语音缓存失败'));
      reader.readAsDataURL(blob);
    });
  }
  const res = await fetchWithTimeout(
    '/api/audio/transcribe',
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        audioBase64: payloadAudio,
        mimeType: effectiveMime,
        customConfig: customConfig?.enabled ? customConfig : undefined,
      }),
    },
    45000
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || errData?.message || `语音转写失败 (HTTP ${res.status})`);
  }

  const data = await res.json();
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (!text) {
    throw new Error('语音识别服务未返回有效文字内容');
  }
  return text;
}

export async function syncCustomLLMConfigApi(config: CustomLLMConfig): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      '/api/llm/config',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(config),
      },
      10000
    );
    return res.ok;
  } catch (err) {
    console.warn('Failed to sync custom LLM config to server:', err);
    return false;
  }
}

export async function fetchCustomLLMConfigApi(): Promise<CustomLLMConfig | null> {
  try {
    const res = await fetchWithTimeout(
      '/api/llm/config',
      {
        headers: getAuthHeaders(),
      },
      10000
    );
    if (res.ok) {
      const raw = await res.json().catch(() => null);
      const candidate =
        raw && typeof raw === 'object' && raw.config && typeof raw.config === 'object'
          ? raw.config
          : raw;
      if (
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        ('enabled' in candidate ||
          'engineMode' in candidate ||
          'modelName' in candidate ||
          'baseUrl' in candidate ||
          'protocol' in candidate)
      ) {
        const { success: _s, config: _c, settings: _st, ...cleanConfig } = candidate as any;
        return cleanConfig as CustomLLMConfig;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch custom LLM config from server:', err);
  }
  return null;
}

export async function syncTranslationSettingsApi(settings: TranslationSettings): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      '/api/translate/settings',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(settings),
      },
      10000
    );
    return res.ok;
  } catch (err) {
    console.warn('Failed to sync translation settings to server:', err);
    return false;
  }
}

export async function fetchTranslationSettingsApi(): Promise<TranslationSettings | null> {
  try {
    const res = await fetchWithTimeout(
      '/api/translate/settings',
      {
        headers: getAuthHeaders(),
      },
      10000
    );
    if (res.ok) {
      const raw = await res.json().catch(() => null);
      const candidate =
        raw && typeof raw === 'object' && raw.settings && typeof raw.settings === 'object'
          ? raw.settings
          : raw;
      if (
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        ('preferredEngine' in candidate ||
          'defaultTargetLang' in candidate ||
          'defaultSourceLang' in candidate ||
          'autoTranslateInbound' in candidate ||
          'geminiModel' in candidate)
      ) {
        const { success: _s, config: _c, settings: _st, ...cleanSettings } = candidate as any;
        return cleanSettings as TranslationSettings;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch translation settings from server:', err);
  }
  return null;
}

export async function generateTTSVoice(
  text: string,
  voiceName: string = 'Kore',
  toneStyle: string = 'Natural, friendly human voice',
  customConfig?: CustomLLMConfig,
  importance: 'normal' | 'high' = 'normal',
  emotion: string = '',
  model: string = 'gemini-3.8-flash-tts'
): Promise<{ audioUrl?: string; format?: string; modelUsed?: string; routingReason?: string; error?: string }> {
  try {
    const cleanBaseUrl = (customConfig?.baseUrl || '').trim();
    const cleanApiKey = (customConfig?.apiKey || '').trim();
    const ttsGatewayConfig =
      cleanBaseUrl || cleanApiKey
        ? {
            baseUrl: cleanBaseUrl,
            apiKey: cleanApiKey,
            protocol: inferGatewayProtocolFromUrlAndModel(cleanBaseUrl, model),
            customHeaders: customConfig?.customHeaders || '',
          }
        : undefined;

    const res = await fetchWithTimeout(
      '/api/audio/tts-clone',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          text,
          voiceName,
          toneStyle,
          importance,
          emotion,
          model,
          customConfig: ttsGatewayConfig,
        }),
      },
      45000
    );

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      return { error: errData?.message || errData?.error || `语音合成失败 (HTTP ${res.status})` };
    }
    return await res.json();
  } catch (err: any) {
    return { error: err?.message || '语音合成网络异常' };
  }
}

export async function pollIncomingTelegramUpdates(accountId?: string): Promise<any[]> {
  try {
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    const res = await fetchWithTimeout(`/api/telegram/user/poll-updates${query}`, {
      headers: getAuthHeaders(accountId),
    }, 10000);
    if (res.ok) {
      const data = await res.json();
      return data.updates || [];
    }
  } catch (err) {
    // Polling failure is non-fatal
  }
  return [];
}

export async function ackIncomingTelegramUpdates(ids: string[], accountId?: string): Promise<boolean> {
  if (!Array.isArray(ids) || ids.length === 0) return true;
  try {
    const res = await fetchWithTimeout(
      '/api/telegram/user/ack-updates',
      {
        method: 'POST',
        headers: getAuthHeaders(accountId),
        body: JSON.stringify({ ids, accountId }),
      },
      10000
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendAutonomousChat(
  messages: Array<{
    id?: string;
    role: string;
    content?: string;
    text?: string;
    sender?: string;
    timestamp?: string;
    createdAt?: number;
    sttText?: string;
    imageCaption?: string;
  }>,
  customConfig: CustomLLMConfig,
  personaPrompt: string,
  datingMode: boolean = false,
  chatId?: string,
  accountId?: string,
  targetLanguage?: string
): Promise<{
  replyText: string;
  cnTranslation?: string;
  source: string;
  isImage?: boolean;
  imageUrl?: string;
  imageCaption?: string;
  routing?: { model: string; reason: string; category: string; ratioGroup: string; photoDecision?: string };
  pipeline?: {
    requestId: string;
    customerId: string;
    messageCount: number;
    integrityVerified: boolean;
    hasHolographicProfile: boolean;
  };
}> {
  const res = await fetchWithTimeout(
    '/api/llm/chat',
    {
      method: 'POST',
      headers: getAuthHeaders(accountId),
      body: JSON.stringify({
        chatId,
        accountId: accountId || currentActiveAccountId,
        messages,
        customConfig,
        personaPrompt,
        datingMode,
        targetLanguage,
      }),
    },
    45000
  );

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.error || `Autonomous chat error: ${res.statusText}`);
  }
  return await res.json();
}

export interface ModelUsageDetail {
  id: string;
  tierTag: string;
  todayCount: number;
  rateLimitRemaining?: string;
  rateLimitLimit?: string;
}

export async function pingCustomLLM(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  customHeaders?: string,
  protocol: 'openai' | 'gemini' | 'anthropic' = 'openai',
  engineMode?: 'cloud' | 'custom',
  engineLicenseKey?: string
): Promise<{
  ok: boolean;
  latencyMs?: number;
  message?: string;
  error?: string;
  suggestedModels?: string[];
  modelDetails?: ModelUsageDetail[];
  currentModelUsage?: ModelUsageDetail;
}> {
  try {
    const res = await fetchWithTimeout(
      '/api/llm/ping',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          baseUrl,
          apiKey,
          modelName,
          customHeaders,
          protocol,
          engineMode,
          engineLicenseKey,
        }),
      },
      20000
    );

    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '网络连接异常' };
  }
}

export async function fetchCustomLlmUsageStats(
  baseUrl: string,
  apiKey: string,
  modelName: string
): Promise<ModelUsageDetail | null> {
  const cleanModel = (modelName || '').trim();
  if (!cleanModel) return null;
  try {
    const res = await fetchWithTimeout(
      '/api/llm/usage-stats',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          baseUrl: (baseUrl || '').trim(),
          apiKey: (apiKey || '').trim(),
          modelName: cleanModel,
        }),
      },
      15000
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.usage || null;
  } catch {
    return null;
  }
}

export async function fetchKnowledgeBase(
  query: string,
  customConfig?: CustomLLMConfig
): Promise<{
  ok: boolean;
  connected: boolean;
  context: string;
  matchedCount: number;
  source: string;
  error?: string;
  statusCode?: number;
}> {
  try {
    const res = await fetchWithTimeout(
      '/api/knowledge/remote-search',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          query,
          customConfig,
          apiUrl: customConfig?.knowledgeBaseApiUrl || '',
          apiKey: customConfig?.knowledgeBaseApiKey || customConfig?.apiKey || '',
          engineLicenseKey: customConfig?.engineLicenseKey || '',
        }),
      },
      20000
    );

    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok !== false) {
      return {
        ok: true,
        connected: data.connected ?? true,
        context: data.context || '',
        matchedCount: data.matchedCount || 0,
        source: data.source || 'remote_cloud_kb',
      };
    }

    return {
      ok: false,
      connected: false,
      context: '',
      matchedCount: 0,
      source: data?.source || 'remote_cloud_kb_error',
      error: data?.error || `云端知识库检索失败 (HTTP ${res.status})`,
      statusCode: data?.statusCode || res.status,
    };
  } catch (err: any) {
    console.warn('[Knowledge Base Fetch Warning]:', err);
    return {
      ok: false,
      connected: false,
      context: '',
      matchedCount: 0,
      source: 'remote_cloud_kb_failed',
      error: err?.message || '云端知识库网络连接异常',
    };
  }
}

export async function submitTrainingFeedbackApi(payload: {
  stage?: string;
  personaRole?: string;
  snippet: string;
  peerCue?: string;
  engineLicenseKey?: string;
}): Promise<{ ok: boolean; syncedToCloud?: boolean }> {
  try {
    const res = await fetchWithTimeout(
      '/api/training/feedback',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      },
      12000
    );
    if (res.ok) return await res.json();
  } catch {}
  return { ok: false };
}

// ==================== DATABASE & MEMORY SERVICES ====================

export async function fetchChatsFromDb(accountId?: string): Promise<any[]> {
  try {
    const res = await fetchWithTimeout('/api/chats', {
      headers: getAuthHeaders(accountId),
    }, 10000);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Failed to load chats from DB:', err);
  }
  return [];
}

export async function saveChatLanguagePrefApi(
  chatId: string,
  sourceLang: string,
  targetLang: string,
  accountId?: string
): Promise<boolean> {
  try {
    const effectiveAcc = accountId || currentActiveAccountId;
    const res = await fetchWithTimeout(
      `/api/chats/${encodeURIComponent(chatId)}/language`,
      {
        method: 'POST',
        headers: getAuthHeaders(effectiveAcc),
        body: JSON.stringify({
          sourceLang,
          targetLang,
          accountId: effectiveAcc,
        }),
      },
      10000
    );
    return res.ok;
  } catch (err) {
    console.warn('Failed to save chat language pref:', err);
    return false;
  }
}

export async function fetchMessagesFromDb(
  chatId: string,
  accountId?: string,
  options?: { limit?: number; beforeCreatedAt?: number }
): Promise<Message[]> {
  try {
    const query = new URLSearchParams();
    if (options?.limit && options.limit > 0) query.set('limit', String(options.limit));
    if (options?.beforeCreatedAt && options.beforeCreatedAt > 0) {
      query.set('beforeCreatedAt', String(options.beforeCreatedAt));
    }
    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetchWithTimeout(`/api/messages/${encodeURIComponent(chatId)}${qs}`, {
      headers: getAuthHeaders(accountId),
    }, 10000);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Failed to load messages from DB:', err);
  }
  return [];
}

export async function updateMessageTranslationInDb(
  messageId: string,
  translatedText: string,
  meta?: { chatId?: string; telegramMessageId?: number; accountId?: string }
): Promise<boolean> {
  try {
    const effectiveAcc = meta?.accountId || currentActiveAccountId;
    const res = await fetchWithTimeout(
      `/api/messages/${encodeURIComponent(messageId)}/translation`,
      {
        method: 'PATCH',
        headers: getAuthHeaders(effectiveAcc),
        body: JSON.stringify({
          translatedText,
          chatId: meta?.chatId,
          telegramMessageId: meta?.telegramMessageId,
          accountId: effectiveAcc,
        }),
      },
      10000
    );
    return res.ok;
  } catch (err) {
    console.warn('Failed to update message translation in DB:', err);
    return false;
  }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) return null;
    const header = dataUrl.slice(0, commaIdx);
    const base64 = dataUrl.slice(commaIdx + 1);
    const mimeMatch = header.match(/^data:([^;]+);base64/i);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const binStr = atob(base64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

function stripTransientMediaUrl(url?: string): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  if (url.startsWith('blob:')) return undefined;
  if (url.startsWith('data:') && url.length > 64 * 1024) return undefined;
  return url;
}

function buildCompactOutboundJsonPayload(
  message: Partial<Message>,
  effectiveAccountId?: string
): Record<string, any> {
  const clean: Record<string, any> = {
    id: message.id,
    chatId: message.chatId,
    accountId: message.accountId || effectiveAccountId || currentActiveAccountId,
    sender: message.sender || 'me',
    text: message.text ?? '',
    timestamp: message.timestamp,
    createdAt: message.createdAt,
  };
  if (message.senderName) clean.senderName = message.senderName;
  if (message.translatedText) clean.translatedText = message.translatedText;
  if (message.replyTo) clean.replyTo = message.replyTo;
  if (message.telegramMessageId !== undefined) clean.telegramMessageId = message.telegramMessageId;

  if (message.isAudio) {
    clean.isAudio = true;
    clean.audioDuration = message.audioDuration;
    const safeAudio = stripTransientMediaUrl(message.audioUrl);
    if (safeAudio) clean.audioUrl = safeAudio;
    if (message.sttText) clean.sttText = message.sttText;
    if (message.voiceName) clean.voiceName = message.voiceName;
    if (message.voiceTone) clean.voiceTone = message.voiceTone;
    if (message.isMasterVoice !== undefined) clean.isMasterVoice = message.isMasterVoice;
  }
  if (message.isImage) {
    clean.isImage = true;
    const safeImg = stripTransientMediaUrl(message.imageUrl);
    if (safeImg) clean.imageUrl = safeImg;
    if (message.imageCaption) clean.imageCaption = message.imageCaption;
  }
  if (message.isVideo) {
    clean.isVideo = true;
    clean.videoDuration = message.videoDuration;
    const safeVid = stripTransientMediaUrl(message.videoUrl);
    if (safeVid) clean.videoUrl = safeVid;
  }
  if (message.isFile) {
    clean.isFile = true;
    if (message.fileName) clean.fileName = message.fileName;
    if (message.fileSize) clean.fileSize = message.fileSize;
    const safeFile = stripTransientMediaUrl(message.fileUrl);
    if (safeFile) clean.fileUrl = safeFile;
  }
  return clean;
}

function resolveUploadBlobForMessage(
  message?: Partial<Message>,
  explicitMediaFile?: File | Blob
): { file?: File | Blob; fileName: string } {
  if (explicitMediaFile) {
    const named = (explicitMediaFile as File).name;
    const fallbackName =
      named ||
      message?.fileName ||
      (message?.isVideo
        ? 'video.mp4'
        : message?.isImage
        ? 'photo.jpg'
        : message?.isAudio
        ? 'voice.webm'
        : 'file.bin');
    return { file: explicitMediaFile, fileName: fallbackName };
  }
  if (!message) return { fileName: 'file.bin' };
  const candidateUrl =
    (message.isVideo ? message.videoUrl : undefined) ||
    (message.isImage ? message.imageUrl : undefined) ||
    (message.isAudio ? message.audioUrl : undefined) ||
    (message.isFile ? message.fileUrl : undefined) ||
    '';
  if (candidateUrl.startsWith('data:') && candidateUrl.length > 64 * 1024) {
    const blob = dataUrlToBlob(candidateUrl);
    if (blob) {
      const fallbackName =
        message.fileName ||
        (message.isVideo
          ? 'video.mp4'
          : message.isImage
          ? 'photo.jpg'
          : message.isAudio
          ? 'voice.webm'
          : 'file.bin');
      return { file: blob, fileName: fallbackName };
    }
  }
  return { fileName: message.fileName || 'file.bin' };
}

export interface OutboundDeliveryResponse {
  ok: boolean;
  deliveryStatus: 'delivered' | 'failed';
  telegramMessageId?: number;
  mediaUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
  error?: string;
  code?: string;
}

export async function saveMessageToDb(
  message: Partial<Message>,
  options?: { mediaFile?: File | Blob }
): Promise<OutboundDeliveryResponse> {
  try {
    const effectiveAcc = message.accountId || currentActiveAccountId;
    const { file: uploadBlob, fileName } = resolveUploadBlobForMessage(message, options?.mediaFile);

    if (uploadBlob && uploadBlob.size > TELEGRAM_MAX_MEDIA) {
      const maxMb = Math.round(TELEGRAM_MAX_MEDIA / (1024 * 1024));
      return {
        ok: false,
        deliveryStatus: 'failed',
        error: `媒体文件超过最大发送限制 (${maxMb} MB)`,
      };
    }

    const compactPayload = buildCompactOutboundJsonPayload(message, effectiveAcc);
    let fetchInit: RequestInit;
    let timeoutMs = 25000;

    if (uploadBlob) {
      const formData = new FormData();
      formData.append('payload', JSON.stringify(compactPayload));
      formData.append('file', uploadBlob, fileName);
      fetchInit = {
        method: 'POST',
        headers: getAuthHeaders(effectiveAcc, { omitContentType: true }),
        body: formData,
      };
      timeoutMs = Math.max(30000, Math.min(600000, 30000 + Math.ceil(uploadBlob.size / (512 * 1024)) * 1000));
    } else {
      fetchInit = {
        method: 'POST',
        headers: getAuthHeaders(effectiveAcc),
        body: JSON.stringify(compactPayload),
      };
    }

    const res = await fetchWithTimeout('/api/messages', fetchInit, timeoutMs);
    const data = await res.json().catch(() => ({}));
    const returnedMedia = {
      mediaUrl: typeof data?.mediaUrl === 'string' ? data.mediaUrl : undefined,
      imageUrl: typeof data?.imageUrl === 'string' ? data.imageUrl : undefined,
      videoUrl: typeof data?.videoUrl === 'string' ? data.videoUrl : undefined,
      audioUrl: typeof data?.audioUrl === 'string' ? data.audioUrl : undefined,
      fileUrl: typeof data?.fileUrl === 'string' ? data.fileUrl : undefined,
    };
    if (!res.ok || data?.delivered === false || data?.deliveryStatus === 'failed') {
      return {
        ok: false,
        deliveryStatus: 'failed',
        ...returnedMedia,
        code: data?.code,
        error: data?.error || `投递失败 (${res.status})`,
      };
    }
    return {
      ok: true,
      deliveryStatus: 'delivered',
      telegramMessageId: typeof data?.telegramMessageId === 'number' ? data.telegramMessageId : undefined,
      ...returnedMedia,
    };
  } catch (err: any) {
    console.warn('Failed to save message to DB:', err);
    return {
      ok: false,
      deliveryStatus: 'failed',
      error: err?.message || '网络连接异常',
    };
  }
}

export async function retryMessageDelivery(
  messageId: string,
  accountId?: string,
  messagePayload?: Partial<Message>,
  options?: { mediaFile?: File | Blob }
): Promise<OutboundDeliveryResponse> {
  try {
    const effectiveAcc = messagePayload?.accountId || accountId || currentActiveAccountId;
    const { file: uploadBlob, fileName } = resolveUploadBlobForMessage(messagePayload, options?.mediaFile);

    if (uploadBlob && uploadBlob.size > TELEGRAM_MAX_MEDIA) {
      const maxMb = Math.round(TELEGRAM_MAX_MEDIA / (1024 * 1024));
      return {
        ok: false,
        deliveryStatus: 'failed',
        error: `媒体文件超过最大发送限制 (${maxMb} MB)`,
      };
    }

    let fetchInit: RequestInit;
    let timeoutMs = 25000;

    if (uploadBlob && messagePayload) {
      const formData = new FormData();
      formData.append('payload', JSON.stringify(buildCompactOutboundJsonPayload(messagePayload, effectiveAcc)));
      formData.append('file', uploadBlob, fileName);
      fetchInit = {
        method: 'POST',
        headers: getAuthHeaders(effectiveAcc, { omitContentType: true }),
        body: formData,
      };
      timeoutMs = Math.max(30000, Math.min(600000, 30000 + Math.ceil(uploadBlob.size / (512 * 1024)) * 1000));
    } else {
      fetchInit = {
        method: 'POST',
        headers: getAuthHeaders(effectiveAcc),
        body: JSON.stringify(
          messagePayload ? buildCompactOutboundJsonPayload(messagePayload, effectiveAcc) : {}
        ),
      };
    }

    const res = await fetchWithTimeout(
      `/api/messages/${encodeURIComponent(messageId)}/retry`,
      fetchInit,
      timeoutMs
    );
    const data = await res.json().catch(() => ({}));
    const returnedMedia = {
      mediaUrl: typeof data?.mediaUrl === 'string' ? data.mediaUrl : undefined,
      imageUrl: typeof data?.imageUrl === 'string' ? data.imageUrl : undefined,
      videoUrl: typeof data?.videoUrl === 'string' ? data.videoUrl : undefined,
      audioUrl: typeof data?.audioUrl === 'string' ? data.audioUrl : undefined,
      fileUrl: typeof data?.fileUrl === 'string' ? data.fileUrl : undefined,
    };
    if (!res.ok || data?.success === false || data?.delivered === false || data?.deliveryStatus === 'failed') {
      return {
        ok: false,
        deliveryStatus: 'failed',
        ...returnedMedia,
        code: data?.code,
        error: data?.error || `重发失败 (${res.status})`,
      };
    }
    return {
      ok: true,
      deliveryStatus: 'delivered',
      telegramMessageId: typeof data?.telegramMessageId === 'number' ? data.telegramMessageId : undefined,
      ...returnedMedia,
    };
  } catch (err: any) {
    console.error('Failed to retry message delivery:', err);
    return {
      ok: false,
      deliveryStatus: 'failed',
      error: err?.message || '网络连接异常',
    };
  }
}

export async function fetchCustomerProfile(chatId: string, accountId?: string): Promise<CustomerProfile | null> {
  try {
    const res = await fetchWithTimeout(
      `/api/customer/profile/${chatId}`,
      {
        headers: getAuthHeaders(accountId),
      },
      10000
    );
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Failed to load customer profile from DB:', err);
  }
  return null;
}

export async function saveCustomerProfile(chatId: string, profile: Partial<CustomerProfile>, accountId?: string): Promise<boolean> {
  const effectiveAccountId = accountId || profile.accountId || currentActiveAccountId;
  try {
    try {
      const existing = getLocalCustomerProfile(chatId, effectiveAccountId) || ({} as any);
      const cleanProfile = Object.fromEntries(Object.entries(profile).filter(([_, v]) => v !== undefined));
      saveLocalCustomerProfile(chatId, { ...existing, ...cleanProfile, chatId, accountId: effectiveAccountId } as CustomerProfile, effectiveAccountId);
    } catch {}
    const res = await fetchWithTimeout(
      `/api/customer/profile/${chatId}`,
      {
        method: 'POST',
        headers: getAuthHeaders(effectiveAccountId),
        body: JSON.stringify({
          ...profile,
          accountId: effectiveAccountId,
        }),
      },
      10000
    );
    return res.ok;
  } catch (err) {
    console.error('Failed to save customer profile:', err);
    return false;
  }
}

export async function analyzeCustomerMemory(
  chatId: string,
  customConfig?: CustomLLMConfig,
  accountId?: string,
  messages?: any[],
  chatTitle?: string
): Promise<CustomerProfile | null> {
  try {
    const res = await fetchWithTimeout(
      `/api/customer/analyze/${chatId}`,
      {
        method: 'POST',
        headers: getAuthHeaders(accountId),
        body: JSON.stringify({
          customConfig,
          accountId: accountId || currentActiveAccountId,
          messages: Array.isArray(messages) ? messages.slice(-50) : undefined,
          chatTitle,
        }),
      },
      35000
    );
    if (res.ok) {
      const data = await res.json();
      return data.profile;
    }
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || 'AI 画像记忆提炼失败');
  } catch (err: any) {
    console.error('Failed to run AI memory analysis:', err);
    throw err;
  }
}

export async function fetchDatabaseStatus(): Promise<any> {
  try {
    const res = await fetchWithTimeout(
      '/api/database/status',
      {
        headers: getAuthHeaders(),
      },
      10000
    );
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Failed to fetch DB status:', err);
  }
  return null;
}

// ==================== TELEGRAM PERSONAL CLIENT DIALOGS & ACCOUNTS ====================

export async function fetchTelegramUserDialogsDetailedApi(
  accountId?: string,
  phone?: string
): Promise<{ ok: boolean; dialogs: any[]; code?: string; error?: string; isConnected?: boolean }> {
  try {
    const query = new URLSearchParams();
    if (accountId) query.set('accountId', accountId);
    if (phone) query.set('phone', phone);
    const res = await fetchWithTimeout(
      `/api/telegram/user/dialogs?${query.toString()}`,
      { headers: getAuthHeaders(accountId) },
      15000
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      return {
        ok: Boolean(data?.ok),
        dialogs: Array.isArray(data?.dialogs) ? data.dialogs : [],
        isConnected: typeof data?.isConnected === 'boolean' ? data.isConnected : undefined,
        code: data?.code,
        error: data?.error || data?.message,
      };
    }
    return {
      ok: false,
      dialogs: [],
      code: data?.code,
      error: data?.error || data?.message || `HTTP ${res.status}`,
    };
  } catch (err: any) {
    console.warn('Failed to fetch Telegram dialogs:', err);
    return { ok: false, dialogs: [], error: err?.message };
  }
}

export async function fetchTelegramUserDialogsApi(accountId?: string, phone?: string): Promise<any[]> {
  const res = await fetchTelegramUserDialogsDetailedApi(accountId, phone);
  return res.dialogs;
}

export async function fetchTelegramActiveAccounts(): Promise<any[]> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/active-accounts', {
      headers: getAuthHeaders(),
    }, 10000);
    if (res.ok) {
      const data = await res.json();
      return data.accounts || [];
    }
  } catch (err) {
    console.warn('Failed to fetch active Telegram accounts:', err);
  }
  return [];
}

export async function fetchTelegramUserStatusApi(): Promise<{
  ok: boolean;
  activeUsers: Array<{
    id: string;
    userId: string;
    phone: string;
    username?: string;
    firstName?: string;
    isInMemoryConnected?: boolean;
    isConnected?: boolean;
    status?: 'online' | 'away' | 'offline' | 'expired';
    offlineReason?: string;
  }>;
  expiredAccounts: Array<{
    accountId: string;
    userId?: string;
    phone?: string;
    reason: string;
    expiredAt: number;
  }>;
  credentialsConfigured?: boolean;
  credentialsError?: string | null;
  isRestoringSessions?: boolean;
  restoreError?: string | null;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/status', {
      headers: getAuthHeaders(),
    }, 10000);
    if (res.ok) {
      const data = await res.json();
      return {
        ok: Boolean(data?.ok),
        activeUsers: Array.isArray(data?.activeUsers) ? data.activeUsers : [],
        expiredAccounts: Array.isArray(data?.expiredAccounts) ? data.expiredAccounts : [],
        credentialsConfigured: typeof data?.credentialsConfigured === 'boolean' ? data.credentialsConfigured : undefined,
        credentialsError: data?.credentialsError ?? null,
        isRestoringSessions: Boolean(data?.isRestoringSessions),
        restoreError: data?.restoreError ?? null,
      };
    }
  } catch (err) {
    console.warn('Failed to fetch Telegram user status:', err);
  }
  return { ok: false, activeUsers: [], expiredAccounts: [] };
}

export async function reconnectTelegramSessionsApi(
  forceCredsRefresh = false,
  forceReconnect = false
): Promise<{
  ok: boolean;
  restoredCount?: number;
  hasActiveSession?: boolean;
  message?: string;
  error?: string;
  code?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/reconnect', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ forceCredsRefresh, forceReconnect }),
    }, 25000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        code: data?.code,
        error: data?.error || `重连失败 (HTTP ${res.status})`,
      };
    }
    return data;
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常，无法重连 Telegram' };
  }
}

export async function fetchTelegramCredsStatusApi(refresh = false): Promise<{
  ok: boolean;
  configured: boolean;
  source?: string;
  cloudSyncError?: string;
}> {
  try {
    const res = await fetchWithTimeout(`/api/telegram/credentials/status${refresh ? '?refresh=1' : ''}`, {
      headers: getAuthHeaders(),
    }, 14000);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) {
      return {
        ok: true,
        configured: Boolean(data.configured),
        source: data.source,
        cloudSyncError: data.cloudSyncError,
      };
    }
    return {
      ok: false,
      configured: false,
      cloudSyncError: data?.error || data?.cloudSyncError || `检测接入凭据失败 (HTTP ${res.status})`,
    };
  } catch (err: any) {
    return { ok: false, configured: false, cloudSyncError: err?.message || '检测接入凭据超时' };
  }
}

export async function syncCloudTelegramCredsApi(): Promise<{
  ok: boolean;
  configured?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/credentials/sync-cloud', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({}),
    }, 15000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || `同步云端凭据失败 (HTTP ${res.status})` };
    }
    return data;
  } catch (err: any) {
    return { ok: false, error: err?.message || '连接授权中心超时，同步失败' };
  }
}

export async function getSystemProxyApi(): Promise<{
  ok: boolean;
  config?: SystemProxyConfig;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/system/proxy', {
      headers: getAuthHeaders(),
    }, 8000);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok && data.config) {
      return { ok: true, config: data.config };
    }
    return { ok: false, error: data?.error || `读取代理配置失败 (HTTP ${res.status})` };
  } catch (err: any) {
    return { ok: false, error: err?.message || '读取代理配置失败' };
  }
}

export async function saveSystemProxyApi(payload: SystemProxyConfig & { preservePassword?: boolean }): Promise<{
  ok: boolean;
  config?: SystemProxyConfig;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/system/proxy', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    }, 10000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || `保存代理设置失败 (HTTP ${res.status})` };
    }
    return data;
  } catch (err: any) {
    return { ok: false, error: err?.message || '保存代理设置失败' };
  }
}

export async function downloadDatabaseBackup(): Promise<any> {
  try {
    const res = await fetchWithTimeout(
      '/api/database/backup',
      {
        headers: getAuthHeaders(),
        credentials: 'include',
      },
      30000
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `备份导出失败 (HTTP ${res.status})`);
    }
    return await res.json();
  } catch (err: any) {
    console.error('downloadDatabaseBackup error:', err);
    throw err;
  }
}

export async function uploadDatabaseRestore(snapshot: any): Promise<{ success: boolean; message: string; restoredCounts?: any }> {
  try {
    const res = await fetchWithTimeout(
      '/api/database/restore?confirm=true',
      {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ snapshot, confirm: true }),
      },
      30000
    );
    const data = await res.json();
    if (!res.ok) {
      return { success: false, message: data.error || '恢复失败' };
    }
    return data;
  } catch (err: any) {
    console.error('uploadDatabaseRestore error:', err);
    return { success: false, message: err.message };
  }
}

import {
  secureGetItemSync,
  secureSetItemSync,
  secureRemoveItem,
  secureGetItemAsync,
  decryptDataAsync,
  purgeCryptoSeed
} from './cryptoStorage';

// ==================== ZERO-DB ENCRYPTED LOCAL STORAGE REPOSITORY ====================
// In accordance with user security specification: Chat messages, transcripts, accounts, and customer notes
// exist locally encrypted with Web Crypto API (AES-256-GCM) to prevent plain-text inspection in DevTools,
// capped at MAX_LOCAL_MESSAGES_PER_CHAT per chat so Chromium localStorage never hits 5MB limits.

export const MAX_LOCAL_MESSAGES_PER_CHAT = 100;

export function getDeletedMessageStorageKey(accountId?: string): string {
  const acc = (accountId ?? currentActiveAccountId ?? '').trim();
  return acc ? `tg_deleted_message_ids_${acc}` : 'tg_deleted_message_ids';
}

function isLegacyAmbiguousTelegramMessageId(messageId: string): boolean {
  return /^msg_tg_\d+(?:_\d+)?$/.test(String(messageId || '').trim());
}

function buildDeletedIdEntryKey(messageId: string, chatId?: string): string {
  const cleanId = String(messageId || '').trim();
  const cleanChat = String(chatId || '').trim();
  if (cleanChat && isLegacyAmbiguousTelegramMessageId(cleanId)) {
    const canonicalChat = cleanChat.startsWith('tg_') || cleanChat.startsWith('chat_') ? cleanChat : `tg_${cleanChat}`;
    return `${canonicalChat}::${cleanId}`;
  }
  return cleanId;
}

export function isMessageDeleted(messageId: string, accountId?: string, chatId?: string): boolean {
  try {
    const scopedKey = getDeletedMessageStorageKey(accountId);
    const raw = localStorage.getItem(scopedKey);
    if (!raw) return false;
    const list: string[] = JSON.parse(raw);
    if (!Array.isArray(list)) return false;
    const cleanId = String(messageId || '').trim();
    if (chatId && isLegacyAmbiguousTelegramMessageId(cleanId)) {
      return list.includes(buildDeletedIdEntryKey(cleanId, chatId));
    }
    return list.includes(cleanId);
  } catch {
    return false;
  }
}

const MAX_DELETED_MESSAGE_IDS = 5000;

export function recordDeletedMessageIds(messageIds: string[], accountId?: string, chatId?: string): void {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return;
  try {
    const scopedKey = getDeletedMessageStorageKey(accountId);
    const raw = localStorage.getItem(scopedKey);
    const set = new Set<string>(raw ? JSON.parse(raw) : []);
    for (const id of messageIds) {
      if (id) set.add(buildDeletedIdEntryKey(id, chatId));
    }
    const arr = Array.from(set);
    const trimmed = arr.length > MAX_DELETED_MESSAGE_IDS ? arr.slice(-MAX_DELETED_MESSAGE_IDS) : arr;
    localStorage.setItem(scopedKey, JSON.stringify(trimmed));
  } catch {}
}

export function recordDeletedMessageId(messageId: string, accountId?: string, chatId?: string): void {
  if (!messageId) return;
  recordDeletedMessageIds([messageId], accountId, chatId);
}

const APP_BOOT_TIMESTAMP = Date.now();

export function resolveClientTelegramMessageId(msg?: Partial<Message> | null): number | undefined {
  if (!msg) return undefined;
  if (typeof msg.telegramMessageId === 'number' && Number.isInteger(msg.telegramMessageId) && msg.telegramMessageId > 0) {
    return msg.telegramMessageId;
  }
  const rawId = String(msg.id || '').trim();
  const cloudMatch = rawId.match(/^tg_cloud_(\d+)(?:_|$)/);
  if (cloudMatch) return Number(cloudMatch[1]);
  const msgTgMatch = rawId.match(/^msg_tg_(?:.+_)?(\d+)$/);
  if (msgTgMatch) return Number(msgTgMatch[1]);
  const tgNumericMatch = rawId.match(/^tg_(\d+)_\d+$/);
  if (tgNumericMatch) return Number(tgNumericMatch[1]);
  return undefined;
}

export function normalizeStalePendingMessages(list: Message[]): Message[] {
  if (!Array.isArray(list)) return [];
  const now = Date.now();
  return list.map((m) => {
    if (
      (m.deliveryStatus === 'pending' || m.deliveryStatus === 'retrying') &&
      (!m.createdAt || m.createdAt < APP_BOOT_TIMESTAMP || now - m.createdAt > 120000)
    ) {
      return { ...m, deliveryStatus: 'failed' as const };
    }
    return m;
  });
}

export function sanitizeMessageForLocalStorage(msg: Message): Message {
  const cleanUrl = (u?: string) => {
    if (!u || typeof u !== 'string') return u;
    if (u.startsWith('blob:')) return '';
    if (u.startsWith('data:') && u.length > 64 * 1024) return '';
    return u;
  };
  return {
    ...msg,
    ...(msg.audioUrl !== undefined ? { audioUrl: cleanUrl(msg.audioUrl) } : {}),
    ...(msg.imageUrl !== undefined ? { imageUrl: cleanUrl(msg.imageUrl) } : {}),
    ...(msg.videoUrl !== undefined ? { videoUrl: cleanUrl(msg.videoUrl) } : {}),
    ...(msg.fileUrl !== undefined ? { fileUrl: cleanUrl(msg.fileUrl) } : {}),
  };
}

function capMessagesForLocalCache(list: Message[]): Message[] {
  if (!Array.isArray(list)) return [];
  const sliced = list.length <= MAX_LOCAL_MESSAGES_PER_CHAT ? list : list.slice(-MAX_LOCAL_MESSAGES_PER_CHAT);
  return sliced.map(sanitizeMessageForLocalStorage);
}

export function getLocalMessages(chatId: string, accountId?: string): Message[] {
  try {
    const acc = accountId || currentActiveAccountId;
    const scopedKey = acc ? `tg_desktop_msgs_${acc}_${chatId}` : null;
    let list = scopedKey ? secureGetItemSync<Message[]>(scopedKey) : null;
    if (!list || !Array.isArray(list) || list.length === 0) {
      // Safe fallback to legacy unscoped key: filter strictly by accountId to avoid cross-account leakage
      const legacyList = secureGetItemSync<Message[]>(`tg_desktop_msgs_${chatId}`);
      if (Array.isArray(legacyList)) {
        list = acc ? legacyList.filter((m) => m.accountId === acc) : legacyList;
      }
    }
    if (Array.isArray(list)) {
      return normalizeStalePendingMessages(
        list.filter(
          (m) =>
            !isMessageDeleted(m.id, acc, m.chatId || chatId) &&
            (!acc || m.accountId === acc || (!m.accountId && !acc))
        )
      );
    }
    return [];
  } catch {
    return [];
  }
}

export function deleteLocalMessage(chatId: string, messageId: string, accountId?: string): void {
  try {
    const acc = accountId || currentActiveAccountId;
    recordDeletedMessageId(messageId, acc, chatId);
    const scopedKey = acc ? `tg_desktop_msgs_${acc}_${chatId}` : `tg_desktop_msgs_${chatId}`;
    const existing = getLocalMessages(chatId, acc);
    const updated = existing.filter((m) => m.id !== messageId);
    secureSetItemSync(scopedKey, capMessagesForLocalCache(updated));
  } catch (e) {
    console.error('Failed to delete encrypted message from local storage', e);
  }
}

export function setLocalMessages(chatId: string, messages: Message[], accountId?: string): void {
  try {
    const acc = accountId || currentActiveAccountId;
    const scopedKey = acc ? `tg_desktop_msgs_${acc}_${chatId}` : `tg_desktop_msgs_${chatId}`;
    const filtered = Array.isArray(messages)
      ? messages.filter((m) => !isMessageDeleted(m.id, acc, m.chatId || chatId))
      : [];
    secureSetItemSync(scopedKey, capMessagesForLocalCache(filtered));
  } catch (e) {
    console.error('Failed to persist encrypted messages to local storage', e);
  }
}

export function clearLocalMessages(chatId: string, existingMessages: Message[] = [], accountId?: string): void {
  try {
    const acc = accountId || currentActiveAccountId;
    const currentStored = getLocalMessages(chatId, acc);
    const allToRecord = [...existingMessages, ...currentStored];
    if (allToRecord.length > 0) {
      recordDeletedMessageIds(
        allToRecord.map((m) => m?.id).filter((id): id is string => Boolean(id)),
        acc,
        chatId
      );
    }
    if (acc) {
      localStorage.removeItem(`tg_desktop_msgs_${acc}_${chatId}`);
    }
    localStorage.removeItem(`tg_desktop_msgs_${chatId}`);
    localStorage.removeItem(`tg_local_msgs_${chatId}`);
  } catch (e) {
    console.error('Failed to clear encrypted messages from local storage', e);
  }
}

export async function deleteMessageFromDb(
  messageId: string,
  accountId?: string,
  chatId?: string,
  telegramMessageId?: number,
  options?: { revoke?: boolean; localOnly?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const query = new URLSearchParams();
    if (chatId) query.set('chatId', chatId);
    if (accountId) query.set('accountId', accountId);
    if (telegramMessageId !== undefined && telegramMessageId !== null) {
      query.set('telegramMessageId', String(telegramMessageId));
    }
    if (typeof options?.revoke === 'boolean') {
      query.set('revoke', options.revoke ? 'true' : 'false');
    }
    if (options?.localOnly) {
      query.set('localOnly', 'true');
    }
    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetchWithTimeout(
      `/api/messages/${encodeURIComponent(messageId)}${qs}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(accountId),
      },
      15000
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.deleted === false || data?.success === false) {
      return { ok: false, error: data?.error || `删除撤回消息失败 (HTTP ${res.status})` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常，无法同步撤回消息' };
  }
}

export function saveLocalMessage(chatId: string, message: Message, accountId?: string): void {
  const acc = accountId || message.accountId || currentActiveAccountId;
  if (isMessageDeleted(message.id, acc, message.chatId || chatId)) return;
  try {
    const scopedKey = acc ? `tg_desktop_msgs_${acc}_${chatId}` : `tg_desktop_msgs_${chatId}`;
    const existing = getLocalMessages(chatId, acc);
    const incomingTgId = resolveClientTelegramMessageId(message);
    const existingIdx = existing.findIndex((m) => {
      if (m.id === message.id) return true;
      const existingTgId = resolveClientTelegramMessageId(m);
      if (existingTgId !== undefined && incomingTgId !== undefined) {
        return existingTgId === incomingTgId;
      }
      // Only text-match when at least one side is an unsynced optimistic local record
      if (
        m.sender === message.sender &&
        m.text &&
        message.text &&
        m.text.trim() === message.text.trim()
      ) {
        const sameMinute = m.timestamp === message.timestamp;
        const closeInTime =
          typeof m.createdAt === 'number' &&
          typeof message.createdAt === 'number' &&
          Math.abs(m.createdAt - message.createdAt) < 120000;
        if (sameMinute || closeInTime) return true;
      }
      return false;
    });

    if (existingIdx === -1) {
      existing.push(message);
      secureSetItemSync(scopedKey, capMessagesForLocalCache(existing));
    } else {
      let changed = false;
      if (
        message.translatedText !== undefined &&
        message.translatedText !== existing[existingIdx].translatedText
      ) {
        existing[existingIdx].translatedText = message.translatedText;
        changed = true;
      }
      if ('translationError' in message && message.translationError !== existing[existingIdx].translationError) {
        existing[existingIdx].translationError = message.translationError;
        changed = true;
      }
      if (incomingTgId !== undefined && !existing[existingIdx].telegramMessageId) {
        existing[existingIdx].telegramMessageId = incomingTgId;
        changed = true;
      }
      if (changed) {
        secureSetItemSync(scopedKey, capMessagesForLocalCache(existing));
      }
    }
  } catch (e) {
    console.error('Failed to save encrypted message to local storage', e);
  }
}

export function getLocalCustomerProfile(chatId: string, accountId?: string): CustomerProfile | null {
  try {
    const acc = accountId || currentActiveAccountId;
    const scopedKey = acc ? `tg_desktop_profile_${acc}_${chatId}` : null;
    let prof = scopedKey ? secureGetItemSync<CustomerProfile>(scopedKey) : null;
    if (!prof) {
      const legacy = secureGetItemSync<CustomerProfile>(`tg_desktop_profile_${chatId}`);
      if (legacy && (!acc || legacy.accountId === acc)) {
        prof = legacy;
      }
    }
    return prof;
  } catch {
    return null;
  }
}

export function saveLocalCustomerProfile(chatId: string, profile: CustomerProfile, accountId?: string): void {
  try {
    const acc = accountId || profile.accountId || currentActiveAccountId;
    const scopedKey = acc ? `tg_desktop_profile_${acc}_${chatId}` : `tg_desktop_profile_${chatId}`;
    secureSetItemSync(scopedKey, profile);
  } catch (e) {
    console.error('Failed to save encrypted profile to local storage', e);
  }
}

export function getLocalStorageMetrics(): { totalMessages: number; totalChats: number; approxBytes: number } {
  let totalMessages = 0;
  let totalChats = 0;
  let approxBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      const val = localStorage.getItem(key) || '';
      approxBytes += (key.length + val.length) * 2;
      if (key.startsWith('tg_desktop_msgs_')) {
        totalChats++;
        try {
          const list = secureGetItemSync<Message[]>(key);
          if (Array.isArray(list)) totalMessages += list.length;
        } catch {}
      }
    }
  } catch {}
  return { totalMessages, totalChats, approxBytes };
}

export function clearAccountLocalCache(accountId: string, unsharedChatIds: string[] = []): void {
  if (!accountId) return;
  try {
    const msgsPrefix = `tg_desktop_msgs_${accountId}_`;
    const profilePrefix = `tg_desktop_profile_${accountId}_`;
    const keysToRemove: string[] = [`tg_deleted_message_ids_${accountId}`];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (key.startsWith(msgsPrefix) || key.startsWith(profilePrefix)) {
        keysToRemove.push(key);
      }
    }

    for (const chatId of unsharedChatIds) {
      keysToRemove.push(
        `${msgsPrefix}${chatId}`,
        `${profilePrefix}${chatId}`,
        `tg_desktop_msgs_${chatId}`,
        `tg_desktop_profile_${chatId}`,
        `tg_local_msgs_${chatId}`
      );
    }

    new Set(keysToRemove).forEach((k) => secureRemoveItem(k));

    if (localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY) === accountId) {
      localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY);
    }
  } catch (e) {
    console.error('Failed to clear account local encrypted cache', e);
  }
}

export function purgeAllLocalChatData(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (
        key.startsWith('tg_desktop_msgs_') ||
        key.startsWith('tg_desktop_profile_') ||
        key.startsWith('tg_local_msgs_') ||
        key.startsWith('tg_pro_') ||
        key.startsWith('tg_deleted_message_ids') ||
        key === 'tg_master_voiceprint'
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => secureRemoveItem(k));
    purgeCryptoSeed();
  } catch (e) {
    console.error('Failed to purge local encrypted data', e);
  }
}

// ==================== TELEGRAM CLOUD SYNC & AUTOPILOT HELPERS ====================

export async function fetchTelegramCloudMessagesApi(
  chatId: string,
  accountId?: string,
  options?: { limit?: number; offsetId?: number; search?: string }
): Promise<{
  ok: boolean;
  messages: Message[];
  hasMore: boolean;
  readOutboxMaxId?: number;
  fromLocalFallback?: boolean;
  error?: string;
  code?: string;
}> {
  try {
    const query = new URLSearchParams();
    query.set('limit', String(options?.limit || 40));
    if (options?.offsetId && options.offsetId > 0) {
      query.set('offsetId', String(options.offsetId));
    }
    if (options?.search && options.search.trim()) {
      query.set('search', options.search.trim());
    }
    const res = await fetchWithTimeout(
      `/api/telegram/user/messages/${encodeURIComponent(chatId)}?${query.toString()}`,
      {
        headers: getAuthHeaders(accountId),
      },
      20000
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok && Array.isArray(data.messages)) {
      return {
        ok: true,
        messages: data.messages,
        hasMore: Boolean(data.hasMore),
        fromLocalFallback: Boolean(data.fromLocalFallback),
        readOutboxMaxId: typeof data.readOutboxMaxId === 'number' ? data.readOutboxMaxId : undefined,
      };
    }
    return {
      ok: false,
      messages: [],
      hasMore: false,
      fromLocalFallback: Boolean(data?.fromLocalFallback),
      code: data?.code,
      error: data?.error || data?.message || `拉取云端消息失败 (HTTP ${res.status})`,
    };
  } catch (err: any) {
    console.warn('[Sync Cloud Messages Error]:', err);
    return { ok: false, messages: [], hasMore: false, error: err?.message || '网络连接异常' };
  }
}

export async function syncTelegramCloudMessages(chatId: string, accountId?: string): Promise<Message[]> {
  const res = await fetchTelegramCloudMessagesApi(chatId, accountId, { limit: 40 });
  return res.messages;
}

export async function disconnectTelegramAccount(
  accountId?: string,
  phone?: string,
  forceLocalOnly = false
): Promise<{
  ok: boolean;
  cloudLoggedOut?: boolean;
  canForceLocal?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout(
      '/api/telegram/user/disconnect',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(accountId),
        },
        body: JSON.stringify({ accountId, phone, forceLocalOnly }),
      },
      12000
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      return {
        ok: false,
        cloudLoggedOut: Boolean(data?.cloudLoggedOut),
        canForceLocal: Boolean(data?.canForceLocal),
        error: data?.error || data?.message || `云端注销失败 (HTTP ${res.status})`,
        message: data?.message,
      };
    }
    return {
      ok: true,
      cloudLoggedOut: Boolean(data?.cloudLoggedOut),
      message: data?.message,
    };
  } catch (err: any) {
    return {
      ok: false,
      canForceLocal: true,
      error: err?.message || '网络连接异常，无法连接到 Telegram 云端完成注销',
      message: err?.message || '网络连接异常',
    };
  }
}

export interface TelegramOfficialSession {
  hash: string;
  current: boolean;
  officialApp: boolean;
  deviceModel: string;
  platform: string;
  systemVersion: string;
  appName: string;
  appVersion: string;
  dateCreated: number;
  dateActive: number;
  ip: string;
  country: string;
  region: string;
}

export interface TelegramOfficialDialogFilter {
  id: number;
  title: string;
  emoticon?: string;
  color?: number;
  contacts: boolean;
  nonContacts: boolean;
  groups: boolean;
  broadcasts: boolean;
  bots: boolean;
  excludeMuted: boolean;
  excludeRead: boolean;
  excludeArchived: boolean;
  pinnedCount: number;
  includeCount: number;
  excludeCount: number;
  isChatlist: boolean;
}

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

export interface TelegramPrivacyRuleExceptionUser {
  id: string;
  name: string;
  username?: string;
}

export interface TelegramPrivacyRuleDetail {
  mode: 'everybody' | 'contacts' | 'nobody';
  summary: string;
  allowUsers: TelegramPrivacyRuleExceptionUser[];
  disallowUsers: TelegramPrivacyRuleExceptionUser[];
}

export interface TelegramGlobalPrivacySettings {
  archiveAndMuteNewNoncontactPeers: boolean;
  keepArchivedUnmuted: boolean;
  keepArchivedFolders: boolean;
  hideReadMarks: boolean;
  newNoncontactPeersRequirePremium: boolean;
}

export interface TelegramOfficialSettingsResponse {
  ok: boolean;
  cloudSynced?: boolean;
  error?: string;
  profile?: {
    userId: string;
    name: string;
    username: string;
    phone: string;
    bio: string;
    hasAvatar: boolean;
    avatarUrl: string;
  };
  twoFactor?: {
    hasPassword: boolean;
    hint: string;
    hasRecovery: boolean;
    emailUnconfirmedPattern: string;
    pendingResetDate: number;
  };
  privacy?: {
    lastSeen: 'everybody' | 'contacts' | 'nobody';
    lastSeenSummary: string;
    phoneNumber: 'everybody' | 'contacts' | 'nobody';
    phoneNumberSummary: string;
  };
  privacyRules?: Partial<Record<TelegramPrivacyRuleKey, TelegramPrivacyRuleDetail>>;
  globalPrivacy?: TelegramGlobalPrivacySettings;
  accountTtlDays?: number;
  sessions?: TelegramOfficialSession[];
  notifications?: {
    users: { enabled: boolean; silent: boolean; muteUntil: number; showPreviews: boolean };
    chats: { enabled: boolean; silent: boolean; muteUntil: number; showPreviews: boolean };
  };
  folders?: TelegramOfficialDialogFilter[];
}

export async function updateTelegramUserProfileApi(payload: {
  accountId?: string;
  phone?: string;
  name: string;
  username: string;
  bio: string;
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  profileUpdated?: boolean;
  message?: string;
  error?: string;
  profile?: { name: string; username: string; bio: string; phone?: string };
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/update-profile', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, cloudSynced: false, error: err.message || '网络连接异常' };
  }
}

export async function fetchTelegramUserSettingsApi(accountId?: string, phone?: string): Promise<TelegramOfficialSettingsResponse> {
  try {
    const params = new URLSearchParams();
    if (accountId) params.set('accountId', accountId);
    if (phone) params.set('phone', phone);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetchWithTimeout(`/api/telegram/user/settings${qs}`, {
      headers: getAuthHeaders(accountId),
    }, 20000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '拉取 Telegram 官方设置失败' };
  }
}

export async function uploadTelegramUserAvatarApi(payload: {
  accountId?: string;
  phone?: string;
  imageDataUrl: string;
}): Promise<{ ok: boolean; cloudSynced?: boolean; avatarUrl?: string; message?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/upload-avatar', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 25000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '上传官方头像失败' };
  }
}

export async function sendTelegramChangePhoneCodeApi(payload: {
  accountId?: string;
  phone?: string;
  newPhone: string;
}): Promise<{ ok: boolean; newPhone?: string; phoneCodeHash?: string; message?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/change-phone/send-code', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '发送换绑验证码失败' };
  }
}

export async function confirmTelegramChangePhoneApi(payload: {
  accountId?: string;
  phone?: string;
  newPhone: string;
  phoneCodeHash: string;
  code: string;
}): Promise<{ ok: boolean; cloudSynced?: boolean; phone?: string; message?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/change-phone/confirm', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '确认换绑手机号失败' };
  }
}

export async function updateTelegramTwoFactorApi(payload: {
  accountId?: string;
  phone?: string;
  action: 'enable' | 'change' | 'disable' | 'confirm_email' | 'resend_email' | 'cancel_email' | 'reset_password';
  currentPassword?: string;
  newPassword?: string;
  hint?: string;
  email?: string;
  code?: string;
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  emailConfirmationRequired?: boolean;
  resetStatus?: 'ok' | 'waiting' | 'failed_wait';
  untilDate?: number;
  retryDate?: number;
  message?: string;
  twoFactor?: TelegramOfficialSettingsResponse['twoFactor'];
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/settings/two-factor', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 20000);
    const data = await res.json();
    if (!data?.ok) {
      return { ...data, error: data?.message || data?.error || '修改两步验证设置失败' };
    }
    return data;
  } catch (err: any) {
    return { ok: false, error: err.message || '修改两步验证设置失败' };
  }
}

export async function updateTelegramPrivacyApi(payload: {
  accountId?: string;
  phone?: string;
  key: TelegramPrivacyRuleKey;
  mode: 'everybody' | 'contacts' | 'nobody';
  allowUserRefs?: string[];
  disallowUserRefs?: string[];
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  key?: TelegramPrivacyRuleKey;
  mode?: 'everybody' | 'contacts' | 'nobody';
  summary?: string;
  allowUsers?: TelegramPrivacyRuleExceptionUser[];
  disallowUsers?: TelegramPrivacyRuleExceptionUser[];
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/settings/privacy', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '修改隐私设置失败' };
  }
}

export async function updateTelegramGlobalPrivacyApi(payload: {
  accountId?: string;
  phone?: string;
  archiveAndMuteNewNoncontactPeers: boolean;
  keepArchivedUnmuted: boolean;
  keepArchivedFolders: boolean;
  hideReadMarks: boolean;
  newNoncontactPeersRequirePremium: boolean;
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  globalPrivacy?: TelegramGlobalPrivacySettings;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/settings/global-privacy', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '更新全局隐私设置失败' };
  }
}

export async function updateTelegramAccountTtlApi(payload: {
  accountId?: string;
  phone?: string;
  days: number;
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  accountTtlDays?: number;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/settings/account-ttl', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '更新账号自毁期限失败' };
  }
}

export async function terminateTelegramSessionApi(payload: {
  accountId?: string;
  phone?: string;
  hash?: string;
  terminateAllOthers?: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; sessions?: TelegramOfficialSession[]; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/settings/sessions/terminate', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '注销设备会话失败' };
  }
}

export async function updateTelegramNotificationsApi(payload: {
  accountId?: string;
  phone?: string;
  scope?: 'users' | 'chats' | 'both';
  enabled: boolean;
  previewText: boolean;
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  notifications?: TelegramOfficialSettingsResponse['notifications'];
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/settings/notifications', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '更新通知设置失败' };
  }
}

export async function saveTelegramDialogFilterApi(payload: {
  accountId?: string;
  phone?: string;
  filter: {
    id?: number;
    title: string;
    contacts?: boolean;
    nonContacts?: boolean;
    groups?: boolean;
    broadcasts?: boolean;
    bots?: boolean;
    excludeMuted?: boolean;
    excludeRead?: boolean;
    excludeArchived?: boolean;
  };
}): Promise<{ ok: boolean; cloudSynced?: boolean; folders?: TelegramOfficialDialogFilter[]; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/settings/folders', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '保存云端文件夹失败' };
  }
}

export async function deleteTelegramDialogFilterApi(payload: {
  accountId?: string;
  phone?: string;
  filterId: number;
}): Promise<{ ok: boolean; cloudSynced?: boolean; folders?: TelegramOfficialDialogFilter[]; error?: string }> {
  try {
    const params = new URLSearchParams();
    if (payload.accountId) params.set('accountId', payload.accountId);
    if (payload.phone) params.set('phone', payload.phone);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetchWithTimeout(`/api/telegram/user/settings/folders/${payload.filterId}${qs}`, {
      method: 'DELETE',
      headers: getAuthHeaders(payload.accountId),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || '删除云端文件夹失败' };
  }
}

export async function fetchTelegramSavedMessagesApi(accountId?: string): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  chat?: Chat;
  messages?: Message[];
  error?: string;
}> {
  try {
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    const res = await fetchWithTimeout(`/api/telegram/user/saved-messages${query}`, {
      headers: getAuthHeaders(accountId),
    }, 20000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '打开 Telegram 官方收藏夹失败' };
  }
}

export async function editTelegramMessageApi(payload: {
  accountId?: string;
  chatId: string;
  messageId: string;
  telegramMessageId?: number;
  newText: string;
  translatedText?: string;
}): Promise<{ ok: boolean; cloudSynced?: boolean; telegramMessageId?: number; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/messages/edit', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '同步编辑消息失败' };
  }
}

export async function reactTelegramMessageApi(payload: {
  accountId?: string;
  chatId: string;
  messageId: string;
  telegramMessageId?: number;
  emoji: string;
  remove?: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; telegramMessageId?: number; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/messages/react', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '发送云端表情回应失败' };
  }
}

export async function pinTelegramMessageApi(payload: {
  accountId?: string;
  chatId: string;
  messageId: string;
  telegramMessageId?: number;
  pin: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; pinned?: boolean; telegramMessageId?: number; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/messages/pin', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '同步云端消息置顶失败' };
  }
}

export async function toggleTelegramDialogPinApi(payload: {
  accountId?: string;
  chatId: string;
  pinned: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; pinned?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/dialogs/pin', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '同步云端置顶对话失败' };
  }
}

export async function toggleTelegramDialogMuteApi(payload: {
  accountId?: string;
  chatId: string;
  muted: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; muted?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/dialogs/mute', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '同步云端静音设置失败' };
  }
}

export async function toggleTelegramDialogArchiveApi(payload: {
  accountId?: string;
  chatId: string;
  archived: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; archived?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/dialogs/archive', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '同步云端归档失败' };
  }
}

export async function toggleTelegramDialogUnreadApi(payload: {
  accountId?: string;
  chatId: string;
  unread: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; unread?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/dialogs/unread', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '同步云端已读/未读状态失败' };
  }
}

export async function clearTelegramDialogHistoryApi(payload: {
  accountId?: string;
  chatId: string;
  revoke?: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/dialogs/clear-history', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 20000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '清空云端聊天记录失败' };
  }
}

export async function deleteTelegramDialogApi(payload: {
  accountId?: string;
  chatId: string;
  revoke?: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/dialogs/delete', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 20000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '删除/退出云端对话失败' };
  }
}

export async function markTelegramDialogReadApi(payload: {
  accountId?: string;
  chatId: string;
  maxId?: number;
}): Promise<{ ok: boolean; cloudSynced?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/dialogs/read', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 12000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '同步云端已读状态失败' };
  }
}

export async function batchDeleteTelegramMessagesApi(payload: {
  accountId?: string;
  chatId: string;
  items: Array<{ id: string; telegramMessageId?: number; localOnly?: boolean }>;
  revoke?: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; deletedCount?: number; deletedIds?: string[]; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/messages/batch-delete', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 20000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '批量删除消息失败' };
  }
}

export async function forwardTelegramMessagesApi(payload: {
  accountId?: string;
  fromChatId: string;
  toChatId: string;
  messageIds?: string[];
  telegramMessageIds?: number[];
  dropAuthor?: boolean;
}): Promise<{ ok: boolean; cloudSynced?: boolean; forwardedCount?: number; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/messages/forward', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 20000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '转发消息失败' };
  }
}

export async function renameTelegramContactApi(payload: {
  accountId?: string;
  chatId: string;
  newTitle: string;
}): Promise<{ ok: boolean; cloudSynced?: boolean; newTitle?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/contacts/rename', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '同步云端联系人备注失败' };
  }
}

export async function fetchTelegramUserContactsApi(accountId?: string): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  contacts: TelegramContact[];
  error?: string;
}> {
  try {
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    const res = await fetchWithTimeout(`/api/telegram/user/contacts${query}`, {
      headers: getAuthHeaders(accountId),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, contacts: [], error: err?.message || '网络连接异常' };
  }
}

export async function addTelegramUserContactApi(payload: {
  accountId?: string;
  chatId?: string;
  name: string;
  phone?: string;
  username?: string;
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  contact?: TelegramContact;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/contacts/add', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常' };
  }
}

export async function deleteTelegramUserContactApi(payload: {
  accountId?: string;
  chatId: string;
}): Promise<{ ok: boolean; cloudSynced?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/contacts/delete', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常' };
  }
}

export async function blockTelegramUserContactApi(payload: {
  accountId?: string;
  chatId: string;
}): Promise<{ ok: boolean; cloudSynced?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/contacts/block', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常' };
  }
}

export async function unblockTelegramUserContactApi(payload: {
  accountId?: string;
  chatId: string;
}): Promise<{ ok: boolean; cloudSynced?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/contacts/unblock', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常' };
  }
}

export async function searchTelegramGlobalContactsApi(
  query: string,
  accountId?: string
): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  contacts: TelegramContact[];
  error?: string;
}> {
  try {
    const clean = query.trim();
    if (!clean) return { ok: true, contacts: [] };
    const params = new URLSearchParams({ q: clean });
    if (accountId) params.set('accountId', accountId);
    const res = await fetchWithTimeout(`/api/telegram/user/contacts/search?${params.toString()}`, {
      headers: getAuthHeaders(accountId),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, contacts: [], error: err?.message || '网络连接异常' };
  }
}

export async function fetchTelegramBlockedContactsApi(accountId?: string): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  blocked: TelegramContact[];
  error?: string;
}> {
  try {
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    const res = await fetchWithTimeout(`/api/telegram/user/contacts/blocked${query}`, {
      headers: getAuthHeaders(accountId),
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, blocked: [], error: err?.message || '网络连接异常' };
  }
}

export function getScopedContacts(accountId?: string): TelegramContact[] {
  try {
    const acc = accountId || currentActiveAccountId || '';
    if (!acc) return [];
    const scopedKey = `tg_desktop_contacts_${acc}`;
    const list = secureGetItemSync<TelegramContact[]>(scopedKey);
    if (Array.isArray(list)) {
      return list.filter((c) => c && c.id && !c.id.startsWith('contact_'));
    }
    return [];
  } catch {
    return [];
  }
}

export function saveScopedContacts(contacts: TelegramContact[], accountId?: string): void {
  try {
    const acc = accountId || currentActiveAccountId || '';
    if (!acc) return;
    const cleaned = (Array.isArray(contacts) ? contacts : []).filter(
      (c) => c && c.id && !c.id.startsWith('contact_')
    );
    secureSetItemSync(`tg_desktop_contacts_${acc}`, cleaned);
    try {
      localStorage.removeItem('tg_pro_contacts');
    } catch {}
  } catch {}
}

export async function createTelegramGroupApi(payload: {
  accountId?: string;
  title: string;
  memberPeers: Array<{ id?: string; username?: string; phone?: string }>;
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  invitedCount?: number;
  chat?: Chat;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/create-group', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 20000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常' };
  }
}

export async function createTelegramChannelApi(payload: {
  accountId?: string;
  title: string;
  description?: string;
  channelType: 'public' | 'private';
  customLink?: string;
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  chat?: Chat;
  usernameWarning?: string;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/create-channel', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 20000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常' };
  }
}

export async function startTelegramVoiceCallApi(payload: {
  accountId?: string;
  chatId?: string;
  username?: string;
  phone?: string;
}): Promise<{
  ok: boolean;
  cloudSynced?: boolean;
  callId?: string;
  tgCallId?: string;
  status?: 'ringing' | 'accepted' | 'discarded' | 'failed';
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/call/start', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    }, 20000);
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常' };
  }
}

export async function getTelegramVoiceCallStatusApi(
  callId: string,
  accountId?: string
): Promise<{
  ok: boolean;
  status?: 'ringing' | 'accepted' | 'discarded' | 'failed';
  endedReason?: string;
  elapsedSeconds?: number;
}> {
  try {
    const res = await fetchWithTimeout(`/api/telegram/user/call/status/${encodeURIComponent(callId)}`, {
      headers: getAuthHeaders(accountId),
    }, 10000);
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function endTelegramVoiceCallApi(
  callId: string,
  duration: number,
  accountId?: string
): Promise<{ ok: boolean; cloudSynced?: boolean }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/call/end', {
      method: 'POST',
      headers: getAuthHeaders(accountId),
      body: JSON.stringify({ callId, duration }),
    }, 12000);
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function fetchAutopilotStatus(
  chatId?: string,
  accountId?: string
): Promise<{ ok: boolean; activeChats: string[]; isChatEnabled: boolean }> {
  try {
    const query = new URLSearchParams();
    if (chatId) query.set('chatId', chatId);
    if (accountId) query.set('accountId', accountId);
    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetchWithTimeout(`/api/telegram/autopilot/status${qs}`, {
      headers: getAuthHeaders(accountId),
    }, 10000);
    return await res.json();
  } catch {
    return { ok: false, activeChats: [], isChatEnabled: false };
  }
}

export async function toggleAutopilot(
  chatId: string,
  enabled: boolean,
  accountId?: string
): Promise<{ ok: boolean; enabled: boolean; activeCount: number }> {
  try {
    const res = await fetchWithTimeout('/api/telegram/autopilot/toggle', {
      method: 'POST',
      headers: getAuthHeaders(accountId),
      body: JSON.stringify({ chatId, enabled, accountId: accountId || currentActiveAccountId || undefined }),
    }, 12000);
    return await res.json();
  } catch {
    return { ok: false, enabled: false, activeCount: 0 };
  }
}

// ==================== GLOBAL PERSONA & STAGED PROMPT APIS ====================

export async function fetchGlobalPersonaApi(): Promise<{ success: boolean; persona?: GlobalPersonaConfig; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/persona/config', {
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 12000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function saveGlobalPersonaApi(persona: GlobalPersonaConfig): Promise<{ success: boolean; persona?: GlobalPersonaConfig; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/persona/config', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(persona),
      credentials: 'include',
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function resetGlobalPersonaApi(): Promise<{ success: boolean; persona?: GlobalPersonaConfig; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/persona/reset', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 12000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function importPersonaTemplateApi(): Promise<{ success: boolean; persona?: GlobalPersonaConfig; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/persona/import-template', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function testPersonaReplyApi(params: {
  message: string;
  stage?: string;
  chatTranscript?: string;
  recentChatHistory?: string | Array<{ sender: string; text: string }>;
  customConfig?: CustomLLMConfig;
}): Promise<{
  success: boolean;
  reply?: string;
  stage?: string;
  personaName?: string;
  matchedKnowledge?: any[];
  appliedHabits?: any[];
  source?: string;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/persona/test-reply', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
      credentials: 'include',
    }, 30000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ==================== HABIT & EVOLUTION ENGINE APIS ====================

export async function fetchEvolutionStatusApi(): Promise<{
  success: boolean;
  state?: EvolutionEngineState;
  logs?: any[];
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/evolution/status', {
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 12000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function collectLocalSyncedMessages(
  limitPerChat = 20,
  maxTotal = 50,
  accountId?: string
): Partial<Message>[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const targetAcc = (accountId ?? currentActiveAccountId ?? '').trim();
    const prefix = targetAcc ? `tg_desktop_msgs_${targetAcc}_` : 'tg_desktop_msgs_';
    const collected: Partial<Message>[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (!key.startsWith(prefix)) continue;
      const list = secureGetItemSync<Message[]>(key);
      if (!Array.isArray(list) || list.length === 0) continue;
      const keyChatId = key.slice(prefix.length);
      const visible = list
        .filter(
          (m) =>
            m &&
            m.id &&
            !isMessageDeleted(m.id, targetAcc || m.accountId, m.chatId || keyChatId) &&
            (!targetAcc || !m.accountId || m.accountId === targetAcc)
        )
        .slice(-limitPerChat);
      for (const m of visible) {
        collected.push({
          id: m.id,
          telegramMessageId: m.telegramMessageId,
          chatId: m.chatId,
          accountId: m.accountId || targetAcc || undefined,
          sender: m.sender,
          senderName: m.senderName,
          text: m.text,
          sttText: m.sttText,
          translatedText: m.translatedText,
          timestamp: m.timestamp,
        });
      }
      if (collected.length >= maxTotal) break;
    }
    return collected.slice(-maxTotal);
  } catch {
    return [];
  }
}

export async function triggerEvolutionLearnApi(
  sampleTexts?: string[],
  customConfig?: CustomLLMConfig,
  messages?: Partial<Message>[]
): Promise<{
  success: boolean;
  newHabitsLearned?: number;
  analyzedConversationsCount?: number;
  syncedToBackendLlm?: boolean;
  backendSyncMessage?: string;
  state?: EvolutionEngineState;
  error?: string;
}> {
  try {
    const syncedMessages = Array.isArray(messages)
      ? messages
      : collectLocalSyncedMessages(20, 50, currentActiveAccountId);
    const res = await fetchWithTimeout('/api/evolution/learn', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        sampleTexts,
        messages: syncedMessages.length > 0 ? syncedMessages : undefined,
        customConfig: customConfig?.enabled ? customConfig : undefined,
      }),
      credentials: 'include',
    }, 35000);
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data?.error || `进化学习失败 (HTTP ${res.status})` };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function toggleEvolutionHabitApi(habitId: string): Promise<{
  success: boolean;
  state?: EvolutionEngineState;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/evolution/toggle-habit', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ habitId }),
      credentials: 'include',
    }, 12000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ==================== KNOWLEDGE BASE ENHANCED APIS ====================

export async function fetchKnowledgeItemsApi(): Promise<{
  items: KnowledgeBaseItem[];
  logs?: any[];
  stats?: {
    totalItems: number;
    activeItemsCount?: number;
    autoLearnedCount: number;
    customDocCount: number;
    totalHits: number;
  };
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/knowledge', {
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 15000);
    const data = await res.json();
    return {
      items: data.items || [],
      logs: data.logs || [],
      stats: data.stats,
    };
  } catch (err: any) {
    return { items: [], error: err.message };
  }
}

export async function createKnowledgeItemApi(item: {
  category: string;
  title: string;
  content: string;
  keywords: string[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/knowledge', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(item),
      credentials: 'include',
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function uploadKnowledgeDocApi(params: {
  fileName: string;
  fileContent: string;
  category?: string;
  customConfig?: CustomLLMConfig;
}): Promise<{ success: boolean; itemsLearned?: number; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/knowledge/upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...params,
        customConfig: params.customConfig?.enabled ? params.customConfig : undefined,
      }),
      credentials: 'include',
    }, 30000);
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data?.error || `文档分类上传失败 (HTTP ${res.status})` };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function toggleKnowledgeItemApi(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`/api/knowledge/${encodeURIComponent(id)}/toggle`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 12000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function updateKnowledgeItemApi(
  id: string,
  item: {
    category: string;
    title: string;
    content: string;
    keywords: string[];
    isActive?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(item),
      credentials: 'include',
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteKnowledgeItemApi(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 12000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function clearAllKnowledgeApi(category?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const url = category && category !== 'all'
      ? `/api/knowledge/clear-all?category=${encodeURIComponent(category)}`
      : '/api/knowledge/clear-all';
    const res = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function seedDefaultKnowledgeApi(): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/knowledge/seed-defaults', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 15000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ==================== FULL DIALOGUE TRANSCRIPTS & ORAL HABIT APIS ====================

export async function fetchTranscriptsApi(): Promise<{ success: boolean; transcripts?: ChatTranscriptItem[]; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/transcripts', {
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 12000);
    const data = await res.json();
    return { success: true, transcripts: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function createTranscriptApi(payload: {
  title: string;
  description?: string;
  dialogueText: string;
  learnedStyle?: string;
  customConfig?: CustomLLMConfig;
}): Promise<{ success: boolean; id?: string; learnedStyle?: string; syncedToBackendLlm?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/transcripts', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...payload,
        customConfig: payload.customConfig?.enabled ? payload.customConfig : undefined,
      }),
      credentials: 'include',
    }, 30000);
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data?.error || `整文风格提炼失败 (HTTP ${res.status})` };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteTranscriptApi(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`/api/transcripts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 12000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function toggleTranscriptApi(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`/api/transcripts/${encodeURIComponent(id)}/toggle`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      credentials: 'include',
    }, 12000);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function fetchTelegramChatFullInfoApi(
  chatId: string,
  accountId?: string
): Promise<TelegramChatFullInfo> {
  try {
    const query = new URLSearchParams();
    if (accountId) query.set('accountId', accountId);
    const res = await fetchWithTimeout(`/api/telegram/user/chat-info/${encodeURIComponent(chatId)}?${query.toString()}`, {
      headers: getAuthHeaders(accountId),
      credentials: 'include',
    }, 15000);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      return data;
    }
    return {
      ok: false,
      chatId,
      code: data?.code,
      error: data?.error || `获取详情失败 (HTTP ${res.status})`,
    };
  } catch (err: any) {
    return {
      ok: false,
      chatId,
      error: err?.message || '网络异常，无法获取 Telegram 详情',
    };
  }
}

export async function fetchTelegramStickersApi(
  accountId?: string
): Promise<{ ok: boolean; packs: TelegramStickerPack[]; error?: string }> {
  try {
    const query = new URLSearchParams();
    if (accountId) query.set('accountId', accountId);
    const res = await fetchWithTimeout(`/api/telegram/user/stickers?${query.toString()}`, {
      headers: getAuthHeaders(accountId),
      credentials: 'include',
    }, 20000);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      return {
        ok: true,
        packs: Array.isArray(data.packs) ? data.packs : [],
      };
    }
    return {
      ok: false,
      packs: [],
      error: data?.error || `拉取官方贴纸库失败 (HTTP ${res.status})`,
    };
  } catch (err: any) {
    return {
      ok: false,
      packs: [],
      error: err?.message || '网络异常，无法连接 Telegram 贴纸服务',
    };
  }
}

export async function sendTelegramStickerApi(params: {
  accountId?: string;
  chatId: string;
  sticker: TelegramStickerItem;
  packTitle?: string;
  replyToMsgId?: number;
  replyTo?: Message['replyTo'];
  id?: string;
}): Promise<{
  ok: boolean;
  id?: string;
  telegramMessageId?: number;
  deliveryStatus: 'delivered' | 'failed';
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  isImage?: boolean;
  isVideo?: boolean;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout('/api/telegram/user/send-sticker', {
      method: 'POST',
      headers: getAuthHeaders(params.accountId),
      credentials: 'include',
      body: JSON.stringify({
        accountId: params.accountId,
        chatId: params.chatId,
        docId: params.sticker.docId,
        accessHash: params.sticker.accessHash,
        fileReferenceBase64: params.sticker.fileReferenceBase64,
        setId: params.sticker.setId,
        setAccessHash: params.sticker.setAccessHash,
        replyToMsgId: params.replyToMsgId,
        emoji: params.sticker.emoji,
        packTitle: params.packTitle,
        thumbUrl: params.sticker.thumbUrl,
        isVideo: params.sticker.isVideo,
        replyTo: params.replyTo,
        id: params.id,
      }),
    }, 25000);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      return {
        ok: true,
        id: typeof data.id === 'string' ? data.id : undefined,
        telegramMessageId: data.telegramMessageId,
        deliveryStatus: 'delivered',
        text: typeof data.text === 'string' ? data.text : undefined,
        imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
        videoUrl: typeof data.videoUrl === 'string' ? data.videoUrl : undefined,
        isImage: typeof data.isImage === 'boolean' ? data.isImage : undefined,
        isVideo: typeof data.isVideo === 'boolean' ? data.isVideo : undefined,
      };
    }
    return {
      ok: false,
      deliveryStatus: 'failed',
      error: data?.error || `发送贴纸失败 (HTTP ${res.status})`,
    };
  } catch (err: any) {
    return {
      ok: false,
      deliveryStatus: 'failed',
      error: err?.message || '网络异常，贴纸发送失败',
    };
  }
}

export function clearLegacyLocalTelegramCredentials(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('tg_custom_api_id');
    localStorage.removeItem('tg_custom_api_hash');
  } catch {}
}



