import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Check,
  Users,
  Archive,
  ArchiveRestore,
  Megaphone,
  Pin,
  X,
  PenSquare,
  MoreVertical,
  Eye,
  EyeOff,
  MessageSquare,
  Bell,
  BellOff,
  Trash2,
  MessageCircle,
  ChevronLeft,
  Bot,
  AlertTriangle,
  WifiOff,
  RefreshCw
} from 'lucide-react';
import { Chat } from '../types';
import {
  isSignedResourceUrl,
  isSignedResourceUrlExpiringSoon,
  refreshSignedResourceUrlsApi,
  ensureFreshSignedResourceUrl,
} from '../services/apiService';

export function formatChatSubtitle(chat: Chat): string {
  if (chat.username) {
    const clean = chat.username.replace(/^@/, '').trim();
    if (clean) return `@${clean}`;
  }
  if (chat.isChannel) {
    return chat.memberCount && chat.memberCount > 0
      ? `频道 · ${chat.memberCount} 位订阅者`
      : '频道会话';
  }
  if (chat.isGroup) {
    return chat.memberCount && chat.memberCount > 0
      ? `群组 · ${chat.memberCount} 位成员`
      : '群组会话';
  }
  if (chat.isBot) {
    return 'Telegram 机器人';
  }
  if (chat.phone) {
    return chat.phone;
  }
  if (chat.statusText) {
    return chat.statusText;
  }
  if (chat.isOnline) {
    return '私聊联系人 · 在线';
  }
  return '未设置用户名';
}

interface ChatListProps {
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onOpenMenuDrawer: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onTogglePinChat?: (chatId: string) => void;
  onToggleArchiveChat?: (chatId: string) => void;
  onToggleMuteChat?: (chatId: string) => void;
  onToggleMarkUnread?: (chatId: string) => void;
  onDeleteChat?: (chatId: string, options?: { revoke?: boolean }) => void;
  onNewChatClick?: () => void;
  currentAccountStatus?: string;
  currentAccountOfflineReason?: string | null;
  isReconnecting?: boolean;
  onReconnectAccount?: () => void;
  onReloginCurrentAccount?: () => void;
  onRefreshMediaUrls?: (urls: string[]) => Promise<Record<string, string>>;
}

interface ContextMenuState {
  chat: Chat;
  x: number;
  y: number;
}

export const ChatList: React.FC<ChatListProps> = ({
  chats,
  activeChatId,
  onSelectChat,
  onOpenMenuDrawer,
  searchQuery,
  setSearchQuery,
  onTogglePinChat,
  onToggleArchiveChat,
  onToggleMuteChat,
  onToggleMarkUnread,
  onDeleteChat,
  onNewChatClick,
  currentAccountStatus,
  currentAccountOfflineReason,
  isReconnecting,
  onReconnectAccount,
  onReloginCurrentAccount,
  onRefreshMediaUrls,
}) => {
  // 1. Resizable Width State with Persistence
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('tg_pro_chatlist_width');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 230 && val <= 650) return val;
      }
    } catch {}
    return 280;
  });

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(280);

  const [activeFolder, setActiveFolder] = useState<'all' | 'unread' | 'personal' | 'groups' | 'channels' | 'bots' | 'archived'>('all');
  const [isArchivedBoxVisible, setIsArchivedBoxVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tg_pro_show_archived_box') !== 'false';
    } catch {
      return true;
    }
  });
  const handleToggleArchivedBoxVisible = useCallback((nextVisible?: boolean) => {
    setIsArchivedBoxVisible((prev) => {
      const resolved = typeof nextVisible === 'boolean' ? nextVisible : !prev;
      try {
        localStorage.setItem('tg_pro_show_archived_box', resolved ? 'true' : 'false');
      } catch {}
      return resolved;
    });
  }, []);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [chatToDelete, setChatToDelete] = useState<Chat | null>(null);
  const [revokeDeleteChat, setRevokeDeleteChat] = useState(false);
  const [previewChat, setPreviewChat] = useState<Chat | null>(null);
  const [refreshedAvatars, setRefreshedAvatars] = useState<Record<string, string>>({});
  const attemptedAvatarRefreshRef = useRef<Set<string>>(new Set());

  const resolveAvatarUrl = useCallback(
    (rawUrl?: string) => {
      if (!rawUrl) return rawUrl;
      return refreshedAvatars[rawUrl] || rawUrl;
    },
    [refreshedAvatars]
  );

  const triggerAvatarRefresh = useCallback(
    async (rawUrl?: string, force = false): Promise<string | null> => {
      if (!rawUrl || !isSignedResourceUrl(rawUrl)) return null;
      const current = refreshedAvatars[rawUrl] || rawUrl;
      if (attemptedAvatarRefreshRef.current.has(current)) return null;
      if (!force && !isSignedResourceUrlExpiringSoon(current)) return current;
      attemptedAvatarRefreshRef.current.add(rawUrl);
      attemptedAvatarRefreshRef.current.add(current);
      try {
        let nextUrl = '';
        if (onRefreshMediaUrls) {
          const map = await onRefreshMediaUrls([current]);
          nextUrl = map[current] || map[rawUrl] || '';
        } else {
          const refreshed = await ensureFreshSignedResourceUrl(current, undefined, { force: true });
          if (refreshed && refreshed !== current) nextUrl = refreshed;
        }
        if (nextUrl && nextUrl !== current) {
          attemptedAvatarRefreshRef.current.add(nextUrl);
          setRefreshedAvatars((prev) => ({
            ...prev,
            [rawUrl]: nextUrl,
            [current]: nextUrl,
          }));
          return nextUrl;
        }
      } catch {}
      return null;
    },
    [onRefreshMediaUrls, refreshedAvatars]
  );

  useEffect(() => {
    const expiring: string[] = [];
    for (const c of chats) {
      if (!c.avatarUrl) continue;
      const effective = refreshedAvatars[c.avatarUrl] || c.avatarUrl;
      if (isSignedResourceUrlExpiringSoon(effective) && !attemptedAvatarRefreshRef.current.has(effective)) {
        expiring.push(effective);
      }
    }
    const unique = Array.from(new Set(expiring)).slice(0, 40);
    if (unique.length === 0) return;
    unique.forEach((u) => attemptedAvatarRefreshRef.current.add(u));
    let cancelled = false;
    (async () => {
      const refreshed = onRefreshMediaUrls
        ? await onRefreshMediaUrls(unique)
        : await refreshSignedResourceUrlsApi(unique);
      if (cancelled || !refreshed || Object.keys(refreshed).length === 0) return;
      setRefreshedAvatars((prev) => {
        const next = { ...prev };
        for (const [oldUrl, newUrl] of Object.entries(refreshed)) {
          if (newUrl) {
            attemptedAvatarRefreshRef.current.add(newUrl);
            next[oldUrl] = newUrl;
          }
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [chats, onRefreshMediaUrls, refreshedAvatars]);

  // Drag-to-resize handlers
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startXRef.current;
      const minW = 230;
      const maxW = Math.min(window.innerWidth * 0.55, 650);
      const newWidth = Math.max(minW, Math.min(maxW, Math.round(startWidthRef.current + deltaX)));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      try {
        localStorage.setItem('tg_pro_chatlist_width', String(startWidthRef.current));
      } catch {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    try {
      localStorage.setItem('tg_pro_chatlist_width', String(width));
    } catch {}
  }, [width]);

  // Close context menu on outside click, ESC, scroll or resize
  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setPreviewChat(null);
        setChatToDelete(null);
      }
    };
    if (contextMenu) {
      window.addEventListener('click', handleCloseMenu);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('resize', handleCloseMenu);
      window.addEventListener('scroll', handleCloseMenu, true);
      return () => {
        window.removeEventListener('click', handleCloseMenu);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('resize', handleCloseMenu);
        window.removeEventListener('scroll', handleCloseMenu, true);
      };
    }
  }, [contextMenu]);

  // Context Menu Trigger
  const handleOpenContextMenu = (chat: Chat, e: React.MouseEvent, anchorToButton = false) => {
    e.preventDefault();
    e.stopPropagation();

    // Bound menu coordinates within window
    const menuWidth = 208;
    const menuHeight = 296;
    const margin = 12;
    let x = e.clientX;
    let y = e.clientY;

    if (anchorToButton && e.currentTarget instanceof HTMLElement) {
      const rect = e.currentTarget.getBoundingClientRect();
      x = rect.right - menuWidth;
      if (x < margin) {
        x = rect.left;
      }
      y = rect.bottom + 4;
      if (y + menuHeight > window.innerHeight - margin) {
        y = rect.top - menuHeight - 4;
      }
    } else {
      if (x + menuWidth > window.innerWidth - margin) {
        x = e.clientX - menuWidth;
      }
      if (y + menuHeight > window.innerHeight - margin) {
        y = e.clientY - menuHeight;
      }
    }

    x = Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin));
    y = Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin));

    setContextMenu({ chat, x, y });
  };

  // Filtered Chats
  const archivedCount = chats.filter((c) => c.isArchived).length;
  const unreadCount = chats.filter((c) => c.unreadCount > 0).length;

  const filteredChats = chats.filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    const qDigits = q.replace(/[\s\-\(\)\.+]/g, '');
    const matchesSearch =
      !q ||
      c.title.toLowerCase().includes(q) ||
      c.lastMessage.toLowerCase().includes(q) ||
      (c.username && c.username.toLowerCase().includes(q)) ||
      (c.phone &&
        (c.phone.toLowerCase().includes(q) ||
          (qDigits.length > 0 && c.phone.replace(/[\s\-\(\)\.+]/g, '').toLowerCase().includes(qDigits))));

    if (!matchesSearch) return false;

    // Folder category filtering
    if (activeFolder === 'archived') return Boolean(c.isArchived);

    // In normal folders, exclude archived chats (unless explicitly searching)
    if (!q && c.isArchived) return false;

    if (activeFolder === 'unread') return c.unreadCount > 0;
    if (activeFolder === 'personal') return !c.isGroup && !c.isChannel && !c.isBot;
    if (activeFolder === 'groups') return Boolean(c.isGroup);
    if (activeFolder === 'channels') return Boolean(c.isChannel);
    if (activeFolder === 'bots') return Boolean(c.isBot);

    return true;
  });

  // Sort: Pinned chats first, then by last message/active
  const sortedChats = [...filteredChats].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });

  return (
    <div
      style={{ width: `${width}px` }}
      className="bg-white/95 dark:bg-[#09111d]/95 aurora:bg-[#0f171c]/95 backdrop-blur-md border-r border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] flex flex-col h-full shrink-0 select-none transition-colors relative"
    >
      {/* 1. Top Header: Search Bar + Compact New Chat Button */}
      <div className="h-[56px] px-2.5 flex items-center gap-2 border-b border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] shrink-0">
        {/* Search Input */}
        <div className="relative flex-1 flex items-center">
          <Search className="w-3.5 h-3.5 text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索对话、频道与消息..."
            className="w-full bg-[#f1f5f9]/90 dark:bg-[#0e1726] aurora:bg-[#162128] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-xs pl-8 pr-7 py-2 rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#203540] focus:border-[#2ba0ff]/60 aurora:focus:border-[#2dd4bf]/60 focus:bg-white dark:focus:bg-[#0b1320] aurora:focus:bg-[#101b22] focus:outline-none placeholder-[#94a3b8] dark:placeholder-[#566d85] aurora:placeholder-[#617b86] transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Toggle Archived Box Visibility */}
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => handleToggleArchivedBoxVisible()}
            title={isArchivedBoxVisible ? '隐藏顶部「已归档对话」框' : '打开顶部「已归档对话」框'}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer shrink-0 border ${
              isArchivedBoxVisible
                ? 'bg-[#e8f3ff] text-[#0284c7] border-[#bfdbfe] dark:bg-[#13253b] dark:text-[#2ba0ff] dark:border-[#2ba0ff]/35 aurora:bg-[#112e37] aurora:text-[#5eead4] aurora:border-[#2dd4bf]/40'
                : 'bg-[#f1f5f9] hover:bg-[#e8f3ff] dark:bg-[#0e1726] dark:hover:bg-[#132236] aurora:bg-[#162128] aurora:hover:bg-[#112d36] text-[#64748b] hover:text-[#0284c7] dark:text-[#7f95ab] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#203540]'
            }`}
          >
            <Archive className="w-4 h-4" />
          </button>
        )}

        {/* Inline New Chat Button */}
        {onNewChatClick && (
          <button
            type="button"
            onClick={onNewChatClick}
            title="发起新聊天 / 联系人"
            className="w-8 h-8 rounded-lg bg-[#f1f5f9] hover:bg-[#e8f3ff] dark:bg-[#0e1726] dark:hover:bg-[#132236] aurora:bg-[#162128] aurora:hover:bg-[#112d36] text-[#475569] hover:text-[#0284c7] dark:text-[#9bb3c9] dark:hover:text-[#2ba0ff] aurora:text-[#89a5b0] aurora:hover:text-[#5eead4] flex items-center justify-center transition-colors cursor-pointer shrink-0 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#203540] hover:border-[#bfdbfe] dark:hover:border-[#2ba0ff]/40 aurora:hover:border-[#2dd4bf]/45"
          >
            <PenSquare className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Persistent Session Expired Banner */}
      {currentAccountStatus === 'expired' && (
        <div className="mx-2 mt-2 px-3 py-2 rounded-xl bg-rose-500/10 dark:bg-rose-950/50 aurora:bg-rose-950/50 border border-rose-500/30 aurora:border-rose-500/35 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="text-[11.5px] font-medium text-rose-700 dark:text-rose-300 aurora:text-rose-200 truncate">
              当前账号会话已失效
            </span>
          </div>
          {onReloginCurrentAccount && (
            <button
              type="button"
              onClick={onReloginCurrentAccount}
              className="px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-semibold shrink-0 cursor-pointer transition-colors"
            >
              重新登录
            </button>
          )}
        </div>
      )}

      {/* Offline / Reconnecting Banner with explicit reason and Reconnect button */}
      {(currentAccountStatus === 'offline' || currentAccountStatus === 'away') && (
        <div className="mx-2 mt-2 px-3 py-2 rounded-xl bg-amber-500/10 dark:bg-amber-950/45 aurora:bg-amber-950/45 border border-amber-500/30 aurora:border-amber-500/35 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0" title={currentAccountOfflineReason || undefined}>
            <WifiOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 aurora:text-amber-200 truncate">
              连接中
            </span>
          </div>
          {onReconnectAccount && (
            <button
              type="button"
              disabled={isReconnecting}
              onClick={onReconnectAccount}
              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-[11px] font-semibold shrink-0 cursor-pointer transition-colors flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${isReconnecting ? 'animate-spin' : ''}`} />
              <span>{isReconnecting ? '重连中' : '重连'}</span>
            </button>
          )}
        </div>
      )}

      {/* 2. Chat Folder Tabs */}
      <div className="flex items-center px-2 py-1.5 gap-1 border-b border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] overflow-x-auto no-scrollbar text-[11.5px] font-medium shrink-0">
        <button
          onClick={() => setActiveFolder('all')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 relative border ${
            activeFolder === 'all'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] aurora:bg-[#112e37] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726] aurora:hover:bg-[#132129]'
          }`}
        >
          全部
        </button>

        <button
          onClick={() => setActiveFolder('unread')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1 border ${
            activeFolder === 'unread'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] aurora:bg-[#112e37] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726] aurora:hover:bg-[#132129]'
          }`}
        >
          <span>未读</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#2ba0ff] aurora:bg-[#14b8a6] text-white font-bold leading-none tabular-nums">
              {unreadCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveFolder('personal')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
            activeFolder === 'personal'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] aurora:bg-[#112e37] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726] aurora:hover:bg-[#132129]'
          }`}
        >
          私聊
        </button>

        <button
          onClick={() => setActiveFolder('groups')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
            activeFolder === 'groups'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] aurora:bg-[#112e37] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726] aurora:hover:bg-[#132129]'
          }`}
        >
          群组
        </button>

        <button
          onClick={() => setActiveFolder('channels')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
            activeFolder === 'channels'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] aurora:bg-[#112e37] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726] aurora:hover:bg-[#132129]'
          }`}
        >
          频道
        </button>

        <button
          onClick={() => setActiveFolder('bots')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
            activeFolder === 'bots'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] aurora:bg-[#112e37] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726] aurora:hover:bg-[#132129]'
          }`}
        >
          机器人
        </button>

        {archivedCount > 0 && (
          <button
            onClick={() => setActiveFolder('archived')}
            className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1 border ${
              activeFolder === 'archived'
                ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] aurora:bg-[#112e37] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35'
                : 'border-transparent text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726] aurora:hover:bg-[#132129]'
            }`}
          >
            <Archive className="w-3.5 h-3.5" />
            <span>已归档 ({archivedCount})</span>
          </button>
        )}
      </div>

      {/* 3. Chat Items List */}
      <div className="flex-1 overflow-y-auto py-1 space-y-0.5">
        {/* Top "已归档对话" Collapsed Row */}
        {activeFolder !== 'archived' && !searchQuery && archivedCount > 0 && isArchivedBoxVisible && (
          <div
            onClick={() => setActiveFolder('archived')}
            className="mx-1.5 px-2.5 py-2 rounded-xl flex items-center cursor-pointer hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726]/80 aurora:hover:bg-[#132129]/80 transition-colors group border border-transparent"
          >
            <div className="w-10 h-10 rounded-full bg-[#f1f5f9] dark:bg-[#132033] aurora:bg-[#13252e] flex items-center justify-center mr-2.5 shrink-0 text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] group-hover:text-[#0284c7] dark:group-hover:text-[#2ba0ff] aurora:group-hover:text-[#5eead4] group-hover:bg-[#e8f3ff] dark:group-hover:bg-[#16283f] aurora:group-hover:bg-[#112e37] transition-all">
              <Archive className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] group-hover:text-[#0284c7] dark:group-hover:text-[#2ba0ff] aurora:group-hover:text-[#5eead4]">
                已归档对话
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] tabular-nums">
                  {archivedCount}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleArchivedBoxVisible(false);
                  }}
                  title="隐藏「已归档对话」框"
                  className="p-1 rounded-md text-[#94a3b8] hover:text-[#0f172a] dark:text-[#647a90] dark:hover:text-white aurora:text-[#6d8994] aurora:hover:text-[#ecf6f8] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Back to All Chats banner if in Archived folder */}
        {activeFolder === 'archived' && (
          <div
            onClick={() => setActiveFolder('all')}
            className="mx-1.5 px-3 py-2 rounded-xl bg-[#e8f3ff] dark:bg-[#12263f] aurora:bg-[#112d36] text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] text-xs font-medium flex items-center justify-between gap-2 cursor-pointer border border-[#bfdbfe]/60 dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35"
          >
            <span className="flex items-center gap-1.5 hover:underline">
              <ChevronLeft className="w-4 h-4" />
              <span>返回全部会话</span>
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleArchivedBoxVisible();
              }}
              className="text-[11px] px-2 py-0.5 rounded-md bg-white/70 dark:bg-[#0b1626]/70 aurora:bg-[#0b1920]/70 hover:bg-white dark:hover:bg-[#0f1f36] aurora:hover:bg-[#112630] transition-colors cursor-pointer shrink-0"
            >
              {isArchivedBoxVisible ? '隐藏顶部框' : '显示顶部框'}
            </button>
          </div>
        )}

        {sortedChats.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-2 text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5]">
            <Search className="w-6 h-6 opacity-35 text-[#2ba0ff] aurora:text-[#2dd4bf]" />
            <span className="text-xs font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
              {activeFolder === 'archived'
                ? '暂无已归档会话'
                : chats.length === 0
                ? '暂无会话记录'
                : '未找到匹配的对话'}
            </span>
          </div>
        ) : (
          sortedChats.map((chat) => {
            const isSelected = chat.id === activeChatId;

            return (
              <div
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                onContextMenu={(e) => handleOpenContextMenu(chat, e)}
                className={`mx-1.5 flex items-center px-2.5 py-2.5 rounded-xl cursor-pointer transition-all relative group border ${
                  isSelected
                    ? 'bg-[#e8f3ff]/90 border-[#bfdbfe] text-[#0f172a] dark:bg-[#12263f]/90 dark:border-[#2ba0ff]/35 dark:text-white aurora:bg-[#122b33]/90 aurora:border-[#2dd4bf]/40 aurora:text-[#ecf6f8] shadow-xs'
                    : 'border-transparent hover:bg-[#f8fafc] dark:hover:bg-[#0e1726]/75 aurora:hover:bg-[#132129]/80 text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]'
                }`}
              >
                {/* Contact Avatar */}
                <div className="relative shrink-0 mr-2.5">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden relative"
                    style={{ backgroundColor: chat.avatarBg }}
                  >
                    {chat.isVerified ? (
                      <div className="w-full h-full bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#14b8a6] flex items-center justify-center text-white">
                        <Check className="w-4 h-4 stroke-[2.5]" />
                      </div>
                    ) : (
                      <>
                        <span className="text-white text-xs font-semibold select-none">{chat.avatarInitial}</span>
                        {chat.avatarUrl && (
                          <img
                            src={resolveAvatarUrl(chat.avatarUrl)}
                            alt={chat.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover absolute inset-0"
                            onLoad={(e) => {
                              e.currentTarget.style.display = '';
                            }}
                            onError={(e) => {
                              const imgEl = e.currentTarget;
                              void triggerAvatarRefresh(chat.avatarUrl, true).then((nextUrl) => {
                                if (!nextUrl) {
                                  imgEl.style.display = 'none';
                                }
                              });
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>

                  {/* Online indicator dot only when real MTProto UserStatus is Online */}
                  {!chat.isGroup && !chat.isChannel && !chat.isBot && chat.isOnline && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#09111d] aurora:border-[#0f171c]" />
                  )}
                </div>

                {/* Contact Details */}
                <div className="flex-1 min-w-0 pr-0.5">
                  {/* Row 1: Title, Verified Badge, Time */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1 min-w-0 pr-1">
                      {chat.isChannel ? (
                        <Megaphone
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected
                              ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
                              : 'text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5]'
                          }`}
                        />
                      ) : chat.isBot ? (
                        <Bot
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected
                              ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
                              : 'text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5]'
                          }`}
                        />
                      ) : chat.isGroup ? (
                        <Users
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected
                              ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
                              : 'text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5]'
                          }`}
                        />
                      ) : null}
                      <span
                        className={`text-[13px] font-semibold truncate leading-tight ${
                          isSelected
                            ? 'text-[#0f172a] dark:text-white aurora:text-[#ecf6f8]'
                            : 'text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]'
                        }`}
                      >
                        {chat.title}
                      </span>
                      {chat.isVerified && (
                        <span className="w-3.5 h-3.5 bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#14b8a6] rounded-full flex items-center justify-center text-white shrink-0">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                      )}
                      {chat.isMuted && (
                        <BellOff
                          className={`w-3 h-3 shrink-0 ${
                            isSelected
                              ? 'text-[#64748b] dark:text-white/70 aurora:text-[#b7d0d8]'
                              : 'text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5]'
                          }`}
                        />
                      )}
                    </div>

                    <span
                      className={`text-[11px] shrink-0 font-normal tabular-nums ${
                        isSelected
                          ? 'text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] font-medium'
                          : 'text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5]'
                      }`}
                    >
                      {chat.lastTime}
                    </span>
                  </div>

                  {/* Row 2: Message Snippet & Unread / Pinned */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 min-w-0 pr-1.5">
                      <p
                        className={`text-[12px] truncate leading-tight ${
                          isSelected
                            ? 'text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8]'
                            : 'text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5]'
                        }`}
                      >
                        {chat.lastMessage}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      {/* Pinned Icon */}
                      {chat.isPinned && (
                        <Pin
                          className={`w-3 h-3 fill-current ${
                            isSelected ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]' : 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]'
                          }`}
                        />
                      )}

                      {/* Unread Counter Badge */}
                      {chat.unreadCount > 0 && (
                        <span
                          className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-[10.5px] font-bold flex items-center justify-center tabular-nums leading-none ${
                            isSelected
                              ? 'bg-[#2ba0ff] aurora:bg-[#14b8a6] text-white'
                              : 'bg-[#2ba0ff] aurora:bg-[#14b8a6] text-white'
                          }`}
                        >
                          {chat.unreadCount}
                        </span>
                      )}

                      {/* Hover Actions Menu Trigger Button */}
                      <button
                        type="button"
                        onClick={(e) => handleOpenContextMenu(chat, e, true)}
                        title="更多操作 (或右键点击)"
                        className={`p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                          isSelected
                            ? 'text-[#475569] dark:text-white aurora:text-[#ecf6f8] hover:bg-black/5 dark:hover:bg-white/20 aurora:hover:bg-[#1a333d]'
                            : 'text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:bg-black/10 dark:hover:bg-white/10 aurora:hover:bg-[#1a2f3a]'
                        }`}
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. Draggable Width Resize Handle (Divider on the Right) */}
      <div
        onMouseDown={handleMouseDownResize}
        onDoubleClick={() => setWidth(280)}
        title="拖拽调整宽度 (双击恢复)"
        className={`absolute top-0 right-0 w-2 h-full cursor-col-resize z-20 group transition-colors ${
          isResizing ? 'bg-[#2ba0ff]/40 aurora:bg-[#2dd4bf]/40' : 'hover:bg-[#2ba0ff]/30 aurora:hover:bg-[#2dd4bf]/30 bg-transparent'
        }`}
      >
        <div
          className={`w-[2px] h-full ml-auto transition-colors ${
            isResizing ? 'bg-[#2ba0ff] aurora:bg-[#2dd4bf]' : 'group-hover:bg-[#2ba0ff] aurora:group-hover:bg-[#2dd4bf] bg-transparent'
          }`}
        />
      </div>

      {/* 5. Official Telegram Right-Click Context Menu */}
      {contextMenu && typeof document !== 'undefined' && createPortal(
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-[9995] w-52 max-h-[calc(100vh-24px)] overflow-y-auto bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] rounded-2xl shadow-2xl border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] py-1.5 animate-in fade-in zoom-in-95 duration-100 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Switch to Chat */}
          <button
            type="button"
            onClick={() => {
              onSelectChat(contextMenu.chat.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors text-left cursor-pointer"
          >
            <MessageCircle className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
            <span className="font-medium">切换到此会话</span>
          </button>

          {/* Quick Preview */}
          <button
            type="button"
            onClick={() => {
              setPreviewChat(contextMenu.chat);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors text-left cursor-pointer"
          >
            <Eye className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
            <span className="font-medium">快速预览</span>
          </button>

          {/* Mark as Unread / Read */}
          <button
            type="button"
            onClick={() => {
              onToggleMarkUnread?.(contextMenu.chat.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors text-left cursor-pointer"
          >
            <MessageSquare className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
            <span className="font-medium">
              {contextMenu.chat.unreadCount > 0 ? '标为已读' : '标为未读'}
            </span>
          </button>

          {/* Pin to Top / Unpin */}
          <button
            type="button"
            onClick={() => {
              onTogglePinChat?.(contextMenu.chat.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors text-left cursor-pointer"
          >
            <Pin className={`w-4 h-4 ${contextMenu.chat.isPinned ? 'fill-current text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]' : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]'}`} />
            <span className="font-medium">
              {contextMenu.chat.isPinned ? '取消置顶' : '置顶'}
            </span>
          </button>

          {/* Mute / Unmute */}
          <button
            type="button"
            onClick={() => {
              onToggleMuteChat?.(contextMenu.chat.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors text-left cursor-pointer"
          >
            {contextMenu.chat.isMuted ? (
              <>
                <Bell className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
                <span className="font-medium">开启声音提醒</span>
              </>
            ) : (
              <>
                <BellOff className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
                <span className="font-medium">静音通知</span>
              </>
            )}
          </button>

          {/* Archive / Unarchive */}
          <button
            type="button"
            onClick={() => {
              onToggleArchiveChat?.(contextMenu.chat.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors text-left cursor-pointer"
          >
            {contextMenu.chat.isArchived ? (
              <>
                <ArchiveRestore className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
                <span className="font-medium">移出归档</span>
              </>
            ) : (
              <>
                <Archive className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
                <span className="font-medium">归档对话</span>
              </>
            )}
          </button>

          <div className="h-px bg-[#e2e8f0] dark:bg-[#18273a] aurora:bg-[#182b34] my-1" />

          {/* Delete Chat (Red) */}
          <button
            type="button"
            onClick={() => {
              setRevokeDeleteChat(false);
              setChatToDelete(contextMenu.chat);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 transition-colors text-left cursor-pointer font-medium"
          >
            <Trash2 className="w-4 h-4" />
            <span>{contextMenu.chat.isGroup || contextMenu.chat.isChannel ? '退出并删除对话' : '删除对话'}</span>
          </button>
        </div>,
        document.body
      )}

      {/* 6. Quick Preview Modal */}
      {previewChat && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9996] flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs select-none">
          <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-sm overflow-hidden shrink-0 relative"
                  style={{ backgroundColor: previewChat.avatarBg }}
                >
                  <span>{previewChat.avatarInitial}</span>
                  {previewChat.avatarUrl && (
                    <img
                      src={resolveAvatarUrl(previewChat.avatarUrl)}
                      alt={previewChat.title}
                      className="w-full h-full object-cover absolute inset-0"
                      onLoad={(e) => {
                        e.currentTarget.style.display = '';
                      }}
                      onError={(e) => {
                        const imgEl = e.currentTarget;
                        void triggerAvatarRefresh(previewChat.avatarUrl, true).then((nextUrl) => {
                          if (!nextUrl) {
                            imgEl.style.display = 'none';
                          }
                        });
                      }}
                    />
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-sm text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">{previewChat.title}</h4>
                  <p className="text-xs text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]">{formatChatSubtitle(previewChat)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewChat(null)}
                className="p-1 rounded-lg text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] rounded-xl text-xs mb-4">
              <span className="text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-1 font-semibold">最新消息:</span>
              <p className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">{previewChat.lastMessage}</p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPreviewChat(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] cursor-pointer"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectChat(previewChat.id);
                  setPreviewChat(null);
                }}
                className="px-4 py-1.5 rounded-xl text-xs bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white font-medium cursor-pointer"
              >
                进入对话
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 7. Delete Chat Confirmation Modal */}
      {chatToDelete && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9996] flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs select-none">
          <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-150">
            <h4 className="font-bold text-base text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] mb-2">
              {chatToDelete.isGroup || chatToDelete.isChannel
                ? `退出并删除该${chatToDelete.isChannel ? '频道' : '群组'}？`
                : '删除此对话？'}
            </h4>
            <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] leading-relaxed mb-4">
              {chatToDelete.isGroup || chatToDelete.isChannel
                ? <>确定要退出并移除 <span className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">「{chatToDelete.title}」</span> 的会话记录吗？此操作无法撤销。</>
                : <>确定要删除与 <span className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">「{chatToDelete.title}」</span> 的全部聊天记录吗？此操作无法撤销。</>}
            </p>
            {!chatToDelete.isGroup && !chatToDelete.isChannel && chatToDelete.id.startsWith('tg_') && (
              <label className="flex items-start gap-2.5 p-2.5 mb-4 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={revokeDeleteChat}
                  onChange={(e) => setRevokeDeleteChat(e.target.checked)}
                  className="mt-0.5 rounded border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[#2481cc] aurora:text-[#14b8a6] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf]"
                />
                <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] leading-snug">
                  同时为对方删除全部聊天记录（双向清除）
                </span>
              </label>
            )}
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setChatToDelete(null);
                  setRevokeDeleteChat(false);
                }}
                className="px-4 py-2 rounded-xl text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] cursor-pointer font-medium"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const revoke = !chatToDelete.isGroup && !chatToDelete.isChannel ? revokeDeleteChat : false;
                  onDeleteChat?.(chatToDelete.id, { revoke });
                  setChatToDelete(null);
                  setRevokeDeleteChat(false);
                }}
                className="px-4 py-2 rounded-xl text-xs bg-rose-500 hover:bg-rose-600 text-white font-semibold cursor-pointer shadow-xs"
              >
                {chatToDelete.isGroup || chatToDelete.isChannel ? '确认退出并删除' : '确认删除'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
