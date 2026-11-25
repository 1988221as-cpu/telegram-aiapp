import React from 'react';
import {
  Check,
  CheckCheck,
  CheckSquare,
  Copy,
  Download,
  Edit2,
  FileText,
  Forward,
  Languages,
  Maximize2,
  Pause,
  Phone,
  Pin,
  Play,
  Reply,
  RotateCw,
  ShieldAlert,
  Square,
  Trash2,
  UserMinus,
  UserPlus,
  Video,
} from 'lucide-react';
import { Message } from '../types';
import { isSignedResourceUrlExpiringSoon } from '../services/apiService';
import { sanitizeSafeResourceUrl } from '../services/urlSafety';

export interface ChatMessageFontClasses {
  composer: string;
  body: string;
  secondary: string;
  translation: string;
  replySender: string;
  replyBody: string;
}

export interface ChatMessageItemActions {
  toggleSelectMessage: (msgId: string) => void;
  handleMessageContextMenu: (e: React.MouseEvent, msg: Message) => void;
  handleOpenForwardModal: (msgs: Message[]) => void;
  copyImageToClipboard: (imageUrl: string, msgId: string) => void;
  copyToClipboard: (text: string, id: string) => void;
  handleOpenGroupMemberProfile: (member: { senderId?: string; name?: string; avatarUrl?: string }) => void | Promise<void>;
  openImageGalleryLightbox: (targetMsg: Message, seedList?: Message[]) => void;
  triggerSilentUrlRefresh: (rawUrl?: string, force?: boolean) => Promise<string | null>;
  handlePlayAudio: (msgId: string, audioUrl?: string) => void | Promise<void>;
  handleTranscribeAudio: (msg: Message) => void | Promise<void>;
  renderMessageTextWithLinks: (text: string, isMe: boolean) => React.ReactNode;
  handleOpenReadReceipts: (msg: Message) => void | Promise<void>;
  onToggleReaction?: (messageId: string, emoji: string) => void | Promise<any>;
  onTogglePinMessage?: (messageId: string) => void | Promise<any>;
  onRetryMessage?: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  onResumePausedMessage?: (messageId: string) => void | Promise<void>;
  onDiscardPausedMessage?: (messageId: string) => void | Promise<void>;
  onDeleteMessage?: (messageId: string, options?: { revoke?: boolean }) => void | Promise<{ ok: boolean; error?: string } | void>;
  handleTelegramBubbleImageError: (msgId: string, rawImageUrl?: string, loadedSrc?: string) => Promise<void>;
  resolveDisplayUrl: (rawUrl?: string) => string | undefined;
  appendThumbQueryIfTelegramMedia: (rawUrl?: string) => string | undefined;
  triggerManualTranslate: (msg: Message) => Promise<void>;
  onPromptDeleteMessage: (msg: Message) => void;
  onStartReply: (msg: Message) => void;
  onStartEditMessage: (msg: Message) => void;
  onClearHoveredMenu: () => void;
  onMarkAvatarFailed: (url: string) => void;
  onOpenVideoLightbox: (payload: {
    type: 'video';
    url: string;
    rawUrl?: string;
    caption?: string;
    msgId: string;
  }) => void;
  onToggleShowOriginal: (msgId: string) => void;
  onRetrySendMessage: (msgId: string) => Promise<void>;
}

export const TG_SENDER_NAME_COLORS = [
  'text-[#e17076] dark:text-[#ff8a8f] aurora:text-[#fda4af]',
  'text-[#eda86c] dark:text-[#ffb870] aurora:text-[#fdba74]',
  'text-[#a695e7] dark:text-[#b6a6ff] aurora:text-[#c4b5fd]',
  'text-[#7bc862] dark:text-[#86e06b] aurora:text-[#86efac]',
  'text-[#65aadd] dark:text-[#64b5f6] aurora:text-[#67e8f9]',
  'text-[#ee7aae] dark:text-[#f48fb1] aurora:text-[#f9a8d4]',
];

export const TG_SENDER_AVATAR_BGS = [
  'from-[#ff516a] to-[#ff885e]',
  'from-[#ffa85c] to-[#ffcd6a]',
  'from-[#8b6ff5] to-[#b594ff]',
  'from-[#54cb68] to-[#7be078]',
  'from-[#2a9ef1] to-[#5ec0ff]',
  'from-[#e5599d] to-[#f489bd]',
];

const LEGACY_PLACEHOLDER_SENDER_NAMES = new Set(['客户', '对方', '我方', 'Telegram 联系人']);

export function isSystemMediaPlaceholder(text?: string | null, msg?: Partial<Message>): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return true;

  if (
    /^\[(语音|图片|照片|视频|文件|多媒体|贴纸)(?:消息)?\]$/i.test(trimmed) ||
    /^\[(照片|视频)\]\s+.*$/i.test(trimmed) ||
    /^\[贴纸\]$/i.test(trimmed) ||
    /^Voice Message$/i.test(trimmed) ||
    /^(?:🎤\s*语音消息|🎥\s*视频消息|🎬\s*(?:视频消息|视频|\[视频\])|🖼️\s*(?:图片消息|图片|\[图片\]|贴纸)|📎\s*(?:文件附件|文件|媒体消息)|📍\s*位置信息|👤\s*联系人名片(?:\s*[:：].*)?|📊\s*投票|🔗\s*网页链接|暂无消息)$/.test(
      trimmed
    ) ||
    /^🎵\s*音频(?:\s*[:：].*)?$/.test(trimmed) ||
    /^📁\s*\[文件\](?:\s+.*)?$/.test(trimmed) ||
    /^(?:📞|📹|📵)\s*(?:语音通话|视频通话|未接语音来电|未接视频来电)/.test(trimmed) ||
    /^[^\p{L}\d]*\[贴纸\]$/u.test(trimmed)
  ) {
    return true;
  }

  if (msg?.isCall) return true;
  if (msg?.isFile && /^(📎|📁)\s+/.test(trimmed)) return true;
  if (msg?.isAudio && /^(🎤|🎵)\s+/.test(trimmed)) return true;
  if (msg?.isVideo && /^(🎬|🎥)\s+/.test(trimmed)) return true;
  if (msg?.isImage && /^🖼️\s+/.test(trimmed)) return true;

  return false;
}

export function buildSafeMediaDownloadName(
  caption: string | undefined,
  fallbackPrefix: string,
  fallbackExt: string
): string {
  const cleaned = (caption || '')
    .replace(/[\r\n/\\:*?"<>|]+/g, '_')
    .trim()
    .slice(0, 64);
  if (!cleaned) {
    return `${fallbackPrefix}_${Date.now()}.${fallbackExt}`;
  }
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.${fallbackExt}`;
}

export function getMessageDayKey(msg: Message): string {
  if (typeof msg.createdAt === 'number' && Number.isFinite(msg.createdAt) && msg.createdAt > 0) {
    const d = new Date(msg.createdAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return 'today';
}

export function formatMessageDayLabel(dayKey: string): string {
  if (dayKey === 'today') return '今天';
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (dayKey === todayKey) return '今天';
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestKey = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
  if (dayKey === yestKey) return '昨天';
  const dayBefore = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
  const dayBeforeKey = `${dayBefore.getFullYear()}-${String(dayBefore.getMonth() + 1).padStart(2, '0')}-${String(dayBefore.getDate()).padStart(2, '0')}`;
  if (dayKey === dayBeforeKey) return '前天';
  const [yStr, mStr, dStr] = dayKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (y === now.getFullYear()) return `${m}月${d}日`;
  return `${y}年${m}月${d}日`;
}

export function normalizeGroupMemberDisplayName(name?: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || LEGACY_PLACEHOLDER_SENDER_NAMES.has(trimmed)) return '';
  return trimmed;
}

export function getTelegramSenderColorIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % TG_SENDER_NAME_COLORS.length;
}

export function getSenderAvatarInitial(name?: string, senderId?: string): string {
  const clean = normalizeGroupMemberDisplayName(name);
  if (clean) {
    const ch = Array.from(clean)[0] || '';
    return ch.toUpperCase();
  }
  if (senderId) {
    const digits = senderId.replace(/^-/, '');
    if (digits) return digits[0];
  }
  return '•';
}

export interface ChatMessageItemProps {
  msg: Message;
  idx: number;
  prevDayKey: string | null;
  prevSenderKey: string;
  nextSenderKey: string;
  nextDayKey: string | null;
  chatId: string;
  isGroup: boolean;
  isChannel: boolean;
  currentAccountId?: string;
  isReadByPeer: boolean;
  isMultiSelectMode: boolean;
  isSelectedMulti: boolean;
  isHoveredMenuOpen: boolean;
  isHighlighted: boolean;
  isCopiedMain: boolean;
  isCopiedTranslation: boolean;
  isPlayingAudio: boolean;
  audioProgressPercent: number;
  isTranscribing: boolean;
  isRetrying: boolean;
  mediaRetryNonce: number;
  isShowingOriginalOverlay: boolean;
  resolvedAvatarUrl: string;
  isAvatarFailed: boolean;
  resolvedMediaHref?: string;
  chatFontClasses: ChatMessageFontClasses;
  isChatTransEnabled: boolean;
  showOriginalAndTranslationPref: boolean;
  hasRetranslateHandler: boolean;
  hasDeleteHandler: boolean;
  actionsRef: React.MutableRefObject<ChatMessageItemActions>;
}

const ChatMessageItemInner: React.FC<ChatMessageItemProps> = ({
  msg,
  idx,
  prevDayKey,
  prevSenderKey,
  nextSenderKey,
  nextDayKey,
  chatId,
  isGroup,
  isChannel,
  currentAccountId,
  isReadByPeer,
  isMultiSelectMode,
  isSelectedMulti,
  isHoveredMenuOpen,
  isHighlighted,
  isCopiedMain,
  isCopiedTranslation,
  isPlayingAudio,
  audioProgressPercent,
  isTranscribing,
  isRetrying,
  mediaRetryNonce,
  isShowingOriginalOverlay,
  resolvedAvatarUrl,
  isAvatarFailed,
  resolvedMediaHref,
  chatFontClasses,
  isChatTransEnabled,
  showOriginalAndTranslationPref,
  hasRetranslateHandler,
  hasDeleteHandler,
  actionsRef,
}) => {
  const isMe = msg.sender === 'me';
  const isSystemNotice = msg.sender === 'system';
  const isGroupPeer = Boolean(isGroup && !isMe && !isSystemNotice);
  const dayKey = getMessageDayKey(msg);
  const showDayDivider = idx === 0 || dayKey !== prevDayKey;

  const cleanSenderName = normalizeGroupMemberDisplayName(msg.senderName);
  const senderGroupKey = isGroupPeer ? msg.senderId || cleanSenderName || `msg_${msg.id}` : '';
  const isSameSenderAsPrev = Boolean(
    isGroupPeer && senderGroupKey && prevDayKey === dayKey && senderGroupKey === prevSenderKey
  );
  const isSameSenderAsNext = Boolean(
    isGroupPeer && senderGroupKey && nextDayKey === dayKey && senderGroupKey === nextSenderKey
  );
  const showGroupSenderName = isGroupPeer && !isSameSenderAsPrev && Boolean(cleanSenderName);
  const showGroupSenderAvatar = isGroupPeer && !isSameSenderAsNext;
  const senderColorIdx = getTelegramSenderColorIndex(msg.senderId || cleanSenderName || msg.id);
  const showAvatarImage = Boolean(resolvedAvatarUrl && !isAvatarFailed);
  const hasMediaBubble = Boolean((msg.isImage && msg.imageUrl) || (msg.isVideo && msg.videoUrl));
  const hasVisibleMediaCaption = Boolean(
    msg.text?.trim() &&
      !isSystemMediaPlaceholder(msg.text, msg) &&
      !/\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|mp4|mov|webm|mkv|avi|m4v)$/i.test(msg.text.trim())
  );
  const hasInlineMediaFooterContent = Boolean(
    hasVisibleMediaCaption ||
      msg.isTranslating ||
      msg.translatedText ||
      msg.translationError ||
      (msg.reactions && Object.keys(msg.reactions).length > 0) ||
      msg.deliveryStatus === 'failed' ||
      msg.deliveryStatus === 'paused'
  );
  const hasOverlayImageTimestamp = Boolean(
    msg.isImage && msg.imageUrl && resolvedMediaHref && !hasInlineMediaFooterContent
  );

  if (isSystemNotice) {
    const isLeaveEvent = msg.systemEventType === 'leave' || /退出了群组|移出了群组/.test(msg.text || '');
    const isJoinEvent = msg.systemEventType === 'join' || /加入了群组/.test(msg.text || '');
    return (
      <div className="hs-msg-item">
        {showDayDivider && (
          <div className="flex items-center justify-center my-1">
            <span className="px-3 py-0.5 rounded-full bg-white/90 dark:bg-[#0e1726]/80 aurora:bg-[#101c23]/85 linen:bg-[#f6efe2]/95 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#1c323c] linen:border-[#cbbba2] text-[11px] font-medium text-[#64748b] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#5c4a38] shadow-xs">
              {formatMessageDayLabel(dayKey)}
            </span>
          </div>
        )}
        <div
          data-msg-id={msg.id}
          data-system-event={msg.systemEventType || (isLeaveEvent ? 'leave' : isJoinEvent ? 'join' : 'service')}
          onClick={isMultiSelectMode ? () => actionsRef.current.toggleSelectMessage(msg.id) : undefined}
          className={`w-full flex items-center justify-center my-1.5 px-2 ${isMultiSelectMode ? 'cursor-pointer' : ''}`}
        >
          <div
            className={`group/sys inline-flex items-center gap-1.5 max-w-[88%] px-3 py-1 rounded-full text-[11.5px] leading-snug border shadow-xs transition-colors ${
              isSelectedMulti
                ? 'bg-[#2481cc]/15 dark:bg-[#2ba0ff]/20 aurora:bg-[#14b8a6]/20 linen:bg-[#a86a43]/20 border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]'
                : 'bg-white/90 dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#f6efe2]/95 border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#5c4a38]'
            }`}
          >
            {isMultiSelectMode && (
              <span className="shrink-0">
                {isSelectedMulti ? (
                  <CheckSquare className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
                ) : (
                  <Square className="w-3.5 h-3.5 opacity-60" />
                )}
              </span>
            )}
            {isLeaveEvent ? (
              <UserMinus className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400 aurora:text-amber-300 linen:text-[#a64234]" />
            ) : (
              <UserPlus className="w-3.5 h-3.5 shrink-0 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d]" />
            )}
            <span className="truncate">{(msg.text || '').replace(/^(?:👤|🚪)\s*/, '')}</span>
            {msg.timestamp && (
              <span className="text-[10px] opacity-65 tabular-nums shrink-0">{msg.timestamp}</span>
            )}
            {!isMultiSelectMode && hasDeleteHandler && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  actionsRef.current.onPromptDeleteMessage(msg);
                }}
                aria-label={`删除群提示: ${msg.text}`}
                title="删除此条入/退群提示"
                className="ml-0.5 p-1 rounded-full text-rose-500/80 hover:text-rose-600 dark:text-rose-400/85 dark:hover:text-rose-300 hover:bg-rose-500/12 transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={isHoveredMenuOpen ? 'hs-msg-item hs-msg-item-active' : 'hs-msg-item'}>
      {showDayDivider && (
        <div className="flex items-center justify-center my-1">
          <span className="px-3 py-0.5 rounded-full bg-white/90 dark:bg-[#0e1726]/80 aurora:bg-[#101c23]/85 linen:bg-[#f6efe2]/95 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#1c323c] linen:border-[#cbbba2] text-[11px] font-medium text-[#64748b] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#5c4a38] shadow-xs">
            {formatMessageDayLabel(dayKey)}
          </span>
        </div>
      )}

      {/* [用户锁定规则 - 禁止添加 onMouseEnter/onMouseLeave] 看消息（鼠标移入）绝不自动弹出快捷操作栏，仅支持同一条消息右按两次弹出 */}
      <div
        data-msg-id={msg.id}
        onClick={isMultiSelectMode ? () => actionsRef.current.toggleSelectMessage(msg.id) : undefined}
        className={`w-full min-w-0 flex ${isMultiSelectMode ? 'items-center gap-2.5 cursor-pointer rounded-xl px-1.5 py-0.5 transition-colors ' + (isSelectedMulti ? 'bg-[#2481cc]/10 dark:bg-[#2ba0ff]/15 aurora:bg-[#14b8a6]/15 linen:bg-[#a86a43]/15' : 'hover:bg-black/5 dark:hover:bg-white/5 aurora:hover:bg-white/5') : 'flex-col'} ${
          isMe ? (isMultiSelectMode ? 'justify-end' : 'items-end') : (isMultiSelectMode ? 'justify-start' : 'items-start')
        } group relative ${isHoveredMenuOpen ? 'z-30' : ''} ${isSameSenderAsPrev ? 'mt-0.5' : 'mt-1'} ${isSameSenderAsNext ? 'mb-0.5' : 'mb-1'}`}
        onContextMenu={(e) => {
          if (!isMultiSelectMode) actionsRef.current.handleMessageContextMenu(e, msg);
        }}
      >
        {isMultiSelectMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              actionsRef.current.toggleSelectMessage(msg.id);
            }}
            className={`shrink-0 p-1 rounded-lg transition-colors cursor-pointer ${
              isSelectedMulti
                ? 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]'
                : 'text-[#94a3b8] dark:text-[#64748b] aurora:text-[#5a7782] linen:text-[#8f7e6c]'
            }`}
          >
            {isSelectedMulti ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          </button>
        )}

        {/* Telegram Floating Quick Action Menu — [LOCKED: Double Right-Click Only, DO NOT switch back to hover] */}
        {!isMultiSelectMode && isHoveredMenuOpen && (
          <div
            className={`absolute ${idx === 0 ? 'top-1' : '-top-4'} z-40 max-w-full overflow-x-auto no-scrollbar flex items-center gap-0.5 bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#faf5ec] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-full px-1.5 py-0.5 shadow-lg animate-in fade-in zoom-in-95 duration-100 ${
              isMe ? 'right-2' : isGroupPeer ? 'left-10' : 'left-2'
            }`}
          >
            {/* Quick Reactions Bar */}
            <div className="flex items-center gap-0.5 pr-1 border-r border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
              {['👍', '❤️', '🔥', '🎉'].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => actionsRef.current.onToggleReaction?.(msg.id, emoji)}
                  className="text-xs hover:scale-130 transition-transform p-0.5 cursor-pointer leading-none"
                  title={`回应 ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Reply Button */}
            <button
              type="button"
              onClick={() => actionsRef.current.onStartReply(msg)}
              className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#7a6957] linen:hover:text-[#a86a43] cursor-pointer"
              title="回复消息"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>

            {/* Forward Button */}
            <button
              type="button"
              onClick={() => actionsRef.current.handleOpenForwardModal([msg])}
              className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#7a6957] linen:hover:text-[#a86a43] cursor-pointer"
              title="转发消息"
            >
              <Forward className="w-3.5 h-3.5" />
            </button>

            {/* Manual Translate / Retranslate Button */}
            {hasRetranslateHandler &&
              !msg.isCall &&
              (!msg.isAudio || msg.sttText) &&
              Boolean((msg.sttText || msg.text || msg.imageCaption || '').trim()) && (
              <button
                type="button"
                disabled={Boolean(msg.isTranslating)}
                onClick={() => void actionsRef.current.triggerManualTranslate(msg)}
                className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#7a6957] linen:hover:text-[#a86a43] cursor-pointer disabled:opacity-50"
                title={msg.translatedText ? '重新翻译' : '翻译此消息'}
              >
                {msg.isTranslating ? (
                  <RotateCw className="w-3.5 h-3.5 animate-spin text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43]" />
                ) : (
                  <Languages className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            {/* Pin Button */}
            <button
              type="button"
              onClick={() => actionsRef.current.onTogglePinMessage?.(msg.id)}
              className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#7a6957] linen:hover:text-[#a86a43] cursor-pointer"
              title={msg.isPinned ? '取消置顶' : '置顶此消息'}
            >
              <Pin className={`w-3.5 h-3.5 ${msg.isPinned ? 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43] fill-current' : ''}`} />
            </button>

            {/* Edit Button (For delivered non-audio sent messages) */}
            {isMe &&
              !msg.isAudio &&
              !msg.isCall &&
              msg.deliveryStatus !== 'failed' &&
              msg.deliveryStatus !== 'pending' &&
              msg.deliveryStatus !== 'paused' &&
              (!chatId.startsWith('tg_') || typeof msg.telegramMessageId === 'number') && (
              <button
                type="button"
                onClick={() => actionsRef.current.onStartEditMessage(msg)}
                className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#7a6957] linen:hover:text-[#a86a43] cursor-pointer"
                title="编辑消息"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Copy Text or Copy Image */}
            <button
              type="button"
              onClick={() => {
                if (msg.isImage && msg.imageUrl) {
                  actionsRef.current.copyImageToClipboard(msg.imageUrl, msg.id);
                } else {
                  actionsRef.current.copyToClipboard(msg.text, msg.id);
                }
              }}
              className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#7a6957] linen:hover:text-[#a86a43] cursor-pointer"
              title={msg.isImage ? '复制照片到剪贴板' : '复制消息内容'}
            >
              {isCopiedMain ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Delete Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                actionsRef.current.onClearHoveredMenu();
                actionsRef.current.onPromptDeleteMessage(msg);
              }}
              className="p-1 text-[#64748b] hover:text-rose-500 dark:text-[#7b93ad] dark:hover:text-rose-400 aurora:text-[#7e9aa5] aurora:hover:text-rose-400 cursor-pointer"
              title="删除消息"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className={isGroupPeer ? 'flex items-end gap-2 max-w-[86%] sm:max-w-[78%] min-w-0' : 'contents'}>
          {isGroupPeer && (
            showGroupSenderAvatar ? (
              <div
                onClick={() => {
                  if (!isMultiSelectMode && msg.senderId) {
                    void actionsRef.current.handleOpenGroupMemberProfile({
                      senderId: msg.senderId,
                      name: cleanSenderName || msg.senderName,
                      avatarUrl: msg.senderAvatarUrl,
                    });
                  }
                }}
                className={`w-8 h-8 rounded-full shrink-0 overflow-hidden select-none shadow-xs ${
                  !isMultiSelectMode && msg.senderId
                    ? 'cursor-pointer hover:ring-2 hover:ring-[#2481cc]/50 dark:hover:ring-[#2ba0ff]/60 aurora:hover:ring-[#2dd4bf]/60 transition-shadow'
                    : ''
                }`}
                title={!isMultiSelectMode && msg.senderId ? '点击查看成员个人资料' : undefined}
              >
                {showAvatarImage ? (
                  <img
                    src={resolvedAvatarUrl}
                    alt={cleanSenderName || ''}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                    onError={() => {
                      actionsRef.current.onMarkAvatarFailed(resolvedAvatarUrl);
                    }}
                  />
                ) : (
                  <div
                    className={`w-full h-full bg-gradient-to-br ${TG_SENDER_AVATAR_BGS[senderColorIdx]} flex items-center justify-center text-white text-[13px] font-semibold`}
                  >
                    {getSenderAvatarInitial(cleanSenderName, msg.senderId)}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-8 shrink-0" />
            )
          )}

          <div
            className={`${isGroupPeer ? 'min-w-0 max-w-full' : 'min-w-0 max-w-[84%] sm:max-w-[78%]'} hs-msg-bubble rounded-xl ${
              hasMediaBubble ? 'p-1' : 'py-1.5 px-2.5'
            } relative transition-colors select-text ${
              isHighlighted ? 'ring-2 ring-amber-400 shadow-lg' : ''
            } ${
              isMe
                ? 'hs-bubble-out bg-[#1e88e5] text-white dark:bg-[#1b4975] dark:text-white aurora:bg-[#11434d] aurora:border aurora:border-[#2dd4bf]/25 linen:bg-[#3a6652] linen:text-white linen:border linen:border-[#2d5241] rounded-br-xs shadow-[0_1px_3px_rgba(30,136,229,0.22)] linen:shadow-[0_1px_4px_rgba(43,33,24,0.16)]'
                : 'bg-white text-[#0f172a] border border-[#e2e8f0] dark:bg-[#101b2a] dark:text-[#eef4fb] dark:border-[#1a2b40] aurora:bg-[#101c23] aurora:text-[#ecf6f8] aurora:border-[#1c323c] linen:bg-[#faf6ee] linen:text-[#2b2118] linen:border-[#d5c6b0] rounded-bl-xs shadow-[0_1px_2px_rgba(15,23,42,0.04)] linen:shadow-[0_1px_3px_rgba(43,33,24,0.08)]'
            }`}
          >
            {/* Official Telegram Group Member Name */}
            {showGroupSenderName && (
              <div
                onClick={() => {
                  if (!isMultiSelectMode && msg.senderId) {
                    void actionsRef.current.handleOpenGroupMemberProfile({
                      senderId: msg.senderId,
                      name: cleanSenderName || msg.senderName,
                      avatarUrl: msg.senderAvatarUrl,
                    });
                  }
                }}
                className={`mb-1 ${hasMediaBubble ? 'px-1.5 pt-0.5' : ''} text-[12px] font-semibold leading-tight truncate select-none ${TG_SENDER_NAME_COLORS[senderColorIdx]} ${
                  !isMultiSelectMode && msg.senderId ? 'cursor-pointer hover:underline' : ''
                }`}
                title={!isMultiSelectMode && msg.senderId ? '点击查看成员个人资料' : undefined}
              >
                {cleanSenderName}
              </div>
            )}

            {/* Forwarded Label */}
            {msg.forwardFrom && (
              <div
                className={`mb-1 ${hasMediaBubble ? 'px-1.5 pt-0.5' : ''} flex items-center gap-1 text-[10.5px] font-medium ${
                  isMe ? 'text-white/85' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d]'
                }`}
              >
                <Forward className="w-3 h-3 shrink-0" />
                <span className="truncate">转发自 {msg.forwardFrom}</span>
              </div>
            )}

            {/* Telegram Reply Quote Header */}
            {msg.replyTo && (
              <div
                className={`mb-2 pl-2.5 py-1 border-l-2 rounded-r ${chatFontClasses.replySender} select-none ${
                  isMe
                    ? 'border-white/70 bg-white/12 text-white'
                    : 'border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] bg-[#f8fafc] dark:bg-white/5 aurora:bg-[#081014]/60 linen:bg-[#f2e9da] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]'
                }`}
              >
                <div
                  className={`font-semibold truncate ${
                    isMe ? 'text-white' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d]'
                  }`}
                >
                  {msg.replyTo.senderName || '回复消息'}
                </div>
                <div className={`opacity-85 truncate ${chatFontClasses.replyBody}`}>{msg.replyTo.text}</div>
              </div>
            )}

            {/* Image / Sticker Attachment with Copy and Download Overlay */}
            {msg.isImage && msg.imageUrl && resolvedMediaHref && (() => {
              const safeImageHref = resolvedMediaHref;
              const baseBubbleThumbHref =
                actionsRef.current.appendThumbQueryIfTelegramMedia(safeImageHref) || safeImageHref;
              const bubbleThumbSrc =
                mediaRetryNonce > 0
                  ? `${baseBubbleThumbHref}${baseBubbleThumbHref.includes('?') ? '&' : '?'}_r=${mediaRetryNonce}`
                  : baseBubbleThumbHref;
              const hasVisibleImageCaption = Boolean(
                msg.text?.trim() &&
                  !isSystemMediaPlaceholder(msg.text, msg) &&
                  !/\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/i.test(msg.text.trim())
              );
              return (
                <div className={`${hasVisibleImageCaption ? 'mb-1.5' : ''} rounded-xl overflow-hidden w-full max-w-[280px] min-h-[112px] bg-black/5 dark:bg-white/5 shadow-xs relative group/img select-none`}>
                  <img
                    src={bubbleThumbSrc}
                    alt={msg.imageCaption || 'image'}
                    loading="lazy"
                    decoding="async"
                    title="双击全屏查看大图"
                    onDoubleClick={(e) => {
                      if (isMultiSelectMode) return;
                      e.preventDefault();
                      e.stopPropagation();
                      actionsRef.current.openImageGalleryLightbox(msg);
                    }}
                    className="w-full h-auto object-cover max-h-72 cursor-pointer hover:opacity-95 transition-opacity rounded-[9px]"
                    onLoad={(e) => {
                      e.currentTarget.style.display = '';
                    }}
                    onError={() => {
                      void actionsRef.current.handleTelegramBubbleImageError(msg.id, msg.imageUrl, bubbleThumbSrc);
                    }}
                  />
                  {/* Hover actions for image: Zoom, Copy Image and Download Image */}
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/75 rounded-lg p-1 text-white shadow-md">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        actionsRef.current.openImageGalleryLightbox(msg);
                      }}
                      title="全屏查看大图"
                      className="p-1 hover:bg-white/20 rounded-md cursor-pointer transition-colors"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        actionsRef.current.copyImageToClipboard(safeImageHref, msg.id);
                      }}
                      title="复制照片到剪贴板"
                      className="p-1 hover:bg-white/20 rounded-md cursor-pointer transition-colors"
                    >
                      {isCopiedMain ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <a
                      href={safeImageHref}
                      download={buildSafeMediaDownloadName(msg.imageCaption, 'tg_photo', 'png')}
                      onClick={(e) => {
                        e.stopPropagation();
                        const resolved = actionsRef.current.resolveDisplayUrl(msg.imageUrl);
                        if (!resolved) {
                          e.preventDefault();
                          return;
                        }
                        if (msg.imageUrl && isSignedResourceUrlExpiringSoon(resolved)) {
                          e.preventDefault();
                          void actionsRef.current.triggerSilentUrlRefresh(msg.imageUrl, true).then((nextUrl) => {
                            const safeDownloadHref = sanitizeSafeResourceUrl(nextUrl) || resolved;
                            if (!safeDownloadHref) return;
                            const a = document.createElement('a');
                            a.href = safeDownloadHref;
                            a.download = buildSafeMediaDownloadName(msg.imageCaption, 'tg_photo', 'png');
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          });
                        }
                      }}
                      title="下载保存照片"
                      className="p-1 hover:bg-white/20 rounded-md cursor-pointer transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  {hasOverlayImageTimestamp && (
                    <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-black/65 text-white text-[10px] flex items-center gap-1 pointer-events-none select-none tabular-nums shadow-xs">
                      {msg.isPinned && <Pin className="w-2.5 h-2.5 fill-current text-white/95" />}
                      {msg.isEdited && <span className="text-[9.5px] opacity-90">已编辑</span>}
                      <span>{msg.timestamp}</span>
                      {isMe && (
                        msg.deliveryStatus === 'pending' || msg.deliveryStatus === 'retrying' || isRetrying ? (
                          <RotateCw className="w-2.5 h-2.5 animate-spin text-white/90" />
                        ) : isChannel ? (
                          <CheckCheck className="w-3 h-3 text-white/95" />
                        ) : chatId.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && typeof msg.telegramMessageId === 'number' ? (
                          isReadByPeer ? (
                            <CheckCheck className="w-3 h-3 text-[#7cc4ff]" />
                          ) : (
                            <Check className="w-3 h-3 text-white/85" />
                          )
                        ) : (
                          <CheckCheck className="w-3 h-3 text-white/95" />
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Video Attachment with Inline Player, Duration Badge, and Download */}
            {msg.isVideo && msg.videoUrl && resolvedMediaHref && (() => {
              const safeVideoHref = resolvedMediaHref;
              const hasVisibleVideoCaption = Boolean(
                msg.text?.trim() &&
                  !isSystemMediaPlaceholder(msg.text, msg) &&
                  !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(msg.text.trim())
              );
              return (
                <div
                  className={`${hasVisibleVideoCaption ? 'mb-1.5' : ''} rounded-xl overflow-hidden w-full max-w-[320px] min-h-[160px] shadow-sm relative group/vid bg-black/10 dark:bg-black/40 select-none`}
                  onDoubleClick={(e) => {
                    if (isMultiSelectMode) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const vid = e.currentTarget.querySelector('video');
                    if (vid) vid.pause();
                    if (document.fullscreenElement) {
                      document.exitFullscreen().catch(() => {});
                    }
                    actionsRef.current.onOpenVideoLightbox({
                      type: 'video',
                      url: safeVideoHref,
                      rawUrl: msg.videoUrl,
                      caption: hasVisibleVideoCaption ? msg.text : undefined,
                      msgId: msg.id,
                    });
                  }}
                >
                  <video
                    src={safeVideoHref}
                    controls
                    preload="metadata"
                    className="w-full h-auto max-h-80 object-contain rounded-xl bg-black cursor-pointer"
                    onError={() => {
                      void actionsRef.current.triggerSilentUrlRefresh(msg.videoUrl, true);
                    }}
                  />
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/vid:opacity-100 transition-opacity bg-black/75 rounded-lg p-1 text-white shadow-md z-10">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const vid = e.currentTarget.closest('.group\\/vid')?.querySelector('video');
                        if (vid) vid.pause();
                        actionsRef.current.onOpenVideoLightbox({
                          type: 'video',
                          url: safeVideoHref,
                          rawUrl: msg.videoUrl,
                          caption: hasVisibleVideoCaption ? msg.text : undefined,
                          msgId: msg.id,
                        });
                      }}
                      title="全屏弹出播放"
                      className="p-1 hover:bg-white/20 rounded-md cursor-pointer transition-colors"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <a
                      href={safeVideoHref}
                      download={`tg_video_${Date.now()}.mp4`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const resolved = actionsRef.current.resolveDisplayUrl(msg.videoUrl);
                        if (!resolved) {
                          e.preventDefault();
                          return;
                        }
                        if (msg.videoUrl && isSignedResourceUrlExpiringSoon(resolved)) {
                          e.preventDefault();
                          void actionsRef.current.triggerSilentUrlRefresh(msg.videoUrl, true).then((nextUrl) => {
                            const safeDownloadHref = sanitizeSafeResourceUrl(nextUrl) || resolved;
                            if (!safeDownloadHref) return;
                            const a = document.createElement('a');
                            a.href = safeDownloadHref;
                            a.download = `tg_video_${Date.now()}.mp4`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          });
                        }
                      }}
                      title="下载保存视频"
                      className="p-1 hover:bg-white/20 rounded-md cursor-pointer transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })()}

            {/* File Attachment */}
            {msg.isFile && (
              <div className={`p-2.5 rounded-xl flex items-center justify-between gap-3 ${chatFontClasses.secondary} mb-1.5 ${isMe ? 'bg-white/12' : 'bg-black/5 dark:bg-white/10 aurora:bg-[#15252e] linen:bg-[#f2e8d7]'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className={`w-6 h-6 shrink-0 ${isMe ? 'text-white/90' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]'}`} />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{msg.fileName || '文档附件'}</div>
                    <div className="text-[10px] opacity-70">{msg.fileSize || '128 KB'}</div>
                  </div>
                </div>
                {resolvedMediaHref ? (
                  <a
                    href={resolvedMediaHref}
                    download={msg.fileName || 'file'}
                    onClick={(e) => {
                      const resolved = actionsRef.current.resolveDisplayUrl(msg.fileUrl);
                      if (!resolved) {
                        e.preventDefault();
                        return;
                      }
                      if (msg.fileUrl && isSignedResourceUrlExpiringSoon(resolved)) {
                        e.preventDefault();
                        void actionsRef.current.triggerSilentUrlRefresh(msg.fileUrl, true).then((nextUrl) => {
                          const safeDownloadHref = sanitizeSafeResourceUrl(nextUrl) || resolved;
                          if (!safeDownloadHref) return;
                          const a = document.createElement('a');
                          a.href = safeDownloadHref;
                          a.download = msg.fileName || 'file';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        });
                      }
                    }}
                    className={`p-1.5 rounded-lg cursor-pointer ${isMe ? 'text-white hover:bg-white/15' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43] hover:bg-[#2481cc]/10 aurora:hover:bg-[#14b8a6]/15 linen:hover:bg-[#a86a43]/12'}`}
                    title="下载附件"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                ) : (
                  <span className="text-[10px] opacity-60 px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">
                    未缓存
                  </span>
                )}
              </div>
            )}

            {/* Audio voice note message */}
            {msg.isAudio ? (
              <div className="flex flex-col gap-2 w-full min-w-0 sm:min-w-[220px]">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => void actionsRef.current.handlePlayAudio(msg.id, msg.audioUrl)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-105 shrink-0 ${
                      isMe
                        ? 'bg-white/20 hover:bg-white/30 text-white'
                        : 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43] text-white'
                    }`}
                  >
                    {isPlayingAudio ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>

                  {/* Waveform progress bar */}
                  <div className="flex-1">
                    <div className={`h-1.5 w-full rounded-full overflow-hidden ${isMe ? 'bg-white/25' : 'bg-black/10 dark:bg-white/20 aurora:bg-white/15 linen:bg-[#e5d6be]'}`}>
                      <div
                        className={`h-full transition-all duration-100 ${
                          isMe ? 'bg-white' : 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#2dd4bf] linen:bg-[#a86a43]'
                        }`}
                        style={{ width: `${audioProgressPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] mt-1 opacity-75 tabular-nums">
                      <span>
                        {msg.audioDuration && msg.audioDuration > 0
                          ? `${Math.floor(msg.audioDuration / 60)}:${String(Math.floor(msg.audioDuration % 60)).padStart(2, '0')}`
                          : '--'}
                      </span>
                      {msg.voiceName && (
                        <span className={`text-[10px] ${isMe ? 'text-white/90' : 'text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d]'}`}>
                          🎙️ {msg.voiceName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Speech to Text Transcribe toggle */}
                {msg.sttText ? (
                  <div className={`mt-1 pt-1.5 border-t ${chatFontClasses.secondary} ${isMe ? 'border-white/20' : 'border-black/10 dark:border-white/10 aurora:border-white/10 linen:border-[#dfd2bc]'}`}>
                    <div className="text-[11px] opacity-70 mb-0.5 select-none">转文字:</div>
                    <p className="select-text cursor-text">{msg.sttText}</p>
                    {msg.translatedText ? (
                      <p className={`mt-1 font-medium select-text cursor-text ${isMe ? 'text-white/95' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d]'}`}>
                        译文: {msg.translatedText}
                      </p>
                    ) : msg.translationError ? (
                      <div className={`mt-1 text-[11px] flex items-center justify-between gap-2 ${isMe ? 'text-amber-200' : 'text-rose-600 dark:text-rose-400 aurora:text-rose-300'}`}>
                        <span className="min-w-0 break-words">
                          翻译失败，请检查翻译通道
                        </span>
                        {hasRetranslateHandler && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void actionsRef.current.triggerManualTranslate(msg);
                            }}
                            className={`shrink-0 px-1.5 py-0.5 rounded font-semibold text-[10px] cursor-pointer transition-colors ${
                              isMe
                                ? 'bg-white/20 hover:bg-white/30 text-white'
                                : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 aurora:text-rose-300'
                            }`}
                          >
                            重试翻译
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    onClick={() => void actionsRef.current.handleTranscribeAudio(msg)}
                    disabled={isTranscribing}
                    className={`text-[11px] hover:underline self-start cursor-pointer mt-0.5 ${isMe ? 'text-white/90' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d]'}`}
                  >
                    {isTranscribing ? '正在转文字中...' : '转为文字'}
                  </button>
                )}
              </div>
            ) : (
              /* Standard Text Message or Photo Caption */
              <div className="min-w-0">
                {(() => {
                  const isTranslationOnlyPeer =
                    isChatTransEnabled &&
                    !isMe &&
                    !showOriginalAndTranslationPref &&
                    Boolean(msg.translatedText) &&
                    !msg.isCall &&
                    !msg.isImage &&
                    !msg.isFile &&
                    !msg.isVideo;

                  if (isTranslationOnlyPeer) {
                    return (
                      <div className="min-w-0">
                        <p className={`${chatFontClasses.composer} leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text cursor-text`}>
                          {msg.translatedText}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2 select-none">
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d]">
                            <Languages className="w-3 h-3" />
                            <span>仅显示译文</span>
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              actionsRef.current.onToggleShowOriginal(msg.id);
                            }}
                            className="text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] linen:hover:text-[#8c522d] hover:underline cursor-pointer"
                          >
                            {isShowingOriginalOverlay ? '收起原文' : '查看原文'}
                          </button>
                        </div>
                        {isShowingOriginalOverlay && msg.text && (
                          <div className={`mt-1.5 p-2 rounded-lg bg-[#f8fafc] dark:bg-[#0b131f]/80 aurora:bg-[#0c161c]/85 linen:bg-[#f4ecdf] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1e343e] linen:border-[#dccdb8] ${chatFontClasses.secondary} text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8] linen:text-[#4e3f32] select-text`}>
                            <div className="text-[10px] opacity-70 mb-0.5 select-none">原文：</div>
                            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{actionsRef.current.renderMessageTextWithLinks(msg.text, false)}</p>
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <>
                      {msg.isCall ? (
                        <div className="flex items-center gap-2.5 py-0.5 select-text">
                          <span
                            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                              msg.callType === 'missed'
                                ? 'bg-rose-500/15 text-rose-500 dark:text-rose-400'
                                : isMe
                                  ? 'bg-white/20 text-white'
                                  : 'bg-[#2481cc]/12 text-[#2481cc] dark:bg-[#2ba0ff]/15 dark:text-[#7cc4ff] aurora:bg-[#2dd4bf]/15 aurora:text-[#5eead4] linen:bg-[#a86a43]/15 linen:text-[#8c522d]'
                            }`}
                          >
                            {msg.isVideoCall ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                          </span>
                          <div className="min-w-0">
                            <div
                              className={`${chatFontClasses.body} font-medium leading-snug ${
                                msg.callType === 'missed' && !isMe
                                  ? 'text-rose-600 dark:text-rose-400 aurora:text-rose-300'
                                  : ''
                              }`}
                            >
                              {msg.callType === 'missed'
                                ? (msg.isVideoCall ? '未接视频来电' : '未接语音来电')
                                : (msg.isVideoCall ? '视频通话' : '语音通话')}
                            </div>
                            <div className={`text-[11px] leading-tight tabular-nums ${isMe ? 'text-white/80' : 'opacity-75'}`}>
                              {msg.callType === 'missed'
                                ? '对方来电未接听'
                                : msg.callDuration && msg.callDuration > 0
                                  ? `时长 ${Math.floor(msg.callDuration / 3600) > 0 ? `${Math.floor(msg.callDuration / 3600)}:` : ''}${String(Math.floor((msg.callDuration % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(msg.callDuration % 60)).padStart(2, '0')}`
                                  : (isMe ? '未接听' : '已结束')}
                            </div>
                          </div>
                        </div>
                      ) : !msg.isImage && !msg.isFile && !msg.isVideo && (
                        <p className={`${chatFontClasses.body} leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text cursor-text`}>
                          {actionsRef.current.renderMessageTextWithLinks(msg.text, isMe)}
                        </p>
                      )}
                      {msg.isImage &&
                        msg.text &&
                        msg.text.trim() &&
                        (!msg.imageUrl ||
                          (!isSystemMediaPlaceholder(msg.text, msg) &&
                            !/\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/i.test(msg.text.trim()))) && (
                        <p className={`${chatFontClasses.body} leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text cursor-text mt-1 px-1.5`}>
                          {actionsRef.current.renderMessageTextWithLinks(msg.text, isMe)}
                        </p>
                      )}
                      {msg.isVideo &&
                        msg.text &&
                        msg.text.trim() &&
                        (!msg.videoUrl ||
                          (!isSystemMediaPlaceholder(msg.text, msg) &&
                            !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(msg.text.trim()))) && (
                        <p className={`${chatFontClasses.body} leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text cursor-text mt-1 px-1.5`}>
                          {actionsRef.current.renderMessageTextWithLinks(msg.text, isMe)}
                        </p>
                      )}

                      {/* Official Telegram Inline Translation Card */}
                      {((!isChatTransEnabled && !msg.isTranslating && !msg.translatedText && !msg.translationError) ||
                        msg.isCall ||
                        (msg.isImage && msg.imageUrl && (!msg.text?.trim() || isSystemMediaPlaceholder(msg.text, msg))) ||
                        (msg.isVideo && msg.videoUrl && (!msg.text?.trim() || isSystemMediaPlaceholder(msg.text, msg)))) ? null : msg.isTranslating ? (
                        <div
                          className={`mt-1.5 px-2 py-1 rounded-lg border text-[10.5px] flex items-center gap-1.5 ${
                            isMe
                              ? 'bg-white/10 border-white/20 text-white/85'
                              : 'bg-[#f8fafc] dark:bg-[#0b131f]/80 aurora:bg-[#0c161c]/85 linen:bg-[#f3eadc] border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1e343e] linen:border-[#d5c6b0] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d]'
                          }`}
                        >
                          <RotateCw className="w-3 h-3 animate-spin shrink-0" />
                          <span>正在翻译中...</span>
                        </div>
                      ) : msg.translatedText ? (
                        <div
                          className={`mt-1.5 px-2 py-1.5 rounded-lg border ${chatFontClasses.translation} select-text cursor-text ${
                            isMe
                              ? 'bg-white/12 border-white/20 linen:bg-black/15 linen:border-white/15 text-white/95'
                              : 'bg-[#f8fafc] dark:bg-[#0b131f]/80 aurora:bg-[#0c161c]/85 linen:bg-[#f4ecdf] border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1e343e] linen:border-[#dccdb8] text-[#1e293b] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-0.5 select-none">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                                isMe ? 'text-white/85' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#7c5838]'
                              }`}
                            >
                              <Languages className="w-3 h-3" />
                              <span>{isMe ? '已发送对照译文' : '实时译文'}</span>
                            </span>
                            <div className="flex items-center gap-1">
                              {hasRetranslateHandler && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void actionsRef.current.triggerManualTranslate(msg);
                                  }}
                                  title="重新翻译"
                                  className={`p-0.5 rounded transition-colors cursor-pointer ${
                                    isMe
                                      ? 'text-white/75 hover:text-white hover:bg-white/10'
                                      : 'text-[#64748b] hover:text-[#2481cc] hover:bg-black/5 dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#6e5c4a] linen:hover:text-[#8c522d] linen:hover:bg-[#a86a43]/10'
                                  }`}
                                >
                                  <RotateCw className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  actionsRef.current.copyToClipboard(msg.translatedText || '', `${msg.id}_tr`);
                                }}
                                title="复制译文"
                                className={`p-0.5 rounded transition-colors cursor-pointer ${
                                  isMe
                                    ? 'text-white/75 hover:text-white hover:bg-white/10'
                                    : 'text-[#64748b] hover:text-[#2481cc] hover:bg-black/5 dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#6e5c4a] linen:hover:text-[#8c522d] linen:hover:bg-[#a86a43]/10'
                                }`}
                              >
                                {isCopiedTranslation ? (
                                  <Check className={`w-3 h-3 ${isMe ? 'text-emerald-300' : 'text-emerald-600 dark:text-emerald-400 aurora:text-emerald-300'}`} />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </div>
                          <p className="leading-snug font-normal whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text cursor-text">{msg.translatedText}</p>
                        </div>
                      ) : msg.translationError ? (
                        <div
                          className={`mt-1.5 pt-1 border-t text-[10.5px] flex items-center justify-between gap-2 select-text cursor-text ${
                            isMe
                              ? 'border-white/20 text-amber-200'
                              : 'border-rose-500/20 text-rose-600 dark:text-rose-400 aurora:text-rose-300'
                          }`}
                        >
                          <span className="min-w-0 break-words">
                            翻译失败，请检查翻译通道
                          </span>
                          {hasRetranslateHandler && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void actionsRef.current.triggerManualTranslate(msg);
                              }}
                              className={`shrink-0 px-2 py-0.5 rounded font-semibold text-[10.5px] cursor-pointer transition-colors ${
                                isMe
                                  ? 'bg-white/20 hover:bg-white/30 text-white'
                                  : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 aurora:text-rose-300'
                              }`}
                            >
                              重试翻译
                            </button>
                          )}
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Message Reactions Pills */}
            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
              <div
                className={`flex flex-wrap items-center gap-1 mt-1 pt-1 border-t ${
                  isMe ? 'border-white/15' : 'border-black/5 dark:border-white/10 aurora:border-white/10 linen:border-[#cbbba2]/50'
                }`}
              >
                {Object.entries(msg.reactions).map(([emoji, count]) => {
                  const isMine = msg.myReactions?.includes(emoji);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => actionsRef.current.onToggleReaction?.(msg.id, emoji)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 border transition-colors cursor-pointer ${
                        isMe
                          ? isMine
                            ? 'bg-white/25 border-white/50 text-white'
                            : 'bg-white/10 border-transparent text-white/90 hover:bg-white/20'
                          : isMine
                          ? 'bg-[#e8f3ff] border-[#2481cc] text-[#2481cc] dark:bg-[#2ba0ff]/20 dark:border-[#2ba0ff]/60 dark:text-[#2ba0ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf] aurora:text-[#5eead4] linen:bg-[#a86a43]/15 linen:border-[#a86a43] linen:text-[#8c522d]'
                          : 'bg-[#f1f5f9] dark:bg-white/10 aurora:bg-[#13252e] linen:bg-[#efe6d6] border-transparent text-[#0f172a] dark:text-white/90 aurora:text-[#ecf6f8] linen:text-[#4e3f32] hover:bg-[#e2e8f0] dark:hover:bg-white/15 aurora:hover:bg-[#18303b] linen:hover:bg-[#e5d9c5]'
                      }`}
                    >
                      <span>{emoji}</span>
                      <span className="font-semibold tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Message Timestamp & Status Checks */}
            {!hasOverlayImageTimestamp && (
              <div
                className={`flex items-center justify-end gap-1 ${hasMediaBubble ? 'mt-0.5 px-1.5 pb-0.5' : 'mt-1'} text-[10px] select-none tabular-nums ${
                  isMe ? 'text-white/80' : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#84725e]'
                }`}
              >
                {hasRetranslateHandler &&
                  !isMultiSelectMode &&
                  !msg.isCall &&
                  (!msg.isAudio || Boolean(msg.sttText?.trim())) &&
                  !(msg.isImage && msg.imageUrl && (!msg.text?.trim() || isSystemMediaPlaceholder(msg.text, msg))) &&
                  !(msg.isVideo && msg.videoUrl && (!msg.text?.trim() || isSystemMediaPlaceholder(msg.text, msg))) &&
                  Boolean((msg.sttText || msg.text || msg.imageCaption || '').trim()) &&
                  !msg.translatedText &&
                  !msg.translationError && (
                  <button
                    type="button"
                    disabled={Boolean(msg.isTranslating)}
                    onClick={(e) => {
                      e.stopPropagation();
                      void actionsRef.current.triggerManualTranslate(msg);
                    }}
                    title={msg.isTranslating ? '正在翻译中...' : '手动翻译此消息'}
                    className={`inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[10px] font-medium transition-colors cursor-pointer disabled:opacity-60 mr-1 ${
                      isMe
                        ? 'bg-white/15 hover:bg-white/25 text-white/95'
                        : 'bg-[#2481cc]/10 hover:bg-[#2481cc]/20 text-[#2481cc] dark:bg-[#2ba0ff]/15 dark:hover:bg-[#2ba0ff]/25 dark:text-[#7cc4ff] aurora:bg-[#2dd4bf]/12 aurora:hover:bg-[#2dd4bf]/22 aurora:text-[#5eead4] linen:bg-[#a86a43]/12 linen:hover:bg-[#a86a43]/22 linen:text-[#8c522d]'
                    }`}
                  >
                    {msg.isTranslating ? (
                      <RotateCw className="w-2.5 h-2.5 animate-spin" />
                    ) : (
                      <Languages className="w-2.5 h-2.5" />
                    )}
                    <span>{msg.isTranslating ? '翻译中' : '翻译'}</span>
                  </button>
                )}
                {msg.isPinned && (
                  <Pin
                    className={`w-3 h-3 fill-current mr-0.5 ${
                      isMe ? 'text-white/90' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43]'
                    }`}
                  />
                )}
                {msg.isEdited && (
                  <span className="text-[9.5px] opacity-80 mr-0.5">已编辑</span>
                )}
                <span>{msg.timestamp}</span>
                {isMe && (
                  msg.deliveryStatus === 'pending' || msg.deliveryStatus === 'retrying' || isRetrying ? (
                    <span className="inline-flex items-center gap-0.5 text-white/80" title="正在投递到 Telegram">
                      <RotateCw className="w-3 h-3 animate-spin" />
                    </span>
                  ) : msg.deliveryStatus === 'paused' ? (
                    <span
                      className="inline-flex items-center gap-1.5 flex-wrap"
                      title={msg.queuePauseReason || '发送已暂停，等待手动确认'}
                    >
                      <span className="inline-flex items-center gap-0.5 text-amber-200 dark:text-amber-300 font-medium">
                        <Pause className="w-3 h-3" />
                        <span>已暂停</span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void actionsRef.current.onResumePausedMessage?.(msg.id);
                        }}
                        className="px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-[10px] font-medium cursor-pointer transition-colors"
                        title={msg.queuePauseReason || '继续发送此消息'}
                      >
                        继续发送
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void actionsRef.current.onDiscardPausedMessage?.(msg.id);
                        }}
                        className="px-1.5 py-0.5 rounded bg-rose-500/40 hover:bg-rose-500/60 text-white text-[10px] font-medium cursor-pointer transition-colors"
                        title="丢弃此未发送消息"
                      >
                        丢弃
                      </button>
                    </span>
                  ) : msg.deliveryStatus === 'failed' ? (
                    <button
                      type="button"
                      onClick={() => {
                        void actionsRef.current.onRetrySendMessage(msg.id);
                      }}
                      title="消息投递失败，点击重试发送"
                      className="inline-flex items-center gap-1 text-rose-200 hover:underline cursor-pointer font-medium"
                    >
                      <ShieldAlert className="w-3 h-3" />
                      <span>失败 · 重发</span>
                    </button>
                  ) : isChannel ? (
                    <span title="已发送至频道" className="inline-flex items-center">
                      <CheckCheck className="w-3.5 h-3.5 text-white/95 dark:text-[#7cc4ff] aurora:text-[#5eead4]" />
                    </span>
                  ) : chatId.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && typeof msg.telegramMessageId === 'number' ? (
                    isReadByPeer ? (
                      isGroup && !isMultiSelectMode ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void actionsRef.current.handleOpenReadReceipts(msg);
                          }}
                          title="已有成员已读（点击查看谁已读）"
                          className="inline-flex items-center hover:opacity-80 cursor-pointer"
                        >
                          <CheckCheck className="w-3.5 h-3.5 text-white/95 dark:text-[#7cc4ff] aurora:text-[#5eead4]" />
                        </button>
                      ) : (
                        <span title="对方已读" className="inline-flex items-center">
                          <CheckCheck className="w-3.5 h-3.5 text-white/95 dark:text-[#7cc4ff] aurora:text-[#5eead4]" />
                        </span>
                      )
                    ) : (
                      <span title={isGroup ? '已送达（暂未有成员已读）' : '已送达（对方未读）'} className="inline-flex items-center">
                        <Check className="w-3.5 h-3.5 text-white/80 dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
                      </span>
                    )
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5 text-white/95 dark:text-[#7cc4ff] aurora:text-[#5eead4]" />
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const ChatMessageItem = React.memo(ChatMessageItemInner);
