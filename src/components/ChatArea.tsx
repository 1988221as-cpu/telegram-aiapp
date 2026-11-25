import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
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
  MoreHorizontal,
  Paperclip,
  Search,
  Play,
  Pause,
  RotateCw,
  Settings,
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
  ChevronLeft,
  ChevronRight,
  Users,
  Megaphone,
  ExternalLink,
  Clock,
  Maximize2,
  UserPlus,
  UserMinus,
  MessageCircle,
  ShieldCheck,
  Phone,
  AtSign,
  Loader2,
  Eye,
} from 'lucide-react';
import { Chat, Message, TranslationSettings, MasterVoiceprint, TelegramStickerItem, TelegramContact, TelegramChatFullInfo, TelegramMessageReadParticipant } from '../types';
import { ChatMessageItem, type ChatMessageItemActions } from './ChatMessageItem';
import { VoiceCloneStudioModal } from './VoiceCloneStudioModal';
import { MasterVoiceprintModal } from './MasterVoiceprintModal';
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
  fetchTelegramSharedMediaApi,
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
  getCachedResolvedAvatarUrl,
  isAvatarAlreadyLoaded,
  markAvatarLoaded,
  clearLoadedAvatarCache,
  isAvatarKnownNoPhoto,
  markAvatarKnownNoPhoto,
  saveLocalMessage,
  updateMessageSttInDb,
  previewTelegramInviteApi,
  joinTelegramInviteApi,
  generateTTSVoice,
  fetchTelegramChatFullInfoApi,
  fetchTelegramMessageReadParticipantsApi,
  addTelegramUserContactApi,
  blockTelegramUserContactApi,
  unblockTelegramUserContactApi,
  type VoiceCloneRequestOptions,
} from '../services/apiService';
import { sanitizeSafeResourceUrl } from '../services/urlSafety';

const AI_SUGGESTION_COOLDOWN_MS = 120_000;
const AI_SUGGESTION_COOLDOWN_STORAGE_KEY = 'tg_ai_suggestion_cooldown_until';
const CHAT_FONT_SCALE_STORAGE_KEY = 'tg_pro_chat_font_scale';
const CHAT_FONT_SCALE_STEPS = [0.85, 0.9, 1, 1.1, 1.2, 1.35, 1.5] as const;
type ChatFontScale = (typeof CHAT_FONT_SCALE_STEPS)[number];

const CHAT_FONT_SIZE_CLASSES: Record<
  ChatFontScale,
  {
    composer: string;
    body: string;
    secondary: string;
    translation: string;
    replySender: string;
    replyBody: string;
  }
> = {
  0.85: {
    composer: 'text-[11.5px]',
    body: 'text-[11px]',
    secondary: 'text-[10px]',
    translation: 'text-[10px]',
    replySender: 'text-[9.5px]',
    replyBody: 'text-[9px]',
  },
  0.9: {
    composer: 'text-[12px]',
    body: 'text-[11.5px]',
    secondary: 'text-[11px]',
    translation: 'text-[10.5px]',
    replySender: 'text-[10px]',
    replyBody: 'text-[9.5px]',
  },
  1: {
    composer: 'text-[13.5px]',
    body: 'text-[13px]',
    secondary: 'text-xs',
    translation: 'text-[11.5px]',
    replySender: 'text-[11px]',
    replyBody: 'text-[10.5px]',
  },
  1.1: {
    composer: 'text-[15px]',
    body: 'text-[14.5px]',
    secondary: 'text-[13px]',
    translation: 'text-[12.5px]',
    replySender: 'text-xs',
    replyBody: 'text-[11.5px]',
  },
  1.2: {
    composer: 'text-[16px]',
    body: 'text-[15.5px]',
    secondary: 'text-[14.5px]',
    translation: 'text-[14px]',
    replySender: 'text-[13px]',
    replyBody: 'text-[12.5px]',
  },
  1.35: {
    composer: 'text-[18px]',
    body: 'text-[17.5px]',
    secondary: 'text-[16px]',
    translation: 'text-[15.5px]',
    replySender: 'text-[15px]',
    replyBody: 'text-[14px]',
  },
  1.5: {
    composer: 'text-[20px]',
    body: 'text-[19.5px]',
    secondary: 'text-[18px]',
    translation: 'text-[17px]',
    replySender: 'text-[16.5px]',
    replyBody: 'text-[16px]',
  },
};

function readStoredChatFontScale(): ChatFontScale {
  try {
    const raw = Number(localStorage.getItem(CHAT_FONT_SCALE_STORAGE_KEY));
    if (CHAT_FONT_SCALE_STEPS.includes(raw as ChatFontScale)) {
      return raw as ChatFontScale;
    }
  } catch {}
  return 1;
}

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

function buildSafeMediaDownloadName(caption: string | undefined, fallbackPrefix: string, fallbackExt: string): string {
  const cleaned = (caption || '')
    .replace(/[\r\n/\\:*?"<>|]+/g, '_')
    .trim()
    .slice(0, 64);
  if (!cleaned) {
    return `${fallbackPrefix}_${Date.now()}.${fallbackExt}`;
  }
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.${fallbackExt}`;
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
  onLoadOlderMessages?: (chatId: string, offsetId: number) => Promise<{ ok: boolean; count: number; hasMore: boolean; nextOffsetId?: number; error?: string }>;
  onMessagesSynced?: (synced: Message[], meta?: { hasMore?: boolean; readOutboxMaxId?: number; fromLocalFallback?: boolean; chatId?: string; accountId?: string }) => void;
  onOpenKnowledgeEvolution?: () => void;
  onOpenVoiceprintConfig?: () => void;
  onOpenCustomerMemory?: () => void;
  isCustomerMemoryOpen?: boolean;
  onDeleteMessage?: (messageId: string, options?: { revoke?: boolean }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onBatchDeleteMessages?: (messageIds: string[], options?: { revoke?: boolean }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onForwardMessages?: (payload: { messageIds: string[]; telegramMessageIds: number[]; toChatId: string; dropAuthor?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  onEditMessage?: (messageId: string, newText: string, options?: { translatedText?: string }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onUpdateMessage?: (messageId: string, patch: Partial<Message>, scope?: { chatId?: string; accountId?: string }) => void;
  onRetranslateMessage?: (messageId: string, fallbackMessage?: Message) => void | Promise<any>;
  onRetryMessage?: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  onResumePausedMessage?: (messageId: string) => void | Promise<void>;
  onDiscardPausedMessage?: (messageId: string) => void | Promise<void>;
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
  onSelectChat?: (chatId: string) => void;
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

const LEGACY_PLACEHOLDER_SENDER_NAMES = new Set(['客户', '对方', '我方', 'Telegram 联系人']);

function computeAnchoredPopupPos(
  anchorEl: HTMLElement | null,
  options: { width: number; maxHeight: number; preferAbove?: boolean; gap?: number; alignRight?: boolean }
): { top: number; left: number; maxHeight: number } | null {
  if (!anchorEl || typeof window === 'undefined') return null;
  const rect = anchorEl.getBoundingClientRect();
  const margin = 12;
  const gap = options.gap ?? 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(options.width, vw - margin * 2);
  const desiredLeft = options.alignRight ? rect.right - width : rect.left;
  const left = Math.max(margin, Math.min(desiredLeft, vw - width - margin));
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

const chatDraftTextCache = new Map<string, string>();

const ChatAreaActive: React.FC<ChatAreaProps & { chat: Chat }> = ({
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
  onOpenVoiceprintConfig,
  onOpenCustomerMemory,
  isCustomerMemoryOpen = false,
  onDeleteMessage,
  onBatchDeleteMessages,
  onForwardMessages,
  onEditMessage,
  onUpdateMessage,
  onRetranslateMessage,
  onRetryMessage,
  onResumePausedMessage,
  onDiscardPausedMessage,
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
  onSelectChat,
  onCloseChat,
  onOpenCustomLLM,
  activeRightPanel,
  isChatInfoOpenExternal,
  onChatInfoOpenChange,
  sendWithEnter = true,
  onRefreshMediaUrls,
}) => {
  const draftScopeKey = `${currentAccountId || 'default'}::${chat.id}`;
  const [inputText, setInputText] = useState(() => chatDraftTextCache.get(draftScopeKey) || '');
  const DEFAULT_MSG_WINDOW = 200;
  const MAX_ACTIVE_MSG_WINDOW = 360;
  const WINDOW_STEP = 150;
  const [msgWindowState, setMsgWindowState] = useState<{ count: number; tailHidden: number }>({
    count: DEFAULT_MSG_WINDOW,
    tailHidden: 0,
  });
  useEffect(() => {
    pendingWindowAnchorRef.current = null;
    setMsgWindowState({ count: DEFAULT_MSG_WINDOW, tailHidden: 0 });
  }, [chat?.id, currentAccountId]);
  const activeChatIdRef = useRef<string | null>(chat?.id || null);
  activeChatIdRef.current = chat?.id || null;
  const activeAccountIdRef = useRef<string | undefined>(currentAccountId);
  activeAccountIdRef.current = currentAccountId;
  const isSameOriginScope = (originChatId: string, originAccountId?: string) =>
    activeChatIdRef.current === originChatId && activeAccountIdRef.current === originAccountId;

  const [chatFontScale, setChatFontScale] = useState<ChatFontScale>(() => readStoredChatFontScale());
  const chatFontClasses = CHAT_FONT_SIZE_CLASSES[chatFontScale];
  const chatFontScaleIndex = CHAT_FONT_SCALE_STEPS.indexOf(chatFontScale);
  const stepChatFontScale = useCallback((delta: -1 | 1) => {
    setChatFontScale((prev) => {
      const idx = CHAT_FONT_SCALE_STEPS.indexOf(prev);
      const nextIdx = Math.max(0, Math.min(CHAT_FONT_SCALE_STEPS.length - 1, idx + delta));
      const next = CHAT_FONT_SCALE_STEPS[nextIdx];
      try {
        localStorage.setItem(CHAT_FONT_SCALE_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);
  const resetChatFontScale = useCallback(() => {
    setChatFontScale(1);
    try {
      localStorage.setItem(CHAT_FONT_SCALE_STORAGE_KEY, '1');
    } catch {}
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!inputText) {
      el.style.height = 'auto';
      el.style.overflowY = 'hidden';
      return;
    }
    const rafId = requestAnimationFrame(() => {
      const currentEl = textareaRef.current;
      if (!currentEl) return;
      currentEl.style.height = 'auto';
      const maxHeight = 144;
      const nextHeight = Math.min(currentEl.scrollHeight, maxHeight);
      currentEl.style.height = `${nextHeight}px`;
      currentEl.style.overflowY = currentEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
    });
    return () => cancelAnimationFrame(rafId);
  }, [inputText, chat?.id, chatFontScale]);
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
  const [isHeaderMoreMenuOpen, setIsHeaderMoreMenuOpen] = useState(false);
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
  const [mediaRetryNonces, setMediaRetryNonces] = useState<Record<string, number>>({});
  const mediaRetryStateRef = useRef<Record<string, { attempts: number; pending: boolean; timer?: ReturnType<typeof setTimeout> }>>({});
  const [isVoiceStudioOpen, setIsVoiceStudioOpen] = useState(false);
  const [isVoiceprintModalOpen, setIsVoiceprintModalOpen] = useState(false);
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
  // [用户锁定规则 - 禁止AI改回悬停弹出]
  // hoveredMessageId 仅用于控制消息上方浮动快捷操作栏（👍❤️🔥🎉 / 回复 / 转发 / 翻译 / 置顶 / 复制 / 删除）的显隐。
  // 必须严格保持：鼠标悬停（onMouseEnter / onMouseLeave / group-hover）绝对不触发显示；
  // 仅允许在同一条消息上【连续右键按两次】时才触发弹出。
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const lastRightClickRef = useRef<{ msgId: string; ts: number } | null>(null);
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
  const [showClearGroupNoticesModal, setShowClearGroupNoticesModal] = useState(false);
  const [isClearingGroupNotices, setIsClearingGroupNotices] = useState(false);

  const isGroupNoticeMsg = useCallback((m: Message): boolean => {
    return (
      m.sender === 'system' &&
      (m.systemEventType === 'join' ||
        m.systemEventType === 'leave' ||
        /加入了群组|退出了群组|移出了群组/.test(m.text || ''))
    );
  }, []);
  const groupNoticeMessages = React.useMemo(
    () => messages.filter(isGroupNoticeMsg),
    [messages, isGroupNoticeMsg]
  );
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
  const [olderCursorOffsetId, setOlderCursorOffsetId] = useState<number | null>(null);
  const [loadedHeaderAvatarSrc, setLoadedHeaderAvatarSrc] = useState<string>('');
  const [failedHeaderAvatarSrc, setFailedHeaderAvatarSrc] = useState<string>('');
  const sharedPhotoGalleryCacheRef = useRef<Record<string, Message[]>>({});
  const activeChatScopeKeyRef = useRef<string>('');
  activeChatScopeKeyRef.current = `${currentAccountId || 'default'}::${chat?.id || ''}`;
  const pendingJumpTargetRef = useRef<{
    scopeKey: string;
    msgId: string;
    telegramMessageId?: number;
  } | null>(null);
  type LightboxGalleryItem = {
    type: 'image' | 'video';
    url: string;
    rawUrl?: string;
    caption?: string;
    msgId: string;
    message?: Message;
  };
  const [lightboxMedia, setLightboxMedia] = useState<{
    type: 'image' | 'video';
    url: string;
    rawUrl?: string;
    caption?: string;
    msgId: string;
    message?: Message;
    gallery?: LightboxGalleryItem[];
    galleryIndex?: number;
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

  const [readReceiptsModal, setReadReceiptsModal] = useState<{
    message: Message;
    loading: boolean;
    participants: TelegramMessageReadParticipant[];
    hint?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    setOlderCursorOffsetId(null);
    setLightboxMedia(null);
    setMemberProfileModal(null);
    setReadReceiptsModal(null);
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
                  ? 'text-[#bae6fd] dark:text-[#bfdbfe] aurora:text-[#a5f3fc] linen:text-[#fde68a]'
                  : 'text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4] linen:text-[#8c522d]'
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
                    ? 'text-[#bae6fd] dark:text-[#bfdbfe] aurora:text-[#a5f3fc] linen:text-[#fde68a]'
                    : 'text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4] linen:text-[#8c522d]'
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

  const handleOpenReadReceipts = useCallback(async (msg: Message) => {
    if (!chat || !chat.id.startsWith('tg_') || !chat.isGroup || chat.isChannel || msg.sender !== 'me') return;
    if (typeof msg.telegramMessageId !== 'number') return;
    setReadReceiptsModal({
      message: msg,
      loading: true,
      participants: [],
    });
    const res = await fetchTelegramMessageReadParticipantsApi({
      accountId: currentAccountId,
      chatId: chat.id,
      messageId: msg.id,
      telegramMessageId: msg.telegramMessageId,
    });
    setReadReceiptsModal((prev) => {
      if (!prev || prev.message.id !== msg.id) return prev;
      if (!res.ok) {
        return { ...prev, loading: false, error: res.error || '无法加载已读成员列表' };
      }
      return {
        ...prev,
        loading: false,
        participants: Array.isArray(res.participants) ? res.participants : [],
        hint: res.hint,
      };
    });
  }, [chat, currentAccountId]);

  // [用户锁定规则 - 右按两次才弹出浮动快捷操作栏]
  // 第1次右键：打开常规纵向右键菜单，并关闭浮动快捷操作栏；
  // 550ms 内在同一条消息上第2次右键：关闭纵向右键菜单，弹出消息上方浮动快捷操作栏（hoveredMessageId）。
  // 禁止改为单次悬停（onMouseEnter）或单次左键/鼠标经过触发。
  const handleMessageContextMenu = (e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const prev = lastRightClickRef.current;
    if (prev && prev.msgId === msg.id && now - prev.ts <= 550) {
      lastRightClickRef.current = null;
      setMessageContextMenu(null);
      setHoveredMessageId(msg.id);
      return;
    }
    lastRightClickRef.current = { msgId: msg.id, ts: now };
    setHoveredMessageId(null);

    const menuWidth = 190;
    const menuHeight = 352;
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

  useEffect(() => {
    if (!hoveredMessageId) return;
    const handleCloseQuickBar = () => {
      setHoveredMessageId(null);
    };
    window.addEventListener('click', handleCloseQuickBar);
    window.addEventListener('scroll', handleCloseQuickBar, true);
    return () => {
      window.removeEventListener('click', handleCloseQuickBar);
      window.removeEventListener('scroll', handleCloseQuickBar, true);
    };
  }, [hoveredMessageId]);

  const confirmDeleteMessage = async () => {
    if (messageToDelete) {
      const targetMsg = messageToDelete;
      const isLocalOnly =
        !resolveClientTelegramMessageId(targetMsg) ||
        targetMsg.deliveryStatus === 'failed' ||
        targetMsg.deliveryStatus === 'pending' ||
        targetMsg.deliveryStatus === 'paused';
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
      const nonSystemMsgs = forwardModalMessages.filter((m) => m.sender !== 'system');
      if (nonSystemMsgs.length === 0) {
        showSyncNotice('入/退群等系统提示消息不支持转发');
        return;
      }
      const forwardableMsgs = isCloudForward
        ? nonSystemMsgs.filter((m) => resolveClientTelegramMessageId(m) !== undefined)
        : nonSystemMsgs;
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
          ? `已转发 ${forwardableMsgs.length} 条云端消息至「${targetChat?.title || '目标对话'}」（已跳过 ${skippedCount} 条不支持转发或未送达消息）`
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

  const handleConfirmClearGroupNotices = async () => {
    if (groupNoticeMessages.length === 0 || isClearingGroupNotices || !onBatchDeleteMessages) return;
    setIsClearingGroupNotices(true);
    try {
      const ids = groupNoticeMessages.map((m) => m.id);
      const res = await onBatchDeleteMessages(ids, { revoke: revokeBatchDelete });
      if (res && typeof res === 'object' && res.ok === false) {
        showSyncNotice(`清理群提示失败：${res.error || '请检查群组管理员删除权限或网络'}`);
        return;
      }
      const deletedIdSet = new Set(ids);
      const deletedTgIdSet = new Set(
        groupNoticeMessages
          .map((m) => resolveClientTelegramMessageId(m))
          .filter((id): id is number => typeof id === 'number' && id > 0)
      );
      setCloudSearchResults((prev) =>
        prev
          ? prev.filter(
              (m) =>
                !deletedIdSet.has(m.id) &&
                !(resolveClientTelegramMessageId(m) !== undefined && deletedTgIdSet.has(resolveClientTelegramMessageId(m)!))
            )
          : null
      );
      setShowClearGroupNoticesModal(false);
      showSyncNotice(`已清理 ${ids.length} 条入/退群提示`, 2500);
    } finally {
      setIsClearingGroupNotices(false);
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
  const headerMoreButtonRef = useRef<HTMLButtonElement>(null);
  const headerMoreMenuRef = useRef<HTMLDivElement>(null);
  const [headerMoreMenuPos, setHeaderMoreMenuPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const [attachmentMenuPos, setAttachmentMenuPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const pendingWindowAnchorRef = useRef<{
    msgId?: string;
    offsetTop: number;
    prevHeight: number;
    prevTop: number;
  } | null>(null);
  const pendingOlderAnchorRef = useRef<{
    scopeKey: string;
    msgId?: string;
    offsetTop: number;
    prevHeight: number;
    prevTop: number;
    appliedTailShift?: boolean;
  } | null>(null);
  const suppressAutoScrollRef = useRef(false);
  const loadOlderCooldownUntilRef = useRef<number>(0);
  const isNearBottomRef = useRef(true);
  const prevChatIdForScrollRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);
  const prevLastMsgIdRef = useRef<string | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [unreadWhileScrolledCount, setUnreadWhileScrolledCount] = useState(0);
  const backdropPointerDownTargetRef = useRef<EventTarget | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const lastCommittedDraftScopeRef = useRef<string>(draftScopeKey);

  useLayoutEffect(() => {
    if (lastCommittedDraftScopeRef.current !== draftScopeKey) {
      lastCommittedDraftScopeRef.current = draftScopeKey;
      setInputText(chatDraftTextCache.get(draftScopeKey) || '');
      return;
    }
    if (!editingMessage) {
      if (inputText) {
        chatDraftTextCache.set(draftScopeKey, inputText);
      } else {
        chatDraftTextCache.delete(draftScopeKey);
      }
    }
  }, [draftScopeKey, inputText, editingMessage]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  const captureViewportAnchor = useCallback((): {
    msgId?: string;
    offsetTop: number;
    prevHeight: number;
    prevTop: number;
  } | null => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return null;
    const msgEls = viewport.querySelectorAll<HTMLElement>('[data-msg-id]');
    let anchorMsgId: string | undefined;
    let offsetTop = 0;
    const vpRect = viewport.getBoundingClientRect();
    for (let i = 0; i < msgEls.length; i++) {
      const el = msgEls[i];
      const r = el.getBoundingClientRect();
      if (r.bottom >= vpRect.top + 8) {
        anchorMsgId = el.dataset.msgId;
        offsetTop = r.top - vpRect.top;
        break;
      }
    }
    return {
      msgId: anchorMsgId,
      offsetTop,
      prevHeight: viewport.scrollHeight,
      prevTop: viewport.scrollTop,
    };
  }, []);

  const expandLocalMessageWindow = useCallback(
    (step = WINDOW_STEP) => {
      if (!pendingWindowAnchorRef.current) {
        const anchor = captureViewportAnchor();
        if (anchor) {
          pendingWindowAnchorRef.current = anchor;
          suppressAutoScrollRef.current = true;
        }
      }
      setMsgWindowState((prev) => {
        if (prev.count < MAX_ACTIVE_MSG_WINDOW) {
          return {
            count: Math.min(MAX_ACTIVE_MSG_WINDOW, prev.count + step),
            tailHidden: prev.tailHidden,
          };
        }
        return {
          count: MAX_ACTIVE_MSG_WINDOW,
          tailHidden: prev.tailHidden + step,
        };
      });
    },
    [captureViewportAnchor]
  );

  const shiftWindowDown = useCallback(
    (step = WINDOW_STEP) => {
      if (!pendingWindowAnchorRef.current) {
        const anchor = captureViewportAnchor();
        if (anchor) {
          pendingWindowAnchorRef.current = anchor;
          suppressAutoScrollRef.current = true;
        }
      }
      setMsgWindowState((prev) => {
        if (prev.tailHidden <= 0) return prev;
        return {
          count: prev.count,
          tailHidden: Math.max(0, prev.tailHidden - step),
        };
      });
    },
    [captureViewportAnchor]
  );

  useLayoutEffect(() => {
    const anchor = pendingWindowAnchorRef.current;
    if (!anchor) return;
    pendingWindowAnchorRef.current = null;
    const viewport = scrollViewportRef.current;
    if (viewport) {
      const anchoredEl = anchor.msgId
        ? (viewport.querySelector(`[data-msg-id="${CSS.escape(anchor.msgId)}"]`) as HTMLElement | null)
        : null;
      if (anchoredEl) {
        const vpRect = viewport.getBoundingClientRect();
        const elRect = anchoredEl.getBoundingClientRect();
        viewport.scrollTop = Math.max(0, viewport.scrollTop + (elRect.top - vpRect.top - anchor.offsetTop));
      } else {
        viewport.scrollTop = Math.max(0, viewport.scrollHeight - anchor.prevHeight + anchor.prevTop);
      }
    }
    requestAnimationFrame(() => {
      suppressAutoScrollRef.current = false;
    });
  }, [msgWindowState]);

  useLayoutEffect(() => {
    const anchor = pendingOlderAnchorRef.current;
    if (!anchor) return;
    const scopeKey = `${currentAccountId || 'default'}::${chat.id}`;
    if (anchor.scopeKey !== scopeKey) {
      pendingOlderAnchorRef.current = null;
      suppressAutoScrollRef.current = false;
      return;
    }
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const anchoredEl = anchor.msgId
      ? (viewport.querySelector(`[data-msg-id="${CSS.escape(anchor.msgId)}"]`) as HTMLElement | null)
      : null;
    if (anchoredEl) {
      const vpRect = viewport.getBoundingClientRect();
      const elRect = anchoredEl.getBoundingClientRect();
      const delta = elRect.top - vpRect.top - anchor.offsetTop;
      if (Math.abs(delta) > 0.5 || anchor.appliedTailShift) {
        pendingOlderAnchorRef.current = null;
        viewport.scrollTop = Math.max(0, viewport.scrollTop + delta);
        const rafId = requestAnimationFrame(() => {
          suppressAutoScrollRef.current = false;
        });
        return () => cancelAnimationFrame(rafId);
      }
    }
    if (viewport.scrollHeight === anchor.prevHeight) {
      const safetyRaf = requestAnimationFrame(() => {
        if (pendingOlderAnchorRef.current === anchor) {
          pendingOlderAnchorRef.current = null;
          suppressAutoScrollRef.current = false;
        }
      });
      return () => cancelAnimationFrame(safetyRaf);
    }
    pendingOlderAnchorRef.current = null;
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - anchor.prevHeight + anchor.prevTop);
    const rafId = requestAnimationFrame(() => {
      suppressAutoScrollRef.current = false;
    });
    return () => cancelAnimationFrame(rafId);
  }, [messages, msgWindowState, chat.id, currentAccountId]);
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
      const states = mediaRetryStateRef.current;
      for (const k of Object.keys(states)) {
        if (states[k]?.timer) clearTimeout(states[k].timer);
      }
      mediaRetryStateRef.current = {};
      setMediaRetryNonces({});
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

  const appendThumbQueryIfTelegramMedia = useCallback((rawUrl?: string) => {
    if (!rawUrl) return undefined;
    if (rawUrl.includes('/api/telegram/user/media/') && !/[?&]thumb=/.test(rawUrl)) {
      return `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}thumb=1`;
    }
    return rawUrl;
  }, []);

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

  const handleTelegramBubbleImageError = useCallback(
    async (msgId: string, rawImageUrl?: string, loadedSrc?: string) => {
      const probeUrl = loadedSrc || resolveDisplayUrl(rawImageUrl);
      if (!probeUrl) return;
      const isTgMedia = probeUrl.includes('/api/telegram/user/media/');
      const prevState = mediaRetryStateRef.current[msgId] || { attempts: 0, pending: false };
      if (prevState.pending) return;

      if (isTgMedia && prevState.attempts < 3) {
        prevState.pending = true;
        mediaRetryStateRef.current[msgId] = prevState;
        try {
          const resp = await fetchWithTimeout(
            probeUrl,
            {
              method: 'HEAD',
              credentials: 'same-origin',
            },
            6000
          );
          if (resp.status === 503 || resp.status === 429) {
            const retryAfterRaw = resp.headers.get('Retry-After');
            const retryAfterSec = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : NaN;
            const baseMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 1500;
            const delayMs = Math.min(10000, Math.round(baseMs * Math.pow(1.6, prevState.attempts)));
            prevState.timer = setTimeout(() => {
              const st = mediaRetryStateRef.current[msgId];
              if (!st) return;
              st.pending = false;
              st.attempts += 1;
              st.timer = undefined;
              setMediaRetryNonces((prev) => ({
                ...prev,
                [msgId]: (prev[msgId] || 0) + 1,
              }));
            }, delayMs);
            return;
          }
          if (resp.ok) {
            prevState.timer = setTimeout(() => {
              const st = mediaRetryStateRef.current[msgId];
              if (!st) return;
              st.pending = false;
              st.attempts += 1;
              st.timer = undefined;
              setMediaRetryNonces((prev) => ({
                ...prev,
                [msgId]: (prev[msgId] || 0) + 1,
              }));
            }, 250);
            return;
          }
        } catch {
          const delayMs = Math.min(8000, Math.round(1200 * Math.pow(1.8, prevState.attempts)));
          prevState.timer = setTimeout(() => {
            const st = mediaRetryStateRef.current[msgId];
            if (!st) return;
            st.pending = false;
            st.attempts += 1;
            st.timer = undefined;
            setMediaRetryNonces((prev) => ({
              ...prev,
              [msgId]: (prev[msgId] || 0) + 1,
            }));
          }, delayMs);
          return;
        }
        prevState.pending = false;
      }

      if (rawImageUrl) {
        void triggerSilentUrlRefresh(rawImageUrl, true);
      }
    },
    [resolveDisplayUrl, triggerSilentUrlRefresh]
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

  const openImageGalleryLightbox = useCallback(
    (targetMsg: Message, seedList?: Message[]) => {
      const targetUrl = targetMsg.imageUrl ? resolveDisplayUrl(targetMsg.imageUrl) : undefined;
      if (!targetUrl) return;
      const cacheKey = `${currentAccountId || 'default'}::${chat?.id || ''}`;
      const cachedCloud = sharedPhotoGalleryCacheRef.current[cacheKey] || [];
      const buildGalleryItems = (sourceLists: Message[][]) => {
        const dedup = new Map<string, Message>();
        for (const list of sourceLists) {
          for (const item of list) {
            if (
              !item ||
              !item.imageUrl ||
              (item.isVideo && !item.isImage) ||
              isMessageDeleted(item.id, currentAccountId, item.chatId || chat?.id)
            ) {
              continue;
            }
            const key =
              typeof item.telegramMessageId === 'number' && item.telegramMessageId > 0
                ? `tg_${item.telegramMessageId}`
                : item.id;
            if (!dedup.has(key)) dedup.set(key, item);
          }
        }
        const sorted = Array.from(dedup.values()).sort((a, b) => {
          if (
            typeof a.telegramMessageId === 'number' &&
            a.telegramMessageId > 0 &&
            typeof b.telegramMessageId === 'number' &&
            b.telegramMessageId > 0
          ) {
            return a.telegramMessageId - b.telegramMessageId;
          }
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
        return sorted
          .map((m) => {
            const safeUrl = m.imageUrl ? resolveDisplayUrl(m.imageUrl) : undefined;
            if (!safeUrl) return null;
            return {
              type: 'image' as const,
              url: safeUrl,
              rawUrl: m.imageUrl,
              caption: m.text?.trim() && !isSystemMediaPlaceholder(m.text, m) ? m.text : m.imageCaption,
              msgId: m.id,
              message: m,
            };
          })
          .filter(Boolean) as LightboxGalleryItem[];
      };

      const initialGallery = buildGalleryItems([seedList || [], cachedCloud, messages, [targetMsg]]);
      const initialIndex = Math.max(
        0,
        initialGallery.findIndex(
          (g) =>
            g.msgId === targetMsg.id ||
            (typeof targetMsg.telegramMessageId === 'number' &&
              g.message?.telegramMessageId === targetMsg.telegramMessageId)
        )
      );
      const currentItem = initialGallery[initialIndex];
      setLightboxMedia({
        type: 'image',
        url: currentItem?.url || targetUrl,
        rawUrl: currentItem?.rawUrl || targetMsg.imageUrl,
        caption: currentItem?.caption || targetMsg.imageCaption,
        msgId: currentItem?.msgId || targetMsg.id,
        message: currentItem?.message || targetMsg,
        gallery: initialGallery,
        galleryIndex: initialIndex,
      });

      if (
        chat?.id?.startsWith('tg_') &&
        currentAccountId !== 'acc_telegram_bot' &&
        !(cacheKey in sharedPhotoGalleryCacheRef.current)
      ) {
        const targetChatId = chat.id;
        const targetAccountId = currentAccountId;
        const targetScopeKey = cacheKey;
        void (async () => {
          const collected: Message[] = [];
          let nextOff: number | undefined = undefined;
          for (let page = 0; page < 4; page += 1) {
            if (activeChatScopeKeyRef.current !== targetScopeKey) return;
            const res = await fetchTelegramSharedMediaApi(targetChatId, targetAccountId, {
              type: 'media',
              limit: 80,
              offsetId: nextOff,
            });
            if (!res.ok || res.items.length === 0) break;
            collected.push(...res.items);
            if (!res.hasMore || !res.nextOffsetId || (nextOff !== undefined && res.nextOffsetId >= nextOff)) break;
            nextOff = res.nextOffsetId;
          }
          if (activeChatScopeKeyRef.current !== targetScopeKey) return;
          sharedPhotoGalleryCacheRef.current[targetScopeKey] = collected;
          if (collected.length === 0) return;
          setLightboxMedia((cur) => {
            if (!cur || cur.type !== 'image' || activeChatScopeKeyRef.current !== targetScopeKey) {
              return cur;
            }
            const expandedGallery = buildGalleryItems([
              seedList || [],
              collected,
              messages,
              cur.message ? [cur.message] : [],
            ]);
            if (expandedGallery.length <= 1) return cur;
            const nextIdx = Math.max(
              0,
              expandedGallery.findIndex(
                (g) =>
                  g.msgId === cur.msgId ||
                  (typeof cur.message?.telegramMessageId === 'number' &&
                    g.message?.telegramMessageId === cur.message.telegramMessageId)
              )
            );
            return {
              ...cur,
              gallery: expandedGallery,
              galleryIndex: nextIdx,
            };
          });
        })();
      }
    },
    [chat?.id, currentAccountId, messages]
  );

  const navigateLightboxGallery = useCallback((delta: number) => {
    setLightboxMedia((cur) => {
      if (!cur || !cur.gallery || cur.gallery.length <= 1) return cur;
      const curIdx = typeof cur.galleryIndex === 'number' ? cur.galleryIndex : 0;
      const nextIdx = (curIdx + delta + cur.gallery.length) % cur.gallery.length;
      const target = cur.gallery[nextIdx];
      if (!target) return cur;
      const refreshedUrl = (target.rawUrl ? resolveDisplayUrl(target.rawUrl) : undefined) || target.url;
      return {
        ...cur,
        type: target.type,
        url: refreshedUrl,
        rawUrl: target.rawUrl,
        caption: target.caption,
        msgId: target.msgId,
        message: target.message,
        galleryIndex: nextIdx,
      };
    });
  }, []);

  const handleLoadOlderClick = async (fromScroll = false) => {
    if (!chat?.id || !onLoadOlderMessages || isLoadingOlder) return;
    if (fromScroll && Date.now() < loadOlderCooldownUntilRef.current) return;
    const originScopeKey = `${currentAccountId || 'default'}::${chat.id}`;
    const anchorBefore = captureViewportAnchor();
    const viewport = scrollViewportRef.current;
    const prevHeight = anchorBefore?.prevHeight ?? viewport?.scrollHeight ?? 0;
    const prevTop = anchorBefore?.prevTop ?? viewport?.scrollTop ?? 0;
    suppressAutoScrollRef.current = true;
    setIsLoadingOlder(true);
    try {
      const tgIds = messages
        .map((m) => m.telegramMessageId)
        .filter((id): id is number => typeof id === 'number' && id > 0);
      const minLoadedTgId = tgIds.length > 0 ? Math.min(...tgIds) : 0;
      let cursor =
        olderCursorOffsetId && minLoadedTgId > 0
          ? Math.min(olderCursorOffsetId, minLoadedTgId)
          : olderCursorOffsetId || minLoadedTgId;

      let totalLoaded = 0;
      let lastRes: { ok: boolean; count: number; hasMore: boolean; nextOffsetId?: number; error?: string } = {
        ok: true,
        count: 0,
        hasMore: false,
      };
      // 若当前页全为不可见服务消息导致 count=0 且后端仍有更早消息，自动跳过空页最多连续翻 3 次
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const prevCursor = cursor;
        lastRes = await onLoadOlderMessages(chat.id, cursor);
        if (!lastRes.ok) break;
        if (lastRes.nextOffsetId) {
          if (prevCursor > 0 && lastRes.nextOffsetId >= prevCursor) {
            break;
          }
          setOlderCursorOffsetId(lastRes.nextOffsetId);
          cursor = lastRes.nextOffsetId;
        }
        totalLoaded += lastRes.count;
        if (lastRes.count > 0 || !lastRes.hasMore || !lastRes.nextOffsetId) {
          break;
        }
      }
      if (!lastRes.ok) {
        loadOlderCooldownUntilRef.current = Date.now() + 4000;
        showSyncNotice(`加载历史消息失败：${lastRes.error || '请检查网络连接'}`);
        return;
      }
      if (totalLoaded === 0 && !lastRes.hasMore) {
        showSyncNotice('已到达对话最早历史记录', 2500);
        return;
      }
      if (totalLoaded > 0 && activeChatScopeKeyRef.current === originScopeKey) {
        let appliedTailShift = false;
        setMsgWindowState((prev) => {
          if (prev.count < MAX_ACTIVE_MSG_WINDOW) {
            return {
              count: Math.min(MAX_ACTIVE_MSG_WINDOW, prev.count + totalLoaded),
              tailHidden: prev.tailHidden,
            };
          }
          appliedTailShift = true;
          return {
            count: MAX_ACTIVE_MSG_WINDOW,
            tailHidden: prev.tailHidden + totalLoaded,
          };
        });
        pendingOlderAnchorRef.current = {
          scopeKey: originScopeKey,
          msgId: anchorBefore?.msgId,
          offsetTop: anchorBefore?.offsetTop ?? 0,
          prevHeight,
          prevTop,
          appliedTailShift,
        };
      }
    } finally {
      setIsLoadingOlder(false);
      if (!pendingOlderAnchorRef.current) {
        suppressAutoScrollRef.current = false;
      }
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
        messages
          .filter((m) => m.sender !== 'system')
          .slice(-30)
          .map((m) => {
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
        if (res.cnTranslation && res.cnTranslation.trim().toLowerCase() !== res.replyText.trim().toLowerCase()) {
          setAiSuggestionTranslation(res.cnTranslation);
        } else if (refTargetNorm !== 'auto' && replyLangNorm !== refTargetNorm) {
          setIsTranslatingSuggestion(true);
          try {
            const refTrans = await translateText(
              res.replyText,
              'Auto',
              refTargetLang,
              customLLMConfig,
              'free_dual',
              translationSettings?.googleApiKey,
              undefined,
              undefined,
              undefined,
              { purpose: 'inbound' }
            );
            setAiSuggestionTranslation(
              refTrans && refTrans.trim().toLowerCase() !== res.replyText.trim().toLowerCase()
                ? refTrans
                : null
            );
          } catch {
            setAiSuggestionTranslation(null);
            showSyncNotice('我方语言对照获取失败，可在建议卡片点击重试', 4000);
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
        (!langMenuRef.current || !langMenuRef.current.contains(target)) &&
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
      setLangMenuPos(
        computeAnchoredPopupPos(langButtonRef.current, {
          width: 256,
          maxHeight: 320,
        })
      );
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
    if (!isHeaderMoreMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        (!headerMoreButtonRef.current || !headerMoreButtonRef.current.contains(target)) &&
        (!headerMoreMenuRef.current || !headerMoreMenuRef.current.contains(target))
      ) {
        setIsHeaderMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isHeaderMoreMenuOpen]);

  useLayoutEffect(() => {
    if (!isHeaderMoreMenuOpen) {
      setHeaderMoreMenuPos(null);
      return;
    }
    const updatePos = () => {
      setHeaderMoreMenuPos(
        computeAnchoredPopupPos(headerMoreButtonRef.current, {
          width: 196,
          maxHeight: 160,
          preferAbove: false,
          alignRight: true,
          gap: 6,
        })
      );
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isHeaderMoreMenuOpen]);

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
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const hasBlockingModal =
          Boolean(
            lightboxMedia ||
              memberProfileModal ||
              readReceiptsModal ||
              inviteModalState ||
              showBatchDeleteModal ||
              showClearGroupNoticesModal ||
              forwardModalMessages ||
              messageToDelete
          ) ||
          Boolean(document.querySelector('[role="dialog"], .z-50, .z-\\[70\\], .z-\\[9996\\]'));
        if (!hasBlockingModal) {
          if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
            e.preventDefault();
            stepChatFontScale(1);
            return;
          }
          if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
            e.preventDefault();
            stepChatFontScale(-1);
            return;
          }
          if (e.key === '0' || (!e.shiftKey && (e.code === 'Digit0' || e.code === 'Numpad0'))) {
            e.preventDefault();
            resetChatFontScale();
            return;
          }
        }
      }

      if (lightboxMedia && lightboxMedia.gallery && lightboxMedia.gallery.length > 1) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateLightboxGallery(-1);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateLightboxGallery(1);
          return;
        }
      }

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
        if (readReceiptsModal) {
          e.preventDefault();
          setReadReceiptsModal(null);
          return;
        }
        if (inviteModalState) {
          e.preventDefault();
          if (!inviteModalState.joining) setInviteModalState(null);
          return;
        }
        if (forwardModalMessages) {
          e.preventDefault();
          if (!isForwarding) setForwardModalMessages(null);
          return;
        }
        if (showBatchDeleteModal) {
          e.preventDefault();
          if (!isBatchDeleting) setShowBatchDeleteModal(false);
          return;
        }
        if (showClearGroupNoticesModal) {
          e.preventDefault();
          if (!isClearingGroupNotices) setShowClearGroupNoticesModal(false);
          return;
        }
        if (messageToDelete) {
          e.preventDefault();
          setMessageToDelete(null);
          return;
        }
        // If an external modal (z-50 / role="dialog" / previewChat) or docked right panel is open, let it handle Esc
        if (
          document.querySelector('[role="dialog"], .z-50, .z-\\[70\\], .z-\\[9996\\]') ||
          activeRightPanel
        ) {
          return;
        }

        // 1. Close in-chat overlays / temporary interactive states
        if (pastedImage) {
          e.preventDefault();
          clearPastedImage(true);
          return;
        }
        if (editingMessage) {
          e.preventDefault();
          setEditingMessage(null);
          setTranslateOnEdit(false);
          chatDraftTextCache.delete(draftScopeKey);
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
        if (isHeaderMoreMenuOpen) {
          e.preventDefault();
          setIsHeaderMoreMenuOpen(false);
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
        if (messageContextMenu) {
          e.preventDefault();
          setMessageContextMenu(null);
          return;
        }
        if (hoveredMessageId) {
          e.preventDefault();
          setHoveredMessageId(null);
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
    draftScopeKey,
    pastedImage,
    editingMessage,
    replyingTo,
    showEmojiPicker,
    isAttachmentMenuOpen,
    isHeaderMoreMenuOpen,
    isLangMenuOpen,
    isSearchingInChat,
    isChatInfoOpen,
    activeRightPanel,
    aiSuggestion,
    translatedPreview,
    messageContextMenu,
    hoveredMessageId,
    messageToDelete,
    showBatchDeleteModal,
    isBatchDeleting,
    showClearGroupNoticesModal,
    isClearingGroupNotices,
    forwardModalMessages,
    isForwarding,
    lightboxMedia,
    memberProfileModal,
    readReceiptsModal,
    inviteModalState,
    onCloseChat,
    stepChatFontScale,
    resetChatFontScale,
  ]);

  const focusWindowAroundIndex = useCallback((targetIdx: number, totalCount: number) => {
    if (totalCount <= DEFAULT_MSG_WINDOW) {
      setMsgWindowState({ count: DEFAULT_MSG_WINDOW, tailHidden: 0 });
      return;
    }
    const sliceEnd = Math.min(totalCount, Math.max(DEFAULT_MSG_WINDOW, targetIdx + 80));
    const sliceStart = Math.max(0, sliceEnd - MAX_ACTIVE_MSG_WINDOW);
    setMsgWindowState({
      count: Math.max(DEFAULT_MSG_WINDOW, sliceEnd - sliceStart),
      tailHidden: Math.max(0, totalCount - sliceEnd),
    });
  }, []);

  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'auto') => {
    setMsgWindowState((prev) =>
      prev.tailHidden === 0 && prev.count <= DEFAULT_MSG_WINDOW
        ? prev
        : { count: DEFAULT_MSG_WINDOW, tailHidden: 0 }
    );
    const viewport = scrollViewportRef.current;
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    setUnreadWhileScrolledCount(0);
    if (viewport) {
      if (behavior === 'smooth') {
        requestAnimationFrame(() => {
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleJumpToMessage = (targetMsg: Message) => {
    if (!targetMsg) return;
    const matchedIdx = messages.findIndex(
      (m) =>
        m.id === targetMsg.id ||
        (typeof targetMsg.telegramMessageId === 'number' &&
          m.telegramMessageId === targetMsg.telegramMessageId)
    );
    const matched = matchedIdx >= 0 ? messages[matchedIdx] : targetMsg;

    if (isSearchingInChat || chatSearchQuery || cloudSearchResults !== null) {
      setIsSearchingInChat(false);
      setChatSearchQuery('');
      setCloudSearchResults(null);
    }
    if (matchedIdx >= 0) {
      focusWindowAroundIndex(matchedIdx, messages.length);
    }

    const targetScopeKey = `${currentAccountId || 'default'}::${chat?.id || ''}`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const targetEl = scrollViewportRef.current?.querySelector(
          `[data-msg-id="${CSS.escape(matched.id)}"]`
        ) as HTMLElement | null;
        if (targetEl) {
          pendingJumpTargetRef.current = null;
          isNearBottomRef.current = false;
          suppressAutoScrollRef.current = true;
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setShowScrollToBottom(true);
          setHighlightedMsgId(matched.id);
          setTimeout(
            () => setHighlightedMsgId((cur) => (cur === matched.id ? null : cur)),
            2000
          );
          setTimeout(() => {
            suppressAutoScrollRef.current = false;
          }, 350);
        } else if (
          chat?.id?.startsWith('tg_') &&
          currentAccountId !== 'acc_telegram_bot' &&
          onLoadOlderMessages &&
          typeof targetMsg.telegramMessageId === 'number' &&
          targetMsg.telegramMessageId > 0 &&
          !isLoadingOlder
        ) {
          pendingJumpTargetRef.current = {
            scopeKey: targetScopeKey,
            msgId: matched.id,
            telegramMessageId: targetMsg.telegramMessageId,
          };
          void (async () => {
            suppressAutoScrollRef.current = true;
            setIsLoadingOlder(true);
            showSyncNotice('正在定位更早的历史消息...', 2500);
            try {
              const tgIds = messages
                .map((m) => m.telegramMessageId)
                .filter((id): id is number => typeof id === 'number' && id > 0);
              const minLoadedTgId = tgIds.length > 0 ? Math.min(...tgIds) : 0;
              let cursor =
                olderCursorOffsetId && minLoadedTgId > 0
                  ? Math.min(olderCursorOffsetId, minLoadedTgId)
                  : olderCursorOffsetId || minLoadedTgId;
              for (let page = 0; page < 6; page += 1) {
                if (
                  activeChatScopeKeyRef.current !== targetScopeKey ||
                  !pendingJumpTargetRef.current
                ) {
                  break;
                }
                const prevCursor = cursor;
                const res = await onLoadOlderMessages(chat.id, cursor);
                if (!res.ok) break;
                if (res.nextOffsetId) {
                  setOlderCursorOffsetId(res.nextOffsetId);
                  cursor = res.nextOffsetId;
                }
                if (
                  !res.hasMore ||
                  !res.nextOffsetId ||
                  (prevCursor > 0 && res.nextOffsetId >= prevCursor) ||
                  res.nextOffsetId <= targetMsg.telegramMessageId!
                ) {
                  break;
                }
              }
            } finally {
              setIsLoadingOlder(false);
              if (activeChatScopeKeyRef.current !== targetScopeKey) {
                if (pendingJumpTargetRef.current?.scopeKey === targetScopeKey) {
                  pendingJumpTargetRef.current = null;
                }
                suppressAutoScrollRef.current = false;
              } else {
                setTimeout(() => {
                  if (pendingJumpTargetRef.current?.scopeKey === targetScopeKey) {
                    pendingJumpTargetRef.current = null;
                    suppressAutoScrollRef.current = false;
                    showSyncNotice('该历史消息距离当前过远，可继续点击顶部“加载更早历史消息”', 3000);
                  }
                }, 220);
              }
            }
          })();
        } else {
          showSyncNotice('该消息暂未加载到当前窗口，可点击顶部“加载更早历史消息”后重试', 3000);
        }
      });
    });
  };

  useEffect(() => {
    const pending = pendingJumpTargetRef.current;
    const scopeKey = `${currentAccountId || 'default'}::${chat?.id || ''}`;
    if (pending && pending.scopeKey === scopeKey) {
      const matchedIdx = messages.findIndex(
        (m) =>
          m.id === pending.msgId ||
          (typeof pending.telegramMessageId === 'number' &&
            m.telegramMessageId === pending.telegramMessageId)
      );
      const matched = matchedIdx >= 0 ? messages[matchedIdx] : undefined;
      if (matched) {
        focusWindowAroundIndex(matchedIdx, messages.length);
        requestAnimationFrame(() => {
          const targetEl = scrollViewportRef.current?.querySelector(
            `[data-msg-id="${CSS.escape(matched.id)}"]`
          ) as HTMLElement | null;
          if (targetEl) {
            pendingJumpTargetRef.current = null;
            isNearBottomRef.current = false;
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setShowScrollToBottom(true);
            setHighlightedMsgId(matched.id);
            setTimeout(
              () => setHighlightedMsgId((cur) => (cur === matched.id ? null : cur)),
              2000
            );
            setTimeout(() => {
              suppressAutoScrollRef.current = false;
            }, 350);
          }
        });
      }
    }
    const currentId = chat?.id || null;
    const chatChanged = prevChatIdForScrollRef.current !== currentId;
    const prevCount = prevMsgCountRef.current;
    const prevLastId = prevLastMsgIdRef.current;
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastMsgId = lastMsg ? lastMsg.id : null;
    const tailAppended =
      !chatChanged &&
      messages.length > prevCount &&
      Boolean(lastMsgId && lastMsgId !== prevLastId);

    prevChatIdForScrollRef.current = currentId;
    prevMsgCountRef.current = messages.length;
    prevLastMsgIdRef.current = lastMsgId;

    if (chatChanged) {
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      setUnreadWhileScrolledCount(0);
      if (!suppressAutoScrollRef.current) {
        scrollToBottom('auto');
      }
      return;
    }

    if (suppressAutoScrollRef.current) return;

    if (tailAppended) {
      if (lastMsg?.sender === 'me' || (isNearBottomRef.current && msgWindowState.tailHidden === 0)) {
        scrollToBottom('auto');
      } else {
        setShowScrollToBottom(true);
        setUnreadWhileScrolledCount((c) => c + Math.max(1, messages.length - prevCount));
      }
    }
  }, [chat?.id, currentAccountId, messages, msgWindowState, scrollToBottom, focusWindowAroundIndex]);

  // Keep viewport anchored at bottom when window or media content resizes while user is near bottom
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const contentEl = messagesContentRef.current;
    const observer = new ResizeObserver(() => {
      if (suppressAutoScrollRef.current || !isNearBottomRef.current) return;
      viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(viewport);
    if (contentEl) {
      observer.observe(contentEl);
    }
    return () => observer.disconnect();
  }, [chat?.id]);

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
    setHoveredMessageId(null);
    setMessageContextMenu(null);
    lastRightClickRef.current = null;
    setIsSearchingInChat(false);
    setChatSearchQuery('');
    setCloudSearchResults(null);
    setPinnedBannerIndex(0);
    setReplyingTo(null);
    setEditingMessage(null);
    setTranslateOnEdit(false);
    setOlderCursorOffsetId(null);
    pendingJumpTargetRef.current = null;
    pendingOlderAnchorRef.current = null;
    suppressAutoScrollRef.current = false;
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    setUnreadWhileScrolledCount(0);
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

    const currentPreviewContext = `${outboundTargetLang}|${effectiveOutboundEngine}|${translationSettings?.geminiModel || ''}|${translationSettings?.customModelName || ''}`;
    if (previewContextRef.current !== currentPreviewContext) {
      setTranslatedPreview('');
      setTranslatedPreviewSource('');
      setPreviewError('');
      previewContextRef.current = currentPreviewContext;
    }
    if (isLlmOutboundEngine) {
      if (translatedPreviewSource !== queryText) {
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
        previewContextRef.current = `${outboundTargetLang}|${effectiveOutboundEngine}|${translationSettings?.geminiModel || ''}|${translationSettings?.customModelName || ''}`;
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
                'free_dual',
                translationSettings?.googleApiKey,
                undefined,
                undefined,
                undefined,
                { purpose: 'inbound' }
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

      chatDraftTextCache.delete(`${originAccountId || 'default'}::${originChatId}`);
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
    const isImeComposing =
      isComposingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
    const isSendTrigger = sendWithEnter
      ? e.key === 'Enter' && !e.shiftKey && !isImeComposing
      : e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isImeComposing;
    if (isSendTrigger) {
      e.preventDefault();
      if (isSending) return;
      if (pastedImage) {
        handleSendPastedImage();
      } else {
        handleSendText();
      }
    } else if (e.key === 'Escape') {
      if (isImeComposing) return;
      const hasBlockingOverlay =
        Boolean(
          lightboxMedia ||
            memberProfileModal ||
            readReceiptsModal ||
            inviteModalState ||
            forwardModalMessages ||
            showBatchDeleteModal ||
            showClearGroupNoticesModal ||
            messageToDelete ||
            activeRightPanel ||
            isChatInfoOpen ||
            showEmojiPicker ||
            isAttachmentMenuOpen ||
            isHeaderMoreMenuOpen ||
            isLangMenuOpen ||
            isSearchingInChat ||
            aiSuggestion ||
            messageContextMenu ||
            translatedPreview
        ) ||
        Boolean(document.querySelector('[role="dialog"], .z-50, .z-\\[70\\], .z-\\[9996\\]'));
      if (hasBlockingOverlay) return;
      e.preventDefault();
      e.stopPropagation();
      if (pastedImage) {
        clearPastedImage(true);
      } else if (editingMessage) {
        setEditingMessage(null);
        setTranslateOnEdit(false);
        chatDraftTextCache.delete(draftScopeKey);
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
    chatDraftTextCache.delete(`${originAccountId || 'default'}::${originChatId}`);
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
      const isInboundPeerAudio = msg.sender === 'peer';
      const effectiveEngine =
        isInboundPeerAudio || isGroupOrChannelChat || isDualOffMode
          ? isInboundPeerAudio || isGroupOrChannelChat
            ? 'free_dual'
            : 'google'
          : isCustomMode
          ? 'custom_llm'
          : translationSettings?.preferredEngine === 'google'
          ? 'google'
          : 'gemini';
      const forceGoogleAudio = isInboundPeerAudio || isGroupOrChannelChat;

      try {
        const translated = await translateText(
          transcribed,
          'Auto',
          currentInboundTarget,
          customLLMConfig,
          effectiveEngine,
          translationSettings?.googleApiKey,
          forceGoogleAudio ? undefined : translationSettings?.geminiModel,
          forceGoogleAudio ? undefined : translationSettings?.geminiApiKey,
          forceGoogleAudio ? undefined : translationSettings?.customModelName,
          isGroupOrChannelChat ? { purpose: 'group', isGroup: true } : isInboundPeerAudio ? { purpose: 'inbound' } : undefined
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
            : effectiveEngine === 'google' || effectiveEngine === 'free_dual'
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

  const triggerManualTranslate = useCallback(async (targetMsg: Message) => {
    if (!onRetranslateMessage) return;
    const existsInWindow = messagesRef.current.some((m) => m.id === targetMsg.id);
    if (existsInWindow) {
      await onRetranslateMessage(targetMsg.id, targetMsg);
      return;
    }
    setUncontrolledMsgPatches((prev) => ({
      ...prev,
      [targetMsg.id]: {
        ...prev[targetMsg.id],
        isTranslating: true,
        translationError: undefined,
        translationErrorChannel: undefined,
      },
    }));
    try {
      const res = await onRetranslateMessage(targetMsg.id, targetMsg);
      if (res && typeof res === 'object') {
        setUncontrolledMsgPatches((prev) => ({
          ...prev,
          [targetMsg.id]: {
            ...prev[targetMsg.id],
            isTranslating: false,
            ...(res.translatedText !== undefined
              ? {
                  translatedText: res.translatedText,
                  translationError: undefined,
                  translationErrorChannel: undefined,
                }
              : {}),
            ...(res.translationError !== undefined
              ? {
                  translationError: res.translationError,
                  translationErrorChannel: res.translationErrorChannel,
                }
              : {}),
          },
        }));
      } else {
        setUncontrolledMsgPatches((prev) => ({
          ...prev,
          [targetMsg.id]: { ...prev[targetMsg.id], isTranslating: false },
        }));
      }
    } catch {
      setUncontrolledMsgPatches((prev) => ({
        ...prev,
        [targetMsg.id]: { ...prev[targetMsg.id], isTranslating: false },
      }));
    }
  }, [onRetranslateMessage]);

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
    if (targetChatId) {
      chatDraftTextCache.delete(`${targetAccountId || 'default'}::${targetChatId}`);
    }
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
    const mv = getMasterVoiceprint() || masterVoiceprint;
    const hasVoiceCloneSample = Boolean(
      mv && (mv.sampleId || mv.sampleAudioUrl || mv.cloneVoiceId?.trim())
    );
    if (!hasVoiceCloneSample || !mv) {
      showSyncNotice('尚未配置个人声纹样本或 Voice ID，请先在「真人声纹样本克隆」中上传或录制并保存', 4500);
      if (onOpenVoiceprintConfig) {
        onOpenVoiceprintConfig();
      } else {
        setIsVoiceprintModalOpen(true);
      }
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

      // 2. 读取已保存个人声纹样本与克隆引擎参数，直接调用 /api/audio/tts-clone
      const cloneProvider = mv.cloneProvider || 'elevenlabs';
      const cloneFallback =
        cloneProvider === 'elevenlabs'
          ? 'eleven_multilingual_v2'
          : cloneProvider === 'siliconflow_cosyvoice'
          ? 'FunAudioLLM/CosyVoice2-0.5B'
          : cloneProvider === 'gpt_sovits'
          ? 'gpt-sovits'
          : 'tts-1';
      const savedTts = mv.ttsModel?.trim() || '';
      const ttsEngine = savedTts && !/^gemini-/i.test(savedTts) ? savedTts : cloneFallback;

      const speedRate = typeof mv.rate === 'number' && Number.isFinite(mv.rate) ? mv.rate : 1.0;
      const pitchRate = typeof mv.pitch === 'number' && Number.isFinite(mv.pitch) ? mv.pitch : 1.0;
      const voiceClonePayload: VoiceCloneRequestOptions = {
        cloneMode: 'voice_clone',
        sampleId: mv.sampleId,
        sampleAudioDataUrl: !mv.sampleId ? mv.sampleAudioUrl : undefined,
        sampleName: mv.name || '克隆声纹',
        sampleTranscript: mv.sampleTranscript,
        cloneProvider,
        cloneGatewayUrl: mv.cloneGatewayUrl,
        cloneApiKey: mv.cloneApiKey,
        cloneVoiceId: mv.cloneVoiceId,
      };

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
          voiceClone: voiceClonePayload,
        }
      );

      if (!res?.audioUrl || res.error) {
        showSyncNotice(res?.error || '语音合成失败，请检查声纹克隆通道配置', 4500);
        return;
      }

      if (res.clonedVoiceId && res.clonedVoiceId !== mv.cloneVoiceId) {
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
        voiceName: `${mv.name || '克隆声纹'} (声纹克隆)`,
        voiceTone: '💫 自然日常',
        isMasterVoice: true,
        chatId: originChatId,
        accountId: originAccountId,
        replyTo: originReplyPayload,
      });
    } catch (err: any) {
      if (isSameOriginScope(originChatId, originAccountId)) {
        showSyncNotice(err?.message || '语音合成请求异常，请检查声纹克隆通道', 4500);
      }
    } finally {
      setIsSynthesizingVoice(false);
    }
  };


  const baseDisplayedMessages = useMemo(() => {
    if (cloudSearchResults !== null) {
      return cloudSearchResults
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
        });
    }
    if (chatSearchQuery.trim()) {
      const q = chatSearchQuery.toLowerCase();
      return messages.filter((m) => {
        const patched = uncontrolledMsgPatches[m.id] ? { ...m, ...uncontrolledMsgPatches[m.id] } : m;
        return (
          patched.text?.toLowerCase().includes(q) ||
          patched.translatedText?.toLowerCase().includes(q) ||
          patched.sttText?.toLowerCase().includes(q) ||
          patched.fileName?.toLowerCase().includes(q) ||
          patched.imageCaption?.toLowerCase().includes(q) ||
          patched.forwardFrom?.toLowerCase().includes(q)
        );
      });
    }
    return messages;
  }, [cloudSearchResults, currentAccountId, chat?.id, messages, chatSearchQuery, uncontrolledMsgPatches]);

  const displayedMessages = useMemo(() => {
    if (Object.keys(uncontrolledMsgPatches).length === 0) {
      return baseDisplayedMessages;
    }
    return baseDisplayedMessages.map((m) =>
      uncontrolledMsgPatches[m.id] ? { ...m, ...uncontrolledMsgPatches[m.id] } : m
    );
  }, [baseDisplayedMessages, uncontrolledMsgPatches]);
  const isWindowingActive = cloudSearchResults === null && !chatSearchQuery.trim();
  const safeTailHidden = isWindowingActive
    ? Math.min(msgWindowState.tailHidden, Math.max(0, displayedMessages.length - 50))
    : 0;
  const windowSliceEnd = isWindowingActive ? displayedMessages.length - safeTailHidden : displayedMessages.length;
  const windowSliceStart = isWindowingActive ? Math.max(0, windowSliceEnd - msgWindowState.count) : 0;
  const hiddenLoadedCount = windowSliceStart;
  const hiddenNewerCount = displayedMessages.length - windowSliceEnd;
  const renderedMessages = useMemo(
    () =>
      hiddenLoadedCount > 0 || hiddenNewerCount > 0
        ? displayedMessages.slice(windowSliceStart, windowSliceEnd)
        : displayedMessages,
    [displayedMessages, hiddenLoadedCount, hiddenNewerCount, windowSliceStart, windowSliceEnd]
  );

  const pinnedMessages = useMemo(() => messages.filter((m) => m.isPinned), [messages]);
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

  const retrySendMessageFromBubble = useCallback(async (msgId: string) => {
    const retryFn = msgRenderActionsRef.current.onRetryMessage;
    if (!retryFn) return;
    setRetryingMsgIds((prev) => {
      if (prev.has(msgId)) return prev;
      const next = new Set(prev);
      next.add(msgId);
      return next;
    });
    try {
      const res = await retryFn(msgId);
      if (!res.ok) {
        setSyncNotice(`重发失败：${res.error || '请检查 Telegram 在线状态'}`);
        setTimeout(() => setSyncNotice(null), 3500);
      }
    } finally {
      setRetryingMsgIds((prev) => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
    }
  }, []);

  const msgRenderActionsRef = useRef<ChatMessageItemActions>({
    toggleSelectMessage,
    handleMessageContextMenu,
    handleOpenForwardModal,
    copyImageToClipboard,
    copyToClipboard,
    handleOpenGroupMemberProfile,
    openImageGalleryLightbox,
    triggerSilentUrlRefresh,
    handlePlayAudio,
    handleTranscribeAudio,
    renderMessageTextWithLinks,
    handleOpenReadReceipts,
    onToggleReaction,
    onTogglePinMessage,
    onRetryMessage,
    onResumePausedMessage,
    onDiscardPausedMessage,
    onDeleteMessage,
    handleTelegramBubbleImageError,
    resolveDisplayUrl,
    appendThumbQueryIfTelegramMedia,
    triggerManualTranslate,
    onPromptDeleteMessage: (target) => {
      setRevokeSingleDelete(true);
      setMessageToDelete(target);
    },
    onStartReply: (target) => {
      setReplyingTo(target);
      setEditingMessage(null);
    },
    onStartEditMessage: (target) => {
      setEditingMessage(target);
      setTranslateOnEdit(false);
      setInputText(target.text);
      setReplyingTo(null);
    },
    onClearHoveredMenu: () => setHoveredMessageId(null),
    onMarkAvatarFailed: (url) => {
      setFailedAvatarUrls((prev) => {
        if (prev.has(url)) return prev;
        const next = new Set(prev);
        next.add(url);
        return next;
      });
    },
    onOpenVideoLightbox: (payload) => setLightboxMedia(payload),
    onToggleShowOriginal: (msgId) => {
      setShowOriginalMsgIds((prev) => {
        const next = new Set(prev);
        if (next.has(msgId)) next.delete(msgId);
        else next.add(msgId);
        return next;
      });
    },
    onRetrySendMessage: retrySendMessageFromBubble,
  });
  msgRenderActionsRef.current = {
    toggleSelectMessage,
    handleMessageContextMenu,
    handleOpenForwardModal,
    copyImageToClipboard,
    copyToClipboard,
    handleOpenGroupMemberProfile,
    openImageGalleryLightbox,
    triggerSilentUrlRefresh,
    handlePlayAudio,
    handleTranscribeAudio,
    renderMessageTextWithLinks,
    handleOpenReadReceipts,
    onToggleReaction,
    onTogglePinMessage,
    onRetryMessage,
    onResumePausedMessage,
    onDiscardPausedMessage,
    onDeleteMessage,
    handleTelegramBubbleImageError,
    resolveDisplayUrl,
    appendThumbQueryIfTelegramMedia,
    triggerManualTranslate,
    onPromptDeleteMessage: (target) => {
      setRevokeSingleDelete(true);
      setMessageToDelete(target);
    },
    onStartReply: (target) => {
      setReplyingTo(target);
      setEditingMessage(null);
    },
    onStartEditMessage: (target) => {
      setEditingMessage(target);
      setTranslateOnEdit(false);
      setInputText(target.text);
      setReplyingTo(null);
    },
    onClearHoveredMenu: () => setHoveredMessageId(null),
    onMarkAvatarFailed: (url) => {
      setFailedAvatarUrls((prev) => {
        if (prev.has(url)) return prev;
        const next = new Set(prev);
        next.add(url);
        return next;
      });
    },
    onOpenVideoLightbox: (payload) => setLightboxMedia(payload),
    onToggleShowOriginal: (msgId) => {
      setShowOriginalMsgIds((prev) => {
        const next = new Set(prev);
        if (next.has(msgId)) next.delete(msgId);
        else next.add(msgId);
        return next;
      });
    },
    onRetrySendMessage: retrySendMessageFromBubble,
  };
  const hasRetranslateHandler = Boolean(onRetranslateMessage);
  const hasDeleteHandler = Boolean(onDeleteMessage);
  const showOriginalAndTranslationPref = translationSettings?.showOriginalAndTranslation !== false;

  const renderedMessageNodes = useMemo(() => {
    const isGroupChat = Boolean(chat.isGroup);
    const isChannelChat = Boolean(chat.isChannel);
    const readOutboxMax = chat.readOutboxMaxId;
    return renderedMessages.map((msg, idx) => {
      const prevMsg = idx > 0 ? renderedMessages[idx - 1] : null;
      const nextMsg = idx < renderedMessages.length - 1 ? renderedMessages[idx + 1] : null;
      const prevDayKey = prevMsg ? getMessageDayKey(prevMsg) : null;
      const nextDayKey = nextMsg ? getMessageDayKey(nextMsg) : null;
      const prevSenderKey =
        isGroupChat && prevMsg && prevMsg.sender !== 'me' && prevMsg.sender !== 'system'
          ? prevMsg.senderId || normalizeGroupMemberDisplayName(prevMsg.senderName) || `msg_${prevMsg.id}`
          : '';
      const nextSenderKey =
        isGroupChat && nextMsg && nextMsg.sender !== 'me' && nextMsg.sender !== 'system'
          ? nextMsg.senderId || normalizeGroupMemberDisplayName(nextMsg.senderName) || `msg_${nextMsg.id}`
          : '';
      const rawMediaUrl = msg.isImage
        ? msg.imageUrl
        : msg.isVideo
        ? msg.videoUrl
        : msg.isFile
        ? msg.fileUrl
        : msg.audioUrl;
      const resolvedMediaHref = rawMediaUrl ? resolveDisplayUrl(rawMediaUrl) : undefined;
      const resolvedAvatarUrl = (msg.senderAvatarUrl ? resolveDisplayUrl(msg.senderAvatarUrl) : '') || '';
      const isAvatarFailed = Boolean(resolvedAvatarUrl && failedAvatarUrls.has(resolvedAvatarUrl));
      const isReadByPeer = Boolean(
        typeof readOutboxMax === 'number' &&
          typeof msg.telegramMessageId === 'number' &&
          msg.telegramMessageId <= readOutboxMax
      );

      return (
        <ChatMessageItem
          key={msg.id}
          msg={msg}
          idx={idx}
          prevDayKey={prevDayKey}
          prevSenderKey={prevSenderKey}
          nextSenderKey={nextSenderKey}
          nextDayKey={nextDayKey}
          chatId={chat.id}
          isGroup={isGroupChat}
          isChannel={isChannelChat}
          currentAccountId={currentAccountId}
          isReadByPeer={isReadByPeer}
          isMultiSelectMode={isMultiSelectMode}
          isSelectedMulti={selectedMessageIds.has(msg.id)}
          isHoveredMenuOpen={hoveredMessageId === msg.id}
          isHighlighted={highlightedMsgId === msg.id}
          isCopiedMain={copiedId === msg.id}
          isCopiedTranslation={copiedId === `${msg.id}_tr`}
          isPlayingAudio={playingAudioId === msg.id}
          audioProgressPercent={audioProgress[msg.id] || 0}
          isTranscribing={Boolean(transcribingMap[msg.id])}
          isRetrying={retryingMsgIds.has(msg.id)}
          mediaRetryNonce={mediaRetryNonces[msg.id] || 0}
          isShowingOriginalOverlay={showOriginalMsgIds.has(msg.id)}
          resolvedAvatarUrl={resolvedAvatarUrl}
          isAvatarFailed={isAvatarFailed}
          resolvedMediaHref={resolvedMediaHref}
          chatFontClasses={chatFontClasses}
          isChatTransEnabled={isChatTransEnabled}
          showOriginalAndTranslationPref={showOriginalAndTranslationPref}
          hasRetranslateHandler={hasRetranslateHandler}
          hasDeleteHandler={hasDeleteHandler}
          actionsRef={msgRenderActionsRef}
        />
      );
    });
  }, [
    renderedMessages,
    chat.isGroup,
    chat.isChannel,
    chat.id,
    chat.readOutboxMaxId,
    currentAccountId,
    isMultiSelectMode,
    selectedMessageIds,
    hoveredMessageId,
    highlightedMsgId,
    failedAvatarUrls,
    copiedId,
    playingAudioId,
    audioProgress,
    transcribingMap,
    retryingMsgIds,
    mediaRetryNonces,
    showOriginalMsgIds,
    chatFontClasses,
    isChatTransEnabled,
    showOriginalAndTranslationPref,
    hasRetranslateHandler,
    hasDeleteHandler,
    resolveDisplayUrl,
  ]);

  return (
    <div className="flex-1 min-w-0 bg-[#f4f7fb] dark:bg-[#060b12] aurora:bg-[#081116] linen:bg-[#ddd2bc] flex flex-col h-full relative overflow-hidden transition-colors">
      {/* 1. Official Telegram Top Bar Header (Image 2 Layout) */}
      <header className="h-[56px] bg-white/90 dark:bg-[#09111d]/90 aurora:bg-[#0d171d]/92 linen:bg-[#f2e8d9]/95 backdrop-blur-md border-b border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] linen:border-[#cbbba2] flex items-center justify-between px-4 shrink-0 z-10 transition-colors">
        {onCloseChat && (
          <button
            type="button"
            onClick={onCloseChat}
            title="返回会话列表"
            className="lg:hidden mr-1.5 w-8 h-8 rounded-lg hover:bg-[#f1f5f9] dark:hover:bg-[#142236] aurora:hover:bg-[#15252e] linen:hover:bg-[#e7dac5] flex items-center justify-center shrink-0 cursor-pointer text-[#64748b] dark:text-[#9bb3c9] aurora:text-[#7e9aa5] linen:text-[#5f4d3b]"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {/* Left: Contact Info (Click to view Profile & Shared Media) */}
        <div
          onClick={() => setChatInfoOpen(true)}
          className="flex items-center gap-3 flex-1 min-w-0 pr-2 cursor-pointer hover:opacity-90 transition-opacity"
          title="点击查看联系人资料与共享媒体库"
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden shrink-0 relative"
            style={{ backgroundColor: chat.avatarBg }}
          >
            <span className="text-white text-xs font-semibold select-none">{chat.avatarInitial}</span>
            {(() => {
              const rawHeaderUrl = resolveDisplayUrl(chat.avatarUrl);
              const cachedHeader = rawHeaderUrl ? getCachedResolvedAvatarUrl(rawHeaderUrl) : undefined;
              const resolvedHeaderUrl =
                sanitizeSafeResourceUrl(cachedHeader || rawHeaderUrl) || rawHeaderUrl;
              if (
                !resolvedHeaderUrl ||
                isAvatarKnownNoPhoto(resolvedHeaderUrl) ||
                failedHeaderAvatarSrc === resolvedHeaderUrl
              ) {
                return null;
              }
              const isHeaderLoaded =
                isAvatarAlreadyLoaded(resolvedHeaderUrl) || loadedHeaderAvatarSrc === resolvedHeaderUrl;
              return (
                <img
                  key={resolvedHeaderUrl}
                  src={resolvedHeaderUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className={`w-full h-full object-cover absolute inset-0 ${
                    isHeaderLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                  onLoad={(e) => {
                    if (e.currentTarget.naturalWidth <= 0) return;
                    markAvatarLoaded(resolvedHeaderUrl);
                    setLoadedHeaderAvatarSrc(resolvedHeaderUrl);
                    setFailedHeaderAvatarSrc((prev) => (prev === resolvedHeaderUrl ? '' : prev));
                  }}
                  onError={() => {
                    clearLoadedAvatarCache(resolvedHeaderUrl);
                    setFailedHeaderAvatarSrc(resolvedHeaderUrl);
                    void fetch(resolvedHeaderUrl, { method: 'HEAD', credentials: 'include' })
                      .then((r) => {
                        if (r.status === 404) markAvatarKnownNoPhoto(resolvedHeaderUrl);
                      })
                      .catch(() => {})
                      .finally(() => {
                        if (!isAvatarKnownNoPhoto(resolvedHeaderUrl)) {
                          void triggerSilentUrlRefresh(chat.avatarUrl, true);
                        }
                      });
                  }}
                />
              );
            })()}
            {chat.isVerified && (
              <div className="absolute inset-0 bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#14b8a6] linen:bg-[#a86a43] flex items-center justify-center text-white">
                <Check className="w-4 h-4 stroke-[2.5]" />
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[14px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] truncate leading-tight">
                {chat.title}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setChatInfoOpen(true);
                }}
                title={chat.isGroup || chat.isChannel ? '设置本地群组/频道备注' : '设置/修改好友备注'}
                className="p-0.5 text-[#64748b] hover:text-[#2481cc] dark:text-[#7b93ad] dark:hover:text-[#2ba0ff] aurora:text-[#7e9aa5] aurora:hover:text-[#5eead4] linen:text-[#a86a43] linen:hover:text-[#7e4d2e] rounded-sm transition-colors cursor-pointer"
              >
                <Edit2 className="w-3 h-3" />
              </button>
              {chat.isVerified && (
                <span className="w-3.5 h-3.5 bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#14b8a6] linen:bg-[#a86a43] rounded-full flex items-center justify-center text-white shrink-0">
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                </span>
              )}
            </div>
            <div
              className={`text-[11.5px] leading-none mt-0.5 tabular-nums ${
                chat.isOnline
                  ? 'text-emerald-600 dark:text-emerald-400 aurora:text-emerald-400 linen:text-[#3a6652] font-medium'
                  : chat.isGroup || chat.isChannel
                  ? 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c5a37]'
                  : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957]'
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

        {/* Right: Image 2 Header Actions ([私聊翻译] [全息记忆] [Search] [···] [⋮] [×]) */}
        <div className="flex items-center gap-1.5 shrink-0 text-[#64748b] dark:text-[#9bb3c9] aurora:text-[#7e9aa5] linen:text-[#5f4d3b]">
          {/* Bidirectional Translation Bar Toggle */}
          <button
            type="button"
            onClick={() => setIsTranslateBarVisible(!isTranslateBarVisible)}
            title={isChatTransEnabled ? '展开或收起实时翻译栏' : '当前会话翻译已关闭（点击展开配置或重新开启）'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors cursor-pointer ${
              !isChatTransEnabled
                ? 'bg-slate-100 border-slate-300 text-slate-500 hover:text-slate-800 dark:bg-[#0e1726] dark:border-[#1e3148] dark:text-[#7b93ad] dark:hover:text-white aurora:bg-[#0e1920] aurora:border-[#1e343e] aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] linen:bg-[#e5d9c5] linen:border-[#cbbba2] linen:text-[#6f5d4b] linen:hover:text-[#2b2118]'
                : isTranslateBarVisible
                  ? 'bg-[#e8f3ff] border-[#bfdbfe] text-[#2481cc] dark:bg-[#132234] dark:border-[#2ba0ff]/40 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:border-[#2dd4bf]/45 aurora:text-[#5eead4] linen:bg-[#a86a43] linen:border-[#935a36] linen:text-white linen:hover:bg-[#935a36] linen:shadow-xs'
                  : 'bg-[#f8fafc] border-[#e2e8f0] text-[#64748b] hover:text-[#0f172a] dark:bg-[#0e1726] dark:border-[#1a2b40] dark:text-[#8aa0b8] dark:hover:text-white aurora:bg-[#101c23] aurora:border-[#1e343e] aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] linen:bg-[#e9decb] linen:border-[#cbbba2] linen:text-[#5f4d3b] linen:hover:text-[#2b2118]'
            }`}
          >
            <Languages className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {chatTransScopeLabel}: {isChatTransEnabled ? '开启' : '已关闭'}
            </span>
          </button>

          {/* 当前联系人全息记忆按钮 */}
          <button
            type="button"
            onClick={onOpenCustomerMemory || onOpenKnowledgeEvolution}
            title="全息记忆"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors cursor-pointer ${
              isCustomerMemoryOpen
                ? 'bg-[#2481cc] border-[#2481cc] text-white dark:bg-[#2ba0ff]/20 dark:border-[#2ba0ff]/50 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:border-[#2dd4bf]/55 aurora:text-[#5eead4] linen:bg-[#826832] linen:border-[#6f5828] linen:text-white linen:shadow-xs'
                : 'bg-[#f0f7ff] hover:bg-[#e0efff] dark:bg-[#102033] dark:hover:bg-[#142840] aurora:bg-[#10242b] aurora:hover:bg-[#132d36] border-[#dbeafe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/30 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:bg-[#9e8244] linen:hover:bg-[#8a7039] linen:border-[#8a7039] linen:text-white linen:shadow-xs'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span className="hidden lg:inline font-semibold">全息记忆</span>
          </button>

          {/* In-Chat Search Button */}
          <button
            type="button"
            onClick={() => setIsSearchingInChat(!isSearchingInChat)}
            title="搜索消息"
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              isSearchingInChat
                ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4] linen:bg-[#e5d6be] linen:text-[#a86a43]'
                : 'hover:bg-[#f1f5f9] dark:hover:bg-[#142236] aurora:hover:bg-[#15252e] linen:hover:bg-[#e7dac5] text-[#64748b] dark:text-[#9bb3c9] aurora:text-[#7e9aa5] linen:text-[#5f4d3b] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Header More Actions Popover Button (··· for Refresh + Font Scale, Image 2) */}
          <button
            ref={headerMoreButtonRef}
            type="button"
            onClick={() => setIsHeaderMoreMenuOpen((v) => !v)}
            title="刷新当前对话与字体大小调节"
            className={`w-9 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              isHeaderMoreMenuOpen || isSyncingCloud || chatFontScale !== 1
                ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4] linen:bg-[#b57a54] linen:text-white linen:shadow-xs'
                : 'hover:bg-[#f1f5f9] dark:hover:bg-[#142236] aurora:hover:bg-[#15252e] linen:bg-[#b57a54]/85 linen:hover:bg-[#a86a43] linen:text-white text-[#64748b] dark:text-[#9bb3c9] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8]'
            }`}
          >
            <MoreHorizontal className={`w-4 h-4 ${isSyncingCloud ? 'animate-pulse' : ''}`} />
          </button>

          {/* Header More Actions Portal Popover */}
          {isHeaderMoreMenuOpen && headerMoreMenuPos && typeof document !== 'undefined' && createPortal(
            <div
              ref={headerMoreMenuRef}
              style={{ top: `${headerMoreMenuPos.top}px`, left: `${headerMoreMenuPos.left}px` }}
              className="fixed z-[9990] w-[196px] bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#d5c6ae] rounded-xl shadow-xl linen:shadow-sm p-1.5 flex flex-col gap-1 text-xs animate-in fade-in zoom-in-95 duration-150 select-none"
            >
              <button
                type="button"
                onClick={() => {
                  setIsHeaderMoreMenuOpen(false);
                  void handleSyncCloudMessages();
                }}
                disabled={!chat.id.startsWith('tg_') || isSyncingCloud}
                title={chat.id.startsWith('tg_') ? '从 Telegram 云端同步当前对话最新消息' : '当前本地演示会话不支持云端同步'}
                className="w-full flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#ede2d0] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <RotateCw className={`w-3.5 h-3.5 shrink-0 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#6f5d4b] ${isSyncingCloud ? 'animate-spin' : ''}`} />
                <span className="font-medium">{isSyncingCloud ? '正在刷新对话...' : '刷新当前对话'}</span>
              </button>

              {(chat.isGroup || groupNoticeMessages.length > 0) && onBatchDeleteMessages && (
                <button
                  type="button"
                  onClick={() => {
                    setIsHeaderMoreMenuOpen(false);
                    setRevokeBatchDelete(true);
                    setShowClearGroupNoticesModal(true);
                  }}
                  disabled={groupNoticeMessages.length === 0 || isClearingGroupNotices || isBatchDeleting}
                  title={
                    groupNoticeMessages.length > 0
                      ? `一键清理当前群聊中的 ${groupNoticeMessages.length} 条入/退群提示`
                      : '当前群聊暂无可清理的入/退群提示'
                  }
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-rose-600 dark:text-rose-400 aurora:text-rose-400 linen:text-[#a64234] hover:bg-rose-50 dark:hover:bg-rose-500/15 aurora:hover:bg-rose-500/15 linen:hover:bg-[#f2ded6] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>清理入/退群提示</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums bg-rose-500/12">
                    {groupNoticeMessages.length}
                  </span>
                </button>
              )}

              <div className="h-px bg-[#e2e8f0] dark:bg-[#18273a] aurora:bg-[#182b34] linen:bg-[#dfd2bc] mx-1" />

              <div
                className="flex items-center justify-between gap-1 px-2 py-1 text-[11.5px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3e2f]"
                title={`调节聊天文字大小（当前 ${Math.round(chatFontScale * 100)}%，快捷键 Ctrl/Cmd + / - / 0）`}
              >
                <span className="font-medium shrink-0 whitespace-nowrap">字体大小:</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => stepChatFontScale(-1)}
                    disabled={chatFontScaleIndex <= 0}
                    title={`缩小聊天文字 (Ctrl/Cmd + -)`}
                    className="px-1.5 h-6 rounded-md border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#fdfaf3] text-[11px] font-semibold cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed hover:border-[#2481cc] dark:hover:border-[#2ba0ff] aurora:hover:border-[#2dd4bf] linen:hover:border-[#a86a43]"
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    onClick={resetChatFontScale}
                    disabled={chatFontScale === 1}
                    title={chatFontScale === 1 ? '当前默认字号 100%' : '点击恢复默认字号 100% (Ctrl/Cmd + 0)'}
                    className="px-1 h-6 rounded text-[11px] font-medium tabular-nums cursor-pointer disabled:cursor-default text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] linen:hover:text-[#a86a43]"
                  >
                    {Math.round(chatFontScale * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => stepChatFontScale(1)}
                    disabled={chatFontScaleIndex >= CHAT_FONT_SCALE_STEPS.length - 1}
                    title={`放大聊天文字 (Ctrl/Cmd + +)`}
                    className="px-1.5 h-6 rounded-md border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#fdfaf3] text-[11px] font-semibold cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed hover:border-[#2481cc] dark:hover:border-[#2ba0ff] aurora:hover:border-[#2dd4bf] linen:hover:border-[#a86a43]"
                  >
                    A+
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

          {/* More Options / Chat Info Drawer */}
          <button
            type="button"
            onClick={() => setChatInfoOpen(true)}
            title="更多与联系人资料"
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              isChatInfoOpen
                ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#132234] dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4] linen:bg-[#e5d6be] linen:text-[#a86a43]'
                : 'hover:bg-[#f1f5f9] dark:hover:bg-[#142236] aurora:hover:bg-[#15252e] linen:hover:bg-[#e7dac5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
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
              className="w-8 h-8 rounded-lg hover:bg-[#f1f5f9] dark:hover:bg-[#142236] aurora:hover:bg-[#15252e] linen:hover:bg-[#e7dac5] flex items-center justify-center hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] transition-colors cursor-pointer text-[#64748b] dark:text-[#9bb3c9] aurora:text-[#7e9aa5] linen:text-[#5f4d3b]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* In-Chat Search Bar */}
      {isSearchingInChat && (
        <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f5ecde] border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] px-4 py-2 flex items-center gap-2 text-xs animate-in fade-in duration-150">
          <Search className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] shrink-0" />
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
            className="flex-1 bg-[#f1f5f9] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#fdfaf4] px-3 py-1.5 rounded-lg text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] focus:outline-none placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#9c8c7a]"
            autoFocus
          />
          {chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && chatSearchQuery.trim() && (
            <button
              type="button"
              disabled={isCloudSearching}
              onClick={() => void handleCloudSearch()}
              className="px-2.5 py-1 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#935a36] disabled:opacity-50 text-white font-medium text-[11px] shrink-0 cursor-pointer transition-colors"
            >
              {isCloudSearching ? '检索中...' : '云端全文搜索'}
            </button>
          )}
          {cloudSearchResults !== null && (
            <button
              type="button"
              onClick={() => setCloudSearchResults(null)}
              className="px-2 py-1 rounded-lg bg-[#f1f5f9] dark:bg-[#152438] aurora:bg-[#152934] linen:bg-[#e9decb] text-[#64748b] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#5f4d3b] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] text-[11px] shrink-0 cursor-pointer"
            >
              返回列表
            </button>
          )}
          {chatSearchQuery && (
            <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] whitespace-nowrap tabular-nums">
              {cloudSearchResults !== null ? `云端 ${displayedMessages.length} 条` : `匹配 ${displayedMessages.length} 条`}
            </span>
          )}
          <button
            onClick={() => {
              setIsSearchingInChat(false);
              setChatSearchQuery('');
              setCloudSearchResults(null);
            }}
            className="p-1 text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] linen:text-[#7a6957] linen:hover:text-[#2b2118] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Telegram Pinned Message Top Banner */}
      {activePinnedMessage && (
        <div className="bg-[#f0f7ff] dark:bg-[#0d1929] aurora:bg-[#0f1d24] linen:bg-[#f4ebd9] border-b border-[#dbeafe] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] px-4 py-2 flex items-center justify-between text-xs animate-in fade-in duration-150">
          <button
            type="button"
            onClick={() => {
              const runPinnedJump = () => {
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
              };
              if (hiddenLoadedCount > 0 || hiddenNewerCount > 0) {
                const pinnedIdx = displayedMessages.findIndex((m) => m.id === activePinnedMessage.id);
                if (pinnedIdx >= 0) {
                  focusWindowAroundIndex(pinnedIdx, displayedMessages.length);
                }
                requestAnimationFrame(() => setTimeout(runPinnedJump, 40));
              } else {
                runPinnedJump();
              }
            }}
            className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer hover:opacity-85 transition-opacity"
            title="点击定位到当前置顶消息"
          >
            <Pin className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43] shrink-0 fill-current" />
            <div className="min-w-0 truncate">
              <span className="font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43] mr-1.5">
                置顶消息{pinnedMessages.length > 1 ? ` (${safePinnedIndex + 1}/${pinnedMessages.length})` : ''}:
              </span>
              <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                {activePinnedMessage.text ||
                  (activePinnedMessage.isImage ? '🖼️ [图片]' : activePinnedMessage.isAudio ? '🎤 [语音]' : '消息')}
              </span>
            </div>
          </button>
          {pinnedMessages.length > 1 && (
            <button
              type="button"
              onClick={() => setPinnedBannerIndex((i) => (i + 1) % pinnedMessages.length)}
              className="text-xs text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43] p-1 cursor-pointer shrink-0 ml-1"
              title="下一条置顶消息"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onTogglePinMessage?.(activePinnedMessage.id)}
            className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] p-1 cursor-pointer shrink-0 ml-1"
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
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 aurora:text-amber-300 linen:text-[#8c4b1e]'
                : 'bg-[#e8f3ff] border-[#bfdbfe] text-[#2481cc] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/30 dark:text-[#2ba0ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] linen:bg-[#efe2ce] linen:border-[#d3bc9a] linen:text-[#8c522d]'
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

      {/* 2. Official Telegram Native Translate Bar (Image 2 Layout) */}
      {isTranslateBarVisible && (
        <div className="bg-[#f8fafc]/90 dark:bg-[#0c1624]/90 aurora:bg-[#0c171d]/92 linen:bg-[#ede3d2]/95 backdrop-blur-xs border-b border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] linen:border-[#cbbba2] px-4 py-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-[#0f172a] dark:text-[#d3e2ef] aurora:text-[#d5ebee] linen:text-[#3d2e20] transition-colors shrink-0 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Languages className={`w-3.5 h-3.5 shrink-0 ${isChatTransEnabled ? 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#7c5838]' : 'text-[#94a3b8] dark:text-[#64748b] linen:text-[#9c8c7a]'}`} />
            {isChatTransEnabled ? (
              <span className="font-medium truncate text-[#334155] dark:text-[#d3e2ef] aurora:text-[#d5ebee] linen:text-[#3d2e20]">
                译文: {getLanguageDisplayName(inboundTargetLang)}
              </span>
            ) : (
              <span className="font-medium truncate text-[#64748b] dark:text-[#8aa0b8] aurora:text-[#7e9aa5] linen:text-[#7a6957]">
                {chatTransScopeLabel}已关闭
              </span>
            )}
            <span className="text-[#94a3b8] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#8c7a65] text-[11px] select-none">↔</span>

            {/* Quick Target Language Selector */}
            <div className="relative inline-flex items-center" ref={langMenuRef}>
              <button
                ref={langButtonRef}
                type="button"
                onClick={() => setIsLangMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-[#e8f3ff]/70 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e2d3bd] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#3d2e20] cursor-pointer transition-colors font-medium text-[11.5px]"
              >
                <span>发信目标: {getLanguageDisplayName(outboundTargetLang)}</span>
                <ChevronDown className="w-3 h-3 opacity-75" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onToggleChatTranslation?.(chat.id, !isChatTransEnabled)}
              title={isChatTransEnabled ? `点击关闭当前${chatTransScopeLabel}` : `点击开启当前${chatTransScopeLabel}`}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium border transition-colors cursor-pointer ${
                isChatTransEnabled
                  ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-700 dark:text-emerald-300 aurora:text-emerald-300 linen:bg-[#3a6652]/12 linen:border-[#3a6652]/35 linen:text-[#3a6652] hover:bg-emerald-500/20 linen:hover:bg-[#3a6652]/20'
                  : 'bg-slate-200/80 border-slate-300 text-slate-600 dark:bg-[#132234] dark:border-[#1e3148] dark:text-[#94a3b8] aurora:bg-[#10242b] aurora:border-[#1e343e] aurora:text-[#8eb2bd] linen:bg-[#e2d5c1] linen:border-[#cbbba2] linen:text-[#6f5d4b]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isChatTransEnabled ? 'bg-emerald-500 linen:bg-[#3a6652]' : 'bg-slate-400 dark:bg-slate-500 linen:bg-[#9c8c7a]'
                }`}
              />
              <span>{isChatTransEnabled ? '开启' : '关闭'}</span>
            </button>
            <button
              type="button"
              onClick={onOpenTranslation}
              className="inline-flex items-center gap-1 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#5f4d3b] linen:hover:text-[#2b2118] hover:underline font-medium cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>设置</span>
            </button>
            <button
              type="button"
              onClick={() => setIsTranslateBarVisible(false)}
              className="p-0.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] transition-colors cursor-pointer"
              title="收起翻译栏"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Shared Target Language Dropdown Portal (Anchored to Top Bar or Bottom Composer) */}
      {isLangMenuOpen && langMenuPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={langDropdownRef}
          style={{
            top: `${langMenuPos.top}px`,
            left: `${langMenuPos.left}px`,
            maxHeight: `${langMenuPos.maxHeight}px`,
          }}
          className="fixed z-[9990] w-64 flex flex-col bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#d5c6ae] rounded-xl shadow-2xl linen:shadow-sm p-1.5 animate-in fade-in duration-150"
        >
          <div className="px-2 py-1 text-[10px] font-semibold text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] uppercase tracking-wider border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] pb-1 mb-1 shrink-0">
            选择联系人语言 (全球 {SUPPORTED_LANGUAGES.length - 1} 种)
          </div>
          <div className="px-1 pb-1.5 shrink-0">
            <input
              type="text"
              value={langMenuSearch}
              onChange={(e) => setLangMenuSearch(e.target.value)}
              placeholder="搜索语言名称或代码..."
              className="w-full px-2 py-1 text-[11px] rounded-md bg-[#f1f5f9] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#fdfaf4] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#9c8c7a] focus:outline-none focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
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
                      ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43] text-white font-medium'
                      : 'text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#ede2d0]'
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

      {/* 3. Messages Stream Viewport with Official Telegram Wallpaper Pattern */}
      <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
        <div
          ref={scrollViewportRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (scrollRafRef.current !== null) return;
            scrollRafRef.current = requestAnimationFrame(() => {
              scrollRafRef.current = null;
              const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
              const nearBottom = distFromBottom <= 72;
              isNearBottomRef.current = nearBottom;
              if (nearBottom && hiddenNewerCount === 0) {
                setShowScrollToBottom((prev) => (prev ? false : prev));
                setUnreadWhileScrolledCount((prev) => (prev !== 0 ? 0 : prev));
                setMsgWindowState((prev) =>
                  prev.tailHidden === 0 && prev.count > DEFAULT_MSG_WINDOW + 60
                    ? { count: DEFAULT_MSG_WINDOW, tailHidden: 0 }
                    : prev
                );
              } else {
                setShowScrollToBottom((prev) => (!prev ? true : prev));
                if (nearBottom && hiddenNewerCount > 0 && !pendingWindowAnchorRef.current) {
                  shiftWindowDown(WINDOW_STEP);
                }
              }
              if (
                el.scrollHeight > el.clientHeight + 40 &&
                el.scrollTop <= 80 &&
                hiddenLoadedCount > 0 &&
                cloudSearchResults === null &&
                !pendingWindowAnchorRef.current
              ) {
                expandLocalMessageWindow(WINDOW_STEP);
              } else if (
                el.scrollHeight > el.clientHeight + 40 &&
                el.scrollTop <= 80 &&
                chat.id.startsWith('tg_') &&
                currentAccountId !== 'acc_telegram_bot' &&
                hasMoreHistory &&
                cloudSearchResults === null &&
                !isLoadingOlder &&
                Date.now() >= loadOlderCooldownUntilRef.current &&
                onLoadOlderMessages
              ) {
                void handleLoadOlderClick(true);
              }
            });
          }}
          className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-3.5 py-2.5 space-y-1.5 tg-chat-pattern select-text"
        >
          {/* Load Older Cloud History Button */}
          {chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && hasMoreHistory && cloudSearchResults === null && onLoadOlderMessages && (
            <div className="flex items-center justify-center my-1">
              <button
                type="button"
                disabled={isLoadingOlder}
                onClick={() => void handleLoadOlderClick()}
                className="px-3.5 py-1 rounded-full bg-white/90 dark:bg-[#0e1726]/90 aurora:bg-[#101c23]/90 linen:bg-[#f6efe2]/95 hover:bg-[#e8f3ff] dark:hover:bg-[#142336] aurora:hover:bg-[#112e37] linen:hover:bg-[#efe2ce] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[11px] font-medium text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
              >
                <History className={`w-3.5 h-3.5 ${isLoadingOlder ? 'animate-spin' : ''}`} />
                <span>{isLoadingOlder ? '正在加载更早消息...' : '加载更早历史消息'}</span>
              </button>
            </div>
          )}

          {hiddenLoadedCount > 0 && (
            <div className="flex items-center justify-center my-1">
              <button
                type="button"
                onClick={() => expandLocalMessageWindow(150)}
                className="px-3 py-1 rounded-full bg-white/85 dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#1e3148] text-[11px] font-medium text-[#64748b] dark:text-[#7b93ad] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] cursor-pointer transition-colors"
              >
                展开更早 {Math.min(150, hiddenLoadedCount)} 条消息（共 {hiddenLoadedCount} 条已折叠）
              </button>
            </div>
          )}

          <div ref={messagesContentRef} className="space-y-1.5">
            {renderedMessageNodes}
          </div>
          {hiddenNewerCount > 0 && (
            <div className="flex items-center justify-center my-1.5">
              <button
                type="button"
                onClick={() => shiftWindowDown(WINDOW_STEP)}
                className="px-3 py-1 rounded-full bg-white/85 dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#1e3148] text-[11px] font-medium text-[#2481cc] dark:text-[#2ba0ff] cursor-pointer transition-colors"
              >
                向下展开更多较新消息（下方还有 {hiddenNewerCount} 条）
              </button>
            </div>
          )}
          <div ref={messagesEndRef} style={{ overflowAnchor: 'none' }} />
        </div>

        {/* Floating Scroll-to-Bottom Button */}
        {showScrollToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            aria-label="回到底部"
            title="回到底部"
            className="absolute bottom-4 right-5 z-20 w-10 h-10 rounded-full bg-white/95 dark:bg-[#0e1726]/95 aurora:bg-[#101c23]/95 linen:bg-[#faf5ec]/95 border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center cursor-pointer animate-in fade-in zoom-in-95 duration-150"
          >
            <ChevronDown className="w-5 h-5" />
            {unreadWhileScrolledCount > 0 && (
              <span className="absolute -top-2 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#14b8a6] linen:bg-[#a86a43] text-white text-[10px] font-bold flex items-center justify-center tabular-nums shadow-xs">
                {unreadWhileScrolledCount > 99 ? '99+' : unreadWhileScrolledCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Multi-Select Batch Operations Bar */}
      {isMultiSelectMode && (
        <div className="bg-[#f0f7ff] dark:bg-[#0d1929] aurora:bg-[#0f1d24] linen:bg-[#f2e8d9] border-t border-[#bfdbfe] dark:border-[#1e3148] aurora:border-[#1f3b45] linen:border-[#cbbba2] px-4 py-2.5 flex items-center justify-between gap-2 text-xs shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] tabular-nums">
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
              className="px-2 py-1 rounded-lg bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#faf5ec] border border-[#dbeafe] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] hover:bg-[#e8f3ff] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] cursor-pointer text-[11px]"
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
              className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#935a36] disabled:opacity-40 text-white font-medium flex items-center gap-1.5 cursor-pointer"
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
              className="px-2.5 py-1.5 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-[#152934] linen:hover:bg-[#e7dac4] cursor-pointer"
            >
              退出多选
            </button>
          </div>
        </div>
      )}

      {/* 4. Official Telegram Composer (Image 1 Structured Layout) */}
      <footer onPaste={handlePaste} className="bg-white/95 dark:bg-[#09111d]/95 aurora:bg-[#0d171d]/95 linen:bg-[#f2e8d9]/95 backdrop-blur-md border-t border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] linen:border-[#cbbba2] px-4 py-2.5 shrink-0 transition-colors">
        {/* AI Generating Indicator */}
        {isGeneratingAi && (
          <div className="mb-2 px-3 py-2 bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] linen:bg-[#efe2ce] border border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2] rounded-xl flex items-center gap-2 text-xs text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] animate-pulse">
            <Sparkles className="w-4 h-4 animate-spin text-amber-500 linen:text-[#a86a43]" />
            <span>AI 正在深度检索该客户全息画像与过往约定，生成真人拟真回复...</span>
          </div>
        )}

        {/* AI Holographic Memory Suggestion Card */}
        {aiSuggestion && (
          <div className="mb-2.5 p-3.5 bg-gradient-to-r from-[#eff6ff] via-[#f8fafc] to-transparent dark:from-[#2ba0ff]/12 dark:via-[#101c2d]/80 dark:to-transparent aurora:from-[#112d36]/90 aurora:via-[#0d1e25]/80 aurora:to-transparent linen:from-[#f7efe0] linen:via-[#f3e9d8] linen:to-[#efe3cf]/60 border border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2] rounded-xl flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d]">
                <Sparkles className="w-3.5 h-3.5 text-amber-500 linen:text-[#a86a43] shrink-0" />
                <span>AI 回复建议</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAiSuggestion(null);
                  setAiSuggestionTranslation(null);
                }}
                className="text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] linen:text-[#7a6957] linen:hover:text-[#2b2118] p-0.5 cursor-pointer"
                title="关闭建议"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Bilingual Content Box */}
            <div className="bg-white dark:bg-[#0e1726]/95 aurora:bg-[#101c23]/95 linen:bg-[#fdfaf3] p-3 rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6b0] select-text space-y-2.5">
              {/* 1. Foreign Outbound Text */}
              <div>
                <span className="text-[10px] font-semibold text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] block mb-1">
                  外文译稿：
                </span>
                <div className="text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] leading-relaxed font-sans">
                  {aiSuggestion}
                </div>
              </div>

              {/* 2. Chinese Meaning Translation */}
              {aiSuggestionTranslation ? (
                <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#e6dac6] text-xs text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-start gap-1.5">
                  <Languages className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-80" />
                  <div className="flex-1">
                    <span className="text-[10px] font-semibold text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] block mb-0.5">
                      {getLanguageDisplayName(inboundTargetLang)}对照：
                    </span>
                    <span className="leading-relaxed font-sans text-[#1e293b] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3e30]">
                      {aiSuggestionTranslation}
                    </span>
                  </div>
                </div>
              ) : isTranslatingSuggestion ? (
                <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#e6dac6] text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-center gap-1.5 animate-pulse">
                  <Languages className="w-3 h-3 animate-spin shrink-0" />
                  <span>正在获取{getLanguageDisplayName(inboundTargetLang)}含义翻译...</span>
                </div>
              ) : (() => {
                const refTargetLang = inboundTargetLang && inboundTargetLang !== 'Auto' ? inboundTargetLang : 'Chinese';
                const refTargetNorm = normalizeChatLangCode(refTargetLang);
                const replyLangNorm = normalizeChatLangCode(detectClientLangCode(aiSuggestion));
                if (refTargetNorm === 'auto' || replyLangNorm === refTargetNorm) return null;
                return (
                  <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#e6dac6] text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Languages className="w-3 h-3 shrink-0 opacity-80" />
                      <span>暂未获取{getLanguageDisplayName(refTargetLang)}对照</span>
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!aiSuggestion || isTranslatingSuggestion) return;
                        setIsTranslatingSuggestion(true);
                        try {
                          const refTrans = await translateText(
                            aiSuggestion,
                            'Auto',
                            refTargetLang,
                            customLLMConfig,
                            'free_dual',
                            translationSettings?.googleApiKey,
                            undefined,
                            undefined,
                            undefined,
                            { purpose: 'inbound' }
                          );
                          setAiSuggestionTranslation(refTrans || null);
                        } catch {
                          showSyncNotice('我方语言对照翻译失败，请检查网络连接', 4000);
                        } finally {
                          setIsTranslatingSuggestion(false);
                        }
                      }}
                      className="px-2 py-0.5 rounded bg-[#2481cc]/10 hover:bg-[#2481cc]/20 linen:bg-[#a86a43]/12 linen:hover:bg-[#a86a43]/22 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-semibold cursor-pointer transition-colors"
                    >
                      重试对照翻译
                    </button>
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center justify-end gap-2 text-xs pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setInputText(aiSuggestion);
                  setAiSuggestion(null);
                  setAiSuggestionTranslation(null);
                }}
                className="px-2.5 py-1 rounded-lg bg-[#f1f5f9] dark:bg-[#152438] aurora:bg-[#152934] linen:bg-[#eadcc6] hover:bg-[#e2e8f0] dark:hover:bg-[#1b2f48] aurora:hover:bg-[#1b3441] linen:hover:bg-[#dfd0b8] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] font-medium text-[11px] cursor-pointer transition-colors"
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
                          'free_dual',
                          translationSettings?.googleApiKey,
                          undefined,
                          undefined,
                          undefined,
                          { purpose: 'inbound' }
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
                className={`px-3 py-1 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#935a36] text-white font-medium text-[11px] cursor-pointer flex items-center gap-1 shadow-xs transition-all ${
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
            <div className="mb-2 px-3 py-1.5 bg-[#f0f7ff] dark:bg-[#0e1928] aurora:bg-[#102229] linen:bg-[#f7f0e4] border border-[#dbeafe] dark:border-[#1e3148] aurora:border-[#1f3b45] linen:border-[#d4c3aa] rounded-xl flex items-center justify-between text-xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 min-w-0">
                <Languages className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#7c5838] shrink-0" />
                <div className="min-w-0 flex items-center gap-1.5">
                  <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] shrink-0">
                    译文预览：
                  </span>
                  <span className={`${chatFontClasses.secondary} font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] truncate`}>
                    {translatedPreview}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <span className="text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#8c522d] font-medium">
                  {sendWithEnter ? 'Enter' : 'Ctrl+Enter'} 发送
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setTranslatedPreview('');
                    setTranslatedPreviewSource('');
                    setPreviewError('');
                  }}
                  className="p-0.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#8c522d] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] rounded hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-[#152934] linen:hover:bg-[#e5d6be] cursor-pointer transition-colors"
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
            <div className="mb-2 px-3 py-1.5 bg-[#f8fafc] dark:bg-[#0e1928] aurora:bg-[#102229] linen:bg-[#f7f0e4] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1f3b45] linen:border-[#d4c3aa] rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43] shrink-0" />
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#5c4a38] truncate">
                  大模型翻译已开启（打字不耗额度，发送或点击右侧按钮译为 {getLanguageDisplayName(outboundTargetLang)}）
                </span>
              </div>
              <button
                type="button"
                disabled={isTranslatingPreview}
                onClick={() => void handleManualLlmPreview()}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#2481cc]/10 hover:bg-[#2481cc]/20 dark:bg-[#2ba0ff]/15 dark:hover:bg-[#2ba0ff]/25 aurora:bg-[#14b8a6]/15 aurora:hover:bg-[#14b8a6]/25 linen:bg-[#a86a43]/12 linen:hover:bg-[#a86a43]/22 border border-[#2481cc]/25 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/30 linen:border-[#a86a43]/30 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] text-[11px] font-semibold cursor-pointer disabled:opacity-60 transition-colors"
              >
                <RotateCw className={`w-3 h-3 ${isTranslatingPreview ? 'animate-spin' : ''}`} />
                <span>{isTranslatingPreview ? '生成中...' : '预览AI翻译'}</span>
              </button>
            </div>
          );
        })()}

        {/* Reply Quote Banner above Input */}
        {replyingTo && (
          <div className="mb-2 p-2 px-3 bg-[#f0f7ff] dark:bg-[#0e1928] aurora:bg-[#102229] linen:bg-[#f7f0e4] border border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2] rounded-xl flex items-center justify-between text-xs animate-in fade-in duration-150">
            <div className="min-w-0 pr-2">
              <div className="font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-center gap-1.5">
                <Reply className="w-3.5 h-3.5" />
                <span>回复 {replyingTo.sender === 'me' ? '我' : (chat.title || '对方')}</span>
              </div>
              <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6f5d4b] truncate mt-0.5">
                {replyingTo.text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="p-1 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer shrink-0"
              title="取消回复"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Edit Message Banner above Input */}
        {editingMessage && (
          <div className="mb-2 p-2 px-3 bg-amber-50 dark:bg-amber-500/12 aurora:bg-amber-500/12 linen:bg-[#f4e8d3] border border-amber-300/70 dark:border-amber-500/35 aurora:border-amber-500/35 linen:border-[#c9a977] rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
            <div className="min-w-0 pr-2 flex-1">
              <div className="font-semibold text-amber-700 dark:text-amber-400 linen:text-[#8c522d] flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>正在编辑消息</span>
                </span>
                {isChatTransEnabled && translationSettings?.autoTranslateOutbound !== false && (
                  <label className="inline-flex items-center gap-1 text-[11px] font-normal text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#5c4a38] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={translateOnEdit}
                      onChange={(e) => setTranslateOnEdit(e.target.checked)}
                      className="rounded border-amber-400 text-[#2481cc] aurora:text-[#14b8a6] linen:text-[#a86a43] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf] linen:focus:ring-[#a86a43]"
                    />
                    <span>重新翻译为外文</span>
                  </label>
                )}
              </div>
              <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6f5d4b] truncate mt-0.5">
                原消息: {editingMessage.text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingMessage(null);
                setTranslateOnEdit(false);
                chatDraftTextCache.delete(draftScopeKey);
                setInputText('');
              }}
              className="p-1 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer shrink-0"
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
            className="fixed z-[9990] w-44 bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#f8f2e7] rounded-2xl shadow-2xl linen:shadow-sm border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#d5c6ae] p-2 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-150 text-xs select-none"
          >
            <button
              type="button"
              onClick={() => {
                imageInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
            >
              <ImageIcon className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
              <span>照片或图片</span>
            </button>
            <button
              type="button"
              onClick={() => {
                videoInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
            >
              <Video className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
              <span>视频消息</span>
            </button>
            <button
              type="button"
              onClick={() => {
                audioInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
            >
              <Music className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
              <span>音频与语音</span>
            </button>
            <button
              type="button"
              onClick={() => {
                fileInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
            >
              <FileText className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
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
          <div className="mb-2.5 p-2.5 bg-[#f0f7ff] dark:bg-[#0e1928] aurora:bg-[#102229] linen:bg-[#f7f0e4] border border-[#2481cc]/40 aurora:border-[#2dd4bf]/40 linen:border-[#a86a43]/40 rounded-xl flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150 shadow-xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-black/10 dark:border-white/10 aurora:border-white/10 linen:border-[#cbbba2] bg-black/5">
                <img
                  src={pastedImage.dataUrl}
                  alt="pasted preview"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>已捕获剪贴板照片</span>
                  <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] font-normal">
                    ({(pastedImage.file.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6f5d4b] truncate mt-0.5">
                  {inputText.trim() ? `配文: ${inputText}` : `可在输入框输入配文，或直接点击发送 (${sendWithEnter ? 'Enter' : 'Ctrl+Enter'})`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => clearPastedImage(true)}
                className="p-1.5 text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] linen:text-[#7a6957] linen:hover:text-[#2b2118] rounded-lg hover:bg-black/5 dark:hover:bg-white/10 aurora:hover:bg-[#152934] linen:hover:bg-[#e5d6be] cursor-pointer"
                title="取消发送此图片 (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleSendPastedImage}
                className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#3a6652] linen:hover:bg-[#2f5544] text-white font-medium text-xs cursor-pointer flex items-center gap-1.5 shadow-xs"
                title={`立即发送照片 (${sendWithEnter ? 'Enter' : 'Ctrl+Enter'})`}
              >
                <Send className="w-3 h-3" />
                <span>发送照片</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Input Container + Bottom Compact Action Row */}
        <div className="@container rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#1e343e] linen:border-[#cbbba2] bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#111d24] linen:bg-[#fdfaf4] focus-within:bg-white dark:focus-within:bg-[#101b2c] aurora:focus-within:bg-[#13222b] linen:focus-within:bg-[#fffdf9] focus-within:border-[#2481cc] dark:focus-within:border-[#2ba0ff] aurora:focus-within:border-[#2dd4bf] linen:focus-within:border-[#a86a43] transition-all">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              editingMessage
                ? '修改消息...'
                : pastedImage
                ? '添加图片说明（可选）...'
                : '输入消息...'
            }
            className={`w-full max-h-36 resize-none bg-transparent text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] ${chatFontClasses.composer} leading-relaxed px-3.5 pt-2.5 pb-1.5 focus:outline-none placeholder-[#94a3b8] dark:placeholder-[#566d85] aurora:placeholder-[#5a7782] linen:placeholder-[#9c8c7a] overflow-y-hidden`}
          />

          <div className="px-2 @[520px]:px-2.5 pb-2 pt-1 flex items-center justify-between gap-1.5 @[520px]:gap-2 border-t border-[#e2e8f0]/60 dark:border-white/5 aurora:border-[#182b34] linen:border-[#e6dac6]">
            {/* Left Tools */}
            <div className="flex items-center flex-nowrap gap-0.5 @[520px]:gap-1 min-w-0 overflow-x-auto no-scrollbar">
              <button
                ref={attachmentButtonRef}
                type="button"
                onClick={() => setIsAttachmentMenuOpen(!isAttachmentMenuOpen)}
                title="附加文件、图片或文档"
                className={`w-7 h-7 @[520px]:w-8 @[520px]:h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  isAttachmentMenuOpen
                    ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2ba0ff]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4] linen:bg-[#eadcc6] linen:text-[#a86a43]'
                    : 'hover:bg-[#e2e8f0]/60 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#eee2cf] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] linen:hover:text-[#a86a43]'
                }`}
              >
                <Paperclip className="w-4 h-4 -rotate-45" />
              </button>

              <button
                ref={emojiButtonRef}
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                title="表情与贴纸"
                className={`w-7 h-7 @[520px]:w-8 @[520px]:h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  showEmojiPicker
                    ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2ba0ff]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4] linen:bg-[#eadcc6] linen:text-[#a86a43]'
                    : 'hover:bg-[#e2e8f0]/60 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#eee2cf] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] linen:hover:text-[#a86a43]'
                }`}
              >
                <Smile className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  if (onOpenVoiceprintConfig) {
                    onOpenVoiceprintConfig();
                  } else {
                    setIsVoiceprintModalOpen(true);
                  }
                }}
                title="真人声纹样本克隆"
                className="w-7 h-7 @[520px]:w-8 @[520px]:h-8 rounded-lg flex items-center justify-center shrink-0 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] linen:hover:text-[#a86a43] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#eee2cf] transition-colors cursor-pointer"
              >
                <AudioWaveform className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleToggleRecordMic}
                title={isRecordingMic ? '点击停止录音并发送' : '点击录制语音消息'}
                className={`h-7 px-1.5 @[520px]:h-8 @[520px]:px-2 rounded-lg flex items-center gap-1 shrink-0 text-xs font-medium transition-colors cursor-pointer ${
                  isRecordingMic
                    ? 'bg-rose-500 text-white animate-pulse'
                    : 'hover:bg-[#e2e8f0]/60 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#eee2cf] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] linen:hover:text-[#a86a43]'
                }`}
              >
                <Volume2 className="w-4 h-4" />
                {isRecordingMic && <span className="tabular-nums">{recordDuration}s</span>}
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
                className={`ml-0.5 @[520px]:ml-1 h-7 inline-flex items-center gap-1 @[520px]:gap-1.5 px-2 @[520px]:px-2.5 rounded-full text-[11.5px] font-medium whitespace-nowrap transition-all cursor-pointer shrink-0 shadow-xs ${
                  isGeneratingAi
                    ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2ba0ff]/20 dark:text-[#2ba0ff] aurora:bg-[#112e37] aurora:text-[#5eead4] linen:bg-[#b87b53] linen:text-white'
                    : aiCooldownSeconds > 0
                    ? 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]/80 dark:bg-[#152438] dark:text-[#7b93ad] dark:hover:bg-[#1b2f48] aurora:bg-[#13252e] aurora:text-[#7e9aa5] aurora:hover:bg-[#18303b] linen:bg-[#c9b399] linen:text-[#5c4836] linen:hover:bg-[#bfa68a]'
                    : 'bg-[#2481cc] hover:bg-[#1d6fb3] text-white dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#935a36] linen:text-white'
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

              <button
                type="button"
                disabled={isSynthesizingVoice}
                onClick={() => void handleDirectVoiceSynthesis()}
                title="使用已保存声纹直接将当前文本合成为语音发送"
                className={`ml-0.5 h-7 inline-flex items-center gap-1 @[520px]:gap-1.5 px-2 @[520px]:px-2.5 rounded-full text-[11.5px] font-medium whitespace-nowrap transition-all cursor-pointer shrink-0 shadow-xs bg-[#0f766e] hover:bg-[#115e59] text-white dark:bg-[#174857] dark:hover:bg-[#1c596b] aurora:bg-[#11434d] aurora:hover:bg-[#165562] linen:bg-[#3a6652] linen:hover:bg-[#2f5544] linen:text-white ${
                  isSynthesizingVoice ? 'opacity-65 pointer-events-none' : ''
                }`}
              >
                <Mic className={`w-3.5 h-3.5 ${isSynthesizingVoice ? 'animate-pulse' : ''}`} />
                <span>{isSynthesizingVoice ? '合成中...' : '音色合成'}</span>
              </button>
            </div>

            {/* Right Actions: Shortcut hint + Send Button */}
            <div className="flex items-center gap-2 @[620px]:gap-2.5 shrink-0">
              <span className="hidden @[620px]:inline whitespace-nowrap text-[11px] text-[#94a3b8] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#84725e] select-none">
                {sendWithEnter ? 'Enter 发送 · Shift+Enter 换行' : 'Ctrl+Enter 发送 · Enter 换行'}
              </span>

              <button
                type="button"
                disabled={isSending || (!inputText.trim() && !pastedImage && !editingMessage)}
                onClick={pastedImage ? handleSendPastedImage : () => void handleSendText()}
                title={
                  editingMessage
                    ? '保存修改'
                    : pastedImage
                    ? `发送照片（${sendWithEnter ? 'Enter 发送 · Shift+Enter 换行' : 'Ctrl+Enter 发送 · Enter 换行'}）`
                    : `发送消息（${sendWithEnter ? 'Enter 发送 · Shift+Enter 换行' : 'Ctrl+Enter 发送 · Enter 换行'}）`
                }
                className={`h-7 @[520px]:h-8 px-3 @[520px]:px-4 rounded-full bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#3a6652] linen:hover:bg-[#2f5544] text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer shadow-xs shrink-0 disabled:opacity-55 disabled:cursor-default`}
              >
                {editingMessage ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                <span>{editingMessage ? '保存' : pastedImage ? '发送照片' : '发送'}</span>
              </button>
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
        onClearHistory={
          onClearHistory
            ? async (targetChatId, options) => {
                const res = await onClearHistory(targetChatId, options);
                if (!res || res.ok !== false) {
                  delete sharedPhotoGalleryCacheRef.current[`${currentAccountId || 'default'}::${targetChatId}`];
                }
                return res;
              }
            : undefined
        }
        onToggleMute={onToggleMuteChat}
        onTogglePin={onTogglePinChat}
        onUpdateTitle={onUpdateChatTitle}
        onChatInfoUpdated={onChatInfoUpdated}
        onAddContact={onAddContact}
        onRemoveContact={onRemoveContact}
        onRefreshMediaUrls={onRefreshMediaUrls}
        onOpenMediaPreview={(targetMsg, allMedia) => {
          openImageGalleryLightbox(targetMsg, allMedia);
        }}
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
        onSelectCommonGroup={(group) => {
          const existing = availableChats.find((c) => c.id === group.id);
          if (existing && onSelectChat) {
            onSelectChat(existing.id);
            return;
          }
          if (onJoinOrOpenChat) {
            onJoinOrOpenChat({
              id: group.id,
              accountId: currentAccountId || chat.accountId,
              title: group.title,
              username: group.username,
              avatarUrl: group.avatarUrl,
              avatarBg: '#2481cc',
              avatarInitial: (group.title || '群').slice(0, 2).toUpperCase(),
              isGroup: !group.isChannel,
              isChannel: Boolean(group.isChannel),
              memberCount: group.memberCount,
              lastMessage: '',
              lastTime: '',
              unreadCount: 0,
              sourceLang: 'Auto',
              targetLang: 'Auto',
            });
            return;
          }
          onSelectChat?.(group.id);
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

      {/* Fallback Standalone MasterVoiceprintModal when onOpenVoiceprintConfig is not provided */}
      <MasterVoiceprintModal
        isOpen={isVoiceprintModalOpen}
        onClose={() => setIsVoiceprintModalOpen(false)}
        onVoiceprintSaved={(vp) => setMasterVoiceprint(vp)}
      />

      {/* Telegram Message Context Menu Popup (Right-Click) */}
      {messageContextMenu && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[9995] bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#d5c6ae] rounded-2xl p-1.5 shadow-2xl linen:shadow-sm min-w-[170px] text-xs select-none animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: `${messageContextMenu.x}px`,
            top: `${messageContextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => handleMessageContextMenu(e, messageContextMenu.message)}
        >
          {/* Quick Reaction Bar in Context Menu */}
          <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#e6dac6]">
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
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
          >
            <Reply className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
            <span>回复消息</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const target = messageContextMenu.message;
              setMessageContextMenu(null);
              handleOpenForwardModal([target]);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
          >
            <Forward className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
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
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
          >
            <CheckSquare className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957]" />
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
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
          >
            <Copy className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957]" />
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
                void triggerManualTranslate(target);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
            >
              <Languages className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
              <span>{messageContextMenu.message.translatedText ? '重新翻译' : '翻译此消息'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onTogglePinMessage?.(messageContextMenu.message.id);
              setMessageContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
          >
            <Pin className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957]" />
            <span>{messageContextMenu.message.isPinned ? '取消置顶' : '置顶消息'}</span>
          </button>

          {chat.isGroup &&
            !chat.isChannel &&
            chat.id.startsWith('tg_') &&
            currentAccountId !== 'acc_telegram_bot' &&
            messageContextMenu.message.sender === 'me' &&
            messageContextMenu.message.deliveryStatus !== 'failed' &&
            messageContextMenu.message.deliveryStatus !== 'pending' &&
            messageContextMenu.message.deliveryStatus !== 'paused' &&
            typeof messageContextMenu.message.telegramMessageId === 'number' && (
            <button
              type="button"
              onClick={() => {
                const target = messageContextMenu.message;
                setMessageContextMenu(null);
                void handleOpenReadReceipts(target);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
            >
              <Eye className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
              <span>查看已读成员</span>
            </button>
          )}

          {messageContextMenu.message.sender === 'me' &&
            !messageContextMenu.message.isAudio &&
            messageContextMenu.message.deliveryStatus !== 'failed' &&
            messageContextMenu.message.deliveryStatus !== 'pending' &&
            messageContextMenu.message.deliveryStatus !== 'paused' &&
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
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#efe4d3] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] cursor-pointer font-medium"
            >
              <Edit2 className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957]" />
              <span>编辑消息</span>
            </button>
          )}

          <div className="my-1 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#e6dac6]" />

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
          !resolveClientTelegramMessageId(messageToDelete) ||
          messageToDelete.deliveryStatus === 'failed' ||
          messageToDelete.deliveryStatus === 'pending' ||
          messageToDelete.deliveryStatus === 'paused';
        const isTgUserChat = chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot';
        const isSupergroupOrChannel = chat.id.startsWith('tg_-100') || Boolean(chat.isChannel);
        const showRevokeOption = !isLocalOnly && isTgUserChat && !isSupergroupOrChannel;
        const showSupergroupHint = !isLocalOnly && isTgUserChat && isSupergroupOrChannel;
        const showPeerGroupHint =
          !isLocalOnly &&
          isTgUserChat &&
          (messageToDelete.sender === 'peer' || messageToDelete.sender === 'system') &&
          (chat.isGroup || chat.isChannel);
        return (
          <div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              backdropPointerDownTargetRef.current = e.target === e.currentTarget ? e.currentTarget : null;
            }}
            onClick={(e) => {
              const shouldClose =
                e.target === e.currentTarget &&
                backdropPointerDownTargetRef.current === e.currentTarget;
              backdropPointerDownTargetRef.current = null;
              if (shouldClose) setMessageToDelete(null);
            }}
            className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] rounded-2xl p-5 max-w-sm w-full shadow-2xl linen:shadow-sm space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-500/10 dark:bg-rose-500/20 text-rose-500 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                    删除此条消息？
                  </h3>
                  <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mt-0.5">
                    {isLocalOnly
                      ? '该消息未送达 Telegram 云端，确认后将仅从本地列表移除。'
                      : messageToDelete.sender === 'me'
                        ? '确定删除您发送的这条消息吗？'
                        : messageToDelete.sender === 'system'
                          ? '确定删除这条入/退群系统提示吗？'
                          : '确定删除客户发送的这条消息吗？'}
                  </p>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#efe6d6] text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] truncate border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae]">
                “{messageToDelete.text || (messageToDelete.isAudio ? '🎤 语音消息' : messageToDelete.isVideo ? '🎬 视频消息' : messageToDelete.isImage ? '🖼️ 图片消息' : '消息内容')}”
              </div>

              {showRevokeOption && (
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#efe6d6] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={revokeSingleDelete}
                    onChange={(e) => setRevokeSingleDelete(e.target.checked)}
                    className="mt-0.5 rounded border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#bfa98c] text-[#2481cc] aurora:text-[#14b8a6] linen:text-[#a86a43] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf] linen:focus:ring-[#a86a43]"
                  />
                  <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] leading-snug">
                    同时为对方删除 / 双向撤回
                  </span>
                </label>
              )}

              {showSupergroupHint && !showPeerGroupHint && (
                <p className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] leading-snug">
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
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e9decb] transition-colors cursor-pointer"
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
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            backdropPointerDownTargetRef.current = e.target === e.currentTarget ? e.currentTarget : null;
          }}
          onClick={(e) => {
            const shouldClose =
              e.target === e.currentTarget &&
              backdropPointerDownTargetRef.current === e.currentTarget;
            backdropPointerDownTargetRef.current = null;
            if (shouldClose && !isBatchDeleting) setShowBatchDeleteModal(false);
          }}
          className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] rounded-2xl p-5 max-w-sm w-full shadow-2xl linen:shadow-sm space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 dark:bg-rose-500/20 text-rose-500 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                  批量删除 {selectedMessageIds.size} 条消息？
                </h3>
                <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mt-0.5">
                  删除操作将同步到 Telegram 云端及本地记录，不可恢复。
                </p>
              </div>
            </div>

            {isTgUserChat && !isSupergroupOrChannel && (
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#efe6d6] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={revokeBatchDelete}
                  onChange={(e) => setRevokeBatchDelete(e.target.checked)}
                  className="mt-0.5 rounded border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#bfa98c] text-[#2481cc] aurora:text-[#14b8a6] linen:text-[#a86a43] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf] linen:focus:ring-[#a86a43]"
                />
                <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] leading-snug">
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
                className="px-4 py-2 rounded-xl text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e9decb] transition-colors cursor-pointer"
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

      {/* Batch Clear Group Join/Leave Notices Modal */}
      {showClearGroupNoticesModal && (() => {
        const isTgUserChat = chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot';
        const isSupergroupOrChannel = chat.id.startsWith('tg_-100') || Boolean(chat.isChannel);
        return (
          <div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              backdropPointerDownTargetRef.current = e.target === e.currentTarget ? e.currentTarget : null;
            }}
            onClick={(e) => {
              const shouldClose =
                e.target === e.currentTarget &&
                backdropPointerDownTargetRef.current === e.currentTarget;
              backdropPointerDownTargetRef.current = null;
              if (shouldClose && !isClearingGroupNotices) setShowClearGroupNoticesModal(false);
            }}
            className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] rounded-2xl p-5 max-w-sm w-full shadow-2xl linen:shadow-sm space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-500/10 dark:bg-rose-500/20 text-rose-500 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                    清理当前群聊 {groupNoticeMessages.length} 条入/退群提示？
                  </h3>
                  <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mt-0.5">
                    将删除所有成员加入、退出或移出群提示，并同步至 Telegram 云端与本地缓存。
                  </p>
                </div>
              </div>

              {isTgUserChat && !isSupergroupOrChannel && (
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#efe6d6] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={revokeBatchDelete}
                    onChange={(e) => setRevokeBatchDelete(e.target.checked)}
                    className="mt-0.5 rounded border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#bfa98c] text-[#2481cc] aurora:text-[#14b8a6] linen:text-[#a86a43] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf] linen:focus:ring-[#a86a43]"
                  />
                  <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] leading-snug">
                    同时为对方删除 / 群内撤回
                  </span>
                </label>
              )}

              {isTgUserChat && isSupergroupOrChannel && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
                  提示：在超级群组/频道中删除入/退群提示将对所有成员生效；若非管理员可能被服务端拒绝。
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isClearingGroupNotices}
                  onClick={() => setShowClearGroupNoticesModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e9decb] transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isClearingGroupNotices}
                  onClick={() => void handleConfirmClearGroupNotices()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isClearingGroupNotices ? '正在清理...' : '确认清理全部'}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Forward Messages Target Picker Modal */}
      {forwardModalMessages && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            backdropPointerDownTargetRef.current = e.target === e.currentTarget ? e.currentTarget : null;
          }}
          onClick={(e) => {
            const shouldClose =
              e.target === e.currentTarget &&
              backdropPointerDownTargetRef.current === e.currentTarget;
            backdropPointerDownTargetRef.current = null;
            if (shouldClose && !isForwarding) setForwardModalMessages(null);
          }}
          className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] rounded-2xl w-full max-w-md shadow-2xl linen:shadow-sm overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="px-4 py-3 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#e6dac6] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Forward className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
                <span className="font-semibold text-sm text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                  转发 {forwardModalMessages.length} 条消息至...
                </span>
              </div>
              <button
                type="button"
                onClick={() => setForwardModalMessages(null)}
                className="p-1 text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-white aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] linen:text-[#6e5c4a] linen:hover:text-[#2b2118] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#e6dac6] space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={forwardSearch}
                  onChange={(e) => setForwardSearch(e.target.value)}
                  placeholder="搜索目标会话、联系人或群组..."
                  autoFocus
                  className="w-full bg-[#f1f5f9] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#efe6d6] pl-8 pr-3 py-1.5 rounded-lg text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
              </div>
              <label className="flex items-center gap-2 text-[11.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forwardDropAuthor}
                  onChange={(e) => setForwardDropAuthor(e.target.checked)}
                  className="rounded border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#bfa98c] text-[#2481cc] aurora:text-[#14b8a6] linen:text-[#a86a43] focus:ring-[#2481cc] aurora:focus:ring-[#2dd4bf] linen:focus:ring-[#a86a43]"
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
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#f0f7ff] dark:hover:bg-[#132234] aurora:hover:bg-[#112d36] linen:hover:bg-[#efe4d3] transition-colors text-left cursor-pointer disabled:opacity-50"
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
                      <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] truncate">
                        {targetChat.title}
                      </div>
                      <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] truncate">
                        {targetChat.username || (targetChat.isGroup ? '群组' : targetChat.isChannel ? '频道' : '私聊对话')}
                      </div>
                    </div>
                    <Forward className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43] shrink-0" />
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
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
            onMouseDown={(e) => {
              backdropPointerDownTargetRef.current = e.target === e.currentTarget ? e.currentTarget : null;
            }}
            onClick={(e) => {
              const shouldClose =
                e.target === e.currentTarget &&
                backdropPointerDownTargetRef.current === e.currentTarget;
              backdropPointerDownTargetRef.current = null;
              if (shouldClose && !inviteModalState.joining) setInviteModalState(null);
            }}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1f3b44] linen:border-[#d5c6ae] bg-white dark:bg-[#0f172a] aurora:bg-[#0d1c22] linen:bg-[#f8f2e7] shadow-2xl linen:shadow-sm overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1c353d] linen:border-[#e6dac6]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                  {inviteModalState.preview?.isChannel ? (
                    <Megaphone className="w-4 h-4 text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4] linen:text-[#a86a43]" />
                  ) : (
                    <Users className="w-4 h-4 text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4] linen:text-[#a86a43]" />
                  )}
                  <span>{inviteModalState.preview?.isChannel ? '频道邀请' : '群组邀请'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => !inviteModalState.joining && setInviteModalState(null)}
                  className="p-1 rounded-lg text-[#64748b] dark:text-[#94a3b8] linen:text-[#6e5c4a] hover:bg-black/5 dark:hover:bg-white/10 linen:hover:bg-[#e9decb] transition-colors cursor-pointer"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5">
                {inviteModalState.loading ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2.5 text-[#64748b] dark:text-[#94a3b8] aurora:text-[#8eb2bd] linen:text-[#6e5c4a]">
                    <RotateCw className="w-6 h-6 animate-spin text-[#2481cc] dark:text-[#38bdf8] aurora:text-[#5eead4] linen:text-[#a86a43]" />
                    <span className="text-xs">正在读取 Telegram 群组/频道信息...</span>
                  </div>
                ) : inviteModalState.error && !inviteModalState.preview ? (
                  <div className="py-4 flex flex-col items-center text-center gap-2.5">
                    <ShieldAlert className="w-8 h-8 text-rose-500" />
                    <p className="text-xs leading-relaxed text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8] linen:text-[#4e3f32]">
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
                    <h3 className="text-base font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] break-words">
                      {inviteModalState.preview?.title || 'Telegram 群组'}
                    </h3>
                    <div className="mt-1 text-xs text-[#64748b] dark:text-[#94a3b8] aurora:text-[#8eb2bd] linen:text-[#6e5c4a]">
                      {inviteModalState.preview?.isChannel ? '频道' : '群组'}
                      {typeof inviteModalState.preview?.participantsCount === 'number'
                        ? ` · ${inviteModalState.preview.participantsCount.toLocaleString()} 位成员`
                        : ''}
                    </div>
                    {inviteModalState.preview?.about && (
                      <p className="mt-3 text-xs leading-relaxed text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8] linen:text-[#4e3f32] bg-[#f8fafc] dark:bg-[#132234] aurora:bg-[#10262d] linen:bg-[#efe6d6] px-3 py-2 rounded-xl w-full text-left whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
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
                    className="px-3.5 py-2 rounded-xl text-xs font-medium text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8] linen:text-[#6e5c4a] hover:bg-black/5 dark:hover:bg-white/10 linen:hover:bg-[#e9decb] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {inviteModalState.preview?.requestSent ? '关闭' : '取消'}
                  </button>
                  {!inviteModalState.loading && inviteModalState.preview && !inviteModalState.preview.requestSent && (
                    <button
                      type="button"
                      disabled={inviteModalState.joining}
                      onClick={() => void handleConfirmJoinInvite()}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#2481cc] hover:bg-[#1e6eb0] dark:bg-[#0284c7] dark:hover:bg-[#0369a1] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
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
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[75] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
            onMouseDown={(e) => {
              backdropPointerDownTargetRef.current = e.target === e.currentTarget ? e.currentTarget : null;
            }}
            onClick={(e) => {
              const shouldClose =
                e.target === e.currentTarget &&
                backdropPointerDownTargetRef.current === e.currentTarget;
              backdropPointerDownTargetRef.current = null;
              if (shouldClose) setMemberProfileModal(null);
            }}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#0e1726] aurora:bg-[#0d181e] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1d343d] linen:border-[#d5c6ae] shadow-2xl linen:shadow-sm overflow-hidden text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#e6dac6] flex items-center justify-between">
                <span className="text-xs font-semibold">成员个人资料</span>
                <button
                  type="button"
                  onClick={() => setMemberProfileModal(null)}
                  className="p-1 rounded-lg hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e9decb] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] cursor-pointer"
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
                        <span className="px-1.5 py-0.5 rounded bg-[#2481cc]/15 linen:bg-[#a86a43]/15 text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] text-[10px] font-medium shrink-0">
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
                          : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]'
                      }`}
                    >
                      {memberProfileModal.loading
                        ? '正在拉取最新云端资料...'
                        : memberProfileModal.info?.statusText || memberProfileModal.statusText || 'Telegram 成员'}
                    </div>
                  </div>
                </div>

                {memberProfileModal.loading && (
                  <div className="flex items-center gap-2 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43]" />
                    <span>正在读取用户名、简介与联系人状态...</span>
                  </div>
                )}

                {memberProfileModal.error && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-700 dark:text-amber-300">
                    {memberProfileModal.error}
                  </div>
                )}

                {/* Metadata Rows */}
                <div className="rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#efe6d6] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] divide-y divide-[#e2e8f0] dark:divide-[#18273a] aurora:divide-[#182b34] linen:divide-[#dfd2bc] text-xs">
                  {(memberProfileModal.info?.username || memberProfileModal.username) && (
                    <div className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] min-w-0">
                        <AtSign className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
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
                        className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] hover:underline shrink-0 cursor-pointer"
                      >
                        {copiedId === `member_un_${memberProfileModal.targetChatId}` ? '已复制' : '复制'}
                      </button>
                    </div>
                  )}

                  {memberProfileModal.info?.phone && (
                    <div className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] min-w-0">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">{memberProfileModal.info.phone}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(memberProfileModal.info?.phone || '');
                          setCopiedId(`member_ph_${memberProfileModal.targetChatId}`);
                          setTimeout(() => setCopiedId((c) => (c === `member_ph_${memberProfileModal.targetChatId}` ? null : c)), 1500);
                        }}
                        className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] hover:underline shrink-0 cursor-pointer"
                      >
                        {copiedId === `member_ph_${memberProfileModal.targetChatId}` ? '已复制' : '复制'}
                      </button>
                    </div>
                  )}

                  <div className="px-3 py-2 flex items-center justify-between gap-2 text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0">ID</span>
                      <span className="font-mono truncate select-all text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
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
                      className="text-[11px] text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] hover:underline shrink-0 cursor-pointer"
                    >
                      {copiedId === `member_id_${memberProfileModal.targetChatId}` ? '已复制' : '复制'}
                    </button>
                  </div>

                  {memberProfileModal.info?.description && (
                    <div className="px-3 py-2 text-[11.5px] leading-relaxed text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] whitespace-pre-wrap break-words">
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
                          className="flex-1 min-w-[110px] py-2 px-3 rounded-xl bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
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
                          className="py-2 px-3 rounded-xl bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#192c44] aurora:bg-[#13252e] aurora:hover:bg-[#19333e] linen:bg-[#efe6d6] linen:hover:bg-[#e6d9c4] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          <UserPlus className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#a86a43]" />
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

      {/* Group Message Read Receipts Modal */}
      {readReceiptsModal &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[75] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
            onMouseDown={(e) => {
              backdropPointerDownTargetRef.current = e.target === e.currentTarget ? e.currentTarget : null;
            }}
            onClick={(e) => {
              const shouldClose =
                e.target === e.currentTarget &&
                backdropPointerDownTargetRef.current === e.currentTarget;
              backdropPointerDownTargetRef.current = null;
              if (shouldClose) setReadReceiptsModal(null);
            }}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#0e1726] aurora:bg-[#0d181e] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1d343d] linen:border-[#d5c6ae] shadow-2xl linen:shadow-sm overflow-hidden text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#e6dac6] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCheck className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43] shrink-0" />
                  <span className="text-xs font-semibold truncate">
                    {readReceiptsModal.loading
                      ? '消息已读成员'
                      : `已读成员 (${readReceiptsModal.participants.length})`}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={readReceiptsModal.loading}
                    onClick={() => void handleOpenReadReceipts(readReceiptsModal.message)}
                    title="刷新已读状态"
                    className="p-1 rounded-lg hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e9decb] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] disabled:opacity-40 cursor-pointer"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${readReceiptsModal.loading ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setReadReceiptsModal(null)}
                    className="p-1 rounded-lg hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e9decb] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Message Preview Snippet */}
              <div className="px-4 pt-3 pb-1">
                <div className="px-2.5 py-1.5 rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#efe6d6] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] truncate">
                  {readReceiptsModal.message.text?.trim() ||
                    (readReceiptsModal.message.isImage
                      ? '🖼️ 图片消息'
                      : readReceiptsModal.message.isVideo
                      ? '🎬 视频消息'
                      : readReceiptsModal.message.isAudio
                      ? '🎤 语音消息'
                      : '我发出的消息')}
                </div>
              </div>

              {/* Body */}
              <div className="p-4 pt-2 max-h-[55vh] overflow-y-auto space-y-2">
                {readReceiptsModal.loading ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    <Loader2 className="w-5 h-5 animate-spin text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]" />
                    <span>正在查询云端已读成员...</span>
                  </div>
                ) : readReceiptsModal.error ? (
                  <div className="py-6 text-center space-y-2">
                    <p className="text-xs text-rose-600 dark:text-rose-400">{readReceiptsModal.error}</p>
                    <button
                      type="button"
                      onClick={() => void handleOpenReadReceipts(readReceiptsModal.message)}
                      className="px-3 py-1.5 rounded-lg bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#efe6d6] text-xs font-medium cursor-pointer hover:opacity-85"
                    >
                      重试
                    </button>
                  </div>
                ) : readReceiptsModal.participants.length === 0 ? (
                  <div className="py-6 text-center space-y-1.5">
                    <p className="text-xs font-medium text-[#475569] dark:text-[#cbd5e1] aurora:text-[#b7d0d8] linen:text-[#4e3f32]">
                      暂无已读记录
                    </p>
                    <p className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] leading-relaxed">
                      {readReceiptsModal.hint || '成员可能尚未查看此消息，或群规模超过约 100 人 / 消息已超过 7 天（Telegram 官方不返回明细）。'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#f1f5f9] dark:divide-[#152336] aurora:divide-[#162933] linen:divide-[#e6dac6]">
                    {readReceiptsModal.participants.map((reader) => {
                      const safeAvatar = reader.avatarUrl ? resolveDisplayUrl(reader.avatarUrl) || '' : '';
                      const readTimeText = reader.readAt
                        ? (() => {
                            const d = new Date(reader.readAt * 1000);
                            const now = new Date();
                            const isToday =
                              d.getFullYear() === now.getFullYear() &&
                              d.getMonth() === now.getMonth() &&
                              d.getDate() === now.getDate();
                            const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                            return isToday ? `今天 ${hm}` : `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
                          })()
                        : '已读';
                      return (
                        <div key={reader.id} className="py-2 flex items-center gap-2.5">
                          <div className="relative w-8 h-8 rounded-full bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#14b8a6] linen:bg-[#a86a43] flex items-center justify-center text-white text-xs font-semibold shrink-0 overflow-hidden">
                            {safeAvatar ? (
                              <img
                                src={safeAvatar}
                                alt={reader.name}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  const imgEl = e.currentTarget;
                                  if (reader.avatarUrl) {
                                    void triggerSilentUrlRefresh(reader.avatarUrl, true).then((nextUrl) => {
                                      if (!nextUrl) {
                                        imgEl.style.display = 'none';
                                      }
                                    });
                                  } else {
                                    imgEl.style.display = 'none';
                                  }
                                }}
                              />
                            ) : (
                              <span>{getSenderAvatarInitial(reader.name, reader.id)}</span>
                            )}
                            {reader.isOnline && (
                              <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white dark:ring-[#0e1726] linen:ring-[#f8f2e7]" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{reader.name}</div>
                            {reader.username && (
                              <div className="text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate">
                                {reader.username}
                              </div>
                            )}
                          </div>
                          <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] shrink-0 tabular-nums">
                            {readTimeText}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Fullscreen Image & Video Lightbox Preview Modal */}
      {lightboxMedia && (() => {
        const effectiveLightboxUrl =
          (lightboxMedia.rawUrl ? resolveDisplayUrl(lightboxMedia.rawUrl) : undefined) ||
          lightboxMedia.url;
        return createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-xs flex flex-col items-center justify-center p-4 sm:p-8 select-none animate-in fade-in duration-150"
            onMouseDown={(e) => {
              backdropPointerDownTargetRef.current = e.target === e.currentTarget ? e.currentTarget : null;
            }}
            onClick={(e) => {
              const shouldClose =
                e.target === e.currentTarget &&
                backdropPointerDownTargetRef.current === e.currentTarget;
              backdropPointerDownTargetRef.current = null;
              if (shouldClose) setLightboxMedia(null);
            }}
          >
            {/* Top Bar Actions */}
            <div
              className="w-full max-w-6xl flex items-center justify-between gap-3 mb-3 text-white shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 min-w-0">
                {lightboxMedia.gallery && lightboxMedia.gallery.length > 1 && (
                  <span className="px-2 py-0.5 rounded-md bg-white/15 text-[11px] font-medium tabular-nums shrink-0">
                    {(lightboxMedia.galleryIndex ?? 0) + 1} / {lightboxMedia.gallery.length}
                  </span>
                )}
                <span className="text-xs text-white/80 truncate">
                  {lightboxMedia.caption || (lightboxMedia.type === 'video' ? '视频全屏预览' : '图片全屏预览')}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lightboxMedia.message && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = lightboxMedia.message;
                      setLightboxMedia(null);
                      if (target) {
                        setChatInfoOpen(false);
                        handleJumpToMessage(target);
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="定位到聊天中的该消息"
                  >
                    <Reply className="w-3.5 h-3.5" />
                    <span>定位消息</span>
                  </button>
                )}
                {lightboxMedia.type === 'image' && (
                  <button
                    type="button"
                    onClick={() => copyImageToClipboard(effectiveLightboxUrl, lightboxMedia.msgId)}
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
                {(() => {
                  const safeDownloadName =
                    lightboxMedia.type === 'video'
                      ? `tg_video_${Date.now()}.mp4`
                      : buildSafeMediaDownloadName(lightboxMedia.caption, 'tg_photo', 'png');
                  return (
                    <a
                      href={effectiveLightboxUrl}
                      download={safeDownloadName}
                      onClick={(e) => {
                        if (lightboxMedia.rawUrl && isSignedResourceUrlExpiringSoon(effectiveLightboxUrl)) {
                          e.preventDefault();
                          void triggerSilentUrlRefresh(lightboxMedia.rawUrl, true).then((nextUrl) => {
                            const downloadHref = sanitizeSafeResourceUrl(nextUrl) || effectiveLightboxUrl;
                            if (!downloadHref) return;
                            const a = document.createElement('a');
                            a.href = downloadHref;
                            a.download = safeDownloadName;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          });
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                      title="保存原文件"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>保存</span>
                    </a>
                  );
                })()}
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
              className="relative flex-1 w-full flex items-center justify-center min-h-0"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setLightboxMedia(null);
                } else {
                  e.stopPropagation();
                }
              }}
            >
              {lightboxMedia.gallery && lightboxMedia.gallery.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateLightboxGallery(-1);
                    }}
                    title="上一张 (←)"
                    aria-label="上一张图片"
                    className="absolute left-2 sm:left-4 z-10 p-2.5 rounded-full bg-black/55 hover:bg-black/80 text-white border border-white/15 cursor-pointer transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateLightboxGallery(1);
                    }}
                    title="下一张 (→)"
                    aria-label="下一张图片"
                    className="absolute right-2 sm:right-4 z-10 p-2.5 rounded-full bg-black/55 hover:bg-black/80 text-white border border-white/15 cursor-pointer transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
              {lightboxMedia.type === 'image' ? (
                <img
                  src={effectiveLightboxUrl}
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
                  src={effectiveLightboxUrl}
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
        );
      })()}
    </div>
  );
};

export const ChatArea: React.FC<ChatAreaProps> = React.memo((props) => {
  if (!props.chat) {
    return (
      <div className="hidden lg:flex flex-1 min-w-0 bg-[#f4f7fb] dark:bg-[#060b12] aurora:bg-[#081116] linen:bg-[#ddd2bc] tg-chat-pattern flex-col items-center justify-center select-none text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6f5d4b] transition-colors px-6">
        <div className="flex flex-col items-center text-center max-w-xs space-y-2.5 px-6 py-5 rounded-2xl bg-white/80 dark:bg-[#0a1320]/80 aurora:bg-[#0e1b23]/82 linen:bg-[#f7f1e5]/92 backdrop-blur-md border border-[#e2e8f0] dark:border-[#162436] aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2] shadow-xs aurora:shadow-[0_0_28px_rgba(34,211,238,0.12)]">
          <div className="w-10 h-10 rounded-xl bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] linen:bg-[#efe2ce] border border-[#bfdbfe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/35 linen:border-[#d4bc9c] flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#a86a43]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-[13px] font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
            选择左侧会话开始协同
          </div>
          <p className="text-[11.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#86a4b0] linen:text-[#72604e] leading-relaxed">
            可随时点击最左侧导航栏弹出独立的记忆、大模型、翻译、音色与人设配置页。
          </p>
        </div>
      </div>
    );
  }
  return <ChatAreaActive {...props} chat={props.chat} />;
});

