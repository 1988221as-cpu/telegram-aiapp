import React, { useState, useEffect, useRef } from 'react';
import { LeftSidebar } from './components/LeftSidebar';
import { ChatList } from './components/ChatList';
import { ChatArea, detectClientLangCode } from './components/ChatArea';
import { UnifiedRightDock, RightPanelTab } from './components/UnifiedRightDock';
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
} from './components/TelegramSettingsModal';
import { MemberAuthModal } from './components/MemberAuthModal';
import { TelegramVoiceCallModal } from './components/TelegramVoiceCallModal';
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
  Chat,
  Message,
  TranslationSettings,
  CustomerProfile,
  CustomLLMConfig,
  MemberUser,
  TelegramContact,
  TelegramCallRecord,
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
  translateText,
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
} from './services/apiService';


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
    isArchived: Boolean(d.isArchived),
    isMuted: Boolean(d.isMuted),
    isVerified: Boolean(d.isVerified),
    isOnline: Boolean(d.isOnline),
    statusText: typeof d.statusText === 'string' ? d.statusText : existing?.statusText,
    memberCount: typeof d.memberCount === 'number' ? d.memberCount : existing?.memberCount,
    onlineCount: typeof d.onlineCount === 'number' ? d.onlineCount : existing?.onlineCount,
    lastMessage: d.lastMessage || existing?.lastMessage || '暂无消息',
    lastTime: d.lastTime || existing?.lastTime || '刚刚',
    unreadCount: typeof d.unreadCount === 'number' ? d.unreadCount : (existing?.unreadCount || 0),
    readOutboxMaxId: typeof d.readOutboxMaxId === 'number' ? d.readOutboxMaxId : existing?.readOutboxMaxId,
    readInboxMaxId: typeof d.readInboxMaxId === 'number' ? d.readInboxMaxId : existing?.readInboxMaxId,
    sourceLang: existing?.sourceLang || d.sourceLang || 'Auto',
    targetLang: existing?.targetLang || d.targetLang || 'Auto',
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
  if (isCustomPriority && trans.preferredEngine !== 'custom_llm') {
    return { ...trans, preferredEngine: 'custom_llm' };
  }
  if (!isDualOff && !isCustomPriority && trans.preferredEngine === 'custom_llm') {
    return { ...trans, preferredEngine: 'gemini' };
  }
  return trans;
}

function engineToLiveErrorChannel(engine?: string): Message['translationErrorChannel'] {
  if (engine === 'custom_llm') return 'live_custom_llm';
  if (engine === 'google') return 'live_google';
  return 'live_gemini';
}

function formatChatMessageSummary(msg: Partial<Message>, emptyFallback = '暂无消息'): string {
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
      return {
        ...lm,
        ...cm,
        id: cm.id || lm.id,
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
    const saved = secureGetItemSync<any>('tg_pro_trans_settings');
    if (!saved) return INITIAL_TRANSLATION_SETTINGS;
    const normalizedEngine =
      saved.preferredEngine === 'google' || saved.preferredEngine === 'custom_llm' || saved.preferredEngine === 'gemini'
        ? saved.preferredEngine
        : 'gemini';
    const rawModel = String(saved.geminiModel || '').toLowerCase();
    const normalizedGemmaModel = rawModel.includes('31b') ? 'gemma-4-31b-it' : 'gemma-4-26b-a4b-it';
    return {
      ...INITIAL_TRANSLATION_SETTINGS,
      ...saved,
      preferredEngine: normalizedEngine,
      geminiModel: normalizedGemmaModel,
    };
  });

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
  const [chatHasMoreMap, setChatHasMoreMap] = useState<Record<string, boolean>>({});

  const openRightPanel = (tab: RightPanelTab) => {
    setIsChatInfoOpen(false);
    setActiveRightPanel(tab);
  };

  const toggleRightPanel = (tab: RightPanelTab) => {
    setIsChatInfoOpen(false);
    setActiveRightPanel((prev) => (prev === tab ? null : tab));
  };

  // 2. Modals & Drawers Visibility State
  const [isTelegramMenuOpen, setIsTelegramMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('tg_pro_theme') as 'dark' | 'light') || 'light';
  });
  const [clientPrefs, setClientPrefs] = useState<TelegramClientPrefs>(() => {
    try {
      const raw = localStorage.getItem('tg_pro_client_prefs');
      if (raw) return { ...DEFAULT_TELEGRAM_CLIENT_PREFS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_TELEGRAM_CLIENT_PREFS;
  });
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

  // Telegram Voice Call modal state
  const [isVoiceCallOpen, setIsVoiceCallOpen] = useState(false);
  const [voiceCallTargetName, setVoiceCallTargetName] = useState<string>('');
  const activeCallRecordIdRef = useRef<string | null>(null);
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
  const [isReconnectingAccount, setIsReconnectingAccount] = useState(false);

  // Telegram contacts (strictly scoped by account & AES-encrypted, zero mock defaults) and real call history state
  const [contacts, setContacts] = useState<TelegramContact[]>(() => {
    return getScopedContacts(activeAccountId || accounts[0]?.id || '');
  });

  const [callRecords, setCallRecords] = useState<TelegramCallRecord[]>(() => {
    try {
      const saved = secureGetItemSync<TelegramCallRecord[]>('tg_pro_call_records');
      return saved ? sanitizeCallRecords(saved) : [];
    } catch {
      return [];
    }
  });

  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      secureSetItemSync('tg_pro_call_records', callRecords);
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
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('tg_pro_client_prefs', JSON.stringify(clientPrefs));
    } catch {}
  }, [clientPrefs]);

  const rehydrateFromLocalStorage = async (isRestore = false) => {
    try {
      const [savedAccs, savedChats, savedMsgs, savedTrans, savedLLM] = await Promise.all([
        secureGetItemAsync<Account[]>('tg_pro_accounts'),
        secureGetItemAsync<Chat[]>('tg_pro_chats'),
        secureGetItemAsync<Record<string, Message[]>>('tg_pro_messages'),
        secureGetItemAsync<TranslationSettings>('tg_pro_trans_settings'),
        secureGetItemAsync<CustomLLMConfig>('tg_pro_llm_config'),
      ]);

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
          rawSavedTrans ? fetchTranslationSettingsApi().catch(() => null) : Promise.resolve(null),
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
        const rawModel = String((rawSavedTrans as any).geminiModel || '').toLowerCase();
        const normalizedGemmaModel = rawModel.includes('31b') ? 'gemma-4-31b-it' : 'gemma-4-26b-a4b-it';
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
        setTranslationSettings(
          normalizedSavedLlm ? enforceTranslationEngineForLlm(normalizedSavedLlm, mergedTrans) : mergedTrans
        );
      } else if (normalizedSavedLlm) {
        setTranslationSettings((prev) => enforceTranslationEngineForLlm(normalizedSavedLlm, prev));
      }

      const hydratedCalls = await secureGetItemAsync<TelegramCallRecord[]>('tg_pro_call_records');
      if (hydratedCalls) {
        setCallRecords(sanitizeCallRecords(hydratedCalls));
      }

      if (isRestore) {
        setContacts(getScopedContacts(resolvedActiveAccId || activeAccountIdRef.current));
        const savedTheme = localStorage.getItem('tg_pro_theme');
        if (savedTheme === 'dark' || savedTheme === 'light') {
          setTheme(savedTheme);
        }
        try {
          const savedPrefs = localStorage.getItem('tg_pro_client_prefs');
          if (savedPrefs) {
            setClientPrefs({ ...DEFAULT_TELEGRAM_CLIENT_PREFS, ...JSON.parse(savedPrefs) });
          }
        } catch {}
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
    secureSetItemSync('tg_pro_chats', chats);
  }, [chats, isHydrated]);

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
    secureSetItemSync('tg_pro_trans_settings', translationSettings);
    if (isMemberAuthenticated) {
      syncTranslationSettingsApi(translationSettings).catch(() => {});
    }
  }, [translationSettings, isHydrated, isMemberAuthenticated]);

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
          const hasLocalLlm = Boolean(secureGetItemSync<CustomLLMConfig>('tg_pro_llm_config'));
          const hasLocalTrans = Boolean(secureGetItemSync<TranslationSettings>('tg_pro_trans_settings'));
          let resolvedLlm: CustomLLMConfig | null = null;
          if (!hasLocalLlm || !hasLocalTrans) {
            const [serverLlm, serverTrans] = await Promise.all([
              !hasLocalLlm ? fetchCustomLLMConfigApi() : Promise.resolve(null),
              !hasLocalTrans ? fetchTranslationSettingsApi() : Promise.resolve(null),
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
              const rawModel = String(unwrappedTrans?.geminiModel || '').toLowerCase();
              const normalizedGemmaModel = rawModel.includes('31b') ? 'gemma-4-31b-it' : 'gemma-4-26b-a4b-it';
              const mergedServerTrans: TranslationSettings = {
                ...INITIAL_TRANSLATION_SETTINGS,
                ...unwrappedTrans,
                preferredEngine: normalizedEngine,
                geminiModel: normalizedGemmaModel,
              };
              delete (mergedServerTrans as any).success;
              delete (mergedServerTrans as any).config;
              delete (mergedServerTrans as any).settings;
              setTranslationSettings((prev) =>
                enforceTranslationEngineForLlm(resolvedLlm || customLLMConfigRef.current, { ...prev, ...mergedServerTrans })
              );
            }
          }
          setIsMemberAuthenticated(true);
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
    notifiedExpiredRef.current.clear();
    setAccounts([]);
    setChats([]);
    setMessagesMap({});
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

    const statusById = new Map<string, 'online' | 'away' | 'offline' | 'expired'>();
    const reasonsMap: Record<string, string> = {};
    if (statusRes.ok) {
      statusRes.activeUsers.forEach((u) => {
        const nextStatus: 'online' | 'away' | 'offline' = u.isConnected
          ? 'online'
          : u.isInMemoryConnected || statusRes.isRestoringSessions
            ? 'away'
            : 'offline';
        statusById.set(u.id, nextStatus);
        if (nextStatus !== 'online' && u.offlineReason) {
          reasonsMap[u.id] = u.offlineReason;
        }
      });
      statusRes.expiredAccounts.forEach((exp) => {
        const expId = exp.accountId || (exp.userId ? `acc_tg_${exp.userId}` : '');
        if (expId) {
          statusById.set(expId, 'expired');
          reasonsMap[expId] = exp.reason;
          if (!notifiedExpiredRef.current.has(expId)) {
            notifiedExpiredRef.current.add(expId);
            showCloudError(exp.reason || `账号 ${expId} 登录会话已失效，请重新扫码或验证码登录`);
          }
        }
      });
    }

    if (activeAccs && activeAccs.length > 0) {
      activeAccs.forEach((acc: any) => {
        if (!statusById.has(acc.id)) {
          statusById.set(acc.id, acc.isConnected ? 'online' : 'away');
        }
      });
    }

    setOfflineReasonByAccount(reasonsMap);

    setAccounts((prev) => {
      const map = new Map<string, Account>();
      prev.forEach((a) => {
        if (a.id.startsWith('acc_tg_')) {
          const realStatus = statusById.get(a.id) || 'offline';
          const nextBio =
            realStatus === 'expired'
              ? '会话已失效，请重新登录'
              : realStatus === 'online'
                ? 'Telegram 账号 (已直连)'
                : realStatus === 'away'
                  ? 'Telegram 账号 (重连中)'
                  : 'Telegram 账号 (未连接)';
          map.set(a.id, { ...a, status: realStatus, bio: nextBio });
        } else {
          map.set(a.id, a);
        }
      });
      if (activeAccs && activeAccs.length > 0) {
        activeAccs.forEach((acc: any) => {
          if (!map.has(acc.id)) {
            const realStatus = statusById.get(acc.id) || (acc.isConnected ? 'online' : 'away');
            map.set(acc.id, {
              id: acc.id,
              name: acc.name,
              username: acc.username,
              phone: acc.phone,
              avatarBg: acc.avatarBg || '#2481cc',
              avatarInitial: acc.avatarInitial || 'TG',
              unreadTotal: 0,
              isActive: false,
              status: realStatus,
              bio: realStatus === 'online' ? 'Telegram 账号 (已直连)' : 'Telegram 账号 (未连接)',
            });
          }
        });
      }
      return Array.from(map.values());
    });
  };

  const handleReconnectTelegram = async () => {
    if (isReconnectingAccount) return;
    setIsReconnectingAccount(true);
    try {
      const res = await reconnectTelegramSessionsApi(true);
      await syncTelegramAccountStatus();
      if (!res.ok) {
        showCloudError(res.error || '重连 Telegram 会话失败');
      } else {
        const curAcc = activeAccountIdRef.current;
        if (curAcc && curAcc.startsWith('acc_tg_')) {
          const dlgRes = await fetchTelegramUserDialogsDetailedApi(curAcc);
          if (dlgRes.ok && dlgRes.dialogs.length > 0) {
            setChats((prev) => {
              const otherChats = prev.filter((c) => c.accountId !== curAcc);
              const prevMap = new Map<string, Chat>();
              prev.filter((c) => c.accountId === curAcc).forEach((c) => prevMap.set(c.id, c));
              const nextChats = dlgRes.dialogs.map((d: any) => mapCloudDialogToChat(d, curAcc, prevMap.get(d.id)));
              return [...nextChats, ...otherChats];
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
      void runSync();
    }, 15000);

    return () => {
      isMounted = false;
      clearTimeout(initialRetryTimer);
      clearInterval(statusPollTimer);
    };
  }, [isMemberAuthenticated]);

  // Account-level syncing: scoped contacts, DB chats, and MTProto dialogs (runs ONLY on activeAccountId/auth changes)
  useEffect(() => {
    if (!activeAccountId || !isMemberAuthenticated) return;
    setActiveApiAccount(activeAccountId);

    let isMounted = true;
    const targetAccId = activeAccountId;
    setContacts(getScopedContacts(targetAccId));
    if (targetAccId.startsWith('acc_tg_')) {
      fetchTelegramUserContactsApi(targetAccId).then((res) => {
        if (isMounted && activeAccountIdRef.current === targetAccId && res.ok && Array.isArray(res.contacts)) {
          handleSyncContacts(res.contacts, targetAccId);
        }
      }).catch(() => {});
    } else if (pendingAutoSelectAccountRef.current === targetAccId && !activeChatIdRef.current) {
      pendingAutoSelectAccountRef.current = null;
      const existingChat = chatsRef.current.find((c) => c.accountId === targetAccId);
      if (existingChat) setActiveChatId(existingChat.id);
    }

    const syncChats = () => {
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
        const seq = selectAccountSeqRef.current;
        fetchTelegramUserDialogsDetailedApi(targetAccId).then((res) => {
          if (selectAccountSeqRef.current !== seq) {
            return;
          }
          if (!isMounted || activeAccountIdRef.current !== targetAccId) return;
          if (!res.ok) {
            if (res.code === 'TELEGRAM_SESSION_EXPIRED') {
              markAccountExpiredUi(targetAccId, res.error);
            } else if (pendingAutoSelectAccountRef.current === targetAccId && !activeChatIdRef.current) {
              pendingAutoSelectAccountRef.current = null;
              const existingChat = chatsRef.current.find((c) => c.accountId === targetAccId);
              if (existingChat) setActiveChatId(existingChat.id);
            }
            return;
          }
          const realDialogs = res.dialogs;
          setChats((prev) => {
            const otherChats = prev.filter((c) => c.accountId !== targetAccId);
            const prevAccountChats = prev.filter((c) => c.accountId === targetAccId);
            const prevMap = new Map<string, Chat>();
            prevAccountChats.forEach((c) => prevMap.set(c.id, c));

            const nextAccountChats: Chat[] = realDialogs.map((d: any) =>
              mapCloudDialogToChat(d, targetAccId, prevMap.get(d.id))
            );
            const cloudIds = new Set(nextAccountChats.map((c) => c.id));
            prevAccountChats.forEach((c) => {
              if (!c.id.startsWith('tg_') && !cloudIds.has(c.id)) {
                nextAccountChats.push(c);
              }
            });
            return [...nextAccountChats, ...otherChats];
          });

          if (pendingAutoSelectAccountRef.current === targetAccId && !activeChatIdRef.current) {
            pendingAutoSelectAccountRef.current = null;
            if (realDialogs.length > 0) {
              setActiveChatId(realDialogs[0].id);
            } else {
              const existingChat = chatsRef.current.find((c) => c.accountId === targetAccId);
              if (existingChat) setActiveChatId(existingChat.id);
            }
          }

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
        }).catch(() => {});
      }
    };

    syncChats();
    const chatInterval = setInterval(syncChats, 8000);

    return () => {
      isMounted = false;
      clearInterval(chatInterval);
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
    fetchCustomerProfile(targetChatId, targetAccId).then((prof) => {
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

  const attemptedInboundBackfillRef = useRef<Set<string>>(new Set());
  const backfillRetryCountRef = useRef<Map<string, number>>(new Map());
  const backfillCooldownUntilRef = useRef<Map<string, number>>(new Map());
  const backfillRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [backfillRetryNonce, setBackfillRetryNonce] = useState(0);
  const backfillAbortRef = useRef<AbortController | null>(null);
  const backfillScopeKeyRef = useRef<string>('');

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
  const backfillHistoryEngine = 'google' as const;
  const backfillScopeKey = `${activeAccountId}::${activeChatId || ''}::${backfillTargetLang}::${backfillSourceLang}::${backfillHistoryEngine}::${translationSettings.autoTranslateInbound !== false}::${translationSettings.googleApiKey || ''}`;

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
    };
  }, [backfillScopeKey]);

  // Auto-backfill ALL untranslated historical messages (no count cap) strictly via rate-paced Google Translate with backoff retry
  useEffect(() => {
    if (!isMemberAuthenticated || !activeChatId || !activeAccountId) return;
    if (translationSettings.autoTranslateInbound === false) return;

    if (backfillScopeKeyRef.current !== backfillScopeKey || !backfillAbortRef.current) {
      if (backfillAbortRef.current) {
        backfillAbortRef.current.abort();
      }
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
        !rawText ||
        /^\[(语音|视频|图片|多媒体|文件)消息\]$/.test(rawText) ||
        rawText.startsWith('🎤') ||
        rawText.startsWith('🖼️') ||
        rawText.startsWith('🎬') ||
        rawText.startsWith('📁') ||
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
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let remaining = candidates.length;

    const flushBatchUpdates = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
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

    const scheduleFlush = () => {
      remaining = Math.max(0, remaining - 1);
      if (remaining === 0 || pendingUpdates.size >= 5) {
        flushBatchUpdates();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flushBatchUpdates, 120);
      }
    };

    const scheduleBackfillRetryWakeup = (delayMs: number) => {
      if (controller.signal.aborted || backfillRetryTimerRef.current) return;
      backfillRetryTimerRef.current = setTimeout(() => {
        backfillRetryTimerRef.current = null;
        if (!controller.signal.aborted) {
          setBackfillRetryNonce((n) => n + 1);
        }
      }, delayMs);
    };

    const onAbort = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingUpdates.clear();
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });

    candidates.forEach(({ msg, rawText, dedupeKey }) => {
      translateText(
        rawText,
        backfillSourceLang,
        backfillTargetLang,
        customLLMConfigRef.current,
        backfillHistoryEngine,
        translationSettings.googleApiKey,
        undefined,
        undefined,
        undefined,
        { signal: controller.signal, purpose: 'history' }
      )
        .then((trans) => {
          if (controller.signal.aborted) return;
          backfillRetryCountRef.current.delete(dedupeKey);
          backfillCooldownUntilRef.current.delete(dedupeKey);
          const cleanTrans = (trans || '').trim();
          if (cleanTrans && cleanTrans.toLowerCase() !== rawText.toLowerCase()) {
            pendingUpdates.set(msg.id, { msg, translatedText: trans });
          }
          scheduleFlush();
        })
        .catch((err: any) => {
          if (err?.name === 'AbortError' || controller.signal.aborted) {
            attemptedInboundBackfillRef.current.delete(dedupeKey);
            remaining = Math.max(0, remaining - 1);
            return;
          }
          const retries = backfillRetryCountRef.current.get(dedupeKey) || 0;
          if (retries < 2) {
            const backoffMs = retries === 0 ? 4000 : 12000;
            backfillRetryCountRef.current.set(dedupeKey, retries + 1);
            backfillCooldownUntilRef.current.set(dedupeKey, Date.now() + backoffMs);
            attemptedInboundBackfillRef.current.delete(dedupeKey);
            scheduleBackfillRetryWakeup(backoffMs + 150);
          }
          const errMsg = err?.message || '历史消息谷歌机翻失败';
          pendingUpdates.set(msg.id, {
            msg,
            translationError: errMsg,
            translationErrorChannel: 'history_google',
          });
          scheduleFlush();
        });
    });
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
                    return { ...m, text: newText, isEdited: true };
                  }
                  return m;
                });
                if (!changed) return prev;
                return { ...prev, [targetBucketKey]: updated };
              });
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
              for (const key of candidateKeysForRecord) {
                const list = refSnapshot[key];
                if (!Array.isArray(list) || list.length === 0) continue;
                const chatKey = key.includes('::') ? key.split('::').slice(1).join('::') : key;
                list.filter(matchesDeletedTgId).forEach((m) =>
                  recordDeletedMessageId(m.id, targetAccountId, m.chatId || chatKey)
                );
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
              senderName: isOfficialNotice ? officialTitle : (upd.senderName || 'Telegram 联系人'),
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
              markTelegramDialogReadApi({
                accountId: targetAccountId,
                chatId: targetChatId,
                maxId: incomingMsg.telegramMessageId,
              }).catch(() => {});
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
              !trimmedIncomingText ||
              /^\[(语音|视频|图片|多媒体|文件)消息\]$/.test(trimmedIncomingText) ||
              trimmedIncomingText.startsWith('🎤') ||
              trimmedIncomingText.startsWith('🖼️') ||
              trimmedIncomingText.startsWith('🎬') ||
              trimmedIncomingText.startsWith('📁');

            if (
              currentTransSettings.autoTranslateInbound !== false &&
              incomingMsg.sender === 'peer' &&
              !isMediaPlaceholder &&
              !incomingMsg.translatedText
            ) {
              const effectiveInboundEngine = enforceTranslationEngineForLlm(
                currentLLMConfig,
                currentTransSettings
              ).preferredEngine;
              const inboundSourceLang =
                matchedChatForLang?.sourceLang && matchedChatForLang.sourceLang !== 'Auto'
                  ? matchedChatForLang.sourceLang
                  : 'Auto';

              translateText(
                incomingMsg.text,
                inboundSourceLang,
                inboundTargetLang,
                currentLLMConfig,
                effectiveInboundEngine,
                undefined,
                currentTransSettings.geminiModel,
                currentTransSettings.geminiApiKey,
                currentTransSettings.customModelName
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
                .catch((err: any) => {
                  const withErr: Message = {
                    ...incomingMsg,
                    translationError: err?.message || '翻译通道不可用',
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

            const summaryText = formatChatMessageSummary(incomingMsg);

            setChats((prev) => {
              const exists = prev.some((c) => c.id === targetChatId && c.accountId === targetAccountId);
              if (!exists) {
                const newChat: Chat = {
                  id: targetChatId,
                  accountId: targetAccountId,
                  title: isOfficialNotice ? officialTitle : (upd.senderName || `Telegram (${targetChatId.replace('tg_', '')})`),
                  unreadCount:
                    incomingMsg.sender === 'me' ||
                    (targetChatId === activeChatIdRef.current && targetAccountId === activeAccountIdRef.current)
                      ? 0
                      : 1,
                  lastMessage: summaryText,
                  lastTime: incomingMsg.timestamp,
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
                      unreadCount:
                        c.id === activeChatIdRef.current && c.accountId === activeAccountIdRef.current
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
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (!targetAccId || c.accountId === targetAccId)
          ? { ...c, unreadCount: 0 }
          : c
      )
    );
    if (chatId.startsWith('tg_') && targetAccId !== 'acc_telegram_bot') {
      const existingMsgs = getBucketMessages(messagesMapRef.current, targetAccId, chatId);
      const fallbackMsgs = existingMsgs.length > 0 ? existingMsgs : getLocalMessages(chatId, targetAccId);
      const tgIds = fallbackMsgs
        .map((m) => m.telegramMessageId)
        .filter((id): id is number => typeof id === 'number' && id > 0);
      const maxTgId = tgIds.length > 0 ? Math.max(...tgIds) : undefined;
      if ((targetChatObj?.unreadCount || 0) > 0 || maxTgId !== undefined) {
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
    const trimmed = newTitle.trim();
    if (!trimmed) return { ok: false, error: '备注名称不能为空' };
    if (isTelegramCloudChat(chatId)) {
      const cloudRes = await renameTelegramContactApi({
        accountId: activeAccountId,
        chatId,
        newTitle: trimmed,
      });
      if (!cloudRes.ok) {
        const errMsg = cloudRes.error || '同步云端联系人备注失败';
        showCloudError(errMsg);
        return { ok: false, error: errMsg };
      }
    }
    setChats((prev) => {
      const updated = prev.map((c) =>
        c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)
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
        saveScopedContacts(next, activeAccountId);
      }
      return changed ? next : prev;
    });
    if (!updatedExistingContact && isTelegramCloudChat(chatId) && activeAccountId.startsWith('acc_tg_')) {
      fetchTelegramUserContactsApi(activeAccountId)
        .then((res) => {
          if (res.ok && Array.isArray(res.contacts)) {
            handleSyncContacts(res.contacts, activeAccountId);
          }
        })
        .catch(() => {});
    }
    return { ok: true };
  };

  // Switch Active Telegram Account (account-level useEffect handles real dialog sync & auto-selection cleanly without duplicate calls)
  const handleSelectAccount = (accountId: string) => {
    selectAccountSeqRef.current += 1;
    selectChatSeqRef.current += 1;
    pendingAutoSelectAccountRef.current = accountId;
    activeAccountIdRef.current = accountId;
    activeChatIdRef.current = null;
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
    const newAcc: Account = {
      id,
      name: newAccountData.name || 'Telegram 账号',
      username: newAccountData.username || `@user_${id.slice(-4)}`,
      phone: newAccountData.phone || '',
      avatarBg: newAccountData.avatarBg || '#2481cc',
      avatarInitial: newAccountData.avatarInitial || 'TG',
      unreadTotal: 0,
      isActive: false,
      status: 'online',
      bio: newAccountData.bio || 'Telegram 账号',
    };

    setAccounts((prev) => {
      const filtered = prev.filter((a) => a.id !== id);
      return [...filtered, newAcc];
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
    void clearAccountPendingMediaBlobs(id);

    setAccounts(remaining);
    setChats(remainingChats);
    setMessagesMap(nextMessagesMap);
    if (isHydrated) {
      secureSetItemSync('tg_pro_accounts', remaining);
      secureSetItemSync('tg_pro_chats', remainingChats);
    }

    if (activeAccountId === id) {
      if (remaining.length > 0) {
        handleSelectAccount(remaining[0].id);
      } else {
        setActiveAccountId('');
        setActiveApiAccount('');
        setActiveChatId(null);
        setCustomerProfile(null);
      }
    } else if (activeChatId && unsharedRemovedChatIds.includes(activeChatId)) {
      setActiveChatId(null);
      setCustomerProfile(null);
    }
  };

  // Update per-chat translation language pair strictly scoped to activeAccountId (never mutate global defaultSourceLang/defaultTargetLang)
  const handleUpdateChatLanguage = (chatId: string, sourceLang: string, targetLang: string) => {
    setChats((prev) => {
      const updated = prev.map((c) =>
        c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)
          ? { ...c, sourceLang, targetLang }
          : c
      );
      if (isHydrated) {
        secureSetItemSync('tg_pro_chats', updated);
      }
      return updated;
    });
    if (isMemberAuthenticated) {
      saveChatLanguagePrefApi(chatId, sourceLang, targetLang, activeAccountId).catch(() => {});
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
    if (isCustomPriority && newSettings.preferredEngine !== 'custom_llm') {
      showCloudError('已开启「优先自有密钥回复」，翻译引擎锁定为「自定义模型」');
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
            ? { ...c, lastMessage: summary, lastTime: last.timestamp || c.lastTime }
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
            ? { ...c, lastMessage: summary, lastTime: last.timestamp || c.lastTime }
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
              ? { ...c, lastMessage: summary, lastTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) }
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
            ? { ...c, lastMessage: summary, lastTime: nowTime }
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

  const handleRetranslateMessage = async (messageId: string): Promise<void> => {
    const targetChatId = activeChatIdRef.current;
    const targetAccountId = activeAccountIdRef.current;
    if (!targetChatId) return;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const currentList = getBucketMessages(messagesMapRef.current, targetAccountId, targetChatId);
    const targetMsg = currentList.find((m) => m.id === messageId);
    if (!targetMsg) return;

    const rawText = (targetMsg.sttText || targetMsg.text || targetMsg.imageCaption || '').trim();
    if (
      !rawText ||
      /^\[(语音|视频|图片|多媒体|文件)消息\]$/.test(rawText) ||
      rawText.startsWith('🎤') ||
      rawText.startsWith('🖼️') ||
      rawText.startsWith('🎬') ||
      rawText.startsWith('📁')
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
    const currentLlm = customLLMConfigRef.current;
    const currentTrans = translationSettingsRef.current;
    const effectiveEngine = isHistoricalTarget
      ? 'google'
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
        isHistoricalTarget ? currentTrans.googleApiKey : undefined,
        isHistoricalTarget ? undefined : currentTrans.geminiModel,
        isHistoricalTarget ? undefined : currentTrans.geminiApiKey,
        isHistoricalTarget ? undefined : currentTrans.customModelName,
        { bypassCache: true, ...(isHistoricalTarget ? { purpose: 'history' as const } : {}) }
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
    } catch (err: any) {
      const errMsg = err?.message || '重新翻译失败';
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
    const targetChat = chats.find((c) => c.id === chatId && (!activeAccountId || c.accountId === activeAccountId));
    const nextMuted = !targetChat?.isMuted;
    if (isTelegramCloudChat(chatId)) {
      const res = await toggleTelegramDialogMuteApi({
        accountId: activeAccountId,
        chatId,
        muted: nextMuted,
      });
      if (!res.ok) {
        showCloudError(res.error || '同步云端静音设置失败');
        return;
      }
    }
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)
          ? { ...c, isMuted: nextMuted }
          : c
      )
    );
  };

  const handleTogglePinChat = async (chatId: string) => {
    const targetChat = chats.find((c) => c.id === chatId && (!activeAccountId || c.accountId === activeAccountId));
    const nextPinned = !targetChat?.isPinned;
    if (isTelegramCloudChat(chatId)) {
      const res = await toggleTelegramDialogPinApi({
        accountId: activeAccountId,
        chatId,
        pinned: nextPinned,
      });
      if (!res.ok) {
        showCloudError(res.error || '同步云端置顶对话失败');
        return;
      }
    }
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)
          ? { ...c, isPinned: nextPinned }
          : c
      )
    );
  };

  const handleToggleArchiveChat = async (chatId: string) => {
    const targetChat = chats.find((c) => c.id === chatId && (!activeAccountId || c.accountId === activeAccountId));
    const nextArchived = !targetChat?.isArchived;
    if (isTelegramCloudChat(chatId)) {
      const res = await toggleTelegramDialogArchiveApi({
        accountId: activeAccountId,
        chatId,
        archived: nextArchived,
      });
      if (!res.ok) {
        showCloudError(res.error || '同步云端归档失败');
        return;
      }
    }
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)
          ? { ...c, isArchived: nextArchived }
          : c
      )
    );
  };

  const handleToggleMarkUnread = async (chatId: string) => {
    const targetChat = chats.find((c) => c.id === chatId && (!activeAccountId || c.accountId === activeAccountId));
    const nextUnread = (targetChat?.unreadCount || 0) === 0;
    if (isTelegramCloudChat(chatId)) {
      const res = await toggleTelegramDialogUnreadApi({
        accountId: activeAccountId,
        chatId,
        unread: nextUnread,
      });
      if (!res.ok) {
        showCloudError(res.error || '同步云端已读/未读状态失败');
        return;
      }
    }
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId || (activeAccountId && c.accountId !== activeAccountId)) return c;
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
    setMessagesMap((prev) => {
      const next = { ...prev };
      delete next[bucketKey];
      return next;
    });
    setChats((prev) =>
      prev.filter((c) => !(c.id === chatId && (!targetAccountId || c.accountId === targetAccountId)))
    );
    if (activeChatIdRef.current === chatId) {
      activeChatIdRef.current = null;
      setActiveChatId(null);
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

  const handleStartCall = (contactName: string) => {
    const recId = `call_${Date.now()}`;
    const newRecord: TelegramCallRecord = {
      id: recId,
      accountId: activeAccountId,
      contactName,
      avatarBg: '#2ba0ff',
      avatarInitial: contactName.slice(0, 2).toUpperCase(),
      type: 'outgoing',
      duration: '00:00',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    };
    activeCallRecordIdRef.current = recId;
    setCallRecords((prev) => [newRecord, ...prev]);
    setIsCallsOpen(false);
    setVoiceCallTargetName(contactName);
    setIsVoiceCallOpen(true);
  };

  const handleUpdateCurrentAccount = (updated: Partial<Account>, targetAccountId?: string) => {
    const idToUpdate = targetAccountId || activeAccountId;
    setAccounts((prev) =>
      prev.map((a) => (a.id === idToUpdate ? { ...a, ...updated } : a))
    );
  };

  const currentAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f4f7fb] text-[#0f172a] dark:bg-[#05080f] dark:text-[#eef4fb] font-sans antialiased transition-colors">
      {/* 1. Leftmost Features & Multi-Account Activity Rail (56px) */}
      <LeftSidebar
        accounts={accounts.map((a) => ({
          ...a,
          unreadTotal: chats
            .filter((c) => c.accountId === a.id && !c.isArchived)
            .reduce((sum, c) => sum + (c.unreadCount || 0), 0),
        }))}
        activeAccountId={activeAccountId}
        onSelectAccount={(accountId) => {
          handleSelectAccount(accountId);
          setIsMultiAccountOpen(false);
        }}
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
          (currentAccount.status === 'offline' ||
            currentAccount.status === 'away' ||
            currentAccount.status === 'expired') && (
            <div
              className={`shrink-0 px-4 py-2 border-b flex items-center justify-between gap-3 text-xs ${
                currentAccount.status === 'expired'
                  ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-200'
                  : 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    currentAccount.status === 'expired'
                      ? 'bg-rose-500'
                      : currentAccount.status === 'away'
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-slate-400'
                  }`}
                />
                <span className="truncate font-medium">
                  {currentAccount.status === 'expired'
                    ? `Telegram 账号「${currentAccount.name}」会话已失效或被限制，当前为只读离线浏览`
                    : currentAccount.status === 'away'
                      ? `Telegram 账号「${currentAccount.name}」正在恢复连接（当前可离线浏览本地历史）`
                      : `Telegram 账号「${currentAccount.name}」当前处于离线状态`}
                  {offlineReasonByAccount[currentAccount.id]
                    ? `：${offlineReasonByAccount[currentAccount.id]}`
                    : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {currentAccount.status !== 'expired' && (
                  <button
                    type="button"
                    disabled={isReconnectingAccount}
                    onClick={handleReconnectTelegram}
                    className="px-2.5 py-1 rounded-lg bg-[#2481cc] hover:bg-[#1e6fb0] text-white font-medium cursor-pointer transition-colors disabled:opacity-50"
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
                  className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 border border-current/20 font-medium cursor-pointer transition-colors"
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
        />

        {/* 3. Official Telegram Center Main Chat Workbench Pane (flex-1) */}
        <ChatArea
          chat={currentChat}
          messages={currentMessages}
          translationSettings={translationSettings}
          onSendMessage={handleSendMessage}
          onCloseChat={() => setActiveChatId(null)}
          onUpdateChatLanguage={handleUpdateChatLanguage}
          onOpenTranslation={() => toggleRightPanel('translation')}
          onOpenCustomLLM={() => toggleRightPanel('llm')}
          customLLMConfig={customLLMConfig}
          currentAccountId={activeAccountId}
          onOpenKnowledgeEvolution={() => toggleRightPanel('persona')}
          activeRightPanel={activeRightPanel}
          isChatInfoOpenExternal={isChatInfoOpen}
          onChatInfoOpenChange={(open) => {
            setIsChatInfoOpen(open);
            if (open) setActiveRightPanel(null);
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
          onOpenVoiceCall={() => {
            const targetName = currentChat?.title || 'Telegram 用户';
            const recId = `call_${Date.now()}`;
            activeCallRecordIdRef.current = recId;
            setCallRecords((prev) => [
              {
                id: recId,
                accountId: activeAccountId,
                contactName: targetName,
                avatarBg: currentChat?.avatarBg || '#2481cc',
                avatarInitial: currentChat?.avatarInitial || targetName.slice(0, 2).toUpperCase(),
                type: 'outgoing',
                duration: '00:00',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
              },
              ...prev,
            ]);
            setVoiceCallTargetName(targetName);
            setIsVoiceCallOpen(true);
          }}
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

        {/* 3.5 Unified Right Push-Split Workspace Dock (440px Desktop / Slide-over Mobile) */}
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
              updated.chatId !== activeChatIdRef.current
            ) {
              return;
            }
            if (
              updated.accountId &&
              activeAccountIdRef.current &&
              updated.accountId !== activeAccountIdRef.current
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
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onOpenNewGroup={() => setIsNewGroupOpen(true)}
        onOpenNewChannel={() => setIsNewChannelOpen(true)}
        onOpenContacts={() => setIsContactsOpen(true)}
        onOpenCalls={() => setIsCallsOpen(true)}
        onOpenTelegramSettings={() => setIsTelegramSettingsOpen(true)}
        onOpenKnowledgeEvolution={() => openRightPanel('persona')}
        currentMember={currentMember}
        onMemberLogout={handleMemberLogout}
      />

      {/* 5. Multi-Account Switcher & Login Modal */}
      <MultiAccountModal
        isOpen={isMultiAccountOpen}
        onClose={() => {
          setIsMultiAccountOpen(false);
          setReloginAccount(null);
        }}
        accounts={accounts}
        activeAccountId={activeAccountId}
        onSelectAccount={handleSelectAccount}
        onAddAccount={handleAddAccount}
        onDeleteAccount={handleDeleteAccount}
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

      {/* 17. Telegram Call Records & Dialing Modal (strictly scoped by active account) */}
      <TelegramCallsModal
        isOpen={isCallsOpen}
        onClose={() => setIsCallsOpen(false)}
        callRecords={callRecords.filter((rec) => !rec.accountId || !activeAccountId || rec.accountId === activeAccountId)}
        onStartCall={handleStartCall}
      />

      {/* 18. Official Telegram Account & Client Settings Modal */}
      <TelegramSettingsModal
        isOpen={isTelegramSettingsOpen}
        onClose={() => setIsTelegramSettingsOpen(false)}
        currentAccount={currentAccount}
        onUpdateAccount={handleUpdateCurrentAccount}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onOpenSystemAdmin={() => setIsSystemSettingsOpen(true)}
        clientPrefs={clientPrefs}
        onUpdateClientPrefs={setClientPrefs}
        onBlockStatusChanged={handleContactBlockChanged}
      />

      {/* 19. Telegram Voice Call Modal */}
      <TelegramVoiceCallModal
        isOpen={isVoiceCallOpen}
        onClose={() => {
          setIsVoiceCallOpen(false);
          activeCallRecordIdRef.current = null;
        }}
        chat={voiceCallTargetName && currentChat?.title !== voiceCallTargetName ? null : currentChat}
        currentAccountId={activeAccountId}
        contactName={voiceCallTargetName || currentChat?.title}
        avatarBg={currentChat?.avatarBg}
        avatarInitial={currentChat?.avatarInitial}
        onCallEnded={(durationSeconds, outcome) => {
          const targetRecId = activeCallRecordIdRef.current;
          if (!targetRecId) return;
          const mins = Math.floor(durationSeconds / 60);
          const secs = durationSeconds % 60;
          const formatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
          setCallRecords((prev) =>
            prev.map((rec) =>
              rec.id === targetRecId
                ? {
                    ...rec,
                    duration: formatted,
                    type: outcome === 'missed' && durationSeconds === 0 ? 'missed' : rec.type,
                  }
                : rec
            )
          );
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
            await syncTelegramAccountStatus();
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
    </div>
  );
};
