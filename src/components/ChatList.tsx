import React, { useState, useEffect, useRef } from 'react';
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
  MessageSquare,
  Bell,
  BellOff,
  Trash2,
  ExternalLink,
  ChevronLeft,
  Bot,
  AlertTriangle,
  WifiOff,
  RefreshCw
} from 'lucide-react';
import { Chat } from '../types';

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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [chatToDelete, setChatToDelete] = useState<Chat | null>(null);
  const [revokeDeleteChat, setRevokeDeleteChat] = useState(false);
  const [previewChat, setPreviewChat] = useState<Chat | null>(null);

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

  // Close context menu on outside click or ESC
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
      return () => {
        window.removeEventListener('click', handleCloseMenu);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [contextMenu]);

  // Context Menu Trigger
  const handleOpenContextMenu = (chat: Chat, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Bound menu coordinates within window
    const menuWidth = 210;
    const menuHeight = 270;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 12;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 12;
    }

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
      className="bg-white/95 dark:bg-[#09111d]/95 backdrop-blur-md border-r border-[#e2e8f0] dark:border-[#162436] flex flex-col h-full shrink-0 select-none transition-colors relative"
    >
      {/* 1. Top Header: Search Bar + Compact New Chat Button */}
      <div className="h-[56px] px-2.5 flex items-center gap-2 border-b border-[#e2e8f0] dark:border-[#162436] shrink-0">
        {/* Search Input */}
        <div className="relative flex-1 flex items-center">
          <Search className="w-3.5 h-3.5 text-[#64748b] dark:text-[#7f95ab] absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索对话、频道与消息..."
            className="w-full bg-[#f1f5f9]/90 dark:bg-[#0e1726] text-[#0f172a] dark:text-[#eef4fb] text-xs pl-8 pr-7 py-2 rounded-lg border border-[#e2e8f0] dark:border-[#18273a] focus:border-[#2ba0ff]/60 focus:bg-white dark:focus:bg-[#0b1320] focus:outline-none placeholder-[#94a3b8] dark:placeholder-[#566d85] transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Inline New Chat Button */}
        {onNewChatClick && (
          <button
            type="button"
            onClick={onNewChatClick}
            title="发起新聊天 / 联系人"
            className="w-8 h-8 rounded-lg bg-[#f1f5f9] hover:bg-[#e8f3ff] dark:bg-[#0e1726] dark:hover:bg-[#132236] text-[#475569] hover:text-[#0284c7] dark:text-[#9bb3c9] dark:hover:text-[#2ba0ff] flex items-center justify-center transition-colors cursor-pointer shrink-0 border border-[#e2e8f0] dark:border-[#18273a] hover:border-[#bfdbfe] dark:hover:border-[#2ba0ff]/40"
          >
            <PenSquare className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Persistent Session Expired Banner */}
      {currentAccountStatus === 'expired' && (
        <div className="mx-2 mt-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="text-[11.5px] font-medium text-rose-600 dark:text-rose-300 truncate">
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
        <div className="mx-2 mt-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0" title={currentAccountOfflineReason || undefined}>
            <WifiOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 truncate">
              {currentAccountOfflineReason || (currentAccountStatus === 'away' ? 'MTProto 连接断开，正在重连...' : '当前账号未连接 MTProto')}
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
      <div className="flex items-center px-2 py-1.5 gap-1 border-b border-[#e2e8f0] dark:border-[#162436] overflow-x-auto no-scrollbar text-[11.5px] font-medium shrink-0">
        <button
          onClick={() => setActiveFolder('all')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 relative border ${
            activeFolder === 'all'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726]'
          }`}
        >
          全部
        </button>

        <button
          onClick={() => setActiveFolder('unread')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1 border ${
            activeFolder === 'unread'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726]'
          }`}
        >
          <span>未读</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#2ba0ff] text-white font-bold leading-none tabular-nums">
              {unreadCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveFolder('personal')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
            activeFolder === 'personal'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726]'
          }`}
        >
          私聊
        </button>

        <button
          onClick={() => setActiveFolder('groups')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
            activeFolder === 'groups'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726]'
          }`}
        >
          群组
        </button>

        <button
          onClick={() => setActiveFolder('channels')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
            activeFolder === 'channels'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726]'
          }`}
        >
          频道
        </button>

        <button
          onClick={() => setActiveFolder('bots')}
          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 border ${
            activeFolder === 'bots'
              ? 'text-[#0284c7] dark:text-[#2ba0ff] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30'
              : 'border-transparent text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726]'
          }`}
        >
          机器人
        </button>

        {archivedCount > 0 && (
          <button
            onClick={() => setActiveFolder('archived')}
            className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1 border ${
              activeFolder === 'archived'
                ? 'text-[#0284c7] dark:text-[#2ba0ff] font-semibold bg-[#e8f3ff] dark:bg-[#13253b] border-[#bfdbfe]/70 dark:border-[#2ba0ff]/30'
                : 'border-transparent text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726]'
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
        {activeFolder !== 'archived' && !searchQuery && archivedCount > 0 && (
          <div
            onClick={() => setActiveFolder('archived')}
            className="mx-1.5 px-2.5 py-2 rounded-xl flex items-center cursor-pointer hover:bg-[#f1f5f9] dark:hover:bg-[#0e1726]/80 transition-colors group border border-transparent"
          >
            <div className="w-10 h-10 rounded-full bg-[#f1f5f9] dark:bg-[#132033] flex items-center justify-center mr-2.5 shrink-0 text-[#64748b] dark:text-[#7f95ab] group-hover:text-[#0284c7] dark:group-hover:text-[#2ba0ff] group-hover:bg-[#e8f3ff] dark:group-hover:bg-[#16283f] transition-all">
              <Archive className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[#0f172a] dark:text-[#eef4fb] group-hover:text-[#0284c7] dark:group-hover:text-[#2ba0ff]">
                已归档对话
              </span>
              <span className="text-[11px] text-[#64748b] dark:text-[#7f95ab] tabular-nums">
                {archivedCount}
              </span>
            </div>
          </div>
        )}

        {/* Back to All Chats banner if in Archived folder */}
        {activeFolder === 'archived' && (
          <div
            onClick={() => setActiveFolder('all')}
            className="mx-1.5 px-3 py-2 rounded-xl bg-[#e8f3ff] dark:bg-[#13253b] text-[#0284c7] dark:text-[#2ba0ff] text-xs font-medium flex items-center gap-1.5 cursor-pointer hover:underline border border-[#bfdbfe]/60 dark:border-[#2ba0ff]/30"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>返回全部会话</span>
          </div>
        )}

        {sortedChats.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-2 text-[#64748b] dark:text-[#7f95ab]">
            <Search className="w-6 h-6 opacity-35 text-[#2ba0ff]" />
            <span className="text-xs font-medium text-[#0f172a] dark:text-[#eef4fb]">
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
                    ? 'bg-[#e8f3ff]/90 border-[#bfdbfe] text-[#0f172a] dark:bg-[#12263f]/90 dark:border-[#2ba0ff]/35 dark:text-white shadow-xs'
                    : 'border-transparent hover:bg-[#f8fafc] dark:hover:bg-[#0e1726]/75 text-[#0f172a] dark:text-[#eef4fb]'
                }`}
              >
                {/* Contact Avatar */}
                <div className="relative shrink-0 mr-2.5">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden relative ${
                      chat.isArchived ? 'bg-[#243547]' : ''
                    }`}
                    style={{ backgroundColor: chat.avatarBg }}
                  >
                    {chat.isArchived ? (
                      <Archive className="w-4 h-4 text-white" />
                    ) : chat.isVerified ? (
                      <div className="w-full h-full bg-[#2ba0ff] flex items-center justify-center text-white">
                        <Check className="w-4 h-4 stroke-[2.5]" />
                      </div>
                    ) : (
                      <>
                        <span className="text-white text-xs font-semibold select-none">{chat.avatarInitial}</span>
                        {chat.avatarUrl && (
                          <img
                            src={chat.avatarUrl}
                            alt={chat.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover absolute inset-0"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = 'none';
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>

                  {/* Online indicator dot only when real MTProto UserStatus is Online */}
                  {!chat.isGroup && !chat.isChannel && !chat.isBot && !chat.isArchived && chat.isOnline && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#09111d]" />
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
                            isSelected ? 'text-[#0284c7] dark:text-[#2ba0ff]' : 'text-[#64748b] dark:text-[#7f95ab]'
                          }`}
                        />
                      ) : chat.isBot ? (
                        <Bot
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? 'text-[#0284c7] dark:text-[#2ba0ff]' : 'text-[#64748b] dark:text-[#7f95ab]'
                          }`}
                        />
                      ) : chat.isGroup ? (
                        <Users
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? 'text-[#0284c7] dark:text-[#2ba0ff]' : 'text-[#64748b] dark:text-[#7f95ab]'
                          }`}
                        />
                      ) : null}
                      <span
                        className={`text-[13px] font-semibold truncate leading-tight ${
                          isSelected ? 'text-[#0f172a] dark:text-white' : 'text-[#0f172a] dark:text-[#eef4fb]'
                        }`}
                      >
                        {chat.title}
                      </span>
                      {chat.isVerified && (
                        <span className="w-3.5 h-3.5 bg-[#2ba0ff] rounded-full flex items-center justify-center text-white shrink-0">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                      )}
                      {chat.isMuted && (
                        <BellOff
                          className={`w-3 h-3 shrink-0 ${
                            isSelected ? 'text-[#64748b] dark:text-white/70' : 'text-[#64748b] dark:text-[#7f95ab]'
                          }`}
                        />
                      )}
                    </div>

                    <span
                      className={`text-[11px] shrink-0 font-normal tabular-nums ${
                        isSelected ? 'text-[#0284c7] dark:text-[#7cc4ff] font-medium' : 'text-[#64748b] dark:text-[#7f95ab]'
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
                          isSelected ? 'text-[#475569] dark:text-[#cbd5e1]' : 'text-[#64748b] dark:text-[#7f95ab]'
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
                            isSelected ? 'text-[#0284c7] dark:text-[#2ba0ff]' : 'text-[#0284c7] dark:text-[#2ba0ff]'
                          }`}
                        />
                      )}

                      {/* Unread Counter Badge */}
                      {chat.unreadCount > 0 && (
                        <span
                          className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-[10.5px] font-bold flex items-center justify-center tabular-nums leading-none ${
                            isSelected
                              ? 'bg-[#2ba0ff] text-white'
                              : 'bg-[#2ba0ff] text-white'
                          }`}
                        >
                          {chat.unreadCount}
                        </span>
                      )}

                      {/* Hover Actions Menu Trigger Button */}
                      <button
                        type="button"
                        onClick={(e) => handleOpenContextMenu(chat, e)}
                        title="更多操作 (或右键点击)"
                        className={`p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                          isSelected
                            ? 'text-[#475569] dark:text-white hover:bg-black/5 dark:hover:bg-white/20'
                            : 'text-[#64748b] dark:text-[#7f95ab] hover:bg-black/10 dark:hover:bg-white/10'
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
          isResizing ? 'bg-[#2ba0ff]/40' : 'hover:bg-[#2ba0ff]/30 bg-transparent'
        }`}
      >
        <div
          className={`w-[2px] h-full ml-auto transition-colors ${
            isResizing ? 'bg-[#2ba0ff]' : 'group-hover:bg-[#2ba0ff] bg-transparent'
          }`}
        />
      </div>

      {/* 5. Official Telegram Right-Click Context Menu (Image 3 Style) */}
      {contextMenu && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 w-52 bg-white dark:bg-[#1f2936] rounded-2xl shadow-2xl border border-[#e0e4e8] dark:border-[#2d3a4b] py-1.5 animate-in fade-in zoom-in-95 duration-100 text-xs text-[#111827] dark:text-[#f5f7fa] select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Open in New Tab */}
          <button
            type="button"
            onClick={() => {
              onSelectChat(contextMenu.chat.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <ExternalLink className="w-4 h-4 text-[#707579] dark:text-[#9aa7b5]" />
            <span className="font-medium">在新标签页打开</span>
          </button>

          {/* Quick Preview */}
          <button
            type="button"
            onClick={() => {
              setPreviewChat(contextMenu.chat);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <Eye className="w-4 h-4 text-[#707579] dark:text-[#9aa7b5]" />
            <span className="font-medium">快速预览</span>
          </button>

          {/* Mark as Unread / Read */}
          <button
            type="button"
            onClick={() => {
              onToggleMarkUnread?.(contextMenu.chat.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <MessageSquare className="w-4 h-4 text-[#707579] dark:text-[#9aa7b5]" />
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
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <Pin className={`w-4 h-4 ${contextMenu.chat.isPinned ? 'fill-current text-[#2ba0ff]' : 'text-[#707579] dark:text-[#9aa7b5]'}`} />
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
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            {contextMenu.chat.isMuted ? (
              <>
                <Bell className="w-4 h-4 text-[#2ba0ff]" />
                <span className="font-medium">开启声音提醒</span>
              </>
            ) : (
              <>
                <BellOff className="w-4 h-4 text-[#707579] dark:text-[#9aa7b5]" />
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
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            {contextMenu.chat.isArchived ? (
              <>
                <ArchiveRestore className="w-4 h-4 text-[#2ba0ff]" />
                <span className="font-medium">移出归档</span>
              </>
            ) : (
              <>
                <Archive className="w-4 h-4 text-[#707579] dark:text-[#9aa7b5]" />
                <span className="font-medium">归档对话</span>
              </>
            )}
          </button>

          <div className="h-px bg-[#e0e4e8] dark:bg-[#2d3a4b] my-1" />

          {/* Delete Chat (Red) */}
          <button
            type="button"
            onClick={() => {
              setRevokeDeleteChat(false);
              setChatToDelete(contextMenu.chat);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-red-500/10 text-red-500 transition-colors text-left cursor-pointer font-medium"
          >
            <Trash2 className="w-4 h-4" />
            <span>{contextMenu.chat.isGroup || contextMenu.chat.isChannel ? '退出并删除对话' : '删除对话'}</span>
          </button>
        </div>
      )}

      {/* 6. Quick Preview Modal */}
      {previewChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
          <div className="bg-white dark:bg-[#17212b] border border-[#e0e4e8] dark:border-[#202b36] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-sm overflow-hidden shrink-0"
                  style={{ backgroundColor: previewChat.avatarBg }}
                >
                  {previewChat.avatarUrl ? (
                    <img src={previewChat.avatarUrl} alt={previewChat.title} className="w-full h-full object-cover" />
                  ) : (
                    <span>{previewChat.avatarInitial}</span>
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-sm text-[#111827] dark:text-[#f5f7fa]">{previewChat.title}</h4>
                  <p className="text-xs text-[#2481cc] dark:text-[#2ba0ff]">{previewChat.username || '活跃联系人'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewChat(null)}
                className="p-1 rounded-lg text-[#707579] hover:text-[#111827] dark:text-[#7f93a5] dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-[#f0f2f5] dark:bg-[#202b36] rounded-xl text-xs mb-4">
              <span className="text-[#707579] dark:text-[#7f93a5] block mb-1 font-semibold">最新消息:</span>
              <p className="text-[#111827] dark:text-[#f5f7fa]">{previewChat.lastMessage}</p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPreviewChat(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-[#707579] dark:text-[#7f93a5] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectChat(previewChat.id);
                  setPreviewChat(null);
                }}
                className="px-4 py-1.5 rounded-xl text-xs bg-[#2481cc] hover:bg-[#2074b8] text-white font-medium cursor-pointer"
              >
                进入对话
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Delete Chat Confirmation Modal */}
      {chatToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
          <div className="bg-white dark:bg-[#17212b] border border-[#e0e4e8] dark:border-[#202b36] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-150">
            <h4 className="font-bold text-base text-[#111827] dark:text-[#f5f7fa] mb-2">
              {chatToDelete.isGroup || chatToDelete.isChannel
                ? `退出并删除该${chatToDelete.isChannel ? '频道' : '群组'}？`
                : '删除此对话？'}
            </h4>
            <p className="text-xs text-[#707579] dark:text-[#7f93a5] leading-relaxed mb-4">
              {chatToDelete.isGroup || chatToDelete.isChannel
                ? <>确定要退出并移除 <span className="font-semibold text-[#111827] dark:text-[#f5f7fa]">「{chatToDelete.title}」</span> 的会话记录吗？此操作无法撤销。</>
                : <>确定要删除与 <span className="font-semibold text-[#111827] dark:text-[#f5f7fa]">「{chatToDelete.title}」</span> 的全部聊天记录吗？此操作无法撤销。</>}
            </p>
            {!chatToDelete.isGroup && !chatToDelete.isChannel && chatToDelete.id.startsWith('tg_') && (
              <label className="flex items-start gap-2.5 p-2.5 mb-4 rounded-xl bg-black/5 dark:bg-[#202b36] cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={revokeDeleteChat}
                  onChange={(e) => setRevokeDeleteChat(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 text-[#2481cc] focus:ring-[#2481cc]"
                />
                <span className="text-[#111827] dark:text-[#eef4fb] leading-snug">
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
                className="px-4 py-2 rounded-xl text-xs text-[#707579] dark:text-[#7f93a5] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
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
                className="px-4 py-2 rounded-xl text-xs bg-red-500 hover:bg-red-600 text-white font-semibold cursor-pointer shadow-xs"
              >
                {chatToDelete.isGroup || chatToDelete.isChannel ? '确认退出并删除' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
