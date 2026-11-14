import React, { useState, useEffect, useRef } from 'react';
import { LeftSidebar } from './components/LeftSidebar';
import { ChatList } from './components/ChatList';
import { ChatArea } from './components/ChatArea';
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
import { getMasterVoiceprint } from './services/voiceprintStorage';
import {
  INITIAL_ACCOUNTS,
  INITIAL_CHATS,
  INITIAL_MESSAGES,
  INITIAL_TRANSLATION_SETTINGS,
  INITIAL_CUSTOM_LLM
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
  syncTelegramCloudMessages,
  fetchTelegramActiveAccounts,
  fetchTelegramUserStatusApi,
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
  isMessageDeleted,
  deleteMessageFromDb,
  getLocalCustomerProfile,
  saveLocalCustomerProfile,
  translateText,
  syncCustomLLMConfigApi,
  syncTranslationSettingsApi,
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
} from './services/apiService';


import { secureGetItemSync, secureSetItemSync, secureGetItemAsync } from './services/cryptoStorage';

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
      ? legacy.filter((m) => (accountId === 'acc_1' && !m.accountId) || m.accountId === accountId)
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
    sourceLang: existing?.sourceLang || 'Auto',
    targetLang: existing?.targetLang || 'Chinese',
  };
}

function mergeCloudMessagesWithLocal(localMsgs: Message[], cloudMsgs: Message[]): Message[] {
  const visibleLocal = (Array.isArray(localMsgs) ? localMsgs : []).filter((m) => !isMessageDeleted(m.id));
  const visibleCloud = (Array.isArray(cloudMsgs) ? cloudMsgs : []).filter((m) => !isMessageDeleted(m.id));
  if (visibleCloud.length === 0) return visibleLocal;

  const localById = new Map<string, Message>();
  const localByTgId = new Map<number, Message>();
  visibleLocal.forEach((m) => {
    localById.set(m.id, m);
    if (typeof m.telegramMessageId === 'number') {
      localByTgId.set(m.telegramMessageId, m);
    }
  });

  const matchedLocalIds = new Set<string>();
  const mergedCloud = visibleCloud.map((cm) => {
    let lm = localById.get(cm.id);
    if (!lm && typeof cm.telegramMessageId === 'number') {
      lm = localByTgId.get(cm.telegramMessageId);
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
    if (lm.deliveryStatus === 'pending' || lm.deliveryStatus === 'retrying' || lm.deliveryStatus === 'failed') {
      return true;
    }
    // Keep older cached local messages from before the latest 40-message cloud window
    if (cloudMinTgId !== null && typeof lm.telegramMessageId === 'number' && lm.telegramMessageId < cloudMinTgId) {
      return true;
    }
    return false;
  });

  return [...retainedLocal, ...mergedCloud];
}

const DEFAULT_CONTACTS: TelegramContact[] = [
  { id: 'contact_alex', name: 'Alex Cooper', phone: '+1 202 555 0148', username: '@alex_cooper_trade', avatarBg: '#65aadd', avatarInitial: 'AC', status: 'online', bio: 'Senior Import & Logistics Partner' },
  { id: 'contact_elena', name: 'Elena Rostova', phone: '+7 916 555 3421', username: '@elena_rostova', avatarBg: '#e17076', avatarInitial: 'ER', status: 'online', bio: 'Moscow Regional Supply Chain' },
  { id: 'contact_david', name: 'David Harrison', phone: '+44 7911 123456', username: '@david_harrison_vip', avatarBg: '#7bc862', avatarInitial: 'DH', status: 'offline', bio: 'Global Business Development Lead' },
  { id: 'contact_katarina', name: 'Katarina Volkova', phone: '+90 532 555 7890', username: '@katarina_v', avatarBg: '#a695e7', avatarInitial: 'KV', status: 'online', bio: 'Istanbul Luxury Goods Specialist' },
];

const DEFAULT_CALL_RECORDS: TelegramCallRecord[] = [
  { id: 'call_rec_1', contactName: 'Elena Rostova', avatarBg: '#e17076', avatarInitial: 'ER', type: 'incoming', duration: '03:42', timestamp: '今天 10:24' },
  { id: 'call_rec_2', contactName: 'Alex Cooper', avatarBg: '#65aadd', avatarInitial: 'AC', type: 'outgoing', duration: '01:15', timestamp: '昨天 17:50' },
  { id: 'call_rec_3', contactName: 'David Harrison', avatarBg: '#7bc862', avatarInitial: 'DH', type: 'missed', duration: '00:00', timestamp: '周一 14:12' },
];

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
    return accounts[0]?.id || '';
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
    const saved = secureGetItemSync<Record<string, Message[]>>('tg_pro_messages');
    return saved || INITIAL_MESSAGES;
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

  // Telegram Voice Call modal state
  const [isVoiceCallOpen, setIsVoiceCallOpen] = useState(false);
  const [voiceCallTargetName, setVoiceCallTargetName] = useState<string>('');

  // Telegram contacts and call history state
  const [contacts, setContacts] = useState<TelegramContact[]>(() => {
    try {
      const saved = localStorage.getItem('tg_pro_contacts');
      return saved ? JSON.parse(saved) : DEFAULT_CONTACTS;
    } catch {
      return DEFAULT_CONTACTS;
    }
  });

  const [callRecords, setCallRecords] = useState<TelegramCallRecord[]>(() => {
    try {
      const saved = localStorage.getItem('tg_pro_call_records');
      return saved ? JSON.parse(saved) : DEFAULT_CALL_RECORDS;
    } catch {
      return DEFAULT_CALL_RECORDS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('tg_pro_contacts', JSON.stringify(contacts));
    } catch {}
  }, [contacts]);

  useEffect(() => {
    try {
      localStorage.setItem('tg_pro_call_records', JSON.stringify(callRecords));
    } catch {}
  }, [callRecords]);

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

  const [isHydrated, setIsHydrated] = useState(false);

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

      if (savedMsgs && Object.keys(savedMsgs).length > 0) {
        if (isRestore) {
          const mergedMsgs: Record<string, Message[]> = { ...savedMsgs };
          const curChatId = activeChatIdRef.current;
          const curAccId = resolvedActiveAccId || activeAccountIdRef.current;
          if (curChatId) {
            const localMsgs = getLocalMessages(curChatId, curAccId);
            if (localMsgs.length > 0) {
              mergedMsgs[msgBucketKey(curAccId, curChatId)] = localMsgs;
            }
          }
          setMessagesMap(mergedMsgs);
        } else {
          setMessagesMap(savedMsgs);
        }
      } else if (isRestore) {
        const reconstructed: Record<string, Message[]> = {};
        const chatsToScan = nextChats || chatsRef.current;
        for (const c of chatsToScan) {
          const acc = c.accountId || resolvedActiveAccId || activeAccountIdRef.current;
          const scopedKey = acc ? `tg_desktop_msgs_${acc}_${c.id}` : `tg_desktop_msgs_${c.id}`;
          let msgs = await secureGetItemAsync<Message[]>(scopedKey);
          if ((!msgs || msgs.length === 0) && acc) {
            const legacy = await secureGetItemAsync<Message[]>(`tg_desktop_msgs_${c.id}`);
            if (Array.isArray(legacy)) {
              msgs = legacy.filter((m) => (acc === 'acc_1' && !m.accountId) || m.accountId === acc);
            }
          }
          if (Array.isArray(msgs) && msgs.length > 0) {
            reconstructed[msgBucketKey(acc, c.id)] = msgs.filter(
              (m) => !isMessageDeleted(m.id) && (!acc || !m.accountId || m.accountId === acc)
            );
          }
        }
        if (Object.keys(reconstructed).length > 0) {
          setMessagesMap(reconstructed);
        }
      }

      if (savedTrans) {
        const rawEngine = (savedTrans as any).preferredEngine;
        const normalizedEngine: 'gemini' | 'google' | 'custom_llm' =
          rawEngine === 'google' || rawEngine === 'custom_llm' || rawEngine === 'gemini' ? rawEngine : 'gemini';
        const rawModel = String((savedTrans as any).geminiModel || '').toLowerCase();
        const normalizedGemmaModel = rawModel.includes('31b') ? 'gemma-4-31b-it' : 'gemma-4-26b-a4b-it';
        setTranslationSettings({
          ...INITIAL_TRANSLATION_SETTINGS,
          ...savedTrans,
          preferredEngine: normalizedEngine,
          geminiModel: normalizedGemmaModel,
        });
      }
      if (savedLLM) {
        setCustomLLMConfig({
          ...savedLLM,
          engineMode: savedLLM.engineMode || (savedLLM.baseUrl && !isBuiltInCloudGatewayUrl(savedLLM.baseUrl) ? 'custom' : 'cloud'),
          baseUrl: isBuiltInCloudGatewayUrl(savedLLM.baseUrl) ? '' : savedLLM.baseUrl,
          knowledgeBaseApiUrl: isBuiltInCloudGatewayUrl(savedLLM.knowledgeBaseApiUrl) ? '' : savedLLM.knowledgeBaseApiUrl,
        });
      }

      if (isRestore) {
        try {
          const savedContacts = localStorage.getItem('tg_pro_contacts');
          if (savedContacts) setContacts(JSON.parse(savedContacts));
        } catch {}
        try {
          const savedCalls = localStorage.getItem('tg_pro_call_records');
          if (savedCalls) setCallRecords(JSON.parse(savedCalls));
        } catch {}
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
        const mv = getMasterVoiceprint();
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

  useEffect(() => {
    if (!isHydrated) return;
    secureSetItemSync('tg_pro_messages', messagesMap);
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
        if (handshake.authenticated && handshake.user) {
          setCurrentMember(storedUser ? { ...storedUser, ...handshake.user } : handshake.user);
          setIsMemberAuthenticated(true);
          setCustomLLMConfig((prev) =>
            !prev.enabled && prev.engineMode !== 'custom' && !prev.baseUrl?.trim()
              ? { ...prev, enabled: true, engineMode: 'cloud', enableKnowledgeBaseRAG: true }
              : prev
          );
        } else if (status.authenticated && status.user) {
          setCurrentMember(storedUser ? { ...storedUser, ...status.user } : status.user);
          setIsMemberAuthenticated(true);
          setCustomLLMConfig((prev) =>
            !prev.enabled && prev.engineMode !== 'custom' && !prev.baseUrl?.trim()
              ? { ...prev, enabled: true, engineMode: 'cloud', enableKnowledgeBaseRAG: true }
              : prev
          );
        } else {
          setIsMemberAuthenticated(false);
          setCurrentMember(null);
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

  const notifiedExpiredRef = useRef<Set<string>>(new Set());

  const handleMemberLogout = async () => {
    await adminLogout();
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
    const isCustomPriority = Boolean(customLLMConfig.enabled && customLLMConfig.engineMode === 'custom');
    if (!isCustomPriority && translationSettings.preferredEngine === 'custom_llm') {
      setTranslationSettings((prev) =>
        prev.preferredEngine === 'custom_llm' ? { ...prev, preferredEngine: 'gemini' } : prev
      );
    }
  }, [isHydrated, customLLMConfig.enabled, customLLMConfig.engineMode, translationSettings.preferredEngine]);

  // Sync active connected Telegram accounts & real MTProto connectivity + expired sessions
  useEffect(() => {
    if (!isMemberAuthenticated) return;
    let isMounted = true;

    const syncTelegramAccountStatus = async () => {
      const [activeAccs, statusRes] = await Promise.all([
        fetchTelegramActiveAccounts(),
        fetchTelegramUserStatusApi(),
      ]);
      if (!isMounted) return;

      const statusById = new Map<string, 'online' | 'away' | 'offline' | 'expired'>();
      if (statusRes.ok) {
        statusRes.activeUsers.forEach((u) => {
          const nextStatus: 'online' | 'away' | 'offline' =
            u.isConnected ? 'online' : u.isInMemoryConnected ? 'away' : 'offline';
          statusById.set(u.id, nextStatus);
        });
        statusRes.expiredAccounts.forEach((exp) => {
          const expId = exp.accountId || (exp.userId ? `acc_tg_${exp.userId}` : '');
          if (expId) {
            statusById.set(expId, 'expired');
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

    void syncTelegramAccountStatus();
    const initialRetryTimer = setTimeout(() => {
      void syncTelegramAccountStatus();
    }, 2500);
    const statusPollTimer = setInterval(() => {
      void syncTelegramAccountStatus();
    }, 15000);

    return () => {
      isMounted = false;
      clearTimeout(initialRetryTimer);
      clearInterval(statusPollTimer);
    };
  }, [isMemberAuthenticated]);

  // Zero-DB Local Storage: Load local messages and customer memory for the active chat
  useEffect(() => {
    if (!activeAccountId || !isMemberAuthenticated) return;
    setActiveApiAccount(activeAccountId);

    let isMounted = true;

    // Load dialogs/chats for this account
    const syncChats = () => {
      const targetAccId = activeAccountId;
      fetchChatsFromDb(targetAccId).then((dbChats) => {
        if (isMounted && dbChats && dbChats.length > 0) {
          const scopedDbChats = dbChats.filter((dbc: Chat) => {
            const rowAcc = dbc.accountId || targetAccId;
            return (
              rowAcc === targetAccId ||
              (rowAcc === 'acc_telegram_bot' && (targetAccId === 'acc_telegram_bot' || targetAccId === 'acc_1'))
            );
          });
          if (scopedDbChats.length === 0) return;
          setChats((prev) => {
            const map = new Map<string, Chat>();
            prev.forEach((c) => map.set(msgBucketKey(c.accountId || targetAccId, c.id), c));
            scopedDbChats.forEach((dbc: Chat) => {
              const bucketKey = msgBucketKey(dbc.accountId || targetAccId, dbc.id);
              const existing = map.get(bucketKey);
              if (existing) {
                map.set(bucketKey, { ...existing, lastMessage: dbc.lastMessage, lastTime: dbc.lastTime });
              } else {
                map.set(bucketKey, dbc);
              }
            });
            return Array.from(map.values());
          });
        }
      });

      // Also sync live MTProto cloud dialogs if this is a connected personal Telegram account
      if (activeAccountId && (activeAccountId.startsWith('acc_tg_') || activeAccountId !== 'acc_telegram_bot')) {
        fetchTelegramUserDialogsDetailedApi(activeAccountId).then((res) => {
          if (!isMounted) return;
          if (!res.ok) {
            if (res.code === 'TELEGRAM_SESSION_EXPIRED') {
              setAccounts((prev) =>
                prev.map((a) =>
                  a.id === activeAccountId
                    ? { ...a, status: 'expired', bio: '会话已失效，请重新登录' }
                    : a
                )
              );
              if (!notifiedExpiredRef.current.has(activeAccountId)) {
                notifiedExpiredRef.current.add(activeAccountId);
                showCloudError(res.error || 'Telegram 登录会话已失效，请重新扫码或验证码登录');
              }
            }
            return;
          }
          const realDialogs = res.dialogs;
          setChats((prev) => {
            const otherChats = prev.filter((c) => c.accountId !== activeAccountId);
            const prevAccountChats = prev.filter((c) => c.accountId === activeAccountId);
            const prevMap = new Map<string, Chat>();
            prevAccountChats.forEach((c) => prevMap.set(c.id, c));

            const nextAccountChats: Chat[] = realDialogs.map((d: any) =>
              mapCloudDialogToChat(d, activeAccountId, prevMap.get(d.id))
            );
            // Retain non-tg custom/local contacts if any exist
            const cloudIds = new Set(nextAccountChats.map((c) => c.id));
            prevAccountChats.forEach((c) => {
              if (!c.id.startsWith('tg_') && !cloudIds.has(c.id)) {
                nextAccountChats.push(c);
              }
            });
            return [...nextAccountChats, ...otherChats];
          });
        }).catch(() => {});
      }
    };

    syncChats();
    const chatInterval = setInterval(syncChats, 8000);

    if (activeChatId) {
      const bucketKey = msgBucketKey(activeAccountId, activeChatId);
      const localMsgs = getLocalMessages(activeChatId, activeAccountId);
      if (localMsgs && localMsgs.length > 0) {
        setMessagesMap((prev) => ({
          ...prev,
          [bucketKey]: localMsgs.filter((m) => !isMessageDeleted(m.id)),
        }));
      } else if (INITIAL_MESSAGES[activeChatId] && (!activeAccountId || activeAccountId === 'acc_1')) {
        setMessagesMap((prev) => ({
          ...prev,
          [bucketKey]: INITIAL_MESSAGES[activeChatId].filter((m) => !isMessageDeleted(m.id)),
        }));
      }

      if (!localMsgs || localMsgs.length === 0 || activeAccountId === 'acc_telegram_bot') {
        // Sync server-persisted messages (Bot webhook / unified store) and merge with local cache
        fetchMessagesFromDb(activeChatId, activeAccountId).then((cloudMsgs) => {
          if (isMounted && cloudMsgs && cloudMsgs.length > 0) {
            setMessagesMap((prev) => {
              const base = getBucketMessages(prev, activeAccountId, activeChatId);
              const merged = mergeCloudMessagesWithLocal(
                base.length > 0 ? base : getLocalMessages(activeChatId, activeAccountId),
                cloudMsgs
              );
              setLocalMessages(activeChatId, merged, activeAccountId);
              return { ...prev, [bucketKey]: merged };
            });
          }
        }).catch(() => {});
      }

      if (activeChatId.startsWith('tg_') && activeAccountId !== 'acc_telegram_bot') {
        syncTelegramCloudMessages(activeChatId, activeAccountId).then((cloudMsgs) => {
          if (!isMounted || !cloudMsgs || cloudMsgs.length === 0) return;
          setMessagesMap((prev) => {
            const base = getBucketMessages(prev, activeAccountId, activeChatId);
            const merged = mergeCloudMessagesWithLocal(
              base.length > 0 ? base : getLocalMessages(activeChatId, activeAccountId),
              cloudMsgs
            );
            setLocalMessages(activeChatId, merged, activeAccountId);
            return { ...prev, [bucketKey]: merged };
          });
        }).catch(() => {});

        fetchTelegramChatFullInfoApi(activeChatId, activeAccountId).then((info) => {
          if (!isMounted || !info.ok) return;
          setChats((prev) =>
            prev.map((c) =>
              c.id === activeChatId && (!activeAccountId || c.accountId === activeAccountId)
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

      const localProf = getLocalCustomerProfile(activeChatId, activeAccountId);
      if (localProf) {
        setCustomerProfile(localProf);
      }
      // Always fetch fresh profile from server in background to avoid stale cached persona
      fetchCustomerProfile(activeChatId, activeAccountId).then((prof) => {
        if (isMounted && prof) {
          setCustomerProfile(prof);
          saveLocalCustomerProfile(activeChatId, prof, activeAccountId);
        }
      }).catch(() => {
        // Keep currently rendered localProf if offline or network error
      });
    }

    return () => {
      isMounted = false;
      clearInterval(chatInterval);
    };
  }, [activeChatId, activeAccountId, isMemberAuthenticated]);

  // Keep latest state in refs so background polling never reads stale closures
  const chatsRef = useRef(chats);
  const messagesMapRef = useRef(messagesMap);
  const translationSettingsRef = useRef(translationSettings);
  const customLLMConfigRef = useRef(customLLMConfig);
  const activeAccountIdRef = useRef(activeAccountId);
  const activeChatIdRef = useRef(activeChatId);

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

        const updates = await pollIncomingTelegramUpdates(currentAccId);
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
              isPinned: Boolean(upd.isPinned),
              isEdited: Boolean(upd.isEdited),
              sttText: upd.sttText,
              timestamp: upd.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
              status: 'sent',
              deliveryStatus: 'delivered',
            };

            const targetBucketKey = msgBucketKey(targetAccountId, targetChatId);
            const existingForChat = getBucketMessages(messagesMapRef.current, targetAccountId, targetChatId);
            const matchesMessage = (m: Message) => {
              if (m.id === incomingMsg.id) return true;
              if (
                m.sender === incomingMsg.sender &&
                m.text &&
                incomingMsg.text &&
                m.text.trim() === incomingMsg.text.trim()
              ) {
                if (incomingMsg.sender === 'me') return true;
                if (m.timestamp === incomingMsg.timestamp) return true;
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
            } else if (incomingMsg.translatedText) {
              saveLocalMessage(targetChatId, incomingMsg, targetAccountId);
            }

            setMessagesMap((prev) => {
              const currentList = getBucketMessages(prev, targetAccountId, targetChatId);
              const foundIdx = currentList.findIndex(matchesMessage);

              if (foundIdx >= 0) {
                if (incomingMsg.translatedText && !currentList[foundIdx].translatedText) {
                  const updated = [...currentList];
                  updated[foundIdx] = { ...updated[foundIdx], translatedText: incomingMsg.translatedText };
                  saveLocalMessage(targetChatId, updated[foundIdx], targetAccountId);
                  return {
                    ...prev,
                    [targetBucketKey]: updated,
                  };
                }
                return prev;
              }

              saveLocalMessage(targetChatId, incomingMsg, targetAccountId);
              return {
                ...prev,
                [targetBucketKey]: [...currentList, incomingMsg],
              };
            });

            if (isDuplicateMsg) {
              return;
            }

            // Real Auto-translate inbound message if enabled (using latest settings & chat language)
            const matchedChatForLang = currentChats.find(
              (c) => c.id === targetChatId && c.accountId === targetAccountId
            );
            const inboundTargetLang =
              (matchedChatForLang?.targetLang && matchedChatForLang.targetLang !== 'Auto'
                ? matchedChatForLang.targetLang
                : currentTransSettings.defaultTargetLang) || 'Chinese';

            if (
              currentTransSettings.autoTranslateInbound !== false &&
              incomingMsg.sender === 'peer' &&
              incomingMsg.text &&
              !incomingMsg.text.startsWith('🎤') &&
              !incomingMsg.text.startsWith('🖼️') &&
              !incomingMsg.translatedText
            ) {
              const strictEngine =
                currentTransSettings.preferredEngine === 'google' ||
                currentTransSettings.preferredEngine === 'custom_llm' ||
                currentTransSettings.preferredEngine === 'gemini'
                  ? currentTransSettings.preferredEngine
                  : 'gemini';

              translateText(
                incomingMsg.text,
                'Auto',
                inboundTargetLang,
                currentLLMConfig,
                strictEngine,
                undefined,
                currentTransSettings.geminiModel,
                currentTransSettings.geminiApiKey,
                currentTransSettings.customModelName
              )
                .then((trans) => {
                  if (trans && trans !== incomingMsg.text) {
                    const withTrans: Message = { ...incomingMsg, translatedText: trans, translationError: undefined };
                    saveLocalMessage(targetChatId, withTrans, targetAccountId);
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

            const summaryText = incomingMsg.isAudio
              ? '🎤 语音消息'
              : incomingMsg.isImage
              ? '🖼️ 图片消息'
              : incomingMsg.text;

            setChats((prev) => {
              const exists = prev.some((c) => c.id === targetChatId && c.accountId === targetAccountId);
              if (!exists) {
                const newChat: Chat = {
                  id: targetChatId,
                  accountId: targetAccountId,
                  title: isOfficialNotice ? officialTitle : (upd.senderName || `Telegram (${targetChatId.replace('tg_', '')})`),
                  unreadCount: 1,
                  lastMessage: summaryText,
                  lastTime: incomingMsg.timestamp,
                  avatarInitial: isOfficialNotice ? 'TG' : (upd.senderName || 'TG').slice(0, 2).toUpperCase(),
                  avatarBg: '#2481cc',
                  isGroup: false,
                  isVerified: isOfficialNotice,
                  sourceLang: 'auto',
                  targetLang: currentTransSettings.defaultTargetLang || 'zh-CN',
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
                          : (c.unreadCount || 0) + 1,
                    }
                  : c
              );
            });
          });

          if (processedIds.length > 0) {
            await ackIncomingTelegramUpdates(processedIds, currentAccId);
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
  }, [activeAccountId, activeChatId, isMemberAuthenticated]);

  // Active Chats for currently selected account strictly isolated
  const currentAccountChats = chats.filter((c) => {
    if (!activeAccountId) return true;
    return c.accountId === activeAccountId;
  });
  const currentChat = currentAccountChats.find((c) => c.id === activeChatId) || null;
  const currentMessages = activeChatId ? getBucketMessages(messagesMap, activeAccountId, activeChatId) : [];

  // Handle select chat (Saved Messages connects to real 'me' / InputPeerSelf cloud dialog)
  const handleSelectChat = async (chatId: string) => {
    if (chatId === 'chat_saved_messages') {
      const res = await fetchTelegramSavedMessagesApi(activeAccountId);
      if (!res.ok || !res.chat) {
        showCloudError(res.error || '当前账号未连接 Telegram，无法打开官方云端收藏夹 (Saved Messages)');
        return;
      }
      const targetAccId = res.chat.accountId || activeAccountId;
      const realSavedChat: Chat = {
        ...res.chat,
        accountId: targetAccId,
      };
      const cloudMsgs = Array.isArray(res.messages) ? res.messages : [];
      const bucketKey = msgBucketKey(targetAccId, realSavedChat.id);
      setChats((prev) => {
        const cleaned = prev.filter(
          (c) =>
            !(c.accountId === targetAccId && (c.id === 'chat_saved_messages' || c.id === realSavedChat.id))
        );
        return [realSavedChat, ...cleaned];
      });
      setMessagesMap((prev) => {
        setLocalMessages(realSavedChat.id, cloudMsgs, targetAccId);
        return { ...prev, [bucketKey]: cloudMsgs };
      });
      setActiveChatId(realSavedChat.id);
      return;
    }
    setActiveChatId(chatId);
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)
          ? { ...c, unreadCount: 0 }
          : c
      )
    );
  };

  // Handle send message (Zero-DB mandate: strictly save locally in browser storage)
  const handleSendMessage = (newMsg: Partial<Message> & { skipCloudRelay?: boolean }) => {
    if (!activeChatId) return;

    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const senderRole = newMsg.sender || 'me';
    const isTelegramOutbound =
      senderRole === 'me' &&
      (targetChatId.startsWith('tg_') || targetAccountId === 'acc_telegram_bot');

    const fullMessage: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
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
      timestamp: newMsg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      status: 'sent',
      deliveryStatus: newMsg.deliveryStatus || (isTelegramOutbound ? 'pending' : 'delivered'),
    };

    // 1. Store only in local client storage
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
              lastMessage: fullMessage.isAudio
                ? '🎤 语音消息'
                : fullMessage.isVideo
                ? '🎬 [视频]'
                : fullMessage.isImage
                ? '🖼️ [图片]'
                : fullMessage.isFile
                ? `📁 [文件] ${fullMessage.fileName || ''}`
                : fullMessage.text,
              lastTime: fullMessage.timestamp,
            }
          : c
      )
    );

    if (newMsg.skipCloudRelay) {
      return;
    }

    // 3. Relay outbound to MTProto or Telegram Bot and synchronize true deliveryStatus & telegramMessageId
    saveMessageToDb(fullMessage).then((result) => {
      const finalStatus = result.deliveryStatus;
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
      setMessagesMap((prev) => {
        const list = getBucketMessages(prev, targetAccountId, targetChatId);
        if (list.length === 0) return prev;
        const updated = list.map((m) =>
          m.id === fullMessage.id
            ? {
                ...m,
                deliveryStatus: finalStatus,
                ...(result.telegramMessageId ? { telegramMessageId: result.telegramMessageId } : {}),
              }
            : m
        );
        setLocalMessages(targetChatId, updated, targetAccountId);
        return { ...prev, [bucketKey]: updated };
      });
    });
  };

  const handleRetryMessage = async (messageId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!activeChatId) return { ok: false, error: '未选中对话' };
    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const targetMsg = getBucketMessages(messagesMap, targetAccountId, targetChatId).find((m) => m.id === messageId);
    if (!targetMsg) return { ok: false, error: '未找到要重发的消息' };

    setMessagesMap((prev) => {
      const list = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = list.map((m) =>
        m.id === messageId ? { ...m, deliveryStatus: 'retrying' as const } : m
      );
      setLocalMessages(targetChatId, updated, targetAccountId);
      return { ...prev, [bucketKey]: updated };
    });

    const result = await retryMessageDelivery(messageId, targetAccountId, targetMsg);
    const nextStatus = result.deliveryStatus;
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
    setMessagesMap((prev) => {
      const list = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = list.map((m) =>
        m.id === messageId
          ? {
              ...m,
              deliveryStatus: nextStatus,
              ...(result.telegramMessageId ? { telegramMessageId: result.telegramMessageId } : {}),
            }
          : m
      );
      setLocalMessages(targetChatId, updated, targetAccountId);
      return { ...prev, [bucketKey]: updated };
    });

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
    return { ok: true };
  };

  const selectAccountSeqRef = useRef(0);

  // Switch Active Telegram Account & Sync Real Dialogs (race-guarded)
  const handleSelectAccount = (accountId: string) => {
    const seq = ++selectAccountSeqRef.current;
    setActiveAccountId(accountId);
    setActiveApiAccount(accountId);
    setActiveChatId(null);
    setCustomerProfile(null);

    fetchTelegramUserDialogsDetailedApi(accountId).then((res) => {
      if (selectAccountSeqRef.current !== seq && activeAccountIdRef.current !== accountId) {
        return;
      }
      if (!res.ok && res.code === 'TELEGRAM_SESSION_EXPIRED') {
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === accountId
              ? { ...a, status: 'expired', bio: '会话已失效，请重新登录' }
              : a
          )
        );
        if (!notifiedExpiredRef.current.has(accountId)) {
          notifiedExpiredRef.current.add(accountId);
          showCloudError(res.error || 'Telegram 登录会话已失效，请重新扫码或验证码登录');
        }
        return;
      }
      if (res.ok && res.dialogs.length > 0) {
        const realDialogs = res.dialogs;
        setChats((prev) => {
          const prevAccountMap = new Map<string, Chat>();
          prev.filter((c) => c.accountId === accountId).forEach((c) => prevAccountMap.set(c.id, c));
          const mappedChats: Chat[] = realDialogs.map((d: any) =>
            mapCloudDialogToChat(d, accountId, prevAccountMap.get(d.id))
          );
          const filtered = prev.filter((c) => c.accountId !== accountId);
          return [...mappedChats, ...filtered];
        });
        setActiveChatId(realDialogs[0].id);
      } else {
        const existingChat = chatsRef.current.find((c) => c.accountId === accountId);
        if (existingChat) {
          setActiveChatId(existingChat.id);
        } else {
          setActiveChatId(null);
        }
      }
    });
  };

  // Add new account and sync its real dialogs strictly isolated by accountId
  const handleAddAccount = (newAccountData: Partial<Account>) => {
    const id = newAccountData.id || `acc_${Date.now()}`;
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

    fetchTelegramUserDialogsDetailedApi(id, newAcc.phone).then((res) => {
      if (res.ok && res.dialogs.length > 0) {
        const realDialogs = res.dialogs;
        setChats((prev) => {
          const prevAccountMap = new Map<string, Chat>();
          prev.filter((c) => c.accountId === id).forEach((c) => prevAccountMap.set(c.id, c));
          const mappedChats: Chat[] = realDialogs.map((d: any) =>
            mapCloudDialogToChat(d, id, prevAccountMap.get(d.id))
          );
          const otherChats = prev.filter((c) => c.accountId !== id);
          return [...mappedChats, ...otherChats];
        });

        if (activeAccountIdRef.current === id) {
          setActiveChatId(realDialogs[0].id);
        }
      }
    });
  };

  // Delete account and clean up associated chats, messagesMap entries, and scoped encrypted caches
  const handleDeleteAccount = (id: string) => {
    notifiedExpiredRef.current.delete(id);
    const remaining = accounts.filter((a) => a.id !== id);
    const removedChats = chats.filter((c) => c.accountId === id);
    const remainingChats = chats.filter((c) => c.accountId !== id);
    const remainingChatIds = new Set(remainingChats.map((c) => c.id));
    const removedChatIds = removedChats.map((c) => c.id);
    const unsharedRemovedChatIds = removedChatIds.filter((cid) => !remainingChatIds.has(cid));

    const nextMessagesMap: Record<string, Message[]> = {};
    for (const [key, msgs] of Object.entries(messagesMap)) {
      if (key.startsWith(`${id}::`)) {
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

    clearAccountLocalCache(id, unsharedRemovedChatIds);

    setAccounts(remaining);
    setChats(remainingChats);
    setMessagesMap(nextMessagesMap);
    if (isHydrated) {
      secureSetItemSync('tg_pro_accounts', remaining);
      secureSetItemSync('tg_pro_chats', remainingChats);
      secureSetItemSync('tg_pro_messages', nextMessagesMap);
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

  // Update per-chat translation language pair
  const handleUpdateChatLanguage = (chatId: string, sourceLang: string, targetLang: string) => {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, sourceLang, targetLang } : c))
    );
    if (chatId === activeChatId) {
      setTranslationSettings((prev) => ({
        ...prev,
        defaultSourceLang: sourceLang,
        defaultTargetLang: targetLang,
      }));
    }
  };

  const handleSaveCustomLLMConfig = (nextConfig: CustomLLMConfig) => {
    setCustomLLMConfig(nextConfig);
    const isCustomPriority = Boolean(nextConfig.enabled && nextConfig.engineMode === 'custom');
    if (!isCustomPriority && translationSettings.preferredEngine === 'custom_llm') {
      setTranslationSettings((prev) =>
        prev.preferredEngine === 'custom_llm' ? { ...prev, preferredEngine: 'gemini' } : prev
      );
    }
  };

  // Update global translation settings
  const handleUpdateTranslationSettings = (newSettings: TranslationSettings) => {
    const isCustomPriority = Boolean(customLLMConfig.enabled && customLLMConfig.engineMode === 'custom');
    if (newSettings.preferredEngine === 'custom_llm' && !isCustomPriority) {
      showCloudError('请开启自定义优先回复');
      return;
    }
    setTranslationSettings(newSettings);
    if (activeChatId) {
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChatId
            ? {
                ...c,
                sourceLang:
                  newSettings.defaultSourceLang !== 'Auto'
                    ? newSettings.defaultSourceLang
                    : c.sourceLang,
                targetLang: newSettings.defaultTargetLang || c.targetLang,
              }
            : c
        )
      );
    }
  };

  // Message actions: delete, edit, reaction, pin, patch, clear (Cloud-first, block local fake mutation on failure)
  const handleDeleteMessage = async (messageId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!activeChatId) return { ok: false, error: '未选中对话' };
    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    const targetMsg = getBucketMessages(messagesMap, targetAccountId, targetChatId).find((m) => m.id === messageId);

    const delRes = await deleteMessageFromDb(
      messageId,
      targetAccountId,
      targetChatId,
      targetMsg?.telegramMessageId
    );
    if (isTelegramCloudChat(targetChatId) && !delRes.ok) {
      const errMsg = delRes.error || '云端撤回删除消息失败';
      showCloudError(errMsg);
      return { ok: false, error: errMsg };
    }

    recordDeletedMessageId(messageId);
    deleteLocalMessage(targetChatId, messageId, targetAccountId);

    setMessagesMap((prev) => {
      const currentList = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = currentList.filter((m) => m.id !== messageId);
      setLocalMessages(targetChatId, updated, targetAccountId);

      // Synchronously update contact list summary if the deleted message was the last one
      if (updated.length > 0) {
        const last = updated[updated.length - 1];
        const summary = last.isAudio ? '🎤 语音消息' : last.isImage ? '🖼️ 图片消息' : (last.text || '暂无消息');
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

      return { ...prev, [bucketKey]: updated };
    });

    return { ok: true };
  };

  const handleEditMessage = async (
    messageId: string,
    newText: string
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
        m.id === messageId ? { ...m, text: newText, isEdited: true } : m
      );
      setLocalMessages(targetChatId, updated, targetAccountId);
      return { ...prev, [bucketKey]: updated };
    });
    return { ok: true };
  };

  const handleUpdateMessage = (messageId: string, patch: Partial<Message>) => {
    if (!activeChatId) return;
    const targetChatId = activeChatId;
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, targetChatId);
    setMessagesMap((prev) => {
      const currentList = getBucketMessages(prev, targetAccountId, targetChatId);
      const updated = currentList.map((m) =>
        m.id === messageId ? { ...m, ...patch } : m
      );
      setLocalMessages(targetChatId, updated, targetAccountId);
      return { ...prev, [bucketKey]: updated };
    });
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
      setLocalMessages(targetChatId, updated, targetAccountId);
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
      setLocalMessages(targetChatId, updated, targetAccountId);
      return { ...prev, [bucketKey]: updated };
    });
  };

  const handleClearHistory = async (chatId: string): Promise<{ ok: boolean; error?: string }> => {
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, chatId);
    if (isTelegramCloudChat(chatId)) {
      const clearRes = await clearTelegramDialogHistoryApi({
        accountId: targetAccountId,
        chatId,
      });
      if (!clearRes.ok) {
        const errMsg = clearRes.error || '清空云端聊天记录失败';
        showCloudError(errMsg);
        return { ok: false, error: errMsg };
      }
    }
    setMessagesMap((prev) => {
      clearLocalMessages(chatId, getBucketMessages(prev, targetAccountId, chatId), targetAccountId);
      return {
        ...prev,
        [bucketKey]: [],
      };
    });
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

  const handleDeleteChat = async (chatId: string) => {
    const targetAccountId = activeAccountId;
    const bucketKey = msgBucketKey(targetAccountId, chatId);
    if (isTelegramCloudChat(chatId)) {
      const res = await deleteTelegramDialogApi({
        accountId: targetAccountId,
        chatId,
      });
      if (!res.ok) {
        showCloudError(res.error || '云端删除/退出对话失败');
        return;
      }
    }
    setMessagesMap((prev) => {
      clearLocalMessages(chatId, getBucketMessages(prev, targetAccountId, chatId), targetAccountId);
      const next = { ...prev };
      delete next[bucketKey];
      return next;
    });
    setChats((prev) =>
      prev.filter((c) => !(c.id === chatId && (!targetAccountId || c.accountId === targetAccountId)))
    );
    if (activeChatId === chatId) {
      setActiveChatId(null);
    }
  };

  const handleCreateGroup = (newChat: Chat) => {
    const chatToSave: Chat = {
      ...newChat,
      accountId: activeAccountId || newChat.accountId || '',
    };
    setChats((prev) => [chatToSave, ...prev.filter((c) => c.id !== chatToSave.id)]);
    setActiveChatId(chatToSave.id);
  };

  const handleCreateChannel = (newChat: Chat) => {
    const chatToSave: Chat = {
      ...newChat,
      accountId: activeAccountId || newChat.accountId || '',
    };
    setChats((prev) => [chatToSave, ...prev.filter((c) => c.id !== chatToSave.id)]);
    setActiveChatId(chatToSave.id);
  };

  const handleAddContact = (contact: TelegramContact) => {
    setContacts((prev) => [contact, ...prev.filter((c) => c.id !== contact.id)]);
  };

  const handleSyncContacts = (cloudContacts: TelegramContact[]) => {
    setContacts((prev) => {
      const map = new Map<string, TelegramContact>();
      cloudContacts.forEach((c) => map.set(c.id, c));
      prev
        .filter((c) => !c.id.startsWith('contact_') && !map.has(c.id))
        .forEach((c) => map.set(c.id, c));
      return Array.from(map.values());
    });
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
      description: contact.bio,
      lastMessage: '已添加联系人',
      lastTime: '刚刚',
      unreadCount: 0,
      sourceLang: 'Auto',
      targetLang: 'Chinese',
    };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setIsContactsOpen(false);
  };

  const handleStartCall = (contactName: string) => {
    const newRecord: TelegramCallRecord = {
      id: `call_${Date.now()}`,
      contactName,
      avatarBg: '#2ba0ff',
      avatarInitial: contactName.slice(0, 2).toUpperCase(),
      type: 'outgoing',
      duration: '00:00',
      timestamp: '刚刚',
    };
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
        accounts={accounts}
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
          onEditMessage={handleEditMessage}
          onUpdateMessage={handleUpdateMessage}
          onRetryMessage={handleRetryMessage}
          onToggleReaction={handleToggleReaction}
          onTogglePinMessage={handleTogglePinMessage}
          onClearHistory={handleClearHistory}
          onToggleMuteChat={handleToggleMuteChat}
          onTogglePinChat={handleTogglePinChat}
          onUpdateChatTitle={handleUpdateChatTitle}
          onChatInfoUpdated={(chatId, patch) => {
            setChats((prev) =>
              prev.map((c) =>
                c.id === chatId && (!activeAccountId || c.accountId === activeAccountId)
                  ? { ...c, ...patch }
                  : c
              )
            );
          }}
          sendWithEnter={clientPrefs.sendWithEnter}
          onOpenVoiceCall={() => {
            setVoiceCallTargetName(currentChat?.title || '');
            setIsVoiceCallOpen(true);
          }}
          onMessagesSynced={(synced) => {
            if (activeChatId && synced.length > 0) {
              const bucketKey = msgBucketKey(activeAccountId, activeChatId);
              setMessagesMap((prev) => {
                const base = getBucketMessages(prev, activeAccountId, activeChatId);
                const merged = mergeCloudMessagesWithLocal(
                  base.length > 0 ? base : getLocalMessages(activeChatId, activeAccountId),
                  synced
                );
                setLocalMessages(activeChatId, merged, activeAccountId);
                return {
                  ...prev,
                  [bucketKey]: merged,
                };
              });
            }
          }}
        />

        {/* 3.5 Unified Right Push-Split Workspace Dock (440px Desktop / Slide-over Mobile) */}
        <UnifiedRightDock
          activePanel={activeRightPanel}
          onSelectPanel={openRightPanel}
          onClose={() => setActiveRightPanel(null)}
          customerProfile={customerProfile}
          onUpdateCustomerProfile={setCustomerProfile}
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
        onStartChatWithContact={handleStartChatWithContact}
      />

      {/* 17. Telegram Call Records & Dialing Modal */}
      <TelegramCallsModal
        isOpen={isCallsOpen}
        onClose={() => setIsCallsOpen(false)}
        callRecords={callRecords}
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
      />

      {/* 19. Telegram Voice Call Modal */}
      <TelegramVoiceCallModal
        isOpen={isVoiceCallOpen}
        onClose={() => setIsVoiceCallOpen(false)}
        chat={voiceCallTargetName && currentChat?.title !== voiceCallTargetName ? null : currentChat}
        currentAccountId={activeAccountId}
        contactName={voiceCallTargetName || currentChat?.title}
        avatarBg={currentChat?.avatarBg}
        avatarInitial={currentChat?.avatarInitial}
      />

      {/* 22. Member Authentication Gate Modal */}
      <MemberAuthModal
        isOpen={!isAuthChecking && !isMemberAuthenticated}
        totalMembers={totalMembersCount}
        onSuccess={(user) => {
          setCurrentMember(user);
          setIsMemberAuthenticated(true);
          setCustomLLMConfig((prev) =>
            !prev.enabled && prev.engineMode !== 'custom' && !prev.baseUrl?.trim()
              ? {
                  ...prev,
                  enabled: true,
                  engineMode: 'cloud',
                  enableKnowledgeBaseRAG: true,
                }
              : prev
          );
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
