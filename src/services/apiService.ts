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
    return localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY) || 'acc_1';
  }
  return 'acc_1';
})();

export function setActiveApiAccount(accountId: string) {
  currentActiveAccountId = accountId;
  if (typeof window !== 'undefined') {
    localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, accountId);
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
    const res = await fetch('/api/auth/device-id', { credentials: 'include' });
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
    const res = await fetch('/api/auth/session-init', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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

export function getAuthHeaders(accountId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Account-Id': accountId || currentActiveAccountId,
  };
  if (currentSessionToken) {
    headers['Authorization'] = `Bearer ${currentSessionToken}`;
  }
  return headers;
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
    const res = await fetch('/api/auth/status', {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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

export async function memberRegister(
  username: string,
  password: string,
  cardKey: string
): Promise<{ ok: boolean; message?: string; error?: string; code?: string; token?: string; user?: MemberUser }> {
  try {
    const { deviceId } = await fetchLocalDeviceId();
    const res = await fetch(`${CLOUD_AUTH_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, cardKey: cardKey.trim(), deviceId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      return {
        ok: false,
        code: data?.code,
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
    return { ok: false, error: err.message || '云端认证服务连接异常' };
  }
}

export async function memberLogin(
  username: string,
  password: string
): Promise<{ ok: boolean; message?: string; error?: string; code?: string; token?: string; user?: MemberUser }> {
  try {
    const { deviceId } = await fetchLocalDeviceId();
    const res = await fetch(`${CLOUD_AUTH_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, deviceId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      return {
        ok: false,
        code: data?.code,
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
    return { ok: false, error: err.message || '云端认证服务连接异常' };
  }
}

export async function memberRedeemCardKey(
  username: string,
  cardKey: string,
  password?: string
): Promise<{ ok: boolean; message?: string; error?: string; code?: string; token?: string; user?: MemberUser }> {
  try {
    const { deviceId } = await fetchLocalDeviceId();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (currentSessionToken) {
      headers['Authorization'] = `Bearer ${currentSessionToken}`;
    }
    const res = await fetch(`${CLOUD_AUTH_BASE_URL}/api/auth/redeem`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: username.trim(),
        cardKey: cardKey.trim(),
        ...(password ? { password } : {}),
        deviceId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      return {
        ok: false,
        code: data?.code,
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
    return { ok: false, error: err.message || '云端认证服务连接异常' };
  }
}

export async function adminLogin(password: string): Promise<{ ok: boolean; message?: string; error?: string; user?: any }> {
  return memberLogin('admin', password);
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接后重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
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
    const res = await fetch('/api/admin/users/stats', {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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

export async function translateText(
  text: string,
  sourceLang: string = 'Auto',
  targetLang: string = 'Chinese',
  customConfig?: CustomLLMConfig,
  engine: 'gemini' | 'google' | 'custom_llm' = 'gemini',
  googleApiKey?: string,
  geminiModel?: string,
  geminiApiKey?: string,
  customModelName?: string
): Promise<string> {
  const isPriorityCustom = Boolean(customConfig?.enabled && customConfig?.engineMode === 'custom');
  const strictEngine: 'gemini' | 'google' | 'custom_llm' = isPriorityCustom
    ? 'custom_llm'
    : engine === 'google' || engine === 'custom_llm' || engine === 'gemini'
    ? engine
    : 'gemini';

  const cleanBaseUrl = (customConfig?.baseUrl || '').trim();
  const cleanApiKey = (customConfig?.apiKey || '').trim();
  const effectiveCustomModel =
    isPriorityCustom && engine !== 'custom_llm'
      ? (customConfig?.modelName || '').trim() || (customModelName || '').trim() || 'gpt-4o-mini'
      : (customModelName || '').trim() || (customConfig?.modelName || '').trim() || 'gpt-4o-mini';

  if (strictEngine === 'custom_llm') {
    if (!isPriorityCustom) {
      throw new Error('请开启自定义优先回复');
    }
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
          engineMode: 'custom' as const,
          protocol: inferredProtocol,
          modelName: effectiveCustomModel,
          knowledgeBaseApiUrl: '',
          knowledgeBaseApiKey: '',
          enableKnowledgeBaseRAG: false,
        }
      : undefined;

  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: getAuthHeaders(),
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
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || `当前翻译通道不可用 (${res.status})`);
  }
  const data = await res.json();
  if (typeof data?.translatedText !== 'string' || !data.translatedText.trim()) {
    throw new Error(data?.error || '翻译服务未返回有效译文');
  }
  return decodeHtmlEntities(data.translatedText);
}

export async function transcribeAudio(audioBase64: string, mimeType: string = 'audio/webm', customConfig?: CustomLLMConfig): Promise<string> {
  const res = await fetch('/api/audio/transcribe', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      audioBase64,
      mimeType,
      customConfig: customConfig?.enabled ? customConfig : undefined,
    }),
  });

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
    const res = await fetch('/api/llm/config', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(config),
    });
    return res.ok;
  } catch (err) {
    console.warn('Failed to sync custom LLM config to server:', err);
    return false;
  }
}

export async function syncTranslationSettingsApi(settings: TranslationSettings): Promise<boolean> {
  try {
    const res = await fetch('/api/translate/settings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings),
    });
    return res.ok;
  } catch (err) {
    console.warn('Failed to sync translation settings to server:', err);
    return false;
  }
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

    const res = await fetch('/api/audio/tts-clone', {
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
    });

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
    const res = await fetch(`/api/telegram/user/poll-updates${query}`, {
      headers: getAuthHeaders(accountId),
    });
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
    const res = await fetch('/api/telegram/user/ack-updates', {
      method: 'POST',
      headers: getAuthHeaders(accountId),
      body: JSON.stringify({ ids, accountId }),
    });
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
  const res = await fetch('/api/llm/chat', {
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
  });

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
    const res = await fetch('/api/llm/ping', {
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
    });

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
    const res = await fetch('/api/llm/usage-stats', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        baseUrl: (baseUrl || '').trim(),
        apiKey: (apiKey || '').trim(),
        modelName: cleanModel,
      }),
    });
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
    const res = await fetch('/api/knowledge/remote-search', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        query,
        customConfig,
        apiUrl: customConfig?.knowledgeBaseApiUrl || '',
        apiKey: customConfig?.knowledgeBaseApiKey || customConfig?.apiKey || '',
        engineLicenseKey: customConfig?.engineLicenseKey || '',
      }),
    });

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
    const res = await fetch('/api/training/feedback', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch {}
  return { ok: false };
}

// ==================== DATABASE & MEMORY SERVICES ====================

export async function fetchChatsFromDb(accountId?: string): Promise<any[]> {
  try {
    const res = await fetch('/api/chats', {
      headers: getAuthHeaders(accountId),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Failed to load chats from DB:', err);
  }
  return [];
}

export async function fetchMessagesFromDb(chatId: string, accountId?: string): Promise<Message[]> {
  try {
    const res = await fetch(`/api/messages/${chatId}`, {
      headers: getAuthHeaders(accountId),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Failed to load messages from DB:', err);
  }
  return [];
}

export async function saveMessageToDb(
  message: Partial<Message>
): Promise<{ ok: boolean; deliveryStatus: 'delivered' | 'failed'; telegramMessageId?: number; error?: string; code?: string }> {
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: getAuthHeaders(message.accountId),
      body: JSON.stringify({
        ...message,
        accountId: message.accountId || currentActiveAccountId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.delivered === false || data?.deliveryStatus === 'failed') {
      return {
        ok: false,
        deliveryStatus: 'failed',
        code: data?.code,
        error: data?.error || `投递失败 (${res.status})`,
      };
    }
    return {
      ok: true,
      deliveryStatus: 'delivered',
      telegramMessageId: typeof data?.telegramMessageId === 'number' ? data.telegramMessageId : undefined,
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
  messagePayload?: Partial<Message>
): Promise<{ ok: boolean; deliveryStatus: 'delivered' | 'failed'; telegramMessageId?: number; error?: string; code?: string }> {
  try {
    const res = await fetch(`/api/messages/${encodeURIComponent(messageId)}/retry`, {
      method: 'POST',
      headers: getAuthHeaders(accountId),
      body: JSON.stringify(
        messagePayload
          ? {
              ...messagePayload,
              accountId: messagePayload.accountId || accountId || currentActiveAccountId,
            }
          : {}
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false || data?.delivered === false || data?.deliveryStatus === 'failed') {
      return {
        ok: false,
        deliveryStatus: 'failed',
        code: data?.code,
        error: data?.error || `重发失败 (${res.status})`,
      };
    }
    return {
      ok: true,
      deliveryStatus: 'delivered',
      telegramMessageId: typeof data?.telegramMessageId === 'number' ? data.telegramMessageId : undefined,
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
    const res = await fetch(`/api/customer/profile/${chatId}`, {
      headers: getAuthHeaders(accountId),
    });
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
    const res = await fetch(`/api/customer/profile/${chatId}`, {
      method: 'POST',
      headers: getAuthHeaders(effectiveAccountId),
      body: JSON.stringify({
        ...profile,
        accountId: effectiveAccountId,
      }),
    });
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
    const res = await fetch(`/api/customer/analyze/${chatId}`, {
      method: 'POST',
      headers: getAuthHeaders(accountId),
      body: JSON.stringify({
        customConfig,
        accountId: accountId || currentActiveAccountId,
        messages: Array.isArray(messages) ? messages.slice(-50) : undefined,
        chatTitle,
      }),
    });
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
    const res = await fetch('/api/database/status', {
      headers: getAuthHeaders(),
    });
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
  }>;
  expiredAccounts: Array<{
    accountId: string;
    userId?: string;
    phone?: string;
    reason: string;
    expiredAt: number;
  }>;
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
      };
    }
  } catch (err) {
    console.warn('Failed to fetch Telegram user status:', err);
  }
  return { ok: false, activeUsers: [], expiredAccounts: [] };
}

export async function downloadDatabaseBackup(): Promise<any> {
  try {
    const res = await fetch('/api/database/backup', {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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
    const res = await fetch('/api/database/restore?confirm=true', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ snapshot, confirm: true }),
    });
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
// are NEVER sent to or stored in any database; they exist exclusively in the client's local browser memory,
// encrypted with Web Crypto API (AES-256-GCM) to prevent plain-text inspection in browser DevTools.

export function isMessageDeleted(messageId: string): boolean {
  try {
    const raw = localStorage.getItem('tg_deleted_message_ids');
    if (!raw) return false;
    const list: string[] = JSON.parse(raw);
    return Array.isArray(list) && list.includes(messageId);
  } catch {
    return false;
  }
}

export function recordDeletedMessageId(messageId: string): void {
  try {
    const raw = localStorage.getItem('tg_deleted_message_ids');
    const set = new Set<string>(raw ? JSON.parse(raw) : []);
    set.add(messageId);
    localStorage.setItem('tg_deleted_message_ids', JSON.stringify(Array.from(set)));
  } catch {}
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
        list = legacyList.filter((m) =>
          acc && acc !== 'acc_1'
            ? m.accountId === acc
            : !m.accountId || m.accountId === acc
        );
      }
    }
    if (Array.isArray(list)) {
      return list.filter(
        (m) =>
          !isMessageDeleted(m.id) &&
          (!acc || !m.accountId || m.accountId === acc)
      );
    }
    return [];
  } catch {
    return [];
  }
}

export function deleteLocalMessage(chatId: string, messageId: string, accountId?: string): void {
  try {
    recordDeletedMessageId(messageId);
    const acc = accountId || currentActiveAccountId;
    const scopedKey = acc ? `tg_desktop_msgs_${acc}_${chatId}` : `tg_desktop_msgs_${chatId}`;
    const existing = getLocalMessages(chatId, acc);
    const updated = existing.filter((m) => m.id !== messageId);
    secureSetItemSync(scopedKey, updated);
  } catch (e) {
    console.error('Failed to delete encrypted message from local storage', e);
  }
}

export function setLocalMessages(chatId: string, messages: Message[], accountId?: string): void {
  try {
    const acc = accountId || currentActiveAccountId;
    const scopedKey = acc ? `tg_desktop_msgs_${acc}_${chatId}` : `tg_desktop_msgs_${chatId}`;
    const filtered = Array.isArray(messages) ? messages.filter((m) => !isMessageDeleted(m.id)) : [];
    secureSetItemSync(scopedKey, filtered);
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
      const raw = localStorage.getItem('tg_deleted_message_ids');
      const set = new Set<string>(raw ? JSON.parse(raw) : []);
      allToRecord.forEach((m) => {
        if (m?.id) set.add(m.id);
      });
      localStorage.setItem('tg_deleted_message_ids', JSON.stringify(Array.from(set)));
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
  telegramMessageId?: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const query = new URLSearchParams();
    if (chatId) query.set('chatId', chatId);
    if (accountId) query.set('accountId', accountId);
    if (telegramMessageId !== undefined && telegramMessageId !== null) {
      query.set('telegramMessageId', String(telegramMessageId));
    }
    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`/api/messages/${encodeURIComponent(messageId)}${qs}`, {
      method: 'DELETE',
      headers: getAuthHeaders(accountId),
    });
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
  if (isMessageDeleted(message.id)) return;
  try {
    const acc = accountId || message.accountId || currentActiveAccountId;
    const scopedKey = acc ? `tg_desktop_msgs_${acc}_${chatId}` : `tg_desktop_msgs_${chatId}`;
    const existing = getLocalMessages(chatId, acc);
    const existingIdx = existing.findIndex((m) => {
      if (m.id === message.id) return true;
      if (
        m.sender === message.sender &&
        m.text &&
        message.text &&
        m.text.trim() === message.text.trim()
      ) {
        if (message.sender === 'me' || m.timestamp === message.timestamp) return true;
      }
      return false;
    });

    if (existingIdx === -1) {
      existing.push(message);
      secureSetItemSync(scopedKey, existing);
    } else if (message.translatedText && !existing[existingIdx].translatedText) {
      existing[existingIdx].translatedText = message.translatedText;
      secureSetItemSync(scopedKey, existing);
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
      if (legacy && (!acc || acc === 'acc_1' || legacy.accountId === acc)) {
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
    const keysToRemove: string[] = [];

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
        key === 'tg_deleted_message_ids' ||
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

export async function syncTelegramCloudMessages(chatId: string, accountId?: string): Promise<Message[]> {
  try {
    const res = await fetch(`/api/telegram/user/messages/${chatId}?limit=40`, {
      headers: getAuthHeaders(accountId),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok && Array.isArray(data.messages)) {
      return data.messages;
    }
  } catch (err) {
    console.warn('[Sync Cloud Messages Error]:', err);
  }
  return [];
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
    const res = await fetch('/api/telegram/user/update-profile', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch(`/api/telegram/user/settings${qs}`, {
      headers: getAuthHeaders(accountId),
    });
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
    const res = await fetch('/api/telegram/user/upload-avatar', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/change-phone/send-code', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/change-phone/confirm', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/settings/two-factor', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/settings/privacy', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/settings/global-privacy', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/settings/account-ttl', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/settings/sessions/terminate', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/settings/notifications', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/settings/folders', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch(`/api/telegram/user/settings/folders/${payload.filterId}${qs}`, {
      method: 'DELETE',
      headers: getAuthHeaders(payload.accountId),
    });
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
    const res = await fetch(`/api/telegram/user/saved-messages${query}`, {
      headers: getAuthHeaders(accountId),
    });
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
}): Promise<{ ok: boolean; cloudSynced?: boolean; telegramMessageId?: number; error?: string }> {
  try {
    const res = await fetch('/api/telegram/user/messages/edit', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/messages/react', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/messages/pin', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/dialogs/pin', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/dialogs/mute', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/dialogs/archive', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/dialogs/unread', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/dialogs/clear-history', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/dialogs/delete', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '删除/退出云端对话失败' };
  }
}

export async function renameTelegramContactApi(payload: {
  accountId?: string;
  chatId: string;
  newTitle: string;
}): Promise<{ ok: boolean; cloudSynced?: boolean; newTitle?: string; error?: string }> {
  try {
    const res = await fetch('/api/telegram/user/contacts/rename', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch(`/api/telegram/user/contacts${query}`, {
      headers: getAuthHeaders(accountId),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, contacts: [], error: err?.message || '网络连接异常' };
  }
}

export async function addTelegramUserContactApi(payload: {
  accountId?: string;
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
    const res = await fetch('/api/telegram/user/contacts/add', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || '网络连接异常' };
  }
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
    const res = await fetch('/api/telegram/user/create-group', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/create-channel', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch('/api/telegram/user/call/start', {
      method: 'POST',
      headers: getAuthHeaders(payload.accountId),
      body: JSON.stringify(payload),
    });
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
    const res = await fetch(`/api/telegram/user/call/status/${encodeURIComponent(callId)}`, {
      headers: getAuthHeaders(accountId),
    });
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
    const res = await fetch('/api/telegram/user/call/end', {
      method: 'POST',
      headers: getAuthHeaders(accountId),
      body: JSON.stringify({ callId, duration }),
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function fetchAutopilotStatus(chatId?: string): Promise<{ ok: boolean; activeChats: string[]; isChatEnabled: boolean }> {
  try {
    const res = await fetch(`/api/telegram/autopilot/status${chatId ? `?chatId=${chatId}` : ''}`, {
      headers: getAuthHeaders(),
    });
    return await res.json();
  } catch {
    return { ok: false, activeChats: [], isChatEnabled: false };
  }
}

export async function toggleAutopilot(chatId: string, enabled: boolean): Promise<{ ok: boolean; enabled: boolean; activeCount: number }> {
  try {
    const res = await fetch('/api/telegram/autopilot/toggle', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ chatId, enabled }),
    });
    return await res.json();
  } catch {
    return { ok: false, enabled: false, activeCount: 0 };
  }
}

// ==================== GLOBAL PERSONA & STAGED PROMPT APIS ====================

export async function fetchGlobalPersonaApi(): Promise<{ success: boolean; persona?: GlobalPersonaConfig; error?: string }> {
  try {
    const res = await fetch('/api/persona/config', {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function saveGlobalPersonaApi(persona: GlobalPersonaConfig): Promise<{ success: boolean; persona?: GlobalPersonaConfig; error?: string }> {
  try {
    const res = await fetch('/api/persona/config', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(persona),
      credentials: 'include',
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function resetGlobalPersonaApi(): Promise<{ success: boolean; persona?: GlobalPersonaConfig; error?: string }> {
  try {
    const res = await fetch('/api/persona/reset', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function importPersonaTemplateApi(): Promise<{ success: boolean; persona?: GlobalPersonaConfig; error?: string }> {
  try {
    const res = await fetch('/api/persona/import-template', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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
    const res = await fetch('/api/persona/test-reply', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
      credentials: 'include',
    });
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
    const res = await fetch('/api/evolution/status', {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function collectLocalSyncedMessages(limitPerChat = 20, maxTotal = 50): Partial<Message>[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const collected: Partial<Message>[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (!key.startsWith('tg_desktop_msgs_')) continue;
      const list = secureGetItemSync<Message[]>(key);
      if (!Array.isArray(list) || list.length === 0) continue;
      const visible = list
        .filter((m) => m && m.id && !isMessageDeleted(m.id))
        .slice(-limitPerChat);
      for (const m of visible) {
        collected.push({
          id: m.id,
          telegramMessageId: m.telegramMessageId,
          chatId: m.chatId,
          accountId: m.accountId,
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
    const syncedMessages = Array.isArray(messages) ? messages : collectLocalSyncedMessages();
    const res = await fetch('/api/evolution/learn', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        sampleTexts,
        messages: syncedMessages.length > 0 ? syncedMessages : undefined,
        customConfig: customConfig?.enabled ? customConfig : undefined,
      }),
      credentials: 'include',
    });
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
    const res = await fetch('/api/evolution/toggle-habit', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ habitId }),
      credentials: 'include',
    });
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
    const res = await fetch('/api/knowledge', {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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
    const res = await fetch('/api/knowledge', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(item),
      credentials: 'include',
    });
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
    const res = await fetch('/api/knowledge/upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...params,
        customConfig: params.customConfig?.enabled ? params.customConfig : undefined,
      }),
      credentials: 'include',
    });
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
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}/toggle`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(item),
      credentials: 'include',
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteKnowledgeItemApi(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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
    const res = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function seedDefaultKnowledgeApi(): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    const res = await fetch('/api/knowledge/seed-defaults', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ==================== FULL DIALOGUE TRANSCRIPTS & ORAL HABIT APIS ====================

export async function fetchTranscriptsApi(): Promise<{ success: boolean; transcripts?: ChatTranscriptItem[]; error?: string }> {
  try {
    const res = await fetch('/api/transcripts', {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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
    const res = await fetch('/api/transcripts', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...payload,
        customConfig: payload.customConfig?.enabled ? payload.customConfig : undefined,
      }),
      credentials: 'include',
    });
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
    const res = await fetch(`/api/transcripts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function toggleTranscriptApi(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/transcripts/${encodeURIComponent(id)}/toggle`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
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
    const res = await fetch(`/api/telegram/user/chat-info/${encodeURIComponent(chatId)}?${query.toString()}`, {
      headers: getAuthHeaders(accountId),
      credentials: 'include',
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      return data;
    }
    return {
      ok: false,
      chatId,
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
    const res = await fetch(`/api/telegram/user/stickers?${query.toString()}`, {
      headers: getAuthHeaders(accountId),
      credentials: 'include',
    });
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
  replyToMsgId?: number;
}): Promise<{ ok: boolean; telegramMessageId?: number; deliveryStatus: 'delivered' | 'failed'; error?: string }> {
  try {
    const res = await fetch('/api/telegram/user/send-sticker', {
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
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      return {
        ok: true,
        telegramMessageId: data.telegramMessageId,
        deliveryStatus: 'delivered',
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



