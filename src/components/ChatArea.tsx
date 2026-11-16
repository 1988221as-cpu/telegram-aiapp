import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Send,
  Mic,
  Smile,
  Copy,
  Check,
  CheckCheck,
  Languages,
  ChevronDown,
  MoreVertical,
  Paperclip,
  Search,
  Play,
  Pause,
  RotateCw,
  X,
  Volume2,
  Sparkles,
  AudioWaveform,
  Video,
  Music,
  ShieldAlert,
  Reply,
  Pin,
  Trash2,
  Edit2,
  FileText,
  Image as ImageIcon,
  Download,
  Cpu,
  Brain,
  Forward,
  CheckSquare,
  Square,
  History,
  ChevronUp,
  Users,
  Megaphone,
  ExternalLink,
  Clock,
  Maximize2,
  UserPlus,
  MessageCircle,
  ShieldCheck,
  Phone,
  AtSign,
  Loader2,
} from 'lucide-react';
import { Chat, Message, TranslationSettings, MasterVoiceprint, TelegramStickerItem, TelegramContact, TelegramChatFullInfo } from '../types';
import { VoiceCloneStudioModal } from './VoiceCloneStudioModal';
import { TelegramEmojiPicker } from './TelegramEmojiPicker';
import { TelegramChatInfoDrawer } from './TelegramChatInfoDrawer';
import type { RightPanelTab } from './UnifiedRightDock';
import { getMasterVoiceprint, saveMasterVoiceprint } from '../services/voiceprintStorage';
import { SUPPORTED_LANGUAGES, normalizeLanguageCode } from '../data/mockData';
import {
  translateText,
  transcribeAudio,
  sendAutonomousChat,
  fetchTelegramCloudMessagesApi,
  submitTrainingFeedbackApi,
  sendTelegramStickerApi,
  fetchGlobalPersonaApi,
  resolveClientTelegramMessageId,
  isMessageDeleted,
  fetchWithTimeout,
  TELEGRAM_MAX_MEDIA,
  isSignedResourceUrl,
  isSignedResourceUrlExpiringSoon,
  refreshSignedResourceUrlsApi,
  ensureFreshSignedResourceUrl,
  saveLocalMessage,
  updateMessageSttInDb,
  previewTelegramInviteApi,
  joinTelegramInviteApi,
  generateTTSVoice,
  fetchTelegramChatFullInfoApi,
  addTelegramUserContactApi,
  blockTelegramUserContactApi,
  unblockTelegramUserContactApi,
  type VoiceCloneRequestOptions,
} from '../services/apiService';
import { sanitizeSafeResourceUrl } from '../services/urlSafety';

const AI_SUGGESTION_COOLDOWN_MS = 60_000;
const AI_SUGGESTION_COOLDOWN_STORAGE_KEY = 'tg_ai_suggestion_cooldown_until';

function readAiSuggestionCooldownUntil(): number {
  try {
    const raw = localStorage.getItem(AI_SUGGESTION_COOLDOWN_STORAGE_KEY);
    const ts = Number(raw || 0);
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  } catch {
    return 0;
  }
}

function getAiSuggestionRemainingSeconds(fallbackUntil = 0): number {
  const until = Math.max(fallbackUntil, readAiSuggestionCooldownUntil());
  const diff = until - Date.now();
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

function getTranslationErrorLabel(channel?: Message['translationErrorChannel']): string {
  switch (channel) {
    case 'live_gemini':
      return '实时 Gemini 译文失败';
    case 'live_custom_llm':
      return '自定义模型译文失败';
    case 'live_google':
      return '实时谷歌机翻失败';
    case 'history_google':
      return '历史谷歌补译失败';
    default:
      return '译文失败';
  }
}

function formatMediaSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
}

export function getLanguageDisplayName(code: string): string {
  if (!code) return '英语';
  if (code === 'Auto' || code === 'auto') return '自动识别';
  if (code === 'Turkish' || code === 'Türkçe' || code === 'tr') return '土耳其语';
  if (code === 'Chinese' || code === 'zh-CN') return '中文';
  if (code === 'Traditional Chinese' || code === 'zh-TW') return '繁体中文';
  if (code === 'English' || code === 'en') return '英语';
  if (code === 'Russian' || code === 'ru') return '俄语';
  if (code === 'Spanish' || code === 'es') return '西班牙语';
  if (code === 'Japanese' || code === 'ja') return '日语';
  if (code === 'Korean' || code === 'ko') return '韩语';
  if (code === 'Arabic' || code === 'ar') return '阿拉伯语';
  if (code === 'French' || code === 'fr') return '法语';
  if (code === 'German' || code === 'de') return '德语';
  if (code === 'Vietnamese' || code === 'vi') return '越南语';
  if (code === 'Thai' || code === 'th') return '泰语';
  if (code === 'Indonesian' || code === 'id') return '印尼语';
  if (code === 'Portuguese' || code === 'pt') return '葡萄牙语';
  if (code === 'Italian' || code === 'it') return '意大利语';
  const norm = normalizeLanguageCode(code);
  const found =
    SUPPORTED_LANGUAGES.find((l) => l.code === code) ||
    SUPPORTED_LANGUAGES.find((l) => normalizeLanguageCode(l.code) === norm);
  if (found) {
    const match = found.name.match(/\(([^)]+)\)/);
    if (match && match[1]) {
      return match[1].split(/[·/]/)[0].trim() || found.name;
    }
    return found.name;
  }
  return code;
}

export function detectClientLangCode(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const clean = text.trim();
  if (!clean) return '';
  const stripped = clean
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\btg:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\bt\.me\/\S+/gi, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(/@[a-zA-Z0-9_]+/g, ' ')
    .trim();
  if (!stripped || !/\p{L}/u.test(stripped)) return '';

  if (/[\u3040-\u30ff]/.test(stripped)) return 'ja';
  if (/[\uac00-\ud7af]/.test(stripped)) return 'ko';
  if (/[\u4e00-\u9fa5]/.test(stripped)) return 'zh-CN';
  if (/[іїєґІЇЄҐ]/.test(stripped) && /[\u0400-\u04FF]/.test(stripped)) return 'uk';
  if (/[\u0400-\u04FF]/.test(stripped)) return 'ru';
  if (/[پچژگک]/.test(stripped) && /[\u0600-\u06FF]/.test(stripped)) return 'fa';
  if (/[\u0600-\u06FF]/.test(stripped)) return 'ar';
  if (/[\u0590-\u05FF]/.test(stripped)) return 'he';
  if (/[\u0370-\u03FF]/.test(stripped)) return 'el';
  if (/[\u0e00-\u0e7f]/.test(stripped)) return 'th';
  if (/[\u0900-\u097F]/.test(stripped)) return 'hi';
  if (/[\u0980-\u09FF]/.test(stripped)) return 'bn';
  if (/[\u0B80-\u0BFF]/.test(stripped)) return 'ta';
  if (/[\u0C00-\u0C7F]/.test(stripped)) return 'te';
  if (/[\u1000-\u109F]/.test(stripped)) return 'my';
  if (/[\u1780-\u17FF]/.test(stripped)) return 'km';
  if (/[\u0E80-\u0EFF]/.test(stripped)) return 'lo';
  if (/[\u10A0-\u10FF]/.test(stripped)) return 'ka';
  if (/[\u0530-\u058F]/.test(stripped)) return 'hy';
  if (/[\u1200-\u137F]/.test(stripped)) return 'am';

  if (
    /[ãõ]/i.test(stripped) ||
    /\b(olá|ola|bom dia|boa tarde|boa noite|obrigado|obrigada|você|voce|tudo bem)\b/i.test(stripped)
  ) {
    return 'pt';
  }
  if (
    /\b(ciao|buongiorno|buonasera|grazie|come stai|arrivederci|prego)\b/i.test(stripped)
  ) {
    return 'it';
  }
  if (
    /[¿¡ñÑ]/i.test(stripped) ||
    /\b(hola|buenos días|buenas noches|gracias|amigo|amiga|por favor|cómo estás|como estas|adiós|adios|qué tal|que tal)\b/i.test(stripped)
  ) {
    return 'es';
  }
  if (
    /[œæ]/i.test(stripped) ||
    /\b(bonjour|bonsoir|merci|salut|comment|s'il vous plaît|sil vous plait|oui|non|mon ami|mon amour|très bien|tres bien|ça va|ca va)\b/i.test(stripped)
  ) {
    return 'fr';
  }
  if (
    /[ğĞıİşŞ]/.test(stripped) ||
    /\b(merhaba|günaydın|gunaydin|nasılsın|nasilsin|teşekkür|tesekkur|evet|hayır|hayir|tamam|lütfen|lutfen|görüşürüz|gorusuruz|harika|canım|canim|iyiyim|selam|nasılsınız|nasilsiniz)\b/i.test(stripped)
  ) {
    return 'tr';
  }
  if (
    /[ăắằẳẵặấầẩẫậếềểễệốồổỗộơờớởỡợưừứửữựđẢảẼẽĨĩÕõŨũỸỹẠạẸẹỊịỌọỤụỴỵẺẻỈỉỎỏỦủỶỷ]/i.test(stripped) ||
    /\b(xin chào|cảm ơn|cam on|chào bạn|chào|tạm biệt|chúc|vâng|không)\b/i.test(stripped)
  ) {
    return 'vi';
  }
  if (
    /[ąćęłńśźżĄĆĘŁŃŚŹŻ]/.test(stripped) ||
    /\b(dzień dobry|dzien dobry|dziękuję|dziekuje|proszę|prosze|cześć|czesc|jak się masz|jak sie masz|przepraszam|dobranoc)\b/i.test(stripped)
  ) {
    return 'pl';
  }
  const dutchMarkerRegex =
    /\b(goedemorgen|goedemiddag|goedenavond|hoe gaat|hoe is het|hoe maakt u het|alles goed|met jou|met u|dank je|dank u|bedankt|alvast|alsjeblieft|alstublieft|gefeliciteerd|welterusten|fijne|prettige|prettig|gezellig|tot ziens|tot zo|tot straks|tot morgen|tot snel|doei|welkom|graag|vandaag|nederlands|ik ben|ik heb|ik wil|jij bent|jij hebt|het is)\b/i;
  if (dutchMarkerRegex.test(stripped)) {
    return 'nl';
  }
  if (
    /ß/.test(stripped) ||
    (/\b(guten tag|guten morgen|danke|bitte|wie geht|hallo|tschüss|tschuess|auf wiedersehen|ich bin|nicht|sehr gut)\b/i.test(stripped) &&
      !dutchMarkerRegex.test(stripped))
  ) {
    return 'de';
  }
  if (
    /[åÅ]/.test(stripped) ||
    /\b(hej|hur mår du|hur mar du|god morgon|god kväll|tack så mycket|tack sa mycket|varsågod|förlåt|jag är|det är|svenska)\b/i.test(stripped)
  ) {
    return 'sv';
  }
  if (
    /[øØ]/.test(stripped) ||
    /\b(hvordan har du det|hvordan går det|mange tak|tusen takk|ha det)\b/i.test(stripped)
  ) {
    return /\b(tusen takk|hvordan går det)\b/i.test(stripped) ? 'no' : 'da';
  }
  if (
    /[řěůŘĚŮ]/.test(stripped) ||
    /\b(dobrý den|děkuji|dekuji|prosím|prosim|jak se máš|jak se mas|ahoj)\b/i.test(stripped)
  ) {
    return 'cs';
  }
  if (
    /[őűŐŰ]/.test(stripped) ||
    /\b(köszönöm|koszonom|jó reggelt|hogy vagy|kérem|szia)\b/i.test(stripped)
  ) {
    return 'hu';
  }
  if (
    /[șțȘȚ]/.test(stripped) ||
    /\b(mulțumesc|multumesc|ce faci|te rog|la revedere|bună ziua)\b/i.test(stripped)
  ) {
    return 'ro';
  }
  if (
    /\b(apa khabar|selamat petang|boleh|awak|hendak|tolonglah)\b/i.test(stripped)
  ) {
    return 'ms';
  }
  if (
    /\b(selamat pagi|selamat siang|selamat sore|terima kasih|apa kabar|sama-sama|tidak|iya|halo|bagaimana|saya mau)\b/i.test(stripped)
  ) {
    return 'id';
  }
  if (
    /\b(kamusta|kumusta|salamat|magandang umaga|magandang gabi|mabuti|hindi)\b/i.test(stripped)
  ) {
    return 'tl';
  }

  if (
    !/[à-öø-ÿąćęłńśźżšžčřěůőűăîșțğış]/i.test(stripped) &&
    (/\b(the|is|are|am|was|were|be|been|have|has|had|do|does|did|will|would|can|could|should|may|might|this|that|these|those|there|here|what|which|who|when|where|why|how|you|your|yours|we|our|they|their|he|she|it|its|i|my|me|hi|hello|hey|thanks|thank|please|sorry|ok|okay|yes|no|not|and|or|but|for|with|from|about|order|price|status|check|help|need|want|good|great|nice|morning|evening|night|today|tomorrow|yesterday|send|sent|message|account|time|day|work|know|think|like|love|see|get|got|make|made|go|going|come|back|now|just|very|much|more|some|any|all|one|two|world|shipping|delivery|payment|confirm|update|reply|wait|sure)\b/i.test(stripped) ||
      /\b(i'm|you're|we're|they're|it's|that's|don't|doesn't|didn't|can't|won't|wouldn't|shouldn't|isn't|aren't|haven't|hasn't|what's|who's|where's|how's)\b/i.test(stripped))
  ) {
    return 'en';
  }

  return '';
}

export function hasTranslatableLetters(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const stripped = text
    .trim()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\btg:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\bt\.me\/\S+/gi, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(/@[a-zA-Z0-9_]+/g, ' ')
    .trim();
  return Boolean(stripped && /\p{L}/u.test(stripped));
}

const DETECTED_CODE_TO_LANGUAGE_NAME: Record<string, string> = {
  'zh-CN': 'Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ru: 'Russian',
  es: 'Spanish',
  ar: 'Arabic',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  vi: 'Vietnamese',
  fr: 'French',
  de: 'German',
  id: 'Indonesian',
  th: 'Thai',
  tr: 'Turkish',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  uk: 'Ukrainian',
  hi: 'Hindi',
  ms: 'Malay',
  tl: 'Filipino',
  my: 'Burmese',
  km: 'Khmer',
  lo: 'Lao',
  fa: 'Persian',
  he: 'Hebrew',
  el: 'Greek',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  cs: 'Czech',
  hu: 'Hungarian',
  ro: 'Romanian',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  ka: 'Georgian',
  hy: 'Armenian',
  am: 'Amharic',
};

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
    /^[^\p{L}\d]*\[贴纸\]$/u.test(trimmed)
  ) {
    return true;
  }

  if (msg?.isFile && /^(📎|📁)\s+/.test(trimmed)) return true;
  if (msg?.isAudio && /^(🎤|🎵)\s+/.test(trimmed)) return true;
  if (msg?.isVideo && /^(🎬|🎥)\s+/.test(trimmed)) return true;
  if (msg?.isImage && /^🖼️\s+/.test(trimmed)) return true;

  return false;
}

function getPeerMessageNaturalTextCandidates(msg: Partial<Message>): string[] {
  const candidates: string[] = [];
  const pushCandidate = (raw?: string | null) => {
    let clean = String(raw || '').trim();
    if (!clean) return;
    if (/^📊\s*投票\s*[:：]\s*/.test(clean)) {
      clean = clean.replace(/^📊\s*投票\s*[:：]\s*/, '').trim();
      if (!clean) return;
    }
    if (isSystemMediaPlaceholder(clean, msg)) return;
    if (!hasTranslatableLetters(clean)) return;
    candidates.push(clean);
  };

  pushCandidate(msg.sttText);
  pushCandidate(msg.imageCaption);
  pushCandidate(msg.text);
  return candidates;
}

export function getOutboundTargetLanguage(
  chat?: Chat | null,
  settings?: TranslationSettings | null,
  recentMessages?: Message[]
): string {
  // 1. Single-chat dedicated outbound language (sourceLang) has the highest priority; never hijack with inbound targetLang
  if (chat?.sourceLang && chat.sourceLang !== 'Auto') {
    return chat.sourceLang;
  }
  // 2. Global default outbound language from settings
  if (settings?.defaultSourceLang && settings.defaultSourceLang !== 'Auto') {
    return settings.defaultSourceLang;
  }

  if (recentMessages && recentMessages.length > 0) {
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      if (!msg || msg.sender !== 'peer') continue;
      const candidates = getPeerMessageNaturalTextCandidates(msg);
      for (const candidate of candidates) {
        const code = detectClientLangCode(candidate);
        if (code) return DETECTED_CODE_TO_LANGUAGE_NAME[code] || code;
      }
    }
  }

  return 'English';
}

function normalizeChatLangCode(lang?: string): string {
  return normalizeLanguageCode(lang);
}

export function getInboundTargetLanguage(
  chat?: Chat | null,
  settings?: TranslationSettings | null
): string {
  if (chat?.targetLang && chat.targetLang !== 'Auto') {
    return chat.targetLang;
  }
  if (settings?.defaultTargetLang && settings.defaultTargetLang !== 'Auto') {
    return settings.defaultTargetLang;
  }
  return 'Chinese';
}

export function isChatTranslationActive(
  chat?: Chat | null,
  settings?: TranslationSettings | null
): boolean {
  if (typeof chat?.translationEnabled === 'boolean') return chat.translationEnabled;
  if (chat?.isGroup || chat?.isChannel) return settings?.autoTranslateGroups === true;
  return settings?.autoTranslatePrivate !== false;
}

interface ChatAreaProps {
  chat: Chat | null;
  messages: Message[];
  translationSettings: TranslationSettings;
  onSendMessage: (message: Partial<Message> & { skipCloudRelay?: boolean; mediaFile?: File | Blob }) => void;
  onUpdateChatLanguage?: (chatId: string, sourceLang: string, targetLang: string) => void;
  onToggleChatTranslation?: (chatId: string, enabled: boolean) => void;
  onOpenTranslation?: () => void;
  customLLMConfig?: any;
  currentAccountId?: string;
  availableChats?: Chat[];
  hasMoreHistory?: boolean;
  onLoadOlderMessages?: (chatId: string, offsetId: number) => Promise<{ ok: boolean; count: number; hasMore: boolean; error?: string }>;
  onMessagesSynced?: (synced: Message[], meta?: { hasMore?: boolean; readOutboxMaxId?: number; fromLocalFallback?: boolean; chatId?: string; accountId?: string }) => void;
  onOpenKnowledgeEvolution?: () => void;
  onOpenCustomerMemory?: () => void;
  isCustomerMemoryOpen?: boolean;
  onDeleteMessage?: (messageId: string, options?: { revoke?: boolean }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onBatchDeleteMessages?: (messageIds: string[], options?: { revoke?: boolean }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onForwardMessages?: (payload: { messageIds: string[]; telegramMessageIds: number[]; toChatId: string; dropAuthor?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  onEditMessage?: (messageId: string, newText: string, options?: { translatedText?: string }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onUpdateMessage?: (messageId: string, patch: Partial<Message>, scope?: { chatId?: string; accountId?: string }) => void;
  onRetranslateMessage?: (messageId: string) => void | Promise<void>;
  onRetryMessage?: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  onToggleReaction?: (messageId: string, emoji: string) => void | Promise<any>;
  onTogglePinMessage?: (messageId: string) => void | Promise<any>;
  onClearHistory?: (chatId: string, options?: { revoke?: boolean }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onToggleMuteChat?: (chatId: string) => void | Promise<any>;
  onTogglePinChat?: (chatId: string) => void | Promise<any>;
  onForwardMessage?: (message: Message) => void;
  onUpdateChatTitle?: (chatId: string, newTitle: string) => void | Promise<{ ok: boolean; error?: string } | void>;
  onChatInfoUpdated?: (chatId: string, patch: Partial<Chat>) => void;
  onAddContact?: (contact: TelegramContact) => void;
  onRemoveContact?: (contactId: string) => void;
  onJoinOrOpenChat?: (chat: Chat) => void;
  onCloseChat?: () => void;
  onOpenCustomLLM?: () => void;
  activeRightPanel?: RightPanelTab | null;
  isChatInfoOpenExternal?: boolean;
  onChatInfoOpenChange?: (open: boolean) => void;
  sendWithEnter?: boolean;
  onRefreshMediaUrls?: (urls: string[]) => Promise<Record<string, string>>;
}

function getMessageDayKey(msg: Message): string {
  if (typeof msg.createdAt === 'number' && Number.isFinite(msg.createdAt) && msg.createdAt > 0) {
    const d = new Date(msg.createdAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return 'today';
}

function formatMessageDayLabel(dayKey: string): string {
  if (dayKey === 'today') return '今天';
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (dayKey === todayKey) return '今天';
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestKey = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
  if (dayKey === yestKey) return '昨天';
  const [yStr, mStr, dStr] = dayKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (y === now.getFullYear()) return `${m}月${d}日`;
  return `${y}年${m}月${d}日`;
}

const LEGACY_PLACEHOLDER_SENDER_NAMES = new Set(['客户', '对方', '我方', 'Telegram 联系人']);

function computeAnchoredPopupPos(
  anchorEl: HTMLElement | null,
  options: { width: number; maxHeight: number; preferAbove?: boolean; gap?: number }
): { top: number; left: number; maxHeight: number } | null {
  if (!anchorEl || typeof window === 'undefined') return null;
  const rect = anchorEl.getBoundingClientRect();
  const margin = 12;
  const gap = options.gap ?? 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(options.width, vw - margin * 2);
  const left = Math.max(margin, Math.min(rect.left, vw - width - margin));
  const spaceBelow = vh - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;
  const openAbove = options.preferAbove
    ? spaceAbove >= Math.min(options.maxHeight, 180) || spaceAbove >= spaceBelow
    : spaceBelow < Math.min(options.maxHeight, 220) && spaceAbove > spaceBelow;
  const avail = Math.max(140, openAbove ? spaceAbove : spaceBelow);
  const usedHeight = Math.min(options.maxHeight, avail);
  const top = openAbove
    ? Math.max(margin, rect.top - gap - usedHeight)
    : Math.min(vh - usedHeight - margin, rect.bottom + gap);
  return { top, left, maxHeight: usedHeight };
}

function normalizeGroupMemberDisplayName(name?: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || LEGACY_PLACEHOLDER_SENDER_NAMES.has(trimmed)) return '';
  return trimmed;
}

const TG_SENDER_NAME_COLORS = [
  'text-[#e17076] dark:text-[#ff8a8f] aurora:text-[#fda4af]',
  'text-[#eda86c] dark:text-[#ffb870] aurora:text-[#fdba74]',
  'text-[#a695e7] dark:text-[#b6a6ff] aurora:text-[#c4b5fd]',
  'text-[#7bc862] dark:text-[#86e06b] aurora:text-[#86efac]',
  'text-[#65aadd] dark:text-[#64b5f6] aurora:text-[#67e8f9]',
  'text-[#ee7aae] dark:text-[#f48fb1] aurora:text-[#f9a8d4]',
];

const TG_SENDER_AVATAR_BGS = [
  'from-[#ff516a] to-[#ff885e]',
  'from-[#ffa85c] to-[#ffcd6a]',
  'from-[#8b6ff5] to-[#b594ff]',
  'from-[#54cb68] to-[#7be078]',
  'from-[#2a9ef1] to-[#5ec0ff]',
  'from-[#e5599d] to-[#f489bd]',
];

function getTelegramSenderColorIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % TG_SENDER_NAME_COLORS.length;
}

function getSenderAvatarInitial(name?: string, senderId?: string): string {
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

function buildReplyPayload(replyMsg: Message, chatTitle?: string) {
  const replyMemberName = normalizeGroupMemberDisplayName(replyMsg.senderName);
  return {
    id: replyMsg.id,
    telegramMessageId: replyMsg.telegramMessageId,
    senderName: replyMsg.sender === 'me' ? '我' : (replyMemberName || chatTitle || ''),
    text:
      replyMsg.text?.trim() ||
      (replyMsg.isAudio
        ? '🎤 语音消息'
        : replyMsg.isVideo
        ? '🎬 视频消息'
        : replyMsg.isImage
        ? '🖼️ 图片消息'
        : replyMsg.isFile
        ? `📁 ${replyMsg.fileName || '文档附件'}`
        : '消息内容'),
  };
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  chat,
  messages,
  translationSettings,
  onSendMessage,
  onUpdateChatLanguage,
  onToggleChatTranslation,
  onOpenTranslation,
  customLLMConfig,
  currentAccountId,
  availableChats = [],
  hasMoreHistory = false,
  onLoadOlderMessages,
  onMessagesSynced,
  onOpenKnowledgeEvolution,
  onOpenCustomerMemory,
  isCustomerMemoryOpen = false,
  onDeleteMessage,
  onBatchDeleteMessages,
  onForwardMessages,
  onEditMessage,
  onUpdateMessage,
  onRetranslateMessage,
  onRetryMessage,
  onToggleReaction,
  onTogglePinMessage,
  onClearHistory,
  onToggleMuteChat,
  onTogglePinChat,
  onForwardMessage,
  onUpdateChatTitle,
  onChatInfoUpdated,
  onAddContact,
  onRemoveContact,
  onJoinOrOpenChat,
  onCloseChat,
  onOpenCustomLLM,
  activeRightPanel,
  isChatInfoOpenExternal,
  onChatInfoOpenChange,
  sendWithEnter = true,
  onRefreshMediaUrls,
}) => {
  const [inputText, setInputText] = useState('');
  const activeChatIdRef = useRef<string | null>(chat?.id || null);
  activeChatIdRef.current = chat?.id || null;
  const activeAccountIdRef = useRef<string | undefined>(currentAccountId);
  activeAccountIdRef.current = currentAccountId;
  const isSameOriginScope = (originChatId: string, originAccountId?: string) =>
    activeChatIdRef.current === originChatId && activeAccountIdRef.current === originAccountId;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 144;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [inputText, chat?.id]);
  const [translatedPreview, setTranslatedPreview] = useState('');
  const [translatedPreviewSource, setTranslatedPreviewSource] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewRetryNonce, setPreviewRetryNonce] = useState(0);
  const [isTranslatingPreview, setIsTranslatingPreview] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewContextRef = useRef<string>('');

  const isDualOffPreview = Boolean(
    customLLMConfig && (customLLMConfig.enabled === false || customLLMConfig.explicitlyDisabled)
  );
  const isCustomPreview = Boolean(
    !isDualOffPreview && customLLMConfig?.enabled && customLLMConfig?.engineMode === 'custom'
  );
  const isGroupOrChannelChat = Boolean(
    chat?.isGroup || chat?.isChannel || /^tg_-/.test(chat?.id || '')
  );
  const effectiveOutboundEngine: 'gemini' | 'google' | 'custom_llm' =
    isGroupOrChannelChat || isDualOffPreview
      ? 'google'
      : isCustomPreview
      ? translationSettings?.preferredEngine === 'google'
        ? 'google'
        : 'custom_llm'
      : translationSettings?.preferredEngine === 'google'
      ? 'google'
      : 'gemini';
  const isLlmOutboundEngine =
    effectiveOutboundEngine === 'gemini' || effectiveOutboundEngine === 'custom_llm';
  const [showOriginalMsgIds, setShowOriginalMsgIds] = useState<Set<string>>(new Set());
  const [isTranslateBarVisible, setIsTranslateBarVisible] = useState(true);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [langMenuSearch, setLangMenuSearch] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<Record<string, number>>({});
  const [transcribingMap, setTranscribingMap] = useState<Record<string, boolean>>({});
  const [uncontrolledMsgPatches, setUncontrolledMsgPatches] = useState<Record<string, Partial<Message>>>({});
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const recordDurationRef = useRef<number>(0);
  const [retryingMsgIds, setRetryingMsgIds] = useState<Set<string>>(new Set());
  const [isVoiceStudioOpen, setIsVoiceStudioOpen] = useState(false);
  const [isSynthesizingVoice, setIsSynthesizingVoice] = useState(false);
  const [masterVoiceprint, setMasterVoiceprint] = useState<MasterVoiceprint | null>(null);
  const [activePersonaName, setActivePersonaName] = useState<string>('默认人设');

  useEffect(() => {
    if (!currentAccountId) {
      setActivePersonaName('默认人设');
      return;
    }
    let mounted = true;
    fetchGlobalPersonaApi(currentAccountId)
      .then((res) => {
        if (mounted) {
          setActivePersonaName(res?.success && res.persona?.personaName ? res.persona.personaName : '默认人设');
        }
      })
      .catch(() => {
        if (mounted) setActivePersonaName('默认人设');
      });
    return () => {
      mounted = false;
    };
  }, [currentAccountId]);

  // Telegram Features State
  const [localChatInfoOpen, setLocalChatInfoOpen] = useState(false);
  const isChatInfoOpen = isChatInfoOpenExternal ?? localChatInfoOpen;
  const setChatInfoOpen = (open: boolean) => {
    setLocalChatInfoOpen(open);
    onChatInfoOpenChange?.(open);
  };
  const [isSearchingInChat, setIsSearchingInChat] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [cloudSearchResults, setCloudSearchResults] = useState<Message[] | null>(null);
  const [isCloudSearching, setIsCloudSearching] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [pinnedBannerIndex, setPinnedBannerIndex] = useState(0);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [translateOnEdit, setTranslateOnEdit] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const [pastedImage, setPastedImage] = useState<{
    dataUrl: string;
    file: File;
    caption?: string;
  } | null>(null);
  const pastedImageRef = useRef<{ dataUrl: string; file: File; caption?: string } | null>(null);
  pastedImageRef.current = pastedImage;

  const clearPastedImage = (revokePreview = true) => {
    const prev = pastedImageRef.current;
    if (revokePreview && prev?.dataUrl?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(prev.dataUrl);
      } catch {}
    }
    setPastedImage(null);
  };

  useEffect(() => {
    return () => {
      const pending = pastedImageRef.current;
      if (pending?.dataUrl?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(pending.dataUrl);
        } catch {}
      }
    };
  }, []);

  // Multi-select, Forward & Delete Confirmation State
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);
  const [revokeBatchDelete, setRevokeBatchDelete] = useState(true);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [forwardModalMessages, setForwardModalMessages] = useState<Message[] | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardDropAuthor, setForwardDropAuthor] = useState(false);
  const [isForwarding, setIsForwarding] = useState(false);

  // Message Context Menu & Delete Confirmation State
  const [messageContextMenu, setMessageContextMenu] = useState<{
    message: Message;
    x: number;
    y: number;
  } | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<Message | null>(null);
  const [revokeSingleDelete, setRevokeSingleDelete] = useState(true);
  const [lightboxMedia, setLightboxMedia] = useState<{
    type: 'image' | 'video';
    url: string;
    rawUrl?: string;
    caption?: string;
    msgId: string;
  } | null>(null);

  const [memberProfileModal, setMemberProfileModal] = useState<{
    targetChatId: string;
    senderId: string;
    name: string;
    username?: string;
    avatarUrl?: string;
    statusText?: string;
    isOnline?: boolean;
    isBot?: boolean;
    loading: boolean;
    info?: TelegramChatFullInfo;
    error?: string;
    actionError?: string;
    actionSuccess?: string;
    isAddingContact?: boolean;
    isTogglingBlock?: boolean;
  } | null>(null);

  useEffect(() => {
    setLightboxMedia(null);
    setMemberProfileModal(null);
  }, [chat?.id, currentAccountId]);
  const [inviteModalState, setInviteModalState] = useState<{
    url: string;
    loading: boolean;
    joining: boolean;
    preview?: {
      alreadyMember?: boolean;
      requestNeeded?: boolean;
      requestSent?: boolean;
      title?: string;
      about?: string;
      participantsCount?: number;
      isGroup?: boolean;
      isChannel?: boolean;
      chat?: Chat;
    };
    error?: string;
  } | null>(null);

  const isTelegramJoinOrChatUrl = useCallback((rawUrl: string): boolean => {
    const trimmed = rawUrl.trim();
    if (/^tg:\/\/(join|resolve)\b/i.test(trimmed)) return true;
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const u = new URL(withProto);
      const host = u.hostname.toLowerCase();
      if (!['t.me', 'telegram.me', 'telegram.dog'].includes(host)) return false;
      const segs = u.pathname.split('/').filter(Boolean);
      if (segs.length === 0) return false;
      const reserved = new Set(['s', 'addstickers', 'addemoji', 'proxy', 'socks', 'share', 'iv', 'bg', 'setlanguage', 'addtheme', 'c']);
      return segs[0].startsWith('+') || segs[0].toLowerCase() === 'joinchat' || !reserved.has(segs[0].toLowerCase());
    } catch {
      return false;
    }
  }, []);

  const handleOpenTelegramInviteLink = useCallback(async (rawUrl: string) => {
    const normalizedUrl = /^https?:\/\/|^tg:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    setInviteModalState({
      url: normalizedUrl,
      loading: true,
      joining: false,
    });
    const res = await previewTelegramInviteApi({
      accountId: currentAccountId,
      url: normalizedUrl,
    });
    if (!res.ok) {
      setInviteModalState({
        url: normalizedUrl,
        loading: false,
        joining: false,
        error: res.error || '无法解析该群组或频道链接，可能已过期或失效',
      });
      return;
    }
    setInviteModalState({
      url: res.url || normalizedUrl,
      loading: false,
      joining: false,
      preview: {
        alreadyMember: res.alreadyMember,
        requestNeeded: res.requestNeeded,
        title: res.title,
        about: res.about,
        participantsCount: res.participantsCount,
        isGroup: res.isGroup,
        isChannel: res.isChannel,
        chat: res.chat,
      },
    });
  }, [currentAccountId]);

  const handleConfirmJoinInvite = useCallback(async () => {
    if (!inviteModalState || inviteModalState.joining) return;
    if (inviteModalState.preview?.alreadyMember && inviteModalState.preview.chat) {
      onJoinOrOpenChat?.(inviteModalState.preview.chat);
      setInviteModalState(null);
      return;
    }
    setInviteModalState((prev) => (prev ? { ...prev, joining: true, error: undefined } : prev));
    const res = await joinTelegramInviteApi({
      accountId: currentAccountId,
      url: inviteModalState.url,
    });
    if (!res.ok) {
      setInviteModalState((prev) => (prev ? { ...prev, joining: false, error: res.error || '加入失败，请稍后重试' } : prev));
      return;
    }
    if (res.requestSent) {
      setInviteModalState((prev) =>
        prev
          ? {
              ...prev,
              joining: false,
              preview: { ...prev.preview, requestSent: true },
            }
          : prev
      );
      return;
    }
    if (res.chat) {
      onJoinOrOpenChat?.(res.chat);
      setInviteModalState(null);
      return;
    }
    setInviteModalState((prev) =>
      prev ? { ...prev, joining: false, error: '已提交加入请求，但暂未获取到会话信息，请刷新会话列表' } : prev
    );
  }, [inviteModalState, currentAccountId, onJoinOrOpenChat]);

  const handleOpenGroupMemberProfile = useCallback(
    async (member: {
      senderId?: string;
      name?: string;
      username?: string;
      avatarUrl?: string;
      statusText?: string;
      isOnline?: boolean;
      isBot?: boolean;
    }) => {
      const rawId = String(member.senderId || '').trim();
      if (!rawId) return;
      const targetChatId = rawId.startsWith('tg_') ? rawId : `tg_${rawId}`;
      const fallbackName = normalizeGroupMemberDisplayName(member.name) || rawId.replace(/^tg_/, '');
      setMemberProfileModal({
        targetChatId,
        senderId: rawId.replace(/^tg_/, ''),
        name: fallbackName || '群成员',
        username: member.username,
        avatarUrl: member.avatarUrl,
        statusText: member.statusText,
        isOnline: member.isOnline,
        isBot: member.isBot,
        loading: Boolean(chat?.id?.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot'),
      });
      if (!chat?.id?.startsWith('tg_') || currentAccountId === 'acc_telegram_bot') return;
      const info = await fetchTelegramChatFullInfoApi(targetChatId, currentAccountId);
      setMemberProfileModal((prev) => {
        if (!prev || prev.targetChatId !== targetChatId) return prev;
        if (!info.ok) {
          return { ...prev, loading: false, error: info.error || '无法获取该成员详细资料' };
        }
        return {
          ...prev,
          loading: false,
          info,
          name: info.title || prev.name,
          username: info.username ?? prev.username,
          statusText: info.statusText ?? prev.statusText,
          isOnline: typeof info.isOnline === 'boolean' ? info.isOnline : prev.isOnline,
          isBot: typeof info.isBot === 'boolean' ? info.isBot : prev.isBot,
        };
      });
    },
    [chat?.id, currentAccountId]
  );

  const renderMessageTextWithLinks = useCallback((text: string | undefined | null, isOwnBubble: boolean) => {
    if (!text) return null;
    const urlRegex = /((?:https?:\/\/|tg:\/\/)[^\s<>"{}|\\^`\[\]]+|(?:t\.me|telegram\.me|telegram\.dog)\/[^\s<>"{}|\\^`\[\]]+)/gi;
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(text)) !== null) {
      const startIdx = match.index;
      let rawMatched = match[0];
      let trailing = '';
      while (rawMatched.length > 0 && /[),.;:!?，。；：！？、'"）】》」』]$/.test(rawMatched)) {
        trailing = rawMatched.slice(-1) + trailing;
        rawMatched = rawMatched.slice(0, -1);
      }
      if (startIdx > lastIndex) {
        nodes.push(text.slice(lastIndex, startIdx));
      }
      if (rawMatched) {
        if (isTelegramJoinOrChatUrl(rawMatched)) {
          nodes.push(
            <button
              key={`tg-link-${startIdx}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleOpenTelegramInviteLink(rawMatched);
              }}
              className={`inline underline underline-offset-2 font-medium cursor-pointer break-all text-left transition-opacity hover:opacity-80 ${
                isOwnBubble
                  ? 'text-[#bae6fd] dark:text-[#bfdbfe] aurora:text-[#a5f3fc]'
                  : 'text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4]'
              }`}
              title="点击预览并加入群组 / 频道"
            >
              {rawMatched}
            </button>
          );
        } else {
          const hrefCandidate = /^https?:\/\//i.test(rawMatched) ? rawMatched : `https://${rawMatched}`;
          const safeHref = sanitizeSafeResourceUrl(hrefCandidate);
          if (safeHref) {
            nodes.push(
              <a
                key={`ext-link-${startIdx}`}
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`underline underline-offset-2 font-medium break-all transition-opacity hover:opacity-80 ${
                  isOwnBubble
                    ? 'text-[#bae6fd] dark:text-[#bfdbfe] aurora:text-[#a5f3fc]'
                    : 'text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4]'
                }`}
              >
                {rawMatched}
              </a>
            );
          } else {
            nodes.push(rawMatched);
          }
        }
      }
      if (trailing) {
        nodes.push(trailing);
      }
      lastIndex = startIdx + match[0].length;
    }
    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex));
    }
    return nodes.length > 0 ? nodes : text;
  }, [isTelegramJoinOrChatUrl, handleOpenTelegramInviteLink]);

  const handleMessageContextMenu = (e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 190;
    const menuHeight = 310;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 12;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 12;
    }

    setMessageContextMenu({
      message: msg,
      x: Math.max(12, x),
      y: Math.max(12, y),
    });
  };

  useEffect(() => {
    const handleCloseMenu = () => {
      setMessageContextMenu(null);
    };
    if (messageContextMenu) {
      window.addEventListener('click', handleCloseMenu);
      window.addEventListener('scroll', handleCloseMenu, true);
      return () => {
        window.removeEventListener('click', handleCloseMenu);
        window.removeEventListener('scroll', handleCloseMenu, true);
      };
    }
  }, [messageContextMenu]);

  const confirmDeleteMessage = async () => {
    if (messageToDelete) {
      const targetMsg = messageToDelete;
      const isLocalOnly =
        !targetMsg.telegramMessageId ||
        targetMsg.deliveryStatus === 'failed' ||
        targetMsg.deliveryStatus === 'pending';
      const revoke = isLocalOnly ? false : revokeSingleDelete;
      setMessageToDelete(null);
      const res = await onDeleteMessage?.(targetMsg.id, { revoke });
      if (res && typeof res === 'object' && res.ok === false) {
        showSyncNotice(`云端撤回删除失败：${res.error || '请检查 Telegram 在线状态'}`);
        return;
      }
      const targetTgId = resolveClientTelegramMessageId(targetMsg);
      setCloudSearchResults((prev) =>
        prev
          ? prev.filter(
              (m) =>
                m.id !== targetMsg.id &&
                !(targetTgId !== undefined && resolveClientTelegramMessageId(m) === targetTgId)
            )
          : null
      );
      showSyncNotice(
        isLocalOnly
          ? '已从本地列表移除该未发送消息'
          : revoke
            ? '已从云端双方与本地删除该条消息'
            : '已仅从当前账号与本地删除该条消息',
        2500
      );
    }
  };

  const toggleSelectMessage = (msgId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const handleOpenForwardModal = (msgs: Message[]) => {
    if (!msgs || msgs.length === 0) return;
    if (onForwardMessage && msgs.length === 1 && !onForwardMessages) {
      onForwardMessage(msgs[0]);
      return;
    }
    setForwardSearch('');
    setForwardDropAuthor(false);
    setForwardModalMessages(msgs);
  };

  const handleConfirmForward = async (targetChatId: string) => {
    if (!forwardModalMessages || forwardModalMessages.length === 0 || isForwarding) return;
    if (!onForwardMessages) return;
    setIsForwarding(true);
    try {
      const isCloudForward = Boolean(chat?.id.startsWith('tg_') && targetChatId.startsWith('tg_'));
      const forwardableMsgs = isCloudForward
        ? forwardModalMessages.filter((m) => resolveClientTelegramMessageId(m) !== undefined)
        : forwardModalMessages;
      const tgIds = forwardableMsgs
        .map((m) => resolveClientTelegramMessageId(m))
        .filter((id): id is number => typeof id === 'number' && id > 0);
      if (isCloudForward && tgIds.length === 0) {
        showSyncNotice('所选消息尚未同步 Telegram 云端消息 ID，无法转发');
        return;
      }
      const res = await onForwardMessages({
        messageIds: forwardableMsgs.map((m) => m.id),
        telegramMessageIds: tgIds,
        toChatId: targetChatId,
        dropAuthor: forwardDropAuthor,
      });
      if (!res.ok) {
        showSyncNotice(`转发失败：${res.error || '请检查 Telegram 在线状态'}`);
        return;
      }
      const targetChat = availableChats.find((c) => c.id === targetChatId);
      const skippedCount = forwardModalMessages.length - forwardableMsgs.length;
      setForwardModalMessages(null);
      setIsMultiSelectMode(false);
      setSelectedMessageIds(new Set());
      showSyncNotice(
        skippedCount > 0
          ? `已转发 ${forwardableMsgs.length} 条云端消息至「${targetChat?.title || '目标对话'}」（已跳过 ${skippedCount} 条未送达消息）`
          : `已转发 ${forwardableMsgs.length} 条消息至「${targetChat?.title || '目标对话'}」`,
        3000
      );
    } finally {
      setIsForwarding(false);
    }
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedMessageIds.size === 0 || isBatchDeleting) return;
    if (!onBatchDeleteMessages) return;
    setIsBatchDeleting(true);
    try {
      const ids = Array.from(selectedMessageIds);
      const res = await onBatchDeleteMessages(ids, { revoke: revokeBatchDelete });
      if (res && typeof res === 'object' && res.ok === false) {
        showSyncNotice(`批量删除失败：${res.error || '请检查 Telegram 权限或网络'}`);
        return;
      }
      const deletedIdSet = new Set(ids);
      const deletedTgIdSet = new Set(
        messages
          .filter((m) => deletedIdSet.has(m.id))
          .map((m) => resolveClientTelegramMessageId(m))
          .filter((id): id is number => typeof id === 'number' && id > 0)
      );
      setCloudSearchResults((prev) =>
        prev
          ? prev.filter((m) => {
              if (deletedIdSet.has(m.id)) return false;
              const tgId = resolveClientTelegramMessageId(m);
              if (tgId !== undefined && deletedTgIdSet.has(tgId)) return false;
              return true;
            })
          : null
      );
      setShowBatchDeleteModal(false);
      setIsMultiSelectMode(false);
      setSelectedMessageIds(new Set());
      showSyncNotice(`已批量删除 ${ids.length} 条消息`, 2500);
    } finally {
      setIsBatchDeleting(false);
    }
  };

  // Sync Master Voiceprint & Listen for Real-Time Updates
  useEffect(() => {
    setMasterVoiceprint(getMasterVoiceprint());
    const handleVoiceprintChange = (e: any) => {
      setMasterVoiceprint(e.detail || getMasterVoiceprint());
    };
    window.addEventListener('tg_voiceprint_updated', handleVoiceprintChange);
    return () => window.removeEventListener('tg_voiceprint_updated', handleVoiceprintChange);
  }, []);

  // AI Holographic Memory Suggestion State
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const aiCooldownUntilRef = useRef<number>(readAiSuggestionCooldownUntil());
  const [aiCooldownSeconds, setAiCooldownSeconds] = useState<number>(() => getAiSuggestionRemainingSeconds());
  const [isSending, setIsSending] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiSuggestionTranslation, setAiSuggestionTranslation] = useState<string | null>(null);
  const [isTranslatingSuggestion, setIsTranslatingSuggestion] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [failedAvatarUrls, setFailedAvatarUrls] = useState<Set<string>>(() => new Set());
  const syncNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (aiCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      const remaining = getAiSuggestionRemainingSeconds(aiCooldownUntilRef.current);
      setAiCooldownSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [aiCooldownSeconds > 0]);

  const showSyncNotice = (msg: string, durationMs = 4000) => {
    if (syncNoticeTimerRef.current) {
      clearTimeout(syncNoticeTimerRef.current);
    }
    setSyncNotice(msg);
    if (durationMs > 0) {
      syncNoticeTimerRef.current = setTimeout(() => {
        setSyncNotice(null);
        syncNoticeTimerRef.current = null;
      }, durationMs);
    }
  };

  useEffect(() => {
    return () => {
      if (syncNoticeTimerRef.current) {
        clearTimeout(syncNoticeTimerRef.current);
      }
    };
  }, []);

  const langMenuRef = useRef<HTMLDivElement>(null);
  const langButtonRef = useRef<HTMLButtonElement>(null);
  const langDropdownRef = useRef<HTMLDivElement>(null);
  const [langMenuPos, setLangMenuPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const [attachmentMenuPos, setAttachmentMenuPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const suppressAutoScrollRef = useRef(false);
  const prevChatIdForScrollRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioPlaySeqRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);
  const [refreshedUrlsMap, setRefreshedUrlsMap] = useState<Record<string, string>>({});
  const attemptedRefreshUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setUncontrolledMsgPatches({});
    const stopAudio = () => {
      audioPlaySeqRef.current += 1;
      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.ontimeupdate = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingAudioId(null);
    };
    stopAudio();
    return () => {
      stopAudio();
    };
  }, [chat?.id, currentAccountId]);

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
          const refreshed = await ensureFreshSignedResourceUrl(currentResolved, currentAccountId, { force: true });
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
    [currentAccountId, onRefreshMediaUrls, refreshedUrlsMap]
  );

  useEffect(() => {
    const expiring: string[] = [];
    const pushIfExpiring = (rawUrl?: string) => {
      if (!rawUrl) return;
      const effective = refreshedUrlsMap[rawUrl] || rawUrl;
      if (isSignedResourceUrlExpiringSoon(effective) && !attemptedRefreshUrlsRef.current.has(effective)) {
        expiring.push(effective);
      }
    };
    pushIfExpiring(chat?.avatarUrl);
    for (const m of messages) {
      pushIfExpiring(m.audioUrl);
      pushIfExpiring(m.imageUrl);
      pushIfExpiring(m.videoUrl);
      pushIfExpiring(m.fileUrl);
    }
    const unique = Array.from(new Set(expiring)).slice(0, 50);
    if (unique.length === 0) return;

    unique.forEach((u) => attemptedRefreshUrlsRef.current.add(u));
    let cancelled = false;
    (async () => {
      const refreshed = onRefreshMediaUrls
        ? await onRefreshMediaUrls(unique)
        : await refreshSignedResourceUrlsApi(unique, currentAccountId);
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
    })();
    return () => {
      cancelled = true;
    };
  }, [chat?.avatarUrl, messages, currentAccountId, onRefreshMediaUrls, refreshedUrlsMap]);

  const outboundTargetLang = getOutboundTargetLanguage(chat, translationSettings, messages);
  const inboundTargetLang = getInboundTargetLanguage(chat, translationSettings);
  const isChatTransEnabled = isChatTranslationActive(chat, translationSettings);
  const chatTransScopeLabel = chat?.isGroup || chat?.isChannel ? '群翻译' : '私聊翻译';

  const handleSyncCloudMessages = async () => {
    if (!chat?.id) return;
    setIsSyncingCloud(true);
    setSyncNotice('正在从 Telegram 官方云端拉取真实历史消息...');
    try {
      const res = await fetchTelegramCloudMessagesApi(chat.id, currentAccountId, { limit: 40 });
      if (res.ok && res.messages.length > 0) {
        onMessagesSynced?.(res.messages, {
          hasMore: res.hasMore,
          readOutboxMaxId: res.readOutboxMaxId,
          fromLocalFallback: res.fromLocalFallback,
          chatId: chat.id,
          accountId: currentAccountId,
        });
        setSyncNotice(`云端同步成功！已拉取 ${res.messages.length} 条真实聊天记录`);
      } else if (!res.ok) {
        setSyncNotice(res.error || '云端历史同步失败，请检查账号连接');
      } else {
        onMessagesSynced?.([], {
          hasMore: false,
          readOutboxMaxId: res.readOutboxMaxId,
          fromLocalFallback: res.fromLocalFallback,
          chatId: chat.id,
          accountId: currentAccountId,
        });
        setSyncNotice('云端已是最新记录或暂无更多历史');
      }
    } catch {
      setSyncNotice('云端历史同步失败，请检查账号连接');
    } finally {
      setIsSyncingCloud(false);
      setTimeout(() => setSyncNotice(null), 3000);
    }
  };

  const handleLoadOlderClick = async () => {
    if (!chat?.id || !onLoadOlderMessages || isLoadingOlder) return;
    const tgIds = messages
      .map((m) => m.telegramMessageId)
      .filter((id): id is number => typeof id === 'number' && id > 0);
    const minTgId = tgIds.length > 0 ? Math.min(...tgIds) : 0;
    const viewport = scrollViewportRef.current;
    const prevHeight = viewport?.scrollHeight || 0;
    const prevTop = viewport?.scrollTop || 0;
    suppressAutoScrollRef.current = true;
    setIsLoadingOlder(true);
    try {
      const res = await onLoadOlderMessages(chat.id, minTgId);
      if (!res.ok) {
        showSyncNotice(`加载历史消息失败：${res.error || '请检查网络连接'}`);
        return;
      }
      if (res.count === 0) {
        showSyncNotice('已到达对话最早历史记录', 2500);
        return;
      }
      requestAnimationFrame(() => {
        const el = scrollViewportRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight - prevHeight + prevTop;
        }
        setTimeout(() => {
          suppressAutoScrollRef.current = false;
        }, 120);
      });
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const handleCloudSearch = async () => {
    if (!chat?.id || !chatSearchQuery.trim()) {
      setCloudSearchResults(null);
      return;
    }
    if (!chat.id.startsWith('tg_') || currentAccountId === 'acc_telegram_bot') {
      setCloudSearchResults(null);
      return;
    }
    setIsCloudSearching(true);
    try {
      const res = await fetchTelegramCloudMessagesApi(chat.id, currentAccountId, {
        limit: 40,
        search: chatSearchQuery.trim(),
      });
      if (res.ok) {
        setCloudSearchResults(res.messages);
        if (res.messages.length === 0) {
          showSyncNotice('Telegram 云端未检索到匹配的消息', 2500);
        }
      } else {
        showSyncNotice(res.error || '云端搜索失败');
      }
    } finally {
      setIsCloudSearching(false);
    }
  };

  const handleGenerateAiSuggestion = async () => {
    if (!chat || isGeneratingAi) return;
    const remainingSec = getAiSuggestionRemainingSeconds(aiCooldownUntilRef.current);
    if (remainingSec > 0) {
      setAiCooldownSeconds(remainingSec);
      showSyncNotice(`大模型冷却中（请 ${remainingSec} 秒后再试）`, 3000);
      return;
    }
    setIsGeneratingAi(true);
    setAiSuggestion(null);
    setAiSuggestionTranslation(null);
    setSyncNotice(null);
    try {
      const res = await sendAutonomousChat(
        messages.slice(-30).map((m) => {
          const rawBody = (m.text || '').trim();
          const preferredMediaText = (m.sttText || m.imageCaption || '').trim();
          const resolvedText = (
            preferredMediaText && (!rawBody || isSystemMediaPlaceholder(rawBody, m))
              ? preferredMediaText
              : rawBody || preferredMediaText
          ).trim();
          const maybeCreatedAt = (m as unknown as { createdAt?: unknown }).createdAt;
          return {
            id: m.id,
            role: m.sender === 'me' ? 'assistant' : 'user',
            text: resolvedText,
            content: resolvedText,
            sender: m.sender,
            timestamp: m.timestamp,
            createdAt: typeof maybeCreatedAt === 'number' ? maybeCreatedAt : undefined,
            sttText: m.sttText,
            imageCaption: m.imageCaption,
          };
        }),
        customLLMConfig || {},
        '你是一位高情商、懂倾听、生活化的真实人类伴侣/专属客服。请融入客户全息画像与过往约定，用1~2句日常短句回复，像用手机 Telegram 私聊一样自然，绝不说“作为AI”。',
        false,
        chat.id,
        currentAccountId,
        outboundTargetLang
      );
      if (res && res.replyText) {
        const nextUntil = Date.now() + AI_SUGGESTION_COOLDOWN_MS;
        aiCooldownUntilRef.current = nextUntil;
        try {
          localStorage.setItem(AI_SUGGESTION_COOLDOWN_STORAGE_KEY, String(nextUntil));
        } catch {}
        setAiCooldownSeconds(Math.ceil(AI_SUGGESTION_COOLDOWN_MS / 1000));
        setAiSuggestion(res.replyText);
        const refTargetLang =
          inboundTargetLang && inboundTargetLang !== 'Auto' ? inboundTargetLang : 'Chinese';
        const refTargetNorm = normalizeChatLangCode(refTargetLang);
        const replyLangNorm = normalizeChatLangCode(detectClientLangCode(res.replyText));
        const isDualOffMode = Boolean(
          customLLMConfig && (customLLMConfig.enabled === false || customLLMConfig.explicitlyDisabled)
        );
        const isCustomMode = Boolean(
          !isDualOffMode && customLLMConfig?.enabled && customLLMConfig?.engineMode === 'custom'
        );
        const effectiveRefEngine: 'gemini' | 'google' | 'custom_llm' =
          isGroupOrChannelChat || isDualOffMode
            ? 'google'
            : isCustomMode
            ? 'custom_llm'
            : translationSettings?.preferredEngine === 'google'
            ? 'google'
            : 'gemini';

        if (res.cnTranslation) {
          setAiSuggestionTranslation(res.cnTranslation);
        } else if (refTargetNorm !== 'auto' && replyLangNorm !== refTargetNorm) {
          setIsTranslatingSuggestion(true);
          try {
            const refTrans = await translateText(
              res.replyText,
              'Auto',
              refTargetLang,
              customLLMConfig,
              effectiveRefEngine,
              translationSettings?.googleApiKey,
              isGroupOrChannelChat ? undefined : translationSettings?.geminiModel,
              isGroupOrChannelChat ? undefined : translationSettings?.geminiApiKey,
              isGroupOrChannelChat ? undefined : translationSettings?.customModelName,
              isGroupOrChannelChat ? { purpose: 'group', isGroup: true } : undefined
            );
            setAiSuggestionTranslation(refTrans || null);
          } catch {
            setAiSuggestionTranslation(null);
            showSyncNotice('翻译失败，请检查翻译通道', 5000);
          } finally {
            setIsTranslatingSuggestion(false);
          }
        }
      }
    } catch (err: any) {
      showSyncNotice(err?.message || 'AI 拟真建议生成失败，请检查网络或大模型配置', 6000);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        langMenuRef.current &&
        !langMenuRef.current.contains(target) &&
        (!langDropdownRef.current || !langDropdownRef.current.contains(target))
      ) {
        setIsLangMenuOpen(false);
      }
    };
    if (isLangMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isLangMenuOpen]);

  useLayoutEffect(() => {
    if (!isLangMenuOpen) {
      setLangMenuPos(null);
      return;
    }
    const updatePos = () => {
      setLangMenuPos(computeAnchoredPopupPos(langButtonRef.current, { width: 256, maxHeight: 320, preferAbove: false }));
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isLangMenuOpen]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        attachmentButtonRef.current &&
        !attachmentButtonRef.current.contains(target) &&
        (!attachmentMenuRef.current || !attachmentMenuRef.current.contains(target))
      ) {
        setIsAttachmentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isAttachmentMenuOpen]);

  useLayoutEffect(() => {
    if (!isAttachmentMenuOpen) {
      setAttachmentMenuPos(null);
      return;
    }
    const updatePos = () => {
      setAttachmentMenuPos(computeAnchoredPopupPos(attachmentButtonRef.current, { width: 176, maxHeight: 190, preferAbove: true, gap: 8 }));
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isAttachmentMenuOpen]);

  // Telegram Desktop Esc key handler to close overlays or active chat
  useEffect(() => {
    if (!chat) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxMedia) {
          e.preventDefault();
          setLightboxMedia(null);
          return;
        }
        if (memberProfileModal) {
          e.preventDefault();
          setMemberProfileModal(null);
          return;
        }
        if (inviteModalState) {
          e.preventDefault();
          setInviteModalState(null);
          return;
        }
        // If an external modal (z-50) or docked right panel is open, let it handle Esc
        if (document.querySelector('.z-50') || activeRightPanel) return;

        // 1. Close in-chat overlays / temporary interactive states
        if (pastedImage) {
          e.preventDefault();
          clearPastedImage(true);
          return;
        }
        if (editingMessage) {
          e.preventDefault();
          setEditingMessage(null);
          setInputText('');
          return;
        }
        if (replyingTo) {
          e.preventDefault();
          setReplyingTo(null);
          return;
        }
        if (showEmojiPicker) {
          e.preventDefault();
          setShowEmojiPicker(false);
          return;
        }
        if (isAttachmentMenuOpen) {
          e.preventDefault();
          setIsAttachmentMenuOpen(false);
          return;
        }
        if (isLangMenuOpen) {
          e.preventDefault();
          setIsLangMenuOpen(false);
          return;
        }
        if (isSearchingInChat) {
          e.preventDefault();
          setIsSearchingInChat(false);
          setChatSearchQuery('');
          return;
        }
        if (isChatInfoOpen) {
          e.preventDefault();
          setChatInfoOpen(false);
          return;
        }
        if (aiSuggestion) {
          e.preventDefault();
          setAiSuggestion(null);
          setAiSuggestionTranslation(null);
          return;
        }
        if (messageToDelete) {
          e.preventDefault();
          setMessageToDelete(null);
          return;
        }
        if (messageContextMenu) {
          e.preventDefault();
          setMessageContextMenu(null);
          return;
        }
        if (translatedPreview) {
          e.preventDefault();
          setTranslatedPreview('');
          setTranslatedPreviewSource('');
          return;
        }

        // 2. Close active chat workbench
        e.preventDefault();
        onCloseChat?.();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    chat,
    pastedImage,
    editingMessage,
    replyingTo,
    showEmojiPicker,
    isAttachmentMenuOpen,
    isLangMenuOpen,
    isSearchingInChat,
    isChatInfoOpen,
    activeRightPanel,
    aiSuggestion,
    translatedPreview,
    messageContextMenu,
    messageToDelete,
    lightboxMedia,
    memberProfileModal,
    inviteModalState,
    onCloseChat,
  ]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleJumpToMessage = (targetMsg: Message) => {
    if (!targetMsg) return;
    const matched =
      messages.find(
        (m) =>
          m.id === targetMsg.id ||
          (typeof targetMsg.telegramMessageId === 'number' &&
            m.telegramMessageId === targetMsg.telegramMessageId)
      ) || targetMsg;

    if (isSearchingInChat || chatSearchQuery || cloudSearchResults !== null) {
      setIsSearchingInChat(false);
      setChatSearchQuery('');
      setCloudSearchResults(null);
    }

    requestAnimationFrame(() => {
      setTimeout(() => {
        const targetEl = scrollViewportRef.current?.querySelector(
          `[data-msg-id="${CSS.escape(matched.id)}"]`
        ) as HTMLElement | null;
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setHighlightedMsgId(matched.id);
          setTimeout(
            () => setHighlightedMsgId((cur) => (cur === matched.id ? null : cur)),
            2000
          );
        } else {
          showSyncNotice('该消息暂未加载到当前窗口，可点击顶部“加载更早历史消息”后重试', 3000);
        }
      }, 40);
    });
  };

  useEffect(() => {
    const currentId = chat?.id || null;
    const chatChanged = prevChatIdForScrollRef.current !== currentId;
    const appended = messages.length > prevMsgCountRef.current;
    prevChatIdForScrollRef.current = currentId;
    prevMsgCountRef.current = messages.length;
    if (suppressAutoScrollRef.current) return;
    if (chatChanged || appended) {
      scrollToBottom();
    }
  }, [chat?.id, messages]);

  // Reset translation preview & historical AI suggestion state when switching chats
  useEffect(() => {
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
      previewAbortRef.current = null;
    }
    setTranslatedPreview('');
    setTranslatedPreviewSource('');
    setPreviewError('');
    setIsTranslatingPreview(false);
    setShowOriginalMsgIds(new Set());
    setAiSuggestion(null);
    setAiSuggestionTranslation(null);
    setIsTranslatingSuggestion(false);
    setIsMultiSelectMode(false);
    setSelectedMessageIds(new Set());
    setIsSearchingInChat(false);
    setChatSearchQuery('');
    setCloudSearchResults(null);
    setPinnedBannerIndex(0);
    setReplyingTo(null);
    setEditingMessage(null);
    setTranslateOnEdit(false);
    clearPastedImage(true);
    if (syncNoticeTimerRef.current) {
      clearTimeout(syncNoticeTimerRef.current);
      syncNoticeTimerRef.current = null;
    }
    setSyncNotice(null);
  }, [chat?.id, currentAccountId]);

  // Real-time input translation preview (auto for free Google Translate; manual on-demand for LLM engines)
  useEffect(() => {
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
      previewAbortRef.current = null;
    }

    const queryText = inputText.trim();
    if (!queryText || !hasTranslatableLetters(queryText) || !isChatTransEnabled || translationSettings?.autoTranslateOutbound === false || (editingMessage && !translateOnEdit)) {
      setTranslatedPreview('');
      setTranslatedPreviewSource('');
      setPreviewError('');
      setIsTranslatingPreview(false);
      return;
    }

    const detectedCode = normalizeChatLangCode(detectClientLangCode(queryText));
    const targetNormCode = normalizeChatLangCode(outboundTargetLang);
    if (detectedCode !== 'auto' && targetNormCode !== 'auto' && detectedCode === targetNormCode) {
      setTranslatedPreview('');
      setTranslatedPreviewSource('');
      setPreviewError('');
      setIsTranslatingPreview(false);
      return;
    }

    const currentPreviewContext = `${outboundTargetLang}|${effectiveOutboundEngine}`;
    if (isLlmOutboundEngine) {
      if (translatedPreviewSource !== queryText || previewContextRef.current !== currentPreviewContext) {
        setTranslatedPreview('');
        setTranslatedPreviewSource('');
        setPreviewError('');
      }
      setIsTranslatingPreview(false);
      return;
    }

    let isCurrent = true;
    const controller = new AbortController();
    previewAbortRef.current = controller;

    const timer = setTimeout(async () => {
      if (!isCurrent || controller.signal.aborted) return;
      setIsTranslatingPreview(true);
      setPreviewError('');
      try {
        const trans = await translateText(
          queryText,
          'Auto',
          outboundTargetLang,
          customLLMConfig,
          effectiveOutboundEngine,
          translationSettings?.googleApiKey,
          isGroupOrChannelChat ? undefined : translationSettings?.geminiModel,
          isGroupOrChannelChat ? undefined : translationSettings?.geminiApiKey,
          isGroupOrChannelChat ? undefined : translationSettings?.customModelName,
          {
            signal: controller.signal,
            ...(isGroupOrChannelChat ? { purpose: 'group' as const, isGroup: true } : {}),
          }
        );
        if (isCurrent && !controller.signal.aborted) {
          previewContextRef.current = currentPreviewContext;
          setTranslatedPreview(trans);
          setTranslatedPreviewSource(queryText);
          setPreviewError('');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || controller.signal.aborted || !isCurrent) {
          return;
        }
        setTranslatedPreview('');
        setTranslatedPreviewSource(queryText);
        setPreviewError('翻译失败，请检查翻译通道');
      } finally {
        if (isCurrent) {
          setIsTranslatingPreview(false);
        }
      }
    }, 400);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
      controller.abort();
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
      }
    };
  }, [
    inputText,
    outboundTargetLang,
    isChatTransEnabled,
    translationSettings,
    customLLMConfig,
    editingMessage,
    translateOnEdit,
    previewRetryNonce,
    effectiveOutboundEngine,
    isLlmOutboundEngine,
  ]);

  const handleManualLlmPreview = async () => {
    const queryText = inputText.trim();
    if (
      !queryText ||
      !hasTranslatableLetters(queryText) ||
      !isChatTransEnabled ||
      translationSettings?.autoTranslateOutbound === false ||
      (editingMessage && !translateOnEdit)
    ) {
      return;
    }
    const detectedCode = normalizeChatLangCode(detectClientLangCode(queryText));
    const targetNormCode = normalizeChatLangCode(outboundTargetLang);
    if (detectedCode !== 'auto' && targetNormCode !== 'auto' && detectedCode === targetNormCode) {
      setTranslatedPreview('');
      setTranslatedPreviewSource('');
      setPreviewError('');
      showSyncNotice('当前输入与发送目标语种一致，无需翻译');
      return;
    }

    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setIsTranslatingPreview(true);
    setPreviewError('');
    try {
      const trans = await translateText(
        queryText,
        'Auto',
        outboundTargetLang,
        customLLMConfig,
        effectiveOutboundEngine,
        translationSettings?.googleApiKey,
        isGroupOrChannelChat ? undefined : translationSettings?.geminiModel,
        isGroupOrChannelChat ? undefined : translationSettings?.geminiApiKey,
        isGroupOrChannelChat ? undefined : translationSettings?.customModelName,
        {
          signal: controller.signal,
          ...(isGroupOrChannelChat ? { purpose: 'group' as const, isGroup: true } : {}),
        }
      );
      if (!controller.signal.aborted && (textareaRef.current?.value.trim() === queryText || inputText.trim() === queryText)) {
        previewContextRef.current = `${outboundTargetLang}|${effectiveOutboundEngine}`;
        setTranslatedPreview(trans);
        setTranslatedPreviewSource(queryText);
        setPreviewError('');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setTranslatedPreview('');
      setTranslatedPreviewSource(queryText);
      setPreviewError('翻译失败，请检查翻译通道');
    } finally {
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
      }
      setIsTranslatingPreview(false);
    }
  };

  // Send message
  const handleSendText = async (bypassTranslation = false) => {
    if (isSending) return;
    const textToSend = inputText.trim();
    if (!textToSend || !chat) return;
    const originChatId = chat.id;
    const originAccountId = currentAccountId;
    const originReplyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;

    setIsSending(true);
    try {
      const shouldAutoTranslate =
        !bypassTranslation &&
        isChatTransEnabled &&
        translationSettings?.autoTranslateOutbound !== false &&
        (!editingMessage || translateOnEdit);
      const hasTextToTranslate = hasTranslatableLetters(textToSend);
      let targetText = textToSend;
      let translationOfTarget = '';

      if (shouldAutoTranslate && hasTextToTranslate) {
        const inputNormCode = normalizeChatLangCode(detectClientLangCode(textToSend));
        const targetNormCode = normalizeChatLangCode(outboundTargetLang);
        const inboundNormCode = normalizeChatLangCode(inboundTargetLang);
        const isAlreadyTargetLang =
          inputNormCode !== 'auto' && targetNormCode !== 'auto' && inputNormCode === targetNormCode;

        if (!isAlreadyTargetLang) {
          if (previewError && translatedPreviewSource === textToSend) {
            if (isSameOriginScope(originChatId, originAccountId)) {
              showSyncNotice('翻译预览失败，可点击输入框上方「重试」或「直接发送原文」', 5000);
            }
            return;
          }

          // Anti-race condition protection: verify preview text matches current textToSend
          const isPreviewFresh = Boolean(translatedPreview && translatedPreviewSource === textToSend);
          targetText = isPreviewFresh ? translatedPreview : '';
          translationOfTarget = textToSend;

          if (!targetText) {
            try {
              targetText = await translateText(
                textToSend,
                'Auto',
                outboundTargetLang,
                customLLMConfig,
                effectiveOutboundEngine,
                translationSettings?.googleApiKey,
                isGroupOrChannelChat ? undefined : translationSettings?.geminiModel,
                isGroupOrChannelChat ? undefined : translationSettings?.geminiApiKey,
                isGroupOrChannelChat ? undefined : translationSettings?.customModelName,
                isGroupOrChannelChat ? { purpose: 'group', isGroup: true } : undefined
              );
            } catch {
              const errMsg = '翻译失败，请检查翻译通道';
              if (isSameOriginScope(originChatId, originAccountId)) {
                setPreviewError(errMsg);
                setTranslatedPreview('');
                setTranslatedPreviewSource(textToSend);
                showSyncNotice(errMsg, 5000);
              }
              return;
            }
          }
        } else {
          // Operator typed in target language directly -> keep targetText as typed, optionally provide inbound reading translation
          targetText = textToSend;
          if (inboundNormCode !== 'auto' && inputNormCode !== inboundNormCode) {
            try {
              translationOfTarget = await translateText(
                textToSend,
                'Auto',
                inboundTargetLang,
                customLLMConfig,
                effectiveOutboundEngine,
                translationSettings?.googleApiKey,
                isGroupOrChannelChat ? undefined : translationSettings?.geminiModel,
                isGroupOrChannelChat ? undefined : translationSettings?.geminiApiKey,
                isGroupOrChannelChat ? undefined : translationSettings?.customModelName,
                isGroupOrChannelChat ? { purpose: 'group', isGroup: true } : undefined
              );
            } catch {
              translationOfTarget = '';
              if (isSameOriginScope(originChatId, originAccountId)) {
                showSyncNotice('翻译失败，请检查翻译通道', 4000);
              }
            }
          }
        }
      } else {
        targetText = textToSend;
        translationOfTarget = '';
      }

      if (editingMessage) {
        const editRes = await onEditMessage?.(
          editingMessage.id,
          targetText,
          shouldAutoTranslate ? { translatedText: translationOfTarget } : undefined
        );
        if (editRes && typeof editRes === 'object' && editRes.ok === false) {
          if (isSameOriginScope(originChatId, originAccountId)) {
            showSyncNotice(`云端编辑失败：${editRes.error || '请检查 Telegram 在线状态'}`);
          }
          return;
        }
        if (isSameOriginScope(originChatId, originAccountId)) {
          setEditingMessage(null);
          setTranslateOnEdit(false);
          setInputText('');
          setTranslatedPreview('');
          setTranslatedPreviewSource('');
          setPreviewError('');
        }
        return;
      }

      onSendMessage({
        chatId: originChatId,
        accountId: originAccountId,
        sender: 'me',
        text: targetText,
        translatedText: translationOfTarget,
        replyTo: originReplyPayload,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      });

      if (isSameOriginScope(originChatId, originAccountId)) {
        setReplyingTo(null);
        setInputText('');
        setTranslatedPreview('');
        setTranslatedPreviewSource('');
        setPreviewError('');
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chat) return;
    const originChatId = chat.id;
    const originAccountId = currentAccountId;
    const originReplyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;
    try {
      if (file.size > TELEGRAM_MAX_MEDIA) {
        const maxMb = Math.round(TELEGRAM_MAX_MEDIA / (1024 * 1024));
        showSyncNotice(`图片超过最大发送限制 (${maxMb} MB)`);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      const userCaption = inputText.trim();
      onSendMessage({
        chatId: originChatId,
        accountId: originAccountId,
        sender: 'me',
        isImage: true,
        imageUrl: previewUrl,
        imageCaption: userCaption || undefined,
        text: userCaption || '',
        mediaFile: file,
        replyTo: originReplyPayload,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      });
      if (originReplyPayload && isSameOriginScope(originChatId, originAccountId)) setReplyingTo(null);
      if (userCaption && isSameOriginScope(originChatId, originAccountId)) {
        setInputText('');
        setTranslatedPreview('');
        setTranslatedPreviewSource('');
      }
    } catch (err: any) {
      console.warn('Failed to upload image', err);
      if (isSameOriginScope(originChatId, originAccountId)) {
        showSyncNotice(`图片读取失败：${err?.message || '请检查图片文件是否损坏或有读取权限'}`);
      }
    } finally {
      setIsAttachmentMenuOpen(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chat) return;
    const originChatId = chat.id;
    const originAccountId = currentAccountId;
    const originReplyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;
    try {
      if (file.size > TELEGRAM_MAX_MEDIA) {
        const maxMb = Math.round(TELEGRAM_MAX_MEDIA / (1024 * 1024));
        showSyncNotice(`视频超过最大发送限制 (${maxMb} MB)`);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      const userCaption = inputText.trim();

      let duration = 0;
      try {
        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        tempVideo.src = previewUrl;
        await new Promise((resolve) => {
          tempVideo.onloadedmetadata = () => {
            duration = Math.round(tempVideo.duration) || 0;
            resolve(null);
          };
          tempVideo.onerror = () => resolve(null);
          setTimeout(resolve, 800);
        });
      } catch {}

      onSendMessage({
        chatId: originChatId,
        accountId: originAccountId,
        sender: 'me',
        isVideo: true,
        videoUrl: previewUrl,
        videoDuration: duration,
        text: userCaption || `[视频] ${file.name}`,
        mediaFile: file,
        replyTo: originReplyPayload,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      });
      if (isSameOriginScope(originChatId, originAccountId)) {
        if (originReplyPayload) setReplyingTo(null);
        if (userCaption) {
          setInputText('');
          setTranslatedPreview('');
          setTranslatedPreviewSource('');
        }
      }
    } catch (err: any) {
      console.warn('Failed to upload video', err);
      if (isSameOriginScope(originChatId, originAccountId)) {
        showSyncNotice(`视频读取失败：${err?.message || '请检查视频文件是否损坏或有读取权限'}`);
      }
    } finally {
      setIsAttachmentMenuOpen(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleAudioSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chat) return;
    const originChatId = chat.id;
    const originAccountId = currentAccountId;
    const originReplyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;
    try {
      if (file.size > TELEGRAM_MAX_MEDIA) {
        const maxMb = Math.round(TELEGRAM_MAX_MEDIA / (1024 * 1024));
        showSyncNotice(`音频超过最大发送限制 (${maxMb} MB)`);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      let duration = 0;
      try {
        const tempAudio = new Audio(previewUrl);
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            tempAudio.onloadedmetadata = null;
            tempAudio.onerror = null;
            resolve(null);
          }, 1500);
          tempAudio.onloadedmetadata = () => {
            clearTimeout(timer);
            duration = Number.isFinite(tempAudio.duration) && tempAudio.duration > 0 ? Math.max(1, Math.round(tempAudio.duration)) : 0;
            resolve(null);
          };
          tempAudio.onerror = () => {
            clearTimeout(timer);
            resolve(null);
          };
        });
      } catch {}

      onSendMessage({
        chatId: originChatId,
        accountId: originAccountId,
        sender: 'me',
        isAudio: true,
        audioUrl: previewUrl,
        audioDuration: duration,
        text: '🎤 语音消息',
        mediaFile: file,
        replyTo: originReplyPayload,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      });
      if (originReplyPayload && isSameOriginScope(originChatId, originAccountId)) setReplyingTo(null);
    } catch (err: any) {
      console.warn('Failed to upload audio', err);
      if (isSameOriginScope(originChatId, originAccountId)) {
        showSyncNotice(`音频读取失败：${err?.message || '请检查音频文件是否损坏或有读取权限'}`);
      }
    } finally {
      setIsAttachmentMenuOpen(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chat) return;
    const originChatId = chat.id;
    const originAccountId = currentAccountId;
    try {
      if (file.size > TELEGRAM_MAX_MEDIA) {
        const maxMb = Math.round(TELEGRAM_MAX_MEDIA / (1024 * 1024));
        showSyncNotice(`文件超过最大发送限制 (${maxMb} MB)`);
        return;
      }
      const isImg = file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.name);
      const isVid = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(file.name);
      const isAud = file.type.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(file.name);
      const previewUrl = URL.createObjectURL(file);
      const replyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;

      if (isImg) {
        const userCaption = inputText.trim();
        onSendMessage({
          chatId: originChatId,
          accountId: originAccountId,
          sender: 'me',
          isImage: true,
          imageUrl: previewUrl,
          imageCaption: userCaption || undefined,
          text: userCaption || '',
          mediaFile: file,
          replyTo: replyPayload,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        });
        if (userCaption && isSameOriginScope(originChatId, originAccountId)) {
          setInputText('');
          setTranslatedPreview('');
          setTranslatedPreviewSource('');
        }
      } else if (isVid) {
        const userCaption = inputText.trim();
        let duration = 0;
        try {
          const tempVideo = document.createElement('video');
          tempVideo.preload = 'metadata';
          tempVideo.src = previewUrl;
          await new Promise((resolve) => {
            tempVideo.onloadedmetadata = () => {
              duration = Math.round(tempVideo.duration) || 0;
              resolve(null);
            };
            tempVideo.onerror = () => resolve(null);
            setTimeout(resolve, 800);
          });
        } catch {}
        onSendMessage({
          chatId: originChatId,
          accountId: originAccountId,
          sender: 'me',
          isVideo: true,
          videoUrl: previewUrl,
          videoDuration: duration,
          text: userCaption || `[视频] ${file.name}`,
          mediaFile: file,
          replyTo: replyPayload,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        });
        if (userCaption && isSameOriginScope(originChatId, originAccountId)) {
          setInputText('');
          setTranslatedPreview('');
          setTranslatedPreviewSource('');
        }
      } else if (isAud) {
        let duration = 0;
        try {
          const tempAudio = new Audio(previewUrl);
          await new Promise((resolve) => {
            const timer = setTimeout(() => {
              tempAudio.onloadedmetadata = null;
              tempAudio.onerror = null;
              resolve(null);
            }, 1500);
            tempAudio.onloadedmetadata = () => {
              clearTimeout(timer);
              duration = Number.isFinite(tempAudio.duration) && tempAudio.duration > 0 ? Math.max(1, Math.round(tempAudio.duration)) : 0;
              resolve(null);
            };
            tempAudio.onerror = () => {
              clearTimeout(timer);
              resolve(null);
            };
          });
        } catch {}
        onSendMessage({
          chatId: originChatId,
          accountId: originAccountId,
          sender: 'me',
          isAudio: true,
          audioUrl: previewUrl,
          audioDuration: duration,
          text: '🎤 语音消息',
          mediaFile: file,
          replyTo: replyPayload,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        });
      } else {
        onSendMessage({
          chatId: originChatId,
          accountId: originAccountId,
          sender: 'me',
          isFile: true,
          fileName: file.name,
          fileSize: formatMediaSizeLabel(file.size),
          fileUrl: previewUrl,
          text: `[文件] ${file.name}`,
          mediaFile: file,
          replyTo: replyPayload,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        });
      }
      if (replyPayload && isSameOriginScope(originChatId, originAccountId)) setReplyingTo(null);
    } catch (err: any) {
      console.warn('Failed to upload file', err);
      if (isSameOriginScope(originChatId, originAccountId)) {
        showSyncNotice(`文件读取失败：${err?.message || '请检查文件是否损坏或有读取权限'}`);
      }
    } finally {
      setIsAttachmentMenuOpen(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSendSticker = async (sticker: TelegramStickerItem, packTitle?: string) => {
    if (!chat) return;
    const originChatId = chat.id;
    const originAccountId = currentAccountId;
    if (!originChatId.startsWith('tg_') || originAccountId === 'acc_telegram_bot') {
      showSyncNotice('仅已连接的 Telegram 个人账号支持发送官方云端贴纸');
      return;
    }
    setShowEmojiPicker(false);
    const replyToMsgId = replyingTo?.telegramMessageId;
    const replyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;
    const res = await sendTelegramStickerApi({
      accountId: originAccountId,
      chatId: originChatId,
      sticker,
      packTitle,
      replyToMsgId,
      replyTo: replyPayload,
    });
    if (!res.ok) {
      if (isSameOriginScope(originChatId, originAccountId)) {
        showSyncNotice(res.error || '发送官方贴纸失败');
      }
      return;
    }
    if (replyPayload && isSameOriginScope(originChatId, originAccountId)) {
      setReplyingTo(null);
    }
    const isVideoSticker = Boolean(res.videoUrl || res.isVideo || sticker.isVideo);
    const fallbackText = res.text || `${sticker.emoji} [贴纸]`;
    onSendMessage({
      ...(res.id ? { id: res.id } : {}),
      chatId: originChatId,
      accountId: originAccountId,
      sender: 'me',
      isImage: res.isImage ?? !isVideoSticker,
      imageUrl: res.imageUrl ?? (isVideoSticker ? undefined : sticker.thumbUrl),
      isVideo: isVideoSticker,
      videoUrl: res.videoUrl,
      imageCaption: packTitle ? `${sticker.emoji} · ${packTitle}` : fallbackText,
      text: fallbackText,
      replyTo: replyPayload,
      telegramMessageId: res.telegramMessageId,
      deliveryStatus: 'delivered',
      skipCloudRelay: true,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isSendTrigger = sendWithEnter
      ? e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing
      : e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing;
    if (isSendTrigger) {
      e.preventDefault();
      if (isSending) return;
      if (pastedImage) {
        handleSendPastedImage();
      } else {
        handleSendText();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (pastedImage) {
        clearPastedImage(true);
      } else if (editingMessage) {
        setEditingMessage(null);
        setInputText('');
      } else if (replyingTo) {
        setReplyingTo(null);
      } else {
        onCloseChat?.();
      }
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    if (!text) return;
    let success = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        success = true;
      } else {
        throw new Error('Fallback to execCommand');
      }
    } catch {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        success = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (e) {
        console.warn('execCommand copy fallback failed', e);
      }
    }
    if (success) {
      setCopiedId(id);
      setSyncNotice('✅ 文字已成功复制到剪贴板');
      setTimeout(() => {
        setCopiedId(null);
        setSyncNotice(null);
      }, 2000);
    } else {
      setSyncNotice('复制失败，请直接在消息中划选文字后按 Ctrl+C');
      setTimeout(() => setSyncNotice(null), 3000);
    }
  };

  const copyImageToClipboard = async (imageUrl: string, id: string) => {
    if (!imageUrl) return;
    let effectiveImageUrl = resolveDisplayUrl(imageUrl) || '';
    if (!effectiveImageUrl) return;
    if (isSignedResourceUrlExpiringSoon(effectiveImageUrl)) {
      const refreshed = await triggerSilentUrlRefresh(effectiveImageUrl, true);
      if (refreshed) effectiveImageUrl = refreshed;
    }
    try {
      let res = await fetchWithTimeout(effectiveImageUrl, { credentials: 'include' }, 12000);
      if ((res.status === 401 || res.status === 403) && isSignedResourceUrl(effectiveImageUrl)) {
        const refreshed = await triggerSilentUrlRefresh(effectiveImageUrl, true);
        if (refreshed && refreshed !== effectiveImageUrl) {
          effectiveImageUrl = refreshed;
          res = await fetchWithTimeout(effectiveImageUrl, { credentials: 'include' }, 12000);
        }
      }
      const blob = await res.blob();
      let pngBlob = blob;
      if (blob.type !== 'image/png') {
        pngBlob = await new Promise<Blob>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 400;
            canvas.height = img.naturalHeight || 300;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(blob);
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((b) => resolve(b || blob), 'image/png');
          };
          img.onerror = reject;
          img.src = effectiveImageUrl;
        });
      }

      if (navigator.clipboard && typeof navigator.clipboard.write === 'function') {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob }),
        ]);
        setCopiedId(id);
        setSyncNotice('✅ 照片已复制到剪贴板，可直接在其他应用中粘贴');
        setTimeout(() => {
          setCopiedId(null);
          setSyncNotice(null);
        }, 2500);
        return;
      }
      throw new Error('ClipboardItem write not supported');
    } catch (err: any) {
      console.warn('Copy image to clipboard exception:', err);
      // Fallback: download the image
      try {
        const a = document.createElement('a');
        a.href = imageUrl;
        a.download = `tg_photo_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setSyncNotice('已为您下载保存该照片');
        setTimeout(() => setSyncNotice(null), 2500);
      } catch {
        setSyncNotice('复制照片失败，请右键选择另存为');
        setTimeout(() => setSyncNotice(null), 3000);
      }
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          try {
            if (file.size > TELEGRAM_MAX_MEDIA) {
              const maxMb = Math.round(TELEGRAM_MAX_MEDIA / (1024 * 1024));
              showSyncNotice(`剪贴板图片超过最大发送限制 (${maxMb} MB)`);
              return;
            }
            const previewUrl = URL.createObjectURL(file);
            if (pastedImageRef.current?.dataUrl?.startsWith('blob:')) {
              try {
                URL.revokeObjectURL(pastedImageRef.current.dataUrl);
              } catch {}
            }
            setPastedImage({
              dataUrl: previewUrl,
              file,
              caption: inputText.trim() || undefined,
            });
            setSyncNotice('已捕获剪贴板照片，点击发送或按 Enter 即可发出');
            setTimeout(() => setSyncNotice(null), 3000);
          } catch (err) {
            console.warn('Failed to parse pasted image', err);
            setSyncNotice('剪贴板照片解析失败，请使用附件上传');
            setTimeout(() => setSyncNotice(null), 3000);
          }
          return;
        }
      }
    }
  };

  const handleSendPastedImage = () => {
    if (!pastedImage || !chat) return;
    const originChatId = chat.id;
    const originAccountId = currentAccountId;
    const userCaption = inputText.trim() || pastedImage.caption || '';
    onSendMessage({
      chatId: originChatId,
      accountId: originAccountId,
      sender: 'me',
      isImage: true,
      imageUrl: pastedImage.dataUrl,
      imageCaption: userCaption || undefined,
      text: userCaption || '',
      mediaFile: pastedImage.file,
      replyTo: replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    });
    if (replyingTo) setReplyingTo(null);
    clearPastedImage(false);
    setInputText('');
    setTranslatedPreview('');
    setTranslatedPreviewSource('');
  };

  const handleTranscribeAudio = async (msg: Message) => {
    if (!msg.id) return;

    if (!msg.audioUrl && !msg.sttText) {
      setSyncNotice('该消息缺少有效音频数据，无法进行语音转写');
      setTimeout(() => setSyncNotice(null), 3000);
      return;
    }

    const originChatId = msg.chatId || chat?.id || '';
    const originAccountId = msg.accountId || currentAccountId || '';
    const persistPatch = (patch: Partial<Message>) => {
      if (onUpdateMessage) {
        onUpdateMessage(msg.id, patch, {
          chatId: originChatId,
          accountId: originAccountId,
        });
        return;
      }
      setUncontrolledMsgPatches((prev) => ({
        ...prev,
        [msg.id]: { ...prev[msg.id], ...patch },
      }));
      if (originChatId) {
        saveLocalMessage(originChatId, { ...msg, ...patch }, originAccountId);
      }
      if (typeof patch.sttText === 'string') {
        void updateMessageSttInDb(
          msg.id,
          patch.sttText,
          typeof patch.translatedText === 'string' ? patch.translatedText : undefined,
          {
            chatId: originChatId || undefined,
            telegramMessageId: msg.telegramMessageId,
            accountId: originAccountId || undefined,
          }
        ).catch(() => {});
      }
    };

    setTranscribingMap((prev) => ({ ...prev, [msg.id]: true }));

    try {
      let transcribed = msg.sttText;
      if (!transcribed && msg.audioUrl) {
        transcribed = await transcribeAudio(msg.audioUrl, undefined, customLLMConfig);
      }

      if (!transcribed || !transcribed.trim()) {
        setSyncNotice('语音转写未能识别出文字内容');
        setTimeout(() => setSyncNotice(null), 3000);
        return;
      }

      // Immediately persist STT transcript before translation so translation errors cannot lose it
      persistPatch({ sttText: transcribed });

      const currentInboundTarget = getInboundTargetLanguage(chat, translationSettings);
      const transcribedNorm = normalizeChatLangCode(detectClientLangCode(transcribed));
      const inboundNorm = normalizeChatLangCode(currentInboundTarget);
      const isTranscribedAlreadyTarget =
        transcribedNorm !== 'auto' &&
        inboundNorm !== 'auto' &&
        (transcribedNorm === inboundNorm ||
          (transcribedNorm === 'zh-cn' && inboundNorm === 'zh') ||
          (transcribedNorm === 'zh' && inboundNorm === 'zh-cn'));
      if (isTranscribedAlreadyTarget) {
        persistPatch({
          sttText: transcribed,
          translatedText: '',
          translationError: undefined,
          translationErrorChannel: undefined,
        });
        return;
      }

      const isDualOffMode = Boolean(
        customLLMConfig && (customLLMConfig.enabled === false || customLLMConfig.explicitlyDisabled)
      );
      const isCustomMode = Boolean(
        !isDualOffMode && customLLMConfig?.enabled && customLLMConfig?.engineMode === 'custom'
      );
      const effectiveEngine =
        isGroupOrChannelChat || isDualOffMode
          ? 'google'
          : isCustomMode
          ? 'custom_llm'
          : translationSettings?.preferredEngine === 'google'
          ? 'google'
          : 'gemini';

      try {
        const translated = await translateText(
          transcribed,
          'Auto',
          currentInboundTarget,
          customLLMConfig,
          effectiveEngine,
          translationSettings?.googleApiKey,
          isGroupOrChannelChat ? undefined : translationSettings?.geminiModel,
          isGroupOrChannelChat ? undefined : translationSettings?.geminiApiKey,
          isGroupOrChannelChat ? undefined : translationSettings?.customModelName,
          isGroupOrChannelChat ? { purpose: 'group', isGroup: true } : undefined
        );
        persistPatch({
          sttText: transcribed,
          translatedText: translated,
          translationError: undefined,
          translationErrorChannel: undefined,
        });
      } catch {
        const errChannel: Message['translationErrorChannel'] =
          effectiveEngine === 'custom_llm'
            ? 'live_custom_llm'
            : effectiveEngine === 'google'
            ? 'live_google'
            : 'live_gemini';
        const transErrMsg = '翻译失败，请检查翻译通道';
        persistPatch({
          sttText: transcribed,
          translationError: transErrMsg,
          translationErrorChannel: errChannel,
        });
        setSyncNotice(transErrMsg);
        setTimeout(() => setSyncNotice(null), 3500);
      }
    } catch (err: any) {
      console.error('Transcribe failed', err);
      setSyncNotice(`语音转写失败：${err?.message || '请检查网络或大模型配置'}`);
      setTimeout(() => setSyncNotice(null), 3500);
    } finally {
      setTranscribingMap((prev) => ({ ...prev, [msg.id]: false }));
    }
  };

  const handlePlayAudio = async (msgId: string, audioUrl?: string) => {
    if (playingAudioId === msgId) {
      audioPlaySeqRef.current += 1;
      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.ontimeupdate = null;
        audioRef.current.onloadedmetadata = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingAudioId(null);
      return;
    }

    const playSeq = ++audioPlaySeqRef.current;
    const matchedMsg =
      messages.find((m) => m.id === msgId) ||
      cloudSearchResults?.find((m) => m.id === msgId);
    const originChatId = matchedMsg?.chatId || chat?.id || '';
    const originAccountId = matchedMsg?.accountId || currentAccountId || '';

    if (audioUrl) {
      let effectiveUrl = resolveDisplayUrl(audioUrl) || '';
      if (!effectiveUrl) return;
      if (isSignedResourceUrlExpiringSoon(effectiveUrl)) {
        const fresh = await triggerSilentUrlRefresh(effectiveUrl, true);
        if (audioPlaySeqRef.current !== playSeq) return;
        if (fresh) {
          effectiveUrl = fresh;
          onUpdateMessage?.(msgId, { audioUrl: fresh }, { chatId: originChatId, accountId: originAccountId });
        }
      }
      if (audioPlaySeqRef.current !== playSeq) return;
      if (!audioRef.current) {
        audioRef.current = new Audio();
      } else {
        audioRef.current.onended = null;
        audioRef.current.ontimeupdate = null;
        audioRef.current.onloadedmetadata = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
      }
      const audioEl = audioRef.current;
      let retriedWithFreshUrl = false;
      audioEl.src = effectiveUrl;
      setPlayingAudioId(msgId);

      audioEl.onloadedmetadata = () => {
        if (audioPlaySeqRef.current !== playSeq) return;
        if (
          (!matchedMsg?.audioDuration || matchedMsg.audioDuration <= 0) &&
          Number.isFinite(audioEl.duration) &&
          audioEl.duration > 0
        ) {
          const decodedSeconds = Math.max(1, Math.round(audioEl.duration));
          onUpdateMessage?.(
            msgId,
            { audioDuration: decodedSeconds },
            { chatId: originChatId, accountId: originAccountId }
          );
        }
      };

      audioEl.onended = () => {
        if (audioPlaySeqRef.current !== playSeq) return;
        setPlayingAudioId(null);
        setAudioProgress((prev) => ({ ...prev, [msgId]: 0 }));
      };

      audioEl.ontimeupdate = () => {
        if (audioPlaySeqRef.current !== playSeq) return;
        if (audioEl.duration) {
          const prog = (audioEl.currentTime / audioEl.duration) * 100;
          setAudioProgress((prev) => ({ ...prev, [msgId]: prog }));
        }
      };

      audioEl.onerror = async () => {
        if (audioPlaySeqRef.current !== playSeq) return;
        if (!retriedWithFreshUrl && isSignedResourceUrl(effectiveUrl)) {
          retriedWithFreshUrl = true;
          const nextUrl = await triggerSilentUrlRefresh(effectiveUrl, true);
          if (audioPlaySeqRef.current !== playSeq) return;
          if (nextUrl && nextUrl !== effectiveUrl && audioRef.current === audioEl) {
            effectiveUrl = nextUrl;
            onUpdateMessage?.(msgId, { audioUrl: nextUrl }, { chatId: originChatId, accountId: originAccountId });
            audioEl.src = nextUrl;
            audioEl.play().catch(() => {
              if (audioPlaySeqRef.current !== playSeq) return;
              setPlayingAudioId(null);
              setAudioProgress((prev) => ({ ...prev, [msgId]: 0 }));
              setSyncNotice('语音音频加载失败，请检查网络或重新生成');
              setTimeout(() => setSyncNotice(null), 3000);
            });
            return;
          }
        }
        if (audioPlaySeqRef.current !== playSeq) return;
        setPlayingAudioId(null);
        setAudioProgress((prev) => ({ ...prev, [msgId]: 0 }));
        setSyncNotice('语音音频加载失败，请检查网络或重新生成');
        setTimeout(() => setSyncNotice(null), 3000);
      };

      audioEl.play().catch((err) => {
        if (audioPlaySeqRef.current !== playSeq) return;
        setPlayingAudioId(null);
        setSyncNotice(`语音播放失败：${err?.message || '浏览器阻止或音频不可用'}`);
        setTimeout(() => setSyncNotice(null), 3000);
      });
    } else {
      // 纯净真实执行：坚决杜绝任何假数据兜底，无真实音频时不进行任何伪造播放
      setPlayingAudioId(null);
      setAudioProgress((prev) => ({ ...prev, [msgId]: 0 }));
      setSyncNotice('当前语音消息未包含有效音频文件，已阻止伪造发音');
      setTimeout(() => setSyncNotice(null), 3000);
    }
  };

  const handleToggleRecordMic = async () => {
    if (isRecordingMic) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      clearInterval(recordTimerRef.current);
      setIsRecordingMic(false);
    } else {
      if (!chat) return;
      const originChatId = chat.id;
      const originAccountId = currentAccountId;
      const originReplyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderRef.current = new MediaRecorder(stream);
        audioChunksRef.current = [];

        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorderRef.current.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          if (!audioBlob || audioBlob.size === 0) {
            if (isSameOriginScope(originChatId, originAccountId)) {
              setSyncNotice('麦克风录音数据为空，已取消发送');
              setTimeout(() => setSyncNotice(null), 3000);
            }
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, {
            type: audioBlob.type || 'audio/webm',
          });
          const audioUrl = URL.createObjectURL(audioFile);
          let recordedSeconds = recordDurationRef.current > 0 ? recordDurationRef.current : 0;
          try {
            const probe = new Audio(audioUrl);
            await new Promise((resolve) => {
              const timer = setTimeout(() => {
                probe.onloadedmetadata = null;
                probe.onerror = null;
                resolve(null);
              }, 1200);
              probe.onloadedmetadata = () => {
                clearTimeout(timer);
                if (Number.isFinite(probe.duration) && probe.duration > 0) {
                  recordedSeconds = Math.max(1, Math.round(probe.duration));
                }
                resolve(null);
              };
              probe.onerror = () => {
                clearTimeout(timer);
                resolve(null);
              };
            });
          } catch {}

          onSendMessage({
            chatId: originChatId,
            accountId: originAccountId,
            sender: 'me',
            isAudio: true,
            audioDuration: recordedSeconds,
            audioUrl,
            mediaFile: audioFile,
            text: '🎤 语音消息',
            replyTo: originReplyPayload,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
          });
          if (originReplyPayload && isSameOriginScope(originChatId, originAccountId)) setReplyingTo(null);
          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorderRef.current.start();
        setIsRecordingMic(true);
        setRecordDuration(0);
        recordDurationRef.current = 0;
        recordTimerRef.current = setInterval(() => {
          recordDurationRef.current += 1;
          setRecordDuration(recordDurationRef.current);
        }, 1000);
      } catch (err) {
        console.warn('Microphone permission or recording failed', err);
        setSyncNotice('无法访问麦克风，请检查浏览器权限');
        setTimeout(() => setSyncNotice(null), 3500);
      }
    }
  };

  const probeSynthesizedAudioDuration = (src: string): Promise<number> => {
    return new Promise((resolve) => {
      const probe = new Audio();
      const timer = setTimeout(() => {
        cleanup();
        resolve(1);
      }, 6000);
      const cleanup = () => {
        clearTimeout(timer);
        probe.onloadedmetadata = null;
        probe.onerror = null;
      };
      probe.onloadedmetadata = () => {
        const dur = probe.duration;
        cleanup();
        resolve(Number.isFinite(dur) && dur > 0 ? Math.max(1, Math.round(dur)) : 1);
      };
      probe.onerror = () => {
        cleanup();
        resolve(1);
      };
      probe.src = src;
    });
  };

  const handleTriggerVoiceCloneSend = (voiceData: {
    text: string;
    audioUrl?: string;
    audioDuration: number;
    voiceName: string;
    voiceTone: string;
    isMasterVoice?: boolean;
    chatId?: string;
    accountId?: string;
    replyTo?: Message['replyTo'];
  }) => {
    if (!voiceData.audioUrl) {
      setSyncNotice('缺少有效合成音频，已中止发送');
      setTimeout(() => setSyncNotice(null), 3500);
      return;
    }

    const targetChatId = voiceData.chatId ?? chat?.id;
    const targetAccountId = voiceData.accountId ?? currentAccountId;
    const targetReplyTo =
      voiceData.replyTo !== undefined
        ? voiceData.replyTo
        : replyingTo
        ? buildReplyPayload(replyingTo, chat?.title)
        : undefined;

    setIsVoiceStudioOpen(false);
    onSendMessage({
      chatId: targetChatId,
      accountId: targetAccountId,
      sender: 'me',
      isAudio: true,
      audioDuration: voiceData.audioDuration,
      audioUrl: voiceData.audioUrl,
      text: '🎤 语音消息',
      sttText: voiceData.text,
      voiceName: voiceData.voiceName,
      voiceTone: voiceData.voiceTone,
      isMasterVoice: voiceData.isMasterVoice,
      replyTo: targetReplyTo,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    });
    if (!targetChatId || isSameOriginScope(targetChatId, targetAccountId)) {
      if (replyingTo) setReplyingTo(null);
      setInputText('');
      setTranslatedPreview('');
      setTranslatedPreviewSource('');
      setPreviewError('');
    }
  };

  const handleDirectVoiceSynthesis = async () => {
    if (isSynthesizingVoice || isSending) return;
    const rawText = inputText.trim();
    if (!rawText) {
      showSyncNotice('请先输入内容', 3000);
      return;
    }
    if (!chat) return;

    const originChatId = chat.id;
    const originAccountId = currentAccountId;
    const originReplyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;
    const mv = masterVoiceprint || getMasterVoiceprint();
    const isMasterVoiceClone = Boolean(
      mv?.cloneMode === 'voice_clone' && (mv.sampleId || mv.sampleAudioUrl || mv.cloneVoiceId)
    );
    const hasSavedVoice = Boolean(mv && (isMasterVoiceClone || mv.baseVoice));
    if (!hasSavedVoice || !mv) {
      showSyncNotice('尚未保存声纹样本或预设音色，请先在右侧「音色」面板配置并保存', 4000);
      return;
    }

    setIsSynthesizingVoice(true);
    try {
      // 1. 文本与翻译联动判断
      const shouldAutoTranslate =
        isChatTransEnabled &&
        translationSettings?.autoTranslateOutbound !== false &&
        (!editingMessage || translateOnEdit);
      let speechText = rawText;

      if (shouldAutoTranslate && hasTranslatableLetters(rawText)) {
        const inputNormCode = normalizeChatLangCode(detectClientLangCode(rawText));
        const targetNormCode = normalizeChatLangCode(outboundTargetLang);
        const isAlreadyTargetLang =
          inputNormCode !== 'auto' && targetNormCode !== 'auto' && inputNormCode === targetNormCode;

        if (!isAlreadyTargetLang) {
          if (previewError && translatedPreviewSource === rawText) {
            showSyncNotice('请确认翻译通道流畅', 4000);
            return;
          }
          const hasFreshPreview = Boolean(
            translatedPreview.trim() && translatedPreviewSource === rawText
          );
          if (hasFreshPreview) {
            speechText = translatedPreview.trim();
          } else {
            try {
              const trans = await translateText(
                rawText,
                'Auto',
                outboundTargetLang,
                customLLMConfig,
                effectiveOutboundEngine,
                translationSettings?.googleApiKey,
                isGroupOrChannelChat ? undefined : translationSettings?.geminiModel,
                isGroupOrChannelChat ? undefined : translationSettings?.geminiApiKey,
                isGroupOrChannelChat ? undefined : translationSettings?.customModelName,
                isGroupOrChannelChat ? { purpose: 'group', isGroup: true } : undefined
              );
              if (!trans || !trans.trim()) {
                setPreviewError('译文为空');
                setTranslatedPreview('');
                setTranslatedPreviewSource(rawText);
                showSyncNotice('请确认翻译通道流畅', 4000);
                return;
              }
              speechText = trans.trim();
            } catch (err: any) {
              setPreviewError(err?.message || '翻译失败');
              setTranslatedPreview('');
              setTranslatedPreviewSource(rawText);
              showSyncNotice('请确认翻译通道流畅', 4000);
              return;
            }
          }
        }
      }

      // 2. 读取已保存声纹模型与网关参数，直接调用合成接口
      const isCustomPriority = Boolean(
        customLLMConfig &&
          customLLMConfig.enabled !== false &&
          !customLLMConfig.explicitlyDisabled &&
          customLLMConfig.engineMode === 'custom'
      );
      const isCustomGeminiGateway = Boolean(
        isCustomPriority &&
          (customLLMConfig?.protocol === 'gemini' ||
            (customLLMConfig?.baseUrl || '').toLowerCase().includes('googleapis.com'))
      );
      const isCustomOpenAiGateway = Boolean(isCustomPriority && !isCustomGeminiGateway);

      const savedTts = mv.ttsModel?.trim() || '';
      let ttsEngine = 'gemini-3.8-flash-tts';
      if (isMasterVoiceClone) {
        const cloneFallback =
          mv.cloneProvider === 'elevenlabs'
            ? 'eleven_multilingual_v2'
            : mv.cloneProvider === 'siliconflow_cosyvoice'
            ? 'FunAudioLLM/CosyVoice2-0.5B'
            : 'tts-1';
        ttsEngine = savedTts && !/^gemini-/i.test(savedTts) ? savedTts : cloneFallback;
      } else if (isCustomOpenAiGateway) {
        ttsEngine = savedTts && !/^gemini-/i.test(savedTts) ? savedTts : 'tts-1';
      } else if (savedTts) {
        ttsEngine = savedTts;
      }

      const speedRate = typeof mv.rate === 'number' && Number.isFinite(mv.rate) ? mv.rate : 1.0;
      const pitchRate = typeof mv.pitch === 'number' && Number.isFinite(mv.pitch) ? mv.pitch : 1.0;
      const voiceClonePayload: VoiceCloneRequestOptions | undefined = isMasterVoiceClone
        ? {
            cloneMode: 'voice_clone',
            sampleId: mv.sampleId,
            sampleAudioDataUrl: !mv.sampleId ? mv.sampleAudioUrl : undefined,
            sampleName: mv.name,
            sampleTranscript: mv.sampleTranscript,
            cloneProvider: mv.cloneProvider || 'elevenlabs',
            cloneGatewayUrl: mv.cloneGatewayUrl,
            cloneApiKey: mv.cloneApiKey,
            cloneVoiceId: mv.cloneVoiceId,
          }
        : undefined;

      const res = await generateTTSVoice(
        speechText,
        mv.baseVoice || 'Kore',
        'Natural, friendly and conversational',
        customLLMConfig,
        'high',
        '日常',
        ttsEngine,
        {
          speechRate: speedRate,
          pitch: pitchRate,
          ...(voiceClonePayload ? { voiceClone: voiceClonePayload } : {}),
        }
      );

      if (!res?.audioUrl || res.error) {
        showSyncNotice('请检查合成通道', 4000);
        return;
      }

      if (res.clonedVoiceId && isMasterVoiceClone && res.clonedVoiceId !== mv.cloneVoiceId) {
        const updatedVp: MasterVoiceprint = {
          ...mv,
          cloneVoiceId: res.clonedVoiceId,
          updatedAt: Date.now(),
        };
        saveMasterVoiceprint(updatedVp);
        setMasterVoiceprint(updatedVp);
      }

      const audioDuration = await probeSynthesizedAudioDuration(res.audioUrl);
      handleTriggerVoiceCloneSend({
        text: speechText,
        audioUrl: res.audioUrl,
        audioDuration,
        voiceName: isMasterVoiceClone
          ? `${mv.name || '个人克隆声纹'} (声纹克隆)`
          : `${mv.name || '个人预设'} (${mv.baseVoice || 'Kore'})`,
        voiceTone: '💫 自然日常',
        isMasterVoice: true,
        chatId: originChatId,
        accountId: originAccountId,
        replyTo: originReplyPayload,
      });
    } catch {
      if (isSameOriginScope(originChatId, originAccountId)) {
        showSyncNotice('请检查合成通道', 4000);
      }
    } finally {
      setIsSynthesizingVoice(false);
    }
  };

  if (!chat) {
    return (
      <div className="flex-1 min-w-0 bg-[#f4f7fb] dark:bg-[#060b12] aurora:bg-[#081116] tg-chat-pattern flex flex-col items-center justify-center select-none text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] transition-colors px-6">
        <div className="flex flex-col items-center text-center max-w-xs space-y-2.5 px-6 py-5 rounded-2xl bg-white/80 dark:bg-[#0a1320]/80 aurora:bg-[#0e1b23]/82 backdrop-blur-md border border-[#e2e8f0] dark:border-[#162436] aurora:border-[#2dd4bf]/35 shadow-xs aurora:shadow-[0_0_28px_rgba(34,211,238,0.12)]">
          <div className="w-10 h-10 rounded-xl bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] border border-[#bfdbfe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/35 flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-[13px] font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
            选择左侧会话开始协同
          </div>
          <p className="text-[11.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#86a4b0] leading-relaxed">
            可随时点击最左侧导航栏弹出独立的记忆、大模型、翻译、音色与人设配置页。
          </p>
        </div>
      </div>
    );
  }

  const baseDisplayedMessages = cloudSearchResults !== null
    ? cloudSearchResults
        .filter((r) => !isMessageDeleted(r.id, currentAccountId, chat?.id))
        .map((r) => {
          const rTgId = resolveClientTelegramMessageId(r);
          const live = messages.find((m) => {
            if (m.id === r.id) return true;
            if (rTgId !== undefined) {
              return resolveClientTelegramMessageId(m) === rTgId;
            }
            return false;
          });
          if (!live) return r;
          return {
            ...r,
            text: live.text,
            sttText: live.sttText ?? r.sttText,
            translatedText: live.translatedText ?? r.translatedText,
            translationError: live.translationError ?? r.translationError,
            translationErrorChannel: live.translationErrorChannel ?? r.translationErrorChannel,
            imageCaption: live.imageCaption ?? r.imageCaption,
            isPinned: live.isPinned,
            isEdited: live.isEdited,
            status: live.status,
            deliveryStatus: live.deliveryStatus,
          };
        })
    : chatSearchQuery.trim()
    ? messages.filter((m) => {
        const patched = uncontrolledMsgPatches[m.id] ? { ...m, ...uncontrolledMsgPatches[m.id] } : m;
        const q = chatSearchQuery.toLowerCase();
        return (
          patched.text?.toLowerCase().includes(q) ||
          patched.translatedText?.toLowerCase().includes(q) ||
          patched.sttText?.toLowerCase().includes(q) ||
          patched.fileName?.toLowerCase().includes(q) ||
          patched.imageCaption?.toLowerCase().includes(q) ||
          patched.forwardFrom?.toLowerCase().includes(q)
        );
      })
    : messages;

  const displayedMessages = Object.keys(uncontrolledMsgPatches).length > 0
    ? baseDisplayedMessages.map((m) =>
        uncontrolledMsgPatches[m.id] ? { ...m, ...uncontrolledMsgPatches[m.id] } : m
      )
    : baseDisplayedMessages;

  const pinnedMessages = messages.filter((m) => m.isPinned);
  const safePinnedIndex = pinnedMessages.length > 0 ? pinnedBannerIndex % pinnedMessages.length : 0;
  const activePinnedMessage = pinnedMessages[safePinnedIndex] || null;

  const isModelDualOff = Boolean(
    customLLMConfig && (customLLMConfig.enabled === false || customLLMConfig.explicitlyDisabled)
  );
  const activeModelDisplay = isModelDualOff
    ? '大模型已关闭'
    : customLLMConfig?.engineMode === 'custom'
      ? customLLMConfig.modelName || '自有模型网关'
      : 'HumanSense 云端引擎';

  return (
    <div className="flex-1 min-w-0 bg-[#f4f7fb] dark:bg-[#060b12] aurora:bg-[#081116] flex flex-col h-full relative overflow-hidden transition-colors">
      {/* 1. Official Telegram Top Bar Header */}
      <header className="h-[56px] bg-white/90 dark:bg-[#09111d]/90 aurora:bg-[#0d171d]/92 backdrop-blur-md border-b border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] flex items-center justify-between px-4 shrink-0 z-10 transition-colors">
        {/* Left: Contact Info (Click to view Profile & Shared Media) */}
        <div
          onClick={() => setChatInfoOpen(true)}
          className="flex items-center gap-3 min-w-0 cursor-pointer hover:opacity-90 transition-opacity"
          title="点击查看联系人资料与共享媒体库"
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden shrink-0 relative"
            style={{ backgroundColor: chat.avatarBg }}
          >
            <span className="text-white text-xs font-semibold select-none">{chat.avatarInitial}</span>
            {chat.avatarUrl && (
              <img
                src={resolveDisplayUrl(chat.avatarUrl)}
                alt={chat.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover absolute inset-0"
                onLoad={(e) => {
                  e.currentTarget.style.display = '';
                }}
                onError={(e) => {
                  const imgEl = e.currentTarget;
                  void triggerSilentUrlRefresh(chat.avatarUrl, true).then((nextUrl) => {
                    if (!nextUrl) {
                      imgEl.style.display = 'none';
                    }
                  });
                }}
              />
            )}
            {chat.isVerified && (
              <div className="absolute inset-0 bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#14b8a6] flex items-center justify-center text-white">
                <Check className="w-4 h-4 stroke-[2.5]" />
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[14px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] truncate leading-tight">
                {chat.title}
              </span>
              {!chat.isGroup && !chat.isChannel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setChatInfoOpen(true);
                  }}
                  title="设置/修改好友备注"
                  className="p-0.5 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] rounded-sm transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              )}
              {chat.isVerified && (
                <span className="w-3.5 h-3.5 bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#14b8a6] rounded-full flex items-center justify-center text-white shrink-0">
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                </span>
              )}
            </div>
            <div
              className={`text-[11.5px] leading-none mt-0.5 tabular-nums ${
                chat.isOnline
                  ? 'text-emerald-600 dark:text-emerald-400 aurora:text-emerald-400 font-medium'
                  : chat.isGroup || chat.isChannel
                  ? 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
                  : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]'
              }`}
            >
              {chat.isChannel
                ? typeof chat.memberCount === 'number'
                  ? `${chat.memberCount} 位订阅者`
                  : '公开频道'
                : chat.isGroup
                ? typeof chat.memberCount === 'number'
                  ? `${chat.memberCount} 位成员${
                      typeof chat.onlineCount === 'number' && chat.onlineCount > 0
                        ? ` · ${chat.onlineCount} 人在线`
                        : ''
                    }`
                  : '群组'
                : chat.isBot
                ? '机器人 (Bot)'
                : chat.statusText || (chat.isOnline ? '在线' : '状态未知')}
            </div>
          </div>
        </div>

        {/* Right: Translation Bar Toggle + Real Actions */}
        <div className="flex items-center gap-1.5 shrink-0 text-[#64748b] dark:text-[#9bb3c9] aurora:text-[#7e9aa5]">
          {/* Bidirectional Translation Bar Toggle */}
          <button
            type="button"
            onClick={() => setIsTranslateBarVisible(!isTranslateBarVisible)}
            title={isChatTransEnabled ? '展开或收起实时翻译栏' : '当前会话翻译已关闭（点击展开配置或重新开启）'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border transition-colors cursor-pointer ${
              !isChatTransEnabled
                ? 'bg-slate-100 border-slate-300 text-slate-500 hover:text-slate-800 dark:bg-[#0e1726] dark:border-[#1e3148] dark:text-[#7b93ad] dark:hover:text-white aurora:bg-[#0e1920] aurora:border-[#1e343e] aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8]'
                : isTranslateBarVisible
                  ? 'bg-[#e8f3ff] border-[#bfdbfe] text-[#2481cc] dark:bg-[#132234] dark:border-[#2ba0ff]/40 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:border-[#2dd4bf]/45 aurora:text-[#5eead4]'
                  : 'bg-[#f8fafc] border-[#e2e8f0] text-[#64748b] hover:text-[#0f172a] dark:bg-[#0e1726] dark:border-[#1a2b40] dark:text-[#8aa0b8] dark:hover:text-white aurora:bg-[#101c23] aurora:border-[#1e343e] aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8]'
            }`}
          >
            <Languages className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {chatTransScopeLabel}: {isChatTransEnabled ? (isTranslateBarVisible ? '开启' : '开启') : '已关闭'}
            </span>
          </button>

          {/* Telegram Cloud History Sync Button */}
          {chat.id.startsWith('tg_') && (
            <button
              type="button"
              onClick={handleSyncCloudMessages}
              disabled={isSyncingCloud}
              title="同步云端消息"
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                isSyncingCloud
                  ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4]'
                  : 'hover:bg-[#f1f5f9] dark:hover:bg-[#142236] aurora:hover:bg-[#15252e] text-[#64748b] dark:text-[#9bb3c9] aurora:text-[#7e9aa5] hover:text-[#2481cc] dark:hover:text-white aurora:hover:text-[#5eead4]'
              }`}
            >
              <RotateCw className={`w-4 h-4 ${isSyncingCloud ? 'animate-spin text-[#2481cc] aurora:text-[#2dd4bf]' : ''}`} />
            </button>
          )}

          {/* In-Chat Search Button */}
          <button
            type="button"
            onClick={() => setIsSearchingInChat(!isSearchingInChat)}
            title="搜索消息"
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              isSearchingInChat
                ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4]'
                : 'hover:bg-[#f1f5f9] dark:hover:bg-[#142236] aurora:hover:bg-[#15252e] text-[#64748b] dark:text-[#9bb3c9] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8]'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* 当前联系人全息记忆按钮 */}
          <button
            type="button"
            onClick={onOpenCustomerMemory || onOpenKnowledgeEvolution}
            title="全息记忆"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border transition-colors cursor-pointer ${
              isCustomerMemoryOpen
                ? 'bg-[#2481cc] border-[#2481cc] text-white dark:bg-[#2ba0ff]/20 dark:border-[#2ba0ff]/50 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:border-[#2dd4bf]/55 aurora:text-[#5eead4]'
                : 'bg-[#f0f7ff] hover:bg-[#e0efff] dark:bg-[#102033] dark:hover:bg-[#142840] aurora:bg-[#10242b] aurora:hover:bg-[#132d36] border-[#dbeafe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/30 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span className="hidden lg:inline font-semibold">全息记忆</span>
          </button>

          {/* More Options / Chat Info Drawer */}
          <button
            type="button"
            onClick={() => setChatInfoOpen(true)}
            title="更多与联系人资料"
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              isChatInfoOpen
                ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#132234] dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4]'
                : 'hover:bg-[#f1f5f9] dark:hover:bg-[#142236] aurora:hover:bg-[#15252e] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8]'
            }`}
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {/* Close Chat Button (Esc) */}
          {onCloseChat && (
            <button
              type="button"
              onClick={onCloseChat}
              title="关闭 (Esc)"
              className="w-8 h-8 rounded-lg hover:bg-[#f1f5f9] dark:hover:bg-[#142236] aurora:hover:bg-[#15252e] flex items-center justify-center hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] transition-colors cursor-pointer text-[#64748b] dark:text-[#9bb3c9] aurora:text-[#7e9aa5]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* In-Chat Search Bar */}
      {isSearchingInChat && (
        <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] px-4 py-2 flex items-center gap-2 text-xs animate-in fade-in duration-150">
          <Search className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] shrink-0" />
          <input
            type="text"
            value={chatSearchQuery}
            onChange={(e) => {
              setChatSearchQuery(e.target.value);
              if (cloudSearchResults !== null) setCloudSearchResults(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot') {
                e.preventDefault();
                void handleCloudSearch();
              }
            }}
            placeholder={chat.isChannel ? '搜索频道帖子 (Enter 搜云端)...' : '搜索消息 (Enter 搜云端历史)...'}
            className="flex-1 bg-[#f1f5f9] dark:bg-[#08101a] aurora:bg-[#081014] px-3 py-1.5 rounded-lg text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] focus:outline-none placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782]"
            autoFocus
          />
          {chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && chatSearchQuery.trim() && (
            <button
              type="button"
              disabled={isCloudSearching}
              onClick={() => void handleCloudSearch()}
              className="px-2.5 py-1 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] disabled:opacity-50 text-white font-medium text-[11px] shrink-0 cursor-pointer transition-colors"
            >
              {isCloudSearching ? '检索中...' : '云端全文搜索'}
            </button>
          )}
          {cloudSearchResults !== null && (
            <button
              type="button"
              onClick={() => setCloudSearchResults(null)}
              className="px-2 py-1 rounded-lg bg-[#f1f5f9] dark:bg-[#152438] aurora:bg-[#152934] text-[#64748b] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] text-[11px] shrink-0 cursor-pointer"
            >
              返回列表
            </button>
          )}
          {chatSearchQuery && (
            <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] whitespace-nowrap tabular-nums">
              {cloudSearchResults !== null ? `云端 ${displayedMessages.length} 条` : `匹配 ${displayedMessages.length} 条`}
            </span>
          )}
          <button
            onClick={() => {
              setIsSearchingInChat(false);
              setChatSearchQuery('');
              setCloudSearchResults(null);
            }}
            className="p-1 text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Telegram Pinned Message Top Banner */}
      {activePinnedMessage && (
        <div className="bg-[#f0f7ff] dark:bg-[#0d1929] aurora:bg-[#0f1d24] border-b border-[#dbeafe] dark:border-[#18273a] aurora:border-[#182b34] px-4 py-2 flex items-center justify-between text-xs animate-in fade-in duration-150">
          <button
            type="button"
            onClick={() => {
              const targetEl = scrollViewportRef.current?.querySelector(
                `[data-msg-id="${CSS.escape(activePinnedMessage.id)}"]`
              ) as HTMLElement | null;
              if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setHighlightedMsgId(activePinnedMessage.id);
                setTimeout(() => setHighlightedMsgId((cur) => (cur === activePinnedMessage.id ? null : cur)), 1800);
              } else {
                showSyncNotice('该置顶消息不在当前已加载窗口，可点击上方“加载更早历史消息”拉取', 3000);
              }
            }}
            className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer hover:opacity-85 transition-opacity"
            title="点击定位到当前置顶消息"
          >
            <Pin className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] shrink-0 fill-current" />
            <div className="min-w-0 truncate">
              <span className="font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] mr-1.5">
                置顶消息{pinnedMessages.length > 1 ? ` (${safePinnedIndex + 1}/${pinnedMessages.length})` : ''}:
              </span>
              <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
                {activePinnedMessage.text ||
                  (activePinnedMessage.isImage ? '🖼️ [图片]' : activePinnedMessage.isAudio ? '🎤 [语音]' : '消息')}
              </span>
            </div>
          </button>
          {pinnedMessages.length > 1 && (
            <button
              type="button"
              onClick={() => setPinnedBannerIndex((i) => (i + 1) % pinnedMessages.length)}
              className="text-xs text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] p-1 cursor-pointer shrink-0 ml-1"
              title="下一条置顶消息"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onTogglePinMessage?.(activePinnedMessage.id)}
            className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] p-1 cursor-pointer shrink-0 ml-1"
            title="取消置顶"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Cloud Sync & Protection Notice Banner */}
      {syncNotice && (() => {
        const isAlertNotice = /静默|中断|失败|断连|阻断|超时|未连通|异常|错误|冷却/.test(syncNotice);
        return (
          <div
            className={`border-b px-4 py-2 text-xs flex items-center justify-between animate-in fade-in duration-150 ${
              isAlertNotice
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 aurora:text-amber-300'
                : 'bg-[#e8f3ff] border-[#bfdbfe] text-[#2481cc] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/30 dark:text-[#2ba0ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4]'
            }`}
          >
            <div className="flex items-center gap-2">
              {isAlertNotice ? (
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <RotateCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              )}
              <span className="font-medium">{syncNotice}</span>
            </div>
            <button onClick={() => setSyncNotice(null)} className="text-xs hover:opacity-80 p-0.5 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })()}

      {/* 2. Official Telegram Native Translate Bar (Telegram 8.4+ Style) */}
      {isTranslateBarVisible && (
        <div className="bg-[#f8fafc]/90 dark:bg-[#0c1624]/90 aurora:bg-[#0c171d]/92 backdrop-blur-xs border-b border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] px-4 py-1.5 flex items-center justify-between text-xs text-[#0f172a] dark:text-[#d3e2ef] aurora:text-[#d5ebee] transition-colors shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Languages className={`w-3.5 h-3.5 shrink-0 ${isChatTransEnabled ? 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]' : 'text-[#94a3b8] dark:text-[#64748b]'}`} />
            {isChatTransEnabled ? (
              <span className="font-medium whitespace-nowrap text-[#334155] dark:text-[#d3e2ef] aurora:text-[#d5ebee]">
                自动翻译为{getLanguageDisplayName(inboundTargetLang)}
              </span>
            ) : (
              <span className="font-medium whitespace-nowrap text-[#64748b] dark:text-[#8aa0b8] aurora:text-[#7e9aa5]">
                {chatTransScopeLabel}已关闭（消息仅展示原文）
              </span>
            )}
            <span className="text-[#94a3b8] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">·</span>

            {/* Quick Target Language Selector */}
            <div className="relative inline-flex items-center" ref={langMenuRef}>
              <button
                ref={langButtonRef}
                type="button"
                onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] cursor-pointer transition-colors font-medium text-[11px]"
              >
                <span>发信目标: {getLanguageDisplayName(outboundTargetLang)}</span>
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>

              {isLangMenuOpen && langMenuPos && typeof document !== 'undefined' && createPortal(
                <div
                  ref={langDropdownRef}
                  style={{
                    top: `${langMenuPos.top}px`,
                    left: `${langMenuPos.left}px`,
                    maxHeight: `${langMenuPos.maxHeight}px`,
                  }}
                  className="fixed z-[9990] w-64 flex flex-col bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] rounded-xl shadow-2xl p-1.5 animate-in fade-in duration-150"
                >
                  <div className="px-2 py-1 text-[10px] font-semibold text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] uppercase tracking-wider border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] pb-1 mb-1 shrink-0">
                    选择联系人语言 (全球 {SUPPORTED_LANGUAGES.length - 1} 种)
                  </div>
                  <div className="px-1 pb-1.5 shrink-0">
                    <input
                      type="text"
                      value={langMenuSearch}
                      onChange={(e) => setLangMenuSearch(e.target.value)}
                      placeholder="搜索语言名称或代码..."
                      className="w-full px-2 py-1 text-[11px] rounded-md bg-[#f1f5f9] dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
                    {SUPPORTED_LANGUAGES.filter((l) => {
                      const q = langMenuSearch.trim().toLowerCase();
                      if (!q) return true;
                      return l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q);
                    }).map((lang) => {
                      const isAutoSelected =
                        lang.code === 'Auto' &&
                        (!chat.sourceLang || chat.sourceLang === 'Auto');
                      const isLangSelected =
                        lang.code !== 'Auto' &&
                        Boolean(chat.sourceLang && chat.sourceLang !== 'Auto') &&
                        normalizeChatLangCode(outboundTargetLang) === normalizeChatLangCode(lang.code);
                      const isSelected = isAutoSelected || isLangSelected;
                      return (
                        <button
                          key={lang.code}
                          type="button"
                          onClick={() => {
                            if (lang.code === 'Auto') {
                              onUpdateChatLanguage?.(chat.id, 'Auto', chat.targetLang || 'Auto');
                            } else {
                              onUpdateChatLanguage?.(chat.id, lang.code, chat.targetLang || 'Auto');
                            }
                            setIsLangMenuOpen(false);
                            setLangMenuSearch('');
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white font-medium'
                              : 'text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934]'
                          }`}
                        >
                          <span className="truncate text-left">
                            {lang.code === 'Auto' ? '恢复全局默认 (Auto)' : lang.name}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-white shrink-0 ml-1" />}
                        </button>
                      );
                    })}
                  </div>
                </div>,
                document.body
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onToggleChatTranslation?.(chat.id, !isChatTransEnabled)}
              title={isChatTransEnabled ? `点击关闭当前${chatTransScopeLabel}` : `点击开启当前${chatTransScopeLabel}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
                isChatTransEnabled
                  ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-700 dark:text-emerald-300 aurora:text-emerald-300 hover:bg-emerald-500/20'
                  : 'bg-slate-200/80 border-slate-300 text-slate-600 dark:bg-[#132234] dark:border-[#1e3148] dark:text-[#94a3b8] aurora:bg-[#10242b] aurora:border-[#1e343e] aurora:text-[#8eb2bd] hover:bg-slate-300/70 dark:hover:bg-[#1a2e45]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isChatTransEnabled ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500'
                }`}
              />
              <span>{isChatTransEnabled ? '已开启 · 点击关闭' : '已关闭 · 点击开启'}</span>
            </button>
            <button
              onClick={onOpenTranslation}
              className="text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] hover:underline font-medium cursor-pointer"
            >
              设置
            </button>
            <button
              onClick={() => setIsTranslateBarVisible(false)}
              className="p-1 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] transition-colors cursor-pointer"
              title="收起翻译栏"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 3. Messages Stream Viewport with Official Telegram Wallpaper Pattern */}
      <div
        ref={scrollViewportRef}
        className="flex-1 overflow-y-auto px-3.5 py-2.5 space-y-1.5 tg-chat-pattern select-text"
      >
        {/* Load Older Cloud History Button */}
        {chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && hasMoreHistory && cloudSearchResults === null && onLoadOlderMessages && (
          <div className="flex items-center justify-center my-1">
            <button
              type="button"
              disabled={isLoadingOlder}
              onClick={() => void handleLoadOlderClick()}
              className="px-3.5 py-1 rounded-full bg-white/90 dark:bg-[#0e1726]/90 aurora:bg-[#101c23]/90 hover:bg-[#e8f3ff] dark:hover:bg-[#142336] aurora:hover:bg-[#112e37] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] text-[11px] font-medium text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
            >
              <History className={`w-3.5 h-3.5 ${isLoadingOlder ? 'animate-spin' : ''}`} />
              <span>{isLoadingOlder ? '正在加载更早消息...' : '加载更早历史消息'}</span>
            </button>
          </div>
        )}

        {displayedMessages.map((msg, idx) => {
          const isMe = msg.sender === 'me';
          const isGroupPeer = Boolean(chat.isGroup && !isMe);
          const dayKey = getMessageDayKey(msg);
          const prevMsg = idx > 0 ? displayedMessages[idx - 1] : null;
          const nextMsg = idx < displayedMessages.length - 1 ? displayedMessages[idx + 1] : null;
          const prevDayKey = prevMsg ? getMessageDayKey(prevMsg) : null;
          const nextDayKey = nextMsg ? getMessageDayKey(nextMsg) : null;
          const showDayDivider = idx === 0 || dayKey !== prevDayKey;
          const isSelectedMulti = selectedMessageIds.has(msg.id);

          const cleanSenderName = normalizeGroupMemberDisplayName(msg.senderName);
          const senderGroupKey = isGroupPeer
            ? msg.senderId || cleanSenderName || `msg_${msg.id}`
            : '';
          const prevGroupKey =
            isGroupPeer && prevMsg && prevMsg.sender !== 'me' && prevDayKey === dayKey
              ? prevMsg.senderId || normalizeGroupMemberDisplayName(prevMsg.senderName) || `msg_${prevMsg.id}`
              : '';
          const nextGroupKey =
            isGroupPeer && nextMsg && nextMsg.sender !== 'me' && nextDayKey === dayKey
              ? nextMsg.senderId || normalizeGroupMemberDisplayName(nextMsg.senderName) || `msg_${nextMsg.id}`
              : '';
          const isSameSenderAsPrev = Boolean(isGroupPeer && senderGroupKey && senderGroupKey === prevGroupKey);
          const isSameSenderAsNext = Boolean(isGroupPeer && senderGroupKey && senderGroupKey === nextGroupKey);
          const showGroupSenderName = isGroupPeer && !isSameSenderAsPrev && Boolean(cleanSenderName);
          const showGroupSenderAvatar = isGroupPeer && !isSameSenderAsNext;
          const senderColorIdx = getTelegramSenderColorIndex(msg.senderId || cleanSenderName || msg.id);
          const safeMemberAvatarUrl = (msg.senderAvatarUrl ? resolveDisplayUrl(msg.senderAvatarUrl) : '') || '';
          const showAvatarImage = Boolean(safeMemberAvatarUrl && !failedAvatarUrls.has(safeMemberAvatarUrl));
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
              msg.deliveryStatus === 'failed'
          );
          const hasOverlayImageTimestamp = Boolean(
            msg.isImage && msg.imageUrl && resolveDisplayUrl(msg.imageUrl) && !hasInlineMediaFooterContent
          );

          return (
            <React.Fragment key={msg.id}>
              {showDayDivider && (
                <div className="flex items-center justify-center my-1">
                  <span className="px-3 py-0.5 rounded-full bg-white/90 dark:bg-[#0e1726]/80 aurora:bg-[#101c23]/85 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#1c323c] text-[11px] font-medium text-[#64748b] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] shadow-xs">
                    {formatMessageDayLabel(dayKey)}
                  </span>
                </div>
              )}

              <div
                data-msg-id={msg.id}
                onClick={isMultiSelectMode ? () => toggleSelectMessage(msg.id) : undefined}
                className={`flex ${isMultiSelectMode ? 'items-center gap-2.5 cursor-pointer rounded-xl px-1.5 py-0.5 transition-colors ' + (isSelectedMulti ? 'bg-[#2481cc]/10 dark:bg-[#2ba0ff]/15 aurora:bg-[#14b8a6]/15' : 'hover:bg-black/5 dark:hover:bg-white/5 aurora:hover:bg-white/5') : 'flex-col'} ${
                  isMe ? (isMultiSelectMode ? 'justify-end' : 'items-end') : (isMultiSelectMode ? 'justify-start' : 'items-start')
                } group relative ${hoveredMessageId === msg.id ? 'z-30' : ''} ${isSameSenderAsPrev ? 'mt-0.5' : 'mt-1'} ${isSameSenderAsNext ? 'mb-0.5' : 'mb-1'}`}
                onContextMenu={(e) => {
                  if (!isMultiSelectMode) handleMessageContextMenu(e, msg);
                }}
              >
                {isMultiSelectMode && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectMessage(msg.id);
                    }}
                    className={`shrink-0 p-1 rounded-lg transition-colors cursor-pointer ${
                      isSelectedMulti
                        ? 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
                        : 'text-[#94a3b8] dark:text-[#64748b] aurora:text-[#5a7782]'
                    }`}
                  >
                    {isSelectedMulti ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>
                )}

                {/* Telegram Floating Quick Action Menu on Hover */}
                {!isMultiSelectMode && hoveredMessageId === msg.id && (
                  <div
                    className={`absolute ${idx === 0 ? 'top-1' : '-top-4'} z-40 flex items-center gap-0.5 bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] rounded-full px-1.5 py-0.5 shadow-lg animate-in fade-in zoom-in-95 duration-100 ${
                      isMe ? 'right-2' : isGroupPeer ? 'left-10' : 'left-2'
                    }`}
                  >
                    {/* Quick Reactions Bar */}
                    <div className="flex items-center gap-0.5 pr-1 border-r border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                      {['👍', '❤️', '🔥', '🎉'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => onToggleReaction?.(msg.id, emoji)}
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
                      onClick={() => {
                        setReplyingTo(msg);
                        setEditingMessage(null);
                      }}
                      className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] cursor-pointer"
                      title="回复消息"
                    >
                      <Reply className="w-3.5 h-3.5" />
                    </button>

                    {/* Forward Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenForwardModal([msg])}
                      className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] cursor-pointer"
                      title="转发消息"
                    >
                      <Forward className="w-3.5 h-3.5" />
                    </button>

                    {/* Manual Translate / Retranslate Button */}
                    {onRetranslateMessage &&
                      (!msg.isAudio || msg.sttText) &&
                      Boolean((msg.sttText || msg.text || msg.imageCaption || '').trim()) && (
                      <button
                        type="button"
                        disabled={Boolean(msg.isTranslating)}
                        onClick={() => void onRetranslateMessage(msg.id)}
                        className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] cursor-pointer disabled:opacity-50"
                        title={msg.translatedText ? '重新翻译' : '翻译此消息'}
                      >
                        {msg.isTranslating ? (
                          <RotateCw className="w-3.5 h-3.5 animate-spin text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                        ) : (
                          <Languages className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    {/* Pin Button */}
                    <button
                      type="button"
                      onClick={() => onTogglePinMessage?.(msg.id)}
                      className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] cursor-pointer"
                      title={msg.isPinned ? '取消置顶' : '置顶此消息'}
                    >
                      <Pin className={`w-3.5 h-3.5 ${msg.isPinned ? 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] fill-current' : ''}`} />
                    </button>

                    {/* Edit Button (For delivered non-audio sent messages) */}
                    {isMe &&
                      !msg.isAudio &&
                      msg.deliveryStatus !== 'failed' &&
                      msg.deliveryStatus !== 'pending' &&
                      (!chat.id.startsWith('tg_') || typeof msg.telegramMessageId === 'number') && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMessage(msg);
                          setTranslateOnEdit(false);
                          setInputText(msg.text);
                          setReplyingTo(null);
                        }}
                        className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] cursor-pointer"
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
                          copyImageToClipboard(msg.imageUrl, msg.id);
                        } else {
                          copyToClipboard(msg.text, msg.id);
                        }
                      }}
                      className="p-1 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] cursor-pointer"
                      title={msg.isImage ? '复制照片到剪贴板' : '复制消息内容'}
                    >
                      {copiedId === msg.id ? (
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
                        setRevokeSingleDelete(true);
                        setMessageToDelete(msg);
                      }}
                      className="p-1 text-[#64748b] hover:text-rose-500 dark:text-[#7b93ad] dark:hover:text-rose-400 aurora:text-[#7e9aa5] aurora:hover:text-rose-400 cursor-pointer"
                      title="删除消息"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className={isGroupPeer ? 'flex items-end gap-2 max-w-[86%] sm:max-w-[78%]' : 'contents'}>
                  {isGroupPeer && (
                    showGroupSenderAvatar ? (
                      <div
                        onClick={() => {
                          if (!isMultiSelectMode && msg.senderId) {
                            void handleOpenGroupMemberProfile({
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
                            src={safeMemberAvatarUrl}
                            alt={cleanSenderName || ''}
                            className="w-full h-full object-cover"
                            onError={() => {
                              setFailedAvatarUrls((prev) => {
                                if (prev.has(safeMemberAvatarUrl)) return prev;
                                const next = new Set(prev);
                                next.add(safeMemberAvatarUrl);
                                return next;
                              });
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
                    className={`${isGroupPeer ? 'min-w-0' : 'max-w-[84%] sm:max-w-[78%]'} rounded-xl ${
                      hasMediaBubble ? 'p-1' : 'py-1.5 px-2.5'
                    } relative transition-all select-text ${
                      highlightedMsgId === msg.id ? 'ring-2 ring-amber-400 shadow-lg' : ''
                    } ${
                      isMe
                        ? 'bg-[#1e88e5] text-white dark:bg-[#1b4975] dark:text-white aurora:bg-[#11434d] aurora:border aurora:border-[#2dd4bf]/25 rounded-br-xs shadow-[0_1px_3px_rgba(30,136,229,0.22)]'
                        : 'bg-white text-[#0f172a] border border-[#e2e8f0] dark:bg-[#101b2a] dark:text-[#eef4fb] dark:border-[#1a2b40] aurora:bg-[#101c23] aurora:text-[#ecf6f8] aurora:border-[#1c323c] rounded-bl-xs shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
                    }`}
                  >
                    {/* Official Telegram Group Member Name */}
                    {showGroupSenderName && (
                      <div
                        onClick={() => {
                          if (!isMultiSelectMode && msg.senderId) {
                            void handleOpenGroupMemberProfile({
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
                        isMe ? 'text-white/85' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
                      }`}
                    >
                      <Forward className="w-3 h-3 shrink-0" />
                      <span className="truncate">转发自 {msg.forwardFrom}</span>
                    </div>
                  )}

                  {/* Telegram Reply Quote Header */}
                  {msg.replyTo && (
                    <div
                      className={`mb-2 pl-2.5 py-1 border-l-2 rounded-r text-[11px] select-none ${
                        isMe
                          ? 'border-white/70 bg-white/12 text-white'
                          : 'border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] bg-[#f8fafc] dark:bg-white/5 aurora:bg-[#081014]/60 text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]'
                      }`}
                    >
                      <div
                        className={`font-semibold truncate ${
                          isMe ? 'text-white' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
                        }`}
                      >
                        {msg.replyTo.senderName || '回复消息'}
                      </div>
                      <div className="opacity-85 truncate text-[10.5px]">{msg.replyTo.text}</div>
                    </div>
                  )}

                {/* Image / Sticker Attachment with Copy and Download Overlay */}
                {msg.isImage && msg.imageUrl && (() => {
                  const safeImageHref = resolveDisplayUrl(msg.imageUrl);
                  if (!safeImageHref) return null;
                  const hasVisibleImageCaption = Boolean(
                    msg.text?.trim() &&
                      !isSystemMediaPlaceholder(msg.text, msg) &&
                      !/\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/i.test(msg.text.trim())
                  );
                  return (
                    <div className={`${hasVisibleImageCaption ? 'mb-1.5' : ''} rounded-xl overflow-hidden max-w-[280px] shadow-xs relative group/img select-none`}>
                      <img
                        src={safeImageHref}
                        alt={msg.imageCaption || 'image'}
                        title="双击全屏查看大图"
                        onDoubleClick={(e) => {
                          if (isMultiSelectMode) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setLightboxMedia({
                            type: 'image',
                            url: safeImageHref,
                            rawUrl: msg.imageUrl,
                            caption: hasVisibleImageCaption ? msg.text : msg.imageCaption,
                            msgId: msg.id,
                          });
                        }}
                        className="w-full h-auto object-cover max-h-72 cursor-pointer hover:opacity-95 transition-opacity rounded-[9px]"
                        onLoad={(e) => {
                          e.currentTarget.style.display = '';
                        }}
                        onError={() => {
                          void triggerSilentUrlRefresh(msg.imageUrl, true);
                        }}
                      />
                      {/* Hover actions for image: Zoom, Copy Image and Download Image */}
                      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/65 backdrop-blur-xs rounded-lg p-1 text-white shadow-md">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxMedia({
                              type: 'image',
                              url: safeImageHref,
                              rawUrl: msg.imageUrl,
                              caption: hasVisibleImageCaption ? msg.text : msg.imageCaption,
                              msgId: msg.id,
                            });
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
                            copyImageToClipboard(safeImageHref, msg.id);
                          }}
                          title="复制照片到剪贴板"
                          className="p-1 hover:bg-white/20 rounded-md cursor-pointer transition-colors"
                        >
                          {copiedId === msg.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <a
                          href={safeImageHref}
                          download={msg.imageCaption || `tg_photo_${Date.now()}.png`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const resolved = resolveDisplayUrl(msg.imageUrl);
                            if (!resolved) {
                              e.preventDefault();
                              return;
                            }
                            if (msg.imageUrl && isSignedResourceUrlExpiringSoon(resolved)) {
                              e.preventDefault();
                              void triggerSilentUrlRefresh(msg.imageUrl, true).then((nextUrl) => {
                                const safeDownloadHref = sanitizeSafeResourceUrl(nextUrl) || resolved;
                                if (!safeDownloadHref) return;
                                const a = document.createElement('a');
                                a.href = safeDownloadHref;
                                a.download = msg.imageCaption || `tg_photo_${Date.now()}.png`;
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
                        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-black/50 backdrop-blur-xs text-white text-[10px] flex items-center gap-1 pointer-events-none select-none tabular-nums shadow-xs">
                          {msg.isPinned && <Pin className="w-2.5 h-2.5 fill-current text-white/95" />}
                          {msg.isEdited && <span className="text-[9.5px] opacity-90">已编辑</span>}
                          <span>{msg.timestamp}</span>
                          {isMe && (
                            msg.deliveryStatus === 'pending' || msg.deliveryStatus === 'retrying' || retryingMsgIds.has(msg.id) ? (
                              <RotateCw className="w-2.5 h-2.5 animate-spin text-white/90" />
                            ) : chat.isChannel ? (
                              <CheckCheck className="w-3 h-3 text-white/95" />
                            ) : chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && typeof msg.telegramMessageId === 'number' ? (
                              typeof chat.readOutboxMaxId === 'number' && msg.telegramMessageId <= chat.readOutboxMaxId ? (
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
                {msg.isVideo && msg.videoUrl && (() => {
                  const safeVideoHref = resolveDisplayUrl(msg.videoUrl);
                  if (!safeVideoHref) return null;
                  const hasVisibleVideoCaption = Boolean(
                    msg.text?.trim() &&
                      !isSystemMediaPlaceholder(msg.text, msg) &&
                      !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(msg.text.trim())
                  );
                  return (
                    <div
                      className={`${hasVisibleVideoCaption ? 'mb-1.5' : ''} rounded-xl overflow-hidden max-w-[320px] shadow-sm relative group/vid bg-black/10 dark:bg-black/40 select-none`}
                      onDoubleClick={(e) => {
                        if (isMultiSelectMode) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const vid = e.currentTarget.querySelector('video');
                        if (vid) vid.pause();
                        if (document.fullscreenElement) {
                          document.exitFullscreen().catch(() => {});
                        }
                        setLightboxMedia({
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
                          void triggerSilentUrlRefresh(msg.videoUrl, true);
                        }}
                      />
                      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/vid:opacity-100 transition-opacity bg-black/65 backdrop-blur-xs rounded-lg p-1 text-white shadow-md z-10">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const vid = e.currentTarget.closest('.group\\/vid')?.querySelector('video');
                            if (vid) vid.pause();
                            setLightboxMedia({
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
                            const resolved = resolveDisplayUrl(msg.videoUrl);
                            if (!resolved) {
                              e.preventDefault();
                              return;
                            }
                            if (msg.videoUrl && isSignedResourceUrlExpiringSoon(resolved)) {
                              e.preventDefault();
                              void triggerSilentUrlRefresh(msg.videoUrl, true).then((nextUrl) => {
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
                {msg.isFile && (() => {
                  const safeFileHref = resolveDisplayUrl(msg.fileUrl);
                  return (
                    <div className={`p-2.5 rounded-xl flex items-center justify-between gap-3 text-xs mb-1.5 ${isMe ? 'bg-white/12' : 'bg-black/5 dark:bg-white/10 aurora:bg-[#15252e]'}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className={`w-6 h-6 shrink-0 ${isMe ? 'text-white/90' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'}`} />
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{msg.fileName || '文档附件'}</div>
                          <div className="text-[10px] opacity-70">{msg.fileSize || '128 KB'}</div>
                        </div>
                      </div>
                      {safeFileHref ? (
                        <a
                          href={safeFileHref}
                          download={msg.fileName || 'file'}
                          onClick={(e) => {
                            const resolved = resolveDisplayUrl(msg.fileUrl);
                            if (!resolved) {
                              e.preventDefault();
                              return;
                            }
                            if (msg.fileUrl && isSignedResourceUrlExpiringSoon(resolved)) {
                              e.preventDefault();
                              void triggerSilentUrlRefresh(msg.fileUrl, true).then((nextUrl) => {
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
                          className={`p-1.5 rounded-lg cursor-pointer ${isMe ? 'text-white hover:bg-white/15' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] hover:bg-[#2481cc]/10 aurora:hover:bg-[#14b8a6]/15'}`}
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
                  );
                })()}

                {/* Audio voice note message */}
                {msg.isAudio ? (
                  <div className="flex flex-col gap-2 min-w-[220px]">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => void handlePlayAudio(msg.id, msg.audioUrl)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-105 shrink-0 ${
                          isMe
                            ? 'bg-white/20 hover:bg-white/30 text-white'
                            : 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white'
                        }`}
                      >
                        {playingAudioId === msg.id ? (
                          <Pause className="w-4 h-4 fill-current" />
                        ) : (
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        )}
                      </button>

                      {/* Waveform progress bar */}
                      <div className="flex-1">
                        <div className={`h-1.5 w-full rounded-full overflow-hidden ${isMe ? 'bg-white/25' : 'bg-black/10 dark:bg-white/20 aurora:bg-white/15'}`}>
                          <div
                            className={`h-full transition-all duration-100 ${
                              isMe ? 'bg-white' : 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#2dd4bf]'
                            }`}
                            style={{ width: `${audioProgress[msg.id] || 0}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] mt-1 opacity-75 tabular-nums">
                          <span>
                            {msg.audioDuration && msg.audioDuration > 0
                              ? `${Math.floor(msg.audioDuration / 60)}:${String(Math.floor(msg.audioDuration % 60)).padStart(2, '0')}`
                              : '--'}
                          </span>
                          {msg.voiceName && (
                            <span className={`text-[10px] ${isMe ? 'text-white/90' : 'text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4]'}`}>
                              🎙️ {msg.voiceName}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Speech to Text Transcribe toggle */}
                    {msg.sttText ? (
                      <div className={`mt-1 pt-1.5 border-t text-xs ${isMe ? 'border-white/20' : 'border-black/10 dark:border-white/10 aurora:border-white/10'}`}>
                        <div className="text-[11px] opacity-70 mb-0.5 select-none">转文字:</div>
                        <p className="select-text cursor-text">{msg.sttText}</p>
                        {msg.translatedText ? (
                          <p className={`mt-1 font-medium select-text cursor-text ${isMe ? 'text-white/95' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'}`}>
                            译文: {msg.translatedText}
                          </p>
                        ) : msg.translationError ? (
                          <div className={`mt-1 text-[11px] flex items-center justify-between gap-2 ${isMe ? 'text-amber-200' : 'text-rose-600 dark:text-rose-400 aurora:text-rose-300'}`}>
                            <span className="min-w-0 break-words">
                              翻译失败，请检查翻译通道
                            </span>
                            {onRetranslateMessage && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onRetranslateMessage(msg.id);
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
                        onClick={() => handleTranscribeAudio(msg)}
                        disabled={transcribingMap[msg.id]}
                        className={`text-[11px] hover:underline self-start cursor-pointer mt-0.5 ${isMe ? 'text-white/90' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'}`}
                      >
                        {transcribingMap[msg.id] ? '正在转文字中...' : '转为文字'}
                      </button>
                    )}
                  </div>
                ) : (
                  /* Standard Text Message or Photo Caption */
                  <div>
                    {(() => {
                      const showOriginalAndTranslation =
                        translationSettings?.showOriginalAndTranslation !== false;
                      const isTranslationOnlyPeer =
                        isChatTransEnabled &&
                        !isMe &&
                        !showOriginalAndTranslation &&
                        Boolean(msg.translatedText) &&
                        !msg.isImage &&
                        !msg.isFile &&
                        !msg.isVideo;
                      const isShowingOriginalOverlay = showOriginalMsgIds.has(msg.id);

                      if (isTranslationOnlyPeer) {
                        return (
                          <div>
                            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words select-text cursor-text">
                              {msg.translatedText}
                            </p>
                            <div className="mt-1.5 flex items-center gap-2 select-none">
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]">
                                <Languages className="w-3 h-3" />
                                <span>仅显示译文</span>
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowOriginalMsgIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(msg.id)) next.delete(msg.id);
                                    else next.add(msg.id);
                                    return next;
                                  });
                                }}
                                className="text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] hover:underline cursor-pointer"
                              >
                                {isShowingOriginalOverlay ? '收起原文' : '查看原文'}
                              </button>
                            </div>
                            {isShowingOriginalOverlay && msg.text && (
                              <div className="mt-1.5 p-2 rounded-lg bg-[#f8fafc] dark:bg-[#0b131f]/80 aurora:bg-[#0c161c]/85 border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1e343e] text-xs text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8] select-text">
                                <div className="text-[10px] opacity-70 mb-0.5 select-none">原文：</div>
                                <p className="whitespace-pre-wrap break-words">{renderMessageTextWithLinks(msg.text, false)}</p>
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <>
                          {!msg.isImage && !msg.isFile && !msg.isVideo && (
                            <p className="text-[13px] leading-snug whitespace-pre-wrap break-words select-text cursor-text">
                              {renderMessageTextWithLinks(msg.text, isMe)}
                            </p>
                          )}
                          {msg.isImage &&
                            msg.text &&
                            msg.text.trim() &&
                            (!msg.imageUrl ||
                              (!isSystemMediaPlaceholder(msg.text, msg) &&
                                !/\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/i.test(msg.text.trim()))) && (
                            <p className="text-[13px] leading-snug whitespace-pre-wrap break-words select-text cursor-text mt-1 px-1.5">
                              {renderMessageTextWithLinks(msg.text, isMe)}
                            </p>
                          )}
                          {msg.isVideo &&
                            msg.text &&
                            msg.text.trim() &&
                            (!msg.videoUrl ||
                              (!isSystemMediaPlaceholder(msg.text, msg) &&
                                !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(msg.text.trim()))) && (
                            <p className="text-[13px] leading-snug whitespace-pre-wrap break-words select-text cursor-text mt-1 px-1.5">
                              {renderMessageTextWithLinks(msg.text, isMe)}
                            </p>
                          )}

                          {/* Official Telegram Inline Translation Card */}
                          {(!isChatTransEnabled ||
                            (msg.isImage && msg.imageUrl && (!msg.text?.trim() || isSystemMediaPlaceholder(msg.text, msg))) ||
                            (msg.isVideo && msg.videoUrl && (!msg.text?.trim() || isSystemMediaPlaceholder(msg.text, msg)))) ? null : msg.isTranslating ? (
                            <div
                              className={`mt-1.5 px-2 py-1 rounded-lg border text-[10.5px] flex items-center gap-1.5 ${
                                isMe
                                  ? 'bg-white/10 border-white/20 text-white/85'
                                  : 'bg-[#f8fafc] dark:bg-[#0b131f]/80 aurora:bg-[#0c161c]/85 border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1e343e] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
                              }`}
                            >
                              <RotateCw className="w-3 h-3 animate-spin shrink-0" />
                              <span>正在翻译中...</span>
                            </div>
                          ) : msg.translatedText ? (
                            <div
                              className={`mt-1.5 px-2 py-1.5 rounded-lg border text-[11.5px] select-text cursor-text ${
                                isMe
                                  ? 'bg-white/12 border-white/20 text-white/95'
                                  : 'bg-[#f8fafc] dark:bg-[#0b131f]/80 aurora:bg-[#0c161c]/85 border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1e343e] text-[#1e293b] dark:text-[#eef4fb] aurora:text-[#ecf6f8]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-0.5 select-none">
                                <span
                                  className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                                    isMe ? 'text-white/85' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]'
                                  }`}
                                >
                                  <Languages className="w-3 h-3" />
                                  <span>{isMe ? '已发送对照译文' : 'AI 实时译文'}</span>
                                </span>
                                <div className="flex items-center gap-1">
                                  {onRetranslateMessage && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void onRetranslateMessage(msg.id);
                                      }}
                                      title="重新翻译"
                                      className={`p-0.5 rounded transition-colors cursor-pointer ${
                                        isMe
                                          ? 'text-white/75 hover:text-white hover:bg-white/10'
                                          : 'text-[#64748b] hover:text-[#2481cc] hover:bg-black/5 dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4]'
                                      }`}
                                    >
                                      <RotateCw className="w-3 h-3" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(msg.translatedText || '', `${msg.id}_tr`);
                                    }}
                                    title="复制译文"
                                    className={`p-0.5 rounded transition-colors cursor-pointer ${
                                      isMe
                                        ? 'text-white/75 hover:text-white hover:bg-white/10'
                                        : 'text-[#64748b] hover:text-[#2481cc] hover:bg-black/5 dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4]'
                                    }`}
                                  >
                                    {copiedId === `${msg.id}_tr` ? (
                                      <Check className={`w-3 h-3 ${isMe ? 'text-emerald-300' : 'text-emerald-600 dark:text-emerald-400 aurora:text-emerald-300'}`} />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              </div>
                              <p className="leading-snug font-normal select-text cursor-text">{msg.translatedText}</p>
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
                              {onRetranslateMessage && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onRetranslateMessage(msg.id);
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
                      isMe ? 'border-white/15' : 'border-black/5 dark:border-white/10 aurora:border-white/10'
                    }`}
                  >
                    {Object.entries(msg.reactions).map(([emoji, count]) => {
                      const isMine = msg.myReactions?.includes(emoji);
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => onToggleReaction?.(msg.id, emoji)}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 border transition-all cursor-pointer ${
                            isMe
                              ? isMine
                                ? 'bg-white/25 border-white/50 text-white'
                                : 'bg-white/10 border-transparent text-white/90 hover:bg-white/20'
                              : isMine
                              ? 'bg-[#e8f3ff] border-[#2481cc] text-[#2481cc] dark:bg-[#2ba0ff]/20 dark:border-[#2ba0ff]/60 dark:text-[#2ba0ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf] aurora:text-[#5eead4]'
                              : 'bg-[#f1f5f9] dark:bg-white/10 aurora:bg-[#13252e] border-transparent text-[#0f172a] dark:text-white/90 aurora:text-[#ecf6f8] hover:bg-[#e2e8f0] dark:hover:bg-white/15 aurora:hover:bg-[#18303b]'
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
                      isMe ? 'text-white/80' : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]'
                    }`}
                  >
                    {msg.isPinned && (
                      <Pin
                        className={`w-3 h-3 fill-current mr-0.5 ${
                          isMe ? 'text-white/90' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]'
                        }`}
                      />
                    )}
                    {msg.isEdited && (
                      <span className="text-[9.5px] opacity-80 mr-0.5">已编辑</span>
                    )}
                    <span>{msg.timestamp}</span>
                    {isMe && (
                      msg.deliveryStatus === 'pending' || msg.deliveryStatus === 'retrying' || retryingMsgIds.has(msg.id) ? (
                        <span className="inline-flex items-center gap-0.5 text-white/80" title="正在投递到 Telegram">
                          <RotateCw className="w-3 h-3 animate-spin" />
                        </span>
                      ) : msg.deliveryStatus === 'failed' ? (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!onRetryMessage || retryingMsgIds.has(msg.id)) return;
                            setRetryingMsgIds((prev) => new Set(prev).add(msg.id));
                            try {
                              const res = await onRetryMessage(msg.id);
                              if (!res.ok) {
                                setSyncNotice(`重发失败：${res.error || '请检查 Telegram 在线状态'}`);
                                setTimeout(() => setSyncNotice(null), 3500);
                              }
                            } finally {
                              setRetryingMsgIds((prev) => {
                                const next = new Set(prev);
                                next.delete(msg.id);
                                return next;
                              });
                            }
                          }}
                          title="消息投递失败，点击重试发送"
                          className="inline-flex items-center gap-1 text-rose-200 hover:underline cursor-pointer font-medium"
                        >
                          <ShieldAlert className="w-3 h-3" />
                          <span>失败 · 重发</span>
                        </button>
                      ) : chat.isChannel ? (
                        <span title="已发送至频道" className="inline-flex items-center">
                          <CheckCheck className="w-3.5 h-3.5 text-white/95 dark:text-[#7cc4ff] aurora:text-[#5eead4]" />
                        </span>
                      ) : chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && typeof msg.telegramMessageId === 'number' ? (
                        typeof chat.readOutboxMaxId === 'number' && msg.telegramMessageId <= chat.readOutboxMaxId ? (
                          <span title={chat.isGroup ? '已有成员已读' : '对方已读'} className="inline-flex items-center">
                            <CheckCheck className="w-3.5 h-3.5 text-white/95 dark:text-[#7cc4ff] aurora:text-[#5eead4]" />
                          </span>
                        ) : (
                          <span title={chat.isGroup ? '已送达（暂未有成员已读）' : '已送达（对方未读）'} className="inline-flex items-center">
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
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Multi-Select Batch Operations Bar */}
      {isMultiSelectMode && (
        <div className="bg-[#f0f7ff] dark:bg-[#0d1929] aurora:bg-[#0f1d24] border-t border-[#bfdbfe] dark:border-[#1e3148] aurora:border-[#1f3b45] px-4 py-2.5 flex items-center justify-between gap-2 text-xs shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] tabular-nums">
              已选择 {selectedMessageIds.size} 条消息
            </span>
            <button
              type="button"
              onClick={() => {
                if (selectedMessageIds.size === displayedMessages.length) {
                  setSelectedMessageIds(new Set());
                } else {
                  setSelectedMessageIds(new Set(displayedMessages.map((m) => m.id)));
                }
              }}
              className="px-2 py-1 rounded-lg bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#dbeafe] dark:border-[#1e3148] aurora:border-[#203742] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] hover:bg-[#e8f3ff] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] cursor-pointer text-[11px]"
            >
              {selectedMessageIds.size === displayedMessages.length && displayedMessages.length > 0 ? '取消全选' : '全选当前'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={selectedMessageIds.size === 0}
              onClick={() => {
                const picked = messages.filter((m) => selectedMessageIds.has(m.id));
                handleOpenForwardModal(picked);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] disabled:opacity-40 text-white font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Forward className="w-3.5 h-3.5" />
              <span>转发</span>
            </button>
            <button
              type="button"
              disabled={selectedMessageIds.size === 0}
              onClick={() => {
                setRevokeBatchDelete(true);
                setShowBatchDeleteModal(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>批量删除</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMultiSelectMode(false);
                setSelectedMessageIds(new Set());
              }}
              className="px-2.5 py-1.5 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-[#152934] cursor-pointer"
            >
              退出多选
            </button>
          </div>
        </div>
      )}

      {/* 4. Official Telegram Composer (Structured Dual-Layer Input Area) */}
      <footer onPaste={handlePaste} className="bg-white/95 dark:bg-[#09111d]/95 aurora:bg-[#0d171d]/95 backdrop-blur-md border-t border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] px-4 py-2.5 shrink-0 transition-colors">
        {/* AI Generating Indicator */}
        {isGeneratingAi && (
          <div className="mb-2 px-3 py-2 bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] border border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35 rounded-xl flex items-center gap-2 text-xs text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] animate-pulse">
            <Sparkles className="w-4 h-4 animate-spin text-amber-500" />
            <span>AI 正在深度检索该客户全息画像与过往约定，生成真人拟真回复...</span>
          </div>
        )}

        {/* AI Holographic Memory Suggestion Card */}
        {aiSuggestion && (
          <div className="mb-2.5 p-3.5 bg-gradient-to-r from-[#eff6ff] via-[#f8fafc] to-transparent dark:from-[#2ba0ff]/12 dark:via-[#101c2d]/80 dark:to-transparent aurora:from-[#112d36]/90 aurora:via-[#0d1e25]/80 aurora:to-transparent border border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35 rounded-xl flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]">
                <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>AI 回复建议</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAiSuggestion(null);
                  setAiSuggestionTranslation(null);
                }}
                className="text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] p-0.5 cursor-pointer"
                title="关闭建议"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Bilingual Content Box */}
            <div className="bg-white dark:bg-[#0e1726]/95 aurora:bg-[#101c23]/95 p-3 rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] select-text space-y-2.5">
              {/* 1. Foreign Outbound Text */}
              <div>
                <span className="text-[10px] font-semibold text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-1">
                  外文译稿：
                </span>
                <div className="text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] leading-relaxed font-sans">
                  {aiSuggestion}
                </div>
              </div>

              {/* 2. Chinese Meaning Translation */}
              {aiSuggestionTranslation ? (
                <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] text-xs text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] flex items-start gap-1.5">
                  <Languages className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-80" />
                  <div className="flex-1">
                    <span className="text-[10px] font-semibold text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">
                      {getLanguageDisplayName(inboundTargetLang)}对照：
                    </span>
                    <span className="leading-relaxed font-sans text-[#1e293b] dark:text-[#b4c6d8] aurora:text-[#b7d0d8]">
                      {aiSuggestionTranslation}
                    </span>
                  </div>
                </div>
              ) : isTranslatingSuggestion ? (
                <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] flex items-center gap-1.5 animate-pulse">
                  <Languages className="w-3 h-3 animate-spin shrink-0" />
                  <span>正在获取{getLanguageDisplayName(inboundTargetLang)}含义翻译...</span>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 text-xs pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setInputText(aiSuggestion);
                  setAiSuggestion(null);
                  setAiSuggestionTranslation(null);
                }}
                className="px-2.5 py-1 rounded-lg bg-[#f1f5f9] dark:bg-[#152438] aurora:bg-[#152934] hover:bg-[#e2e8f0] dark:hover:bg-[#1b2f48] aurora:hover:bg-[#1b3441] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] font-medium text-[11px] cursor-pointer transition-colors"
              >
                填入输入框
              </button>
              <button
                type="button"
                disabled={isSending}
                onClick={async () => {
                  if (isSending || !chat) return;
                  const originChatId = chat.id;
                  const originAccountId = currentAccountId;
                  const originReplyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;
                  setIsSending(true);
                  const targetSuggestion = aiSuggestion;
                  const targetTranslation = aiSuggestionTranslation;
                  setAiSuggestion(null);
                  setAiSuggestionTranslation(null);
                  try {
                    let cnTranslation = targetTranslation || '';
                    const isDualOffSend = Boolean(
                      customLLMConfig && (customLLMConfig.enabled === false || customLLMConfig.explicitlyDisabled)
                    );
                    const isCustomSend = Boolean(
                      !isDualOffSend && customLLMConfig?.enabled && customLLMConfig?.engineMode === 'custom'
                    );
                    const effectiveSendRefEngine: 'gemini' | 'google' | 'custom_llm' =
                      isGroupOrChannelChat || isDualOffSend
                        ? 'google'
                        : isCustomSend
                        ? 'custom_llm'
                        : translationSettings?.preferredEngine === 'google'
                        ? 'google'
                        : 'gemini';
                    const resolvedInbound =
                      inboundTargetLang && inboundTargetLang !== 'Auto' ? inboundTargetLang : 'Chinese';
                    if (
                      !cnTranslation &&
                      outboundTargetLang &&
                      normalizeChatLangCode(outboundTargetLang) !== normalizeChatLangCode(resolvedInbound)
                    ) {
                      try {
                        cnTranslation = await translateText(
                          targetSuggestion,
                          outboundTargetLang,
                          resolvedInbound,
                          customLLMConfig,
                          effectiveSendRefEngine,
                          translationSettings?.googleApiKey,
                          isGroupOrChannelChat ? undefined : translationSettings?.geminiModel,
                          isGroupOrChannelChat ? undefined : translationSettings?.geminiApiKey,
                          isGroupOrChannelChat ? undefined : translationSettings?.customModelName,
                          isGroupOrChannelChat ? { purpose: 'group', isGroup: true } : undefined
                        );
                      } catch {
                        if (isSameOriginScope(originChatId, originAccountId)) {
                          setSyncNotice('翻译失败，请检查翻译通道');
                          setTimeout(() => setSyncNotice(null), 4000);
                        }
                      }
                    }
                    onSendMessage({
                      chatId: originChatId,
                      accountId: originAccountId,
                      sender: 'me',
                      text: targetSuggestion,
                      translatedText: cnTranslation,
                      replyTo: originReplyPayload,
                      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
                    });
                    if (originReplyPayload && isSameOriginScope(originChatId, originAccountId)) setReplyingTo(null);
                    let peerCueText = '';
                    for (let i = messages.length - 1; i >= 0; i--) {
                      const pm = messages[i];
                      if (!pm || pm.sender !== 'peer') continue;
                      const candidates = getPeerMessageNaturalTextCandidates(pm);
                      if (candidates.length > 0) {
                        peerCueText = candidates[0];
                        break;
                      }
                    }
                    submitTrainingFeedbackApi({
                      snippet: targetSuggestion.slice(0, 500),
                      peerCue: peerCueText ? peerCueText.slice(0, 200) : undefined,
                      engineLicenseKey: customLLMConfig?.engineLicenseKey,
                    }).catch(() => {});
                  } finally {
                    setIsSending(false);
                  }
                }}
                className={`px-3 py-1 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white font-medium text-[11px] cursor-pointer flex items-center gap-1 shadow-xs transition-all ${
                  isSending ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                <Send className="w-3 h-3" />
                直接发送
              </button>
            </div>
          </div>
        )}

        {/* Real-time Translation Preview / Failure Recovery Strip */}
        {Boolean(inputText.trim() && (translatedPreview || previewError)) && (
          previewError ? (
            <div className="mb-2 px-3 py-2 bg-rose-500/10 dark:bg-rose-500/15 aurora:bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10.5px] font-semibold text-rose-700 dark:text-rose-300 block">
                    翻译失败，请检查翻译通道
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (isLlmOutboundEngine) {
                      void handleManualLlmPreview();
                    } else {
                      setPreviewRetryNonce((n) => n + 1);
                    }
                  }}
                  className="px-2 py-1 rounded-md bg-white/80 dark:bg-[#0e1726] aurora:bg-[#101c23] border border-rose-500/30 hover:bg-white dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-rose-600 dark:text-rose-300 text-[11px] font-semibold cursor-pointer"
                >
                  重试
                </button>
                <button
                  type="button"
                  disabled={isSending}
                  onClick={() => void handleSendText(true)}
                  className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                >
                  直接发送原文
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-2 px-3 py-1.5 bg-[#f0f7ff] dark:bg-[#0e1928] aurora:bg-[#102229] border border-[#dbeafe] dark:border-[#1e3148] aurora:border-[#1f3b45] rounded-xl flex items-center justify-between text-xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 min-w-0">
                <Languages className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">
                    译文预览：
                  </span>
                  <span className="text-xs font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] truncate block">
                    {translatedPreview}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                  {sendWithEnter ? 'Enter' : 'Ctrl+Enter'} 发送
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setTranslatedPreview('');
                    setTranslatedPreviewSource('');
                    setPreviewError('');
                  }}
                  className="p-1 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] rounded hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-[#152934] cursor-pointer transition-colors"
                  title="取消此译文预览 (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )
        )}

        {(() => {
          const trimmedQuery = inputText.trim();
          const detectedNorm = trimmedQuery ? normalizeChatLangCode(detectClientLangCode(trimmedQuery)) : 'auto';
          const targetNorm = normalizeChatLangCode(outboundTargetLang);
          const sameLang = detectedNorm !== 'auto' && targetNorm !== 'auto' && detectedNorm === targetNorm;
          const shouldShowLlmManualBar =
            isLlmOutboundEngine &&
            Boolean(trimmedQuery) &&
            hasTranslatableLetters(trimmedQuery) &&
            isChatTransEnabled &&
            translationSettings?.autoTranslateOutbound !== false &&
            (!editingMessage || translateOnEdit) &&
            !sameLang &&
            !(translatedPreview && translatedPreviewSource === trimmedQuery) &&
            !previewError;
          if (!shouldShowLlmManualBar) return null;
          return (
            <div className="mb-2 px-3 py-1.5 bg-[#f8fafc] dark:bg-[#0e1928] aurora:bg-[#102229] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1f3b45] rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] shrink-0" />
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate">
                  大模型翻译已开启（打字不耗额度，发送或点击右侧按钮译为 {getLanguageDisplayName(outboundTargetLang)}）
                </span>
              </div>
              <button
                type="button"
                disabled={isTranslatingPreview}
                onClick={() => void handleManualLlmPreview()}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#2481cc]/10 hover:bg-[#2481cc]/20 dark:bg-[#2ba0ff]/15 dark:hover:bg-[#2ba0ff]/25 aurora:bg-[#14b8a6]/15 aurora:hover:bg-[#14b8a6]/25 border border-[#2481cc]/25 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/30 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] text-[11px] font-semibold cursor-pointer disabled:opacity-60 transition-colors"
              >
                <RotateCw className={`w-3 h-3 ${isTranslatingPreview ? 'animate-spin' : ''}`} />
                <span>{isTranslatingPreview ? '生成中...' : '预览AI翻译'}</span>
              </button>
            </div>
          );
        })()}

        {/* Reply Quote Banner above Input */}
        {replyingTo && (
          <div className="mb-2 p-2 px-3 bg-[#f0f7ff] dark:bg-[#0e1928] aurora:bg-[#102229] border border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35 rounded-xl flex items-center justify-between text-xs animate-in fade-in duration-150">
            <div className="min-w-0 pr-2">
              <div className="font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] flex items-center gap-1.5">
                <Reply className="w-3.5 h-3.5" />
                <span>回复 {replyingTo.sender === 'me' ? '我' : (chat.title || '对方')}</span>
              </div>
              <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate mt-0.5">
                {replyingTo.text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="p-1 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] cursor-pointer shrink-0"
              title="取消回复"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Edit Message Banner above Input */}
        {editingMessage && (
          <div className="mb-2 p-2 px-3 bg-amber-50 dark:bg-amber-500/12 aurora:bg-amber-500/12 border border-amber-300/70 dark:border-amber-500/35 aurora:border-amber-500/35 rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
            <div className="min-w-0 pr-2 flex-1">
              <div className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>正在编辑消息</span>
                </span>
                {isChatTransEnabled && translationSettings?.autoTranslateOutbound !== false && (
                  <label className="inline-flex items-center gap-1 text-[11px] font-normal text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={translateOnEdit}
                      onChange={(e) => setTranslateOnEdit(e.target.checked)}
                      className="rounded border-amber-400 text-[#2481cc] aurora:text-[#14b8a6] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf]"
                    />
                    <span>重新翻译为外文</span>
                  </label>
                )}
              </div>
              <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate mt-0.5">
                原消息: {editingMessage.text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingMessage(null);
                setTranslateOnEdit(false);
                setInputText('');
              }}
              className="p-1 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] cursor-pointer shrink-0"
              title="取消编辑"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Attachment Menu Popup */}
        {isAttachmentMenuOpen && attachmentMenuPos && typeof document !== 'undefined' && createPortal(
          <div
            ref={attachmentMenuRef}
            style={{ top: `${attachmentMenuPos.top}px`, left: `${attachmentMenuPos.left}px` }}
            className="fixed z-[9990] w-44 bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] rounded-2xl shadow-2xl border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] p-2 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-150 text-xs select-none"
          >
            <button
              type="button"
              onClick={() => {
                imageInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
            >
              <ImageIcon className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
              <span>照片或图片</span>
            </button>
            <button
              type="button"
              onClick={() => {
                videoInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
            >
              <Video className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
              <span>视频消息</span>
            </button>
            <button
              type="button"
              onClick={() => {
                audioInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
            >
              <Music className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
              <span>音频与语音</span>
            </button>
            <button
              type="button"
              onClick={() => {
                fileInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
            >
              <FileText className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
              <span>文档与文件</span>
            </button>
          </div>,
          document.body
        )}

        {/* Hidden File Inputs */}
        <input
          type="file"
          ref={imageInputRef}
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />
        <input
          type="file"
          ref={videoInputRef}
          accept="video/mp4,video/quicktime,video/webm,video/mkv,video/avi,video/*"
          className="hidden"
          onChange={handleVideoSelect}
        />
        <input
          type="file"
          ref={audioInputRef}
          accept="audio/mp3,audio/ogg,audio/wav,audio/m4a,audio/aac,audio/*"
          className="hidden"
          onChange={handleAudioSelect}
        />
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Pasted Image Pending Send Strip */}
        {pastedImage && (
          <div className="mb-2.5 p-2.5 bg-[#f0f7ff] dark:bg-[#0e1928] aurora:bg-[#102229] border border-[#2481cc]/40 aurora:border-[#2dd4bf]/40 rounded-xl flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150 shadow-xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-black/10 dark:border-white/10 aurora:border-white/10 bg-black/5">
                <img
                  src={pastedImage.dataUrl}
                  alt="pasted preview"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>已捕获剪贴板照片</span>
                  <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] font-normal">
                    ({(pastedImage.file.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate mt-0.5">
                  {inputText.trim() ? `配文: ${inputText}` : `可在输入框输入配文，或直接点击发送 (${sendWithEnter ? 'Enter' : 'Ctrl+Enter'})`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => clearPastedImage(true)}
                className="p-1.5 text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] rounded-lg hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-[#152934] cursor-pointer"
                title="取消发送此图片 (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleSendPastedImage}
                className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white font-medium text-xs cursor-pointer flex items-center gap-1.5 shadow-xs"
                title={`立即发送照片 (${sendWithEnter ? 'Enter' : 'Ctrl+Enter'})`}
              >
                <Send className="w-3 h-3" />
                <span>发送照片</span>
              </button>
            </div>
          </div>
        )}

        {/* Composer Top Utility Strip: Outbound Auto-Translate Target */}
        <div className="flex items-center justify-between gap-2 mb-2 text-[11.5px]">
          <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
            <div
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-transparent select-none pointer-events-none cursor-default shrink-0 ${
                !isChatTransEnabled
                  ? 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]'
                  : 'text-[#475569] dark:text-[#94a3b8] aurora:text-[#7e9aa5]'
              }`}
            >
              <Languages className={`w-3.5 h-3.5 ${isChatTransEnabled ? 'text-[#16a34a] dark:text-emerald-400' : 'text-[#94a3b8] dark:text-[#64748b]'}`} />
              <span>
                {isChatTransEnabled
                  ? `发送时自动译为: ${getLanguageDisplayName(outboundTargetLang)}`
                  : `${chatTransScopeLabel}已关闭 · 直接发送原文`}
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={isSynthesizingVoice}
            onClick={() => void handleDirectVoiceSynthesis()}
            title="使用已保存声纹直接将当前文本合成为语音发送"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[#64748b] hover:text-[#2481cc] hover:bg-[#f1f5f9] dark:text-[#94a3b8] dark:hover:text-[#2ba0ff] dark:hover:bg-[#101c2d] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] aurora:hover:bg-[#12222a] transition-colors cursor-pointer shrink-0 ${
              isSynthesizingVoice ? 'opacity-60 pointer-events-none' : ''
            }`}
          >
            <AudioWaveform className={`w-3.5 h-3.5 ${isSynthesizingVoice ? 'animate-pulse text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]' : ''}`} />
            <span className="hidden sm:inline">{isSynthesizingVoice ? '合成中...' : '音色合成'}</span>
          </button>
        </div>

        {/* Main Input Container + Bottom Compact Action Row */}
        <div className="rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#1e343e] bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#111d24] focus-within:bg-white dark:focus-within:bg-[#101b2c] aurora:focus-within:bg-[#13222b] focus-within:border-[#2481cc] dark:focus-within:border-[#2ba0ff] aurora:focus-within:border-[#2dd4bf] transition-all">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              editingMessage
                ? '修改消息...'
                : pastedImage
                ? '添加图片说明（可选）...'
                : '输入消息（支持自动翻译、Shift+Enter 换行与 Ctrl+V 粘贴图片）...'
            }
            className="w-full max-h-36 resize-none bg-transparent text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-[13.5px] leading-relaxed px-3.5 pt-2.5 pb-1.5 focus:outline-none placeholder-[#94a3b8] dark:placeholder-[#566d85] aurora:placeholder-[#5a7782] overflow-y-hidden"
          />

          <div className="px-2.5 pb-2 pt-1 flex items-center justify-between border-t border-[#e2e8f0]/60 dark:border-white/5 aurora:border-[#182b34]">
            {/* Left Tools */}
            <div className="flex items-center gap-1">
              <button
                ref={attachmentButtonRef}
                type="button"
                onClick={() => setIsAttachmentMenuOpen(!isAttachmentMenuOpen)}
                title="附加文件、图片或文档"
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                  isAttachmentMenuOpen
                    ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2ba0ff]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4]'
                    : 'hover:bg-[#e2e8f0]/60 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4]'
                }`}
              >
                <Paperclip className="w-4 h-4 -rotate-45" />
              </button>

              <button
                ref={emojiButtonRef}
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                title="表情与贴纸"
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                  showEmojiPicker
                    ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2ba0ff]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4]'
                    : 'hover:bg-[#e2e8f0]/60 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4]'
                }`}
              >
                <Smile className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsVoiceStudioOpen(true)}
                title="语音合成"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors cursor-pointer"
              >
                <AudioWaveform className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleGenerateAiSuggestion}
                disabled={isGeneratingAi}
                title={
                  aiCooldownSeconds > 0
                    ? `大模型冷却中（剩余 ${aiCooldownSeconds} 秒）`
                    : '基于人设与最近30条对话生成 AI 拟真回复'
                }
                className={`flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  isGeneratingAi
                    ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2ba0ff]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4]'
                    : aiCooldownSeconds > 0
                    ? 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]/80 dark:bg-[#152438] dark:text-[#7b93ad] dark:hover:bg-[#1b2f48] aurora:bg-[#13252e] aurora:text-[#7e9aa5] aurora:hover:bg-[#18303b]'
                    : 'hover:bg-[#e8f3ff] text-[#2481cc] dark:text-[#2ba0ff] dark:hover:bg-[#2ba0ff]/15 aurora:text-[#5eead4] aurora:hover:bg-[#112e37]'
                }`}
              >
                <Sparkles className={`w-3.5 h-3.5 ${isGeneratingAi ? 'animate-spin' : ''}`} />
                <span>
                  {isGeneratingAi
                    ? '生成中...'
                    : aiCooldownSeconds > 0
                    ? `AI 建议回复 (${aiCooldownSeconds}s)`
                    : 'AI 建议回复'}
                </span>
              </button>
            </div>

            {/* Right Actions: Shortcut hint + Mic / Send Button */}
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[11px] text-[#94a3b8] dark:text-[#7b93ad] aurora:text-[#7e9aa5] select-none">
                {sendWithEnter ? 'Enter 发送 · Shift+Enter 换行' : 'Ctrl+Enter 发送 · Enter 换行'}
              </span>

              {inputText.trim() || pastedImage ? (
                <button
                  type="button"
                  disabled={isSending}
                  onClick={pastedImage ? handleSendPastedImage : () => void handleSendText()}
                  title={editingMessage ? '保存修改' : pastedImage ? '发送照片' : '发送消息'}
                  className={`h-8 px-3.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shadow-xs shrink-0 ${
                    isSending ? 'opacity-50 pointer-events-none' : ''
                  }`}
                >
                  <span>{editingMessage ? '保存' : pastedImage ? '发送照片' : '发送'}</span>
                  {editingMessage ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleToggleRecordMic}
                  title={isRecordingMic ? '点击停止录音并发送' : '点击录制语音消息'}
                  className={`h-8 px-3 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-all cursor-pointer shrink-0 ${
                    isRecordingMic
                      ? 'bg-rose-500 text-white animate-pulse'
                      : 'bg-[#f1f5f9] hover:bg-[#e8f3ff] text-[#475569] hover:text-[#2481cc] dark:bg-[#152438] dark:text-[#b4c6d8] dark:hover:text-[#2ba0ff] aurora:bg-[#152934] aurora:text-[#b7d0d8] aurora:hover:text-[#5eead4]'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>{isRecordingMic ? `${recordDuration}s` : '语音'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>

      {/* Telegram Emoji & Official Stickers Picker Popover */}
      <TelegramEmojiPicker
        isOpen={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
        onSelectEmoji={(emoji) => setInputText((prev) => prev + emoji)}
        onSelectSticker={handleSendSticker}
        accountId={currentAccountId}
        anchorRef={emojiButtonRef}
      />


      {/* Telegram Chat Info & Shared Media Drawer */}
      <TelegramChatInfoDrawer
        isOpen={isChatInfoOpen}
        onClose={() => setChatInfoOpen(false)}
        chat={chat}
        accountId={currentAccountId}
        messages={messages}
        onClearHistory={onClearHistory}
        onToggleMute={onToggleMuteChat}
        onTogglePin={onTogglePinChat}
        onUpdateTitle={onUpdateChatTitle}
        onChatInfoUpdated={onChatInfoUpdated}
        onAddContact={onAddContact}
        onRemoveContact={onRemoveContact}
        onRefreshMediaUrls={onRefreshMediaUrls}
        onJumpToMessage={handleJumpToMessage}
        onSelectMember={(member) => {
          void handleOpenGroupMemberProfile({
            senderId: member.id,
            name: member.name,
            username: member.username,
            avatarUrl: member.avatarUrl,
            statusText: member.statusText,
            isOnline: member.isOnline,
            isBot: member.isBot,
          });
        }}
      />

      {/* Voice Clone Studio Modal */}
      <VoiceCloneStudioModal
        isOpen={isVoiceStudioOpen}
        onClose={() => setIsVoiceStudioOpen(false)}
        initialText={inputText.trim() || translatedPreview}
        translatedText={translatedPreview}
        targetLangName={getLanguageDisplayName(outboundTargetLang)}
        customConfig={customLLMConfig}
        onSendVoice={handleTriggerVoiceCloneSend}
      />

      {/* Telegram Message Context Menu Popup (Right-Click) */}
      {messageContextMenu && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[9995] bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] rounded-2xl p-1.5 shadow-2xl min-w-[170px] text-xs select-none animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: `${messageContextMenu.x}px`,
            top: `${messageContextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quick Reaction Bar in Context Menu */}
          <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
            {['👍', '❤️', '🔥', '🎉'].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onToggleReaction?.(messageContextMenu.message.id, emoji);
                  setMessageContextMenu(null);
                }}
                className="text-base hover:scale-130 transition-transform p-1 cursor-pointer"
                title={`回应 ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setReplyingTo(messageContextMenu.message);
              setEditingMessage(null);
              setMessageContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
          >
            <Reply className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
            <span>回复消息</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const target = messageContextMenu.message;
              setMessageContextMenu(null);
              handleOpenForwardModal([target]);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
          >
            <Forward className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
            <span>转发消息</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const target = messageContextMenu.message;
              setMessageContextMenu(null);
              setIsMultiSelectMode(true);
              setSelectedMessageIds(new Set([target.id]));
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
          >
            <CheckSquare className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
            <span>多选消息</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (messageContextMenu.message.isImage && messageContextMenu.message.imageUrl) {
                copyImageToClipboard(messageContextMenu.message.imageUrl, messageContextMenu.message.id);
              } else {
                copyToClipboard(messageContextMenu.message.text, messageContextMenu.message.id);
              }
              setMessageContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
          >
            <Copy className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
            <span>{messageContextMenu.message.isImage ? '复制照片' : messageContextMenu.message.isVideo ? '复制视频说明' : '复制文字'}</span>
          </button>

          {onRetranslateMessage &&
            (!messageContextMenu.message.isAudio || messageContextMenu.message.sttText) &&
            Boolean(
              (
                messageContextMenu.message.sttText ||
                messageContextMenu.message.text ||
                messageContextMenu.message.imageCaption ||
                ''
              ).trim()
            ) && (
            <button
              type="button"
              onClick={() => {
                const target = messageContextMenu.message;
                setMessageContextMenu(null);
                void onRetranslateMessage(target.id);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
            >
              <Languages className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
              <span>{messageContextMenu.message.translatedText ? '重新翻译' : '翻译此消息'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onTogglePinMessage?.(messageContextMenu.message.id);
              setMessageContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
          >
            <Pin className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
            <span>{messageContextMenu.message.isPinned ? '取消置顶' : '置顶消息'}</span>
          </button>

          {messageContextMenu.message.sender === 'me' &&
            !messageContextMenu.message.isAudio &&
            messageContextMenu.message.deliveryStatus !== 'failed' &&
            messageContextMenu.message.deliveryStatus !== 'pending' &&
            (!chat.id.startsWith('tg_') || typeof messageContextMenu.message.telegramMessageId === 'number') && (
            <button
              type="button"
              onClick={() => {
                setEditingMessage(messageContextMenu.message);
                setTranslateOnEdit(false);
                setInputText(messageContextMenu.message.text);
                setReplyingTo(null);
                setMessageContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] cursor-pointer font-medium"
            >
              <Edit2 className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
              <span>编辑消息</span>
            </button>
          )}

          <div className="my-1 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]" />

          <button
            type="button"
            onClick={() => {
              const target = messageContextMenu.message;
              setMessageContextMenu(null);
              setRevokeSingleDelete(true);
              setMessageToDelete(target);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 cursor-pointer font-medium"
          >
            <Trash2 className="w-4 h-4 text-rose-500" />
            <span>删除单条消息</span>
          </button>
        </div>,
        document.body
      )}

      {/* Telegram Confirmation Modal for Deleting Single Message */}
      {messageToDelete && (() => {
        const isLocalOnly =
          !messageToDelete.telegramMessageId ||
          messageToDelete.deliveryStatus === 'failed' ||
          messageToDelete.deliveryStatus === 'pending';
        const isTgUserChat = chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot';
        const isSupergroupOrChannel = chat.id.startsWith('tg_-100') || Boolean(chat.isChannel);
        const showRevokeOption = !isLocalOnly && isTgUserChat && !isSupergroupOrChannel;
        const showSupergroupHint = !isLocalOnly && isTgUserChat && isSupergroupOrChannel;
        const showPeerGroupHint = !isLocalOnly && isTgUserChat && messageToDelete.sender === 'peer' && (chat.isGroup || chat.isChannel);
        return (
          <div className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
            <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-500/10 dark:bg-rose-500/20 text-rose-500 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
                    删除此条消息？
                  </h3>
                  <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-0.5">
                    {isLocalOnly
                      ? '该消息未送达 Telegram 云端，确认后将仅从本地列表移除。'
                      : messageToDelete.sender === 'me'
                        ? '确定删除您发送的这条消息吗？'
                        : '确定删除客户发送的这条消息吗？'}
                  </p>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] truncate border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                “{messageToDelete.text || (messageToDelete.isAudio ? '🎤 语音消息' : messageToDelete.isVideo ? '🎬 视频消息' : messageToDelete.isImage ? '🖼️ 图片消息' : '消息内容')}”
              </div>

              {showRevokeOption && (
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={revokeSingleDelete}
                    onChange={(e) => setRevokeSingleDelete(e.target.checked)}
                    className="mt-0.5 rounded border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[#2481cc] aurora:text-[#14b8a6] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf]"
                  />
                  <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] leading-snug">
                    同时为对方删除 / 双向撤回
                  </span>
                </label>
              )}

              {showSupergroupHint && !showPeerGroupHint && (
                <p className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] leading-snug">
                  提示：在超级群组/频道中删除消息将直接从云端对所有成员删除。
                </p>
              )}

              {showPeerGroupHint && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
                  提示：在群组/频道中删除他人消息需要具备管理员删除权限，否则 Telegram 服务端将拒绝撤回（超级群组删除将对全员生效）。
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMessageToDelete(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteMessage}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>确认删除</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Telegram Batch Delete Confirmation Modal */}
      {showBatchDeleteModal && (() => {
        const isTgUserChat = chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot';
        const isSupergroupOrChannel = chat.id.startsWith('tg_-100') || Boolean(chat.isChannel);
        return (
        <div className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 dark:bg-rose-500/20 text-rose-500 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
                  批量删除 {selectedMessageIds.size} 条消息？
                </h3>
                <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-0.5">
                  删除操作将同步到 Telegram 云端及本地记录，不可恢复。
                </p>
              </div>
            </div>

            {isTgUserChat && !isSupergroupOrChannel && (
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={revokeBatchDelete}
                  onChange={(e) => setRevokeBatchDelete(e.target.checked)}
                  className="mt-0.5 rounded border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[#2481cc] aurora:text-[#14b8a6] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf]"
                />
                <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] leading-snug">
                  同时为对方删除 / 双向撤回
                </span>
              </label>
            )}

            {isTgUserChat && isSupergroupOrChannel && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
                提示：在超级群组/频道中批量删除将对所有成员生效；若包含他人消息需具备管理员权限。
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isBatchDeleting}
                onClick={() => setShowBatchDeleteModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isBatchDeleting}
                onClick={() => void handleConfirmBatchDelete()}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isBatchDeleting ? '正在删除...' : '确认批量删除'}</span>
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Forward Messages Target Picker Modal */}
      {forwardModalMessages && (
        <div className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-4 py-3 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Forward className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4]" />
                <span className="font-semibold text-sm text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
                  转发 {forwardModalMessages.length} 条消息至...
                </span>
              </div>
              <button
                type="button"
                onClick={() => setForwardModalMessages(null)}
                className="p-1 text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={forwardSearch}
                  onChange={(e) => setForwardSearch(e.target.value)}
                  placeholder="搜索目标会话、联系人或群组..."
                  autoFocus
                  className="w-full bg-[#f1f5f9] dark:bg-[#08101a] aurora:bg-[#081014] pl-8 pr-3 py-1.5 rounded-lg text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                />
              </div>
              <label className="flex items-center gap-2 text-[11.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forwardDropAuthor}
                  onChange={(e) => setForwardDropAuthor(e.target.checked)}
                  className="rounded border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[#2481cc] aurora:text-[#14b8a6] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf]"
                />
                <span>隐藏原发送者名称（不附带转发来源）</span>
              </label>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {availableChats
                .filter((c) => {
                  const q = forwardSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    c.title.toLowerCase().includes(q) ||
                    (c.username && c.username.toLowerCase().includes(q))
                  );
                })
                .map((targetChat) => (
                  <button
                    key={targetChat.id}
                    type="button"
                    disabled={isForwarding}
                    onClick={() => void handleConfirmForward(targetChat.id)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#f0f7ff] dark:hover:bg-[#132234] aurora:hover:bg-[#112d36] transition-colors text-left cursor-pointer disabled:opacity-50"
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden relative"
                      style={{ backgroundColor: targetChat.avatarBg || '#2481cc' }}
                    >
                      <span>{targetChat.avatarInitial}</span>
                      {targetChat.avatarUrl && (
                        <img
                          src={resolveDisplayUrl(targetChat.avatarUrl)}
                          alt={targetChat.title}
                          className="w-full h-full object-cover absolute inset-0"
                          onLoad={(e) => {
                            e.currentTarget.style.display = '';
                          }}
                          onError={(e) => {
                            const imgEl = e.currentTarget;
                            void triggerSilentUrlRefresh(targetChat.avatarUrl, true).then((nextUrl) => {
                              if (!nextUrl) {
                                imgEl.style.display = 'none';
                              }
                            });
                          }}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] truncate">
                        {targetChat.title}
                      </div>
                      <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate">
                        {targetChat.username || (targetChat.isGroup ? '群组' : targetChat.isChannel ? '频道' : '私聊对话')}
                      </div>
                    </div>
                    <Forward className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] shrink-0" />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Telegram Group / Channel Invite Preview & Join Modal */}
      {inviteModalState &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
            onClick={() => !inviteModalState.joining && setInviteModalState(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1f3b44] bg-white dark:bg-[#0f172a] aurora:bg-[#0d1c22] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1c353d]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
                  {inviteModalState.preview?.isChannel ? (
                    <Megaphone className="w-4 h-4 text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4]" />
                  ) : (
                    <Users className="w-4 h-4 text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4]" />
                  )}
                  <span>{inviteModalState.preview?.isChannel ? '频道邀请' : '群组邀请'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => !inviteModalState.joining && setInviteModalState(null)}
                  className="p-1 rounded-lg text-[#64748b] dark:text-[#94a3b8] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5">
                {inviteModalState.loading ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2.5 text-[#64748b] dark:text-[#94a3b8] aurora:text-[#8eb2bd]">
                    <RotateCw className="w-6 h-6 animate-spin text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4]" />
                    <span className="text-xs">正在读取 Telegram 群组/频道信息...</span>
                  </div>
                ) : inviteModalState.error && !inviteModalState.preview ? (
                  <div className="py-4 flex flex-col items-center text-center gap-2.5">
                    <ShieldAlert className="w-8 h-8 text-rose-500" />
                    <p className="text-xs leading-relaxed text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8]">
                      {inviteModalState.error}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center text-white text-lg font-bold shadow-md overflow-hidden relative mb-3"
                      style={{ backgroundColor: inviteModalState.preview?.chat?.avatarBg || '#2481cc' }}
                    >
                      <span>{(inviteModalState.preview?.title || 'TG').slice(0, 2).toUpperCase()}</span>
                      {inviteModalState.preview?.chat?.avatarUrl && (
                        <img
                          src={resolveDisplayUrl(inviteModalState.preview.chat.avatarUrl)}
                          alt={inviteModalState.preview.title || 'Group'}
                          className="w-full h-full object-cover absolute inset-0"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      )}
                    </div>
                    <h3 className="text-base font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] break-words">
                      {inviteModalState.preview?.title || 'Telegram 群组'}
                    </h3>
                    <div className="mt-1 text-xs text-[#64748b] dark:text-[#94a3b8] aurora:text-[#8eb2bd]">
                      {inviteModalState.preview?.isChannel ? '频道' : '群组'}
                      {typeof inviteModalState.preview?.participantsCount === 'number'
                        ? ` · ${inviteModalState.preview.participantsCount.toLocaleString()} 位成员`
                        : ''}
                    </div>
                    {inviteModalState.preview?.about && (
                      <p className="mt-3 text-xs leading-relaxed text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8] bg-[#f8fafc] dark:bg-[#132234] aurora:bg-[#10262d] px-3 py-2 rounded-xl w-full text-left whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
                        {inviteModalState.preview.about}
                      </p>
                    )}
                    {inviteModalState.preview?.requestSent ? (
                      <div className="mt-3 w-full rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>已提交入群申请，请等待管理员批准</span>
                      </div>
                    ) : inviteModalState.preview?.requestNeeded && !inviteModalState.preview?.alreadyMember ? (
                      <div className="mt-3 w-full rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                        该群组开启了入群审核，点击加入后需管理员审批
                      </div>
                    ) : null}
                    {inviteModalState.error && (
                      <div className="mt-3 w-full rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-500">
                        {inviteModalState.error}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={inviteModalState.joining}
                    onClick={() => setInviteModalState(null)}
                    className="px-3.5 py-2 rounded-xl text-xs font-medium text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {inviteModalState.preview?.requestSent ? '关闭' : '取消'}
                  </button>
                  {!inviteModalState.loading && inviteModalState.preview && !inviteModalState.preview.requestSent && (
                    <button
                      type="button"
                      disabled={inviteModalState.joining}
                      onClick={() => void handleConfirmJoinInvite()}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#2481cc] hover:bg-[#1e6eb0] dark:bg-[#0284c7] dark:hover:bg-[#0369a1] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
                    >
                      {inviteModalState.joining ? (
                        <>
                          <RotateCw className="w-3.5 h-3.5 animate-spin" />
                          <span>正在加入...</span>
                        </>
                      ) : inviteModalState.preview.alreadyMember ? (
                        <>
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>打开会话</span>
                        </>
                      ) : inviteModalState.preview.requestNeeded ? (
                        <span>申请加入</span>
                      ) : (
                        <span>{inviteModalState.preview.isChannel ? '订阅频道' : '加入群组'}</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Group Member Profile Modal */}
      {memberProfileModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[75] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={() => setMemberProfileModal(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#0e1726] aurora:bg-[#0d181e] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1d343d] shadow-2xl overflow-hidden text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between">
                <span className="text-xs font-semibold">成员个人资料</span>
                <button
                  type="button"
                  onClick={() => setMemberProfileModal(null)}
                  className="p-1 rounded-lg hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-4 space-y-3.5">
                <div className="flex items-center gap-3.5">
                  {(() => {
                    const safeAvatar = memberProfileModal.avatarUrl
                      ? resolveDisplayUrl(memberProfileModal.avatarUrl) || ''
                      : '';
                    const showImg = Boolean(safeAvatar && !failedAvatarUrls.has(safeAvatar));
                    const colorIdx = getTelegramSenderColorIndex(
                      memberProfileModal.senderId || memberProfileModal.name
                    );
                    return showImg ? (
                      <img
                        src={safeAvatar}
                        alt={memberProfileModal.name}
                        onClick={() =>
                          setLightboxMedia({
                            type: 'image',
                            url: safeAvatar,
                            rawUrl: memberProfileModal.avatarUrl,
                            caption: memberProfileModal.name,
                            msgId: `avatar_${memberProfileModal.targetChatId}`,
                          })
                        }
                        className="w-14 h-14 rounded-full object-cover shrink-0 border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] cursor-zoom-in"
                        onError={() => {
                          setFailedAvatarUrls((prev) => new Set(prev).add(safeAvatar));
                        }}
                      />
                    ) : (
                      <div
                        className={`w-14 h-14 rounded-full shrink-0 bg-gradient-to-br ${TG_SENDER_AVATAR_BGS[colorIdx]} flex items-center justify-center text-white text-lg font-semibold`}
                      >
                        {getSenderAvatarInitial(memberProfileModal.name, memberProfileModal.senderId)}
                      </div>
                    );
                  })()}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate">{memberProfileModal.name}</span>
                      {memberProfileModal.info?.isVerified && (
                        <span className="px-1.5 py-0.5 rounded bg-[#2481cc]/15 text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] text-[10px] font-medium shrink-0">
                          已认证
                        </span>
                      )}
                      {(memberProfileModal.info?.isBot ?? memberProfileModal.isBot) && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-medium shrink-0">
                          Bot
                        </span>
                      )}
                    </div>
                    <div
                      className={`text-[11px] mt-0.5 ${
                        memberProfileModal.info?.isOnline ?? memberProfileModal.isOnline
                          ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                          : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]'
                      }`}
                    >
                      {memberProfileModal.loading
                        ? '正在拉取最新云端资料...'
                        : memberProfileModal.info?.statusText || memberProfileModal.statusText || 'Telegram 成员'}
                    </div>
                  </div>
                </div>

                {memberProfileModal.loading && (
                  <div className="flex items-center gap-2 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                    <span>正在读取用户名、简介与联系人状态...</span>
                  </div>
                )}

                {memberProfileModal.error && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-700 dark:text-amber-300">
                    {memberProfileModal.error}
                  </div>
                )}

                {/* Metadata Rows */}
                <div className="rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] divide-y divide-[#e2e8f0] dark:divide-[#18273a] aurora:divide-[#182b34] text-xs">
                  {(memberProfileModal.info?.username || memberProfileModal.username) && (
                    <div className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] min-w-0">
                        <AtSign className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
                          {(() => {
                            const u = memberProfileModal.info?.username || memberProfileModal.username || '';
                            return u.startsWith('@') ? u : `@${u}`;
                          })()}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const u = memberProfileModal.info?.username || memberProfileModal.username || '';
                          const formatted = u.startsWith('@') ? u : `@${u}`;
                          void navigator.clipboard?.writeText(formatted);
                          setCopiedId(`member_un_${memberProfileModal.targetChatId}`);
                          setTimeout(() => setCopiedId((c) => (c === `member_un_${memberProfileModal.targetChatId}` ? null : c)), 1500);
                        }}
                        className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] hover:underline shrink-0 cursor-pointer"
                      >
                        {copiedId === `member_un_${memberProfileModal.targetChatId}` ? '已复制' : '复制'}
                      </button>
                    </div>
                  )}

                  {memberProfileModal.info?.phone && (
                    <div className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] min-w-0">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">{memberProfileModal.info.phone}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(memberProfileModal.info?.phone || '');
                          setCopiedId(`member_ph_${memberProfileModal.targetChatId}`);
                          setTimeout(() => setCopiedId((c) => (c === `member_ph_${memberProfileModal.targetChatId}` ? null : c)), 1500);
                        }}
                        className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] hover:underline shrink-0 cursor-pointer"
                      >
                        {copiedId === `member_ph_${memberProfileModal.targetChatId}` ? '已复制' : '复制'}
                      </button>
                    </div>
                  )}

                  <div className="px-3 py-2 flex items-center justify-between gap-2 text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0">ID</span>
                      <span className="font-mono truncate select-all text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
                        {memberProfileModal.senderId}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(memberProfileModal.senderId);
                        setCopiedId(`member_id_${memberProfileModal.targetChatId}`);
                        setTimeout(() => setCopiedId((c) => (c === `member_id_${memberProfileModal.targetChatId}` ? null : c)), 1500);
                      }}
                      className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] hover:underline shrink-0 cursor-pointer"
                    >
                      {copiedId === `member_id_${memberProfileModal.targetChatId}` ? '已复制' : '复制'}
                    </button>
                  </div>

                  {memberProfileModal.info?.description && (
                    <div className="px-3 py-2 text-[11.5px] leading-relaxed text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] whitespace-pre-wrap break-words">
                      {memberProfileModal.info.description}
                    </div>
                  )}
                </div>

                {memberProfileModal.actionError && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 text-center">{memberProfileModal.actionError}</p>
                )}
                {memberProfileModal.actionSuccess && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 text-center">{memberProfileModal.actionSuccess}</p>
                )}

                {/* Action Buttons */}
                {(() => {
                  const info = memberProfileModal.info;
                  const isChannelOrGroupIdentity =
                    memberProfileModal.senderId.startsWith('-') ||
                    Boolean(info?.isGroup || info?.isChannel);
                  const selfTgId = currentAccountId?.startsWith('acc_tg_')
                    ? `tg_${currentAccountId.replace(/^acc_tg_/, '')}`
                    : '';
                  const isSelfMember = Boolean(info?.isSelf || (selfTgId && memberProfileModal.targetChatId === selfTgId));
                  const rawUsername = (info?.username || memberProfileModal.username || '').trim();
                  const normalizedUsername = rawUsername.replace(/^@/, '').toLowerCase();
                  const formattedUsername = rawUsername ? (rawUsername.startsWith('@') ? rawUsername : `@${rawUsername}`) : undefined;

                  return (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {onJoinOrOpenChat && (
                        <button
                          type="button"
                          onClick={() => {
                            const existing = availableChats.find(
                              (c) =>
                                c.id === memberProfileModal.targetChatId ||
                                (normalizedUsername && c.username && c.username.replace(/^@/, '').toLowerCase() === normalizedUsername)
                            );
                            const nextChat: Chat = existing
                              ? {
                                  ...existing,
                                  title: existing.title || memberProfileModal.name,
                                  avatarUrl: existing.avatarUrl || memberProfileModal.avatarUrl,
                                  ...(formattedUsername ? { username: formattedUsername } : {}),
                                  ...(info?.phone ? { phone: info.phone } : {}),
                                  ...(typeof info?.isOnline === 'boolean' ? { isOnline: info.isOnline } : {}),
                                  ...(info?.statusText ? { statusText: info.statusText } : {}),
                                }
                              : {
                                  id: memberProfileModal.targetChatId,
                                  accountId: currentAccountId || chat?.accountId || '',
                                  title: memberProfileModal.name,
                                  avatarBg: 'bg-[#2481cc]',
                                  avatarInitial: getSenderAvatarInitial(memberProfileModal.name, memberProfileModal.senderId),
                                  avatarUrl: memberProfileModal.avatarUrl,
                                  lastMessage: '',
                                  lastTime: '刚刚',
                                  unreadCount: 0,
                                  isOnline: Boolean(info?.isOnline ?? memberProfileModal.isOnline),
                                  statusText: info?.statusText || memberProfileModal.statusText,
                                  username: formattedUsername,
                                  phone: info?.phone,
                                  description: info?.description,
                                  isVerified: info?.isVerified,
                                  isBot: Boolean(info?.isBot ?? memberProfileModal.isBot),
                                  isGroup: Boolean(info?.isGroup),
                                  isChannel: Boolean(info?.isChannel),
                                  isBlocked: info?.isBlocked,
                                  sourceLang: chat?.sourceLang || 'Auto',
                                  targetLang: chat?.targetLang || 'zh-CN',
                                  translationEnabled: chat?.translationEnabled ?? true,
                                };
                            onJoinOrOpenChat(nextChat);
                            setChatInfoOpen(false);
                            setMemberProfileModal(null);
                          }}
                          className="flex-1 min-w-[110px] py-2 px-3 rounded-xl bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>{isChannelOrGroupIdentity ? '打开会话' : isSelfMember ? '收藏夹' : '发私信'}</span>
                        </button>
                      )}

                      {!isSelfMember && !isChannelOrGroupIdentity && !info?.isBot && !memberProfileModal.isBot && info && !info.isContact && (
                        <button
                          type="button"
                          disabled={Boolean(memberProfileModal.isAddingContact)}
                          onClick={async () => {
                            setMemberProfileModal((prev) => (prev ? { ...prev, isAddingContact: true, actionError: undefined, actionSuccess: undefined } : prev));
                            const res = await addTelegramUserContactApi({
                              accountId: currentAccountId,
                              chatId: memberProfileModal.targetChatId,
                              name: memberProfileModal.name,
                              phone: info.phone,
                              username: formattedUsername,
                            });
                            setMemberProfileModal((prev) => {
                              if (!prev) return prev;
                              if (!res.ok) return { ...prev, isAddingContact: false, actionError: res.error || '添加到通讯录失败' };
                              return {
                                ...prev,
                                isAddingContact: false,
                                actionSuccess: '已添加到通讯录',
                                info: prev.info ? { ...prev.info, isContact: true } : prev.info,
                              };
                            });
                            if (res.ok && res.contact) {
                              onAddContact?.(res.contact);
                            }
                          }}
                          className="py-2 px-3 rounded-xl bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#192c44] aurora:bg-[#13252e] aurora:hover:bg-[#19333e] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          <UserPlus className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                          <span>{memberProfileModal.isAddingContact ? '添加中' : '加好友'}</span>
                        </button>
                      )}

                      {!isSelfMember && !isChannelOrGroupIdentity && info && (
                        <button
                          type="button"
                          disabled={Boolean(memberProfileModal.isTogglingBlock)}
                          onClick={async () => {
                            const currentlyBlocked = Boolean(info.isBlocked);
                            setMemberProfileModal((prev) => (prev ? { ...prev, isTogglingBlock: true, actionError: undefined, actionSuccess: undefined } : prev));
                            const res = currentlyBlocked
                              ? await unblockTelegramUserContactApi({ accountId: currentAccountId, chatId: memberProfileModal.targetChatId })
                              : await blockTelegramUserContactApi({ accountId: currentAccountId, chatId: memberProfileModal.targetChatId });
                            const nextBlocked = !currentlyBlocked;
                            setMemberProfileModal((prev) => {
                              if (!prev) return prev;
                              if (!res.ok) return { ...prev, isTogglingBlock: false, actionError: res.error || (currentlyBlocked ? '解除拉黑失败' : '拉黑失败') };
                              return {
                                ...prev,
                                isTogglingBlock: false,
                                actionSuccess: nextBlocked ? '已拉黑该用户' : '已解除拉黑',
                                info: prev.info ? { ...prev.info, isBlocked: nextBlocked } : prev.info,
                              };
                            });
                            if (res.ok) {
                              onChatInfoUpdated?.(memberProfileModal.targetChatId, { isBlocked: nextBlocked });
                            }
                          }}
                          className={`py-2 px-3 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors ${
                            info.isBlocked
                              ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400'
                              : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {info.isBlocked ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                          <span>{memberProfileModal.isTogglingBlock ? '处理中' : info.isBlocked ? '解除拉黑' : '拉黑'}</span>
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Fullscreen Image & Video Lightbox Preview Modal */}
      {lightboxMedia &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-xs flex flex-col items-center justify-center p-4 sm:p-8 select-none animate-in fade-in duration-150"
            onClick={() => setLightboxMedia(null)}
          >
            {/* Top Bar Actions */}
            <div
              className="w-full max-w-6xl flex items-center justify-between gap-3 mb-3 text-white shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs text-white/80 truncate">
                {lightboxMedia.caption || (lightboxMedia.type === 'video' ? '视频全屏预览' : '图片全屏预览')}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lightboxMedia.type === 'image' && (
                  <button
                    type="button"
                    onClick={() => copyImageToClipboard(lightboxMedia.url, lightboxMedia.msgId)}
                    className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="复制照片到剪贴板"
                  >
                    {copiedId === lightboxMedia.msgId ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedId === lightboxMedia.msgId ? '已复制' : '复制'}</span>
                  </button>
                )}
                <a
                  href={lightboxMedia.url}
                  download={
                    lightboxMedia.type === 'video'
                      ? `tg_video_${Date.now()}.mp4`
                      : lightboxMedia.caption || `tg_photo_${Date.now()}.png`
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                  title="保存原文件"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>保存</span>
                </a>
                <button
                  type="button"
                  onClick={() => setLightboxMedia(null)}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/25 cursor-pointer transition-colors"
                  title="关闭 (Esc)"
                  aria-label="关闭全屏预览"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Main Centered Media Stage */}
            <div
              className="flex-1 w-full flex items-center justify-center min-h-0"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setLightboxMedia(null);
                } else {
                  e.stopPropagation();
                }
              }}
            >
              {lightboxMedia.type === 'image' ? (
                <img
                  src={lightboxMedia.url}
                  alt={lightboxMedia.caption || 'fullscreen image'}
                  onClick={() => setLightboxMedia(null)}
                  onError={() => {
                    if (lightboxMedia.rawUrl) {
                      void triggerSilentUrlRefresh(lightboxMedia.rawUrl, true);
                    }
                  }}
                  className="max-w-[95vw] max-h-[85vh] w-auto h-auto object-contain rounded-lg shadow-2xl cursor-zoom-out"
                />
              ) : (
                <video
                  src={lightboxMedia.url}
                  controls
                  autoPlay
                  onError={() => {
                    if (lightboxMedia.rawUrl) {
                      void triggerSilentUrlRefresh(lightboxMedia.rawUrl, true);
                    }
                  }}
                  className="max-w-[95vw] max-h-[85vh] w-auto h-auto object-contain rounded-lg shadow-2xl bg-black"
                />
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

