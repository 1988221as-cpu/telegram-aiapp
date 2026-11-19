import React, { useState, useEffect, useRef } from 'react';
import { LeftSidebar } from './components/LeftSidebar';
import { ChatList } from './components/ChatList';
import { ChatArea, detectClientLangCode } from './components/ChatArea';
import { UnifiedRightDock, RightPanelTab } from './components/UnifiedRightDock';
import { CustomerMemoryDrawer } from './components/CustomerMemoryDrawer';
import { MultiAccountModal } from './components/MultiAccountModal';
import { TelegramMenuDrawer } from './components/TelegramMenuDrawer';
import { DatabaseModal } from './components/DatabaseModal';
import { SystemSettingsModal } from './components/SystemSettingsModal';
import { TelegramNewGroupModal } from './components/TelegramNewGroupModal';
import { TelegramNewChannelModal } from './components/TelegramNewChannelModal';
import { TelegramContactsModal } from './components/TelegramContactsModal';
import { TelegramCallsModal } from './components/TelegramCallsModal';
import {
  TelegramSettingsModal,
  TelegramClientPrefs,
  DEFAULT_TELEGRAM_CLIENT_PREFS,
  getScopedClientPrefsStorageKey,
  loadStoredClientPrefs,
} from './components/TelegramSettingsModal';
import { MemberAuthModal } from './components/MemberAuthModal';
import { getMasterVoiceprint, hydrateMasterVoiceprint } from './services/voiceprintStorage';
import {
  INITIAL_ACCOUNTS,
  INITIAL_CHATS,
  INITIAL_TRANSLATION_SETTINGS,
  INITIAL_CUSTOM_LLM,
  normalizeLanguageCode,
} from './data/mockData';
import {
  Account,
  AccountGroup,
  Chat,
  Message,
  TranslationSettings,
  CustomerProfile,
  CustomLLMConfig,
  MemberUser,
  TelegramContact,
  TelegramCallRecord,
  AppThemeMode,
} from './types';
import {
  fetchChatsFromDb,
  fetchMessagesFromDb,
  saveMessageToDb,
  retryMessageDelivery,
  fetchCustomerProfile,
  saveCustomerProfile,
  setActiveApiAccount,
  fetchTelegramUserDialogsDetailedApi,
  fetchTelegramChatFullInfoApi,
  fetchTelegramCloudMessagesApi,
  fetchTelegramActiveAccounts,
  fetchTelegramUserStatusApi,
  reconnectTelegramSessionsApi,
  pollIncomingTelegramUpdates,
  ackIncomingTelegramUpdates,
  fetchTelegramDialogFiltersApi,
  TelegramOfficialDialogFilter,
  getLocalMessages,
  saveLocalMessage,
  setLocalMessages,
  clearLocalMessages,
  clearAccountLocalCache,
  purgeAllLocalChatData,
  deleteLocalMessage,
  recordDeletedMessageId,
  getDeletedMessageStorageKey,
  isMessageDeleted,
  deleteMessageFromDb,
  batchDeleteTelegramMessagesApi,
  forwardTelegramMessagesApi,
  markTelegramDialogReadApi,
  getLocalCustomerProfile,
  saveLocalCustomerProfile,
  clearLocalCustomerProfile,
  normalizeProfileChatId,
  translateText,
  translateBatchTexts,
  syncCustomLLMConfigApi,
  fetchCustomLLMConfigApi,
  syncTranslationSettingsApi,
  fetchTranslationSettingsApi,
  saveChatLanguagePrefApi,
  updateMessageTranslationInDb,
  updateMessageSttInDb,
  isBuiltInCloudGatewayUrl,
  initSessionHandshake,
  fetchAuthStatus,
  adminLogout,
  getStoredMemberUser,
  fetchTelegramSavedMessagesApi,
  editTelegramMessageApi,
  reactTelegramMessageApi,
  pinTelegramMessageApi,
  toggleTelegramDialogPinApi,
  toggleTelegramDialogMuteApi,
  toggleTelegramDialogArchiveApi,
  toggleTelegramDialogUnreadApi,
  clearTelegramDialogHistoryApi,
  deleteTelegramDialogApi,
  renameTelegramContactApi,
  normalizeStalePendingMessages,
  resolveClientTelegramMessageId,
  fetchTelegramUserContactsApi,
  getScopedContacts,
  saveScopedContacts,
  isSignedResourceUrl,
  refreshSignedResourceUrlsApi,
  checkAppUpdateApi,
  getDesktopUpdaterBridge,
  APP_VERSION,
  type AppUpdateCheckResult,
  type DesktopUpdaterInfo,
  type DesktopUpdaterState,
} from './services/apiService';
import {
  evaluateTelegramAccountUiState,
  getTelegramConnectionPhaseLabel,
  resolveTelegramAccountIdentity,
  type TelegramConnectionPhase,
} from './services/telegramConnectionStatus';


import { secureGetItemSync, secureSetItemSync, secureGetItemAsync, secureRemoveItem } from './services/cryptoStorage';
import {
  savePendingMediaBlob,
  getPendingMediaBlob,
  listChatPendingMediaBlobs,
  deletePendingMediaBlob,
  clearChatPendingMediaBlobs,
  clearAccountPendingMediaBlobs,
  purgeAllPendingMediaBlobs,
  type PendingMediaField,
} from './services/pendingMediaStorage';

// Helper to purge only explicitly marked legacy dummy accounts from local storage
function sanitizeAccounts(accs: Account[]): Account[] {
  return accs.filter((a) => {
    const isLegacyMockId = a.id === 'acc_mock_demo' || a.id.startsWith('mock_legacy_');
    return !isLegacyMockId;
  });
}

function sanitizeChats(chats: Chat[]): Chat[] {
  return chats.filter((c) => {
    const isLegacyMockChat = c.id === 'chat_mock_demo' || c.id.startsWith('mock_legacy_');
    return !isLegacyMockChat;
  });
}

function msgBucketKey(accountId: string | undefined, chatId: string): string {
  return accountId ? `${accountId}::${chatId}` : chatId;
}

function isAppWindowActivelyFocused(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    document.hasFocus()
  );
}

function getBucketMessages(
  map: Record<string, Message[]>,
  accountId: string | undefined,
  chatId: string
): Message[] {
  if (!chatId) return [];
  const scopedKey = msgBucketKey(accountId, chatId);
  if (Array.isArray(map[scopedKey])) {
    return map[scopedKey];
  }
  const legacy = map[chatId];
  if (Array.isArray(legacy)) {
    return accountId
      ? legacy.filter((m) => m.accountId === accountId)
      : legacy;
  }
  return [];
}

function mapCloudDialogToChat(d: any, accountId: string, existing?: Chat): Chat {
  const isChannel = Boolean(d.isChannel);
  const isBot = Boolean(d.isBot);
  const isGroup = Boolean(d.isGroup && !isChannel);
  return {
    ...(existing || {}),
    id: d.id,
    accountId,
    title: d.title || existing?.title || 'Telegram 对话',
    username: d.username !== undefined ? d.username : existing?.username,
    avatarUrl: d.avatarUrl || existing?.avatarUrl,
    avatarBg: d.avatarBg || existing?.avatarBg || '#2481cc',
    avatarInitial: d.avatarInitial || existing?.avatarInitial || 'TG',
    isGroup,
    isChannel,
    isBot,
    isPinned: Boolean(d.isPinned),
    pinOrder: Boolean(d.isPinned) && typeof d.pinOrder === 'number' ? d.pinOrder : undefined,
    isArchived: Boolean(d.isArchived),
    isMuted: Boolean(d.isMuted),
    isVerified: Boolean(d.isVerified),
    isOnline: Boolean(d.isOnline),
    statusText: typeof d.statusText === 'string' ? d.statusText : existing?.statusText,
    memberCount: typeof d.memberCount === 'number' ? d.memberCount : existing?.memberCount,
    onlineCount: typeof d.onlineCount === 'number' ? d.onlineCount : existing?.onlineCount,
    lastMessage: d.lastMessage || existing?.lastMessage || '暂无消息',
    lastTime: d.lastTime || existing?.lastTime || '刚刚',
    lastDate: typeof d.lastDate === 'number' ? d.lastDate : existing?.lastDate,
    unreadCount: typeof d.unreadCount === 'number' ? d.unreadCount : (existing?.unreadCount || 0),
    readOutboxMaxId: typeof d.readOutboxMaxId === 'number' ? d.readOutboxMaxId : existing?.readOutboxMaxId,
    readInboxMaxId: typeof d.readInboxMaxId === 'number' ? d.readInboxMaxId : existing?.readInboxMaxId,
    sourceLang: existing?.sourceLang || d.sourceLang || 'Auto',
    targetLang: existing?.targetLang || d.targetLang || 'Auto',
    ...(typeof existing?.translationEnabled === 'boolean'
      ? { translationEnabled: existing.translationEnabled }
      : typeof d.translationEnabled === 'boolean'
        ? { translationEnabled: d.translationEnabled }
        : {}),
  };
}

function enforceTranslationEngineForLlm(
  cfg: Partial<CustomLLMConfig> | null | undefined,
  trans: TranslationSettings
): TranslationSettings {
  const isDualOff = Boolean(cfg && (cfg.enabled === false || cfg.explicitlyDisabled));
  const isCustomPriority = Boolean(!isDualOff && cfg?.enabled && cfg?.engineMode === 'custom');
  if (isDualOff && trans.preferredEngine !== 'google') {
    return { ...trans, preferredEngine: 'google' };
  }
  if (isCustomPriority && trans.preferredEngine !== 'custom_llm' && trans.preferredEngine !== 'google') {
    return { ...trans, preferredEngine: 'custom_llm' };
  }
  if (!isDualOff && !isCustomPriority && trans.preferredEngine === 'custom_llm') {
    return { ...trans, preferredEngine: 'gemini' };
  }
  return trans;
}

function engineToLiveErrorChannel(engine?: string): Message['translationErrorChannel'] {
  if (engine === 'custom_llm') return 'live_custom_llm';
  if (engine === 'google' || engine === 'bing' || engine === 'free_dual') return 'live_google';
  return 'live_gemini';
}

function formatChatMessageSummary(msg: Partial<Message>, emptyFallback = '暂无消息'): string {
  if (msg.isCall) return msg.text || (msg.isVideoCall ? '📹 视频通话' : '📞 语音通话');
  if (msg.isAudio) return '🎤 语音消息';
  if (msg.isVideo) return '🎬 [视频]';
  if (msg.isImage) return '🖼️ [图片]';
  if (msg.isFile) return `📁 [文件] ${msg.fileName || ''}`.trim();
  return msg.text || emptyFallback;
}

function mergeCloudMessagesWithLocal(
  localMsgs: Message[],
  cloudMsgs: Message[],
  options?: { preserveAllLocal?: boolean; allowEmptyCloudPrune?: boolean; accountId?: string; chatId?: string }
): Message[] {
  const visibleLocal = (Array.isArray(localMsgs) ? localMsgs : []).filter(
    (m) => !isMessageDeleted(m.id, options?.accountId || m.accountId, options?.chatId || m.chatId)
  );
  const visibleCloud = (Array.isArray(cloudMsgs) ? cloudMsgs : []).filter(
    (m) => !isMessageDeleted(m.id, options?.accountId || m.accountId, options?.chatId || m.chatId)
  );
  if (visibleCloud.length === 0) {
    if (options?.allowEmptyCloudPrune) {
      // Cloud genuinely returned an empty list (e.g. history cleared on another device):
      // prune delivered/cloud-synced messages and keep only unsent drafts / failed items.
      return visibleLocal.filter(
        (lm) => lm.deliveryStatus === 'pending' || lm.deliveryStatus === 'retrying' || lm.deliveryStatus === 'failed'
      );
    }
    return visibleLocal;
  }

  const localById = new Map<string, Message>();
  const localByTgId = new Map<number, Message>();
  visibleLocal.forEach((m) => {
    localById.set(m.id, m);
    const mTgId = resolveClientTelegramMessageId(m);
    if (mTgId !== undefined) {
      localByTgId.set(mTgId, m);
    }
  });

  const matchedLocalIds = new Set<string>();
  const mergedCloud = visibleCloud.map((cm) => {
    let lm = localById.get(cm.id);
    const cmTgId = resolveClientTelegramMessageId(cm);
    if (!lm && cmTgId !== undefined) {
      lm = localByTgId.get(cmTgId);
    }
    if (!lm) {
      lm = visibleLocal.find(
        (m) =>
          !matchedLocalIds.has(m.id) &&
          m.sender === cm.sender &&
          m.timestamp === cm.timestamp &&
          Boolean(m.text) &&
          m.text === cm.text
      );
    }
    if (lm) {
      matchedLocalIds.add(lm.id);
      const isLegacyPlaceholder = (name?: string) =>
        !name || name === '客户' || name === '对方' || name === '我方' || name === 'Telegram 联系人';
      return {
        ...lm,
        ...cm,
        id: cm.id || lm.id,
        senderId: cm.senderId || lm.senderId,
        senderAvatarUrl: cm.senderAvatarUrl || lm.senderAvatarUrl,
        senderName: !isLegacyPlaceholder(cm.senderName)
          ? cm.senderName
          : !isLegacyPlaceholder(lm.senderName)
          ? lm.senderName
          : '',
        translatedText: lm.translatedText || cm.translatedText,
        sttText: lm.sttText || cm.sttText,
        voiceName: lm.voiceName || cm.voiceName,
        voiceTone: lm.voiceTone || cm.voiceTone,
        isMasterVoice: lm.isMasterVoice ?? cm.isMasterVoice,
        audioUrl: cm.audioUrl || lm.audioUrl,
        imageUrl: cm.imageUrl || lm.imageUrl,
        videoUrl: cm.videoUrl || lm.videoUrl,
        fileUrl: cm.fileUrl || lm.fileUrl,
        reactions: cm.reactions ?? lm.reactions,
        myReactions: cm.myReactions ?? lm.myReactions,
        deliveryStatus: 'delivered' as const,
      };
    }
    return cm;
  });

  const cloudMinTgId = visibleCloud.reduce((min, m) => {
    if (typeof m.telegramMessageId === 'number') {
      return min === null ? m.telegramMessageId : Math.min(min, m.telegramMessageId);
    }
    return min;
  }, null as number | null);

  const retainedLocal = visibleLocal.filter((lm) => {
    if (matchedLocalIds.has(lm.id)) return false;
    if (options?.preserveAllLocal) return true;
    if (lm.deliveryStatus === 'pending' || lm.deliveryStatus === 'retrying' || lm.deliveryStatus === 'failed') {
      return true;
    }
    // Keep older cached local messages from before the latest 40-message cloud window
    if (cloudMinTgId !== null && typeof lm.telegramMessageId === 'number' && lm.telegramMessageId < cloudMinTgId) {
      return true;
    }
    return false;
  });

  const combined = options?.preserveAllLocal
    ? [...mergedCloud, ...retainedLocal]
    : [...retainedLocal, ...mergedCloud];

  return combined.sort((a, b) => {
    if (typeof a.telegramMessageId === 'number' && typeof b.telegramMessageId === 'number') {
      return a.telegramMessageId - b.telegramMessageId;
    }
    if (typeof a.createdAt === 'number' && typeof b.createdAt === 'number') {
      return a.createdAt - b.createdAt;
    }
    return 0;
  });
}

const LEGACY_MOCK_CALL_IDS = new Set(['call_rec_1', 'call_rec_2', 'call_rec_3']);

function sanitizeCallRecords(list: any): TelegramCallRecord[] {
  if (!Array.isArray(list)) return [];
  return list.filter((rec) => rec && rec.id && !LEGACY_MOCK_CALL_IDS.has(String(rec.id)));
}

function formatCallRecordDurationStr(seconds?: number): string {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  if (total <= 0) return '00:00';
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function mergeCallMessagesIntoCallRecords(
  prevRecords: TelegramCallRecord[],
  msgs: Partial<Message>[],
  chatsSnapshot: Chat[],
  fallbackAccountId: string
): TelegramCallRecord[] {
  const callMsgs = (Array.isArray(msgs) ? msgs : []).filter((m) => m && m.isCall);
  if (callMsgs.length === 0) return prevRecords;

  const next = [...prevRecords];
  let changed = false;

  for (const m of callMsgs) {
    const accId = m.accountId || fallbackAccountId;
    const chatId = m.chatId || '';
    const tgCallId = m.telegramCallId ? String(m.telegramCallId) : '';
    const recId = tgCallId
      ? `call_${accId}_${tgCallId}`
      : m.telegramMessageId && chatId
        ? `call_${accId}_${chatId}_${m.telegramMessageId}`
        : `call_${accId}_${m.id || Date.now()}`;

    const matchedChat = chatsSnapshot.find((c) => c.id === chatId && (!accId || c.accountId === accId));
    const contactName =
      matchedChat?.title ||
      (m.sender === 'peer' && m.senderName ? m.senderName : '') ||
      (chatId ? `Telegram (${chatId.replace(/^tg_/, '')})` : '未知联系人');
    const avatarInitial = matchedChat?.avatarInitial || contactName.slice(0, 2).toUpperCase() || 'TG';
    const avatarBg = matchedChat?.avatarBg || '#2481cc';
    const avatarUrl = matchedChat?.avatarUrl || m.senderAvatarUrl;
    const recType: 'incoming' | 'outgoing' | 'missed' =
      m.callType === 'incoming' || m.callType === 'outgoing' || m.callType === 'missed'
        ? m.callType
        : m.sender === 'me'
          ? 'outgoing'
          : 'incoming';
    const duration =
      recType === 'missed'
        ? '未接通'
        : m.callDuration && m.callDuration > 0
          ? formatCallRecordDurationStr(m.callDuration)
          : m.sender === 'me'
            ? '未接听'
            : '00:00';
    const timestamp =
      m.timestamp ||
      new Date(m.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    let existingIdx = next.findIndex(
      (r) =>
        r.id === recId ||
        (Boolean(tgCallId) && r.telegramCallId === tgCallId && r.accountId === accId)
    );
    if (existingIdx < 0 && !tgCallId && !m.telegramMessageId) {
      existingIdx = next.findIndex(
        (r) =>
          !r.telegramCallId &&
          r.accountId === accId &&
          r.chatId === chatId &&
          r.timestamp === timestamp &&
          r.type === recType
      );
    }
    const entry: TelegramCallRecord = {
      id: recId,
      accountId: accId,
      ...(chatId ? { chatId } : {}),
      ...(tgCallId ? { telegramCallId: tgCallId } : {}),
      contactName,
      avatarBg,
      avatarInitial,
      ...(avatarUrl ? { avatarUrl } : {}),
      type: recType,
      duration,
      timestamp,
      isVideo: Boolean(m.isVideoCall),
    };

    if (existingIdx >= 0) {
      const ex = next[existingIdx];
      if (ex.duration !== entry.duration || ex.type !== entry.type || ex.contactName !== entry.contactName) {
        next[existingIdx] = { ...ex, ...entry };
        changed = true;
      }
    } else {
      next.unshift(entry);
      changed = true;
    }
  }

  return changed ? next.slice(0, 300) : prevRecords;
}

function getScopedTranslationSettingsKey(accountId?: string): string {
  const clean = typeof accountId === 'string' ? accountId.trim() : '';
  return clean ? `tg_pro_trans_settings::${clean}` : 'tg_pro_trans_settings';
}

function getScopedCallRecordsKey(accountId?: string): string {
  const clean = typeof accountId === 'string' ? accountId.trim() : '';
  return clean ? `tg_pro_call_records::${clean}` : '';
}

function loadScopedCallRecordsSync(accountId?: string): TelegramCallRecord[] {
  const clean = typeof accountId === 'string' ? accountId.trim() : '';
  if (!clean) return [];
  try {
    const scopedKey = getScopedCallRecordsKey(clean);
    const scopedSaved = scopedKey ? secureGetItemSync<TelegramCallRecord[]>(scopedKey) : null;
    if (Array.isArray(scopedSaved)) {
      return sanitizeCallRecords(scopedSaved).filter((rec) => rec.accountId === clean);
    }
    const legacySaved = secureGetItemSync<TelegramCallRecord[]>('tg_pro_call_records');
    if (Array.isArray(legacySaved)) {
      return sanitizeCallRecords(legacySaved).filter((rec) => rec.accountId === clean);
    }
  } catch {}
  return [];
}

async function loadScopedCallRecordsAsync(accountId?: string): Promise<TelegramCallRecord[]> {
  const clean = typeof accountId === 'string' ? accountId.trim() : '';
  if (!clean) return [];
  try {
    const scopedKey = getScopedCallRecordsKey(clean);
    const scopedSaved = scopedKey ? await secureGetItemAsync<TelegramCallRecord[]>(scopedKey) : null;
    if (Array.isArray(scopedSaved)) {
      return sanitizeCallRecords(scopedSaved).filter((rec) => rec.accountId === clean);
    }
    const legacySaved = await secureGetItemAsync<TelegramCallRecord[]>('tg_pro_call_records');
    if (Array.isArray(legacySaved)) {
      return sanitizeCallRecords(legacySaved).filter((rec) => rec.accountId === clean);
    }
  } catch {}
  return [];
}

const ALLOWED_CLOUD_TRANSLATE_MODELS = new Set([
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
]);

function normalizeCloudTranslateModel(rawModel?: unknown): string {
  const trimmed = typeof rawModel === 'string' ? rawModel.trim() : '';
  const lowered = trimmed.toLowerCase();
  if (
    !trimmed ||
    lowered === 'auto' ||
    lowered === 'fastest' ||
    lowered === 'cloud_auto' ||
    ALLOWED_CLOUD_TRANSLATE_MODELS.has(lowered) ||
    (lowered.includes('31b') && lowered.includes('gemma'))
  ) {
    return 'auto';
  }
  return 'auto';
}

function normalizeLoadedTranslationSettings(raw: any): TranslationSettings {
  if (!raw || typeof raw !== 'object') return INITIAL_TRANSLATION_SETTINGS;
  const rawEngine = raw.preferredEngine;
  const normalizedEngine: 'gemini' | 'google' | 'custom_llm' =
    rawEngine === 'google' || rawEngine === 'custom_llm' || rawEngine === 'gemini'
      ? rawEngine
      : 'gemini';
  const normalizedGemmaModel = normalizeCloudTranslateModel(raw.geminiModel);
  const merged: TranslationSettings = {
    ...INITIAL_TRANSLATION_SETTINGS,
    ...raw,
    autoTranslateGroups: raw.autoTranslateGroups === true,
    autoTranslatePrivate: raw.autoTranslatePrivate !== false,
    preferredEngine: normalizedEngine,
    geminiModel: normalizedGemmaModel,
  };
  delete (merged as any).success;
  delete (merged as any).config;
  delete (merged as any).settings;
  return merged;
}

export default function App() {
  // 1. Core State with LocalStorage Web Crypto AES-256 Encrypted Persistence
  const [accounts, setAccounts] = useState<Account[]>(() => {
    const saved = secureGetItemSync<Account[]>('tg_pro_accounts');
    if (saved && Array.isArray(saved)) {
      try {
        const cleaned = sanitizeAccounts(saved);
        return cleaned;
      } catch {
        return INITIAL_ACCOUNTS;
      }
    }
    return INITIAL_ACCOUNTS;
  });

  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>(() => {
    const saved = secureGetItemSync<AccountGroup[]>('tg_pro_account_groups');
    if (saved && Array.isArray(saved)) {
      return saved.filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string');
    }
    return [];
  });

  const [activeAccountId, setActiveAccountId] = useState<string>(() => {
    let resolved = accounts[0]?.id || '';
    try {
      const savedActive = localStorage.getItem('tg_pro_active_account_id') || '';
      if (savedActive && accounts.some((a) => a.id === savedActive)) {
        resolved = savedActive;
      }
      if (resolved && resolved !== savedActive) {
        setActiveApiAccount(resolved);
      }
    } catch {}
    return resolved;
  });

  const [chats, setChats] = useState<Chat[]>(() => {
    const saved = secureGetItemSync<Chat[]>('tg_pro_chats');
    if (saved && Array.isArray(saved)) {
      try {
        return sanitizeChats(saved);
      } catch {
        return INITIAL_CHATS;
      }
    }
    return INITIAL_CHATS;
  });

  const [chatOrderByAccount, setChatOrderByAccount] = useState<Record<string, string[]>>(() => {
    const saved = secureGetItemSync<Record<string, string[]>>('tg_pro_chat_order_map');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      const normalized: Record<string, string[]> = {};
      for (const [accId, list] of Object.entries(saved)) {
        if (accId && Array.isArray(list)) {
          normalized[accId] = list.filter((id) => typeof id === 'string' && id.length > 0);
        }
      }
      return normalized;
    }
    return {};
  });

  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>(() => {
    const initialMap: Record<string, Message[]> = {};
    const fallbackAcc = activeAccountId || accounts[0]?.id || '';
    for (const c of chats) {
      const acc = c.accountId || fallbackAcc;
      const localList = getLocalMessages(c.id, acc);
      if (localList.length > 0) {
        initialMap[msgBucketKey(acc, c.id)] = normalizeStalePendingMessages(localList);
      }
    }
    if (Object.keys(initialMap).length === 0) {
      const legacySaved = secureGetItemSync<Record<string, Message[]>>('tg_pro_messages');
      if (legacySaved && typeof legacySaved === 'object') {
        for (const [bucketKey, list] of Object.entries(legacySaved)) {
          if (Array.isArray(list) && list.length > 0) {
            const parts = bucketKey.includes('::') ? bucketKey.split('::') : [];
            const inferredAcc = parts.length > 1 ? parts[0] : (list[0]?.accountId || fallbackAcc);
            const inferredChat = parts.length > 1 ? parts.slice(1).join('::') : bucketKey;
            initialMap[bucketKey] = normalizeStalePendingMessages(
              list.filter((m) => m && m.id && !isMessageDeleted(m.id, inferredAcc || m.accountId, m.chatId || inferredChat))
            );
          }
        }
      }
    }
    return initialMap;
  });

  const [translationSettings, setTranslationSettings] = useState<TranslationSettings>(() => {
    const saved =
      secureGetItemSync<any>(getScopedTranslationSettingsKey(activeAccountId)) ??
      secureGetItemSync<any>('tg_pro_trans_settings');
    return normalizeLoadedTranslationSettings(saved);
  });
  const translationAccountScopeRef = useRef<string>(activeAccountId);

  const [customLLMConfig, setCustomLLMConfig] = useState<CustomLLMConfig>(() => {
    const saved = secureGetItemSync<CustomLLMConfig>('tg_pro_llm_config');
    if (!saved) return INITIAL_CUSTOM_LLM;
    return {
      ...saved,
      engineMode: saved.engineMode || (saved.baseUrl && !isBuiltInCloudGatewayUrl(saved.baseUrl) ? 'custom' : 'cloud'),
      baseUrl: isBuiltInCloudGatewayUrl(saved.baseUrl) ? '' : saved.baseUrl,
      knowledgeBaseApiUrl: isBuiltInCloudGatewayUrl(saved.knowledgeBaseApiUrl) ? '' : saved.knowledgeBaseApiUrl,
    };
  });

  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeRightPanel, setActiveRightPanel] = useState<RightPanelTab | null>(null);
  const [isChatInfoOpen, setIsChatInfoOpen] = useState(false);
  const [isChatMemoryOpen, setIsChatMemoryOpen] = useState(false);
  const [chatHasMoreMap, setChatHasMoreMap] = useState<Record<string, boolean>>({});

  const openRightPanel = (tab: RightPanelTab) => {
    setIsChatInfoOpen(false);
    setActiveRightPanel(tab);
  };

  const toggleRightPanel = (tab: RightPanelTab) => {
    setIsChatInfoOpen(false);
    setActiveRightPanel((prev) => (prev === tab ? null : tab));
  };

  const toggleChatMemoryPanel = () => {
    setIsChatInfoOpen(false);
    setActiveRightPanel(null);
    setIsChatMemoryOpen((prev) => !prev);
  };

  // 2. Modals & Drawers Visibility State
  const [isTelegramMenuOpen, setIsTelegramMenuOpen] = useState(false);
  const [theme, setTheme] = useState<AppThemeMode>(() => {
    const saved = localStorage.getItem('tg_pro_theme');
    return saved === 'dark' || saved === 'aurora' || saved === 'light' || saved === 'linen' ? saved : 'linen';
  });
  const [clientPrefs, setClientPrefs] = useState<TelegramClientPrefs>(() =>
    loadStoredClientPrefs(activeAccountId)
  );
  const clientPrefsScopeRef = useRef<string>(activeAccountId);
  const [isMultiAccountOpen, setIsMultiAccountOpen] = useState(false);
  const [reloginAccount, setReloginAccount] = useState<Account | null>(null);
  const [isDatabaseOpen, setIsDatabaseOpen] = useState(false);
  const [isSystemSettingsOpen, setIsSystemSettingsOpen] = useState(false);
  const [isMasterVoiceActive, setIsMasterVoiceActive] = useState(() => {
    const mv = getMasterVoiceprint();
    return !!mv?.enabledAsDefault;
  });

  // Telegram official feature modals state
  const [isNewGroupOpen, setIsNewGroupOpen] = useState(false);
  const [isNewChannelOpen, setIsNewChannelOpen] = useState(false);
  const [isContactsOpen, setIsContactsOpen] = useState(false);
  const [isCallsOpen, setIsCallsOpen] = useState(false);
  const [isTelegramSettingsOpen, setIsTelegramSettingsOpen] = useState(false);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateCheckResult | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [desktopUpdaterInfo, setDesktopUpdaterInfo] = useState<DesktopUpdaterInfo | null>(null);
  const [updaterState, setUpdaterState] = useState<DesktopUpdaterState>({ status: 'idle' });
  const hasCheckedUpdateOnBootRef = useRef(false);

  // Member authentication gate state (credentials & member count on server, chat data strictly local)
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isMemberAuthenticated, setIsMemberAuthenticated] = useState(false);
  const [currentMember, setCurrentMember] = useState<MemberUser | null>(null);
  const [totalMembersCount, setTotalMembersCount] = useState<number>(0);
  const [authPromptState, setAuthPromptState] = useState<{
    initialTab?: 'login' | 'register' | 'redeem';
    initialError?: string | null;
  }>({});
  const pendingAutoSelectAccountRef = useRef<string | null>(null);

  const pendingMediaFilesRef = useRef<Map<string, File | Blob>>(new Map());
  const pendingMediaSaveMapRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const restoredBlobUrlsRef = useRef<Map<string, string>>(new Map());
  const deletedAccountIdsRef = useRef<Set<string>>(new Set());
  const scheduleRevokeBlobUrls = (urls: Array<string | undefined | null>) => {
    const blobUrls = urls.filter((u): u is string => typeof u === 'string' && u.startsWith('blob:'));
    if (blobUrls.length === 0) return;
    setTimeout(() => {
      blobUrls.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      });
    }, 1500);
  };
  const getOrCreateRestoredBlobUrl = (
    accountId: string,
    messageId: string,
    mediaField: PendingMediaField,
    blob: Blob
  ): string => {
    const cacheKey = `${accountId || 'default'}::${messageId}::${mediaField}`;
    const existing = restoredBlobUrlsRef.current.get(cacheKey);
    if (existing) return existing;
    const nextUrl = URL.createObjectURL(blob);
    restoredBlobUrlsRef.current.set(cacheKey, nextUrl);
    return nextUrl;
  };
  const revokeRestoredBlobUrlsForMessage = (accountId: string, messageId: string) => {
    const prefix = `${accountId || 'default'}::${messageId}::`;
    const toRevoke: string[] = [];
    for (const [key, url] of Array.from(restoredBlobUrlsRef.current.entries())) {
      if (key.startsWith(prefix)) {
        toRevoke.push(url);
        restoredBlobUrlsRef.current.delete(key);
      }
    }
    if (toRevoke.length > 0) {
      scheduleRevokeBlobUrls(toRevoke);
    }
  };
  const cleanupPersistedPendingMedia = async (accountId: string, messageId: string) => {
    const inflight = pendingMediaSaveMapRef.current.get(messageId);
    if (inflight) {
      await inflight.catch(() => {});
      pendingMediaSaveMapRef.current.delete(messageId);
    }
    await deletePendingMediaBlob(accountId, messageId);
  };
  const hydrateBucketPendingMedia = async (accountId: string, chatId: string) => {
    if (!chatId) return;
    const records = await listChatPendingMediaBlobs(accountId, chatId);
    if (records.length === 0) return;

    const byMsgId = new Map(records.map((r) => [r.messageId, r]));
    const bKey = msgBucketKey(accountId, chatId);
    const deliveredToClean: string[] = [];

    setMessagesMap((prev) => {
      const currentList = getBucketMessages(prev, accountId, chatId);
      if (currentList.length === 0) return prev;
      let changed = false;
      const nextList = currentList.map((m) => {
        const rec = byMsgId.get(m.id);
        if (!rec) return m;
        if (m.deliveryStatus === 'delivered') {
          deliveredToClean.push(m.id);
          return m;
        }
        if (!pendingMediaFilesRef.current.has(m.id)) {
          pendingMediaFilesRef.current.set(m.id, rec.blob);
        }
        if (!m[rec.mediaField]) {
          const restoredUrl = getOrCreateRestoredBlobUrl(accountId, m.id, rec.mediaField, rec.blob);
          changed = true;
          return { ...m, [rec.mediaField]: restoredUrl };
        }
        return m;
      });
      if (!changed) return prev;
      return { ...prev, [bKey]: nextList };
    });

    for (const deliveredId of deliveredToClean) {
      pendingMediaFilesRef.current.delete(deliveredId);
      void cleanupPersistedPendingMedia(accountId, deliveredId);
    }
  };
  const [offlineReasonByAccount, setOfflineReasonByAccount] = useState<Record<string, string>>({});
  const [bannerVisibleByAccount, setBannerVisibleByAccount] = useState<Record<string, boolean>>({});
  const transientDisconnectSinceRef = useRef<Record<string, number>>({});
  const graceSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isMemberAuthenticatedRef = useRef(isMemberAuthenticated);
  isMemberAuthenticatedRef.current = isMemberAuthenticated;
  const accountsRef = useRef<Account[]>(accounts);
  accountsRef.current = accounts;
  const [isReconnectingAccount, setIsReconnectingAccount] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (graceSyncTimerRef.current) {
        clearTimeout(graceSyncTimerRef.current);
        graceSyncTimerRef.current = null;
      }
    };
  }, []);

  // Telegram contacts (strictly scoped by account & AES-encrypted, zero mock defaults) and real call history state
  const [contacts, setContacts] = useState<TelegramContact[]>(() => {
    return getScopedContacts(activeAccountId || accounts[0]?.id || '');
  });
  const [foldersByAccount, setFoldersByAccount] = useState<Record<string, TelegramOfficialDialogFilter[]>>({});
  const [telegramSettingsRefreshNonce, setTelegramSettingsRefreshNonce] = useState(0);

  const initialCallsAccId = activeAccountId || accounts[0]?.id || '';
  const callRecordsScopeRef = useRef<string>(initialCallsAccId);
  const [callRecords, setCallRecords] = useState<TelegramCallRecord[]>(() => {
    return loadScopedCallRecordsSync(initialCallsAccId);
  });

  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (!isHydrated) return;
    const targetAcc = activeAccountIdRef.current;
    if (!targetAcc || callRecordsScopeRef.current !== targetAcc) return;
    const scopedKey = getScopedCallRecordsKey(targetAcc);
    if (!scopedKey) return;
    try {
      const scopedRecords = sanitizeCallRecords(callRecords).filter((rec) => rec.accountId === targetAcc);
      secureSetItemSync(scopedKey, scopedRecords);
      const legacyCalls = secureGetItemSync<TelegramCallRecord[]>('tg_pro_call_records');
      if (Array.isArray(legacyCalls)) {
        const remainingLegacy = legacyCalls.filter((rec) => rec && rec.accountId !== targetAcc);
        if (remainingLegacy.length === 0) {
          secureRemoveItem('tg_pro_call_records');
        } else if (remainingLegacy.length !== legacyCalls.length) {
          secureSetItemSync('tg_pro_call_records', remainingLegacy);
        }
      }
    } catch {}
  }, [callRecords, isHydrated]);

  // Keep Master Voiceprint state reactively synchronized
  useEffect(() => {
    const handleVoiceprintChange = (e: any) => {
      const mv = e.detail || getMasterVoiceprint();
      setIsMasterVoiceActive(!!mv?.enabledAsDefault);
    };
    window.addEventListener('tg_voiceprint_updated', handleVoiceprintChange);
    return () => window.removeEventListener('tg_voiceprint_updated', handleVoiceprintChange);
  }, []);

  // Cloud Action Error Toast (Non-blocking UI alert for Telegram cloud sync errors)
  const [cloudActionToast, setCloudActionToast] = useState<string | null>(null);
  const cloudToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCloudError = (msg: string) => {
    if (cloudToastTimerRef.current) clearTimeout(cloudToastTimerRef.current);
    setCloudActionToast(msg);
    cloudToastTimerRef.current = setTimeout(() => {
      setCloudActionToast(null);
      cloudToastTimerRef.current = null;
    }, 4500);
  };
  useEffect(() => {
    return () => {
      if (cloudToastTimerRef.current) clearTimeout(cloudToastTimerRef.current);
    };
  }, []);

  const isTelegramCloudChat = (chatId?: string | null) =>
    Boolean(
      (chatId && chatId.startsWith('tg_')) ||
        activeAccountId.startsWith('acc_tg_') ||
        activeAccountId === 'acc_telegram_bot'
    );

  // Sync theme to DOM and localStorage
  useEffect(() => {
    localStorage.setItem('tg_pro_theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark' || theme === 'aurora');
    document.documentElement.classList.toggle('theme-aurora', theme === 'aurora');
    document.documentElement.classList.toggle('theme-linen', theme === 'linen');
  }, [theme]);

  useEffect(() => {
    const targetAcc = activeAccountIdRef.current;
    if (clientPrefsScopeRef.current !== targetAcc) return;
    try {
      localStorage.setItem(getScopedClientPrefsStorageKey(targetAcc), JSON.stringify(clientPrefs));
    } catch {}
  }, [clientPrefs]);

  const rehydrateFromLocalStorage = async (isRestore = false) => {
    try {
      const [savedAccs, savedGroups, savedChats, savedChatOrder, savedMsgs, savedLegacyTrans, savedLLM] = await Promise.all([
        secureGetItemAsync<Account[]>('tg_pro_accounts'),
        secureGetItemAsync<AccountGroup[]>('tg_pro_account_groups'),
        secureGetItemAsync<Chat[]>('tg_pro_chats'),
        secureGetItemAsync<Record<string, string[]>>('tg_pro_chat_order_map'),
        secureGetItemAsync<Record<string, Message[]>>('tg_pro_messages'),
        secureGetItemAsync<TranslationSettings>('tg_pro_trans_settings'),
        secureGetItemAsync<CustomLLMConfig>('tg_pro_llm_config'),
      ]);

      if (savedGroups && Array.isArray(savedGroups)) {
        setAccountGroups(savedGroups.filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string'));
      }
      if (savedChatOrder && typeof savedChatOrder === 'object' && !Array.isArray(savedChatOrder)) {
        const normalizedOrder: Record<string, string[]> = {};
        for (const [accId, list] of Object.entries(savedChatOrder)) {
          if (accId && Array.isArray(list)) {
            normalizedOrder[accId] = list.filter((id) => typeof id === 'string' && id.length > 0);
          }
        }
        setChatOrderByAccount(normalizedOrder);
      }

      let nextAccounts: Account[] | null = null;
      let resolvedActiveAccId = activeAccountId;
      if (savedAccs && Array.isArray(savedAccs) && savedAccs.length > 0) {
        const sanitized = sanitizeAccounts(savedAccs);
        nextAccounts = sanitized;
        setAccounts(sanitized);
        const restoredActiveId = localStorage.getItem('tg_pro_active_account_id') || '';
        const candidateId =
          isRestore && restoredActiveId && sanitized.some((a) => a.id === restoredActiveId)
            ? restoredActiveId
            : sanitized.some((a) => a.id === resolvedActiveAccId)
              ? resolvedActiveAccId
              : sanitized[0].id;
        resolvedActiveAccId = candidateId;
        setActiveAccountId(candidateId);
        setActiveApiAccount(candidateId);
      }

      const savedScopedTrans = resolvedActiveAccId
        ? await secureGetItemAsync<TranslationSettings>(getScopedTranslationSettingsKey(resolvedActiveAccId)).catch(() => null)
        : null;
      const savedTrans = savedScopedTrans || savedLegacyTrans;

      let nextChats: Chat[] | null = null;
      if (savedChats && Array.isArray(savedChats) && savedChats.length > 0) {
        nextChats = sanitizeChats(savedChats);
        setChats(nextChats);
      }

      const deletedKeySet = new Set<string>([
        getDeletedMessageStorageKey(''),
        ...(resolvedActiveAccId ? [getDeletedMessageStorageKey(resolvedActiveAccId)] : []),
        ...((nextAccounts || accounts || []).map((a) => getDeletedMessageStorageKey(a.id))),
      ]);
      await Promise.all(
        Array.from(deletedKeySet).map((delKey) => secureGetItemAsync<string[]>(delKey).catch(() => null))
      );
      const hydratedVoiceprint = await hydrateMasterVoiceprint();
      if (hydratedVoiceprint) {
        setIsMasterVoiceActive(!!hydratedVoiceprint.enabledAsDefault);
      }

      const reconstructed: Record<string, Message[]> = {};
      const chatsToScan = nextChats || chatsRef.current;
      for (const c of chatsToScan) {
        const acc = c.accountId || resolvedActiveAccId || activeAccountIdRef.current;
        const scopedKey = acc ? `tg_desktop_msgs_${acc}_${c.id}` : `tg_desktop_msgs_${c.id}`;
        let msgs = await secureGetItemAsync<Message[]>(scopedKey);
        if ((!msgs || msgs.length === 0) && acc) {
          const legacy = await secureGetItemAsync<Message[]>(`tg_desktop_msgs_${c.id}`);
          if (Array.isArray(legacy)) {
            msgs = legacy.filter((m) => m.accountId === acc);
          }
        }
        if (Array.isArray(msgs) && msgs.length > 0) {
          reconstructed[msgBucketKey(acc, c.id)] = normalizeStalePendingMessages(
            msgs.filter(
              (m) => m && m.id && !isMessageDeleted(m.id, acc, m.chatId || c.id) && (!acc || m.accountId === acc)
            )
          );
        }
      }

      if (savedMsgs && typeof savedMsgs === 'object' && Object.keys(savedMsgs).length > 0) {
        for (const [bucketKey, list] of Object.entries(savedMsgs)) {
          if (!Array.isArray(list) || list.length === 0) continue;
          const parts = bucketKey.includes('::') ? bucketKey.split('::') : [];
          const acc = parts.length > 1 ? parts[0] : (list[0]?.accountId || resolvedActiveAccId || activeAccountIdRef.current);
          const chatKey = parts.length > 1 ? parts.slice(1).join('::') : bucketKey;
          const normalizedList = normalizeStalePendingMessages(
            list.filter((m) => m && m.id && !isMessageDeleted(m.id, acc || m.accountId, m.chatId || chatKey))
          );
          if (normalizedList.length > 0 && (!reconstructed[bucketKey] || reconstructed[bucketKey].length === 0)) {
            reconstructed[bucketKey] = normalizedList;
            setLocalMessages(chatKey, normalizedList, acc);
          }
        }
        try {
          secureRemoveItem('tg_pro_messages');
        } catch {}
      }

      if (isRestore) {
        const curChatId = activeChatIdRef.current;
        const curAccId = resolvedActiveAccId || activeAccountIdRef.current;
        if (curChatId) {
          const localMsgs = getLocalMessages(curChatId, curAccId);
          if (localMsgs.length > 0) {
            reconstructed[msgBucketKey(curAccId, curChatId)] = normalizeStalePendingMessages(localMsgs);
          }
        }
      }

      if (Object.keys(reconstructed).length > 0 || isRestore) {
        setMessagesMap(reconstructed);
        for (const [bKey, list] of Object.entries(reconstructed)) {
          const hasPendingMedia =
            Array.isArray(list) &&
            list.some(
              (m) =>
                m &&
                (m.deliveryStatus === 'failed' ||
                  m.deliveryStatus === 'pending' ||
                  m.deliveryStatus === 'retrying') &&
                (m.isImage || m.isVideo || m.isAudio || m.isFile)
            );
          if (hasPendingMedia) {
            const sepIdx = bKey.indexOf('::');
            const bAcc = sepIdx >= 0 ? bKey.slice(0, sepIdx) : resolvedActiveAccId;
            const bChat = sepIdx >= 0 ? bKey.slice(sepIdx + 2) : bKey;
            void hydrateBucketPendingMedia(bAcc, bChat);
          }
        }
      }

      const rawSavedLlm =
        savedLLM && typeof savedLLM === 'object' && (savedLLM as any).config && typeof (savedLLM as any).config === 'object'
          ? (savedLLM as any).config
          : savedLLM;

      const rawSavedTrans =
        savedTrans && typeof savedTrans === 'object' && (savedTrans as any).settings && typeof (savedTrans as any).settings === 'object'
          ? (savedTrans as any).settings
          : savedTrans;

      let serverLlmUnwrapped: any = null;
      let serverTransUnwrapped: any = null;
      if (isRestore) {
        const [srvLlmRes, srvTransRes] = await Promise.all([
          rawSavedLlm ? fetchCustomLLMConfigApi().catch(() => null) : Promise.resolve(null),
          rawSavedTrans ? fetchTranslationSettingsApi(resolvedActiveAccId).catch(() => null) : Promise.resolve(null),
        ]);
        if (srvLlmRes && typeof srvLlmRes === 'object') {
          serverLlmUnwrapped =
            (srvLlmRes as any).config && typeof (srvLlmRes as any).config === 'object'
              ? (srvLlmRes as any).config
              : srvLlmRes;
        }
        if (srvTransRes && typeof srvTransRes === 'object') {
          serverTransUnwrapped =
            (srvTransRes as any).settings && typeof (srvTransRes as any).settings === 'object'
              ? (srvTransRes as any).settings
              : srvTransRes;
        }
      }

      const normalizedSavedLlm: CustomLLMConfig | null = rawSavedLlm
        ? {
            ...INITIAL_CUSTOM_LLM,
            ...rawSavedLlm,
            apiKey:
              (typeof rawSavedLlm.apiKey === 'string' && rawSavedLlm.apiKey.trim()) ||
              (isRestore && typeof serverLlmUnwrapped?.apiKey === 'string' ? serverLlmUnwrapped.apiKey : '') ||
              '',
            knowledgeBaseApiKey:
              (typeof rawSavedLlm.knowledgeBaseApiKey === 'string' && rawSavedLlm.knowledgeBaseApiKey.trim()) ||
              (isRestore && typeof serverLlmUnwrapped?.knowledgeBaseApiKey === 'string'
                ? serverLlmUnwrapped.knowledgeBaseApiKey
                : '') ||
              '',
            engineLicenseKey:
              (typeof rawSavedLlm.engineLicenseKey === 'string' && rawSavedLlm.engineLicenseKey.trim()) ||
              (isRestore && typeof serverLlmUnwrapped?.engineLicenseKey === 'string'
                ? serverLlmUnwrapped.engineLicenseKey
                : '') ||
              '',
            ...(isRestore && !rawSavedLlm.apiKey && serverLlmUnwrapped?.hasApiKey ? { hasApiKey: true } : {}),
            ...(isRestore && !rawSavedLlm.knowledgeBaseApiKey && serverLlmUnwrapped?.hasKnowledgeBaseApiKey
              ? { hasKnowledgeBaseApiKey: true }
              : {}),
            ...(isRestore && !rawSavedLlm.engineLicenseKey && serverLlmUnwrapped?.hasEngineLicenseKey
              ? { hasEngineLicenseKey: true }
              : {}),
            explicitlyDisabled: rawSavedLlm.enabled === false ? true : Boolean(rawSavedLlm.explicitlyDisabled),
            engineMode:
              rawSavedLlm.engineMode ||
              (rawSavedLlm.baseUrl && !isBuiltInCloudGatewayUrl(rawSavedLlm.baseUrl) ? 'custom' : 'cloud'),
            baseUrl: isBuiltInCloudGatewayUrl(rawSavedLlm.baseUrl) ? '' : rawSavedLlm.baseUrl,
            knowledgeBaseApiUrl: isBuiltInCloudGatewayUrl(rawSavedLlm.knowledgeBaseApiUrl)
              ? ''
              : rawSavedLlm.knowledgeBaseApiUrl,
          }
        : null;

      if (normalizedSavedLlm) {
        delete (normalizedSavedLlm as any).success;
        delete (normalizedSavedLlm as any).config;
        delete (normalizedSavedLlm as any).settings;
        setCustomLLMConfig(normalizedSavedLlm);
      }

      if (rawSavedTrans) {
        const rawEngine = (rawSavedTrans as any).preferredEngine;
        const normalizedEngine: 'gemini' | 'google' | 'custom_llm' =
          rawEngine === 'google' || rawEngine === 'custom_llm' || rawEngine === 'gemini' ? rawEngine : 'gemini';
        const normalizedGemmaModel = normalizeCloudTranslateModel((rawSavedTrans as any).geminiModel);
        const mergedTrans: TranslationSettings = {
          ...INITIAL_TRANSLATION_SETTINGS,
          ...rawSavedTrans,
          ...(isRestore && !rawSavedTrans.geminiApiKey && serverTransUnwrapped?.geminiApiKey
            ? {
                geminiApiKey: serverTransUnwrapped.geminiApiKey,
                hasGeminiApiKey: Boolean(serverTransUnwrapped.hasGeminiApiKey),
              }
            : {}),
          ...(isRestore && !rawSavedTrans.googleApiKey && serverTransUnwrapped?.googleApiKey
            ? {
                googleApiKey: serverTransUnwrapped.googleApiKey,
                hasGoogleApiKey: Boolean(serverTransUnwrapped.hasGoogleApiKey),
              }
            : {}),
          preferredEngine: normalizedEngine,
          geminiModel: normalizedGemmaModel,
        };
        delete (mergedTrans as any).success;
        delete (mergedTrans as any).config;
        delete (mergedTrans as any).settings;
        translationAccountScopeRef.current = resolvedActiveAccId;
        setTranslationSettings(
          normalizedSavedLlm ? enforceTranslationEngineForLlm(normalizedSavedLlm, mergedTrans) : mergedTrans
        );
      } else if (normalizedSavedLlm) {
        translationAccountScopeRef.current = resolvedActiveAccId;
        setTranslationSettings((prev) => enforceTranslationEngineForLlm(normalizedSavedLlm, prev));
      }

      const callsAccId = resolvedActiveAccId || activeAccountIdRef.current || nextAccounts?.[0]?.id || '';
      const hydratedCalls = await loadScopedCallRecordsAsync(callsAccId);
      if (callsAccId) {
        callRecordsScopeRef.current = callsAccId;
        setCallRecords(hydratedCalls);
      }

      if (isRestore) {
        setContacts(getScopedContacts(resolvedActiveAccId || activeAccountIdRef.current));
        const savedTheme = localStorage.getItem('tg_pro_theme');
        if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'aurora' || savedTheme === 'linen') {
          setTheme(savedTheme);
        }
        const prefsAccId = resolvedActiveAccId || activeAccountIdRef.current || nextAccounts?.[0]?.id || '';
        clientPrefsScopeRef.current = prefsAccId;
        setClientPrefs(loadStoredClientPrefs(prefsAccId));
        const mv = (await hydrateMasterVoiceprint()) || getMasterVoiceprint();
        setIsMasterVoiceActive(!!mv?.enabledAsDefault);

        const curChatId = activeChatIdRef.current;
        const curAccId = resolvedActiveAccId || activeAccountIdRef.current || nextAccounts?.[0]?.id;
        if (curChatId) {
          const restoredProfile = getLocalCustomerProfile(curChatId, curAccId);
          setCustomerProfile(restoredProfile);
        }
      }
    } catch (err) {
      console.warn('Hydration exception:', err);
    }
  };

  const prevPersistedMessagesMapRef = useRef<Record<string, Message[]>>({});

  // Hydrate encrypted local storage data asynchronously to guarantee zero data loss
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await rehydrateFromLocalStorage(false);
      } finally {
        if (active) setIsHydrated(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Sync to encrypted local storage strictly AFTER hydration is verified, preventing default overwrite
  useEffect(() => {
    if (!isHydrated) return;
    secureSetItemSync('tg_pro_accounts', accounts);
  }, [accounts, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    secureSetItemSync('tg_pro_account_groups', accountGroups);
  }, [accountGroups, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    secureSetItemSync('tg_pro_chats', chats);
  }, [chats, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    secureSetItemSync('tg_pro_chat_order_map', chatOrderByAccount);
  }, [chatOrderByAccount, isHydrated]);

  // Post-commit message bucket persistence & unified cleanup (eliminates StrictMode double-writes & updater side-effects)
  useEffect(() => {
    if (!isHydrated) return;
    const prevMap = prevPersistedMessagesMapRef.current;
    const parseBucketKey = (bKey: string) => {
      const sepIdx = bKey.indexOf('::');
      const bAcc = sepIdx >= 0 ? bKey.slice(0, sepIdx) : activeAccountIdRef.current;
      const bChat = sepIdx >= 0 ? bKey.slice(sepIdx + 2) : bKey;
      return { bAcc, bChat };
    };

    for (const [bKey, list] of Object.entries(messagesMap)) {
      if (prevMap[bKey] !== list && Array.isArray(list)) {
        const { bAcc, bChat } = parseBucketKey(bKey);
        if (list.length === 0) {
          if (
            Array.isArray(prevMap[bKey]) &&
            prevMap[bKey].length > 0 &&
            !deletedAccountIdsRef.current.has(bAcc)
          ) {
            clearLocalMessages(bChat, prevMap[bKey], bAcc);
          }
        } else {
          setLocalMessages(bChat, list, bAcc);
        }
      }
    }

    for (const removedKey of Object.keys(prevMap)) {
      if (!(removedKey in messagesMap)) {
        const { bAcc, bChat } = parseBucketKey(removedKey);
        if (!deletedAccountIdsRef.current.has(bAcc)) {
          clearLocalMessages(
            bChat,
            Array.isArray(prevMap[removedKey]) ? prevMap[removedKey] : [],
            bAcc
          );
        }
      }
    }

    prevPersistedMessagesMapRef.current = messagesMap;
  }, [messagesMap, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    const targetAcc = activeAccountIdRef.current;
    if (translationAccountScopeRef.current !== targetAcc) return;
    secureSetItemSync(getScopedTranslationSettingsKey(targetAcc), translationSettings);
    if (isMemberAuthenticated) {
      syncTranslationSettingsApi(translationSettings, targetAcc).catch(() => {});
    }
  }, [translationSettings, isHydrated, isMemberAuthenticated]);

  const startupReconnectInFlightRef = useRef<boolean>(false);
  const startupReconnectPromiseRef = useRef<Promise<void> | null>(null);
  const triggerAccountDialogRefreshRef = useRef<((targetAccId?: string, opts?: { force?: boolean }) => Promise<void>) | null>(null);

  const runHandshakeTelegramReconnect = () => {
    if (startupReconnectPromiseRef.current) return startupReconnectPromiseRef.current;
    startupReconnectInFlightRef.current = true;
    const task = (async () => {
      try {
        const reconRes = await reconnectTelegramSessionsApi(false, false);
        await syncTelegramAccountStatus();
        const curAcc = activeAccountIdRef.current;
        const curAccObj = curAcc ? accountsRef.current.find((a) => a.id === curAcc) : undefined;
        const curIdentity = resolveTelegramAccountIdentity({ id: curAcc, phone: curAccObj?.phone });
        if (reconRes.ok && (reconRes.restoredCount || 0) > 0 && curAcc && curIdentity.isPersonalTelegram) {
          void triggerAccountDialogRefreshRef.current?.(curAcc);
        }
      } catch {
      } finally {
        startupReconnectInFlightRef.current = false;
        startupReconnectPromiseRef.current = null;
        await syncTelegramAccountStatus().catch(() => {});
      }
    })();
    startupReconnectPromiseRef.current = task;
    return task;
  };

  // Verify member session on mount before unlocking workspace & starting API sync
  useEffect(() => {
    let active = true;
    async function verifySession() {
      try {
        const handshake = await initSessionHandshake();
        const status = await fetchAuthStatus();
        if (!active) return;
        const storedUser = getStoredMemberUser();
        setTotalMembersCount(status.totalMembers || 0);
        if ((handshake.authenticated && handshake.user) || (status.authenticated && status.user)) {
          const authUser = (handshake.authenticated && handshake.user ? handshake.user : status.user) || null;
          setCurrentMember(storedUser && authUser ? { ...storedUser, ...authUser } : authUser);
          const targetAcc = activeAccountIdRef.current;
          const hasLocalLlm = Boolean(secureGetItemSync<CustomLLMConfig>('tg_pro_llm_config'));
          const hasLocalTrans = Boolean(
            secureGetItemSync<TranslationSettings>(getScopedTranslationSettingsKey(targetAcc)) ||
              secureGetItemSync<TranslationSettings>('tg_pro_trans_settings')
          );
          let resolvedLlm: CustomLLMConfig | null = null;
          if (!hasLocalLlm || !hasLocalTrans) {
            const [serverLlm, serverTrans] = await Promise.all([
              !hasLocalLlm ? fetchCustomLLMConfigApi() : Promise.resolve(null),
              !hasLocalTrans ? fetchTranslationSettingsApi(targetAcc) : Promise.resolve(null),
            ]);
            if (!active) return;
            if (serverLlm && !hasLocalLlm) {
              const unwrappedLlm: any =
                (serverLlm as any).config && typeof (serverLlm as any).config === 'object'
                  ? (serverLlm as any).config
                  : serverLlm;
              const nextResolvedLlm: CustomLLMConfig = {
                ...INITIAL_CUSTOM_LLM,
                ...unwrappedLlm,
                explicitlyDisabled: unwrappedLlm.enabled === false ? true : Boolean(unwrappedLlm.explicitlyDisabled),
                engineMode:
                  unwrappedLlm.engineMode ||
                  (unwrappedLlm.baseUrl && !isBuiltInCloudGatewayUrl(unwrappedLlm.baseUrl) ? 'custom' : 'cloud'),
                baseUrl: isBuiltInCloudGatewayUrl(unwrappedLlm.baseUrl) ? '' : (unwrappedLlm.baseUrl || ''),
                knowledgeBaseApiUrl: '',
              };
              delete (nextResolvedLlm as any).success;
              delete (nextResolvedLlm as any).config;
              delete (nextResolvedLlm as any).settings;
              resolvedLlm = nextResolvedLlm;
              setCustomLLMConfig(nextResolvedLlm);
            }
            if (serverTrans && !hasLocalTrans) {
              const unwrappedTrans: any =
                (serverTrans as any).settings && typeof (serverTrans as any).settings === 'object'
                  ? (serverTrans as any).settings
                  : serverTrans;
              const rawEngine = unwrappedTrans?.preferredEngine;
              const normalizedEngine: 'gemini' | 'google' | 'custom_llm' =
                rawEngine === 'google' || rawEngine === 'custom_llm' || rawEngine === 'gemini'
                  ? rawEngine
                  : 'gemini';
              const normalizedGemmaModel = normalizeCloudTranslateModel(unwrappedTrans?.geminiModel);
              const mergedServerTrans: TranslationSettings = {
                ...INITIAL_TRANSLATION_SETTINGS,
                ...unwrappedTrans,
                preferredEngine: normalizedEngine,
                geminiModel: normalizedGemmaModel,
              };
              delete (mergedServerTrans as any).success;
              delete (mergedServerTrans as any).config;
              delete (mergedServerTrans as any).settings;
              translationAccountScopeRef.current = activeAccountIdRef.current;
              setTranslationSettings((prev) =>
                enforceTranslationEngineForLlm(resolvedLlm || customLLMConfigRef.current, { ...prev, ...mergedServerTrans })
              );
            }
          }
          startupReconnectInFlightRef.current = true;
          setIsMemberAuthenticated(true);
          void runHandshakeTelegramReconnect();
          setCustomLLMConfig((prev) =>
            !prev.enabled && !prev.explicitlyDisabled && prev.engineMode !== 'custom' && !prev.baseUrl?.trim()
              ? { ...prev, enabled: true, explicitlyDisabled: false, engineMode: 'cloud', enableKnowledgeBaseRAG: true }
              : prev
          );
        } else {
          setIsMemberAuthenticated(false);
          setCurrentMember(null);
          const errCode = handshake.code || status.authErrorCode;
          const errMsg = handshake.message || status.authErrorMessage;
          if (errCode === 'VIP_EXPIRED' || errCode === 'DEVICE_MISMATCH' || errCode === 'AUTH_SESSION_REVOKED') {
            setAuthPromptState({
              initialTab: errCode === 'VIP_EXPIRED' ? 'redeem' : 'login',
              initialError: errMsg || null,
            });
          }
        }
      } catch {
        if (active) setIsMemberAuthenticated(false);
      } finally {
        if (active) setIsAuthChecking(false);
      }
    }
    verifySession();
    return () => {
      active = false;
    };
  }, []);

  // Listen for runtime 401/403 member token/VIP expiration events across all API calls
  useEffect(() => {
    const onMemberAuthExpired = (e: Event) => {
      const detail = (e as CustomEvent)?.detail || {};
      const code = String(detail.code || '');
      const message = typeof detail.message === 'string' ? detail.message : '会员登录已过期，请重新登录或续费卡密';
      setIsMemberAuthenticated(false);
      setCurrentMember(null);
      setAuthPromptState({
        initialTab: code === 'VIP_EXPIRED' ? 'redeem' : 'login',
        initialError: message,
      });
    };
    window.addEventListener('hs_member_auth_expired', onMemberAuthExpired);
    return () => window.removeEventListener('hs_member_auth_expired', onMemberAuthExpired);
  }, []);

  const notifiedExpiredRef = useRef<Set<string>>(new Set());

  const handleMemberLogout = async () => {
    await adminLogout({ revokeTelegramSessions: true });
    prevPersistedMessagesMapRef.current = {};
    pendingMediaFilesRef.current.clear();
    pendingMediaSaveMapRef.current.clear();
    scheduleRevokeBlobUrls(Array.from(restoredBlobUrlsRef.current.values()));
    restoredBlobUrlsRef.current.clear();
    purgeAllLocalChatData();
    secureRemoveItem('tg_pro_account_groups');
    secureRemoveItem('tg_pro_chat_order_map');
    notifiedExpiredRef.current.clear();
    if (graceSyncTimerRef.current) {
      clearTimeout(graceSyncTimerRef.current);
      graceSyncTimerRef.current = null;
    }
    transientDisconnectSinceRef.current = {};
    setBannerVisibleByAccount({});
    setOfflineReasonByAccount({});
    setAccounts([]);
    setAccountGroups([]);
    setChats([]);
    setChatOrderByAccount({});
    setMessagesMap({});
    setContacts([]);
    callRecordsScopeRef.current = '';
    setCallRecords([]);
    clientPrefsScopeRef.current = '';
    setClientPrefs({ ...DEFAULT_TELEGRAM_CLIENT_PREFS });
    setActiveAccountId('');
    setActiveApiAccount('');
    setActiveChatId(null);
    setCustomerProfile(null);
    setIsMemberAuthenticated(false);
    setCurrentMember(null);
    setIsTelegramMenuOpen(false);
    try {
      const status = await fetchAuthStatus();
      setTotalMembersCount(status.totalMembers || 0);
    } catch {}
  };

  useEffect(() => {
    if (!isHydrated) return;
    secureSetItemSync('tg_pro_llm_config', customLLMConfig);
    if (isMemberAuthenticated) {
      syncCustomLLMConfigApi(customLLMConfig).catch(() => {});
    }
  }, [customLLMConfig, isHydrated, isMemberAuthenticated]);

  useEffect(() => {
    if (!isHydrated) return;
    setTranslationSettings((prev) => enforceTranslationEngineForLlm(customLLMConfig, prev));
  }, [
    isHydrated,
    customLLMConfig.enabled,
    customLLMConfig.explicitlyDisabled,
    customLLMConfig.engineMode,
    translationSettings.preferredEngine,
  ]);

  const markAccountExpiredUi = (accId: string, errorReason?: string) => {
    if (!accId) return;
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === accId ? { ...a, status: 'expired', bio: '会话已失效，请重新登录' } : a
      )
    );
    if (!notifiedExpiredRef.current.has(accId)) {
      notifiedExpiredRef.current.add(accId);
      showCloudError(errorReason || 'Telegram 登录会话已失效，请重新扫码或验证码登录');
    }
  };

  const syncTelegramAccountStatus = async () => {
    const [activeAccs, statusRes] = await Promise.all([
      fetchTelegramActiveAccounts(),
      fetchTelegramUserStatusApi(),
    ]);
    if (!isMountedRef.current || !isMemberAuthenticatedRef.current) {
      return;
    }

    const now = Date.now();
    let earliestGraceCheckMs: number | null = null;
    const recordGraceDelay = (delayMs: number | null) => {
      if (delayMs === null) return;
      if (earliestGraceCheckMs === null || delayMs < earliestGraceCheckMs) {
        earliestGraceCheckMs = delayMs;
      }
    };

    const resolvePhase = (raw: {
      status?: string;
      isConnected?: boolean;
      isConnecting?: boolean;
      isReconnecting?: boolean;
      isInMemoryConnected?: boolean;
    }): TelegramConnectionPhase => {
      if (raw.status === 'expired') return 'expired';
      if (raw.status === 'online' || raw.isConnected) return 'online';
      if (raw.status === 'restoring') return 'restoring';
      if (raw.status === 'reconnecting' || raw.isReconnecting) return 'reconnecting';
      if (raw.status === 'connecting' || raw.isConnecting) return 'connecting';
      if (raw.status === 'offline') {
        // Explicit per-account offline from backend must not be overwritten by another account's global restore
        return 'offline';
      }
      if (statusRes.isRestoringSessions || startupReconnectInFlightRef.current) {
        return 'restoring';
      }
      if (raw.isInMemoryConnected) return 'reconnecting';
      return 'offline';
    };

    const evalWithGrace = (
      trackKey: string,
      phase: TelegramConnectionPhase,
      lastError?: string | null,
      offlineReason?: string | null
    ) => {
      if (phase === 'online' || phase === 'offline' || phase === 'expired') {
        delete transientDisconnectSinceRef.current[trackKey];
      } else if (transientDisconnectSinceRef.current[trackKey] === undefined) {
        transientDisconnectSinceRef.current[trackKey] = now;
      }
      const res = evaluateTelegramAccountUiState({
        phase,
        lastError,
        offlineReason,
        transientSince: transientDisconnectSinceRef.current[trackKey] ?? null,
        now,
      });
      recordGraceDelay(res.nextGraceCheckInMs);
      return res;
    };

    const statusById = new Map<string, 'online' | 'away' | 'offline' | 'expired'>();
    const phaseById = new Map<string, TelegramConnectionPhase>();
    const metaById = new Map<
      string,
      { lastError?: string | null; retryCount?: number; nextRetryAt?: number; lastConnectedAt?: number | null }
    >();
    const reasonsMap: Record<string, string> = {};
    const bannerVisibilityMap: Record<string, boolean> = {};

    const runtimeKeyToStatus = new Map<string, 'online' | 'away' | 'offline' | 'expired'>();
    const runtimeKeyToPhase = new Map<string, TelegramConnectionPhase>();
    const runtimeKeyToReason = new Map<string, string>();
    const runtimeKeyToBanner = new Map<string, boolean>();
    const runtimeKeyToMeta = new Map<
      string,
      { lastError?: string | null; retryCount?: number; nextRetryAt?: number; lastConnectedAt?: number | null }
    >();

    if (statusRes.ok) {
      statusRes.activeUsers.forEach((u) => {
        const uIdentity = resolveTelegramAccountIdentity({ id: u.id, userId: u.userId, phone: u.phone });
        const uTrackKey = uIdentity.runtimeKey || u.id;
        const phase = resolvePhase(u);
        const evalRes = evalWithGrace(uTrackKey, phase, u.lastError, u.offlineReason);
        statusById.set(u.id, evalRes.uiStatus);
        phaseById.set(u.id, evalRes.connectionPhase);
        const metaObj = {
          lastError: u.lastError ?? null,
          retryCount: u.retryCount,
          nextRetryAt: u.nextRetryAt,
          lastConnectedAt: u.lastConnectedAt ?? null,
        };
        metaById.set(u.id, metaObj);
        bannerVisibilityMap[u.id] = evalRes.shouldShowBanner;
        if (evalRes.uiStatus !== 'online' && evalRes.displayReason) {
          reasonsMap[u.id] = evalRes.displayReason;
        }
        const uKeys = [
          uIdentity.runtimeKey,
          uIdentity.phone ? `phone:${uIdentity.phone}` : '',
        ].filter(Boolean);
        for (const rk of uKeys) {
          runtimeKeyToStatus.set(rk, evalRes.uiStatus);
          runtimeKeyToPhase.set(rk, evalRes.connectionPhase);
          runtimeKeyToMeta.set(rk, metaObj);
          runtimeKeyToBanner.set(rk, evalRes.shouldShowBanner);
          if (evalRes.uiStatus !== 'online' && evalRes.displayReason) {
            runtimeKeyToReason.set(rk, evalRes.displayReason);
          }
        }
      });

      statusRes.expiredAccounts.forEach((exp) => {
        const expId = exp.accountId || (exp.userId ? `acc_tg_${exp.userId}` : exp.phone || '');
        if (!expId) return;
        const expIdentity = resolveTelegramAccountIdentity({ id: expId, userId: exp.userId, phone: exp.phone });
        delete transientDisconnectSinceRef.current[expId];
        if (expIdentity.runtimeKey) delete transientDisconnectSinceRef.current[expIdentity.runtimeKey];
        statusById.set(expId, 'expired');
        phaseById.set(expId, 'expired');
        bannerVisibilityMap[expId] = true;
        reasonsMap[expId] = exp.reason;
        const expKeys = [
          expIdentity.runtimeKey,
          expIdentity.phone ? `phone:${expIdentity.phone}` : '',
        ].filter(Boolean);
        for (const rk of expKeys) {
          runtimeKeyToStatus.set(rk, 'expired');
          runtimeKeyToPhase.set(rk, 'expired');
          runtimeKeyToBanner.set(rk, true);
          runtimeKeyToReason.set(rk, exp.reason);
        }
        if (!notifiedExpiredRef.current.has(expId)) {
          notifiedExpiredRef.current.add(expId);
          showCloudError(exp.reason || `账号 ${expId} 登录会话已失效，请重新扫码或验证码登录`);
        }
      });
    }

    const activeById = new Map<string, any>();
    const activeByRuntimeKey = new Map<string, any>();
    if (activeAccs && activeAccs.length > 0) {
      activeAccs.forEach((acc: any) => {
        const accIdMeta = resolveTelegramAccountIdentity({ id: acc?.id, userId: acc?.userId, phone: acc?.phone });
        if (acc?.id) {
          activeById.set(acc.id, acc);
        }
        if (accIdMeta.runtimeKey) activeByRuntimeKey.set(accIdMeta.runtimeKey, acc);
        if (accIdMeta.phone) activeByRuntimeKey.set(`phone:${accIdMeta.phone}`, acc);
        if (acc?.id && !statusById.has(acc.id)) {
          const accPhase = resolvePhase({ status: acc.status, isConnected: acc.isConnected, isInMemoryConnected: true });
          const evalRes = evalWithGrace(accIdMeta.runtimeKey || acc.id, accPhase);
          statusById.set(acc.id, evalRes.uiStatus);
          phaseById.set(acc.id, evalRes.connectionPhase);
          bannerVisibilityMap[acc.id] = evalRes.shouldShowBanner;
          if (evalRes.uiStatus !== 'online' && evalRes.displayReason) {
            reasonsMap[acc.id] = evalRes.displayReason;
          }
        }
      });
    }

    // Evaluate fallback UI state for any previously known personal Telegram account (including phone-keyed & internal+phone accounts)
    accountsRef.current.forEach((a) => {
      const identity = resolveTelegramAccountIdentity({ id: a.id, phone: a.phone });
      if (!identity.isPersonalTelegram || statusById.has(a.id)) return;
      const matchedRuntimeKey =
        (identity.runtimeKey && runtimeKeyToStatus.has(identity.runtimeKey) ? identity.runtimeKey : '') ||
        (identity.phone && runtimeKeyToStatus.has(`phone:${identity.phone}`) ? `phone:${identity.phone}` : '');
      if (matchedRuntimeKey) {
        statusById.set(a.id, runtimeKeyToStatus.get(matchedRuntimeKey)!);
        phaseById.set(a.id, runtimeKeyToPhase.get(matchedRuntimeKey)!);
        const m = runtimeKeyToMeta.get(matchedRuntimeKey);
        if (m) metaById.set(a.id, m);
        bannerVisibilityMap[a.id] = Boolean(runtimeKeyToBanner.get(matchedRuntimeKey));
        const r = runtimeKeyToReason.get(matchedRuntimeKey);
        if (r) reasonsMap[a.id] = r;
        return;
      }
      const hasExplicitOffline =
        a.status === 'offline' ||
        Boolean(a.lastError) ||
        (a.retryCount || 0) > 0 ||
        a.lastConnectedAt != null;
      const fallbackPhase: TelegramConnectionPhase =
        !hasExplicitOffline && (statusRes.isRestoringSessions || startupReconnectInFlightRef.current)
          ? 'restoring'
          : 'offline';
      const evalRes = evalWithGrace(identity.runtimeKey || a.id, fallbackPhase, a.lastError, reasonsMap[a.id]);
      statusById.set(a.id, evalRes.uiStatus);
      phaseById.set(a.id, evalRes.connectionPhase);
      bannerVisibilityMap[a.id] = evalRes.shouldShowBanner;
      if (evalRes.displayReason) {
        reasonsMap[a.id] = evalRes.displayReason;
      }
    });

    const shouldRefreshAvatarUrl = (url?: string): boolean => {
      if (!url) return true;
      const query = url.includes('?') ? url.split('?')[1] : '';
      const exp = Number(new URLSearchParams(query).get('exp') || 0);
      return !exp || exp <= Date.now() + 5 * 60 * 1000;
    };

    setBannerVisibleByAccount(bannerVisibilityMap);
    setOfflineReasonByAccount(reasonsMap);

    setAccounts((prev) => {
      const map = new Map<string, Account>();
      prev.forEach((a) => {
        const identity = resolveTelegramAccountIdentity({ id: a.id, phone: a.phone });
        if (identity.isPersonalTelegram) {
          const matchedRk =
            (identity.runtimeKey && runtimeKeyToStatus.has(identity.runtimeKey) ? identity.runtimeKey : '') ||
            (identity.phone && runtimeKeyToStatus.has(`phone:${identity.phone}`) ? `phone:${identity.phone}` : '');
          const realStatus =
            statusById.get(a.id) ||
            (matchedRk ? runtimeKeyToStatus.get(matchedRk) : undefined) ||
            (statusRes.isRestoringSessions || startupReconnectInFlightRef.current ? 'away' : 'offline');
          const nextPhase =
            phaseById.get(a.id) ||
            (matchedRk ? runtimeKeyToPhase.get(matchedRk) : undefined) ||
            (realStatus === 'online'
              ? 'online'
              : realStatus === 'expired'
                ? 'expired'
                : realStatus === 'away'
                  ? 'reconnecting'
                  : 'offline');
          const meta =
            metaById.get(a.id) ||
            (matchedRk ? runtimeKeyToMeta.get(matchedRk) : undefined);
          const nextBio =
            realStatus === 'expired'
              ? '会话已失效，请重新登录'
              : realStatus === 'online'
                ? 'Telegram 账号 (已直连)'
                : realStatus === 'away'
                  ? `Telegram 账号 (${getTelegramConnectionPhaseLabel(nextPhase)})`
                  : 'Telegram 账号 (未连接)';
          const activeMeta =
            activeById.get(a.id) ||
            (identity.canonicalAccountId ? activeById.get(identity.canonicalAccountId) : undefined) ||
            (identity.runtimeKey ? activeByRuntimeKey.get(identity.runtimeKey) : undefined) ||
            (identity.phone ? activeByRuntimeKey.get(`phone:${identity.phone}`) : undefined);
          const nextAvatarUrl =
            activeMeta?.avatarUrl && shouldRefreshAvatarUrl(a.avatarUrl)
              ? activeMeta.avatarUrl
              : a.avatarUrl;
          map.set(a.id, {
            ...a,
            status: realStatus,
            connectionPhase: nextPhase,
            bio: nextBio,
            avatarUrl: nextAvatarUrl,
            ...(meta ? meta : {}),
          });
        } else {
          map.set(a.id, a);
        }
      });
      if (activeAccs && activeAccs.length > 0) {
        activeAccs.forEach((acc: any) => {
          const accIdentity = resolveTelegramAccountIdentity({ id: acc.id, userId: acc.userId, phone: acc.phone });
          const alreadyHasRuntime = Boolean(
            (accIdentity.runtimeKey || accIdentity.phone) &&
              Array.from(map.values()).some((existing) => {
                const exId = resolveTelegramAccountIdentity({ id: existing.id, phone: existing.phone });
                return (
                  (accIdentity.runtimeKey && exId.runtimeKey === accIdentity.runtimeKey) ||
                  Boolean(accIdentity.phone && exId.phone && exId.phone === accIdentity.phone)
                );
              })
          );
          if (!map.has(acc.id) && !alreadyHasRuntime) {
            const realStatus = statusById.get(acc.id) || (acc.isConnected ? 'online' : 'away');
            const nextPhase = phaseById.get(acc.id) || (realStatus === 'online' ? 'online' : 'offline');
            map.set(acc.id, {
              id: acc.id,
              name: acc.name,
              username: acc.username,
              phone: acc.phone,
              avatarUrl: acc.avatarUrl,
              avatarBg: acc.avatarBg || '#2481cc',
              avatarInitial: acc.avatarInitial || 'TG',
              unreadTotal: 0,
              isActive: false,
              status: realStatus,
              connectionPhase: nextPhase,
              bio: realStatus === 'online' ? 'Telegram 账号 (已直连)' : 'Telegram 账号 (未连接)',
            });
          }
        });
      }
      return Array.from(map.values());
    });

    if (graceSyncTimerRef.current) {
      clearTimeout(graceSyncTimerRef.current);
      graceSyncTimerRef.current = null;
    }
    if (earliestGraceCheckMs !== null && isMountedRef.current && isMemberAuthenticatedRef.current) {
      graceSyncTimerRef.current = setTimeout(() => {
        graceSyncTimerRef.current = null;
        if (!isMountedRef.current || !isMemberAuthenticatedRef.current) return;
        void syncTelegramAccountStatus().catch(() => {});
      }, earliestGraceCheckMs);
    }
  };

  const lastDialogsSyncAtRef = useRef<Record<string, number>>({});
  const lastFloodToastAtRef = useRef<Record<string, number>>({});
  const dialogsMutationVersionRef = useRef<Record<string, number>>({});
  const recentDialogOverridesRef = useRef<
    Record<
      string,
      {
        isArchived?: boolean;
        isPinned?: boolean;
        isMuted?: boolean;
        unreadCount?: number;
        title?: string;
        lastMessage?: string;
        deleted?: boolean;
        updatedAt: number;
      }
    >
  >({});

  const recordDialogMutationOverride = (
    accountId: string,
    chatId: string,
    patch: {
      isArchived?: boolean;
      isPinned?: boolean;
      isMuted?: boolean;
      unreadCount?: number;
      title?: string;
      lastMessage?: string;
      deleted?: boolean;
    }
  ) => {
    if (!accountId || !chatId) return;
    dialogsMutationVersionRef.current[accountId] =
      (dialogsMutationVersionRef.current[accountId] || 0) + 1;
    lastDialogsSyncAtRef.current[accountId] = 0;
    const key = msgBucketKey(accountId, chatId);
    const prev = recentDialogOverridesRef.current[key] || { updatedAt: 0 };
    recentDialogOverridesRef.current[key] = {
      ...prev,
      ...patch,
      updatedAt: Date.now(),
    };
  };

  const mergeCloudDialogsForAccount = (
    targetAccId: string,
    realDialogs: any[],
    meta?: { isCached?: boolean; reqMutationVersion?: number }
  ) => {
    const latestMutationVersion = dialogsMutationVersionRef.current[targetAccId] || 0;
    const isStaleComparedToMutation =
      typeof meta?.reqMutationVersion === 'number' && meta.reqMutationVersion !== latestMutationVersion;
    const nowTs = Date.now();
    setChats((prev) => {
      const otherChats = prev.filter((c) => c.accountId !== targetAccId);
      const prevAccountChats = prev.filter((c) => c.accountId === targetAccId);
      const prevMap = new Map<string, Chat>();
      prevAccountChats.forEach((c) => prevMap.set(c.id, c));

      const nextAccountChats: Chat[] = [];
      for (const d of realDialogs) {
        if (!d?.id) continue;
        const existing = prevMap.get(d.id);
        const overrideKey = msgBucketKey(targetAccId, d.id);
        const override = recentDialogOverridesRef.current[overrideKey];
        if (override?.deleted) {
          const hasNewerCloudActivity =
            !meta?.isCached &&
            !isStaleComparedToMutation &&
            typeof d.lastDate === 'number' &&
            d.lastDate > Math.floor(override.updatedAt / 1000);
          const withinGrace = nowTs - override.updatedAt < 60_000;
          if (!hasNewerCloudActivity && (meta?.isCached || isStaleComparedToMutation || withinGrace)) {
            continue;
          }
          delete recentDialogOverridesRef.current[overrideKey];
        }

        const mapped = mapCloudDialogToChat(d, targetAccId, existing);
        if (override && !override.deleted) {
          const withinGrace = nowTs - override.updatedAt < 60_000;
          const allMatched =
            (override.isArchived === undefined || mapped.isArchived === override.isArchived) &&
            (override.isPinned === undefined || mapped.isPinned === override.isPinned) &&
            (override.isMuted === undefined || mapped.isMuted === override.isMuted) &&
            (override.unreadCount === undefined || mapped.unreadCount === override.unreadCount) &&
            (override.title === undefined || mapped.title === override.title) &&
            (override.lastMessage === undefined || mapped.lastMessage === override.lastMessage);
          if (!meta?.isCached && !isStaleComparedToMutation && allMatched) {
            delete recentDialogOverridesRef.current[overrideKey];
            nextAccountChats.push(mapped);
            continue;
          }
          if (meta?.isCached || isStaleComparedToMutation || withinGrace) {
            nextAccountChats.push({
              ...mapped,
              ...(override.isArchived !== undefined ? { isArchived: override.isArchived } : {}),
              ...(override.isPinned !== undefined ? { isPinned: override.isPinned } : {}),
              ...(override.isMuted !== undefined ? { isMuted: override.isMuted } : {}),
              ...(override.unreadCount !== undefined ? { unreadCount: override.unreadCount } : {}),
              ...(override.title !== undefined ? { title: override.title } : {}),
              ...(override.lastMessage !== undefined ? { lastMessage: override.lastMessage } : {}),
            });
            continue;
          }
          delete recentDialogOverridesRef.current[overrideKey];
        } else if (isStaleComparedToMutation && existing) {
          nextAccountChats.push({
            ...mapped,
            isArchived: Boolean(existing.isArchived),
            isPinned: Boolean(existing.isPinned),
            pinOrder: Boolean(existing.isPinned) ? existing.pinOrder : undefined,
            isMuted: Boolean(existing.isMuted),
            unreadCount: existing.unreadCount,
            title: existing.title,
            lastMessage: existing.lastMessage,
          });
          continue;
        }
        nextAccountChats.push(mapped);
      }
      const cloudIds = new Set(nextAccountChats.map((c) => c.id));
      prevAccountChats.forEach((c) => {
        if (!c.id.startsWith('tg_') && !cloudIds.has(c.id)) {
          nextAccountChats.push(c);
        }
      });
      return [...nextAccountChats, ...otherChats];
    });
  };

  const notifyTelegramFloodCooldown = (accId: string, errorMsg?: string, retryAfterSeconds?: number) => {
    const now = Date.now();
    const lastShown = lastFloodToastAtRef.current[accId] || 0;
    if (now - lastShown < 30_000) return;
    lastFloodToastAtRef.current[accId] = now;
    showCloudError(
      errorMsg ||
        (retryAfterSeconds
          ? `Telegram 请求触发频控保护，请等待 ${retryAfterSeconds} 秒后再试`
          : 'Telegram 请求触发官方频控保护，已自动进入冷却期')
    );
  };

  const handleReconnectTelegram = async () => {
    if (isReconnectingAccount) return;
    setIsReconnectingAccount(true);
    try {
      const curId = activeAccountIdRef.current;
      const curAcc = curId ? accountsRef.current.find((a) => a.id === curId) : undefined;
      const identity = resolveTelegramAccountIdentity({
        id: curId,
        phone: curAcc?.phone,
      });
      // Use resolved canonical scopedAccountId (never let opaque internal ID overwrite real phone)
      const scopedAccountId =
        identity.isPersonalTelegram && (!curAcc || curAcc.status !== 'online')
          ? identity.scopedAccountId
          : undefined;
      const res = await reconnectTelegramSessionsApi(
        true,
        false,
        scopedAccountId,
        scopedAccountId ? { userId: identity.userId, phone: identity.phone } : undefined
      );
      await syncTelegramAccountStatus().catch(() => {});
      if (!res.ok) {
        showCloudError(res.error || '重连 Telegram 会话失败');
      } else {
        const afterAccId = activeAccountIdRef.current;
        const afterAcc = afterAccId ? accountsRef.current.find((a) => a.id === afterAccId) : undefined;
        const afterIdentity = resolveTelegramAccountIdentity({
          id: afterAccId,
          phone: afterAcc?.phone,
        });
        const refreshApiAccountId =
          afterAccId === curId && afterIdentity.isPersonalTelegram
            ? afterIdentity.canonicalAccountId || afterAccId
            : '';
        const localBucketAccId = afterAccId === curId ? afterAccId : refreshApiAccountId;
        if (refreshApiAccountId && localBucketAccId) {
          const reqMutationVersion = dialogsMutationVersionRef.current[localBucketAccId] || 0;
          const dlgRes = await fetchTelegramUserDialogsDetailedApi(refreshApiAccountId, undefined, { force: true });
          if (dlgRes.code === 'TELEGRAM_FLOOD_WAIT') {
            notifyTelegramFloodCooldown(localBucketAccId, dlgRes.error, dlgRes.retryAfterSeconds);
          }
          if ((dlgRes.ok || dlgRes.dialogs.length > 0) && dlgRes.dialogs.length > 0) {
            if (dlgRes.ok) {
              lastDialogsSyncAtRef.current[localBucketAccId] = Date.now();
            }
            mergeCloudDialogsForAccount(localBucketAccId, dlgRes.dialogs, {
              isCached: Boolean(dlgRes.cached),
              reqMutationVersion,
            });
          }
        }
      }
    } finally {
      setIsReconnectingAccount(false);
    }
  };

  // Sync active connected Telegram accounts & real MTProto connectivity + expired sessions
  useEffect(() => {
    if (!isMemberAuthenticated) return;
    let isMounted = true;

    const runSync = async () => {
      if (!isMounted) return;
      await syncTelegramAccountStatus();
    };

    void runSync();
    const initialRetryTimer = setTimeout(() => {
      void runSync();
    }, 2500);
    const statusPollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void runSync();
    }, 15000);

    return () => {
      isMounted = false;
      clearTimeout(initialRetryTimer);
      clearInterval(statusPollTimer);
    };
  }, [isMemberAuthenticated]);

  // Subscribe to Electron desktop auto-updater runtime state & capability
  useEffect(() => {
    const bridge = getDesktopUpdaterBridge();
    if (!bridge) return;
    let active = true;
    bridge
      .getInfo()
      .then((info) => {
        if (active && info) setDesktopUpdaterInfo(info);
      })
      .catch(() => {});
    bridge
      .getState()
      .then((st) => {
        if (active && st) setUpdaterState(st);
      })
      .catch(() => {});
    const unsubscribe = bridge.onStateChange((nextState) => {
      if (active && nextState) setUpdaterState(nextState);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Check GitHub Releases once after login (non-blocking, respects dismissed version)
  useEffect(() => {
    if (!isMemberAuthenticated || hasCheckedUpdateOnBootRef.current) return;
    hasCheckedUpdateOnBootRef.current = true;
    let cancelled = false;
    checkAppUpdateApi()
      .then((res) => {
        if (cancelled || !res?.ok || !res.hasUpdate || !res.latestVersion) return;
        try {
          if (localStorage.getItem('tg_dismissed_update_version') === res.latestVersion) return;
        } catch {}
        setAppUpdateInfo(res);
        setIsUpdateModalOpen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isMemberAuthenticated]);

  // Account-level syncing: scoped contacts, per-account translation settings, DB chats, and MTProto dialogs
  useEffect(() => {
    if (!activeAccountId || !isMemberAuthenticated) return;
    setActiveApiAccount(activeAccountId);

    let isMounted = true;
    const targetAccId = activeAccountId;
    setContacts(getScopedContacts(targetAccId));
    callRecordsScopeRef.current = targetAccId;
    setCallRecords(loadScopedCallRecordsSync(targetAccId));
    (async () => {
      try {
        const localScopedTrans = await secureGetItemAsync<TranslationSettings>(
          getScopedTranslationSettingsKey(targetAccId)
        );
        if (!isMounted || activeAccountIdRef.current !== targetAccId) return;
        if (localScopedTrans) {
          translationAccountScopeRef.current = targetAccId;
          setTranslationSettings(
            enforceTranslationEngineForLlm(
              customLLMConfigRef.current,
              normalizeLoadedTranslationSettings(localScopedTrans)
            )
          );
          return;
        }
        const serverScopedTrans = await fetchTranslationSettingsApi(targetAccId).catch(() => null);
        if (!isMounted || activeAccountIdRef.current !== targetAccId) return;
        if (serverScopedTrans) {
          translationAccountScopeRef.current = targetAccId;
          setTranslationSettings(
            enforceTranslationEngineForLlm(
              customLLMConfigRef.current,
              normalizeLoadedTranslationSettings(serverScopedTrans)
            )
          );
        }
      } catch {}
    })();
    if (targetAccId.startsWith('acc_tg_')) {
      fetchTelegramUserContactsApi(targetAccId).then((res) => {
        if (isMounted && activeAccountIdRef.current === targetAccId && res.ok && Array.isArray(res.contacts)) {
          handleSyncContacts(res.contacts, targetAccId);
        }
      }).catch(() => {});
      fetchTelegramDialogFiltersApi(targetAccId).then((fRes) => {
        if (isMounted && fRes.ok && Array.isArray(fRes.folders)) {
          setFoldersByAccount((prev) => ({ ...prev, [targetAccId]: fRes.folders! }));
        }
      }).catch(() => {});
    }

    const LOW_FREQUENCY_DIALOG_FALLBACK_INTERVAL_MS = 180_000;
    const DIALOG_MIN_REFRESH_GAP_MS = 20_000;

    const applyCloudDialogs = (
      realDialogs: any[],
      meta?: { isCached?: boolean; reqMutationVersion?: number }
    ) => mergeCloudDialogsForAccount(targetAccId, realDialogs, meta);

    const syncDialogsFromCloud = async (opts?: { force?: boolean }) => {
      if (!targetAccId.startsWith('acc_tg_')) return;
      const hasExistingAccountChats = chatsRef.current.some(
        (c) => c.accountId === targetAccId && c.id.startsWith('tg_')
      );
      const lastSyncAt = lastDialogsSyncAtRef.current[targetAccId] || 0;
      if (!opts?.force && hasExistingAccountChats && Date.now() - lastSyncAt < DIALOG_MIN_REFRESH_GAP_MS) {
        return;
      }
      const seq = selectAccountSeqRef.current;
      const reqMutationVersion = dialogsMutationVersionRef.current[targetAccId] || 0;
      try {
        const res = await fetchTelegramUserDialogsDetailedApi(targetAccId, undefined, opts);
        if (selectAccountSeqRef.current !== seq) return;
        if (!isMounted || activeAccountIdRef.current !== targetAccId) return;
        if (!res.ok) {
          if (res.code === 'TELEGRAM_SESSION_EXPIRED') {
            markAccountExpiredUi(targetAccId, res.error);
          } else if (res.code === 'TELEGRAM_FLOOD_WAIT') {
            notifyTelegramFloodCooldown(targetAccId, res.error, res.retryAfterSeconds);
            if (Array.isArray(res.dialogs) && res.dialogs.length > 0) {
              applyCloudDialogs(res.dialogs, { isCached: true, reqMutationVersion });
            }
          }
          return;
        }

        lastDialogsSyncAtRef.current[targetAccId] = Date.now();
        const realDialogs = res.dialogs;
        applyCloudDialogs(realDialogs, { isCached: Boolean(res.cached), reqMutationVersion });

        if (realDialogs.length > 0 && activeAccountIdRef.current === targetAccId) {
          const dialogById = new Map<string, any>();
          realDialogs.forEach((d: any) => {
            if (d && d.id && !d.isGroup && !d.isChannel) {
              dialogById.set(d.id, d);
            }
          });
          if (dialogById.size > 0) {
            setContacts((prev) => {
              let changed = false;
              const next = prev.map((ct) => {
                const d = dialogById.get(ct.id);
                if (!d) return ct;
                const nextStatus = d.isOnline ? ('online' as const) : ('offline' as const);
                const nextStatusText = typeof d.statusText === 'string' ? d.statusText : ct.statusText;
                const nextName = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : ct.name;
                if (ct.status !== nextStatus || ct.statusText !== nextStatusText || ct.name !== nextName) {
                  changed = true;
                  return {
                    ...ct,
                    name: nextName,
                    status: nextStatus,
                    ...(nextStatusText ? { statusText: nextStatusText } : {}),
                  };
                }
                return ct;
              });
              if (changed) {
                saveScopedContacts(next, targetAccId);
              }
              return changed ? next : prev;
            });
          }
        }
      } catch {}
    };

    const syncChats = (opts?: { force?: boolean }) => {
      fetchChatsFromDb(targetAccId).then((dbChats) => {
        if (isMounted && dbChats && dbChats.length > 0) {
          const scopedDbChats = dbChats.filter((dbc: Chat) => {
            const rowAcc = dbc.accountId || targetAccId;
            return rowAcc === targetAccId;
          });
          if (scopedDbChats.length === 0) return;
          setChats((prev) => {
            const map = new Map<string, Chat>();
            prev.forEach((c) => map.set(msgBucketKey(c.accountId || targetAccId, c.id), c));
            scopedDbChats.forEach((dbc: Chat) => {
              const bucketKey = msgBucketKey(dbc.accountId || targetAccId, dbc.id);
              const existing = map.get(bucketKey);
              if (existing) {
                map.set(bucketKey, {
                  ...existing,
                  lastMessage: dbc.lastMessage,
                  lastTime: dbc.lastTime,
                  sourceLang: existing.sourceLang || dbc.sourceLang || 'Auto',
                  targetLang: existing.targetLang || dbc.targetLang || 'Auto',
                  ...(typeof existing.translationEnabled === 'boolean'
                    ? { translationEnabled: existing.translationEnabled }
                    : typeof dbc.translationEnabled === 'boolean'
                      ? { translationEnabled: dbc.translationEnabled }
                      : {}),
                });
              } else {
                map.set(bucketKey, dbc);
              }
            });
            return Array.from(map.values());
          });
        }
      });

      // Also sync live MTProto cloud dialogs if this is a connected personal Telegram account
      if (targetAccId.startsWith('acc_tg_')) {
        void syncDialogsFromCloud(opts);
      }
    };

    triggerAccountDialogRefreshRef.current = async (reqAccId?: string, opts?: { force?: boolean }) => {
      const effectiveAcc = reqAccId || activeAccountIdRef.current;
      if (!isMounted || effectiveAcc !== targetAccId || !targetAccId.startsWith('acc_tg_')) return;
      const lastAt = lastDialogsSyncAtRef.current[targetAccId] || 0;
      if (!opts?.force && Date.now() - lastAt < DIALOG_MIN_REFRESH_GAP_MS) return;
      await syncDialogsFromCloud(opts);
    };

    // Initial full hydration on account switch/login, followed by event-driven incremental updates
    // and only a low-frequency (180s) visibility-aware fallback refresh to avoid Telegram FLOOD_WAIT bans.
    syncChats();
    const chatInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const lastAt = lastDialogsSyncAtRef.current[targetAccId] || 0;
      if (Date.now() - lastAt < 60_000) return;
      syncChats();
    }, LOW_FREQUENCY_DIALOG_FALLBACK_INTERVAL_MS);

    let hiddenAt = 0;
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState === 'visible' && hiddenAt > 0 && Date.now() - hiddenAt >= 25_000) {
        hiddenAt = 0;
        const lastAt = lastDialogsSyncAtRef.current[targetAccId] || 0;
        if (Date.now() - lastAt >= DIALOG_MIN_REFRESH_GAP_MS) {
          syncChats();
        }
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      isMounted = false;
      triggerAccountDialogRefreshRef.current = null;
      clearInterval(chatInterval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [activeAccountId, isMemberAuthenticated]);

  // Chat-level syncing: load local encrypted messages, MTProto cloud messages, fullInfo, and customer memory for activeChatId
  useEffect(() => {
    if (!activeAccountId || !activeChatId || !isMemberAuthenticated) return;
    let isMounted = true;
    const targetAccId = activeAccountId;
    const targetChatId = activeChatId;
    const bucketKey = msgBucketKey(targetAccId, targetChatId);

    const localMsgs = getLocalMessages(targetChatId, targetAccId);
    if (localMsgs && localMsgs.length > 0) {
      setMessagesMap((prev) => ({
        ...prev,
        [bucketKey]: localMsgs.filter((m) => !isMessageDeleted(m.id, targetAccId, m.chatId || targetChatId)),
      }));
      void hydrateBucketPendingMedia(targetAccId, targetChatId);
    }

    if (!localMsgs || localMsgs.length === 0 || targetAccId === 'acc_telegram_bot') {
      fetchMessagesFromDb(targetChatId, targetAccId, { limit: 60 }).then((cloudMsgs) => {
        if (isMounted && cloudMsgs && cloudMsgs.length > 0) {
          const callMsgsInDb = cloudMsgs.filter((m: any) => Boolean(m?.isCall));
          if (callMsgsInDb.length > 0 && targetAccId === activeAccountIdRef.current) {
            setCallRecords((prev) =>
              mergeCallMessagesIntoCallRecords(prev, callMsgsInDb, chatsRef.current, targetAccId)
            );
          }
          setChatHasMoreMap((prev) => ({
            ...prev,
            [bucketKey]: prev[bucketKey] ?? cloudMsgs.length >= 60,
          }));
          setMessagesMap((prev) => {
            const base = getBucketMessages(prev, targetAccId, targetChatId);
            const merged = mergeCloudMessagesWithLocal(
              base.length > 0 ? base : getLocalMessages(targetChatId, targetAccId),
              cloudMsgs,
              { accountId: targetAccId, chatId: targetChatId }
            );
            return { ...prev, [bucketKey]: merged };
          });
          void hydrateBucketPendingMedia(targetAccId, targetChatId);
        }
      }).catch(() => {});
    }

    if (targetChatId.startsWith('tg_') && targetAccId !== 'acc_telegram_bot') {
      fetchTelegramCloudMessagesApi(targetChatId, targetAccId, { limit: 40 }).then((cloudRes) => {
        if (!isMounted) return;
        if (!cloudRes.ok) {
          if (cloudRes.code === 'TELEGRAM_SESSION_EXPIRED') {
            markAccountExpiredUi(targetAccId, cloudRes.error);
          }
          return;
        }
        setChatHasMoreMap((prev) => ({ ...prev, [bucketKey]: cloudRes.hasMore }));
        if (typeof cloudRes.readOutboxMaxId === 'number') {
          setChats((prev) =>
            prev.map((c) =>
              c.id === targetChatId && (!targetAccId || c.accountId === targetAccId)
                ? { ...c, readOutboxMaxId: Math.max(c.readOutboxMaxId || 0, cloudRes.readOutboxMaxId || 0) }
                : c
            )
          );
        }
        const cloudMsgs = Array.isArray(cloudRes.messages) ? cloudRes.messages : [];
        if (cloudMsgs.length === 0 && cloudRes.fromLocalFallback) return;
        const callMsgsInCloud = cloudMsgs.filter((m: any) => Boolean(m?.isCall));
        if (callMsgsInCloud.length > 0 && targetAccId === activeAccountIdRef.current) {
          setCallRecords((prev) =>
            mergeCallMessagesIntoCallRecords(prev, callMsgsInCloud, chatsRef.current, targetAccId)
          );
        }
        setMessagesMap((prev) => {
          const base = getBucketMessages(prev, targetAccId, targetChatId);
          const merged = mergeCloudMessagesWithLocal(
            base.length > 0 ? base : getLocalMessages(targetChatId, targetAccId),
            cloudMsgs,
            {
              accountId: targetAccId,
              chatId: targetChatId,
              allowEmptyCloudPrune: !cloudRes.fromLocalFallback,
            }
          );
          return { ...prev, [bucketKey]: merged };
        });
        void hydrateBucketPendingMedia(targetAccId, targetChatId);
      }).catch(() => {});

      fetchTelegramChatFullInfoApi(targetChatId, targetAccId).then((info) => {
        if (!isMounted) return;
        if (!info.ok) {
          if (info.code === 'TELEGRAM_SESSION_EXPIRED') {
            markAccountExpiredUi(targetAccId, info.error);
          }
          return;
        }
        setChats((prev) =>
          prev.map((c) =>
            c.id === targetChatId && (!targetAccId || c.accountId === targetAccId)
              ? {
                  ...c,
                  ...(typeof info.memberCount === 'number' ? { memberCount: info.memberCount } : {}),
                  ...(typeof info.onlineCount === 'number' ? { onlineCount: info.onlineCount } : {}),
                  ...(typeof info.isOnline === 'boolean' ? { isOnline: info.isOnline } : {}),
                  ...(info.statusText ? { statusText: info.statusText } : {}),
                  ...(info.description !== undefined ? { description: info.description } : {}),
                  ...(info.username !== undefined ? { username: info.username } : {}),
                  ...(info.inviteLink !== undefined ? { inviteLink: info.inviteLink } : {}),
                  ...(typeof info.isVerified === 'boolean' ? { isVerified: info.isVerified } : {}),
                }
              : c
          )
        );
      }).catch(() => {});
    }

    const localProf = getLocalCustomerProfile(targetChatId, targetAccId);
    if (localProf) {
      setCustomerProfile({ ...localProf, chatId: localProf.chatId || targetChatId, accountId: localProf.accountId || targetAccId });
    } else {
      setCustomerProfile(null);
    }
    const targetChatMeta = chatsRef.current.find(
      (c) => c.id === targetChatId && (!targetAccId || c.accountId === targetAccId)
    );
    fetchCustomerProfile(targetChatId, targetAccId, targetChatMeta?.title).then((prof) => {
      if (
        isMounted &&
        activeAccountIdRef.current === targetAccId &&
        activeChatIdRef.current === targetChatId &&
        prof
      ) {
        const normalizedProf: CustomerProfile = {
          ...prof,
          chatId: prof.chatId || targetChatId,
          accountId: prof.accountId || targetAccId,
        };
        setCustomerProfile(normalizedProf);
        saveLocalCustomerProfile(targetChatId, normalizedProf, targetAccId);
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [activeChatId, activeAccountId, isMemberAuthenticated]);

  // Keep latest state in refs so background polling never reads stale closures
  const chatsRef = useRef(chats);
  const messagesMapRef = useRef(messagesMap);
  const translationSettingsRef = useRef(translationSettings);
  const customLLMConfigRef = useRef(customLLMConfig);
  const activeAccountIdRef = useRef(activeAccountId);
  const activeChatIdRef = useRef(activeChatId);
  const selectAccountSeqRef = useRef(0);
  const selectChatSeqRef = useRef(0);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);
  useEffect(() => {
    messagesMapRef.current = messagesMap;
  }, [messagesMap]);
  useEffect(() => {
    translationSettingsRef.current = translationSettings;
  }, [translationSettings]);
  useEffect(() => {
    customLLMConfigRef.current = customLLMConfig;
  }, [customLLMConfig]);
  useEffect(() => {
    activeAccountIdRef.current = activeAccountId;
  }, [activeAccountId]);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const pendingAutoReadOnFocusRef = useRef<{ accountId: string; chatId: string; maxId?: number } | null>(null);

  useEffect(() => {
    const flushPendingAutoReadOnFocus = () => {
      if (!isAppWindowActivelyFocused()) return;
      const pending = pendingAutoReadOnFocusRef.current;
      if (!pending) return;
      if (pending.chatId !== activeChatIdRef.current || pending.accountId !== activeAccountIdRef.current) {
        pendingAutoReadOnFocusRef.current = null;
        return;
      }
      pendingAutoReadOnFocusRef.current = null;
      recordDialogMutationOverride(pending.accountId, pending.chatId, { unreadCount: 0 });
      setChats((prev) =>
        prev.map((c) =>
          c.id === pending.chatId && c.accountId === pending.accountId
            ? { ...c, unreadCount: 0 }
            : c
        )
      );
      markTelegramDialogReadApi({
        accountId: pending.accountId,
        chatId: pending.chatId,
        ...(pending.maxId ? { maxId: pending.maxId } : {}),
      }).catch(() => {});
    };
    window.addEventListener('focus', flushPendingAutoReadOnFocus);
    document.addEventListener('visibilitychange', flushPendingAutoReadOnFocus);
    return () => {
      window.removeEventListener('focus', flushPendingAutoReadOnFocus);
      document.removeEventListener('visibilitychange', flushPendingAutoReadOnFocus);
    };
  }, []);

  const attemptedInboundBackfillRef = useRef<Set<string>>(new Set());
  const backfillRetryCountRef = useRef<Map<string, number>>(new Map());
  const backfillCooldownUntilRef = useRef<Map<string, number>>(new Map());
  const backfillRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backfillGlobalGoogleCooldownUntilRef = useRef<number>(0);
  const [backfillRetryNonce, setBackfillRetryNonce] = useState(0);
  const backfillAbortRef = useRef<AbortController | null>(null);
  const backfillScopeKeyRef = useRef<string>('');
  const backfillRunningTokenRef = useRef<number>(0);
  const backfillPendingRescanRef = useRef<boolean>(false);

  const activeChatForBackfill = chats.find(
    (c) => c.id === activeChatId && (!activeAccountId || c.accountId === activeAccountId)
  );
  const resolvedGlobalTargetLangForBackfill =
    translationSettings.defaultTargetLang && translationSettings.defaultTargetLang !== 'Auto'
      ? translationSettings.defaultTargetLang
      : 'Chinese';
  const backfillTargetLang =
    activeChatForBackfill?.targetLang && activeChatForBackfill.targetLang !== 'Auto'
      ? activeChatForBackfill.targetLang
      : resolvedGlobalTargetLangForBackfill;
  const backfillSourceLang =
    activeChatForBackfill?.sourceLang && activeChatForBackfill.sourceLang !== 'Auto'
      ? activeChatForBackfill.sourceLang
      : 'Auto';
  const backfillHistoryEngine = 'free_dual' as const;
  const activeChatIsGroup = Boolean(activeChatForBackfill?.isGroup || activeChatForBackfill?.isChannel);
  const isActiveChatTranslationEnabled =
    typeof activeChatForBackfill?.translationEnabled === 'boolean'
      ? activeChatForBackfill.translationEnabled
      : activeChatIsGroup
        ? translationSettings.autoTranslateGroups === true
        : translationSettings.autoTranslatePrivate !== false;
  const backfillScopeKey = `${activeAccountId}::${activeChatId || ''}::${backfillTargetLang}::${backfillSourceLang}::${backfillHistoryEngine}::${translationSettings.autoTranslateInbound !== false}::${isActiveChatTranslationEnabled}::${translationSettings.googleApiKey || ''}`;

  useEffect(() => {
    return () => {
      if (backfillRetryTimerRef.current) {
        clearTimeout(backfillRetryTimerRef.current);
        backfillRetryTimerRef.current = null;
      }
      if (backfillAbortRef.current) {
        backfillAbortRef.current.abort();
        backfillAbortRef.current = null;
      }
      backfillRunningTokenRef.current = 0;
      backfillPendingRescanRef.current = false;
    };
  }, [backfillScopeKey]);

  // Auto-backfill ALL untranslated historical messages (no count cap) strictly via rate-paced Google Translate with backoff retry
  useEffect(() => {
    if (!isMemberAuthenticated || !activeChatId || !activeAccountId) return;
    if (translationSettings.autoTranslateInbound === false) return;
    if (!isActiveChatTranslationEnabled) return;
    const globalCooldownRemaining = backfillGlobalGoogleCooldownUntilRef.current - Date.now();
    if (globalCooldownRemaining > 0) {
      if (!backfillRetryTimerRef.current) {
        backfillRetryTimerRef.current = setTimeout(() => {
          backfillRetryTimerRef.current = null;
          setBackfillRetryNonce((n) => n + 1);
        }, globalCooldownRemaining + 150);
      }
      return;
    }

    if (backfillScopeKeyRef.current !== backfillScopeKey || !backfillAbortRef.current) {
      if (backfillAbortRef.current) {
        backfillAbortRef.current.abort();
      }
      backfillRunningTokenRef.current = 0;
      backfillPendingRescanRef.current = false;
      backfillScopeKeyRef.current = backfillScopeKey;
      backfillAbortRef.current = new AbortController();
    }
    const controller = backfillAbortRef.current;
    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const targetBucketKey = msgBucketKey(targetAccountId, targetChatId);
    const currentMsgs = getBucketMessages(messagesMap, targetAccountId, targetChatId);
    if (currentMsgs.length === 0) return;

    const nowTs = Date.now();
    const targetNorm = normalizeLanguageCode(backfillTargetLang);
    const candidates: Array<{ msg: Message; rawText: string; dedupeKey: string }> = [];

    for (let i = currentMsgs.length - 1; i >= 0; i--) {
      const m = currentMsgs[i];
      if (!m || m.deliveryStatus === 'pending') continue;
      const isHistoryError =
        m.translationErrorChannel === 'history_google' ||
        (!m.translationErrorChannel &&
          Boolean(m.translationError) &&
          (m.translationError!.includes('历史') || m.translationError!.includes('谷歌')));
      const isFreshLiveTranslationError =
        Boolean(m.translationError) &&
        !isHistoryError &&
        typeof m.createdAt === 'number' &&
        nowTs - m.createdAt < 60_000;
      if ((m.translatedText || '').trim() || m.isTranslating || isFreshLiveTranslationError) continue;
      const rawText = (m.sttText || m.text || m.imageCaption || '').trim();
      if (
        m.isCall ||
        !rawText ||
        /^\[(语音|视频|图片|多媒体|文件)消息\]$/.test(rawText) ||
        rawText.startsWith('🎤') ||
        rawText.startsWith('🖼️') ||
        rawText.startsWith('🎬') ||
        rawText.startsWith('📁') ||
        rawText.startsWith('📞') ||
        rawText.startsWith('📹') ||
        rawText.startsWith('📵') ||
        !/\p{L}/u.test(rawText)
      ) {
        continue;
      }
      const detectedNorm = normalizeLanguageCode(detectClientLangCode(rawText));
      if (detectedNorm !== 'auto' && targetNorm !== 'auto' && detectedNorm === targetNorm) {
        continue;
      }
      const dedupeKey = `${targetAccountId}::${targetChatId}::${m.id}::${backfillTargetLang}::${backfillHistoryEngine}`;
      if (attemptedInboundBackfillRef.current.has(dedupeKey)) continue;
      const cooldownUntil = backfillCooldownUntilRef.current.get(dedupeKey) || 0;
      if (nowTs < cooldownUntil) continue;
      candidates.push({ msg: m, rawText, dedupeKey });
    }

    if (candidates.length === 0) return;

    if (backfillRunningTokenRef.current !== 0) {
      backfillPendingRescanRef.current = true;
      return;
    }
    const runToken = Date.now() + Math.random();
    backfillRunningTokenRef.current = runToken;

    if (attemptedInboundBackfillRef.current.size > 10000) {
      const keysIter = attemptedInboundBackfillRef.current.values();
      for (let k = 0; k < 2000; k++) {
        const next = keysIter.next();
        if (next.done) break;
        attemptedInboundBackfillRef.current.delete(next.value);
      }
    }
    candidates.forEach((c) => attemptedInboundBackfillRef.current.add(c.dedupeKey));

    const pendingUpdates = new Map<
      string,
      {
        msg: Message;
        translatedText?: string;
        translationError?: string;
        translationErrorChannel?: Message['translationErrorChannel'];
      }
    >();
    const flushBatchUpdates = () => {
      if (controller.signal.aborted || pendingUpdates.size === 0) return;
      const batch = new Map(pendingUpdates);
      pendingUpdates.clear();

      setMessagesMap((prevMap) => {
        const list = getBucketMessages(prevMap, targetAccountId, targetChatId);
        let changed = false;
        const updated = list.map((item) => {
          const patch = batch.get(item.id);
          if (!patch || (item.translatedText || '').trim()) return item;
          changed = true;
          if (patch.translatedText !== undefined) {
            return {
              ...item,
              translatedText: patch.translatedText,
              translationError: undefined,
              translationErrorChannel: undefined,
            };
          }
          return {
            ...item,
            translationError: patch.translationError,
            translationErrorChannel: patch.translationErrorChannel ?? 'history_google',
          };
        });
        if (!changed) return prevMap;
        return { ...prevMap, [targetBucketKey]: updated };
      });

      batch.forEach(({ msg, translatedText }) => {
        if (translatedText !== undefined) {
          updateMessageTranslationInDb(msg.id, translatedText, {
            chatId: targetChatId,
            telegramMessageId: msg.telegramMessageId,
            accountId: targetAccountId,
          }).catch(() => {});
        }
      });
    };

    const scheduleBackfillRetryWakeup = (delayMs: number, forceForCooldown = false) => {
      if (forceForCooldown) {
        if (backfillRetryTimerRef.current) {
          clearTimeout(backfillRetryTimerRef.current);
          backfillRetryTimerRef.current = null;
        }
      } else if (controller.signal.aborted || backfillRetryTimerRef.current) {
        return;
      }
      const scheduledScope = backfillScopeKey;
      backfillRetryTimerRef.current = setTimeout(() => {
        backfillRetryTimerRef.current = null;
        if (forceForCooldown ? backfillScopeKeyRef.current === scheduledScope : !controller.signal.aborted) {
          setBackfillRetryNonce((n) => n + 1);
        }
      }, delayMs);
    };

    const onAbort = () => {
      pendingUpdates.clear();
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });

    const BACKFILL_BATCH_SIZE = 10;
    (async () => {
      try {
      for (let offset = 0; offset < candidates.length; offset += BACKFILL_BATCH_SIZE) {
        if (controller.signal.aborted) {
          for (let j = offset; j < candidates.length; j++) {
            attemptedInboundBackfillRef.current.delete(candidates[j].dedupeKey);
          }
          break;
        }
        const chunk = candidates.slice(offset, offset + BACKFILL_BATCH_SIZE);
        try {
          const batchResults = await translateBatchTexts(
            chunk.map((c) => ({ id: c.msg.id, text: c.rawText })),
            backfillSourceLang,
            backfillTargetLang,
            backfillHistoryEngine,
            translationSettings.googleApiKey,
            { signal: controller.signal, purpose: 'history' }
          );
          if (controller.signal.aborted) {
            for (let j = offset; j < candidates.length; j++) {
              attemptedInboundBackfillRef.current.delete(candidates[j].dedupeKey);
            }
            break;
          }
          const byId = new Map(batchResults.map((r) => [r.id, r]));
          chunk.forEach(({ msg, rawText, dedupeKey }) => {
            const resItem = byId.get(msg.id);
            const cleanTrans = (resItem?.translatedText || '').trim();
            if (cleanTrans && !resItem?.error) {
              backfillRetryCountRef.current.delete(dedupeKey);
              backfillCooldownUntilRef.current.delete(dedupeKey);
              if (cleanTrans.toLowerCase() !== rawText.toLowerCase()) {
                pendingUpdates.set(msg.id, { msg, translatedText: resItem!.translatedText });
              } else if (msg.translationError) {
                pendingUpdates.set(msg.id, { msg, translatedText: '' });
              }
            } else if (resItem?.error) {
              const retries = backfillRetryCountRef.current.get(dedupeKey) || 0;
              if (retries < 2) {
                const backoffMs = retries === 0 ? 4000 : 12000;
                backfillRetryCountRef.current.set(dedupeKey, retries + 1);
                backfillCooldownUntilRef.current.set(dedupeKey, Date.now() + backoffMs);
                attemptedInboundBackfillRef.current.delete(dedupeKey);
                scheduleBackfillRetryWakeup(backoffMs + 150);
              }
              const errMsg = '翻译失败，请检查翻译通道';
              pendingUpdates.set(msg.id, {
                msg,
                translationError: errMsg,
                translationErrorChannel: 'history_google',
              });
            }
          });
          flushBatchUpdates();
        } catch (err: any) {
          if (err?.name === 'AbortError' || controller.signal.aborted) {
            for (let j = offset; j < candidates.length; j++) {
              attemptedInboundBackfillRef.current.delete(candidates[j].dedupeKey);
            }
            break;
          }
          const rawErrMsg = String(err?.message || '');
          const isRateLimited429 = /\b429\b|Too Many Requests|频率过高/i.test(rawErrMsg);
          if (isRateLimited429) {
            const cooldownMs = 30_000;
            backfillGlobalGoogleCooldownUntilRef.current = Math.max(
              backfillGlobalGoogleCooldownUntilRef.current,
              Date.now() + cooldownMs
            );
            for (let j = offset; j < candidates.length; j++) {
              backfillCooldownUntilRef.current.set(candidates[j].dedupeKey, Date.now() + cooldownMs);
              attemptedInboundBackfillRef.current.delete(candidates[j].dedupeKey);
            }
            if (backfillAbortRef.current === controller) {
              backfillAbortRef.current = null;
            }
            controller.abort();
            scheduleBackfillRetryWakeup(cooldownMs + 150, true);
            break;
          }
          chunk.forEach(({ msg, dedupeKey }) => {
            const retries = backfillRetryCountRef.current.get(dedupeKey) || 0;
            if (retries < 2) {
              const backoffMs = retries === 0 ? 4000 : 12000;
              backfillRetryCountRef.current.set(dedupeKey, retries + 1);
              backfillCooldownUntilRef.current.set(dedupeKey, Date.now() + backoffMs);
              attemptedInboundBackfillRef.current.delete(dedupeKey);
              scheduleBackfillRetryWakeup(backoffMs + 150);
            }
            const errMsg = '翻译失败，请检查翻译通道';
            pendingUpdates.set(msg.id, {
              msg,
              translationError: errMsg,
              translationErrorChannel: 'history_google',
            });
          });
          flushBatchUpdates();
        }
      }
      if (pendingUpdates.size > 0 && !controller.signal.aborted) {
        flushBatchUpdates();
      }
      } finally {
        if (backfillRunningTokenRef.current === runToken) {
          backfillRunningTokenRef.current = 0;
          if (backfillPendingRescanRef.current && !controller.signal.aborted) {
            backfillPendingRescanRef.current = false;
            setBackfillRetryNonce((n) => n + 1);
          }
        }
      }
    })();
  }, [
    isMemberAuthenticated,
    activeChatId,
    activeAccountId,
    messagesMap,
    backfillScopeKey,
    backfillTargetLang,
    backfillSourceLang,
    translationSettings.autoTranslateInbound,
    translationSettings.googleApiKey,
    backfillRetryNonce,
  ]);

  // Real-time polling for incoming Telegram MTProto / Bot updates into pure local storage
  useEffect(() => {
    if (!isMemberAuthenticated) return;
    let isMounted = true;
    let isPolling = false;
    const pollInterval = setInterval(async () => {
      if (isPolling) return;
      isPolling = true;
      try {
        const currentAccId = activeAccountIdRef.current;
        const currentActiveChatId = activeChatIdRef.current;
        const currentChats = chatsRef.current;
        const currentTransSettings = translationSettingsRef.current;
        const currentLLMConfig = customLLMConfigRef.current;

        // Poll updates globally across ALL active Telegram accounts so background accounts receive real-time messages & unread badges
        const updates = await pollIncomingTelegramUpdates();
        if (isMounted && updates && updates.length > 0) {
          const processedIds: string[] = [];
          updates.forEach((upd: any) => {
            if (upd.id) processedIds.push(String(upd.id));
            const rawChatId = String(upd.chatId || '');
            let targetChatId = rawChatId;
            const targetAccountId = upd.accountId || currentAccId;
            const isOfficial =
              rawChatId === '777000' ||
              rawChatId === 'tg_777000' ||
              rawChatId === '42777' ||
              rawChatId === 'tg_42777' ||
              upd.senderName?.includes('官方') ||
              upd.senderName?.includes('Telegram');

            if (rawChatId) {
              const matched = currentChats.find(
                (c) =>
                  c.accountId === targetAccountId &&
                  (c.id === rawChatId ||
                  c.id === `tg_${rawChatId}` ||
                  c.id.replace(/^tg_/, '') === rawChatId.replace(/^tg_/, ''))
              );
              if (matched) {
                targetChatId = matched.id;
              } else if (!targetChatId.startsWith('tg_') && !targetChatId.startsWith('chat_')) {
                targetChatId = `tg_${targetChatId}`;
              }
            } else {
              targetChatId = currentActiveChatId || (isOfficial ? 'tg_777000' : 'chat_tg_official');
            }

            const isOfficialNotice = isOfficial || targetChatId === 'tg_777000' || targetChatId === 'tg_42777';
            const officialTitle = 'Telegram 官方服务通知';
            const updType = upd.type || 'message';

            if (updType === 'edit') {
              const targetBucketKey = msgBucketKey(targetAccountId, targetChatId);
              const editedTgId = typeof upd.telegramMessageId === 'number' ? upd.telegramMessageId : undefined;
              const newText = String(upd.text || '');
              const currentBucketList = getBucketMessages(messagesMapRef.current, targetAccountId, targetChatId);
              const latestBucketMsg = currentBucketList.length > 0 ? currentBucketList[currentBucketList.length - 1] : undefined;
              let editedLatestSummary: string | null = null;
              if (
                latestBucketMsg &&
                ((editedTgId !== undefined && latestBucketMsg.telegramMessageId === editedTgId) ||
                  (upd.messageId && latestBucketMsg.id === upd.messageId))
              ) {
                const hasVisualMedia = Boolean(
                  latestBucketMsg.isImage || latestBucketMsg.imageUrl || latestBucketMsg.isVideo || latestBucketMsg.videoUrl
                );
                editedLatestSummary = formatChatMessageSummary({
                  ...latestBucketMsg,
                  text: newText,
                  ...(hasVisualMedia ? { imageCaption: newText } : {}),
                });
              }
              setMessagesMap((prev) => {
                const list = getBucketMessages(prev, targetAccountId, targetChatId);
                if (list.length === 0) return prev;
                let changed = false;
                const updated = list.map((m) => {
                  if (
                    (editedTgId !== undefined && m.telegramMessageId === editedTgId) ||
                    (upd.messageId && m.id === upd.messageId)
                  ) {
                    changed = true;
                    const hasVisualMedia = Boolean(m.isImage || m.imageUrl || m.isVideo || m.videoUrl);
                    return {
                      ...m,
                      text: newText,
                      ...(hasVisualMedia ? { imageCaption: newText } : {}),
                      isEdited: true,
                    };
                  }
                  return m;
                });
                if (!changed) return prev;
                return { ...prev, [targetBucketKey]: updated };
              });
              if (editedLatestSummary !== null) {
                setChats((prev) =>
                  prev.map((c) =>
                    c.id === targetChatId && c.accountId === targetAccountId
                      ? { ...c, lastMessage: editedLatestSummary! }
                      : c
                  )
                );
              }
              return;
            }

            if (updType === 'delete') {
              const deletedTgIds = new Set<number>(
                Array.isArray(upd.deletedMessageIds)
                  ? upd.deletedMessageIds.map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
                  : []
              );
              if (deletedTgIds.size === 0) return;
              const matchesDeletedTgId = (m: Message) => {
                const msgTgId = resolveClientTelegramMessageId(m);
                return msgTgId !== undefined && deletedTgIds.has(msgTgId);
              };
              const refSnapshot = messagesMapRef.current;
              const candidateKeysForRecord = rawChatId
                ? [msgBucketKey(targetAccountId, targetChatId)]
                : Object.keys(refSnapshot).filter((k) => {
                    const matchesAcc = k.startsWith(`${targetAccountId}::`) || k === targetChatId;
                    if (!matchesAcc) return false;
                    const chatPart = k.includes('::') ? k.split('::').slice(1).join('::') : k;
                    return !chatPart.startsWith('tg_-100') && !chatPart.startsWith('-100');
                  });
              const deletedLastSummaryByChat: Record<string, { summary: string; needsDialogRefresh: boolean }> = {};
              for (const key of candidateKeysForRecord) {
                const list = refSnapshot[key];
                if (!Array.isArray(list) || list.length === 0) continue;
                const chatKey = key.includes('::') ? key.split('::').slice(1).join('::') : key;
                list.filter(matchesDeletedTgId).forEach((m) =>
                  recordDeletedMessageId(m.id, targetAccountId, m.chatId || chatKey)
                );
                const lastBeforeDelete = list[list.length - 1];
                if (lastBeforeDelete && matchesDeletedTgId(lastBeforeDelete)) {
                  const remaining = list.filter((m) => !matchesDeletedTgId(m));
                  const nextLast = remaining.length > 0 ? remaining[remaining.length - 1] : undefined;
                  deletedLastSummaryByChat[chatKey] = {
                    summary: nextLast ? formatChatMessageSummary(nextLast) : '暂无消息',
                    needsDialogRefresh: !nextLast,
                  };
                }
              }
              setMessagesMap((prev) => {
                const next = { ...prev };
                let anyChanged = false;
                const candidateKeys = rawChatId
                  ? [msgBucketKey(targetAccountId, targetChatId)]
                  : Object.keys(prev).filter((k) => {
                      const matchesAcc = k.startsWith(`${targetAccountId}::`) || k === targetChatId;
                      if (!matchesAcc) return false;
                      const chatPart = k.includes('::') ? k.split('::').slice(1).join('::') : k;
                      // UpdateDeleteMessages only applies to private/basic-group dialogs, never tg_-100* supergroups/channels
                      return !chatPart.startsWith('tg_-100') && !chatPart.startsWith('-100');
                    });
                for (const key of candidateKeys) {
                  const list = prev[key];
                  if (!Array.isArray(list) || list.length === 0) continue;
                  const remaining = list.filter((m) => !matchesDeletedTgId(m));
                  if (remaining.length === list.length) continue;
                  anyChanged = true;
                  next[key] = remaining;
                }
                return anyChanged ? next : prev;
              });
              const summaryEntries = Object.entries(deletedLastSummaryByChat);
              if (summaryEntries.length > 0) {
                setChats((prev) =>
                  prev.map((c) => {
                    if (c.accountId !== targetAccountId) return c;
                    const hit = deletedLastSummaryByChat[c.id];
                    return hit ? { ...c, lastMessage: hit.summary } : c;
                  })
                );
                if (summaryEntries.some(([, v]) => v.needsDialogRefresh) && targetAccountId === currentAccId) {
                  void triggerAccountDialogRefreshRef.current?.(targetAccountId, { force: true });
                }
              }
              return;
            }

            if (updType === 'read_inbox') {
              const nextUnread = typeof upd.unreadCount === 'number' ? Math.max(0, upd.unreadCount) : 0;
              const nextReadInboxMaxId = typeof upd.readInboxMaxId === 'number' ? upd.readInboxMaxId : undefined;
              const override = recentDialogOverridesRef.current[msgBucketKey(targetAccountId, targetChatId)];
              if (
                override &&
                Date.now() - override.updatedAt < 15_000 &&
                override.unreadCount !== undefined &&
                override.unreadCount !== nextUnread
              ) {
                return;
              }
              setChats((prev) =>
                prev.map((c) =>
                  c.id === targetChatId && c.accountId === targetAccountId
                    ? {
                        ...c,
                        unreadCount: nextUnread,
                        ...(nextReadInboxMaxId
                          ? { readInboxMaxId: Math.max(c.readInboxMaxId || 0, nextReadInboxMaxId) }
                          : {}),
                      }
                    : c
                )
              );
              return;
            }

            if (updType === 'dialog_pinned') {
              if (upd.needsDialogRefresh && targetAccountId === currentAccId) {
                void triggerAccountDialogRefreshRef.current?.(targetAccountId, { force: true });
              }
              const nextPinned = Boolean(upd.isPinned);
              const nextPinOrder = nextPinned ? (typeof upd.pinOrder === 'number' ? upd.pinOrder : -Date.now()) : undefined;
              const hasExplicitFolder = upd.folderId !== undefined && upd.folderId !== null;
              const isArchivedTarget = Number(upd.folderId || 0) === 1;
              const override = recentDialogOverridesRef.current[msgBucketKey(targetAccountId, targetChatId)];
              if (
                override &&
                Date.now() - override.updatedAt < 15_000 &&
                override.isPinned !== undefined &&
                override.isPinned !== nextPinned
              ) {
                return;
              }
              setChats((prev) =>
                prev.map((c) =>
                  c.id === targetChatId &&
                  c.accountId === targetAccountId &&
                  (!hasExplicitFolder || Boolean(c.isArchived) === isArchivedTarget)
                    ? { ...c, isPinned: nextPinned, pinOrder: nextPinOrder }
                    : c
                )
              );
              return;
            }

            if (updType === 'dialogs_pinned_order') {
              if (upd.needsDialogRefresh && targetAccountId === currentAccId) {
                void triggerAccountDialogRefreshRef.current?.(targetAccountId, { force: true });
              }
              if (Array.isArray(upd.pinnedChatOrder)) {
                const isArchivedTarget = Number(upd.folderId || 0) === 1;
                const orderIndexMap = new Map<string, number>();
                (upd.pinnedChatOrder as string[]).forEach((cid, idx) => orderIndexMap.set(String(cid), idx));
                setChats((prev) =>
                  prev.map((c) => {
                    if (c.accountId !== targetAccountId || Boolean(c.isArchived) !== isArchivedTarget) return c;
                    const nextIdx = orderIndexMap.get(c.id);
                    const nextPinned = nextIdx !== undefined;
                    const override = recentDialogOverridesRef.current[msgBucketKey(targetAccountId, c.id)];
                    if (
                      override &&
                      Date.now() - override.updatedAt < 15_000 &&
                      override.isPinned !== undefined &&
                      override.isPinned !== nextPinned
                    ) {
                      return c;
                    }
                    return {
                      ...c,
                      isPinned: nextPinned,
                      pinOrder: nextPinned ? nextIdx : undefined,
                    };
                  })
                );
              }
              return;
            }

            if (updType === 'dialog_unread_mark') {
              const nextUnreadMark = Boolean(upd.unreadMark);
              const override = recentDialogOverridesRef.current[msgBucketKey(targetAccountId, targetChatId)];
              if (
                override &&
                Date.now() - override.updatedAt < 15_000 &&
                override.unreadCount !== undefined &&
                (override.unreadCount > 0) !== nextUnreadMark
              ) {
                return;
              }
              setChats((prev) =>
                prev.map((c) =>
                  c.id === targetChatId && c.accountId === targetAccountId
                    ? { ...c, unreadCount: nextUnreadMark ? Math.max(1, c.unreadCount || 0) : 0 }
                    : c
                )
              );
              return;
            }

            if (updType === 'dialog_muted') {
              const nextMuted = Boolean(upd.isMuted);
              const override = recentDialogOverridesRef.current[msgBucketKey(targetAccountId, targetChatId)];
              if (
                override &&
                Date.now() - override.updatedAt < 15_000 &&
                override.isMuted !== undefined &&
                override.isMuted !== nextMuted
              ) {
                return;
              }
              setChats((prev) =>
                prev.map((c) =>
                  c.id === targetChatId && c.accountId === targetAccountId
                    ? { ...c, isMuted: nextMuted }
                    : c
                )
              );
              return;
            }

            if (updType === 'dialog_archived') {
              const nextArchived = Boolean(upd.isArchived);
              const overrideKey = msgBucketKey(targetAccountId, targetChatId);
              const override = recentDialogOverridesRef.current[overrideKey];
              if (
                override &&
                Date.now() - override.updatedAt < 15_000 &&
                override.isArchived !== undefined &&
                override.isArchived !== nextArchived
              ) {
                return;
              }
              const existsInCurrent = currentChats.some(
                (c) => c.id === targetChatId && c.accountId === targetAccountId
              );
              if ((!existsInCurrent || upd.needsDialogRefresh) && targetAccountId === currentAccId) {
                void triggerAccountDialogRefreshRef.current?.(targetAccountId, { force: true });
              }
              setChats((prev) =>
                prev.map((c) =>
                  c.id === targetChatId && c.accountId === targetAccountId
                    ? { ...c, isArchived: nextArchived }
                    : c
                )
              );
              return;
            }

            if (updType === 'self_profile') {
              const nextName =
                typeof upd.profileName === 'string' && upd.profileName.trim()
                  ? upd.profileName.trim()
                  : undefined;
              const nextUsername = typeof upd.profileUsername === 'string' ? upd.profileUsername : undefined;
              const nextAvatarUrl =
                typeof upd.profileAvatarUrl === 'string' && upd.profileAvatarUrl
                  ? upd.profileAvatarUrl
                  : undefined;
              setAccounts((prev) =>
                prev.map((a) =>
                  a.id === targetAccountId
                    ? {
                        ...a,
                        ...(nextName ? { name: nextName, avatarInitial: nextName.slice(0, 2).toUpperCase() } : {}),
                        ...(nextUsername !== undefined ? { username: nextUsername } : {}),
                        ...(nextAvatarUrl ? { avatarUrl: nextAvatarUrl } : {}),
                      }
                    : a
                )
              );
              return;
            }

            if (updType === 'folders_updated') {
              if (targetAccountId.startsWith('acc_tg_')) {
                fetchTelegramDialogFiltersApi(targetAccountId)
                  .then((fRes) => {
                    if (fRes.ok && Array.isArray(fRes.folders)) {
                      setFoldersByAccount((prev) => ({ ...prev, [targetAccountId]: fRes.folders! }));
                    }
                  })
                  .catch(() => {});
              }
              if (targetAccountId === activeAccountIdRef.current) {
                setTelegramSettingsRefreshNonce((n) => n + 1);
              }
              return;
            }

            if (updType === 'peer_profile' || updType === 'chat_meta') {
              const nextTitle =
                typeof upd.profileName === 'string' && upd.profileName.trim() ? upd.profileName.trim() : undefined;
              const nextUsername = typeof upd.profileUsername === 'string' ? upd.profileUsername : undefined;
              const nextAvatar =
                typeof upd.profileAvatarUrl === 'string' && upd.profileAvatarUrl ? upd.profileAvatarUrl : undefined;
              setChats((prev) =>
                prev.map((c) =>
                  c.id === targetChatId && c.accountId === targetAccountId
                    ? {
                        ...c,
                        ...(nextTitle ? { title: nextTitle, avatarInitial: nextTitle.slice(0, 2).toUpperCase() } : {}),
                        ...(nextUsername !== undefined ? { username: nextUsername.replace(/^@/, '') } : {}),
                        ...(nextAvatar ? { avatarUrl: nextAvatar } : {}),
                      }
                    : c
                )
              );
              if (updType === 'peer_profile' && targetAccountId === activeAccountIdRef.current) {
                setContacts((prev) => {
                  let changed = false;
                  const next = prev.map((ct) => {
                    if (ct.id !== targetChatId) return ct;
                    changed = true;
                    return {
                      ...ct,
                      ...(nextTitle ? { name: nextTitle } : {}),
                      ...(nextUsername !== undefined ? { username: nextUsername.replace(/^@/, '') } : {}),
                      ...(nextAvatar ? { avatarUrl: nextAvatar } : {}),
                    };
                  });
                  if (changed) {
                    saveScopedContacts(next, targetAccountId);
                  }
                  return changed ? next : prev;
                });
              }
              return;
            }

            if (updType === 'settings_updated') {
              if (targetAccountId === activeAccountIdRef.current) {
                setTelegramSettingsRefreshNonce((n) => n + 1);
              }
              return;
            }

            if (updType === 'read_outbox') {
              const maxId = Number(upd.readOutboxMaxId);
              if (!Number.isInteger(maxId) || maxId <= 0) return;
              setChats((prev) =>
                prev.map((c) =>
                  c.id === targetChatId && c.accountId === targetAccountId
                    ? { ...c, readOutboxMaxId: Math.max(c.readOutboxMaxId || 0, maxId) }
                    : c
                )
              );
              return;
            }

            if (updType === 'pin') {
              const pinnedTgIds = new Set<number>(
                Array.isArray(upd.pinnedMessageIds)
                  ? upd.pinnedMessageIds.map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
                  : []
              );
              if (pinnedTgIds.size === 0) return;
              const targetBucketKey = msgBucketKey(targetAccountId, targetChatId);
              const nextPinned = Boolean(upd.pinned);
              setMessagesMap((prev) => {
                const list = getBucketMessages(prev, targetAccountId, targetChatId);
                if (list.length === 0) return prev;
                let changed = false;
                const updated = list.map((m) => {
                  const mTgId = resolveClientTelegramMessageId(m);
                  if (mTgId !== undefined && pinnedTgIds.has(mTgId)) {
                    changed = true;
                    return { ...m, isPinned: nextPinned };
                  }
                  return m;
                });
                if (!changed) return prev;
                return { ...prev, [targetBucketKey]: updated };
              });
              return;
            }

            if (updType === 'reactions') {
              const reactedTgId = typeof upd.telegramMessageId === 'number' ? upd.telegramMessageId : undefined;
              if (!reactedTgId) return;
              const targetBucketKey = msgBucketKey(targetAccountId, targetChatId);
              const nextReactions =
                upd.reactions && typeof upd.reactions === 'object' ? (upd.reactions as Record<string, number>) : {};
              const nextMyReactions = Array.isArray(upd.myReactions) ? (upd.myReactions as string[]) : [];
              setMessagesMap((prev) => {
                const list = getBucketMessages(prev, targetAccountId, targetChatId);
                if (list.length === 0) return prev;
                let changed = false;
                const updated = list.map((m) => {
                  if (resolveClientTelegramMessageId(m) === reactedTgId) {
                    changed = true;
                    return {
                      ...m,
                      reactions: Object.keys(nextReactions).length > 0 ? nextReactions : undefined,
                      myReactions: nextMyReactions.length > 0 ? nextMyReactions : undefined,
                    };
                  }
                  return m;
                });
                if (!changed) return prev;
                return { ...prev, [targetBucketKey]: updated };
              });
              return;
            }

            if (updType === 'user_status') {
              const nextOnline = Boolean(upd.isOnline);
              const nextStatusText = typeof upd.statusText === 'string' ? upd.statusText : undefined;
              setChats((prev) =>
                prev.map((c) =>
                  c.id === targetChatId && c.accountId === targetAccountId
                    ? { ...c, isOnline: nextOnline, ...(nextStatusText ? { statusText: nextStatusText } : {}) }
                    : c
                )
              );
              if (targetAccountId === activeAccountIdRef.current) {
                setContacts((prev) => {
                  let changed = false;
                  const next = prev.map((ct) => {
                    if (ct.id === targetChatId) {
                      changed = true;
                      return {
                        ...ct,
                        status: nextOnline ? ('online' as const) : ('offline' as const),
                        ...(nextStatusText ? { statusText: nextStatusText } : {}),
                      };
                    }
                    return ct;
                  });
                  if (changed) {
                    saveScopedContacts(next, targetAccountId);
                  }
                  return changed ? next : prev;
                });
              }
              return;
            }

            if (updType === 'phone_call_ringing') {
              const matchedCallerChat = currentChats.find(
                (c) => c.id === targetChatId && c.accountId === targetAccountId
              );
              const callerTitle = matchedCallerChat?.title || upd.senderName || `Telegram (${targetChatId.replace(/^tg_/, '')})`;
              showCloudError(`${upd.isVideoCall ? '📹' : '📞'} ${callerTitle} 正在向您发起${upd.isVideoCall ? '视频' : '语音'}通话`);
              return;
            }

            if (updType === 'peer_blocked') {
              const nextBlocked = Boolean(upd.isBlocked);
              setChats((prev) =>
                prev.map((c) =>
                  c.id === targetChatId && c.accountId === targetAccountId
                    ? { ...c, isBlocked: nextBlocked }
                    : c
                )
              );
              if (targetAccountId === activeAccountIdRef.current) {
                setContacts((prev) => {
                  let changed = false;
                  const next = prev.map((ct) => {
                    if (ct.id === targetChatId) {
                      changed = true;
                      return { ...ct, isBlocked: nextBlocked };
                    }
                    return ct;
                  });
                  if (changed) {
                    saveScopedContacts(next, targetAccountId);
                  }
                  return changed ? next : prev;
                });
              }
              return;
            }

            const incomingMsg: Message = {
              id: upd.id || `upd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              chatId: targetChatId,
              accountId: targetAccountId,
              telegramMessageId: typeof upd.telegramMessageId === 'number' ? upd.telegramMessageId : undefined,
              sender: upd.sender || 'peer',
              senderName: isOfficialNotice ? officialTitle : (upd.senderName || ''),
              senderId: upd.senderId,
              senderAvatarUrl: upd.senderAvatarUrl,
              text: upd.text || '',
              translatedText: upd.translatedText,
              isAudio: Boolean(upd.isAudio),
              audioDuration: upd.audioDuration,
              audioUrl: upd.audioUrl,
              isVideo: Boolean(upd.isVideo),
              videoDuration: upd.videoDuration,
              videoWidth: upd.videoWidth,
              videoHeight: upd.videoHeight,
              videoUrl: upd.videoUrl,
              isImage: Boolean(upd.isImage),
              imageUrl: upd.imageUrl,
              imageCaption: upd.imageCaption,
              isFile: Boolean(upd.isFile),
              fileName: upd.fileName,
              fileSize: upd.fileSize,
              fileUrl: upd.fileUrl,
              isCall: Boolean(upd.isCall),
              callType: upd.callType,
              callDuration: typeof upd.callDuration === 'number' ? upd.callDuration : undefined,
              isVideoCall: Boolean(upd.isVideoCall),
              telegramCallId: upd.telegramCallId,
              replyTo: upd.replyTo,
              forwardFrom: upd.forwardFrom,
              isPinned: Boolean(upd.isPinned),
              isEdited: Boolean(upd.isEdited),
              sttText: upd.sttText,
              createdAt: typeof upd.createdAt === 'number' ? upd.createdAt : Date.now(),
              timestamp: upd.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
              status: 'sent',
              deliveryStatus: 'delivered',
            };

            const targetBucketKey = msgBucketKey(targetAccountId, targetChatId);
            const existingForChat = getBucketMessages(messagesMapRef.current, targetAccountId, targetChatId);
            const incomingTgId = resolveClientTelegramMessageId(incomingMsg);
            const matchesMessage = (m: Message) => {
              if (m.id === incomingMsg.id) return true;
              const existingTgId = resolveClientTelegramMessageId(m);
              if (existingTgId !== undefined && incomingTgId !== undefined) {
                return existingTgId === incomingTgId;
              }
              // Only fall back to text matching when at least one side lacks a cloud telegramMessageId (e.g. optimistic outbound)
              if (
                m.sender === incomingMsg.sender &&
                m.text &&
                incomingMsg.text &&
                m.text.trim() === incomingMsg.text.trim()
              ) {
                const sameMinute = m.timestamp === incomingMsg.timestamp;
                const closeInTime =
                  typeof m.createdAt === 'number' &&
                  typeof incomingMsg.createdAt === 'number' &&
                  Math.abs(m.createdAt - incomingMsg.createdAt) < 120000;
                if (sameMinute || closeInTime) return true;
              }
              return false;
            };
            const isDuplicateMsg = existingForChat.some(matchesMessage);

            if (!isDuplicateMsg) {
              saveLocalMessage(targetChatId, incomingMsg, targetAccountId);
              messagesMapRef.current = {
                ...messagesMapRef.current,
                [targetBucketKey]: [...existingForChat, incomingMsg],
              };
            } else if (incomingMsg.translatedText || incomingTgId !== undefined) {
              saveLocalMessage(targetChatId, incomingMsg, targetAccountId);
            }

            setMessagesMap((prev) => {
              const currentList = getBucketMessages(prev, targetAccountId, targetChatId);
              const foundIdx = currentList.findIndex(matchesMessage);

              if (foundIdx >= 0) {
                const existing = currentList[foundIdx];
                const needsTranslation = Boolean(incomingMsg.translatedText && !existing.translatedText);
                const needsTgId = Boolean(incomingTgId !== undefined && !existing.telegramMessageId);
                const needsStt = Boolean(incomingMsg.sttText && !existing.sttText);
                if (needsTranslation || needsTgId || needsStt) {
                  const updated = [...currentList];
                  updated[foundIdx] = {
                    ...existing,
                    ...(needsTranslation ? { translatedText: incomingMsg.translatedText } : {}),
                    ...(needsTgId ? { telegramMessageId: incomingTgId } : {}),
                    ...(needsStt ? { sttText: incomingMsg.sttText } : {}),
                  };
                  return {
                    ...prev,
                    [targetBucketKey]: updated,
                  };
                }
                return prev;
              }

              return {
                ...prev,
                [targetBucketKey]: [...currentList, incomingMsg],
              };
            });

            if (isDuplicateMsg) {
              return;
            }

            if (
              incomingMsg.sender === 'peer' &&
              targetChatId === activeChatIdRef.current &&
              targetAccountId === activeAccountIdRef.current &&
              targetChatId.startsWith('tg_') &&
              targetAccountId !== 'acc_telegram_bot'
            ) {
              if (isAppWindowActivelyFocused()) {
                pendingAutoReadOnFocusRef.current = null;
                markTelegramDialogReadApi({
                  accountId: targetAccountId,
                  chatId: targetChatId,
                  maxId: incomingMsg.telegramMessageId,
                }).catch(() => {});
              } else {
                const prevPending = pendingAutoReadOnFocusRef.current;
                const nextMaxId = Math.max(
                  prevPending && prevPending.chatId === targetChatId && prevPending.accountId === targetAccountId
                    ? (prevPending.maxId || 0)
                    : 0,
                  incomingMsg.telegramMessageId || 0
                );
                pendingAutoReadOnFocusRef.current = {
                  accountId: targetAccountId,
                  chatId: targetChatId,
                  ...(nextMaxId > 0 ? { maxId: nextMaxId } : {}),
                };
              }
            }

            // Real Auto-translate inbound message if enabled (using latest settings & chat language)
            const matchedChatForLang = currentChats.find(
              (c) => c.id === targetChatId && c.accountId === targetAccountId
            );
            const resolvedGlobalTargetLang =
              currentTransSettings.defaultTargetLang && currentTransSettings.defaultTargetLang !== 'Auto'
                ? currentTransSettings.defaultTargetLang
                : 'Chinese';
            const inboundTargetLang =
              matchedChatForLang?.targetLang && matchedChatForLang.targetLang !== 'Auto'
                ? matchedChatForLang.targetLang
                : resolvedGlobalTargetLang;

            const trimmedIncomingText = (incomingMsg.text || '').trim();
            const isMediaPlaceholder =
              Boolean(incomingMsg.isCall) ||
              !trimmedIncomingText ||
              /^\[(语音|视频|图片|多媒体|文件)消息\]$/.test(trimmedIncomingText) ||
              trimmedIncomingText.startsWith('🎤') ||
              trimmedIncomingText.startsWith('🖼️') ||
              trimmedIncomingText.startsWith('🎬') ||
              trimmedIncomingText.startsWith('📁') ||
              trimmedIncomingText.startsWith('📞') ||
              trimmedIncomingText.startsWith('📹') ||
              trimmedIncomingText.startsWith('📵');

            const incomingIsGroup = Boolean(
              matchedChatForLang?.isGroup ||
                matchedChatForLang?.isChannel ||
                upd.isGroup ||
                upd.isChannel ||
                /^tg_-/.test(targetChatId)
            );
            const isIncomingChatTransEnabled =
              typeof matchedChatForLang?.translationEnabled === 'boolean'
                ? matchedChatForLang.translationEnabled
                : incomingIsGroup
                  ? currentTransSettings.autoTranslateGroups === true
                  : currentTransSettings.autoTranslatePrivate !== false;

            const incomingNormLang = normalizeLanguageCode(detectClientLangCode(trimmedIncomingText));
            const inboundTargetNorm = normalizeLanguageCode(inboundTargetLang);
            const isIncomingAlreadyTargetLang =
              incomingNormLang !== 'auto' &&
              inboundTargetNorm !== 'auto' &&
              (incomingNormLang === inboundTargetNorm ||
                (incomingNormLang === 'zh-cn' && inboundTargetNorm === 'zh') ||
                (incomingNormLang === 'zh' && inboundTargetNorm === 'zh-cn'));

            if (
              currentTransSettings.autoTranslateInbound !== false &&
              isIncomingChatTransEnabled &&
              incomingMsg.sender === 'peer' &&
              !isMediaPlaceholder &&
              !incomingMsg.translatedText &&
              !isIncomingAlreadyTargetLang
            ) {
              const effectiveInboundEngine = 'free_dual' as const;
              const inboundSourceLang =
                matchedChatForLang?.sourceLang && matchedChatForLang.sourceLang !== 'Auto'
                  ? matchedChatForLang.sourceLang
                  : 'Auto';
              const inboundDedupeKey = `${targetAccountId}::${targetChatId}::${incomingMsg.id}::${inboundTargetLang}::${effectiveInboundEngine}`;
              attemptedInboundBackfillRef.current.add(inboundDedupeKey);

              translateText(
                incomingMsg.text,
                inboundSourceLang,
                inboundTargetLang,
                currentLLMConfig,
                effectiveInboundEngine,
                currentTransSettings.googleApiKey,
                undefined,
                undefined,
                undefined,
                incomingIsGroup ? { purpose: 'group', isGroup: true } : { purpose: 'inbound' }
              )
                .then((trans) => {
                  if (trans && trans.trim() && trans.trim().toLowerCase() !== trimmedIncomingText.toLowerCase()) {
                    const withTrans: Message = {
                      ...incomingMsg,
                      translatedText: trans,
                      translationError: undefined,
                      translationErrorChannel: undefined,
                    };
                    saveLocalMessage(targetChatId, withTrans, targetAccountId);
                    updateMessageTranslationInDb(incomingMsg.id, trans, {
                      chatId: targetChatId,
                      telegramMessageId: incomingMsg.telegramMessageId,
                      accountId: targetAccountId,
                    }).catch(() => {});
                    setMessagesMap((prevMap) => {
                      const list = getBucketMessages(prevMap, targetAccountId, targetChatId);
                      return {
                        ...prevMap,
                        [targetBucketKey]: list.map((m) => (m.id === incomingMsg.id ? withTrans : m)),
                      };
                    });
                  }
                })
                .catch(() => {
                  const withErr: Message = {
                    ...incomingMsg,
                    translationError: '翻译失败，请检查翻译通道',
                    translationErrorChannel: engineToLiveErrorChannel(effectiveInboundEngine),
                  };
                  saveLocalMessage(targetChatId, withErr, targetAccountId);
                  setMessagesMap((prevMap) => {
                    const list = getBucketMessages(prevMap, targetAccountId, targetChatId);
                    return {
                      ...prevMap,
                      [targetBucketKey]: list.map((m) => (m.id === incomingMsg.id ? withErr : m)),
                    };
                  });
                });
            }

            if (incomingMsg.isCall && targetAccountId === currentAccId) {
              setCallRecords((prev) =>
                mergeCallMessagesIntoCallRecords(prev, [incomingMsg], currentChats, targetAccountId)
              );
            }

            const summaryText = formatChatMessageSummary(incomingMsg);
            const incomingEpochSec = Math.floor((incomingMsg.createdAt || Date.now()) / 1000);
            const matchedExistingChat = currentChats.find(
              (c) => c.id === targetChatId && c.accountId === targetAccountId
            );
            const hasChatInList = Boolean(matchedExistingChat);
            if (
              (!hasChatInList || (matchedExistingChat?.isArchived && !matchedExistingChat?.isMuted)) &&
              targetChatId.startsWith('tg_') &&
              targetAccountId === currentAccId
            ) {
              void triggerAccountDialogRefreshRef.current?.(targetAccountId);
            }

            const isWindowActivelyFocused = isAppWindowActivelyFocused();
            setChats((prev) => {
              const exists = prev.some((c) => c.id === targetChatId && c.accountId === targetAccountId);
              if (!exists) {
                const newChat: Chat = {
                  id: targetChatId,
                  accountId: targetAccountId,
                  title: isOfficialNotice ? officialTitle : (upd.senderName || `Telegram (${targetChatId.replace('tg_', '')})`),
                  unreadCount:
                    incomingMsg.sender === 'me' ||
                    (targetChatId === activeChatIdRef.current &&
                      targetAccountId === activeAccountIdRef.current &&
                      isWindowActivelyFocused)
                      ? 0
                      : 1,
                  lastMessage: summaryText,
                  lastTime: incomingMsg.timestamp,
                  lastDate: incomingEpochSec,
                  avatarInitial: isOfficialNotice ? 'TG' : (upd.senderName || 'TG').slice(0, 2).toUpperCase(),
                  avatarBg: '#2481cc',
                  isGroup: false,
                  isVerified: isOfficialNotice,
                  sourceLang: 'Auto',
                  targetLang: 'Auto',
                };
                return [newChat, ...prev];
              }
              return prev.map((c) =>
                c.id === targetChatId && c.accountId === targetAccountId
                  ? {
                      ...c,
                      title: isOfficialNotice ? officialTitle : c.title,
                      isVerified: isOfficialNotice ? true : c.isVerified,
                      lastMessage: summaryText,
                      lastTime: incomingMsg.timestamp,
                      lastDate: Math.max(c.lastDate || 0, incomingEpochSec),
                      unreadCount:
                        c.id === activeChatIdRef.current &&
                        c.accountId === activeAccountIdRef.current &&
                        isWindowActivelyFocused
                          ? 0
                          : incomingMsg.sender === 'me'
                            ? (c.unreadCount || 0)
                            : (c.unreadCount || 0) + 1,
                    }
                  : c
              );
            });
          });

          if (processedIds.length > 0) {
            await ackIncomingTelegramUpdates(processedIds);
          }
        }
      } catch (err) {
        // background poll non-fatal
      } finally {
        isPolling = false;
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [isMemberAuthenticated]);

  // Active Chats for currently selected account strictly isolated
  const currentAccountChats = chats.filter((c) => {
    if (!activeAccountId) return true;
    return c.accountId === activeAccountId;
  });
  const currentChat = currentAccountChats.find((c) => c.id === activeChatId) || null;
  const currentMessages = activeChatId ? getBucketMessages(messagesMap, activeAccountId, activeChatId) : [];

  // Handle select chat (Saved Messages connects to real 'me' / InputPeerSelf cloud dialog)
  const handleSelectChat = async (chatId: string) => {
    const callSeq = ++selectChatSeqRef.current;
    const targetAccId = activeAccountIdRef.current || activeAccountId;

    if (chatId === 'chat_saved_messages') {
      const res = await fetchTelegramSavedMessagesApi(targetAccId);
      if (!res.ok || !res.chat) {
        if (activeAccountIdRef.current === targetAccId && selectChatSeqRef.current === callSeq) {
          showCloudError(res.error || '当前账号未连接 Telegram，无法打开官方云端收藏夹 (Saved Messages)');
        }
        return;
      }
      const savedAccId = res.chat.accountId || targetAccId;
      const existingSaved = chatsRef.current.find(
        (c) => c.accountId === savedAccId && (c.id === res.chat!.id || c.id === 'chat_saved_messages')
      );
      const realSavedChat: Chat = {
        ...res.chat,
        accountId: savedAccId,
        unreadCount: 0,
        sourceLang: existingSaved?.sourceLang || res.chat.sourceLang || 'Auto',
        targetLang: existingSaved?.targetLang || res.chat.targetLang || 'Auto',
      };
      const cloudMsgs = Array.isArray(res.messages) ? res.messages : [];
      const bucketKey = msgBucketKey(savedAccId, realSavedChat.id);
      setChats((prev) => {
        const cleaned = prev.filter(
          (c) =>
            !(c.accountId === savedAccId && (c.id === 'chat_saved_messages' || c.id === realSavedChat.id))
        );
        return [realSavedChat, ...cleaned];
      });
      setMessagesMap((prev) => {
        const base = getBucketMessages(prev, savedAccId, realSavedChat.id);
        const localSaved = base.length > 0 ? base : getLocalMessages(realSavedChat.id, savedAccId);
        const merged = mergeCloudMessagesWithLocal(localSaved, cloudMsgs, {
          accountId: savedAccId,
          chatId: realSavedChat.id,
          allowEmptyCloudPrune: true,
        });
        return { ...prev, [bucketKey]: merged };
      });
      if (activeAccountIdRef.current === savedAccId && selectChatSeqRef.current === callSeq) {
        activeChatIdRef.current = realSavedChat.id;
        setActiveChatId(realSavedChat.id);
      }
      return;
    }

    activeChatIdRef.current = chatId;
    setActiveChatId(chatId);
    const targetChatObj = chatsRef.current.find(
      (c) => c.id === chatId && (!targetAccId || c.accountId === targetAccId)
    );
    const isWindowActivelyFocused = isAppWindowActivelyFocused();
    if (
      isWindowActivelyFocused ||
      (pendingAutoReadOnFocusRef.current &&
        (pendingAutoReadOnFocusRef.current.chatId !== chatId ||
          pendingAutoReadOnFocusRef.current.accountId !== targetAccId))
    ) {
      pendingAutoReadOnFocusRef.current = null;
    }
    setChats((prev) =>
      prev.map((c) =>
        isWindowActivelyFocused && c.id === chatId && (!targetAccId || c.accountId === targetAccId)
          ? { ...c, unreadCount: 0 }
          : c
      )
    );
    if (isWindowActivelyFocused && chatId.startsWith('tg_') && targetAccId !== 'acc_telegram_bot') {
      const existingMsgs = getBucketMessages(messagesMapRef.current, targetAccId, chatId);
      const fallbackMsgs = existingMsgs.length > 0 ? existingMsgs : getLocalMessages(chatId, targetAccId);
      const tgIds = fallbackMsgs
        .map((m) => m.telegramMessageId)
        .filter((id): id is number => typeof id === 'number' && id > 0);
      const maxTgId = tgIds.length > 0 ? Math.max(...tgIds) : undefined;
      if ((targetChatObj?.unreadCount || 0) > 0 || maxTgId !== undefined) {
        if ((targetChatObj?.unreadCount || 0) > 0 && targetAccId) {
          recordDialogMutationOverride(targetAccId, chatId, { unreadCount: 0 });
        }
        markTelegramDialogReadApi({
          accountId: targetAccId,
          chatId,
          ...(maxTgId ? { maxId: maxTgId } : {}),
        }).catch(() => {});
      }
    }
  };

  // Handle send message (local preview + streaming outbound delivery to server/Telegram)
  const handleSendMessage = (
    newMsg: Partial<Message> & { skipCloudRelay?: boolean; mediaFile?: File | Blob }
  ) => {
    const targetChatId = newMsg.chatId || activeChatIdRef.current || activeChatId;
    const targetAccountId = newMsg.accountId || activeAccountIdRef.current || activeAccountId;
    if (!targetChatId) return;

    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const senderRole = newMsg.sender || 'me';
    const isTelegramOutbound =
      senderRole === 'me' &&
      (targetChatId.startsWith('tg_') || targetAccountId === 'acc_telegram_bot');
    const mediaFile = newMsg.mediaFile;

    const fullMessage: Message = {
      id: newMsg.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      telegramMessageId: newMsg.telegramMessageId,
      chatId: targetChatId,
      accountId: targetAccountId,
      sender: senderRole,
      senderName: newMsg.senderName,
      text: newMsg.text || '',
      translatedText: newMsg.translatedText,
      isAudio: newMsg.isAudio,
      audioDuration: newMsg.audioDuration,
      audioUrl: newMsg.audioUrl,
      sttText: newMsg.sttText,
      voiceName: newMsg.voiceName,
      voiceTone: newMsg.voiceTone,
      isMasterVoice: newMsg.isMasterVoice,
      isImage: newMsg.isImage,
      imageUrl: newMsg.imageUrl,
      imageCaption: newMsg.imageCaption,
      isVideo: newMsg.isVideo,
      videoUrl: newMsg.videoUrl,
      videoDuration: newMsg.videoDuration,
      videoWidth: newMsg.videoWidth,
      videoHeight: newMsg.videoHeight,
      isFile: newMsg.isFile,
      fileName: newMsg.fileName,
      fileSize: newMsg.fileSize,
      fileUrl: newMsg.fileUrl,
      replyTo: newMsg.replyTo,
      createdAt: newMsg.createdAt || Date.now(),
      timestamp: newMsg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      status: 'sent',
      deliveryStatus: newMsg.deliveryStatus || (isTelegramOutbound ? 'pending' : 'delivered'),
    };

    if (mediaFile && !newMsg.skipCloudRelay) {
      pendingMediaFilesRef.current.set(fullMessage.id, mediaFile);
      const mediaField: PendingMediaField = fullMessage.isVideo
        ? 'videoUrl'
        : fullMessage.isImage
        ? 'imageUrl'
        : fullMessage.isAudio
        ? 'audioUrl'
        : 'fileUrl';
      const persistPromise = savePendingMediaBlob({
        accountId: targetAccountId,
        chatId: targetChatId,
        messageId: fullMessage.id,
        mediaField,
        blob: mediaFile,
        fileName: (mediaFile as File).name || fullMessage.fileName,
        mimeType: mediaFile.type,
        createdAt: fullMessage.createdAt,
      });
      pendingMediaSaveMapRef.current.set(fullMessage.id, persistPromise);
    }

    // 1. Store lightweight metadata in local client storage (blob:/huge base64 stripped automatically)
    saveLocalMessage(targetChatId, fullMessage, targetAccountId);

    setMessagesMap((prev) => ({
      ...prev,
      [bucketKey]: [...getBucketMessages(prev, targetAccountId, targetChatId), fullMessage],
    }));

    // 2. Update last message in chat list strictly scoped to targetAccountId
    setChats((prev) =>
      prev.map((c) =>
        c.id === targetChatId && (!targetAccountId || c.accountId === targetAccountId)
          ? {
              ...c,
              lastMessage: formatChatMessageSummary(fullMessage),
              lastTime: fullMessage.timestamp,
              lastDate: Math.max(c.lastDate || 0, Math.floor((fullMessage.createdAt || Date.now()) / 1000)),
            }
          : c
      )
    );

    if (newMsg.skipCloudRelay) {
      return;
    }

    // 3. Relay outbound via streaming multipart (when mediaFile present) or compact JSON
    saveMessageToDb(fullMessage, mediaFile ? { mediaFile } : undefined).then((result) => {
      const finalStatus = result.deliveryStatus;
      if (result.ok) {
        pendingMediaFilesRef.current.delete(fullMessage.id);
        void cleanupPersistedPendingMedia(targetAccountId, fullMessage.id);
        if (result.dialogState) {
          const ds = result.dialogState;
          const chatExistsInList = chatsRef.current.some(
            (c) => c.id === targetChatId && (!targetAccountId || c.accountId === targetAccountId)
          );
          if (!chatExistsInList && targetChatId.startsWith('tg_') && targetAccountId) {
            void triggerAccountDialogRefreshRef.current?.(targetAccountId, { force: true });
          }
          setChats((prev) =>
            prev.map((c) =>
              c.id === targetChatId && (!targetAccountId || c.accountId === targetAccountId)
                ? {
                    ...c,
                    isPinned: ds.isPinned,
                    isArchived: ds.isArchived,
                    isMuted: ds.isMuted,
                    unreadCount: ds.unreadCount,
                    ...(ds.readOutboxMaxId !== undefined ? { readOutboxMaxId: ds.readOutboxMaxId } : {}),
                    ...(ds.readInboxMaxId !== undefined ? { readInboxMaxId: ds.readInboxMaxId } : {}),
                    ...(ds.lastMessage ? { lastMessage: ds.lastMessage } : {}),
                    ...(ds.lastTime ? { lastTime: ds.lastTime } : {}),
                    ...(ds.lastDate > 0 ? { lastDate: ds.lastDate } : {}),
                  }
                : c
            )
          );
        }
      }

      if (result.code === 'TELEGRAM_SESSION_EXPIRED' && targetAccountId) {
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === targetAccountId ? { ...a, status: 'expired', bio: '会话已失效，请重新登录' } : a
          )
        );
        if (!notifiedExpiredRef.current.has(targetAccountId)) {
          notifiedExpiredRef.current.add(targetAccountId);
          showCloudError(result.error || 'Telegram 登录会话已失效，请重新扫码或验证码登录');
        }
      } else if (finalStatus === 'failed' && result.error) {
        showCloudError(result.error);
      }

      const replacedBlobUrls: string[] = [];
      if (result.imageUrl && fullMessage.imageUrl?.startsWith('blob:') && result.imageUrl !== fullMessage.imageUrl) {
        replacedBlobUrls.push(fullMessage.imageUrl);
      }
      if (result.videoUrl && fullMessage.videoUrl?.startsWith('blob:') && result.videoUrl !== fullMessage.videoUrl) {
        replacedBlobUrls.push(fullMessage.videoUrl);
      }
      if (result.audioUrl && fullMessage.audioUrl?.startsWith('blob:') && result.audioUrl !== fullMessage.audioUrl) {
        replacedBlobUrls.push(fullMessage.audioUrl);
      }
      if (result.fileUrl && fullMessage.fileUrl?.startsWith('blob:') && result.fileUrl !== fullMessage.fileUrl) {
        replacedBlobUrls.push(fullMessage.fileUrl);
      }

      setMessagesMap((prev) => {
        const list = getBucketMessages(prev, targetAccountId, targetChatId);
        if (list.length === 0) return prev;
        const updated = list.map((m) =>
          m.id === fullMessage.id
            ? {
                ...m,
                deliveryStatus: finalStatus,
                ...(result.telegramMessageId ? { telegramMessageId: result.telegramMessageId } : {}),
                ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
                ...(result.videoUrl ? { videoUrl: result.videoUrl } : {}),
                ...(result.audioUrl ? { audioUrl: result.audioUrl } : {}),
                ...(result.fileUrl ? { fileUrl: result.fileUrl } : {}),
              }
            : m
        );
        return { ...prev, [bucketKey]: updated };
      });
      scheduleRevokeBlobUrls(replacedBlobUrls);
    });
  };

  const handleRetryMessage = async (messageId: string): Promise<{ ok: boolean; error?: string }> => {
    const targetChatId = activeChatIdRef.current || activeChatId;
    const targetAccountId = activeAccountIdRef.current || activeAccountId;
    if (!targetChatId) return { ok: false, error: '未选中对话' };
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const targetMsg = getBucketMessages(messagesMapRef.current, targetAccountId, targetChatId).find(
      (m) => m.id === messageId
    );
    if (!targetMsg) return { ok: false, error: '未找到要重发的消息' };

    setMessagesMap((prev) => {
      const list = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = list.map((m) =>
        m.id === messageId ? { ...m, deliveryStatus: 'retrying' as const } : m
      );
      return { ...prev, [bucketKey]: updated };
    });

    let pendingMediaFile = pendingMediaFilesRef.current.get(messageId);
    const isMediaMessage = Boolean(targetMsg.isImage || targetMsg.isVideo || targetMsg.isAudio || targetMsg.isFile);
    if (!pendingMediaFile && isMediaMessage) {
      const storedRecord = await getPendingMediaBlob(targetAccountId, messageId);
      if (storedRecord?.blob) {
        pendingMediaFile = storedRecord.blob;
        pendingMediaFilesRef.current.set(messageId, storedRecord.blob);
      }
    }
    const result = await retryMessageDelivery(
      messageId,
      targetAccountId,
      targetMsg,
      pendingMediaFile ? { mediaFile: pendingMediaFile } : undefined
    );
    const nextStatus = result.deliveryStatus;
    if (result.ok) {
      pendingMediaFilesRef.current.delete(messageId);
      void cleanupPersistedPendingMedia(targetAccountId, messageId);
      if (result.dialogState) {
        const ds = result.dialogState;
        setChats((prev) =>
          prev.map((c) =>
            c.id === targetChatId && (!targetAccountId || c.accountId === targetAccountId)
              ? {
                  ...c,
                  isPinned: ds.isPinned,
                  isArchived: ds.isArchived,
                  isMuted: ds.isMuted,
                  unreadCount: ds.unreadCount,
                  ...(ds.readOutboxMaxId !== undefined ? { readOutboxMaxId: ds.readOutboxMaxId } : {}),
                  ...(ds.readInboxMaxId !== undefined ? { readInboxMaxId: ds.readInboxMaxId } : {}),
                  ...(ds.lastMessage ? { lastMessage: ds.lastMessage } : {}),
                  ...(ds.lastTime ? { lastTime: ds.lastTime } : {}),
                  ...(ds.lastDate > 0 ? { lastDate: ds.lastDate } : {}),
                }
              : c
          )
        );
      }
    }

    if (result.code === 'TELEGRAM_SESSION_EXPIRED' && targetAccountId) {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === targetAccountId ? { ...a, status: 'expired', bio: '会话已失效，请重新登录' } : a
        )
      );
      if (!notifiedExpiredRef.current.has(targetAccountId)) {
        notifiedExpiredRef.current.add(targetAccountId);
        showCloudError(result.error || 'Telegram 登录会话已失效，请重新扫码或验证码登录');
      }
    } else if (nextStatus === 'failed' && result.error) {
      showCloudError(result.error);
    }

    const replacedBlobUrls: string[] = [];
    if (result.imageUrl && targetMsg.imageUrl?.startsWith('blob:') && result.imageUrl !== targetMsg.imageUrl) {
      replacedBlobUrls.push(targetMsg.imageUrl);
    }
    if (result.videoUrl && targetMsg.videoUrl?.startsWith('blob:') && result.videoUrl !== targetMsg.videoUrl) {
      replacedBlobUrls.push(targetMsg.videoUrl);
    }
    if (result.audioUrl && targetMsg.audioUrl?.startsWith('blob:') && result.audioUrl !== targetMsg.audioUrl) {
      replacedBlobUrls.push(targetMsg.audioUrl);
    }
    if (result.fileUrl && targetMsg.fileUrl?.startsWith('blob:') && result.fileUrl !== targetMsg.fileUrl) {
      replacedBlobUrls.push(targetMsg.fileUrl);
    }
    if (result.ok && replacedBlobUrls.length > 0) {
      revokeRestoredBlobUrlsForMessage(targetAccountId, messageId);
    }

    setMessagesMap((prev) => {
      const list = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = list.map((m) =>
        m.id === messageId
          ? {
              ...m,
              deliveryStatus: nextStatus,
              ...(result.telegramMessageId ? { telegramMessageId: result.telegramMessageId } : {}),
              ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
              ...(result.videoUrl ? { videoUrl: result.videoUrl } : {}),
              ...(result.audioUrl ? { audioUrl: result.audioUrl } : {}),
              ...(result.fileUrl ? { fileUrl: result.fileUrl } : {}),
            }
          : m
      );
      return { ...prev, [bucketKey]: updated };
    });
    scheduleRevokeBlobUrls(replacedBlobUrls);

    return { ok: result.ok, error: result.error };
  };

  // Update contact remark / nickname (Cloud-first via contacts.AddContact)
  const handleUpdateChatTitle = async (
    chatId: string,
    newTitle: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const targetAccountId = activeAccountIdRef.current || activeAccountId;
    const trimmed = newTitle.trim();
    if (!trimmed) return { ok: false, error: '备注名称不能为空' };
    if (isTelegramCloudChat(chatId)) {
      const cloudRes = await renameTelegramContactApi({
        accountId: targetAccountId,
        chatId,
        newTitle: trimmed,
      });
      if (!cloudRes.ok) {
        const errMsg = cloudRes.error || '同步云端联系人备注失败';
        showCloudError(errMsg);
        return { ok: false, error: errMsg };
      }
    }
    if (targetAccountId) {
      recordDialogMutationOverride(targetAccountId, chatId, { title: trimmed });
    }
    setChats((prev) => {
      const updated = prev.map((c) =>
        c.id === chatId && (!targetAccountId || c.accountId === targetAccountId)
          ? { ...c, title: trimmed }
          : c
      );
      secureSetItemSync('tg_pro_chats', updated);
      return updated;
    });
    let updatedExistingContact = false;
    setContacts((prev) => {
      let changed = false;
      const next = prev.map((ct) => {
        if (ct.id === chatId) {
          changed = true;
          updatedExistingContact = true;
          return { ...ct, name: trimmed };
        }
        return ct;
      });
      if (changed) {
        saveScopedContacts(next, targetAccountId);
      }
      return changed ? next : prev;
    });
    if (!updatedExistingContact && isTelegramCloudChat(chatId) && targetAccountId.startsWith('acc_tg_')) {
      fetchTelegramUserContactsApi(targetAccountId)
        .then((res) => {
          if (res.ok && Array.isArray(res.contacts)) {
            handleSyncContacts(res.contacts, targetAccountId);
          }
        })
        .catch(() => {});
    }
    return { ok: true };
  };

  // Switch Active Telegram Account (account-level useEffect handles real dialog sync & per-account translation settings cleanly)
  const handleSelectAccount = (accountId: string) => {
    selectAccountSeqRef.current += 1;
    selectChatSeqRef.current += 1;
    pendingAutoSelectAccountRef.current = null;
    activeAccountIdRef.current = accountId;
    activeChatIdRef.current = null;
    clientPrefsScopeRef.current = accountId;
    setClientPrefs(loadStoredClientPrefs(accountId));
    callRecordsScopeRef.current = accountId;
    setCallRecords(loadScopedCallRecordsSync(accountId));
    translationAccountScopeRef.current = accountId;
    const nextLocalTrans =
      secureGetItemSync<any>(getScopedTranslationSettingsKey(accountId)) ??
      secureGetItemSync<any>('tg_pro_trans_settings');
    setTranslationSettings(
      enforceTranslationEngineForLlm(
        customLLMConfigRef.current,
        normalizeLoadedTranslationSettings(nextLocalTrans)
      )
    );
    setActiveAccountId(accountId);
    setActiveApiAccount(accountId);
    setActiveChatId(null);
    setCustomerProfile(null);
  };

  // Add new account and sync its real dialogs strictly isolated by accountId
  const handleAddAccount = (newAccountData: Partial<Account>) => {
    const id = newAccountData.id || `acc_${Date.now()}`;
    deletedAccountIdsRef.current.delete(id);
    notifiedExpiredRef.current.delete(id);
    setAccounts((prev) => {
      const existing = prev.find((a) => a.id === id);
      const newAcc: Account = {
        id,
        name: newAccountData.name || 'Telegram 账号',
        username: newAccountData.username || `@user_${id.slice(-4)}`,
        phone: newAccountData.phone || '',
        avatarUrl: newAccountData.avatarUrl,
        avatarBg: newAccountData.avatarBg || '#2481cc',
        avatarInitial: newAccountData.avatarInitial || 'TG',
        unreadTotal: 0,
        isActive: false,
        status: 'online',
        bio: newAccountData.bio || 'Telegram 账号',
        remark: newAccountData.remark ?? existing?.remark,
        groupId: newAccountData.groupId ?? existing?.groupId,
      };
      if (existing) {
        return prev.map((a) => (a.id === id ? newAcc : a));
      }
      return [...prev, newAcc];
    });
    handleSelectAccount(id);
  };

  // Delete account and clean up associated chats, messagesMap entries, and scoped encrypted caches
  const handleDeleteAccount = (id: string) => {
    deletedAccountIdsRef.current.add(id);
    notifiedExpiredRef.current.delete(id);
    const remaining = accounts.filter((a) => a.id !== id);
    const removedChats = chats.filter((c) => c.accountId === id);
    const remainingChats = chats.filter((c) => c.accountId !== id);
    const remainingChatIds = new Set(remainingChats.map((c) => c.id));
    const removedChatIds = removedChats.map((c) => c.id);
    const unsharedRemovedChatIds = removedChatIds.filter((cid) => !remainingChatIds.has(cid));

    const nextMessagesMap: Record<string, Message[]> = {};
    const removedAccountBlobUrls: string[] = [];
    for (const [key, msgs] of Object.entries(messagesMap)) {
      if (key.startsWith(`${id}::`)) {
        if (Array.isArray(msgs)) {
          msgs.forEach((m) => {
            pendingMediaFilesRef.current.delete(m.id);
            revokeRestoredBlobUrlsForMessage(id, m.id);
            if (m.imageUrl) removedAccountBlobUrls.push(m.imageUrl);
            if (m.videoUrl) removedAccountBlobUrls.push(m.videoUrl);
            if (m.audioUrl) removedAccountBlobUrls.push(m.audioUrl);
            if (m.fileUrl) removedAccountBlobUrls.push(m.fileUrl);
          });
        }
        continue;
      }
      if (key.includes('::')) {
        nextMessagesMap[key] = msgs;
        continue;
      }
      if (unsharedRemovedChatIds.includes(key)) {
        continue;
      }
      const filteredMsgs = Array.isArray(msgs) ? msgs.filter((m) => m.accountId !== id) : [];
      if (remainingChatIds.has(key)) {
        nextMessagesMap[key] = filteredMsgs;
      } else if (filteredMsgs.length > 0 && !removedChatIds.includes(key)) {
        nextMessagesMap[key] = filteredMsgs;
      }
    }
    scheduleRevokeBlobUrls(removedAccountBlobUrls);

    clearAccountLocalCache(id, unsharedRemovedChatIds);
    secureRemoveItem(getScopedTranslationSettingsKey(id));
    void clearAccountPendingMediaBlobs(id);

    setAccounts(remaining);
    setChats(remainingChats);
    setChatOrderByAccount((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setMessagesMap(nextMessagesMap);
    if (isHydrated) {
      secureSetItemSync('tg_pro_accounts', remaining);
      secureSetItemSync('tg_pro_chats', remainingChats);
    }

    if (activeAccountId === id) {
      if (remaining.length > 0) {
        handleSelectAccount(remaining[0].id);
      } else {
        setContacts([]);
        callRecordsScopeRef.current = '';
        setCallRecords([]);
        clientPrefsScopeRef.current = '';
        setClientPrefs({ ...DEFAULT_TELEGRAM_CLIENT_PREFS });
        setActiveAccountId('');
        setActiveApiAccount('');
        setActiveChatId(null);
        setCustomerProfile(null);
      }
    } else {
      setCallRecords((prev) => prev.filter((rec) => rec.accountId !== id));
      if (activeChatId && unsharedRemovedChatIds.includes(activeChatId)) {
        setActiveChatId(null);
        setCustomerProfile(null);
      }
    }
  };

  // Update per-chat translation language pair strictly scoped to activeAccountId (never mutate global defaultSourceLang/defaultTargetLang)
  const handleUpdateChatLanguage = (chatId: string, sourceLang: string, targetLang: string) => {
    let curEnabled: boolean | undefined;
    setChats((prev) => {
      const updated = prev.map((c) => {
        if (c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)) {
          curEnabled = c.translationEnabled;
          return { ...c, sourceLang, targetLang };
        }
        return c;
      });
      if (isHydrated) {
        secureSetItemSync('tg_pro_chats', updated);
      }
      return updated;
    });
    if (isMemberAuthenticated) {
      saveChatLanguagePrefApi(
        chatId,
        sourceLang,
        targetLang,
        activeAccountId,
        typeof curEnabled === 'boolean' ? curEnabled : null
      ).catch(() => {});
    }
  };

  const handleToggleChatTranslation = (chatId: string, enabled: boolean) => {
    let curSource = 'Auto';
    let curTarget = 'Auto';
    setChats((prev) => {
      const updated = prev.map((c) => {
        if (c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)) {
          curSource = c.sourceLang || 'Auto';
          curTarget = c.targetLang || 'Auto';
          return { ...c, translationEnabled: enabled };
        }
        return c;
      });
      if (isHydrated) {
        secureSetItemSync('tg_pro_chats', updated);
      }
      return updated;
    });
    if (isMemberAuthenticated) {
      saveChatLanguagePrefApi(chatId, curSource, curTarget, activeAccountId, enabled).catch(() => {});
    }
  };

  const handleSaveCustomLLMConfig = (
    nextConfig: CustomLLMConfig,
    nextTranslationSettings?: TranslationSettings
  ) => {
    customLLMConfigRef.current = nextConfig;
    setCustomLLMConfig(nextConfig);
    setTranslationSettings((prev) =>
      enforceTranslationEngineForLlm(
        nextConfig,
        nextTranslationSettings ? { ...prev, ...nextTranslationSettings } : prev
      )
    );
    if (isMemberAuthenticated) {
      syncCustomLLMConfigApi(nextConfig).catch(() => {});
    }
  };

  // Update global translation settings (enforces strict 3-state mutual exclusion; preserves per-chat overrides)
  const handleUpdateTranslationSettings = (newSettings: TranslationSettings) => {
    const latestLlmConfig = customLLMConfigRef.current;
    const isDualOff = Boolean(
      latestLlmConfig.enabled === false || latestLlmConfig.explicitlyDisabled
    );
    const isCustomPriority = Boolean(
      !isDualOff && latestLlmConfig.enabled && latestLlmConfig.engineMode === 'custom'
    );
    if (isDualOff && newSettings.preferredEngine !== 'google') {
      showCloudError('当前处于双关状态（云端与自有大模型均已关闭），仅支持使用「谷歌机翻」');
      return;
    }
    if (isCustomPriority && newSettings.preferredEngine === 'gemini') {
      showCloudError('已开启「优先自有密钥回复」，官方谷歌大模型已禁用，仅支持「谷歌机翻」或「自定义模型」');
      return;
    }
    if (!isDualOff && !isCustomPriority && newSettings.preferredEngine === 'custom_llm') {
      showCloudError('当前处于「官方大模型优先」状态，不可选择自定义模型；请前往「模型」开启「启用优先自有密钥回复」');
      return;
    }
    setTranslationSettings(newSettings);
  };

  // Message actions: delete, batch delete, forward, edit, reaction, pin, patch, clear (Cloud-first, block local fake mutation on failure)
  const handleDeleteMessage = async (
    messageId: string,
    options?: { revoke?: boolean }
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!activeChatId) return { ok: false, error: '未选中对话' };
    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const targetMsg = getBucketMessages(messagesMap, targetAccountId, targetChatId).find((m) => m.id === messageId);
    const targetTgId = resolveClientTelegramMessageId(targetMsg);
    const isLocalOnly = !targetTgId || targetMsg?.deliveryStatus === 'failed' || targetMsg?.deliveryStatus === 'pending';

    const delRes = await deleteMessageFromDb(
      messageId,
      targetAccountId,
      targetChatId,
      targetTgId,
      { revoke: options?.revoke ?? true, localOnly: isLocalOnly }
    );
    if (isTelegramCloudChat(targetChatId) && !isLocalOnly && !delRes.ok) {
      const errMsg = delRes.error || '云端撤回删除消息失败';
      showCloudError(errMsg);
      return { ok: false, error: errMsg };
    }

    pendingMediaFilesRef.current.delete(messageId);
    revokeRestoredBlobUrlsForMessage(targetAccountId, messageId);
    void cleanupPersistedPendingMedia(targetAccountId, messageId);
    if (targetMsg) {
      scheduleRevokeBlobUrls([targetMsg.imageUrl, targetMsg.videoUrl, targetMsg.audioUrl, targetMsg.fileUrl]);
    }
    recordDeletedMessageId(messageId, targetAccountId, targetChatId);
    deleteLocalMessage(targetChatId, messageId, targetAccountId);

    const snapshotRemaining = getBucketMessages(messagesMapRef.current, targetAccountId, targetChatId).filter(
      (m) => m.id !== messageId
    );
    setMessagesMap((prev) => {
      const currentList = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = currentList.filter((m) => m.id !== messageId);
      return { ...prev, [bucketKey]: updated };
    });

    if (snapshotRemaining.length > 0) {
      const last = snapshotRemaining[snapshotRemaining.length - 1];
      const summary = formatChatMessageSummary(last);
      setChats((chatList) =>
        chatList.map((c) =>
          c.id === targetChatId && (!targetAccountId || c.accountId === targetAccountId)
            ? {
                ...c,
                lastMessage: summary,
                lastTime: last.timestamp || c.lastTime,
                ...(typeof last.createdAt === 'number' && last.createdAt > 0
                  ? { lastDate: Math.floor(last.createdAt / 1000) }
                  : {}),
              }
            : c
        )
      );
    } else {
      setChats((chatList) =>
        chatList.map((c) =>
          c.id === targetChatId && (!targetAccountId || c.accountId === targetAccountId)
            ? { ...c, lastMessage: '暂无消息' }
            : c
        )
      );
    }

    return { ok: true };
  };

  const handleBatchDeleteMessages = async (
    messageIds: string[],
    options?: { revoke?: boolean }
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!activeChatId) return { ok: false, error: '未选中对话' };
    if (!Array.isArray(messageIds) || messageIds.length === 0) return { ok: false, error: '未选择任何消息' };
    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const currentList = getBucketMessages(messagesMap, targetAccountId, targetChatId);
    const idSet = new Set(messageIds);
    const items = currentList
      .filter((m) => idSet.has(m.id))
      .map((m) => {
        const resolvedTgId = resolveClientTelegramMessageId(m);
        return {
          id: m.id,
          telegramMessageId: resolvedTgId,
          localOnly: !resolvedTgId || m.deliveryStatus === 'failed' || m.deliveryStatus === 'pending',
        };
      });

    if (items.length === 0) return { ok: false, error: '未找到要删除的消息' };

    const res = await batchDeleteTelegramMessagesApi({
      accountId: targetAccountId,
      chatId: targetChatId,
      items,
      revoke: options?.revoke ?? true,
    });

    if (!res.ok) {
      const errMsg = res.error || '批量删除消息失败';
      showCloudError(errMsg);
      return { ok: false, error: errMsg };
    }

    messageIds.forEach((id) => {
      pendingMediaFilesRef.current.delete(id);
      revokeRestoredBlobUrlsForMessage(targetAccountId, id);
      void cleanupPersistedPendingMedia(targetAccountId, id);
      recordDeletedMessageId(id, targetAccountId, targetChatId);
    });
    const deletedBlobUrls: string[] = [];
    currentList.forEach((m) => {
      if (idSet.has(m.id)) {
        if (m.imageUrl) deletedBlobUrls.push(m.imageUrl);
        if (m.videoUrl) deletedBlobUrls.push(m.videoUrl);
        if (m.audioUrl) deletedBlobUrls.push(m.audioUrl);
        if (m.fileUrl) deletedBlobUrls.push(m.fileUrl);
      }
    });
    scheduleRevokeBlobUrls(deletedBlobUrls);
    const snapshotBatchRemaining = currentList.filter((m) => !idSet.has(m.id));
    setMessagesMap((prev) => {
      const list = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = list.filter((m) => !idSet.has(m.id));
      return { ...prev, [bucketKey]: updated };
    });

    if (snapshotBatchRemaining.length > 0) {
      const last = snapshotBatchRemaining[snapshotBatchRemaining.length - 1];
      const summary = formatChatMessageSummary(last);
      setChats((chatList) =>
        chatList.map((c) =>
          c.id === targetChatId && (!targetAccountId || c.accountId === targetAccountId)
            ? {
                ...c,
                lastMessage: summary,
                lastTime: last.timestamp || c.lastTime,
                ...(typeof last.createdAt === 'number' && last.createdAt > 0
                  ? { lastDate: Math.floor(last.createdAt / 1000) }
                  : {}),
              }
            : c
        )
      );
    } else {
      setChats((chatList) =>
        chatList.map((c) =>
          c.id === targetChatId && (!targetAccountId || c.accountId === targetAccountId)
            ? { ...c, lastMessage: '暂无消息' }
            : c
        )
      );
    }

    return { ok: true };
  };

  const handleForwardMessages = async (payload: {
    messageIds: string[];
    telegramMessageIds: number[];
    toChatId: string;
    dropAuthor?: boolean;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!activeChatId) return { ok: false, error: '未选中来源对话' };
    const fromChatId = activeChatId;
    const targetAccountId = activeAccountId;
    if (isTelegramCloudChat(fromChatId) && isTelegramCloudChat(payload.toChatId)) {
      const res = await forwardTelegramMessagesApi({
        accountId: targetAccountId,
        fromChatId,
        toChatId: payload.toChatId,
        messageIds: payload.messageIds,
        telegramMessageIds: payload.telegramMessageIds,
        dropAuthor: payload.dropAuthor,
      });
      if (!res.ok) {
        const errMsg = res.error || '云端转发消息失败';
        showCloudError(errMsg);
        return { ok: false, error: errMsg };
      }
      // Update target chat list summary cleanly (including video & file messages)
      const srcMsgs = getBucketMessages(messagesMap, targetAccountId, fromChatId);
      const lastForwarded = srcMsgs.filter((m) => payload.messageIds.includes(m.id)).slice(-1)[0];
      if (lastForwarded) {
        const summary = formatChatMessageSummary(lastForwarded, '转发消息');
        setChats((prev) =>
          prev.map((c) =>
            c.id === payload.toChatId && (!targetAccountId || c.accountId === targetAccountId)
              ? {
                  ...c,
                  lastMessage: summary,
                  lastTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
                  lastDate: Math.floor(Date.now() / 1000),
                }
              : c
          )
        );
      }
      // Immediately silently sync destination chat's latest cloud stream so target window stays up to date
      const toBucketKey = msgBucketKey(targetAccountId, payload.toChatId);
      fetchTelegramCloudMessagesApi(payload.toChatId, targetAccountId, { limit: 40 })
        .then((syncRes) => {
          if (!syncRes.ok) return;
          setChatHasMoreMap((prev) => ({ ...prev, [toBucketKey]: syncRes.hasMore }));
          const syncedMsgs = Array.isArray(syncRes.messages) ? syncRes.messages : [];
          if (syncedMsgs.length === 0 && syncRes.fromLocalFallback) return;
          setMessagesMap((prev) => {
            const base = getBucketMessages(prev, targetAccountId, payload.toChatId);
            const merged = mergeCloudMessagesWithLocal(
              base.length > 0 ? base : getLocalMessages(payload.toChatId, targetAccountId),
              syncedMsgs,
              {
                accountId: targetAccountId,
                chatId: payload.toChatId,
                allowEmptyCloudPrune: !syncRes.fromLocalFallback,
              }
            );
            return { ...prev, [toBucketKey]: merged };
          });
        })
        .catch(() => {});
      return { ok: true };
    }

    // Local/non-TG chat fallback: copy messages to target chat bucket
    const srcMsgs = getBucketMessages(messagesMap, targetAccountId, fromChatId);
    const toCopy = srcMsgs.filter((m) => payload.messageIds.includes(m.id));
    if (toCopy.length === 0) return { ok: false, error: '未找到要转发的消息' };
    const toBucketKey = msgBucketKey(targetAccountId, payload.toChatId);
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const cloned: Message[] = toCopy.map((m, idx) => ({
      ...m,
      id: `fwd_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      chatId: payload.toChatId,
      sender: 'me',
      forwardFrom: payload.dropAuthor ? undefined : (m.senderName || '转发消息'),
      createdAt: Date.now() + idx,
      timestamp: nowTime,
      deliveryStatus: 'delivered',
    }));
    setMessagesMap((prev) => {
      const existing = getBucketMessages(prev, targetAccountId, payload.toChatId);
      const next = [...existing, ...cloned];
      return { ...prev, [toBucketKey]: next };
    });
    const lastCloned = cloned[cloned.length - 1];
    if (lastCloned) {
      const summary = formatChatMessageSummary(lastCloned);
      setChats((prev) =>
        prev.map((c) =>
          c.id === payload.toChatId && (!targetAccountId || c.accountId === targetAccountId)
            ? { ...c, lastMessage: summary, lastTime: nowTime, lastDate: Math.floor(Date.now() / 1000) }
            : c
        )
      );
    }
    return { ok: true };
  };

  const handleLoadOlderMessages = async (
    chatId: string,
    offsetId: number
  ): Promise<{ ok: boolean; count: number; hasMore: boolean; error?: string }> => {
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, chatId);
    const currentMsgs = getBucketMessages(messagesMapRef.current, targetAccountId, chatId);
    const earliestCreatedAt = currentMsgs.reduce((min, m) => {
      if (typeof m.createdAt === 'number' && Number.isFinite(m.createdAt)) {
        return min === undefined ? m.createdAt : Math.min(min, m.createdAt);
      }
      return min;
    }, undefined as number | undefined);

    const loadSqliteOlderFallback = async (): Promise<{ ok: boolean; count: number; hasMore: boolean }> => {
      const dbOlder = await fetchMessagesFromDb(chatId, targetAccountId, {
        limit: 40,
        beforeCreatedAt: earliestCreatedAt,
      });
      const existingIds = new Set(currentMsgs.map((m) => m.id));
      const existingTgIds = new Set(
        currentMsgs
          .map((m) => m.telegramMessageId)
          .filter((id): id is number => typeof id === 'number')
      );
      const freshDbMsgs = dbOlder.filter(
        (m) =>
          m &&
          m.id &&
          !isMessageDeleted(m.id, targetAccountId, m.chatId || chatId) &&
          !existingIds.has(m.id) &&
          !(typeof m.telegramMessageId === 'number' && existingTgIds.has(m.telegramMessageId))
      );
      const hasMoreDb = dbOlder.length >= 40;
      setChatHasMoreMap((prev) => ({ ...prev, [bucketKey]: hasMoreDb }));
      if (freshDbMsgs.length > 0) {
        setMessagesMap((prev) => {
          const base = getBucketMessages(prev, targetAccountId, chatId);
          const merged = mergeCloudMessagesWithLocal(base, freshDbMsgs, {
            preserveAllLocal: true,
            accountId: targetAccountId,
            chatId,
          });
          return { ...prev, [bucketKey]: merged };
        });
      }
      return { ok: true, count: freshDbMsgs.length, hasMore: hasMoreDb };
    };

    if (!isTelegramCloudChat(chatId) || offsetId <= 0) {
      return await loadSqliteOlderFallback();
    }

    const res = await fetchTelegramCloudMessagesApi(chatId, targetAccountId, {
      limit: 40,
      offsetId,
    });
    if (!res.ok) {
      const sqliteRes = await loadSqliteOlderFallback();
      if (sqliteRes.count > 0) return sqliteRes;
      return { ok: false, count: 0, hasMore: false, error: res.error };
    }
    if (res.messages.length === 0) {
      return await loadSqliteOlderFallback();
    }
    setChatHasMoreMap((prev) => ({ ...prev, [bucketKey]: res.hasMore }));
    setMessagesMap((prev) => {
      const base = getBucketMessages(prev, targetAccountId, chatId);
      const merged = mergeCloudMessagesWithLocal(base, res.messages, {
        preserveAllLocal: true,
        accountId: targetAccountId,
        chatId,
      });
      return { ...prev, [bucketKey]: merged };
    });
    return { ok: true, count: res.messages.length, hasMore: res.hasMore };
  };

  const handleEditMessage = async (
    messageId: string,
    newText: string,
    options?: { translatedText?: string }
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!activeChatId) return { ok: false, error: '未选中对话' };
    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const targetMsg = getBucketMessages(messagesMap, targetAccountId, targetChatId).find((m) => m.id === messageId);

    if (isTelegramCloudChat(targetChatId)) {
      const editRes = await editTelegramMessageApi({
        accountId: targetAccountId,
        chatId: targetChatId,
        messageId,
        telegramMessageId: targetMsg?.telegramMessageId,
        newText,
        ...(options?.translatedText !== undefined ? { translatedText: options.translatedText } : {}),
      });
      if (!editRes.ok) {
        const errMsg = editRes.error || '云端编辑消息失败';
        showCloudError(errMsg);
        return { ok: false, error: errMsg };
      }
    }

    setMessagesMap((prev) => {
      const currentList = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = currentList.map((m) =>
        m.id === messageId
          ? {
              ...m,
              text: newText,
              isEdited: true,
              ...(m.isImage ? { imageCaption: newText } : {}),
              ...(options?.translatedText !== undefined
                ? { translatedText: options.translatedText, translationError: undefined }
                : {}),
            }
          : m
      );
      return { ...prev, [bucketKey]: updated };
    });
    return { ok: true };
  };

  const handleUpdateMessage = (
    messageId: string,
    patch: Partial<Message>,
    scope?: { chatId?: string; accountId?: string }
  ) => {
    const targetChatId = scope?.chatId || patch.chatId || activeChatIdRef.current || activeChatId;
    const targetAccountId = scope?.accountId || patch.accountId || activeAccountIdRef.current || activeAccountId;
    if (!targetChatId) return;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const existingMsg = getBucketMessages(messagesMapRef.current, targetAccountId, targetChatId).find(
      (m) => m.id === messageId
    );
    setMessagesMap((prev) => {
      const currentList = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = currentList.map((m) =>
        m.id === messageId ? { ...m, ...patch } : m
      );
      return { ...prev, [bucketKey]: updated };
    });
    if (typeof patch.sttText === 'string') {
      void updateMessageSttInDb(
        messageId,
        patch.sttText,
        typeof patch.translatedText === 'string' ? patch.translatedText : undefined,
        {
          chatId: targetChatId,
          telegramMessageId: existingMsg?.telegramMessageId,
          accountId: targetAccountId,
        }
      ).catch(() => {});
    } else if (typeof patch.translatedText === 'string') {
      void updateMessageTranslationInDb(messageId, patch.translatedText, {
        chatId: targetChatId,
        telegramMessageId: existingMsg?.telegramMessageId,
        accountId: targetAccountId,
      }).catch(() => {});
    }
  };

  const handleRetranslateMessage = async (
    messageId: string,
    fallbackMessage?: Message
  ): Promise<{
    translatedText?: string;
    translationError?: string;
    translationErrorChannel?: Message['translationErrorChannel'];
  } | void> => {
    const targetChatId = activeChatIdRef.current;
    const targetAccountId = activeAccountIdRef.current;
    if (!targetChatId) return;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const currentList = getBucketMessages(messagesMapRef.current, targetAccountId, targetChatId);
    const targetMsg =
      currentList.find((m) => m.id === messageId) ||
      (fallbackMessage && fallbackMessage.id === messageId ? fallbackMessage : undefined);
    if (!targetMsg) return;

    const rawText = (targetMsg.sttText || targetMsg.text || targetMsg.imageCaption || '').trim();
    if (
      targetMsg.isCall ||
      !rawText ||
      /^\[(语音|视频|图片|多媒体|文件)消息\]$/.test(rawText) ||
      rawText.startsWith('🎤') ||
      rawText.startsWith('🖼️') ||
      rawText.startsWith('🎬') ||
      rawText.startsWith('📁') ||
      rawText.startsWith('📞') ||
      rawText.startsWith('📹') ||
      rawText.startsWith('📵')
    ) {
      showCloudError('该消息暂无可翻译的文本内容');
      return;
    }

    const isHistoricalTarget =
      targetMsg.translationErrorChannel === 'history_google' ||
      (!targetMsg.translationErrorChannel &&
        Boolean(
          targetMsg.translationError &&
            (targetMsg.translationError.includes('历史') || targetMsg.translationError.includes('谷歌'))
        )) ||
      typeof targetMsg.createdAt !== 'number' ||
      Date.now() - targetMsg.createdAt > 120_000;

    const activeChat = chatsRef.current.find(
      (c) => c.id === targetChatId && (!targetAccountId || c.accountId === targetAccountId)
    );
    const isGroupTarget = Boolean(
      activeChat?.isGroup || activeChat?.isChannel || /^tg_-/.test(targetChatId)
    );
    const isInboundPeerTarget = targetMsg.sender === 'peer';
    const forceGoogleOnly = isHistoricalTarget || isGroupTarget || isInboundPeerTarget;
    const currentLlm = customLLMConfigRef.current;
    const currentTrans = translationSettingsRef.current;
    const effectiveEngine = isHistoricalTarget
      ? 'free_dual'
      : isGroupTarget || isInboundPeerTarget
      ? 'free_dual'
      : enforceTranslationEngineForLlm(currentLlm, currentTrans).preferredEngine;
    const resolvedGlobalTargetLang =
      currentTrans.defaultTargetLang && currentTrans.defaultTargetLang !== 'Auto'
        ? currentTrans.defaultTargetLang
        : 'Chinese';
    const targetLang =
      activeChat?.targetLang && activeChat.targetLang !== 'Auto'
        ? activeChat.targetLang
        : resolvedGlobalTargetLang;
    const sourceLang =
      activeChat?.sourceLang && activeChat.sourceLang !== 'Auto' ? activeChat.sourceLang : 'Auto';

    const detectedMsgNorm = normalizeLanguageCode(detectClientLangCode(rawText));
    const targetMsgNorm = normalizeLanguageCode(targetLang);
    const isAlreadyTargetLang =
      detectedMsgNorm !== 'auto' &&
      targetMsgNorm !== 'auto' &&
      (detectedMsgNorm === targetMsgNorm ||
        (detectedMsgNorm === 'zh-cn' && targetMsgNorm === 'zh') ||
        (detectedMsgNorm === 'zh' && targetMsgNorm === 'zh-cn'));
    if (isAlreadyTargetLang) {
      setMessagesMap((prev) => {
        const list = getBucketMessages(prev, targetAccountId, targetChatId);
        return {
          ...prev,
          [bucketKey]: list.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  translatedText: '',
                  isTranslating: false,
                  translationError: undefined,
                  translationErrorChannel: undefined,
                }
              : m
          ),
        };
      });
      await updateMessageTranslationInDb(messageId, '', {
        chatId: targetChatId,
        telegramMessageId: targetMsg.telegramMessageId,
        accountId: targetAccountId,
      }).catch(() => {});
      return { translatedText: '' };
    }

    setMessagesMap((prev) => {
      const list = getBucketMessages(prev, targetAccountId, targetChatId);
      return {
        ...prev,
        [bucketKey]: list.map((m) =>
          m.id === messageId
            ? { ...m, isTranslating: true, translationError: undefined, translationErrorChannel: undefined }
            : m
        ),
      };
    });

    try {
      const translated = await translateText(
        rawText,
        sourceLang,
        targetLang,
        currentLlm,
        effectiveEngine,
        currentTrans.googleApiKey,
        forceGoogleOnly ? undefined : currentTrans.geminiModel,
        forceGoogleOnly ? undefined : currentTrans.geminiApiKey,
        forceGoogleOnly ? undefined : currentTrans.customModelName,
        {
          bypassCache: true,
          priority: 'manual' as const,
          ...(isHistoricalTarget
            ? { purpose: 'history' as const }
            : isGroupTarget
            ? { purpose: 'group' as const, isGroup: true }
            : isInboundPeerTarget
            ? { purpose: 'inbound' as const }
            : {}),
        }
      );
      const cleanTranslated = (translated || '').trim();
      const isSameAsOriginal =
        !cleanTranslated || cleanTranslated.toLowerCase() === rawText.toLowerCase();
      const finalTranslatedText = isSameAsOriginal ? '' : translated;

      setMessagesMap((prev) => {
        const list = getBucketMessages(prev, targetAccountId, targetChatId);
        const updated = list.map((m) =>
          m.id === messageId
            ? {
                ...m,
                translatedText: finalTranslatedText,
                isTranslating: false,
                translationError: undefined,
                translationErrorChannel: undefined,
              }
            : m
        );
        return { ...prev, [bucketKey]: updated };
      });
      await updateMessageTranslationInDb(messageId, finalTranslatedText, {
        chatId: targetChatId,
        telegramMessageId: targetMsg.telegramMessageId,
        accountId: targetAccountId,
      });
      return { translatedText: finalTranslatedText };
    } catch {
      const errMsg = '翻译失败，请检查翻译通道';
      const errChannel: Message['translationErrorChannel'] = isHistoricalTarget
        ? 'history_google'
        : engineToLiveErrorChannel(effectiveEngine);
      setMessagesMap((prev) => {
        const list = getBucketMessages(prev, targetAccountId, targetChatId);
        const updated = list.map((m) =>
          m.id === messageId
            ? {
                ...m,
                isTranslating: false,
                translationError: errMsg,
                translationErrorChannel: errChannel,
              }
            : m
        );
        return { ...prev, [bucketKey]: updated };
      });
      showCloudError(errMsg);
      return { translationError: errMsg, translationErrorChannel: errChannel };
    }
  };

  const handleRefreshMediaUrls = async (
    urls: string[],
    accountIdOverride?: string
  ): Promise<Record<string, string>> => {
    const targetAccId = accountIdOverride || activeAccountIdRef.current || undefined;
    const validUrls = Array.from(
      new Set((Array.isArray(urls) ? urls : []).filter((u) => isSignedResourceUrl(u)))
    );
    if (validUrls.length === 0) return {};
    const refreshed = await refreshSignedResourceUrlsApi(validUrls, targetAccId);
    const entries = Object.entries(refreshed).filter(([, nextUrl]) => Boolean(nextUrl));
    if (entries.length === 0) return {};

    setChats((prev) => {
      let anyChatChanged = false;
      const updated = prev.map((c) => {
        if (c.avatarUrl && refreshed[c.avatarUrl]) {
          anyChatChanged = true;
          return { ...c, avatarUrl: refreshed[c.avatarUrl] };
        }
        return c;
      });
      return anyChatChanged ? updated : prev;
    });

    setMessagesMap((prev) => {
      let anyBucketChanged = false;
      const nextMap: Record<string, Message[]> = { ...prev };
      for (const [bKey, list] of Object.entries(prev)) {
        if (!Array.isArray(list) || list.length === 0) continue;
        let bucketChanged = false;
        const updatedList = list.map((m) => {
          const nextAudio = m.audioUrl && refreshed[m.audioUrl] ? refreshed[m.audioUrl] : undefined;
          const nextImg = m.imageUrl && refreshed[m.imageUrl] ? refreshed[m.imageUrl] : undefined;
          const nextVid = m.videoUrl && refreshed[m.videoUrl] ? refreshed[m.videoUrl] : undefined;
          const nextFile = m.fileUrl && refreshed[m.fileUrl] ? refreshed[m.fileUrl] : undefined;
          if (!nextAudio && !nextImg && !nextVid && !nextFile) return m;
          bucketChanged = true;
          return {
            ...m,
            ...(nextAudio ? { audioUrl: nextAudio } : {}),
            ...(nextImg ? { imageUrl: nextImg } : {}),
            ...(nextVid ? { videoUrl: nextVid } : {}),
            ...(nextFile ? { fileUrl: nextFile } : {}),
          };
        });
        if (bucketChanged) {
          anyBucketChanged = true;
          nextMap[bKey] = updatedList;
        }
      }
      return anyBucketChanged ? nextMap : prev;
    });

    return refreshed;
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!activeChatId) return;
    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const targetMsg = getBucketMessages(messagesMap, targetAccountId, targetChatId).find((m) => m.id === messageId);
    const hasReacted = Boolean(targetMsg?.myReactions?.includes(emoji));

    if (isTelegramCloudChat(targetChatId)) {
      const reactRes = await reactTelegramMessageApi({
        accountId: targetAccountId,
        chatId: targetChatId,
        messageId,
        telegramMessageId: targetMsg?.telegramMessageId,
        emoji,
        remove: hasReacted,
      });
      if (!reactRes.ok) {
        showCloudError(reactRes.error || '同步云端表情回应失败');
        return;
      }
    }

    setMessagesMap((prev) => {
      const currentList = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = currentList.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = { ...(m.reactions || {}) };
        const myReactions = [...(m.myReactions || [])];
        const mineNow = myReactions.includes(emoji);

        if (mineNow) {
          reactions[emoji] = Math.max(0, (reactions[emoji] || 1) - 1);
          if (reactions[emoji] === 0) delete reactions[emoji];
          const newMy = myReactions.filter((e) => e !== emoji);
          return { ...m, reactions, myReactions: newMy };
        } else {
          reactions[emoji] = (reactions[emoji] || 0) + 1;
          return { ...m, reactions, myReactions: [...myReactions, emoji] };
        }
      });
      return { ...prev, [bucketKey]: updated };
    });
  };

  const handleTogglePinMessage = async (messageId: string) => {
    if (!activeChatId) return;
    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const targetMsg = getBucketMessages(messagesMap, targetAccountId, targetChatId).find((m) => m.id === messageId);
    const willPin = !targetMsg?.isPinned;

    if (isTelegramCloudChat(targetChatId)) {
      const pinRes = await pinTelegramMessageApi({
        accountId: targetAccountId,
        chatId: targetChatId,
        messageId,
        telegramMessageId: targetMsg?.telegramMessageId,
        pin: willPin,
      });
      if (!pinRes.ok) {
        showCloudError(pinRes.error || '同步云端消息置顶失败');
        return;
      }
    }

    setMessagesMap((prev) => {
      const currentList = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = currentList.map((m) =>
        m.id === messageId ? { ...m, isPinned: willPin } : m
      );
      return { ...prev, [bucketKey]: updated };
    });
  };

  const handleClearHistory = async (
    chatId: string,
    options?: { revoke?: boolean }
  ): Promise<{ ok: boolean; error?: string }> => {
    const targetAccountId = activeAccountIdRef.current || activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, chatId);
    if (isTelegramCloudChat(chatId)) {
      const clearRes = await clearTelegramDialogHistoryApi({
        accountId: targetAccountId,
        chatId,
        revoke: options?.revoke,
      });
      if (!clearRes.ok) {
        const errMsg = clearRes.error || '清空云端聊天记录失败';
        showCloudError(errMsg);
        return { ok: false, error: errMsg };
      }
    }
    const clearedMsgs = getBucketMessages(messagesMapRef.current, targetAccountId, chatId);
    const clearedBlobUrls: string[] = [];
    clearedMsgs.forEach((m) => {
      pendingMediaFilesRef.current.delete(m.id);
      revokeRestoredBlobUrlsForMessage(targetAccountId, m.id);
      if (m.imageUrl) clearedBlobUrls.push(m.imageUrl);
      if (m.videoUrl) clearedBlobUrls.push(m.videoUrl);
      if (m.audioUrl) clearedBlobUrls.push(m.audioUrl);
      if (m.fileUrl) clearedBlobUrls.push(m.fileUrl);
    });
    scheduleRevokeBlobUrls(clearedBlobUrls);
    void clearChatPendingMediaBlobs(targetAccountId, chatId);
    clearLocalMessages(chatId, clearedMsgs, targetAccountId);
    setMessagesMap((prev) => ({
      ...prev,
      [bucketKey]: [],
    }));
    if (targetAccountId) {
      recordDialogMutationOverride(targetAccountId, chatId, { lastMessage: '暂无消息', unreadCount: 0 });
    }
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (!targetAccountId || c.accountId === targetAccountId)
          ? { ...c, lastMessage: '暂无消息', unreadCount: 0 }
          : c
      )
    );
    return { ok: true };
  };

  const handleToggleMuteChat = async (chatId: string) => {
    const targetAccountId = activeAccountIdRef.current || activeAccountId;
    const targetChat = chats.find((c) => c.id === chatId && (!targetAccountId || c.accountId === targetAccountId));
    const nextMuted = !targetChat?.isMuted;
    if (isTelegramCloudChat(chatId)) {
      const res = await toggleTelegramDialogMuteApi({
        accountId: targetAccountId,
        chatId,
        muted: nextMuted,
      });
      if (!res.ok) {
        showCloudError(res.error || '同步云端静音设置失败');
        return;
      }
    }
    if (targetAccountId) {
      recordDialogMutationOverride(targetAccountId, chatId, { isMuted: nextMuted });
    }
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (!targetAccountId || c.accountId === targetAccountId)
          ? { ...c, isMuted: nextMuted }
          : c
      )
    );
  };

  const handleTogglePinChat = async (chatId: string) => {
    const targetAccountId = activeAccountIdRef.current || activeAccountId;
    const targetChat = chats.find((c) => c.id === chatId && (!targetAccountId || c.accountId === targetAccountId));
    const nextPinned = !targetChat?.isPinned;
    if (isTelegramCloudChat(chatId)) {
      const res = await toggleTelegramDialogPinApi({
        accountId: targetAccountId,
        chatId,
        pinned: nextPinned,
      });
      if (!res.ok) {
        showCloudError(res.error || '同步云端置顶对话失败');
        return;
      }
    }
    if (targetAccountId) {
      recordDialogMutationOverride(targetAccountId, chatId, { isPinned: nextPinned });
    }
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (!targetAccountId || c.accountId === targetAccountId)
          ? { ...c, isPinned: nextPinned, pinOrder: nextPinned ? -Date.now() : undefined }
          : c
      )
    );
  };

  const handleToggleArchiveChat = async (chatId: string) => {
    const targetAccountId = activeAccountIdRef.current || activeAccountId;
    const targetChat = chats.find((c) => c.id === chatId && (!targetAccountId || c.accountId === targetAccountId));
    const nextArchived = !targetChat?.isArchived;
    if (isTelegramCloudChat(chatId)) {
      const res = await toggleTelegramDialogArchiveApi({
        accountId: targetAccountId,
        chatId,
        archived: nextArchived,
      });
      if (!res.ok) {
        showCloudError(res.error || '同步云端归档失败');
        return;
      }
    }
    if (targetAccountId) {
      recordDialogMutationOverride(targetAccountId, chatId, { isArchived: nextArchived });
    }
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (!targetAccountId || c.accountId === targetAccountId)
          ? { ...c, isArchived: nextArchived }
          : c
      )
    );
  };

  const handleToggleMarkUnread = async (chatId: string) => {
    const targetAccountId = activeAccountIdRef.current || activeAccountId;
    const targetChat = chats.find((c) => c.id === chatId && (!targetAccountId || c.accountId === targetAccountId));
    const nextUnread = (targetChat?.unreadCount || 0) === 0;
    if (isTelegramCloudChat(chatId)) {
      const res = await toggleTelegramDialogUnreadApi({
        accountId: targetAccountId,
        chatId,
        unread: nextUnread,
      });
      if (!res.ok) {
        showCloudError(res.error || '同步云端已读/未读状态失败');
        return;
      }
    }
    if (targetAccountId) {
      if (
        nextUnread &&
        pendingAutoReadOnFocusRef.current?.chatId === chatId &&
        pendingAutoReadOnFocusRef.current?.accountId === targetAccountId
      ) {
        pendingAutoReadOnFocusRef.current = null;
      }
      recordDialogMutationOverride(targetAccountId, chatId, { unreadCount: nextUnread ? 1 : 0 });
    }
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId || (targetAccountId && c.accountId !== targetAccountId)) return c;
        return { ...c, unreadCount: nextUnread ? 1 : 0 };
      })
    );
  };

  const handleDeleteChat = async (chatId: string, options?: { revoke?: boolean }) => {
    const targetAccountId = activeAccountIdRef.current || activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, chatId);
    if (isTelegramCloudChat(chatId)) {
      const res = await deleteTelegramDialogApi({
        accountId: targetAccountId,
        chatId,
        revoke: options?.revoke,
      });
      if (!res.ok) {
        showCloudError(res.error || '云端删除/退出对话失败');
        return;
      }
    }
    const deletedChatMsgs = getBucketMessages(messagesMapRef.current, targetAccountId, chatId);
    const deletedChatBlobUrls: string[] = [];
    deletedChatMsgs.forEach((m) => {
      pendingMediaFilesRef.current.delete(m.id);
      revokeRestoredBlobUrlsForMessage(targetAccountId, m.id);
      if (m.imageUrl) deletedChatBlobUrls.push(m.imageUrl);
      if (m.videoUrl) deletedChatBlobUrls.push(m.videoUrl);
      if (m.audioUrl) deletedChatBlobUrls.push(m.audioUrl);
      if (m.fileUrl) deletedChatBlobUrls.push(m.fileUrl);
    });
    scheduleRevokeBlobUrls(deletedChatBlobUrls);
    void clearChatPendingMediaBlobs(targetAccountId, chatId);
    clearLocalMessages(chatId, deletedChatMsgs, targetAccountId);
    clearLocalCustomerProfile(chatId, targetAccountId);
    setMessagesMap((prev) => {
      const next = { ...prev };
      delete next[bucketKey];
      return next;
    });
    if (targetAccountId) {
      recordDialogMutationOverride(targetAccountId, chatId, { deleted: true });
    }
    setChats((prev) =>
      prev.filter((c) => !(c.id === chatId && (!targetAccountId || c.accountId === targetAccountId)))
    );
    if (activeChatIdRef.current === chatId) {
      activeChatIdRef.current = null;
      setActiveChatId(null);
      setCustomerProfile(null);
    }
  };

  const handleCreateGroup = (newChat: Chat) => {
    const chatToSave: Chat = {
      ...newChat,
      accountId: activeAccountId || newChat.accountId || '',
    };
    setChats((prev) => [
      chatToSave,
      ...prev.filter((c) => !(c.id === chatToSave.id && (!chatToSave.accountId || c.accountId === chatToSave.accountId))),
    ]);
    setActiveChatId(chatToSave.id);
  };

  const handleCreateChannel = (newChat: Chat) => {
    const chatToSave: Chat = {
      ...newChat,
      accountId: activeAccountId || newChat.accountId || '',
    };
    setChats((prev) => [
      chatToSave,
      ...prev.filter((c) => !(c.id === chatToSave.id && (!chatToSave.accountId || c.accountId === chatToSave.accountId))),
    ]);
    setActiveChatId(chatToSave.id);
  };

  const handleAddContact = (contact: TelegramContact) => {
    setContacts((prev) => {
      const next = [contact, ...prev.filter((c) => c.id !== contact.id)];
      saveScopedContacts(next, activeAccountIdRef.current);
      return next;
    });
  };

  const handleSyncContacts = (cloudContacts: TelegramContact[], targetAccId?: string) => {
    const acc = targetAccId || activeAccountIdRef.current;
    const normalized = (Array.isArray(cloudContacts) ? cloudContacts : []).filter(
      (c) => c && c.id && !c.id.startsWith('contact_')
    );
    saveScopedContacts(normalized, acc);
    if (!targetAccId || targetAccId === activeAccountIdRef.current) {
      setContacts(normalized);
    }
    if (normalized.length > 0) {
      const contactById = new Map<string, TelegramContact>();
      normalized.forEach((ct) => contactById.set(ct.id, ct));
      const selfTgChatId = acc?.startsWith('acc_tg_') ? `tg_${acc.replace(/^acc_tg_/, '')}` : '';
      setChats((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          if (acc && c.accountId !== acc) return c;
          const ct = contactById.get(c.id);
          if (!ct) return c;
          const nextName = typeof ct.name === 'string' ? ct.name.trim() : '';
          const shouldUpdateTitle =
            Boolean(nextName) &&
            !c.isGroup &&
            !c.isChannel &&
            (!selfTgChatId || c.id !== selfTgChatId) &&
            c.title !== 'Saved Messages' &&
            c.title !== '我的收藏夹 (Saved Messages)' &&
            c.title !== nextName;
          const patched: Chat = {
            ...c,
            ...(shouldUpdateTitle
              ? { title: nextName, avatarInitial: nextName.slice(0, 2).toUpperCase() }
              : {}),
            ...(ct.phone ? { phone: ct.phone } : {}),
            ...(typeof ct.isBlocked === 'boolean' ? { isBlocked: ct.isBlocked } : {}),
            ...(ct.status ? { isOnline: ct.status === 'online' } : {}),
            ...(ct.statusText ? { statusText: ct.statusText } : {}),
          };
          if (
            patched.title !== c.title ||
            patched.phone !== c.phone ||
            patched.isBlocked !== c.isBlocked ||
            patched.isOnline !== c.isOnline ||
            patched.statusText !== c.statusText
          ) {
            changed = true;
          }
          return patched;
        });
        if (changed && isHydrated) {
          secureSetItemSync('tg_pro_chats', next);
        }
        return changed ? next : prev;
      });
    }
  };

  const handleRemoveContact = (contactId: string) => {
    setContacts((prev) => {
      const next = prev.filter((c) => c.id !== contactId);
      saveScopedContacts(next, activeAccountIdRef.current);
      return next;
    });
  };

  const handleContactBlockChanged = (contactId: string, isBlocked: boolean) => {
    setContacts((prev) => {
      const next = prev.map((c) => (c.id === contactId ? { ...c, isBlocked } : c));
      saveScopedContacts(next, activeAccountIdRef.current);
      return next;
    });
    setChats((prev) =>
      prev.map((c) =>
        c.id === contactId && (!activeAccountIdRef.current || c.accountId === activeAccountIdRef.current)
          ? { ...c, isBlocked }
          : c
      )
    );
  };

  const handleStartChatWithContact = (contact: TelegramContact) => {
    const targetChatId = contact.id.startsWith('tg_') ? contact.id : `chat_contact_${contact.id}`;
    const existing = chats.find(
      (c) =>
        (!activeAccountId || c.accountId === activeAccountId) &&
        (c.id === targetChatId ||
          c.id === contact.id ||
          c.title === contact.name ||
          (contact.username && c.username === contact.username))
    );
    if (existing) {
      if (
        (contact.phone && !existing.phone) ||
        (contact.statusText && !existing.statusText) ||
        typeof contact.isBlocked === 'boolean'
      ) {
        setChats((prev) =>
          prev.map((c) =>
            c.id === existing.id && c.accountId === existing.accountId
              ? {
                  ...c,
                  ...(contact.phone ? { phone: contact.phone } : {}),
                  ...(contact.status ? { isOnline: contact.status === 'online' } : {}),
                  ...(contact.statusText ? { statusText: contact.statusText } : {}),
                  ...(typeof contact.isBlocked === 'boolean' ? { isBlocked: contact.isBlocked } : {}),
                }
              : c
          )
        );
      }
      setActiveChatId(existing.id);
      setIsContactsOpen(false);
      return;
    }
    const newChat: Chat = {
      id: targetChatId,
      accountId: activeAccountId || '',
      title: contact.name,
      avatarUrl: contact.avatarUrl,
      avatarBg: contact.avatarBg || '#2ba0ff',
      avatarInitial: contact.avatarInitial || contact.name.slice(0, 2).toUpperCase(),
      isGroup: false,
      isVerified: false,
      username: contact.username,
      phone: contact.phone,
      isOnline: contact.status === 'online',
      statusText: contact.statusText || contact.bio,
      isBlocked: contact.isBlocked,
      description: contact.bio,
      lastMessage: '已发起会话',
      lastTime: '刚刚',
      unreadCount: 0,
      sourceLang: 'Auto',
      targetLang: 'Auto',
    };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setIsContactsOpen(false);
  };

  const handleUpdateCurrentAccount = (updated: Partial<Account>, targetAccountId?: string) => {
    const idToUpdate = targetAccountId || activeAccountId;
    setAccounts((prev) =>
      prev.map((a) => (a.id === idToUpdate ? { ...a, ...updated } : a))
    );
  };

  const handleCreateAccountGroup = (name: string, color?: string): AccountGroup | null => {
    const cleanName = name.trim().slice(0, 24);
    if (!cleanName) return null;
    const newGroup: AccountGroup = {
      id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      color: color || '#2ba0ff',
      collapsed: false,
    };
    setAccountGroups((prev) => [...prev, newGroup]);
    return newGroup;
  };

  const handleRenameAccountGroup = (groupId: string, name: string, color?: string) => {
    const cleanName = name.trim().slice(0, 24);
    if (!cleanName) return;
    setAccountGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, name: cleanName, ...(color ? { color } : {}) } : g))
    );
  };

  const handleDeleteAccountGroup = (groupId: string) => {
    setAccountGroups((prev) => prev.filter((g) => g.id !== groupId));
    setAccounts((prev) =>
      prev.map((a) => (a.groupId === groupId ? { ...a, groupId: undefined } : a))
    );
  };

  const handleToggleAccountGroupCollapse = (groupId: string) => {
    setAccountGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g))
    );
  };

  const handleUpdateAccountMeta = (accountId: string, meta: { remark?: string; groupId?: string }) => {
    const cleanRemark = typeof meta.remark === 'string' ? meta.remark.trim() : undefined;
    handleUpdateCurrentAccount(
      {
        ...(meta.remark !== undefined ? { remark: cleanRemark || undefined } : {}),
        ...(meta.groupId !== undefined ? { groupId: meta.groupId || undefined } : {}),
      },
      accountId
    );
  };

  const handleReorderAccountGroups = (
    sourceGroupId: string,
    targetGroupId: string,
    position: 'before' | 'after'
  ) => {
    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) return;
    setAccountGroups((prev) => {
      const sourceIdx = prev.findIndex((g) => g.id === sourceGroupId);
      const targetIdx = prev.findIndex((g) => g.id === targetGroupId);
      if (sourceIdx === -1 || targetIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      const insertBase = next.findIndex((g) => g.id === targetGroupId);
      if (insertBase === -1) return prev;
      next.splice(position === 'before' ? insertBase : insertBase + 1, 0, moved);
      return next;
    });
  };

  const handleReorderAccounts = (
    sourceAccountId: string,
    targetAccountId: string,
    position: 'before' | 'after'
  ) => {
    if (!sourceAccountId || !targetAccountId || sourceAccountId === targetAccountId) return;
    setAccounts((prev) => {
      const sourceAcc = prev.find((a) => a.id === sourceAccountId);
      const targetAcc = prev.find((a) => a.id === targetAccountId);
      if (!sourceAcc || !targetAcc) return prev;
      const nextAcc: Account =
        accountGroups.length > 0
          ? { ...sourceAcc, groupId: targetAcc.groupId || undefined }
          : sourceAcc;
      const next = prev.filter((a) => a.id !== sourceAccountId);
      const insertBase = next.findIndex((a) => a.id === targetAccountId);
      if (insertBase === -1) return prev;
      next.splice(position === 'before' ? insertBase : insertBase + 1, 0, nextAcc);
      return next;
    });
  };

  const handleMoveAccountToGroup = (accountId: string, targetGroupId?: string) => {
    if (!accountId) return;
    const normalizedGroupId = targetGroupId || undefined;
    setAccounts((prev) =>
      prev.map((a) => (a.id === accountId ? { ...a, groupId: normalizedGroupId } : a))
    );
  };

  const handleReorderChats = (
    visibleOrderedIds: string[],
    sourceChatId: string,
    targetChatId: string,
    position: 'before' | 'after'
  ) => {
    const accId = activeAccountIdRef.current;
    if (!accId || !sourceChatId || !targetChatId || sourceChatId === targetChatId) return;
    setChatOrderByAccount((prev) => {
      const existing = Array.isArray(prev[accId]) ? prev[accId] : [];
      let base: string[];
      if (existing.length > 0) {
        const existingSet = new Set(existing);
        const newVisible = visibleOrderedIds.filter((id) => !existingSet.has(id));
        base = [...newVisible, ...existing];
      } else {
        const defaultAllIds = [...chatsRef.current]
          .filter((c) => c.accountId === accId)
          .sort((a, b) => {
            const aPin = Boolean(a.isPinned);
            const bPin = Boolean(b.isPinned);
            if (aPin !== bPin) return aPin ? -1 : 1;
            if (aPin && bPin) {
              const aOrd = typeof a.pinOrder === 'number' ? a.pinOrder : Number.MAX_SAFE_INTEGER;
              const bOrd = typeof b.pinOrder === 'number' ? b.pinOrder : Number.MAX_SAFE_INTEGER;
              if (aOrd !== bOrd) return aOrd - bOrd;
            }
            return (typeof b.lastDate === 'number' ? b.lastDate : 0) - (typeof a.lastDate === 'number' ? a.lastDate : 0);
          })
          .map((c) => c.id);
        const seen = new Set(defaultAllIds);
        base = [...defaultAllIds, ...visibleOrderedIds.filter((id) => !seen.has(id))];
      }
      const withoutSource = base.filter((id) => id !== sourceChatId);
      const targetIdx = withoutSource.indexOf(targetChatId);
      if (targetIdx === -1) return prev;
      withoutSource.splice(position === 'before' ? targetIdx : targetIdx + 1, 0, sourceChatId);
      return { ...prev, [accId]: withoutSource };
    });
  };

  const handleResetChatOrder = () => {
    const accId = activeAccountIdRef.current;
    if (!accId) return;
    setChatOrderByAccount((prev) => {
      if (!(accId in prev)) return prev;
      const next = { ...prev };
      delete next[accId];
      return next;
    });
  };

  const currentAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f4f7fb] text-[#0f172a] dark:bg-[#05080f] dark:text-[#eef4fb] aurora:bg-[#081116] aurora:text-[#ecf6f8] linen:bg-[#ddd2bc] linen:text-[#2b2118] font-sans antialiased transition-colors">
      {/* 1. Leftmost Features & Multi-Account Activity Rail (56px) */}
      <LeftSidebar
        accounts={accounts.map((a) => ({
          ...a,
          unreadTotal: chats
            .filter((c) => c.accountId === a.id && !c.isArchived)
            .reduce((sum, c) => sum + (c.unreadCount || 0), 0),
        }))}
        accountGroups={accountGroups}
        activeAccountId={activeAccountId}
        onSelectAccount={(accountId) => {
          handleSelectAccount(accountId);
          setIsMultiAccountOpen(false);
        }}
        onUpdateAccountRemark={(accountId, remark) => {
          const normalized = remark.trim();
          handleUpdateCurrentAccount({ remark: normalized || undefined }, accountId);
        }}
        onUpdateAccountMeta={handleUpdateAccountMeta}
        onCreateAccountGroup={handleCreateAccountGroup}
        onRenameAccountGroup={handleRenameAccountGroup}
        onDeleteAccountGroup={handleDeleteAccountGroup}
        onToggleAccountGroupCollapse={handleToggleAccountGroupCollapse}
        onReorderAccountGroups={handleReorderAccountGroups}
        onReorderAccounts={handleReorderAccounts}
        onMoveAccountToGroup={handleMoveAccountToGroup}
        onOpenMenuDrawer={() => setIsTelegramMenuOpen(true)}
        onOpenTranslation={() => toggleRightPanel('translation')}
        onOpenAddAccount={() => {
          setReloginAccount(null);
          setIsMultiAccountOpen(true);
        }}
        onOpenCustomLLM={() => toggleRightPanel('llm')}
        onOpenCustomerMemory={() => toggleRightPanel('memory')}
        onOpenMasterVoiceprint={() => toggleRightPanel('voice')}
        onOpenKnowledgeEvolution={() => toggleRightPanel('persona')}
        isMasterVoiceActive={isMasterVoiceActive}
        activeTab={activeRightPanel || 'chats'}
        setActiveTab={(tab) => {
          if (tab === 'chats') {
            setActiveRightPanel(null);
            setIsMultiAccountOpen(false);
          }
        }}
      />

      {/* Main Workspace Area right of LeftSidebar (Top Recovery Banner + ChatList + ChatArea + RightDock) */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {isMemberAuthenticated &&
          currentAccount &&
          (currentAccount.status === 'expired' ||
            currentAccount.status === 'offline' ||
            (currentAccount.status === 'away' && bannerVisibleByAccount[currentAccount.id])) && (
            <div
              className={`shrink-0 px-4 py-2 border-b flex items-center justify-between gap-3 text-xs ${
                currentAccount.status === 'expired'
                  ? 'bg-rose-50 dark:bg-rose-950/60 aurora:bg-rose-950/60 linen:bg-[#f2ded9] border-rose-200 dark:border-rose-800/60 aurora:border-rose-700/60 linen:border-[#d4a59a] text-rose-700 dark:text-rose-200 aurora:text-rose-200 linen:text-[#7a2e22]'
                  : 'bg-amber-50 dark:bg-amber-950/50 aurora:bg-amber-950/55 linen:bg-[#f2e8d4] border-amber-200 dark:border-amber-800/60 aurora:border-amber-700/55 linen:border-[#cbbba2] text-amber-800 dark:text-amber-200 aurora:text-amber-200 linen:text-[#5c4328]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    currentAccount.status === 'expired'
                      ? 'bg-rose-500'
                      : currentAccount.status === 'away'
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-slate-400 aurora:bg-[#5a7782] linen:bg-[#9c8468]'
                  }`}
                />
                <span className="truncate font-medium">
                  {currentAccount.status === 'expired'
                    ? `Telegram 账号「${currentAccount.name}」会话已失效或被限制，当前为只读离线浏览${
                        offlineReasonByAccount[currentAccount.id]
                          ? `：${offlineReasonByAccount[currentAccount.id]}`
                          : ''
                      }`
                    : offlineReasonByAccount[currentAccount.id] ||
                      getTelegramConnectionPhaseLabel(
                        currentAccount.connectionPhase ||
                          (currentAccount.status === 'away' ? 'reconnecting' : 'offline')
                      )}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {currentAccount.status !== 'expired' && (
                  <button
                    type="button"
                    disabled={isReconnectingAccount}
                    onClick={handleReconnectTelegram}
                    className="px-2.5 py-1 rounded-lg bg-[#2481cc] hover:bg-[#1e6fb0] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#935a36] text-white font-medium cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {isReconnectingAccount ? '正在重连...' : '立即重连'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setReloginAccount(currentAccount);
                    setIsMultiAccountOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-white/10 aurora:bg-white/10 linen:bg-[#faf5ec] hover:bg-white dark:hover:bg-white/20 aurora:hover:bg-white/20 linen:hover:bg-white border border-current/20 linen:border-[#cbbba2] font-medium cursor-pointer transition-colors"
                >
                  重新扫码登录
                </button>
              </div>
            </div>
          )}

        <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
        {/* 2. Official Telegram Middle Chats List Pane (resizable) */}
        <ChatList
          chats={currentAccountChats}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onOpenMenuDrawer={() => setIsTelegramMenuOpen(true)}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onTogglePinChat={handleTogglePinChat}
          onToggleArchiveChat={handleToggleArchiveChat}
          onToggleMuteChat={handleToggleMuteChat}
          onToggleMarkUnread={handleToggleMarkUnread}
          onDeleteChat={handleDeleteChat}
          onNewChatClick={() => setIsContactsOpen(true)}
          currentAccountStatus={currentAccount?.status}
          currentAccountOfflineReason={currentAccount ? offlineReasonByAccount[currentAccount.id] : null}
          isReconnecting={isReconnectingAccount}
          onReconnectAccount={handleReconnectTelegram}
          onReloginCurrentAccount={() => {
            if (currentAccount) {
              setReloginAccount(currentAccount);
            }
            setIsMultiAccountOpen(true);
          }}
          onRefreshMediaUrls={handleRefreshMediaUrls}
          customFolders={activeAccountId ? (foldersByAccount[activeAccountId] || []) : []}
          contactChatIds={new Set(contacts.filter((ct) => ct.isContact !== false).map((ct) => ct.id))}
          customChatOrder={activeAccountId ? (chatOrderByAccount[activeAccountId] || []) : []}
          onReorderChats={handleReorderChats}
          onResetChatOrder={handleResetChatOrder}
        />

        {/* 3. Official Telegram Center Main Chat Workbench Pane (flex-1) */}
        <ChatArea
          chat={currentChat}
          messages={currentMessages}
          translationSettings={translationSettings}
          onSendMessage={handleSendMessage}
          onCloseChat={() => setActiveChatId(null)}
          onUpdateChatLanguage={handleUpdateChatLanguage}
          onToggleChatTranslation={handleToggleChatTranslation}
          onOpenTranslation={() => toggleRightPanel('translation')}
          onOpenCustomLLM={() => toggleRightPanel('llm')}
          customLLMConfig={customLLMConfig}
          currentAccountId={activeAccountId}
          onOpenKnowledgeEvolution={() => toggleRightPanel('persona')}
          onOpenVoiceprintConfig={() => openRightPanel('voice')}
          onOpenCustomerMemory={toggleChatMemoryPanel}
          isCustomerMemoryOpen={isChatMemoryOpen}
          activeRightPanel={activeRightPanel}
          isChatInfoOpenExternal={isChatInfoOpen}
          onChatInfoOpenChange={(open) => {
            setIsChatInfoOpen(open);
            if (open) {
              setActiveRightPanel(null);
              setIsChatMemoryOpen(false);
            }
          }}
          onDeleteMessage={handleDeleteMessage}
          onBatchDeleteMessages={handleBatchDeleteMessages}
          onForwardMessages={handleForwardMessages}
          availableChats={currentAccountChats}
          hasMoreHistory={
            activeChatId
              ? chatHasMoreMap[msgBucketKey(activeAccountId, activeChatId)] ??
                Boolean(activeChatId.startsWith('tg_') || currentMessages.length >= 40)
              : false
          }
          onLoadOlderMessages={handleLoadOlderMessages}
          onRefreshMediaUrls={handleRefreshMediaUrls}
          onEditMessage={handleEditMessage}
          onUpdateMessage={handleUpdateMessage}
          onRetranslateMessage={handleRetranslateMessage}
          onRetryMessage={handleRetryMessage}
          onToggleReaction={handleToggleReaction}
          onTogglePinMessage={handleTogglePinMessage}
          onClearHistory={handleClearHistory}
          onToggleMuteChat={handleToggleMuteChat}
          onTogglePinChat={handleTogglePinChat}
          onUpdateChatTitle={handleUpdateChatTitle}
          onAddContact={handleAddContact}
          onJoinOrOpenChat={handleCreateGroup}
          onRemoveContact={handleRemoveContact}
          onChatInfoUpdated={(chatId, patch) => {
            setChats((prev) =>
              prev.map((c) =>
                c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)
                  ? { ...c, ...patch }
                  : c
              )
            );
            if (typeof patch.isBlocked === 'boolean') {
              handleContactBlockChanged(chatId, patch.isBlocked);
            }
            if (typeof patch.title === 'string' && patch.title.trim()) {
              const nextTitle = patch.title.trim();
              setContacts((prev) => {
                let changed = false;
                const next = prev.map((ct) => {
                  if (ct.id === chatId && ct.name !== nextTitle) {
                    changed = true;
                    return { ...ct, name: nextTitle };
                  }
                  return ct;
                });
                if (changed) saveScopedContacts(next, activeAccountIdRef.current);
                return changed ? next : prev;
              });
            }
          }}
          sendWithEnter={clientPrefs.sendWithEnter}
          onMessagesSynced={(synced, meta) => {
            const syncChatId = meta?.chatId || activeChatIdRef.current || activeChatId;
            const syncAccountId = meta?.accountId || activeAccountIdRef.current || activeAccountId;
            if (syncChatId) {
              const bucketKey = msgBucketKey(syncAccountId, syncChatId);
              if (meta && typeof meta.hasMore === 'boolean') {
                setChatHasMoreMap((prev) => ({ ...prev, [bucketKey]: meta.hasMore! }));
              }
              if (meta && typeof meta.readOutboxMaxId === 'number') {
                setChats((prev) =>
                  prev.map((c) =>
                    c.id === syncChatId && (!syncAccountId || c.accountId === syncAccountId)
                      ? { ...c, readOutboxMaxId: Math.max(c.readOutboxMaxId || 0, meta.readOutboxMaxId!) }
                      : c
                  )
                );
              }
              if (synced.length > 0 || !meta?.fromLocalFallback) {
                setMessagesMap((prev) => {
                  const base = getBucketMessages(prev, syncAccountId, syncChatId);
                  const merged = mergeCloudMessagesWithLocal(
                    base.length > 0 ? base : getLocalMessages(syncChatId, syncAccountId),
                    synced,
                    {
                      accountId: syncAccountId,
                      chatId: syncChatId,
                      allowEmptyCloudPrune: !meta?.fromLocalFallback,
                    }
                  );
                  return {
                    ...prev,
                    [bucketKey]: merged,
                  };
                });
              }
            }
          }}
        />

        {/* 3.4 Standalone Chat-Docked Customer Memory Side Panel (Single-Page, No Extra Tabs) */}
        <CustomerMemoryDrawer
          isOpen={isChatMemoryOpen && Boolean(activeChatId)}
          sideDocked={true}
          onClose={() => setIsChatMemoryOpen(false)}
          profile={customerProfile}
          chatId={activeChatId || ''}
          currentAccountId={activeAccountId}
          onUpdateProfile={(updated) => {
            if (
              updated.chatId &&
              updated.chatId !== 'current' &&
              activeChatIdRef.current &&
              normalizeProfileChatId(updated.chatId) !== normalizeProfileChatId(activeChatIdRef.current)
            ) {
              return;
            }
            if (
              updated.accountId &&
              activeAccountIdRef.current &&
              updated.accountId !== activeAccountIdRef.current &&
              updated.accountId.replace(/^acc_tg_/, '') !==
                activeAccountIdRef.current.replace(/^acc_tg_/, '')
            ) {
              return;
            }
            setCustomerProfile(updated);
          }}
          customConfig={customLLMConfig}
          chatTitle={currentChat?.title || '当前联系人'}
          messages={currentMessages}
        />

        {/* 3.5 Unified Feature Modal Page Overlay (Standalone 5-Tab Modal) */}
        <UnifiedRightDock
          activePanel={activeRightPanel}
          onSelectPanel={openRightPanel}
          onClose={() => setActiveRightPanel(null)}
          customerProfile={customerProfile}
          onUpdateCustomerProfile={(updated) => {
            if (
              updated.chatId &&
              updated.chatId !== 'current' &&
              activeChatIdRef.current &&
              normalizeProfileChatId(updated.chatId) !== normalizeProfileChatId(activeChatIdRef.current)
            ) {
              return;
            }
            if (
              updated.accountId &&
              activeAccountIdRef.current &&
              updated.accountId !== activeAccountIdRef.current &&
              updated.accountId.replace(/^acc_tg_/, '') !==
                activeAccountIdRef.current.replace(/^acc_tg_/, '')
            ) {
              return;
            }
            setCustomerProfile(updated);
          }}
          activeChatId={activeChatId}
          activeAccountId={activeAccountId}
          currentChat={currentChat}
          currentMessages={currentMessages}
          customLLMConfig={customLLMConfig}
          onSaveCustomLLMConfig={handleSaveCustomLLMConfig}
          translationSettings={translationSettings}
          onUpdateTranslationSettings={handleUpdateTranslationSettings}
          isMasterVoiceActive={isMasterVoiceActive}
          currentAccount={currentAccount}
        />
        </div>
      </div>

      {/* 4. Telegram Slide-Out Menu Drawer (Slide-out from Left) */}
      <TelegramMenuDrawer
        isOpen={isTelegramMenuOpen}
        onClose={() => setIsTelegramMenuOpen(false)}
        currentAccount={currentAccount}
        accounts={accounts}
        onSelectAccount={handleSelectAccount}
        onOpenAddAccount={() => {
          setReloginAccount(null);
          setIsMultiAccountOpen(true);
        }}
        onReloginAccount={(acc) => {
          setReloginAccount(acc);
          setIsMultiAccountOpen(true);
        }}
        onOpenTranslation={() => openRightPanel('translation')}
        onOpenSystemSettings={() => setIsSystemSettingsOpen(true)}
        onSelectChat={handleSelectChat}
        onDeleteAccount={handleDeleteAccount}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'light' ? 'dark' : prev === 'dark' ? 'aurora' : prev === 'aurora' ? 'linen' : 'light'))}
        onSelectTheme={setTheme}
        onOpenNewGroup={() => setIsNewGroupOpen(true)}
        onOpenNewChannel={() => setIsNewChannelOpen(true)}
        onOpenContacts={() => setIsContactsOpen(true)}
        onOpenTelegramSettings={() => setIsTelegramSettingsOpen(true)}
        onOpenKnowledgeEvolution={() => openRightPanel('persona')}
        currentMember={currentMember}
        onMemberLogout={handleMemberLogout}
        onUpdateAvailable={(info) => {
          setAppUpdateInfo(info);
          setIsUpdateModalOpen(true);
        }}
      />

      {/* 5. Multi-Account Switcher & Login Modal */}
      <MultiAccountModal
        isOpen={isMultiAccountOpen}
        onClose={() => {
          setIsMultiAccountOpen(false);
          setReloginAccount(null);
        }}
        accounts={accounts}
        accountGroups={accountGroups}
        activeAccountId={activeAccountId}
        onSelectAccount={handleSelectAccount}
        onAddAccount={handleAddAccount}
        onDeleteAccount={handleDeleteAccount}
        onUpdateAccountMeta={handleUpdateAccountMeta}
        onCreateAccountGroup={handleCreateAccountGroup}
        onRenameAccountGroup={handleRenameAccountGroup}
        onDeleteAccountGroup={handleDeleteAccountGroup}
        reloginAccount={reloginAccount}
      />

      {/* 6. Local Data & Zero-DB Security Center Modal */}
      <DatabaseModal
        isOpen={isDatabaseOpen}
        onClose={() => setIsDatabaseOpen(false)}
        onPurgeComplete={() => {
          prevPersistedMessagesMapRef.current = {};
          pendingMediaFilesRef.current.clear();
          pendingMediaSaveMapRef.current.clear();
          scheduleRevokeBlobUrls(Array.from(restoredBlobUrlsRef.current.values()));
          restoredBlobUrlsRef.current.clear();
          void purgeAllPendingMediaBlobs();
          setMessagesMap({});
          setChats((prev) => prev.map((c) => ({ ...c, lastMessage: '暂无消息' })));
        }}
        onRestoreComplete={() => {
          void rehydrateFromLocalStorage(true);
        }}
      />

      {/* 7. Centralized Internal System Settings Modal */}
      <SystemSettingsModal
        isOpen={isSystemSettingsOpen}
        onClose={() => setIsSystemSettingsOpen(false)}
        onOpenDatabase={() => setIsDatabaseOpen(true)}
        onOpenTranslation={() => openRightPanel('translation')}
        updaterState={updaterState}
        onOpenUpdateModal={() => setIsUpdateModalOpen(true)}
        onUpdateAvailable={(info) => {
          setAppUpdateInfo(info);
          setIsUpdateModalOpen(true);
        }}
      />

      {/* 14. Telegram New Group Dialog */}
      <TelegramNewGroupModal
        isOpen={isNewGroupOpen}
        onClose={() => setIsNewGroupOpen(false)}
        contacts={contacts}
        currentAccountId={activeAccountId}
        onCreateGroup={handleCreateGroup}
        onSyncContacts={handleSyncContacts}
      />

      {/* 15. Telegram New Channel Dialog */}
      <TelegramNewChannelModal
        isOpen={isNewChannelOpen}
        onClose={() => setIsNewChannelOpen(false)}
        currentAccountId={activeAccountId}
        onCreateChannel={handleCreateChannel}
      />

      {/* 16. Telegram Contacts Manager Modal */}
      <TelegramContactsModal
        isOpen={isContactsOpen}
        onClose={() => setIsContactsOpen(false)}
        contacts={contacts}
        currentAccountId={activeAccountId}
        onAddContact={handleAddContact}
        onSyncContacts={handleSyncContacts}
        onRemoveContact={handleRemoveContact}
        onBlockStatusChanged={handleContactBlockChanged}
        onRenameContact={handleUpdateChatTitle}
        onStartChatWithContact={handleStartChatWithContact}
      />

      {/* 17. Telegram Call Records Modal (read-only archive, strictly scoped by active account; VoIP dialing offlined) */}
      <TelegramCallsModal
        isOpen={isCallsOpen}
        onClose={() => setIsCallsOpen(false)}
        callRecords={callRecords.filter((rec) => !activeAccountId || rec.accountId === activeAccountId)}
      />

      {/* 18. Official Telegram Account & Client Settings Modal */}
      <TelegramSettingsModal
        isOpen={isTelegramSettingsOpen}
        refreshSignal={telegramSettingsRefreshNonce}
        accountChats={chats.filter((c) => !activeAccountId || c.accountId === activeAccountId)}
        onClose={() => setIsTelegramSettingsOpen(false)}
        currentAccount={currentAccount}
        onUpdateAccount={handleUpdateCurrentAccount}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'light' ? 'dark' : prev === 'dark' ? 'aurora' : prev === 'aurora' ? 'linen' : 'light'))}
        onSelectTheme={setTheme}
        onOpenSystemAdmin={() => setIsSystemSettingsOpen(true)}
        clientPrefs={clientPrefs}
        onUpdateClientPrefs={setClientPrefs}
        onBlockStatusChanged={handleContactBlockChanged}
        onFoldersChanged={(folders, accId) => {
          const targetId = accId || activeAccountId;
          if (!targetId) return;
          setFoldersByAccount((prev) => ({ ...prev, [targetId]: folders }));
        }}
      />

      {/* 22. Member Authentication Gate Modal */}
      <MemberAuthModal
        isOpen={!isAuthChecking && !isMemberAuthenticated}
        totalMembers={totalMembersCount}
        initialTab={authPromptState.initialTab}
        initialError={authPromptState.initialError}
        onSuccess={async (user) => {
          setAuthPromptState({});
          setCurrentMember(user);
          startupReconnectInFlightRef.current = true;
          setIsMemberAuthenticated(true);
          setCustomLLMConfig((prev) =>
            !prev.enabled && !prev.explicitlyDisabled && prev.engineMode !== 'custom' && !prev.baseUrl?.trim()
              ? {
                  ...prev,
                  enabled: true,
                  explicitlyDisabled: false,
                  engineMode: 'cloud',
                  enableKnowledgeBaseRAG: true,
                }
              : prev
          );
          try {
            await initSessionHandshake();
            await runHandshakeTelegramReconnect();
          } catch {}
          fetchAuthStatus()
            .then((s) => setTotalMembersCount(s.totalMembers || 0))
            .catch(() => {});
        }}
      />

      {/* Non-blocking Telegram Cloud Action Error Toast */}
      {cloudActionToast && (
        <div className="fixed top-4 right-4 z-[60] max-w-sm bg-rose-600 text-white px-4 py-2.5 rounded-xl shadow-2xl border border-rose-400/40 flex items-start gap-3 text-xs animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex-1 leading-relaxed font-medium">{cloudActionToast}</div>
          <button
            type="button"
            onClick={() => setCloudActionToast(null)}
            className="text-white/80 hover:text-white cursor-pointer shrink-0 font-bold"
            aria-label="关闭提示"
          >
            ✕
          </button>
        </div>
      )}

      {/* Lightweight GitHub Release Update Prompt Modal */}
      {isUpdateModalOpen && appUpdateInfo?.hasUpdate && (() => {
        const safeHref = (raw?: string) => {
          try {
            if (!raw) return 'https://github.com/1988221as-cpu/telegram-aiapp/releases';
            const u = new URL(raw);
            return u.protocol === 'https:' ? u.toString() : 'https://github.com/1988221as-cpu/telegram-aiapp/releases';
          } catch {
            return 'https://github.com/1988221as-cpu/telegram-aiapp/releases';
          }
        };
        const formatUpdateBytes = (bytes?: number) => {
          const val = Number(bytes || 0);
          if (!val || val <= 0) return '0 B';
          if (val < 1024) return `${val} B`;
          if (val < 1024 * 1024) return `${(val / 1024).toFixed(1)} KB`;
          return `${(val / (1024 * 1024)).toFixed(1)} MB`;
        };
        const bridge = getDesktopUpdaterBridge();
        const canInAppUpdate = Boolean(bridge && desktopUpdaterInfo?.supported);
        const isCheckingMeta = updaterState.status === 'checking';
        const isDownloading = updaterState.status === 'downloading';
        const isDownloaded = updaterState.status === 'downloaded';
        const isInstalling = updaterState.status === 'installing';
        const isError = updaterState.status === 'error';
        const percent = Math.max(0, Math.min(100, Number(updaterState.percent || 0)));

        const downloadHref = safeHref(
          desktopUpdaterInfo?.mode === 'nsis'
            ? appUpdateInfo.installerDownloadUrl || appUpdateInfo.downloadUrl
            : appUpdateInfo.portableDownloadUrl || appUpdateInfo.downloadUrl
        );
        const displayAssetName =
          desktopUpdaterInfo?.mode === 'nsis'
            ? appUpdateInfo.installerAssetName || appUpdateInfo.assetName
            : appUpdateInfo.portableAssetName || appUpdateInfo.assetName;

        const handleStartInAppDownload = () => {
          if (!bridge) return;
          void bridge.startDownload({
            version: appUpdateInfo.latestVersion,
            downloadUrl: appUpdateInfo.downloadUrl,
            assetName: appUpdateInfo.assetName,
            portableDownloadUrl: appUpdateInfo.portableDownloadUrl,
            portableAssetName: appUpdateInfo.portableAssetName,
            installerDownloadUrl: appUpdateInfo.installerDownloadUrl,
            installerAssetName: appUpdateInfo.installerAssetName,
            latestYmlUrl: appUpdateInfo.latestYmlUrl,
          });
        };

        const handleCancelInAppDownload = () => {
          if (!bridge) return;
          void bridge.cancelDownload();
        };

        const handleInstallAndRestart = () => {
          if (!bridge) return;
          void bridge.installNow();
        };

        return (
          <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 select-none">
            <div className="w-full max-w-md bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] rounded-2xl shadow-2xl overflow-hidden text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
              <div className="px-5 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] flex items-center justify-between">
                <div className="text-sm font-bold">
                  发现新版本 v{appUpdateInfo.latestVersion}
                  <span className="ml-2 text-xs font-normal text-[#64748b] dark:text-[#7b93ad] linen:text-[#6e5c4a]">
                    (当前 v{appUpdateInfo.currentVersion})
                  </span>
                </div>
                {!isInstalling && (
                  <button
                    type="button"
                    onClick={() => setIsUpdateModalOpen(false)}
                    className="text-xs text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white linen:text-[#6e5c4a] linen:hover:text-[#2b2118] cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="p-5 space-y-3 text-xs">
                {displayAssetName && (
                  <div className="text-[#475569] dark:text-[#b4c6d8] linen:text-[#4e3f32] flex items-center justify-between gap-2">
                    <span className="truncate">
                      更新包：<span className="font-mono font-medium">{displayAssetName}</span>
                    </span>
                    {canInAppUpdate && (
                      <span className="shrink-0 text-[11px] text-[#64748b] dark:text-[#7b93ad] linen:text-[#6e5c4a]">
                        {desktopUpdaterInfo?.mode === 'portable' ? '便携直更模式' : '自动安装模式'}
                      </span>
                    )}
                  </div>
                )}
                <div className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#efe6d6] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] p-3 text-[#334155] dark:text-[#b4c6d8] linen:text-[#4e3f32] leading-relaxed select-text">
                  {appUpdateInfo.releaseNotes?.trim() || '本次发布包含功能优化与问题修复，建议更新至最新版本。'}
                </div>

                {canInAppUpdate && (isCheckingMeta || isDownloading || isDownloaded || isInstalling) && (
                  <div className="rounded-xl bg-[#f1f5f9] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#efe6d6] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1f343d] linen:border-[#cbbba2] p-3 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] linen:text-[#2b2118]">
                        {isCheckingMeta
                          ? '正在校验更新清单...'
                          : isDownloading
                            ? `正在下载更新包 (${percent.toFixed(1)}%)`
                            : isDownloaded
                              ? '更新包下载并校验完成，已就绪'
                              : '正在关闭本地服务并重启安装...'}
                      </span>
                      {isDownloading && (
                        <span className="text-[#64748b] dark:text-[#7b93ad] linen:text-[#6e5c4a] tabular-nums">
                          {updaterState.bytesPerSecond ? `${formatUpdateBytes(updaterState.bytesPerSecond)}/s` : ''}
                        </span>
                      )}
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#cbd5e1] dark:bg-[#1e293b] linen:bg-[#dfd2bc] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-200 ${
                          isDownloaded || isInstalling
                            ? 'bg-[#16a34a] dark:bg-[#22c55e]'
                            : 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43]'
                        } ${isCheckingMeta ? 'animate-pulse w-1/3' : ''}`}
                        style={isCheckingMeta ? undefined : { width: `${isDownloaded || isInstalling ? 100 : percent}%` }}
                      />
                    </div>
                    {(isDownloading || isDownloaded) && (updaterState.total || updaterState.transferred) ? (
                      <div className="flex items-center justify-between text-[11px] text-[#64748b] dark:text-[#7b93ad] linen:text-[#6e5c4a] tabular-nums">
                        <span>
                          {formatUpdateBytes(updaterState.transferred)}
                          {updaterState.total ? ` / ${formatUpdateBytes(updaterState.total)}` : ''}
                        </span>
                        <span>{isDownloaded ? '100%' : `${percent.toFixed(1)}%`}</span>
                      </div>
                    ) : null}
                  </div>
                )}

                {canInAppUpdate && isError && updaterState.error && (
                  <div className="rounded-xl bg-[#fef2f2] dark:bg-[#2a1215] border border-[#fecaca] dark:border-[#7f1d1d] p-3 text-[11px] text-[#b91c1c] dark:text-[#fca5a5] leading-relaxed">
                    自动更新失败：{updaterState.error}。你可以重试或点击下方“浏览器下载”。
                  </div>
                )}
              </div>
              <div className="px-5 py-3.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] flex items-center justify-between gap-2 text-xs">
                {canInAppUpdate && (isDownloading || isCheckingMeta) ? (
                  <button
                    type="button"
                    onClick={handleCancelInAppDownload}
                    className="text-[#64748b] hover:text-[#dc2626] dark:text-[#7b93ad] dark:hover:text-[#f87171] linen:text-[#6e5c4a] cursor-pointer"
                  >
                    取消下载
                  </button>
                ) : !isInstalling ? (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        if (appUpdateInfo.latestVersion) {
                          localStorage.setItem('tg_dismissed_update_version', appUpdateInfo.latestVersion);
                        }
                      } catch {}
                      setIsUpdateModalOpen(false);
                    }}
                    className="text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white linen:text-[#6e5c4a] linen:hover:text-[#2b2118] cursor-pointer"
                  >
                    忽略此版本
                  </button>
                ) : (
                  <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] linen:text-[#6e5c4a]">请勿手动关闭...</span>
                )}

                <div className="flex items-center gap-2">
                  {canInAppUpdate ? (
                    <>
                      {isDownloading || isCheckingMeta ? (
                        <button
                          type="button"
                          onClick={() => setIsUpdateModalOpen(false)}
                          className="px-3 py-1.5 rounded-lg border border-[#cbd5e1] dark:border-[#1e3148] linen:border-[#cbbba2] hover:border-[#2481cc] linen:hover:border-[#a86a43] text-[#334155] dark:text-[#b4c6d8] linen:text-[#4e3f32] font-medium cursor-pointer"
                        >
                          后台下载
                        </button>
                      ) : isDownloaded ? (
                        <button
                          type="button"
                          onClick={handleInstallAndRestart}
                          className="px-3.5 py-1.5 rounded-lg bg-[#16a34a] hover:bg-[#15803d] dark:bg-[#22c55e] dark:hover:bg-[#16a34a] text-white font-semibold cursor-pointer"
                        >
                          立即关闭并重启更新
                        </button>
                      ) : isInstalling ? (
                        <button
                          type="button"
                          disabled
                          className="px-3.5 py-1.5 rounded-lg bg-[#64748b] text-white font-semibold opacity-75 cursor-not-allowed"
                        >
                          正在重启安装...
                        </button>
                      ) : (
                        <>
                          <a
                            href={downloadHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg border border-[#cbd5e1] dark:border-[#1e3148] linen:border-[#cbbba2] hover:border-[#2481cc] linen:hover:border-[#a86a43] text-[#334155] dark:text-[#b4c6d8] linen:text-[#4e3f32] font-medium"
                          >
                            浏览器下载
                          </a>
                          <button
                            type="button"
                            onClick={handleStartInAppDownload}
                            className="px-3.5 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] text-white font-semibold cursor-pointer"
                          >
                            {isError ? '重新下载更新' : '立即下载更新'}
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <a
                        href={downloadHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setIsUpdateModalOpen(false)}
                        className="px-3.5 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] text-white font-semibold"
                      >
                        立即下载新版
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
