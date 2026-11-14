import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Chat, Message, TelegramChatFullInfo } from '../types';
import { fetchTelegramChatFullInfoApi } from '../services/apiService';

interface TelegramChatInfoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat | null;
  accountId?: string;
  messages: Message[];
  onToggleMute?: (chatId: string) => void | Promise<any>;
  onClearHistory?: (chatId: string) => void | Promise<{ ok: boolean; error?: string } | void>;
  onTogglePin?: (chatId: string) => void | Promise<any>;
  onUpdateTitle?: (chatId: string, newTitle: string) => void | Promise<{ ok: boolean; error?: string } | void>;
  onChatInfoUpdated?: (chatId: string, patch: Partial<Chat>) => void;
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
}) => {
  const [activeTab, setActiveTab] = useState<'media' | 'files' | 'voice' | 'links' | 'members'>('media');
  const [isEditingRemark, setIsEditingRemark] = useState(false);
  const [remarkText, setRemarkText] = useState(chat?.title || '');
  const [isSavingRemark, setIsSavingRemark] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [fullInfo, setFullInfo] = useState<TelegramChatFullInfo | null>(null);
  const [isLoadingFullInfo, setIsLoadingFullInfo] = useState(false);
  const [fullInfoError, setFullInfoError] = useState<string | null>(null);

  useEffect(() => {
    if (chat?.title) {
      setRemarkText(chat.title);
      setIsEditingRemark(false);
      setActionError(null);
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
      ...(typeof info.memberCount === 'number' ? { memberCount: info.memberCount } : {}),
      ...(typeof info.onlineCount === 'number' ? { onlineCount: info.onlineCount } : {}),
      ...(typeof info.isOnline === 'boolean' ? { isOnline: info.isOnline } : {}),
      ...(info.statusText ? { statusText: info.statusText } : {}),
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
    if (chat.id.startsWith('tg_')) {
      void loadFullInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, chat?.id, accountId]);

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

  const mediaMessages = messages.filter((m) => m.isImage || m.imageUrl);
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
                  src={chat.avatarUrl}
                  alt={chat.title}
                  className="w-full h-full object-cover absolute inset-0"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
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
            {(fullInfo?.username || chat.username || fullInfo?.description || chat.description || fullInfo?.inviteLink || chat.inviteLink) && (
              <div className="mt-2.5 w-full text-center space-y-1">
                {(fullInfo?.username || chat.username) && (
                  <div className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] font-medium">
                    {fullInfo?.username || chat.username}
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

          {/* Quick Actions (Remark, Mute, Pin) */}
          <div className="p-3 border-b border-[#e0e4e8] dark:border-[#0e1621] space-y-1">
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
                    {mediaMessages.map((m) => (
                      <div key={m.id} className="aspect-square rounded-lg overflow-hidden bg-black/10 dark:bg-white/10 relative group">
                        <img src={m.imageUrl} alt="media" className="w-full h-full object-cover" />
                      </div>
                    ))}
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
                  fileMessages.map((m) => (
                    <div key={m.id} className="p-2.5 rounded-xl bg-gray-50 dark:bg-[#202b36] flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-5 h-5 text-[#2481cc] shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{m.fileName || '文档附件'}</div>
                          <div className="text-[10px] text-[#707579] dark:text-[#7f93a5]">{m.fileSize || '128 KB'} · {m.timestamp}</div>
                        </div>
                      </div>
                      <a href={m.fileUrl || '#'} download className="p-1.5 text-[#2481cc] hover:bg-[#2481cc]/10 rounded-lg">
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                  ))
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
                        <span>语音消息 ({m.audioDuration ? `${m.audioDuration}"` : '0:04'})</span>
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
                              src={member.avatarUrl}
                              alt={member.name}
                              className="w-full h-full object-cover absolute inset-0"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
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
          <div className="p-4 border-t border-[#e0e4e8] dark:border-[#0e1621] mt-4 space-y-2">
            {actionError && !isEditingRemark && (
              <p className="text-[11px] text-rose-500 text-center leading-snug">{actionError}</p>
            )}
            <button
              disabled={isClearingHistory}
              onClick={async () => {
                if (confirm(`确定要清空与【${chat.title}】的所有云端与本地聊天记录吗？`)) {
                  setActionError(null);
                  setIsClearingHistory(true);
                  try {
                    const res = await onClearHistory?.(chat.id);
                    if (res && typeof res === 'object' && res.ok === false) {
                      setActionError(res.error || '清空聊天记录失败');
                      return;
                    }
                    onClose();
                  } finally {
                    setIsClearingHistory(false);
                  }
                }
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 text-red-500 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>{isClearingHistory ? '正在同步清空...' : '清空聊天记录'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
