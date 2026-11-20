import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Bell,
  BellOff,
  Image as ImageIcon,
  FileText,
  Mic,
  Link2,
  Trash2,
  Pin,
  Check,
  Download,
  Edit3,
  Loader2,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Phone,
  UserMinus,
  UserPlus,
  Play,
  CornerUpLeft,
  Copy,
  Users,
} from 'lucide-react';
import { Chat, Message, TelegramChatFullInfo, TelegramCommonChatItem, TelegramContact } from '../types';
import {
  fetchTelegramChatFullInfoApi,
  fetchTelegramSharedMediaApi,
  TelegramSharedMediaType,
  removeTelegramGroupMemberApi,
  addTelegramUserContactApi,
  blockTelegramUserContactApi,
  unblockTelegramUserContactApi,
  deleteTelegramUserContactApi,
  isSignedResourceUrl,
  isSignedResourceUrlExpiringSoon,
  refreshSignedResourceUrlsApi,
  ensureFreshSignedResourceUrl,
  isMessageDeleted,
} from '../services/apiService';
import { sanitizeSafeResourceUrl } from '../services/urlSafety';

function compareSharedMessagesDesc(a: Message, b: Message): number {
  if (
    typeof a.telegramMessageId === 'number' &&
    a.telegramMessageId > 0 &&
    typeof b.telegramMessageId === 'number' &&
    b.telegramMessageId > 0
  ) {
    return b.telegramMessageId - a.telegramMessageId;
  }
  return (b.createdAt || 0) - (a.createdAt || 0);
}

interface TelegramChatInfoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat | null;
  accountId?: string;
  messages: Message[];
  onToggleMute?: (chatId: string) => void | Promise<any>;
  onClearHistory?: (chatId: string, options?: { revoke?: boolean }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onTogglePin?: (chatId: string) => void | Promise<any>;
  onUpdateTitle?: (chatId: string, newTitle: string) => void | Promise<{ ok: boolean; error?: string } | void>;
  onChatInfoUpdated?: (chatId: string, patch: Partial<Chat>) => void;
  onAddContact?: (contact: TelegramContact) => void;
  onRemoveContact?: (contactId: string) => void;
  onRefreshMediaUrls?: (urls: string[]) => Promise<Record<string, string>>;
  onOpenMediaPreview?: (message: Message, allMediaMessages: Message[]) => void;
  onJumpToMessage?: (message: Message) => void;
  onSelectMember?: (member: {
    id: string;
    name: string;
    username?: string;
    avatarUrl?: string;
    statusText?: string;
    isOnline?: boolean;
    isBot?: boolean;
  }) => void;
  onSelectCommonGroup?: (group: TelegramCommonChatItem) => void;
}

export const TelegramChatInfoDrawer: React.FC<TelegramChatInfoDrawerProps> = ({
  isOpen,
  onClose,
  chat,
  accountId,
  messages,
  onToggleMute,
  onClearHistory,
  onTogglePin,
  onUpdateTitle,
  onChatInfoUpdated,
  onAddContact,
  onRemoveContact,
  onRefreshMediaUrls,
  onOpenMediaPreview,
  onJumpToMessage,
  onSelectMember,
  onSelectCommonGroup,
}) => {
  type SharedTabBucket = {
    items: Message[];
    loading: boolean;
    loaded: boolean;
    hasMore: boolean;
    nextOffsetId?: number;
    totalCount?: number;
    error?: string;
  };
  const createEmptySharedMediaBuckets = (): Record<TelegramSharedMediaType, SharedTabBucket> => ({
    media: { items: [], loading: false, loaded: false, hasMore: false },
    files: { items: [], loading: false, loaded: false, hasMore: false },
    voice: { items: [], loading: false, loaded: false, hasMore: false },
    links: { items: [], loading: false, loaded: false, hasMore: false },
  });
  const emptySharedMediaBucketsRef = useRef<Record<TelegramSharedMediaType, SharedTabBucket>>(
    createEmptySharedMediaBuckets()
  );
  const currentSharedScopeKey = `${accountId || 'default'}::${chat?.id || ''}`;
  const [sharedMediaStore, setSharedMediaStore] = useState<{
    scopeKey: string;
    buckets: Record<TelegramSharedMediaType, SharedTabBucket>;
  }>(() => ({
    scopeKey: '',
    buckets: createEmptySharedMediaBuckets(),
  }));
  const sharedMediaState =
    sharedMediaStore.scopeKey === currentSharedScopeKey
      ? sharedMediaStore.buckets
      : emptySharedMediaBucketsRef.current;
  const sharedMediaReqGenRef = useRef(0);
  const [activeTab, setActiveTab] = useState<'media' | 'files' | 'voice' | 'links' | 'members' | 'common_groups'>('media');
  const [isEditingRemark, setIsEditingRemark] = useState(false);
  const [remarkText, setRemarkText] = useState(chat?.title || '');
  const [isSavingRemark, setIsSavingRemark] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [revokeClearHistory, setRevokeClearHistory] = useState(false);
  const [fullInfo, setFullInfo] = useState<TelegramChatFullInfo | null>(null);
  const [isLoadingFullInfo, setIsLoadingFullInfo] = useState(false);
  const [fullInfoError, setFullInfoError] = useState<string | null>(null);
  const [confirmBlockToggle, setConfirmBlockToggle] = useState(false);
  const [isTogglingBlock, setIsTogglingBlock] = useState(false);
  const [confirmDeleteContact, setConfirmDeleteContact] = useState(false);
  const [isDeletingContact, setIsDeletingContact] = useState(false);
  const [confirmAddContact, setConfirmAddContact] = useState(false);
  const [addContactName, setAddContactName] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'username' | 'phone' | 'id' | 'inviteLink' | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const [refreshedUrlsMap, setRefreshedUrlsMap] = useState<Record<string, string>>({});
  const attemptedRefreshUrlsRef = useRef<Set<string>>(new Set());

  const commonChats =
    !chat?.isGroup && !chat?.isChannel && Array.isArray(fullInfo?.commonChats)
      ? fullInfo.commonChats
      : [];

  useEffect(() => {
    if (activeTab === 'common_groups' && commonChats.length === 0) {
      setActiveTab('media');
    }
  }, [activeTab, commonChats.length]);

  const resolveDisplayUrl = useCallback(
    (rawUrl?: string) => {
      if (!rawUrl) return undefined;
      const safeUrl = sanitizeSafeResourceUrl(refreshedUrlsMap[rawUrl] || rawUrl);
      return safeUrl || undefined;
    },
    [refreshedUrlsMap]
  );

  const triggerSilentUrlRefresh = useCallback(
    async (rawUrl?: string, force = false): Promise<string | null> => {
      if (!rawUrl || !isSignedResourceUrl(rawUrl)) return null;
      const currentResolved = refreshedUrlsMap[rawUrl] || rawUrl;
      if (attemptedRefreshUrlsRef.current.has(currentResolved)) {
        return null;
      }
      if (!force && !isSignedResourceUrlExpiringSoon(currentResolved)) {
        const safeCurrent = sanitizeSafeResourceUrl(currentResolved);
        return safeCurrent || null;
      }
      attemptedRefreshUrlsRef.current.add(rawUrl);
      attemptedRefreshUrlsRef.current.add(currentResolved);
      try {
        let nextUrl = '';
        if (onRefreshMediaUrls) {
          const map = await onRefreshMediaUrls([currentResolved]);
          nextUrl = map[currentResolved] || map[rawUrl] || '';
        } else {
          const refreshed = await ensureFreshSignedResourceUrl(currentResolved, accountId, { force: true });
          if (refreshed && refreshed !== currentResolved) {
            nextUrl = refreshed;
          }
        }
        const safeNextUrl = sanitizeSafeResourceUrl(nextUrl);
        if (safeNextUrl && safeNextUrl !== currentResolved) {
          attemptedRefreshUrlsRef.current.add(safeNextUrl);
          setRefreshedUrlsMap((prev) => ({
            ...prev,
            [rawUrl]: safeNextUrl,
            [currentResolved]: safeNextUrl,
          }));
          return safeNextUrl;
        }
      } catch {}
      return null;
    },
    [accountId, onRefreshMediaUrls, refreshedUrlsMap]
  );

  useEffect(() => {
    if (chat?.title) {
      setRemarkText(chat.title);
      setIsEditingRemark(false);
      setActionError(null);
      setShowClearConfirm(false);
      setRevokeClearHistory(false);
    }
  }, [chat?.id, chat?.title]);

  const loadFullInfo = async () => {
    if (!chat || !chat.id.startsWith('tg_')) return;
    setIsLoadingFullInfo(true);
    setFullInfoError(null);
    const info = await fetchTelegramChatFullInfoApi(chat.id, accountId);
    setIsLoadingFullInfo(false);
    if (!info.ok) {
      setFullInfo(null);
      setFullInfoError(info.error || '无法加载 Telegram 云端详情');
      return;
    }
    setFullInfo(info);
    onChatInfoUpdated?.(chat.id, {
      ...(!chat.isGroup && !chat.isChannel && info.title ? { title: info.title } : {}),
      ...(typeof info.memberCount === 'number' ? { memberCount: info.memberCount } : {}),
      ...(typeof info.onlineCount === 'number' ? { onlineCount: info.onlineCount } : {}),
      ...(typeof info.isOnline === 'boolean' ? { isOnline: info.isOnline } : {}),
      ...(info.statusText ? { statusText: info.statusText } : {}),
      ...(info.phone !== undefined ? { phone: info.phone } : {}),
      ...(typeof info.isBlocked === 'boolean' ? { isBlocked: info.isBlocked } : {}),
      ...(info.description !== undefined ? { description: info.description } : {}),
      ...(info.username !== undefined ? { username: info.username } : {}),
      ...(info.inviteLink !== undefined ? { inviteLink: info.inviteLink } : {}),
      ...(typeof info.isVerified === 'boolean' ? { isVerified: info.isVerified } : {}),
    });
  };

  useEffect(() => {
    if (!isOpen || !chat) {
      return;
    }
    setFullInfo(null);
    setFullInfoError(null);
    setConfirmBlockToggle(false);
    setConfirmDeleteContact(false);
    setConfirmAddContact(false);
    setConfirmRemoveMemberId(null);
    setRemovingMemberId(null);
    setMemberActionError(null);
    setCopiedField(null);
    setAddContactName(chat.title || '');
    sharedMediaReqGenRef.current += 1;
    setSharedMediaStore({
      scopeKey: currentSharedScopeKey,
      buckets: createEmptySharedMediaBuckets(),
    });
    setActiveTab((cur) =>
      (cur === 'members' && !chat.isGroup && !chat.isChannel) || cur === 'common_groups'
        ? 'media'
        : cur
    );
    if (chat.id.startsWith('tg_')) {
      void loadFullInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, chat?.id, accountId]);

  const loadSharedMediaPage = useCallback(
    async (tab: TelegramSharedMediaType, loadMore = false) => {
      if (!chat?.id) return;
      const currentBucket = sharedMediaState[tab];
      if (currentBucket.loading) return;
      if (loadMore && (!currentBucket.hasMore || !currentBucket.nextOffsetId)) return;

      const reqGen = sharedMediaReqGenRef.current;
      const targetScopeKey = currentSharedScopeKey;
      const offsetId = loadMore ? currentBucket.nextOffsetId : undefined;

      setSharedMediaStore((prev) => {
        const baseBuckets = prev.scopeKey === targetScopeKey ? prev.buckets : createEmptySharedMediaBuckets();
        return {
          scopeKey: targetScopeKey,
          buckets: {
            ...baseBuckets,
            [tab]: { ...baseBuckets[tab], loading: true, error: undefined },
          },
        };
      });

      const res = await fetchTelegramSharedMediaApi(chat.id, accountId, {
        type: tab,
        limit: 60,
        offsetId,
      });

      if (sharedMediaReqGenRef.current !== reqGen) return;

      if (!res.ok) {
        setSharedMediaStore((prev) => {
          const baseBuckets = prev.scopeKey === targetScopeKey ? prev.buckets : createEmptySharedMediaBuckets();
          return {
            scopeKey: targetScopeKey,
            buckets: {
              ...baseBuckets,
              [tab]: {
                ...baseBuckets[tab],
                loading: false,
                loaded: true,
                error: res.error || '加载共享媒体失败',
              },
            },
          };
        });
        return;
      }

      setSharedMediaStore((prev) => {
        const baseBuckets = prev.scopeKey === targetScopeKey ? prev.buckets : createEmptySharedMediaBuckets();
        const prevBucket = baseBuckets[tab];
        const mergedMap = new Map<string, Message>();
        const putItem = (item: Message) => {
          if (!item || isMessageDeleted(item.id, accountId, item.chatId || chat?.id)) return;
          const key =
            typeof item.telegramMessageId === 'number' && item.telegramMessageId > 0
              ? `tg_${item.telegramMessageId}`
              : item.id;
          const existing = mergedMap.get(key);
          mergedMap.set(key, existing ? { ...existing, ...item } : item);
        };
        if (loadMore) {
          prevBucket.items.forEach(putItem);
        }
        res.items.forEach(putItem);

        const nextItems = Array.from(mergedMap.values()).sort(compareSharedMessagesDesc);

        const nextMinTgId = nextItems.reduce((min, item) => {
          if (typeof item.telegramMessageId === 'number' && item.telegramMessageId > 0) {
            return min === undefined ? item.telegramMessageId : Math.min(min, item.telegramMessageId);
          }
          return min;
        }, undefined as number | undefined);

        const resolvedNextOffset = res.nextOffsetId || nextMinTgId;
        const madeProgress =
          !loadMore ||
          nextItems.length > prevBucket.items.length ||
          (Boolean(resolvedNextOffset) && resolvedNextOffset !== prevBucket.nextOffsetId);

        return {
          scopeKey: targetScopeKey,
          buckets: {
            ...baseBuckets,
            [tab]: {
              items: nextItems,
              loading: false,
              loaded: true,
              hasMore: res.hasMore && madeProgress,
              nextOffsetId: resolvedNextOffset,
              totalCount:
                typeof res.totalCount === 'number'
                  ? Math.max(res.totalCount, nextItems.length)
                  : prevBucket.totalCount,
              error: undefined,
            },
          },
        };
      });
    },
    [accountId, chat?.id, currentSharedScopeKey, sharedMediaState]
  );

  useEffect(() => {
    if (!isOpen || !chat?.id) return;
    if (
      activeTab === 'media' ||
      activeTab === 'files' ||
      activeTab === 'voice' ||
      activeTab === 'links'
    ) {
      const bucket = sharedMediaState[activeTab];
      if (!bucket.loaded && !bucket.loading) {
        void loadSharedMediaPage(activeTab, false);
      }
    }
  }, [isOpen, chat?.id, activeTab, sharedMediaState, loadSharedMediaPage]);

  useEffect(() => {
    if (!isOpen || !chat) return;
    const candidates: string[] = [];
    const pushIfExpiring = (rawUrl?: string) => {
      if (!rawUrl) return;
      const effective = refreshedUrlsMap[rawUrl] || rawUrl;
      if (
        isSignedResourceUrlExpiringSoon(effective) &&
        !attemptedRefreshUrlsRef.current.has(effective)
      ) {
        candidates.push(effective);
      }
    };
    pushIfExpiring(chat.avatarUrl);
    for (const m of messages) {
      pushIfExpiring(m.imageUrl);
      pushIfExpiring(m.videoUrl);
      pushIfExpiring(m.fileUrl);
      pushIfExpiring(m.audioUrl);
    }
    for (const m of sharedMediaState.media.items) {
      pushIfExpiring(m.imageUrl);
      pushIfExpiring(m.videoUrl);
    }
    for (const m of sharedMediaState.files.items) {
      pushIfExpiring(m.fileUrl);
    }
    for (const m of sharedMediaState.voice.items) {
      pushIfExpiring(m.audioUrl);
    }
    if (Array.isArray(fullInfo?.participants)) {
      for (const p of fullInfo.participants) {
        pushIfExpiring(p.avatarUrl);
      }
    }
    const unique = Array.from(new Set(candidates)).slice(0, 40);
    if (unique.length === 0) return;

    unique.forEach((u) => attemptedRefreshUrlsRef.current.add(u));
    let cancelled = false;
    const run = async () => {
      const refreshed = onRefreshMediaUrls
        ? await onRefreshMediaUrls(unique)
        : await refreshSignedResourceUrlsApi(unique, accountId);
      if (cancelled || !refreshed || Object.keys(refreshed).length === 0) return;
      setRefreshedUrlsMap((prev) => {
        const next = { ...prev };
        for (const [oldUrl, newUrl] of Object.entries(refreshed)) {
          if (newUrl) {
            attemptedRefreshUrlsRef.current.add(newUrl);
            next[oldUrl] = newUrl;
          }
        }
        return next;
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, chat, messages, sharedMediaState, fullInfo, accountId, onRefreshMediaUrls, refreshedUrlsMap]);

  const handleSaveRemark = async () => {
    if (!chat) return;
    const trimmed = remarkText.trim();
    if (!trimmed || isSavingRemark) return;
    setActionError(null);
    setIsSavingRemark(true);
    try {
      const res = await onUpdateTitle?.(chat.id, trimmed);
      if (res && typeof res === 'object' && res.ok === false) {
        setActionError(res.error || '同步云端联系人备注失败');
        return;
      }
      setIsEditingRemark(false);
    } finally {
      setIsSavingRemark(false);
    }
  };

  const handleCopyField = (field: 'username' | 'phone' | 'id' | 'inviteLink', value: string) => {
    if (!value) return;
    void navigator.clipboard?.writeText(value);
    setCopiedField(field);
    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedField((cur) => (cur === field ? null : cur));
    }, 1500);
  };

  if (!isOpen || !chat) return null;

  const mergeSharedList = (localFiltered: Message[], remoteItems: Message[]): Message[] => {
    const map = new Map<string, Message>();
    const put = (m: Message) => {
      if (!m || isMessageDeleted(m.id, accountId, m.chatId || chat.id)) return;
      const key =
        typeof m.telegramMessageId === 'number' && m.telegramMessageId > 0
          ? `tg_${m.telegramMessageId}`
          : m.id;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, m);
      } else {
        map.set(key, {
          ...prev,
          ...m,
          imageUrl: m.imageUrl || prev.imageUrl,
          videoUrl: m.videoUrl || prev.videoUrl,
          fileUrl: m.fileUrl || prev.fileUrl,
          audioUrl: m.audioUrl || prev.audioUrl,
        });
      }
    };
    remoteItems.forEach(put);
    localFiltered.forEach(put);
    return Array.from(map.values()).sort(compareSharedMessagesDesc);
  };

  const mediaMessages = mergeSharedList(
    messages.filter((m) => m.isImage || m.imageUrl || m.isVideo || m.videoUrl),
    sharedMediaState.media.items
  );
  const fileMessages = mergeSharedList(
    messages.filter((m) => m.isFile || m.fileName),
    sharedMediaState.files.items
  );
  const voiceMessages = mergeSharedList(
    messages.filter((m) => m.isAudio || m.audioUrl),
    sharedMediaState.voice.items
  );
  const linkMessages = mergeSharedList(
    messages.filter((m) => m.text && (m.text.includes('http://') || m.text.includes('https://') || m.text.includes('t.me/'))),
    sharedMediaState.links.items
  );

  const activeSharedBucket =
    activeTab === 'media' || activeTab === 'files' || activeTab === 'voice' || activeTab === 'links'
      ? sharedMediaState[activeTab]
      : null;

  const formatTabCount = (listLen: number, bucket: SharedTabBucket) => {
    if (typeof bucket.totalCount === 'number' && bucket.totalCount > listLen) {
      return bucket.totalCount;
    }
    return bucket.hasMore ? `${listLen}+` : listLen;
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-200 select-none">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/45 dark:bg-black/65 aurora:bg-black/70 linen:bg-black/40 backdrop-blur-xs cursor-pointer"
        onClick={onClose}
      />

      {/* Drawer Body */}
      <div className="relative w-80 sm:w-96 h-full bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border-l border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] shadow-2xl linen:shadow-sm flex flex-col z-10 animate-in slide-in-from-right duration-250 text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
        {/* Header */}
        <div className="h-14 px-4 bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-between shrink-0">
          <span className="font-semibold text-sm">
            {chat.isGroup ? '群组详情' : chat.isChannel ? '频道详情' : '联系人资料'}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-[#eef4fb] aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] linen:text-[#6e5c4a] linen:hover:text-[#2b2118] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e5d9c5] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div
          className="flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (
              activeSharedBucket &&
              activeSharedBucket.hasMore &&
              !activeSharedBucket.loading &&
              el.scrollHeight - el.scrollTop - el.clientHeight <= 140
            ) {
              void loadSharedMediaPage(activeTab as TelegramSharedMediaType, true);
            }
          }}
        >
          {/* Avatar & Title Section */}
          <div className="p-6 flex flex-col items-center border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center font-bold text-2xl text-white shadow-xl overflow-hidden mb-3 border-4 border-white dark:border-[#0b131f] aurora:border-[#0c151b] linen:border-[#f8f2e7] relative"
              style={{ backgroundColor: chat.avatarBg }}
            >
              <span className="font-bold select-none">{chat.avatarInitial}</span>
              {chat.avatarUrl && (
                <img
                  src={resolveDisplayUrl(chat.avatarUrl)}
                  alt={chat.title}
                  className="w-full h-full object-cover absolute inset-0"
                  onLoad={(e) => {
                    e.currentTarget.style.display = '';
                  }}
                  onError={(e) => {
                    const imgEl = e.currentTarget;
                    const original = chat.avatarUrl;
                    void triggerSilentUrlRefresh(original, true).then((nextUrl) => {
                      if (!nextUrl) {
                        imgEl.style.display = 'none';
                      }
                    });
                  }}
                />
              )}
            </div>

            {/* Friend Remark Editing */}
            {isEditingRemark ? (
              <div className="flex flex-col items-center gap-1.5 w-full max-w-[260px] mb-1">
                <div className="flex items-center gap-1.5 w-full">
                  <input
                    type="text"
                    value={remarkText}
                    onChange={(e) => setRemarkText(e.target.value)}
                    placeholder="输入好友备注名称..."
                    disabled={isSavingRemark}
                    className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] outline-none focus:ring-1 focus:ring-[#2481cc] dark:focus:ring-[#2ba0ff] aurora:focus:ring-[#2dd4bf] linen:focus:ring-[#a86a43]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void handleSaveRemark();
                      } else if (e.key === 'Escape') {
                        setRemarkText(chat.title);
                        setActionError(null);
                        setIsEditingRemark(false);
                      }
                    }}
                  />
                  <button
                    onClick={() => void handleSaveRemark()}
                    disabled={isSavingRemark}
                    className="p-1 rounded-md bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] text-white disabled:opacity-50 cursor-pointer transition-colors"
                    title="保存备注"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setRemarkText(chat.title);
                      setActionError(null);
                      setIsEditingRemark(false);
                    }}
                    disabled={isSavingRemark}
                    className="p-1 rounded-md bg-[#e2e8f0] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#e7dccb] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] hover:bg-[#cbd5e1] dark:hover:bg-[#1b2f47] aurora:hover:bg-[#1a3340] linen:hover:bg-[#dcccb3] cursor-pointer transition-colors"
                    title="取消"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {actionError && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 aurora:text-rose-400 text-center leading-snug">{actionError}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 mb-1 group">
                <h3 className="font-bold text-base text-center leading-tight">
                  {chat.title}
                </h3>
                {(fullInfo?.isBlocked ?? chat.isBlocked) && (
                  <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400 aurora:text-rose-400 text-[10px] font-medium shrink-0">
                    已拉黑
                  </span>
                )}
                <button
                  onClick={() => {
                    setRemarkText(chat.title);
                    setActionError(null);
                    setIsEditingRemark(true);
                  }}
                  className="p-1 rounded-md text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#7cc4ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#6e5c4a] linen:hover:text-[#8c522d] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e5d9c5] cursor-pointer transition-colors"
                  title={chat.isGroup || chat.isChannel ? '点击设置本地群组/频道备注' : '点击设置/修改好友备注'}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] text-center">
              {(() => {
                const count = fullInfo?.memberCount ?? chat.memberCount;
                const online = fullInfo?.onlineCount ?? chat.onlineCount;
                const isOnline = fullInfo?.isOnline ?? chat.isOnline;
                const statusText = fullInfo?.statusText ?? chat.statusText;
                if (chat.isChannel) {
                  return typeof count === 'number' ? `${count} 位订阅者` : '频道';
                }
                if (chat.isGroup) {
                  if (typeof count === 'number') {
                    return `${count} 位成员${typeof online === 'number' && online > 0 ? ` · ${online} 人在线` : ''}`;
                  }
                  return isLoadingFullInfo ? '正在同步群成员数量...' : '群组';
                }
                if (chat.isBot) return '机器人 (Bot)';
                return (
                  <span className={isOnline ? 'text-emerald-700 dark:text-emerald-400 aurora:text-emerald-400 font-medium' : ''}>
                    {statusText || (isOnline ? '在线' : '状态未知')}
                  </span>
                );
              })()}
            </p>
            {(fullInfo?.username || chat.username || chat.id.startsWith('tg_') || fullInfo?.phone || chat.phone || fullInfo?.description || chat.description || fullInfo?.inviteLink || chat.inviteLink) && (
              <div className="mt-2.5 w-full text-center space-y-1">
                {(fullInfo?.username || chat.username) && (() => {
                  const rawUsername = (fullInfo?.username || chat.username || '').trim();
                  const formattedUsername = rawUsername.startsWith('@') ? rawUsername : `@${rawUsername}`;
                  const isCopied = copiedField === 'username';
                  return (
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => handleCopyField('username', formattedUsername)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-medium hover:bg-[#e8f3ff] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e5d9c5] transition-colors cursor-pointer select-text"
                        title="点击复制用户名"
                      >
                        <span>{formattedUsername}</span>
                        {isCopied ? (
                          <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-[10px]">
                            <Check className="w-3 h-3" />
                            已复制
                          </span>
                        ) : (
                          <Copy className="w-3 h-3 opacity-60" />
                        )}
                      </button>
                    </div>
                  );
                })()}
                {chat.id.startsWith('tg_') && (() => {
                  const numericId = chat.id.replace(/^tg_/, '');
                  const isCopied = copiedField === 'id';
                  return (
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => handleCopyField('id', numericId)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e5d9c5] transition-colors cursor-pointer tabular-nums"
                        title="点击复制 Telegram ID"
                      >
                        <span>ID: <span className="font-mono">{numericId}</span></span>
                        {isCopied ? (
                          <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-[10px]">
                            <Check className="w-3 h-3" />
                            已复制
                          </span>
                        ) : (
                          <Copy className="w-3 h-3 opacity-60" />
                        )}
                      </button>
                    </div>
                  );
                })()}
                {(fullInfo?.phone || chat.phone) && (
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => handleCopyField('phone', fullInfo?.phone || chat.phone || '')}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e5d9c5] transition-colors cursor-pointer tabular-nums"
                      title="点击复制手机号"
                    >
                      <Phone className="w-3 h-3" />
                      <span>{fullInfo?.phone || chat.phone}</span>
                      {copiedField === 'phone' ? (
                        <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-[10px]">
                          <Check className="w-3 h-3" />
                          已复制
                        </span>
                      ) : (
                        <Copy className="w-3 h-3 opacity-60" />
                      )}
                    </button>
                  </div>
                )}
                {(fullInfo?.description || chat.description) && (
                  <div className="text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] leading-relaxed px-2 break-words">
                    {fullInfo?.description || chat.description}
                  </div>
                )}
                {(fullInfo?.inviteLink || chat.inviteLink) && (
                  <div className="flex items-center justify-center px-2">
                    <button
                      type="button"
                      onClick={() => handleCopyField('inviteLink', fullInfo?.inviteLink || chat.inviteLink || '')}
                      className="inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-md text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] hover:bg-[#e8f3ff] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e5d9c5] transition-colors cursor-pointer"
                      title="点击复制邀请链接"
                    >
                      <span className="truncate">邀请链接: {fullInfo?.inviteLink || chat.inviteLink}</span>
                      {copiedField === 'inviteLink' ? (
                        <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-[10px] shrink-0">
                          <Check className="w-3 h-3" />
                          已复制
                        </span>
                      ) : (
                        <Copy className="w-3 h-3 opacity-60 shrink-0" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
            {fullInfoError && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400 aurora:text-rose-400">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{fullInfoError}</span>
              </div>
            )}
          </div>

          {/* Quick Actions (Remark, Mute, Pin, Block/Unblock) */}
          <div className="p-3 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] space-y-1">
            {!chat.isGroup && !chat.isChannel && (
              <button
                onClick={() => {
                  setRemarkText(chat.title);
                  setIsEditingRemark(true);
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer text-xs"
              >
                <div className="flex items-center gap-3">
                  <Edit3 className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]" />
                  <span>设置好友备注</span>
                </div>
                <span className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d]">
                  编辑
                </span>
              </button>
            )}
            <button
              onClick={() => onToggleMute?.(chat.id)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer text-xs"
            >
              <div className="flex items-center gap-3">
                {chat.isMuted ? (
                  <BellOff className="w-4 h-4 text-amber-600 dark:text-amber-400 aurora:text-amber-400" />
                ) : (
                  <Bell className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]" />
                )}
                <span>{chat.isMuted ? '已静音' : '消息通知'}</span>
              </div>
              <span className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d]">
                {chat.isMuted ? '取消静音' : '静音'}
              </span>
            </button>

            <button
              onClick={() => onTogglePin?.(chat.id)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer text-xs"
            >
              <div className="flex items-center gap-3">
                <Pin className={`w-4 h-4 ${chat.isPinned ? 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43] fill-current' : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]'}`} />
                <span>{chat.isPinned ? '已置顶' : '置顶对话'}</span>
              </div>
              <span className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d]">
                {chat.isPinned ? '取消置顶' : '置顶'}
              </span>
            </button>

            {chat.id.startsWith('tg_') && !chat.isGroup && !chat.isChannel && accountId !== 'acc_telegram_bot' && (() => {
              const currentlyBlocked = Boolean(fullInfo?.isBlocked ?? chat.isBlocked);
              return confirmBlockToggle ? (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                    {currentlyBlocked ? '确定将其移出黑名单？' : '确定加入黑名单并屏蔽对方消息？'}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={isTogglingBlock}
                      onClick={async () => {
                        setActionError(null);
                        setIsTogglingBlock(true);
                        try {
                          const res = currentlyBlocked
                            ? await unblockTelegramUserContactApi({ accountId, chatId: chat.id })
                            : await blockTelegramUserContactApi({ accountId, chatId: chat.id });
                          if (!res.ok) {
                            setActionError(res.error || (currentlyBlocked ? '解除拉黑失败' : '拉黑失败'));
                            return;
                          }
                          const nextBlocked = !currentlyBlocked;
                          setFullInfo((prev) => (prev ? { ...prev, isBlocked: nextBlocked } : prev));
                          onChatInfoUpdated?.(chat.id, { isBlocked: nextBlocked });
                          setConfirmBlockToggle(false);
                        } finally {
                          setIsTogglingBlock(false);
                        }
                      }}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium text-white cursor-pointer disabled:opacity-50 ${
                        currentlyBlocked ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                      }`}
                    >
                      {isTogglingBlock ? '处理中' : '确认'}
                    </button>
                    <button
                      type="button"
                      disabled={isTogglingBlock}
                      onClick={() => setConfirmBlockToggle(false)}
                      className="px-2 py-1 rounded-lg text-[11px] bg-[#e2e8f0] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#e7dccb] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBlockToggle(true)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-3">
                    {currentlyBlocked ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 aurora:text-emerald-400" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 aurora:text-amber-400" />
                    )}
                    <span className={currentlyBlocked ? 'text-emerald-700 dark:text-emerald-400 aurora:text-emerald-400' : 'text-amber-700 dark:text-amber-400 aurora:text-amber-400'}>
                      {currentlyBlocked ? '已加入黑名单' : '拉黑该联系人'}
                    </span>
                  </div>
                  <span className={`text-[11px] ${currentlyBlocked ? 'text-emerald-700 dark:text-emerald-400 aurora:text-emerald-400' : 'text-amber-700 dark:text-amber-400 aurora:text-amber-400'}`}>
                    {currentlyBlocked ? '解除拉黑' : '拉黑'}
                  </span>
                </button>
              );
            })()}

            {chat.id.startsWith('tg_') && !chat.isGroup && !chat.isChannel && !chat.isBot && accountId !== 'acc_telegram_bot' && (() => {
              const selfTgId = accountId?.startsWith('acc_tg_') ? `tg_${accountId.replace(/^acc_tg_/, '')}` : '';
              const isSelfChat = Boolean(
                fullInfo?.isSelf ||
                (selfTgId && chat.id === selfTgId) ||
                chat.title === 'Saved Messages' ||
                chat.title === '我的收藏夹 (Saved Messages)'
              );
              if (isSelfChat || !fullInfo) return null;

              if (!fullInfo.isContact) {
                return confirmAddContact ? (
                  <div className="p-2.5 rounded-xl bg-[#e8f3ff] dark:bg-[#2ba0ff]/15 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 border border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2] space-y-2 text-xs">
                    <div className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] font-medium">
                      将该用户添加到 Telegram 云端通讯录
                    </div>
                    <input
                      type="text"
                      value={addContactName}
                      onChange={(e) => setAddContactName(e.target.value)}
                      placeholder="输入联系人备注名称"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={isAddingContact}
                        onClick={() => setConfirmAddContact(false)}
                        className="px-2.5 py-1 rounded-lg text-[11px] bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#e7dccb] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={isAddingContact}
                        onClick={async () => {
                          setActionError(null);
                          setIsAddingContact(true);
                          try {
                            const contactName =
                              addContactName.trim() || fullInfo.title || chat.title || 'Telegram';
                            const res = await addTelegramUserContactApi({
                              accountId,
                              chatId: chat.id,
                              name: contactName,
                              phone: fullInfo.phone || chat.phone,
                              username: fullInfo.username || chat.username,
                            });
                            if (!res.ok) {
                              setActionError(res.error || '添加到通讯录失败');
                              return;
                            }
                            const resolvedName = (res.contact?.name || contactName).trim();
                            setFullInfo((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    isContact: true,
                                    ...(resolvedName ? { title: resolvedName } : {}),
                                    ...(res.contact?.phone ? { phone: res.contact.phone } : {}),
                                  }
                                : prev
                            );
                            if (res.contact) {
                              onAddContact?.(res.contact);
                            }
                            if (resolvedName) {
                              onChatInfoUpdated?.(chat.id, {
                                title: resolvedName,
                                ...(res.contact?.phone ? { phone: res.contact.phone } : {}),
                              });
                            }
                            setConfirmAddContact(false);
                          } finally {
                            setIsAddingContact(false);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] cursor-pointer disabled:opacity-50"
                      >
                        {isAddingContact ? '添加中...' : '确认添加'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setAddContactName(fullInfo.title || chat.title || '');
                      setConfirmAddContact(true);
                    }}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <UserPlus className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                      <span className="text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-medium">添加到通讯录</span>
                    </div>
                    <span className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d]">添加好友</span>
                  </button>
                );
              }

              return confirmDeleteContact ? (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                    从 Telegram 云端通讯录删除该好友？
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={isDeletingContact}
                      onClick={async () => {
                        setActionError(null);
                        setIsDeletingContact(true);
                        try {
                          const res = await deleteTelegramUserContactApi({ accountId, chatId: chat.id });
                          if (!res.ok) {
                            setActionError(res.error || '删除好友失败');
                            return;
                          }
                          setFullInfo((prev) => (prev ? { ...prev, isContact: false } : prev));
                          onRemoveContact?.(chat.id);
                          setConfirmDeleteContact(false);
                        } finally {
                          setIsDeletingContact(false);
                        }
                      }}
                      className="px-2 py-1 rounded-lg text-[11px] font-medium text-white bg-rose-600 hover:bg-rose-700 cursor-pointer disabled:opacity-50"
                    >
                      {isDeletingContact ? '删除中' : '确认'}
                    </button>
                    <button
                      type="button"
                      disabled={isDeletingContact}
                      onClick={() => setConfirmDeleteContact(false)}
                      className="px-2 py-1 rounded-lg text-[11px] bg-[#e2e8f0] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#e7dccb] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteContact(true)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-3">
                    <UserMinus className="w-4 h-4 text-rose-600 dark:text-rose-400 aurora:text-rose-400" />
                    <span className="text-rose-700 dark:text-rose-400 aurora:text-rose-400">从通讯录删除好友</span>
                  </div>
                  <span className="text-[11px] text-rose-600 dark:text-rose-400 aurora:text-rose-400">删除</span>
                </button>
              );
            })()}
          </div>

          {/* Shared Media Tabs Header */}
          <div className="flex items-center px-2 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] overflow-x-auto no-scrollbar text-xs font-medium tabular-nums">
            <button
              onClick={() => setActiveTab('media')}
              className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'media'
                  ? 'border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-semibold'
                  : 'border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
              }`}
            >
              媒体 ({formatTabCount(mediaMessages.length, sharedMediaState.media)})
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'files'
                  ? 'border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-semibold'
                  : 'border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
              }`}
            >
              文件 ({formatTabCount(fileMessages.length, sharedMediaState.files)})
            </button>
            <button
              onClick={() => setActiveTab('voice')}
              className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'voice'
                  ? 'border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-semibold'
                  : 'border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
              }`}
            >
              语音 ({formatTabCount(voiceMessages.length, sharedMediaState.voice)})
            </button>
            <button
              onClick={() => setActiveTab('links')}
              className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'links'
                  ? 'border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-semibold'
                  : 'border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
              }`}
            >
              链接 ({formatTabCount(linkMessages.length, sharedMediaState.links)})
            </button>
            {!chat.isGroup && !chat.isChannel && commonChats.length > 0 && (
              <button
                onClick={() => setActiveTab('common_groups')}
                className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                  activeTab === 'common_groups'
                    ? 'border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-semibold'
                    : 'border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
                }`}
              >
                共同群 ({commonChats.length})
              </button>
            )}
            {(chat.isGroup || chat.isChannel) && (
              <button
                onClick={() => setActiveTab('members')}
                className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                  activeTab === 'members'
                    ? 'border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-semibold'
                    : 'border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
                }`}
              >
                成员 ({fullInfo?.memberCount ?? chat.memberCount ?? fullInfo?.participants?.length ?? '-'})
              </button>
            )}
          </div>

          {/* Tab Content Panes */}
          <div className="p-3">
            {activeTab === 'media' && (
              <div>
                {sharedMediaState.media.loading && mediaMessages.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    <Loader2 className="w-5 h-5 animate-spin text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43]" />
                    <span>正在从云端同步全部媒体图片...</span>
                  </div>
                ) : mediaMessages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    暂无共享照片或视频
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {mediaMessages.map((m) => {
                      const isVid = Boolean((m.isVideo || m.videoUrl) && m.videoUrl);
                      const resolvedVideoSrc = isVid ? resolveDisplayUrl(m.videoUrl) : undefined;
                      const resolvedImageSrc = m.imageUrl ? resolveDisplayUrl(m.imageUrl) : undefined;
                      const handleLocateMedia = () => {
                        onClose();
                        onJumpToMessage?.(m);
                      };
                      const handlePreviewMedia = () => {
                        if (onOpenMediaPreview) {
                          onOpenMediaPreview(m, mediaMessages);
                        } else if (onJumpToMessage) {
                          handleLocateMedia();
                        }
                      };
                      return (
                        <div
                          key={m.id}
                          onClick={!isVid ? handlePreviewMedia : undefined}
                          title={!isVid ? (onOpenMediaPreview ? '点击全屏查看聊天所有图片' : '点击前往聊天中的该消息位置') : undefined}
                          className={`aspect-square rounded-lg overflow-hidden bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#efe6d6] relative group ${
                            !isVid && (onOpenMediaPreview || onJumpToMessage) ? 'cursor-pointer' : ''
                          }`}
                        >
                          {isVid && resolvedVideoSrc ? (
                            <>
                              <video
                                src={resolvedVideoSrc}
                                preload="metadata"
                                controls
                                className="w-full h-full object-cover bg-black"
                                onError={() => {
                                  void triggerSilentUrlRefresh(m.videoUrl, true);
                                }}
                              />
                              <div className="pointer-events-none absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/65 text-white text-[9px] font-medium flex items-center gap-0.5 tabular-nums">
                                <Play className="w-2.5 h-2.5 fill-current" />
                                <span>{m.videoDuration ? `${Math.max(1, Math.round(m.videoDuration))}"` : '视频'}</span>
                              </div>
                              {onJumpToMessage && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleLocateMedia();
                                  }}
                                  title="前往聊天中的该消息位置"
                                  className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/70 hover:bg-[#2481cc] linen:hover:bg-[#a86a43] text-white text-[9px] font-medium flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                >
                                  <CornerUpLeft className="w-2.5 h-2.5" />
                                  <span>定位</span>
                                </button>
                              )}
                            </>
                          ) : resolvedImageSrc ? (
                            <>
                              <img
                                src={resolvedImageSrc}
                                loading="lazy"
                                alt={m.imageCaption || 'media'}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                onLoad={(e) => {
                                  e.currentTarget.style.display = '';
                                }}
                                onError={(e) => {
                                  const imgEl = e.currentTarget;
                                  void triggerSilentUrlRefresh(m.imageUrl, true).then((nextUrl) => {
                                    if (!nextUrl) {
                                      imgEl.style.display = 'none';
                                    }
                                  });
                                }}
                              />
                              {onJumpToMessage && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleLocateMedia();
                                  }}
                                  title="前往聊天中的该消息位置"
                                  className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 hover:bg-[#2481cc] linen:hover:bg-[#a86a43] text-white text-[9px] font-medium inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                >
                                  <CornerUpLeft className="w-2.5 h-2.5" />
                                  <span>定位</span>
                                </button>
                              )}
                            </>
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] gap-1 p-1 text-center">
                              <ImageIcon className="w-4 h-4 opacity-60" />
                              <span>媒体未缓存</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'files' && (
              <div className="space-y-2">
                {fileMessages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    暂无共享文件文档
                  </div>
                ) : (
                  fileMessages.map((m) => {
                    const resolvedFileHref = m.fileUrl ? resolveDisplayUrl(m.fileUrl) || '' : '';
                    const hasFileUrl = Boolean(resolvedFileHref);
                    return (
                      <div
                        key={m.id}
                        onClick={() => {
                          onClose();
                          onJumpToMessage?.(m);
                        }}
                        title="点击跳转到聊天中的该文件消息"
                        className="p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] hover:border-[#2481cc]/50 dark:hover:border-[#2ba0ff]/50 aurora:hover:border-[#2dd4bf]/50 linen:hover:border-[#a86a43]/60 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{m.fileName || '文档附件'}</div>
                            <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                              {m.fileSize || '未知大小'} · {m.timestamp}
                              {!hasFileUrl ? ' · 链接暂不可用' : ''}
                            </div>
                          </div>
                        </div>
                        {hasFileUrl ? (
                          <a
                            href={resolvedFileHref}
                            download={m.fileName || true}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!resolvedFileHref) {
                                e.preventDefault();
                                return;
                              }
                              if (m.fileUrl && isSignedResourceUrlExpiringSoon(resolvedFileHref)) {
                                e.preventDefault();
                                void triggerSilentUrlRefresh(m.fileUrl, true).then((nextUrl) => {
                                  const safeDownloadHref = sanitizeSafeResourceUrl(nextUrl) || resolvedFileHref;
                                  if (!safeDownloadHref) return;
                                  const a = document.createElement('a');
                                  a.href = safeDownloadHref;
                                  if (m.fileName) a.download = m.fileName;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                });
                              }
                            }}
                            title="下载文件"
                            className="p-1.5 text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] hover:bg-[#e8f3ff] dark:hover:bg-[#2ba0ff]/15 aurora:hover:bg-[#112d36] linen:hover:bg-[#a86a43]/15 rounded-lg shrink-0 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        ) : (
                          <span
                            title="该文件尚未同步云端下载链接"
                            className="px-2 py-1 rounded-md bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#e7dccb] text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] shrink-0 select-none"
                          >
                            未缓存
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {activeTab === 'voice' && (
              <div className="space-y-2">
                {voiceMessages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    暂无语音消息
                  </div>
                ) : (
                  voiceMessages.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        onClose();
                        onJumpToMessage?.(m);
                      }}
                      title="点击跳转到聊天中的该语音消息"
                      className="p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] hover:border-[#2481cc]/50 dark:hover:border-[#2ba0ff]/50 aurora:hover:border-[#2dd4bf]/50 linen:hover:border-[#a86a43]/60 flex items-center justify-between text-xs cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Mic className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                        <span>
                          {m.audioDuration && m.audioDuration > 0
                            ? `语音消息 (${m.audioDuration}")`
                            : '语音消息 (--)'}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">{m.timestamp}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'links' && (
              <div className="space-y-2">
                {linkMessages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    暂无网页链接
                  </div>
                ) : (
                  linkMessages.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        onClose();
                        onJumpToMessage?.(m);
                      }}
                      title="点击跳转到聊天中的该链接消息"
                      className="p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] hover:border-[#2481cc]/50 dark:hover:border-[#2ba0ff]/50 aurora:hover:border-[#2dd4bf]/50 linen:hover:border-[#a86a43]/60 flex items-center gap-2 text-xs cursor-pointer transition-colors"
                    >
                      <Link2 className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] shrink-0" />
                      <span className="truncate text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] underline">{m.text}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeSharedBucket && (activeSharedBucket.hasMore || activeSharedBucket.loading || activeSharedBucket.error) && (
              <div className="pt-3 pb-1 flex flex-col items-center gap-1.5">
                {activeSharedBucket.error && (
                  <span className="text-[11px] text-rose-500">{activeSharedBucket.error}</span>
                )}
                {(activeSharedBucket.hasMore || activeSharedBucket.loading) && (
                  <button
                    type="button"
                    disabled={activeSharedBucket.loading}
                    onClick={() => void loadSharedMediaPage(activeTab as TelegramSharedMediaType, true)}
                    className="px-3.5 py-1.5 rounded-lg bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#efe6d6] hover:bg-[#e2e8f0] dark:hover:bg-[#1a2f47] aurora:hover:bg-[#18303b] linen:hover:bg-[#e5d9c5] text-xs font-medium text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    <Loader2 className={`w-3.5 h-3.5 ${activeSharedBucket.loading ? 'animate-spin' : 'hidden'}`} />
                    <span>{activeSharedBucket.loading ? '正在加载更多历史...' : '加载更多历史媒体'}</span>
                  </button>
                )}
              </div>
            )}

            {activeTab === 'common_groups' && !chat.isGroup && !chat.isChannel && commonChats.length > 0 && (
              <div className="space-y-1.5">
                {commonChats.map((g) => {
                  const safeAvatar = resolveDisplayUrl(g.avatarUrl);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        if (onSelectCommonGroup) {
                          onSelectCommonGroup(g);
                          onClose();
                        }
                      }}
                      title={onSelectCommonGroup ? `点击进入共同群：${g.title}` : g.title}
                      className={`w-full flex items-center gap-2.5 p-2 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] hover:border-[#2481cc]/50 dark:hover:border-[#2ba0ff]/50 aurora:hover:border-[#2dd4bf]/50 linen:hover:border-[#a86a43]/60 transition-colors text-left ${
                        onSelectCommonGroup ? 'cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full shrink-0 overflow-hidden bg-[#2481cc]/15 dark:bg-[#2ba0ff]/20 aurora:bg-[#2dd4bf]/20 linen:bg-[#a86a43]/20 flex items-center justify-center text-xs font-semibold text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d]">
                        {safeAvatar ? (
                          <img
                            src={safeAvatar}
                            alt={g.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <Users className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] truncate">
                          {g.title}
                        </div>
                        <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] truncate">
                          {typeof g.memberCount === 'number' ? `${g.memberCount} 位成员` : '共同群组'}
                          {g.username ? ` · ${g.username}` : ''}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === 'members' && (chat.isGroup || chat.isChannel) && (
              <div className="space-y-1.5">
                <div className="p-2 flex items-center justify-between text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] font-semibold uppercase">
                  <span className="tabular-nums">
                    成员列表 ({fullInfo?.memberCount ?? chat.memberCount ?? fullInfo?.participants?.length ?? 0})
                  </span>
                  <div className="flex items-center gap-2">
                    {fullInfo?.canRemoveMembers && (
                      <span className="px-1.5 py-0.5 rounded bg-[#2481cc]/10 dark:bg-[#2ba0ff]/15 aurora:bg-[#2dd4bf]/15 linen:bg-[#a86a43]/15 text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] text-[10px] font-medium normal-case">
                        {fullInfo.currentUserRole === 'creator' ? '群主权限' : '管理权限'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadFullInfo()}
                      disabled={isLoadingFullInfo}
                      className="text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] hover:underline flex items-center gap-1 font-normal normal-case cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingFullInfo ? 'animate-spin' : ''}`} />
                      刷新
                    </button>
                  </div>
                </div>
                {memberActionError && (
                  <div className="px-2.5 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-700 dark:text-rose-400 aurora:text-rose-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{memberActionError}</span>
                  </div>
                )}

                {isLoadingFullInfo ? (
                  <div className="py-10 flex flex-col items-center justify-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    <Loader2 className="w-5 h-5 animate-spin text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43] mb-2" />
                    <span>正在从 Telegram 官方拉取真实成员列表...</span>
                  </div>
                ) : fullInfoError ? (
                  <div className="p-3 rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-400 aurora:text-rose-400 text-xs text-center">
                    {fullInfoError}
                  </div>
                ) : fullInfo?.participantsError && (!fullInfo?.participants || fullInfo.participants.length === 0) ? (
                  <div className="p-3 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 aurora:text-amber-300 text-xs text-center">
                    {fullInfo.participantsError}
                  </div>
                ) : !fullInfo?.participants || fullInfo.participants.length === 0 ? (
                  <div className="py-10 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    {chat.id.startsWith('tg_') ? '暂无可展示的成员列表数据' : '非 Telegram 云端群组，无云端成员列表'}
                  </div>
                ) : (
                  fullInfo.participants.map((member) => {
                    const selfTgId = accountId?.startsWith('acc_tg_') ? `tg_${accountId.replace(/^acc_tg_/, '')}` : '';
                    const isSelfMember = Boolean(selfTgId && member.id === selfTgId);
                    const canRemoveTarget = Boolean(
                      fullInfo?.canRemoveMembers &&
                      chat.id.startsWith('tg_') &&
                      accountId !== 'acc_telegram_bot' &&
                      !isSelfMember &&
                      member.role !== 'creator' &&
                      (member.role !== 'admin' || fullInfo.currentUserRole === 'creator')
                    );
                    const isConfirmingRemove = confirmRemoveMemberId === member.id;
                    const isRemovingThis = removingMemberId === member.id;
                    return (
                    <div
                      key={member.id}
                      onClick={() => onSelectMember?.(member)}
                      className={`flex items-center justify-between p-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e7dccb] transition-colors ${
                        onSelectMember ? 'cursor-pointer' : ''
                      }`}
                      title={onSelectMember ? '点击查看该成员个人资料' : undefined}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43] text-white font-bold text-xs flex items-center justify-center relative overflow-hidden shrink-0">
                          <span>{member.name.slice(0, 2).toUpperCase()}</span>
                          {member.avatarUrl && (
                            <img
                              src={resolveDisplayUrl(member.avatarUrl)}
                              alt={member.name}
                              className="w-full h-full object-cover absolute inset-0"
                              onLoad={(e) => {
                                e.currentTarget.style.display = '';
                              }}
                              onError={(e) => {
                                const imgEl = e.currentTarget;
                                void triggerSilentUrlRefresh(member.avatarUrl, true).then((nextUrl) => {
                                  if (!nextUrl) {
                                    imgEl.style.display = 'none';
                                  }
                                });
                              }}
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{member.name}</div>
                          <div className={`text-[10px] truncate ${member.isOnline ? 'text-emerald-700 dark:text-emerald-400 aurora:text-emerald-400 font-medium' : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]'}`}>
                            {member.username ? `${member.username} · ` : ''}
                            {member.statusText || (member.isBot ? 'Bot' : '状态未知')}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2" onClick={(e) => isConfirmingRemove && e.stopPropagation()}>
                        {member.role === 'creator' ? (
                          <span className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-medium shrink-0">
                            群主
                          </span>
                        ) : member.role === 'admin' ? (
                          <span className="text-[11px] text-amber-700 dark:text-amber-400 aurora:text-amber-400 font-medium shrink-0">
                            管理员
                          </span>
                        ) : member.isBot ? (
                          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 aurora:text-emerald-400 font-medium shrink-0">
                            Bot
                          </span>
                        ) : null}
                        {canRemoveTarget && (
                          isConfirmingRemove ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isRemovingThis}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setMemberActionError(null);
                                  setRemovingMemberId(member.id);
                                  try {
                                    const res = await removeTelegramGroupMemberApi({
                                      accountId,
                                      chatId: chat.id,
                                      memberId: member.id,
                                    });
                                    if (!res.ok) {
                                      setMemberActionError(res.error || '移除成员失败');
                                      return;
                                    }
                                    setConfirmRemoveMemberId(null);
                                    const currentParticipants = fullInfo?.participants || [];
                                    const nextParticipants = currentParticipants.filter((p) => p.id !== member.id);
                                    const nextMemberCount =
                                      typeof fullInfo?.memberCount === 'number'
                                        ? Math.max(0, fullInfo.memberCount - 1)
                                        : nextParticipants.length;
                                    setFullInfo((prev) => {
                                      if (!prev) return prev;
                                      const filtered = (prev.participants || []).filter((p) => p.id !== member.id);
                                      return {
                                        ...prev,
                                        participants: filtered,
                                        memberCount:
                                          typeof prev.memberCount === 'number'
                                            ? Math.max(0, prev.memberCount - 1)
                                            : filtered.length,
                                      };
                                    });
                                    if (fullInfo) {
                                      onChatInfoUpdated?.(chat.id, { memberCount: nextMemberCount });
                                    }
                                  } finally {
                                    setRemovingMemberId(null);
                                  }
                                }}
                                className="px-2 py-0.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-medium cursor-pointer disabled:opacity-50"
                              >
                                {isRemovingThis ? '移除中' : '确认移除'}
                              </button>
                              <button
                                type="button"
                                disabled={isRemovingThis}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmRemoveMemberId(null);
                                }}
                                className="px-1.5 py-0.5 rounded-md bg-[#e2e8f0] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#e7dccb] text-[#475569] dark:text-[#b4c6d8] linen:text-[#4e3f32] text-[10px] cursor-pointer"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMemberActionError(null);
                                setConfirmRemoveMemberId(member.id);
                              }}
                              title={`将 ${member.name} 移出群组`}
                              className="px-2 py-0.5 rounded-md border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-400 aurora:text-rose-400 text-[10px] font-medium inline-flex items-center gap-0.5 cursor-pointer transition-colors"
                            >
                              <UserMinus className="w-3 h-3" />
                              <span>移除</span>
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Danger Zone: Clear History */}
          <div className="p-4 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] mt-4 space-y-2.5">
            {actionError && !isEditingRemark && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400 aurora:text-rose-400 text-center leading-snug">{actionError}</p>
            )}
            {!showClearConfirm ? (
              <button
                type="button"
                disabled={isClearingHistory}
                onClick={() => {
                  setActionError(null);
                  setShowClearConfirm(true);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-700 dark:text-rose-400 aurora:text-rose-400 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>清空聊天记录</span>
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 space-y-2.5">
                <p className="text-[11.5px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] leading-relaxed">
                  确定要清空与 <span className="font-semibold">【{chat.title}】</span> 的全部云端与本地聊天记录吗？
                </p>
                {!chat.isGroup && !chat.isChannel && chat.id.startsWith('tg_') && (
                  <label className="flex items-start gap-2 text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={revokeClearHistory}
                      onChange={(e) => setRevokeClearHistory(e.target.checked)}
                      className="mt-0.5 rounded border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] accent-rose-600 dark:accent-rose-500 aurora:accent-rose-500"
                    />
                    <span>同时为对方清空聊天记录（双向撤回）</span>
                  </label>
                )}
                {(chat.isGroup || chat.isChannel) && chat.id.startsWith('tg_') && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 aurora:text-amber-300 leading-snug">
                    提示：频道与超级群组通常仅支持管理员或通过退群清理云端记录，无权限时将被服务端拒绝。
                  </p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isClearingHistory}
                    onClick={() => {
                      setShowClearConfirm(false);
                      setRevokeClearHistory(false);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e7dccb] cursor-pointer transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={isClearingHistory}
                    onClick={async () => {
                      setActionError(null);
                      setIsClearingHistory(true);
                      try {
                        const res = await onClearHistory?.(chat.id, { revoke: revokeClearHistory });
                        if (res && typeof res === 'object' && res.ok === false) {
                          setActionError(res.error || '清空聊天记录失败');
                          return;
                        }
                        setShowClearConfirm(false);
                        setRevokeClearHistory(false);
                        onClose();
                      } finally {
                        setIsClearingHistory(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold cursor-pointer"
                  >
                    {isClearingHistory ? '正在清空...' : '确认清空'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
