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
} from 'lucide-react';
import { Chat, Message, TelegramChatFullInfo, TelegramContact } from '../types';
import {
  fetchTelegramChatFullInfoApi,
  addTelegramUserContactApi,
  blockTelegramUserContactApi,
  unblockTelegramUserContactApi,
  deleteTelegramUserContactApi,
  isSignedResourceUrl,
  isSignedResourceUrlExpiringSoon,
  refreshSignedResourceUrlsApi,
  ensureFreshSignedResourceUrl,
} from '../services/apiService';

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
}) => {
  const [activeTab, setActiveTab] = useState<'media' | 'files' | 'voice' | 'links' | 'members'>('media');
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
  const [refreshedUrlsMap, setRefreshedUrlsMap] = useState<Record<string, string>>({});
  const attemptedRefreshUrlsRef = useRef<Set<string>>(new Set());

  const resolveDisplayUrl = useCallback(
    (rawUrl?: string) => {
      if (!rawUrl) return rawUrl;
      return refreshedUrlsMap[rawUrl] || rawUrl;
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
        return currentResolved;
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
        if (nextUrl && nextUrl !== currentResolved) {
          attemptedRefreshUrlsRef.current.add(nextUrl);
          setRefreshedUrlsMap((prev) => ({
            ...prev,
            [rawUrl]: nextUrl,
            [currentResolved]: nextUrl,
          }));
          return nextUrl;
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
    setAddContactName(chat.title || '');
    if (chat.id.startsWith('tg_')) {
      void loadFullInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, chat?.id, accountId]);

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
  }, [isOpen, chat, messages, fullInfo, accountId, onRefreshMediaUrls, refreshedUrlsMap]);

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

  if (!isOpen || !chat) return null;

  const mediaMessages = messages.filter((m) => m.isImage || m.imageUrl || m.isVideo || m.videoUrl);
  const fileMessages = messages.filter((m) => m.isFile || m.fileName);
  const voiceMessages = messages.filter((m) => m.isAudio || m.audioUrl);
  const linkMessages = messages.filter((m) => m.text && (m.text.includes('http://') || m.text.includes('https://') || m.text.includes('t.me/')));

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-200 select-none">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs cursor-pointer"
        onClick={onClose}
      />

      {/* Drawer Body */}
      <div className="relative w-80 sm:w-96 h-full bg-white dark:bg-[#17212b] border-l border-[#e0e4e8] dark:border-[#0e1621] shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-250 text-[#111827] dark:text-[#f5f7fa]">
        {/* Header */}
        <div className="h-14 px-4 border-b border-[#e0e4e8] dark:border-[#0e1621] flex items-center justify-between shrink-0">
          <span className="font-semibold text-sm">
            {chat.isGroup ? '群组详情' : chat.isChannel ? '频道详情' : '联系人资料'}
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#707579] hover:text-[#111827] dark:text-[#7f93a5] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#202b36] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Avatar & Title Section */}
          <div className="p-6 flex flex-col items-center border-b border-[#e0e4e8] dark:border-[#0e1621] bg-[#f8fafc] dark:bg-[#131d27]">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center font-bold text-2xl text-white shadow-xl overflow-hidden mb-3 border-4 border-white dark:border-[#17212b] relative"
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
                    className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-[#2481cc] bg-white dark:bg-[#17212b] text-[#111827] dark:text-white outline-none focus:ring-1 focus:ring-[#2481cc]"
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
                    className="p-1 rounded-md bg-[#2481cc] text-white hover:bg-[#1e6cb0] disabled:opacity-50 cursor-pointer"
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
                    className="p-1 rounded-md bg-gray-200 dark:bg-[#202b36] text-[#707579] dark:text-[#7f93a5] hover:bg-gray-300 dark:hover:bg-[#2c3b4a] cursor-pointer"
                    title="取消"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {actionError && (
                  <p className="text-[11px] text-rose-500 text-center leading-snug">{actionError}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 mb-1 group">
                <h3 className="font-bold text-base text-center leading-tight">
                  {chat.title}
                </h3>
                {(fullInfo?.isBlocked ?? chat.isBlocked) && (
                  <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 text-[10px] font-medium shrink-0">
                    已拉黑
                  </span>
                )}
                {!chat.isGroup && !chat.isChannel && (
                  <button
                    onClick={() => {
                      setRemarkText(chat.title);
                      setActionError(null);
                      setIsEditingRemark(true);
                    }}
                    className="p-1 rounded-md text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-[#2ba0ff] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
                    title="点击设置/修改好友备注"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <p className="text-xs text-[#707579] dark:text-[#7f93a5] text-center">
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
                  <span className={isOnline ? 'text-emerald-500 font-medium' : ''}>
                    {statusText || (isOnline ? '在线' : '状态未知')}
                  </span>
                );
              })()}
            </p>
            {(fullInfo?.username || chat.username || fullInfo?.phone || chat.phone || fullInfo?.description || chat.description || fullInfo?.inviteLink || chat.inviteLink) && (
              <div className="mt-2.5 w-full text-center space-y-1">
                {(fullInfo?.username || chat.username) && (
                  <div className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] font-medium">
                    {fullInfo?.username || chat.username}
                  </div>
                )}
                {(fullInfo?.phone || chat.phone) && (
                  <div className="text-[11px] text-[#707579] dark:text-[#a0acb8] flex items-center justify-center gap-1 tabular-nums">
                    <Phone className="w-3 h-3" />
                    <span>{fullInfo?.phone || chat.phone}</span>
                  </div>
                )}
                {(fullInfo?.description || chat.description) && (
                  <div className="text-[11px] text-[#707579] dark:text-[#a0acb8] leading-relaxed px-2 break-words">
                    {fullInfo?.description || chat.description}
                  </div>
                )}
                {(fullInfo?.inviteLink || chat.inviteLink) && (
                  <div className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] truncate px-2">
                    邀请链接: {fullInfo?.inviteLink || chat.inviteLink}
                  </div>
                )}
              </div>
            )}
            {fullInfoError && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-500">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{fullInfoError}</span>
              </div>
            )}
          </div>

          {/* Quick Actions (Remark, Mute, Pin, Block/Unblock) */}
          <div className="p-3 border-b border-[#e0e4e8] dark:border-[#0e1621] space-y-1">
            {!chat.isGroup && !chat.isChannel && (
              <button
                onClick={() => {
                  setRemarkText(chat.title);
                  setIsEditingRemark(true);
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors cursor-pointer text-xs"
              >
                <div className="flex items-center gap-3">
                  <Edit3 className="w-4 h-4 text-[#707579] dark:text-[#7f93a5]" />
                  <span>设置好友备注</span>
                </div>
                <span className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff]">
                  编辑
                </span>
              </button>
            )}
            <button
              onClick={() => onToggleMute?.(chat.id)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors cursor-pointer text-xs"
            >
              <div className="flex items-center gap-3">
                {chat.isMuted ? (
                  <BellOff className="w-4 h-4 text-amber-500" />
                ) : (
                  <Bell className="w-4 h-4 text-[#707579] dark:text-[#7f93a5]" />
                )}
                <span>{chat.isMuted ? '已静音' : '消息通知'}</span>
              </div>
              <span className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff]">
                {chat.isMuted ? '取消静音' : '静音'}
              </span>
            </button>

            <button
              onClick={() => onTogglePin?.(chat.id)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors cursor-pointer text-xs"
            >
              <div className="flex items-center gap-3">
                <Pin className={`w-4 h-4 ${chat.isPinned ? 'text-[#2481cc] fill-current' : 'text-[#707579] dark:text-[#7f93a5]'}`} />
                <span>{chat.isPinned ? '已置顶' : '置顶对话'}</span>
              </div>
              <span className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff]">
                {chat.isPinned ? '取消置顶' : '置顶'}
              </span>
            </button>

            {chat.id.startsWith('tg_') && !chat.isGroup && !chat.isChannel && accountId !== 'acc_telegram_bot' && (() => {
              const currentlyBlocked = Boolean(fullInfo?.isBlocked ?? chat.isBlocked);
              return confirmBlockToggle ? (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#111827] dark:text-white">
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
                        currentlyBlocked ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600'
                      }`}
                    >
                      {isTogglingBlock ? '处理中' : '确认'}
                    </button>
                    <button
                      type="button"
                      disabled={isTogglingBlock}
                      onClick={() => setConfirmBlockToggle(false)}
                      className="px-2 py-1 rounded-lg text-[11px] bg-black/5 dark:bg-white/10 text-[#707579] dark:text-gray-300 cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBlockToggle(true)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-3">
                    {currentlyBlocked ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-500" />
                    )}
                    <span className={currentlyBlocked ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                      {currentlyBlocked ? '已加入黑名单' : '拉黑该联系人'}
                    </span>
                  </div>
                  <span className={`text-[11px] ${currentlyBlocked ? 'text-emerald-500' : 'text-amber-500'}`}>
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
                  <div className="p-2.5 rounded-xl bg-[#2481cc]/10 border border-[#2481cc]/25 space-y-2 text-xs">
                    <div className="text-[#111827] dark:text-white font-medium">
                      将该用户添加到 Telegram 云端通讯录
                    </div>
                    <input
                      type="text"
                      value={addContactName}
                      onChange={(e) => setAddContactName(e.target.value)}
                      placeholder="输入联系人备注名称"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#17212b] border border-[#d6dde4] dark:border-[#2c3b4c] text-xs text-[#111827] dark:text-white outline-none focus:border-[#2481cc]"
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={isAddingContact}
                        onClick={() => setConfirmAddContact(false)}
                        className="px-2.5 py-1 rounded-lg text-[11px] bg-black/5 dark:bg-white/10 text-[#707579] dark:text-gray-300 cursor-pointer"
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
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-[#2481cc] hover:bg-[#1b6cb0] cursor-pointer disabled:opacity-50"
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
                    className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <UserPlus className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff]" />
                      <span className="text-[#2481cc] dark:text-[#2ba0ff] font-medium">添加到通讯录</span>
                    </div>
                    <span className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff]">添加好友</span>
                  </button>
                );
              }

              return confirmDeleteContact ? (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#111827] dark:text-white">
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
                      className="px-2 py-1 rounded-lg text-[11px] font-medium text-white bg-red-500 hover:bg-red-600 cursor-pointer disabled:opacity-50"
                    >
                      {isDeletingContact ? '删除中' : '确认'}
                    </button>
                    <button
                      type="button"
                      disabled={isDeletingContact}
                      onClick={() => setConfirmDeleteContact(false)}
                      className="px-2 py-1 rounded-lg text-[11px] bg-black/5 dark:bg-white/10 text-[#707579] dark:text-gray-300 cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteContact(true)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-3">
                    <UserMinus className="w-4 h-4 text-red-400" />
                    <span className="text-red-500 dark:text-red-400">从通讯录删除好友</span>
                  </div>
                  <span className="text-[11px] text-red-400">删除</span>
                </button>
              );
            })()}
          </div>

          {/* Shared Media Tabs Header */}
          <div className="flex items-center px-2 border-b border-[#e0e4e8] dark:border-[#0e1621] overflow-x-auto no-scrollbar text-xs font-medium tabular-nums">
            <button
              onClick={() => setActiveTab('media')}
              className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'media'
                  ? 'border-[#2481cc] text-[#2481cc] dark:text-[#2ba0ff] font-semibold'
                  : 'border-transparent text-[#707579] dark:text-[#7f93a5]'
              }`}
            >
              媒体 ({mediaMessages.length})
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'files'
                  ? 'border-[#2481cc] text-[#2481cc] dark:text-[#2ba0ff] font-semibold'
                  : 'border-transparent text-[#707579] dark:text-[#7f93a5]'
              }`}
            >
              文件 ({fileMessages.length})
            </button>
            <button
              onClick={() => setActiveTab('voice')}
              className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'voice'
                  ? 'border-[#2481cc] text-[#2481cc] dark:text-[#2ba0ff] font-semibold'
                  : 'border-transparent text-[#707579] dark:text-[#7f93a5]'
              }`}
            >
              语音 ({voiceMessages.length})
            </button>
            <button
              onClick={() => setActiveTab('links')}
              className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'links'
                  ? 'border-[#2481cc] text-[#2481cc] dark:text-[#2ba0ff] font-semibold'
                  : 'border-transparent text-[#707579] dark:text-[#7f93a5]'
              }`}
            >
              链接 ({linkMessages.length})
            </button>
            {(chat.isGroup || chat.isChannel) && (
              <button
                onClick={() => setActiveTab('members')}
                className={`px-3 py-2.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                  activeTab === 'members'
                    ? 'border-[#2481cc] text-[#2481cc] dark:text-[#2ba0ff] font-semibold'
                    : 'border-transparent text-[#707579] dark:text-[#7f93a5]'
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
                {mediaMessages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#707579] dark:text-[#7f93a5]">
                    暂无共享照片或视频
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {mediaMessages.map((m) => {
                      const isVid = Boolean((m.isVideo || m.videoUrl) && m.videoUrl);
                      const resolvedVideoSrc = isVid ? resolveDisplayUrl(m.videoUrl) : undefined;
                      const resolvedImageSrc = m.imageUrl ? resolveDisplayUrl(m.imageUrl) : undefined;
                      return (
                        <div key={m.id} className="aspect-square rounded-lg overflow-hidden bg-black/10 dark:bg-white/10 relative group">
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
                            </>
                          ) : resolvedImageSrc ? (
                            <img
                              src={resolvedImageSrc}
                              alt={m.imageCaption || 'media'}
                              className="w-full h-full object-cover"
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
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-[10px] text-[#707579] dark:text-[#7f93a5] gap-1 p-1 text-center">
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
                  <div className="py-12 text-center text-xs text-[#707579] dark:text-[#7f93a5]">
                    暂无共享文件文档
                  </div>
                ) : (
                  fileMessages.map((m) => {
                    const hasFileUrl = Boolean(m.fileUrl && m.fileUrl.trim() && m.fileUrl.trim() !== '#');
                    const resolvedFileHref = hasFileUrl ? resolveDisplayUrl(m.fileUrl) || '' : '';
                    return (
                      <div key={m.id} className="p-2.5 rounded-xl bg-gray-50 dark:bg-[#202b36] flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-5 h-5 text-[#2481cc] shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{m.fileName || '文档附件'}</div>
                            <div className="text-[10px] text-[#707579] dark:text-[#7f93a5]">
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
                              if (m.fileUrl && isSignedResourceUrlExpiringSoon(resolvedFileHref)) {
                                e.preventDefault();
                                void triggerSilentUrlRefresh(m.fileUrl, true).then((nextUrl) => {
                                  const a = document.createElement('a');
                                  a.href = nextUrl || resolvedFileHref;
                                  if (m.fileName) a.download = m.fileName;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                });
                              }
                            }}
                            title="下载文件"
                            className="p-1.5 text-[#2481cc] hover:bg-[#2481cc]/10 rounded-lg shrink-0"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        ) : (
                          <span
                            title="该文件尚未同步云端下载链接"
                            className="px-2 py-1 rounded-md bg-black/5 dark:bg-white/5 text-[10px] text-[#707579] dark:text-[#7f93a5] shrink-0 select-none"
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
                  <div className="py-12 text-center text-xs text-[#707579] dark:text-[#7f93a5]">
                    暂无语音消息
                  </div>
                ) : (
                  voiceMessages.map((m) => (
                    <div key={m.id} className="p-2.5 rounded-xl bg-gray-50 dark:bg-[#202b36] flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Mic className="w-4 h-4 text-[#2481cc]" />
                        <span>
                          {m.audioDuration && m.audioDuration > 0
                            ? `语音消息 (${m.audioDuration}")`
                            : '语音消息 (--)'}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#707579] dark:text-[#7f93a5]">{m.timestamp}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'links' && (
              <div className="space-y-2">
                {linkMessages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#707579] dark:text-[#7f93a5]">
                    暂无网页链接
                  </div>
                ) : (
                  linkMessages.map((m) => (
                    <div key={m.id} className="p-2.5 rounded-xl bg-gray-50 dark:bg-[#202b36] flex items-center gap-2 text-xs">
                      <Link2 className="w-4 h-4 text-[#2481cc] shrink-0" />
                      <span className="truncate text-[#2481cc] dark:text-[#2ba0ff] underline">{m.text}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'members' && (chat.isGroup || chat.isChannel) && (
              <div className="space-y-1.5">
                <div className="p-2 flex items-center justify-between text-[11px] text-[#707579] dark:text-[#7f93a5] font-semibold uppercase">
                  <span className="tabular-nums">
                    成员列表 ({fullInfo?.memberCount ?? chat.memberCount ?? fullInfo?.participants?.length ?? 0})
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadFullInfo()}
                    disabled={isLoadingFullInfo}
                    className="text-[#2481cc] hover:underline flex items-center gap-1 font-normal normal-case cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingFullInfo ? 'animate-spin' : ''}`} />
                    刷新
                  </button>
                </div>

                {isLoadingFullInfo ? (
                  <div className="py-10 flex flex-col items-center justify-center text-xs text-[#707579] dark:text-[#7f93a5]">
                    <Loader2 className="w-5 h-5 animate-spin text-[#2481cc] mb-2" />
                    <span>正在从 Telegram 官方拉取真实成员列表...</span>
                  </div>
                ) : fullInfoError ? (
                  <div className="p-3 rounded-xl bg-rose-500/10 text-rose-500 text-xs text-center">
                    {fullInfoError}
                  </div>
                ) : fullInfo?.participantsError && (!fullInfo?.participants || fullInfo.participants.length === 0) ? (
                  <div className="p-3 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs text-center">
                    {fullInfo.participantsError}
                  </div>
                ) : !fullInfo?.participants || fullInfo.participants.length === 0 ? (
                  <div className="py-10 text-center text-xs text-[#707579] dark:text-[#7f93a5]">
                    {chat.id.startsWith('tg_') ? '暂无可展示的成员列表数据' : '非 Telegram 云端群组，无云端成员列表'}
                  </div>
                ) : (
                  fullInfo.participants.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-2 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#2481cc] text-white font-bold text-xs flex items-center justify-center relative overflow-hidden shrink-0">
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
                          <div className={`text-[10px] truncate ${member.isOnline ? 'text-emerald-500 font-medium' : 'text-[#707579] dark:text-[#7f93a5]'}`}>
                            {member.username ? `${member.username} · ` : ''}
                            {member.statusText || (member.isBot ? 'Bot' : '状态未知')}
                          </div>
                        </div>
                      </div>
                      {member.role === 'creator' ? (
                        <span className="text-[11px] text-[#2481cc] font-medium shrink-0">
                          群主
                        </span>
                      ) : member.role === 'admin' ? (
                        <span className="text-[11px] text-amber-500 font-medium shrink-0">
                          管理员
                        </span>
                      ) : member.isBot ? (
                        <span className="text-[11px] text-emerald-500 font-medium shrink-0">
                          Bot
                        </span>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Danger Zone: Clear History */}
          <div className="p-4 border-t border-[#e0e4e8] dark:border-[#0e1621] mt-4 space-y-2.5">
            {actionError && !isEditingRemark && (
              <p className="text-[11px] text-rose-500 text-center leading-snug">{actionError}</p>
            )}
            {!showClearConfirm ? (
              <button
                type="button"
                disabled={isClearingHistory}
                onClick={() => {
                  setActionError(null);
                  setShowClearConfirm(true);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 text-red-500 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>清空聊天记录</span>
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-red-500/8 border border-red-500/25 space-y-2.5">
                <p className="text-[11.5px] text-[#111827] dark:text-[#eef4fb] leading-relaxed">
                  确定要清空与 <span className="font-semibold">【{chat.title}】</span> 的全部云端与本地聊天记录吗？
                </p>
                {!chat.isGroup && !chat.isChannel && chat.id.startsWith('tg_') && (
                  <label className="flex items-start gap-2 text-[11px] text-[#707579] dark:text-[#9aa7b5] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={revokeClearHistory}
                      onChange={(e) => setRevokeClearHistory(e.target.checked)}
                      className="mt-0.5 rounded border-gray-300 text-red-500 focus:ring-red-500"
                    />
                    <span>同时为对方清空聊天记录（双向撤回）</span>
                  </label>
                )}
                {(chat.isGroup || chat.isChannel) && chat.id.startsWith('tg_') && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
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
                    className="px-3 py-1.5 rounded-lg text-xs text-[#707579] dark:text-[#9aa7b5] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
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
                    className="px-3 py-1.5 rounded-lg text-xs bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-semibold cursor-pointer"
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
