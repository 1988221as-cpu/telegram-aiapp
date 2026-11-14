import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Phone,
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
  Forward,
  CheckSquare,
  Square,
  History,
  ChevronUp,
} from 'lucide-react';
import { Chat, Message, TranslationSettings, MasterVoiceprint, TelegramStickerItem, TelegramContact } from '../types';
import { VoiceCloneStudioModal } from './VoiceCloneStudioModal';
import { TelegramEmojiPicker } from './TelegramEmojiPicker';
import { TelegramChatInfoDrawer } from './TelegramChatInfoDrawer';
import type { RightPanelTab } from './UnifiedRightDock';
import { getMasterVoiceprint } from '../services/voiceprintStorage';
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
} from '../services/apiService';

function formatMediaSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
}

export function getLanguageDisplayName(code: string): string {
  if (!code) return '英语';
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
    .replace(/\bwww\.\S+/gi, ' ')
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
  if (
    /\b(goedemorgen|goedemiddag|goedenavond|hoe gaat|hoe is het|met jou|dank je|dank u|alsjeblieft|alstublieft|tot ziens|welkom|graag|vandaag|nederlands|ik ben|ik wil|jij bent|het is)\b/i.test(stripped)
  ) {
    return 'nl';
  }
  if (
    /ß/.test(stripped) ||
    (/\b(guten tag|guten morgen|danke|bitte|wie geht|hallo|tschüss|tschuess|auf wiedersehen|ich bin|nicht|sehr gut)\b/i.test(stripped) &&
      !/\b(goedemorgen|goedemiddag|goedenavond|hoe gaat|hoe is het|met jou|dank je|dank u|alsjeblieft|alstublieft|tot ziens|welkom|graag|vandaag|nederlands|ik ben|ik wil|jij bent|het is)\b/i.test(stripped))
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
    .replace(/\bwww\.\S+/gi, ' ')
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
    const peerMessages = recentMessages.filter((m) => m.sender === 'peer');
    const lastPeerMsg = peerMessages[peerMessages.length - 1];
    if (lastPeerMsg?.text) {
      const code = detectClientLangCode(lastPeerMsg.text);
      if (code) return DETECTED_CODE_TO_LANGUAGE_NAME[code] || code;
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

interface ChatAreaProps {
  chat: Chat | null;
  messages: Message[];
  translationSettings: TranslationSettings;
  onSendMessage: (message: Partial<Message> & { skipCloudRelay?: boolean; mediaFile?: File | Blob }) => void;
  onUpdateChatLanguage?: (chatId: string, sourceLang: string, targetLang: string) => void;
  onOpenTranslation?: () => void;
  customLLMConfig?: any;
  currentAccountId?: string;
  availableChats?: Chat[];
  hasMoreHistory?: boolean;
  onLoadOlderMessages?: (chatId: string, offsetId: number) => Promise<{ ok: boolean; count: number; hasMore: boolean; error?: string }>;
  onMessagesSynced?: (synced: Message[], meta?: { hasMore?: boolean; readOutboxMaxId?: number; fromLocalFallback?: boolean }) => void;
  onOpenKnowledgeEvolution?: () => void;
  onDeleteMessage?: (messageId: string, options?: { revoke?: boolean }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onBatchDeleteMessages?: (messageIds: string[], options?: { revoke?: boolean }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onForwardMessages?: (payload: { messageIds: string[]; telegramMessageIds: number[]; toChatId: string; dropAuthor?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  onEditMessage?: (messageId: string, newText: string, options?: { translatedText?: string }) => void | Promise<{ ok: boolean; error?: string } | void>;
  onUpdateMessage?: (messageId: string, patch: Partial<Message>) => void;
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
  onCloseChat?: () => void;
  onOpenVoiceCall?: () => void;
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

function buildReplyPayload(replyMsg: Message, chatTitle?: string) {
  return {
    id: replyMsg.id,
    telegramMessageId: replyMsg.telegramMessageId,
    senderName: replyMsg.sender === 'me' ? '我' : (chatTitle || '对方'),
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
  onOpenTranslation,
  customLLMConfig,
  currentAccountId,
  availableChats = [],
  hasMoreHistory = false,
  onLoadOlderMessages,
  onMessagesSynced,
  onOpenKnowledgeEvolution,
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
  onCloseChat,
  onOpenVoiceCall,
  onOpenCustomLLM,
  activeRightPanel,
  isChatInfoOpenExternal,
  onChatInfoOpenChange,
  sendWithEnter = true,
  onRefreshMediaUrls,
}) => {
  const [inputText, setInputText] = useState('');
  const [translatedPreview, setTranslatedPreview] = useState('');
  const [translatedPreviewSource, setTranslatedPreviewSource] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewRetryNonce, setPreviewRetryNonce] = useState(0);
  const [isTranslatingPreview, setIsTranslatingPreview] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const [showOriginalMsgIds, setShowOriginalMsgIds] = useState<Set<string>>(new Set());
  const [isTranslateBarVisible, setIsTranslateBarVisible] = useState(true);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [langMenuSearch, setLangMenuSearch] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<Record<string, number>>({});
  const [transcribingMap, setTranscribingMap] = useState<Record<string, boolean>>({});
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const recordDurationRef = useRef<number>(0);
  const [retryingMsgIds, setRetryingMsgIds] = useState<Set<string>>(new Set());
  const [isVoiceStudioOpen, setIsVoiceStudioOpen] = useState(false);
  const [masterVoiceprint, setMasterVoiceprint] = useState<MasterVoiceprint | null>(null);
  const [activePersonaName, setActivePersonaName] = useState<string>('默认人设');

  useEffect(() => {
    let mounted = true;
    fetchGlobalPersonaApi()
      .then((res) => {
        if (mounted && res?.success && res.persona?.personaName) {
          setActivePersonaName(res.persona.personaName);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

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
  const [isSending, setIsSending] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiSuggestionTranslation, setAiSuggestionTranslation] = useState<string | null>(null);
  const [isTranslatingSuggestion, setIsTranslatingSuggestion] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const syncNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const suppressAutoScrollRef = useRef(false);
  const prevChatIdForScrollRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);
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
          const refreshed = await ensureFreshSignedResourceUrl(currentResolved, currentAccountId, { force: true });
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
        });
        setSyncNotice(`云端同步成功！已拉取 ${res.messages.length} 条真实聊天记录`);
      } else if (!res.ok) {
        setSyncNotice(res.error || '云端历史同步失败，请检查账号连接');
      } else {
        onMessagesSynced?.([], {
          hasMore: false,
          readOutboxMaxId: res.readOutboxMaxId,
          fromLocalFallback: res.fromLocalFallback,
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
    if (!chat) return;
    setIsGeneratingAi(true);
    setAiSuggestion(null);
    setAiSuggestionTranslation(null);
    setSyncNotice(null);
    try {
      const res = await sendAutonomousChat(
        messages.slice(-30).map((m) => {
          const resolvedText = (m.text || m.sttText || m.imageCaption || '').trim();
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
        setAiSuggestion(res.replyText);
        if (res.cnTranslation) {
          setAiSuggestionTranslation(res.cnTranslation);
        } else if (outboundTargetLang && outboundTargetLang !== 'Chinese' && outboundTargetLang !== 'zh-CN') {
          setIsTranslatingSuggestion(true);
          try {
            const cn = await translateText(
              res.replyText,
              'Auto',
              'Chinese',
              customLLMConfig,
              translationSettings?.preferredEngine || 'gemini',
              undefined,
              translationSettings?.geminiModel,
              translationSettings?.geminiApiKey,
              translationSettings?.customModelName
            );
            setAiSuggestionTranslation(cn || null);
          } catch (transErr: any) {
            setAiSuggestionTranslation(null);
            showSyncNotice(`参考译文失败：${transErr?.message || '请检查翻译通道配置'}`, 5000);
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
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setIsLangMenuOpen(false);
      }
    };
    if (isLangMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isLangMenuOpen]);

  // Telegram Desktop Esc key handler to close overlays or active chat
  useEffect(() => {
    if (!chat) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
    isLangMenuOpen,
    isSearchingInChat,
    isChatInfoOpen,
    activeRightPanel,
    aiSuggestion,
    translatedPreview,
    messageContextMenu,
    messageToDelete,
    onCloseChat,
  ]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    if (syncNoticeTimerRef.current) {
      clearTimeout(syncNoticeTimerRef.current);
      syncNoticeTimerRef.current = null;
    }
    setSyncNotice(null);
  }, [chat?.id]);

  // Real-time input translation preview (debounced, abortable, same-language skip)
  useEffect(() => {
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
      previewAbortRef.current = null;
    }

    const queryText = inputText.trim();
    if (!queryText || !hasTranslatableLetters(queryText) || translationSettings?.autoTranslateOutbound === false || (editingMessage && !translateOnEdit)) {
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
          translationSettings?.preferredEngine,
          undefined,
          translationSettings?.geminiModel,
          translationSettings?.geminiApiKey,
          translationSettings?.customModelName,
          { signal: controller.signal }
        );
        if (isCurrent && !controller.signal.aborted) {
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
        setPreviewError(err?.message || '请求失败');
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
    translationSettings,
    customLLMConfig,
    editingMessage,
    translateOnEdit,
    previewRetryNonce,
  ]);

  // Send message
  const handleSendText = async (bypassTranslation = false) => {
    if (isSending) return;
    const textToSend = inputText.trim();
    if (!textToSend || !chat) return;

    setIsSending(true);
    try {
      const shouldAutoTranslate =
        !bypassTranslation &&
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
            showSyncNotice('翻译预览失败，可点击输入框上方「重试」或「直接发送原文」', 5000);
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
                translationSettings?.preferredEngine,
                undefined,
                translationSettings?.geminiModel,
                translationSettings?.geminiApiKey,
                translationSettings?.customModelName
              );
            } catch (err: any) {
              const errMsg = err?.message || '请求失败';
              setPreviewError(errMsg);
              setTranslatedPreview('');
              setTranslatedPreviewSource(textToSend);
              showSyncNotice(`翻译失败（可点击「直接发送原文」）：${errMsg}`, 5000);
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
                translationSettings?.preferredEngine,
                undefined,
                translationSettings?.geminiModel,
                translationSettings?.geminiApiKey,
                translationSettings?.customModelName
              );
            } catch (err: any) {
              translationOfTarget = '';
              showSyncNotice(`对照翻译失败: ${err?.message || '请检查翻译通道配置'}`, 4000);
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
          showSyncNotice(`云端编辑失败：${editRes.error || '请检查 Telegram 在线状态'}`);
          return;
        }
        setEditingMessage(null);
        setTranslateOnEdit(false);
        setInputText('');
        setTranslatedPreview('');
        setTranslatedPreviewSource('');
        setPreviewError('');
        return;
      }

      onSendMessage({
        sender: 'me',
        text: targetText,
        translatedText: translationOfTarget,
        replyTo: replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      });

      setReplyingTo(null);
      setInputText('');
      setTranslatedPreview('');
      setTranslatedPreviewSource('');
      setPreviewError('');
    } finally {
      setIsSending(false);
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > TELEGRAM_MAX_MEDIA) {
        const maxMb = Math.round(TELEGRAM_MAX_MEDIA / (1024 * 1024));
        showSyncNotice(`图片超过最大发送限制 (${maxMb} MB)`);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      const userCaption = inputText.trim();
      onSendMessage({
        sender: 'me',
        isImage: true,
        imageUrl: previewUrl,
        imageCaption: userCaption || undefined,
        text: userCaption || '',
        mediaFile: file,
        replyTo: replyingTo ? buildReplyPayload(replyingTo, chat?.title) : undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      });
      if (replyingTo) setReplyingTo(null);
      if (userCaption) {
        setInputText('');
        setTranslatedPreview('');
        setTranslatedPreviewSource('');
      }
    } catch (err: any) {
      console.warn('Failed to upload image', err);
      showSyncNotice(`图片读取失败：${err?.message || '请检查图片文件是否损坏或有读取权限'}`);
    } finally {
      setIsAttachmentMenuOpen(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
        sender: 'me',
        isVideo: true,
        videoUrl: previewUrl,
        videoDuration: duration,
        text: userCaption || `[视频] ${file.name}`,
        mediaFile: file,
        replyTo: replyingTo ? buildReplyPayload(replyingTo, chat?.title) : undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      });
      if (replyingTo) setReplyingTo(null);
      if (userCaption) {
        setInputText('');
        setTranslatedPreview('');
        setTranslatedPreviewSource('');
      }
    } catch (err: any) {
      console.warn('Failed to upload video', err);
      showSyncNotice(`视频读取失败：${err?.message || '请检查视频文件是否损坏或有读取权限'}`);
    } finally {
      setIsAttachmentMenuOpen(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleAudioSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
          tempAudio.onloadedmetadata = () => {
            duration = Math.round(tempAudio.duration) || 0;
            resolve(null);
          };
          tempAudio.onerror = () => resolve(null);
          setTimeout(resolve, 800);
        });
      } catch {}

      onSendMessage({
        sender: 'me',
        isAudio: true,
        audioUrl: previewUrl,
        audioDuration: duration || 5,
        text: '🎤 语音消息',
        mediaFile: file,
        replyTo: replyingTo ? buildReplyPayload(replyingTo, chat?.title) : undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      });
      if (replyingTo) setReplyingTo(null);
    } catch (err: any) {
      console.warn('Failed to upload audio', err);
      showSyncNotice(`音频读取失败：${err?.message || '请检查音频文件是否损坏或有读取权限'}`);
    } finally {
      setIsAttachmentMenuOpen(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
      const replyPayload = replyingTo ? buildReplyPayload(replyingTo, chat?.title) : undefined;

      if (isImg) {
        const userCaption = inputText.trim();
        onSendMessage({
          sender: 'me',
          isImage: true,
          imageUrl: previewUrl,
          imageCaption: userCaption || undefined,
          text: userCaption || '',
          mediaFile: file,
          replyTo: replyPayload,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        });
        if (userCaption) {
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
          sender: 'me',
          isVideo: true,
          videoUrl: previewUrl,
          videoDuration: duration,
          text: userCaption || `[视频] ${file.name}`,
          mediaFile: file,
          replyTo: replyPayload,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        });
        if (userCaption) {
          setInputText('');
          setTranslatedPreview('');
          setTranslatedPreviewSource('');
        }
      } else if (isAud) {
        let duration = 0;
        try {
          const tempAudio = new Audio(previewUrl);
          await new Promise((resolve) => {
            tempAudio.onloadedmetadata = () => {
              duration = Math.round(tempAudio.duration) || 0;
              resolve(null);
            };
            tempAudio.onerror = () => resolve(null);
            setTimeout(resolve, 800);
          });
        } catch {}
        onSendMessage({
          sender: 'me',
          isAudio: true,
          audioUrl: previewUrl,
          audioDuration: duration || 5,
          text: '🎤 语音消息',
          mediaFile: file,
          replyTo: replyPayload,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        });
      } else {
        onSendMessage({
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
      if (replyingTo) setReplyingTo(null);
    } catch (err: any) {
      console.warn('Failed to upload file', err);
      showSyncNotice(`文件读取失败：${err?.message || '请检查文件是否损坏或有读取权限'}`);
    } finally {
      setIsAttachmentMenuOpen(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSendSticker = async (sticker: TelegramStickerItem, packTitle?: string) => {
    if (!chat) return;
    if (!chat.id.startsWith('tg_') || currentAccountId === 'acc_telegram_bot') {
      showSyncNotice('仅已连接的 Telegram 个人账号支持发送官方云端贴纸');
      return;
    }
    setShowEmojiPicker(false);
    const replyToMsgId = replyingTo?.telegramMessageId;
    const replyPayload = replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined;
    const res = await sendTelegramStickerApi({
      accountId: currentAccountId,
      chatId: chat.id,
      sticker,
      packTitle,
      replyToMsgId,
      replyTo: replyPayload,
    });
    if (!res.ok) {
      showSyncNotice(res.error || '发送官方贴纸失败');
      return;
    }
    if (replyingTo) {
      setReplyingTo(null);
    }
    const isVideoSticker = Boolean(res.videoUrl || res.isVideo || sticker.isVideo);
    const fallbackText = res.text || `${sticker.emoji} [贴纸]`;
    onSendMessage({
      ...(res.id ? { id: res.id } : {}),
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    let effectiveImageUrl = resolveDisplayUrl(imageUrl) || imageUrl;
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
    const userCaption = inputText.trim() || pastedImage.caption || '';
    onSendMessage({
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

    setTranscribingMap((prev) => ({ ...prev, [msg.id]: true }));

    try {
      let transcribed = msg.sttText;
      if (!transcribed && msg.audioUrl) {
        transcribed = await transcribeAudio(msg.audioUrl, 'audio/webm', customLLMConfig);
      }

      if (!transcribed || !transcribed.trim()) {
        setSyncNotice('语音转写未能识别出文字内容');
        setTimeout(() => setSyncNotice(null), 3000);
        return;
      }

      const currentInboundTarget = getInboundTargetLanguage(chat, translationSettings);
      const translated = await translateText(
        transcribed,
        'Auto',
        currentInboundTarget,
        customLLMConfig,
        translationSettings?.preferredEngine,
        undefined,
        translationSettings?.geminiModel,
        translationSettings?.geminiApiKey,
        translationSettings?.customModelName
      );

      if (onUpdateMessage) {
        onUpdateMessage(msg.id, {
          sttText: transcribed,
          translatedText: translated,
        });
      } else {
        msg.sttText = transcribed;
        msg.translatedText = translated;
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
      audioRef.current?.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingAudioId(null);
      return;
    }

    if (audioUrl) {
      let effectiveUrl = resolveDisplayUrl(audioUrl) || audioUrl;
      if (isSignedResourceUrlExpiringSoon(effectiveUrl)) {
        const fresh = await triggerSilentUrlRefresh(effectiveUrl, true);
        if (fresh) {
          effectiveUrl = fresh;
          onUpdateMessage?.(msgId, { audioUrl: fresh });
        }
      }
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      let retriedWithFreshUrl = false;
      audioRef.current.src = effectiveUrl;
      audioRef.current.play().catch((err) => {
        setPlayingAudioId(null);
        setSyncNotice(`语音播放失败：${err?.message || '浏览器阻止或音频不可用'}`);
        setTimeout(() => setSyncNotice(null), 3000);
      });
      setPlayingAudioId(msgId);

      audioRef.current.onended = () => {
        setPlayingAudioId(null);
        setAudioProgress((prev) => ({ ...prev, [msgId]: 0 }));
      };

      audioRef.current.ontimeupdate = () => {
        if (audioRef.current && audioRef.current.duration) {
          const prog = (audioRef.current.currentTime / audioRef.current.duration) * 100;
          setAudioProgress((prev) => ({ ...prev, [msgId]: prog }));
        }
      };

      audioRef.current.onerror = async () => {
        if (!retriedWithFreshUrl && isSignedResourceUrl(effectiveUrl)) {
          retriedWithFreshUrl = true;
          const nextUrl = await triggerSilentUrlRefresh(effectiveUrl, true);
          if (nextUrl && nextUrl !== effectiveUrl && audioRef.current) {
            effectiveUrl = nextUrl;
            onUpdateMessage?.(msgId, { audioUrl: nextUrl });
            audioRef.current.src = nextUrl;
            audioRef.current.play().catch(() => {
              setPlayingAudioId(null);
              setAudioProgress((prev) => ({ ...prev, [msgId]: 0 }));
              setSyncNotice('语音音频加载失败，请检查网络或重新生成');
              setTimeout(() => setSyncNotice(null), 3000);
            });
            return;
          }
        }
        setPlayingAudioId(null);
        setAudioProgress((prev) => ({ ...prev, [msgId]: 0 }));
        setSyncNotice('语音音频加载失败，请检查网络或重新生成');
        setTimeout(() => setSyncNotice(null), 3000);
      };
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
            setSyncNotice('麦克风录音数据为空，已取消发送');
            setTimeout(() => setSyncNotice(null), 3000);
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, {
            type: audioBlob.type || 'audio/webm',
          });
          const audioUrl = URL.createObjectURL(audioFile);

          onSendMessage({
            sender: 'me',
            isAudio: true,
            audioDuration: recordDurationRef.current || 1,
            audioUrl,
            mediaFile: audioFile,
            text: '🎤 语音消息',
            replyTo: replyingTo ? buildReplyPayload(replyingTo, chat?.title) : undefined,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
          });
          if (replyingTo) setReplyingTo(null);
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

  const handleTriggerVoiceCloneSend = (voiceData: {
    text: string;
    audioUrl?: string;
    audioDuration: number;
    voiceName: string;
    voiceTone: string;
    isMasterVoice?: boolean;
  }) => {
    if (!voiceData.audioUrl) {
      setSyncNotice('缺少有效合成音频，已中止发送');
      setTimeout(() => setSyncNotice(null), 3500);
      return;
    }

    setIsVoiceStudioOpen(false);
    onSendMessage({
      sender: 'me',
      isAudio: true,
      audioDuration: voiceData.audioDuration,
      audioUrl: voiceData.audioUrl,
      text: '🎤 语音消息',
      sttText: voiceData.text,
      voiceName: voiceData.voiceName,
      voiceTone: voiceData.voiceTone,
      isMasterVoice: voiceData.isMasterVoice,
      replyTo: replyingTo ? buildReplyPayload(replyingTo, chat?.title) : undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    });
    if (replyingTo) setReplyingTo(null);

    setInputText('');
    setTranslatedPreview('');
  };

  if (!chat) {
    return (
      <div className="flex-1 min-w-0 bg-[#f4f7fb] dark:bg-[#060b12] tg-chat-pattern flex flex-col items-center justify-center select-none text-[#64748b] dark:text-[#7b93ad] transition-colors px-6">
        <div className="flex flex-col items-center text-center max-w-xs space-y-2.5 px-6 py-5 rounded-2xl bg-white/80 dark:bg-[#0a1320]/80 backdrop-blur-md border border-[#e2e8f0] dark:border-[#162436] shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 border border-[#bfdbfe] dark:border-[#2ba0ff]/25 flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-[13px] font-semibold text-[#0f172a] dark:text-[#eef4fb]">
            选择左侧会话开始协同
          </div>
          <p className="text-[11.5px] text-[#64748b] dark:text-[#7b93ad] leading-relaxed">
            可随时点击最左侧导航栏在右侧工作台展开记忆、大模型、翻译、音色与人设配置。
          </p>
        </div>
      </div>
    );
  }

  const displayedMessages = cloudSearchResults !== null
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
            translatedText: live.translatedText ?? r.translatedText,
            imageCaption: live.imageCaption ?? r.imageCaption,
            isPinned: live.isPinned,
            isEdited: live.isEdited,
            status: live.status,
            deliveryStatus: live.deliveryStatus,
          };
        })
    : chatSearchQuery.trim()
    ? messages.filter((m) => {
        const q = chatSearchQuery.toLowerCase();
        return (
          m.text?.toLowerCase().includes(q) ||
          m.translatedText?.toLowerCase().includes(q) ||
          m.sttText?.toLowerCase().includes(q) ||
          m.fileName?.toLowerCase().includes(q) ||
          m.imageCaption?.toLowerCase().includes(q) ||
          m.forwardFrom?.toLowerCase().includes(q)
        );
      })
    : messages;

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
    <div className="flex-1 min-w-0 bg-[#f4f7fb] dark:bg-[#060b12] flex flex-col h-full relative overflow-hidden transition-colors">
      {/* 1. Official Telegram Top Bar Header */}
      <header className="h-[56px] bg-white/90 dark:bg-[#09111d]/90 backdrop-blur-md border-b border-[#e2e8f0] dark:border-[#162436] flex items-center justify-between px-4 shrink-0 z-10 transition-colors">
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
              <div className="absolute inset-0 bg-[#2481cc] flex items-center justify-center text-white">
                <Check className="w-4 h-4 stroke-[2.5]" />
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[14px] text-[#0f172a] dark:text-[#f5f7fa] truncate leading-tight">
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
                  className="p-0.5 text-[#64748b] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-[#2ba0ff] rounded-sm transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              )}
              {chat.isVerified && (
                <span className="w-3.5 h-3.5 bg-[#2481cc] rounded-full flex items-center justify-center text-white shrink-0">
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                </span>
              )}
            </div>
            <div
              className={`text-[11.5px] leading-none mt-0.5 tabular-nums ${
                chat.isOnline
                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                  : chat.isGroup || chat.isChannel
                  ? 'text-[#2481cc] dark:text-[#2ba0ff]'
                  : 'text-[#64748b] dark:text-[#7f93a5]'
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

        {/* Right: Active Model Indicator + Translation Bar Toggle + Real Actions */}
        <div className="flex items-center gap-1.5 shrink-0 text-[#64748b] dark:text-[#a0acb8]">
          {/* Active LLM Indicator (Opens LLM settings in right dock) */}
          {onOpenCustomLLM && (
            <button
              type="button"
              onClick={onOpenCustomLLM}
              title={isModelDualOff ? '大模型已关闭（双关状态）— 点击前往配置' : '切换或配置大模型引擎'}
              className={`hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border transition-colors cursor-pointer ${
                activeRightPanel === 'llm'
                  ? 'bg-[#e8f3ff] border-[#bfdbfe] text-[#2481cc] dark:bg-[#132234] dark:border-[#2ba0ff]/40 dark:text-[#2ba0ff]'
                  : isModelDualOff
                  ? 'bg-amber-50/70 hover:bg-amber-50 dark:bg-amber-500/10 dark:hover:bg-amber-500/15 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300'
                  : 'bg-[#f8fafc] hover:bg-[#f1f5f9] dark:bg-[#0e1726] dark:hover:bg-[#142236] border-[#e2e8f0] dark:border-[#1a2b40] text-[#334155] dark:text-[#dbe7f3]'
              }`}
            >
              <Cpu className={`w-3.5 h-3.5 ${isModelDualOff ? 'text-amber-500 dark:text-amber-400' : 'text-[#2481cc] dark:text-[#2ba0ff]'}`} />
              <span className="max-w-[140px] truncate">{activeModelDisplay}</span>
            </button>
          )}

          {/* Bidirectional Translation Bar Toggle */}
          <button
            type="button"
            onClick={() => setIsTranslateBarVisible(!isTranslateBarVisible)}
            title="展开或收起实时翻译栏"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border transition-colors cursor-pointer ${
              isTranslateBarVisible
                ? 'bg-[#e8f3ff] border-[#bfdbfe] text-[#2481cc] dark:bg-[#132234] dark:border-[#2ba0ff]/40 dark:text-[#2ba0ff]'
                : 'bg-[#f8fafc] border-[#e2e8f0] text-[#64748b] hover:text-[#0f172a] dark:bg-[#0e1726] dark:border-[#1a2b40] dark:text-[#8aa0b8] dark:hover:text-white'
            }`}
          >
            <Languages className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              双向翻译: {isTranslateBarVisible ? '开启' : '收起'}
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
                  ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff]'
                  : 'hover:bg-[#f1f5f9] dark:hover:bg-[#202b36] text-[#64748b] dark:text-[#a0acb8] hover:text-[#2481cc] dark:hover:text-white'
              }`}
            >
              <RotateCw className={`w-4 h-4 ${isSyncingCloud ? 'animate-spin text-[#2481cc]' : ''}`} />
            </button>
          )}

          {/* In-Chat Search Button */}
          <button
            type="button"
            onClick={() => setIsSearchingInChat(!isSearchingInChat)}
            title="搜索消息"
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              isSearchingInChat
                ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff]'
                : 'hover:bg-[#f1f5f9] dark:hover:bg-[#202b36] text-[#64748b] dark:text-[#a0acb8] hover:text-[#0f172a] dark:hover:text-white'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* 角色人设资料中心按钮 */}
          <button
            type="button"
            onClick={onOpenKnowledgeEvolution}
            title="人设资料"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border transition-colors cursor-pointer ${
              activeRightPanel === 'persona'
                ? 'bg-[#2481cc] border-[#2481cc] text-white dark:bg-[#2ba0ff]/20 dark:border-[#2ba0ff]/50 dark:text-[#2ba0ff]'
                : 'bg-[#f0f7ff] hover:bg-[#e0efff] dark:bg-[#102033] dark:hover:bg-[#142840] border-[#dbeafe] dark:border-[#2ba0ff]/25 text-[#2481cc] dark:text-[#2ba0ff]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden lg:inline font-semibold">人设资料</span>
          </button>

          {/* Voice Call Button */}
          {onOpenVoiceCall && (
            <button
              type="button"
              onClick={onOpenVoiceCall}
              title="语音通话"
              className="w-8 h-8 rounded-lg hover:bg-[#f1f5f9] dark:hover:bg-[#142236] flex items-center justify-center hover:text-[#2481cc] dark:hover:text-[#2ba0ff] transition-colors cursor-pointer"
            >
              <Phone className="w-4 h-4" />
            </button>
          )}

          {/* More Options / Chat Info Drawer */}
          <button
            type="button"
            onClick={() => setChatInfoOpen(true)}
            title="更多与联系人资料"
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              isChatInfoOpen
                ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#132234] dark:text-[#2ba0ff]'
                : 'hover:bg-[#f1f5f9] dark:hover:bg-[#142236] hover:text-[#0f172a] dark:hover:text-white'
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
              className="w-8 h-8 rounded-lg hover:bg-[#f1f5f9] dark:hover:bg-[#202b36] flex items-center justify-center hover:text-[#0f172a] dark:hover:text-white transition-colors cursor-pointer text-[#64748b] dark:text-[#a0acb8]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* In-Chat Search Bar */}
      {isSearchingInChat && (
        <div className="bg-white dark:bg-[#17212b] border-b border-[#e0e4e8] dark:border-[#202b36] px-4 py-2 flex items-center gap-2 text-xs animate-in fade-in duration-150">
          <Search className="w-4 h-4 text-[#707579] dark:text-[#7f93a5] shrink-0" />
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
            className="flex-1 bg-[#f0f2f5] dark:bg-[#242f3d] px-3 py-1.5 rounded-lg text-xs text-[#111827] dark:text-white border border-transparent focus:border-[#2ba0ff]/50 focus:outline-none"
            autoFocus
          />
          {chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && chatSearchQuery.trim() && (
            <button
              type="button"
              disabled={isCloudSearching}
              onClick={() => void handleCloudSearch()}
              className="px-2.5 py-1 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] disabled:opacity-50 text-white font-medium text-[11px] shrink-0 cursor-pointer transition-colors"
            >
              {isCloudSearching ? '检索中...' : '云端全文搜索'}
            </button>
          )}
          {cloudSearchResults !== null && (
            <button
              type="button"
              onClick={() => setCloudSearchResults(null)}
              className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/10 text-[#64748b] dark:text-[#a0acb8] hover:text-[#0f172a] dark:hover:text-white text-[11px] shrink-0 cursor-pointer"
            >
              返回列表
            </button>
          )}
          {chatSearchQuery && (
            <span className="text-[11px] text-[#707579] dark:text-[#7f93a5] whitespace-nowrap tabular-nums">
              {cloudSearchResults !== null ? `云端 ${displayedMessages.length} 条` : `匹配 ${displayedMessages.length} 条`}
            </span>
          )}
          <button
            onClick={() => {
              setIsSearchingInChat(false);
              setChatSearchQuery('');
              setCloudSearchResults(null);
            }}
            className="p-1 text-[#707579] hover:text-[#111827] dark:text-[#7f93a5] dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Telegram Pinned Message Top Banner */}
      {activePinnedMessage && (
        <div className="bg-[#f0f7ff] dark:bg-[#1a2530] border-b border-[#dbeafe] dark:border-[#101b26] px-4 py-2 flex items-center justify-between text-xs animate-in fade-in duration-150">
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
            <Pin className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] shrink-0 fill-current" />
            <div className="min-w-0 truncate">
              <span className="font-semibold text-[#2481cc] dark:text-[#2ba0ff] mr-1.5">
                置顶消息{pinnedMessages.length > 1 ? ` (${safePinnedIndex + 1}/${pinnedMessages.length})` : ''}:
              </span>
              <span className="text-[#0f172a] dark:text-[#f5f7fa]">
                {activePinnedMessage.text ||
                  (activePinnedMessage.isImage ? '🖼️ [图片]' : activePinnedMessage.isAudio ? '🎤 [语音]' : '消息')}
              </span>
            </div>
          </button>
          {pinnedMessages.length > 1 && (
            <button
              type="button"
              onClick={() => setPinnedBannerIndex((i) => (i + 1) % pinnedMessages.length)}
              className="text-xs text-[#2481cc] dark:text-[#2ba0ff] p-1 cursor-pointer shrink-0 ml-1"
              title="下一条置顶消息"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onTogglePinMessage?.(activePinnedMessage.id)}
            className="text-xs text-[#64748b] hover:text-[#0f172a] dark:hover:text-white p-1 cursor-pointer shrink-0 ml-1"
            title="取消置顶"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Cloud Sync & Protection Notice Banner */}
      {syncNotice && (() => {
        const isAlertNotice = /静默|中断|失败|断连|阻断|超时|未连通|异常|错误/.test(syncNotice);
        return (
          <div
            className={`border-b px-4 py-2 text-xs flex items-center justify-between animate-in fade-in duration-150 ${
              isAlertNotice
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300'
                : 'bg-[#e8f3ff] border-[#bfdbfe] text-[#2481cc] dark:bg-[#2481cc]/15 dark:border-[#2481cc]/30 dark:text-[#2ba0ff]'
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
        <div className="bg-[#f8fafc]/90 dark:bg-[#0c1624]/90 backdrop-blur-xs border-b border-[#e2e8f0] dark:border-[#162436] px-4 py-1.5 flex items-center justify-between text-xs text-[#0f172a] dark:text-[#d3e2ef] transition-colors shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Languages className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] shrink-0" />
            <span className="font-medium whitespace-nowrap text-[#334155] dark:text-[#d3e2ef]">
              自动翻译为{getLanguageDisplayName(inboundTargetLang)}
            </span>
            <span className="text-[#94a3b8] dark:text-[#7f93a5]">·</span>

            {/* Quick Target Language Selector */}
            <div className="relative inline-flex items-center" ref={langMenuRef}>
              <button
                type="button"
                onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-[#242f3d] hover:bg-black/5 dark:hover:bg-[#2b3848] border border-[#d8dde3] dark:border-[#313f52] text-[#2481cc] dark:text-[#2ba0ff] cursor-pointer transition-colors font-medium text-[11px]"
              >
                <span>发信目标: {getLanguageDisplayName(outboundTargetLang)}</span>
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>

              {isLangMenuOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-64 bg-white dark:bg-[#17212b] border border-[#e0e4e8] dark:border-[#242f3d] rounded-xl shadow-xl p-1.5 z-50 animate-in fade-in duration-150">
                  <div className="px-2 py-1 text-[10px] font-semibold text-[#707579] dark:text-[#7f93a5] uppercase tracking-wider border-b border-black/5 dark:border-white/5 pb-1 mb-1">
                    选择联系人语言 (全球 {SUPPORTED_LANGUAGES.length - 1} 种)
                  </div>
                  <div className="px-1 pb-1.5">
                    <input
                      type="text"
                      value={langMenuSearch}
                      onChange={(e) => setLangMenuSearch(e.target.value)}
                      placeholder="搜索语言名称或代码..."
                      className="w-full px-2 py-1 text-[11px] rounded-md bg-black/5 dark:bg-[#0e1621] border border-black/10 dark:border-[#2b3d52] text-[#111827] dark:text-white placeholder-[#707579] dark:placeholder-[#566c82] focus:outline-none focus:border-[#2481cc]"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-0.5">
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
                        outboundTargetLang === lang.code;
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
                              ? 'bg-[#2481cc] text-white font-medium'
                              : 'text-[#111827] dark:text-[#f5f7fa] hover:bg-black/5 dark:hover:bg-[#202b36]'
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
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onOpenTranslation}
              className="text-[#2481cc] dark:text-[#2ba0ff] hover:underline font-medium cursor-pointer"
            >
              设置
            </button>
            <button
              onClick={() => setIsTranslateBarVisible(false)}
              className="p-1 text-[#707579] dark:text-[#7f93a5] hover:text-[#111827] dark:hover:text-white transition-colors cursor-pointer"
              title="关闭翻译栏"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 3. Messages Stream Viewport with Official Telegram Wallpaper Pattern */}
      <div
        ref={scrollViewportRef}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-3 tg-chat-pattern select-text"
      >
        {/* Load Older Cloud History Button */}
        {chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && hasMoreHistory && cloudSearchResults === null && onLoadOlderMessages && (
          <div className="flex items-center justify-center my-1">
            <button
              type="button"
              disabled={isLoadingOlder}
              onClick={() => void handleLoadOlderClick()}
              className="px-3.5 py-1 rounded-full bg-white/90 dark:bg-[#162333] hover:bg-[#e8f3ff] dark:hover:bg-[#1d3047] border border-[#e2e8f0] dark:border-[#24374e] text-[11px] font-medium text-[#2481cc] dark:text-[#2ba0ff] shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
            >
              <History className={`w-3.5 h-3.5 ${isLoadingOlder ? 'animate-spin' : ''}`} />
              <span>{isLoadingOlder ? '正在加载更早消息...' : '加载更早历史消息'}</span>
            </button>
          </div>
        )}

        {displayedMessages.map((msg, idx) => {
          const isMe = msg.sender === 'me';
          const dayKey = getMessageDayKey(msg);
          const prevDayKey = idx > 0 ? getMessageDayKey(displayedMessages[idx - 1]) : null;
          const showDayDivider = idx === 0 || dayKey !== prevDayKey;
          const isSelectedMulti = selectedMessageIds.has(msg.id);

          return (
            <React.Fragment key={msg.id}>
              {showDayDivider && (
                <div className="flex items-center justify-center my-1.5">
                  <span className="px-3 py-0.5 rounded-full bg-white/90 dark:bg-black/40 border border-[#e2e8f0] dark:border-transparent text-[11px] font-medium text-[#64748b] dark:text-white shadow-xs">
                    {formatMessageDayLabel(dayKey)}
                  </span>
                </div>
              )}

              <div
                data-msg-id={msg.id}
                onClick={isMultiSelectMode ? () => toggleSelectMessage(msg.id) : undefined}
                className={`flex ${isMultiSelectMode ? 'items-center gap-2.5 cursor-pointer rounded-xl px-1.5 py-0.5 transition-colors ' + (isSelectedMulti ? 'bg-[#2481cc]/10 dark:bg-[#2ba0ff]/15' : 'hover:bg-black/5 dark:hover:bg-white/5') : 'flex-col'} ${
                  isMe ? (isMultiSelectMode ? 'justify-end' : 'items-end') : (isMultiSelectMode ? 'justify-start' : 'items-start')
                } group relative my-1`}
                onMouseEnter={() => !isMultiSelectMode && setHoveredMessageId(msg.id)}
                onMouseLeave={() => setHoveredMessageId(null)}
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
                        ? 'text-[#2481cc] dark:text-[#2ba0ff]'
                        : 'text-[#94a3b8] dark:text-[#64748b]'
                    }`}
                  >
                    {isSelectedMulti ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>
                )}

                {/* Telegram Floating Quick Action Menu on Hover */}
                {!isMultiSelectMode && hoveredMessageId === msg.id && (
                  <div
                    className={`absolute -top-4 z-20 flex items-center gap-0.5 bg-white dark:bg-[#17212b] border border-[#e0e4e8] dark:border-[#2b3848] rounded-full px-1.5 py-0.5 shadow-lg animate-in fade-in zoom-in-95 duration-100 ${
                      isMe ? 'right-2' : 'left-2'
                    }`}
                  >
                    {/* Quick Reactions Bar */}
                    <div className="flex items-center gap-0.5 pr-1 border-r border-black/5 dark:border-white/10">
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
                      className="p-1 text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-[#2ba0ff] cursor-pointer"
                      title="回复消息"
                    >
                      <Reply className="w-3.5 h-3.5" />
                    </button>

                    {/* Forward Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenForwardModal([msg])}
                      className="p-1 text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-[#2ba0ff] cursor-pointer"
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
                        className="p-1 text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-[#2ba0ff] cursor-pointer disabled:opacity-50"
                        title={msg.translatedText ? '重新翻译' : '翻译此消息'}
                      >
                        {msg.isTranslating ? (
                          <RotateCw className="w-3.5 h-3.5 animate-spin text-[#2481cc]" />
                        ) : (
                          <Languages className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    {/* Pin Button */}
                    <button
                      type="button"
                      onClick={() => onTogglePinMessage?.(msg.id)}
                      className="p-1 text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-[#2ba0ff] cursor-pointer"
                      title={msg.isPinned ? '取消置顶' : '置顶此消息'}
                    >
                      <Pin className={`w-3.5 h-3.5 ${msg.isPinned ? 'text-[#2481cc] fill-current' : ''}`} />
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
                        className="p-1 text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-[#2ba0ff] cursor-pointer"
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
                      className="p-1 text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-[#2ba0ff] cursor-pointer"
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
                      className="p-1 text-[#707579] hover:text-red-500 dark:text-[#7f93a5] dark:hover:text-red-400 cursor-pointer"
                      title="删除消息"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div
                  className={`max-w-[80%] sm:max-w-[74%] rounded-2xl p-3 px-3.5 relative transition-all select-text ${
                    highlightedMsgId === msg.id ? 'ring-2 ring-amber-400 shadow-lg' : ''
                  } ${
                    isMe
                      ? 'bg-[#1e88e5] text-white dark:bg-[#2b5278] dark:text-white rounded-br-xs shadow-[0_1px_3px_rgba(30,136,229,0.22)]'
                      : 'bg-white text-[#0f172a] border border-[#e2e8f0] dark:bg-[#182533] dark:text-[#f5f7fa] dark:border-transparent rounded-bl-xs shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
                  }`}
                >
                  {/* Forwarded Label */}
                  {msg.forwardFrom && (
                    <div
                      className={`mb-1 flex items-center gap-1 text-[10.5px] font-medium ${
                        isMe ? 'text-white/85' : 'text-[#2481cc] dark:text-[#2ba0ff]'
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
                          : 'border-[#2481cc] bg-[#f8fafc] dark:bg-white/5 text-[#0f172a] dark:text-[#f5f7fa]'
                      }`}
                    >
                      <div
                        className={`font-semibold truncate ${
                          isMe ? 'text-white' : 'text-[#2481cc] dark:text-[#2ba0ff]'
                        }`}
                      >
                        {msg.replyTo.senderName || '回复消息'}
                      </div>
                      <div className="opacity-85 truncate text-[10.5px]">{msg.replyTo.text}</div>
                    </div>
                  )}

                {/* Image / Sticker Attachment with Copy and Download Overlay */}
                {msg.isImage && msg.imageUrl && (
                  <div className="mb-1.5 rounded-xl overflow-hidden max-w-[280px] shadow-xs relative group/img">
                    <img
                      src={resolveDisplayUrl(msg.imageUrl)}
                      alt={msg.imageCaption || 'image'}
                      className="w-full h-auto object-cover max-h-72 cursor-pointer hover:opacity-95 transition-opacity rounded-xl"
                      onLoad={(e) => {
                        e.currentTarget.style.display = '';
                      }}
                      onError={() => {
                        void triggerSilentUrlRefresh(msg.imageUrl, true);
                      }}
                    />
                    {/* Hover actions for image: Copy Image and Download Image */}
                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/65 backdrop-blur-xs rounded-lg p-1 text-white shadow-md">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyImageToClipboard(resolveDisplayUrl(msg.imageUrl) || msg.imageUrl!, msg.id);
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
                        href={resolveDisplayUrl(msg.imageUrl)}
                        download={msg.imageCaption || `tg_photo_${Date.now()}.png`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const resolved = resolveDisplayUrl(msg.imageUrl);
                          if (msg.imageUrl && isSignedResourceUrlExpiringSoon(resolved)) {
                            e.preventDefault();
                            void triggerSilentUrlRefresh(msg.imageUrl, true).then((nextUrl) => {
                              const a = document.createElement('a');
                              a.href = nextUrl || resolved || msg.imageUrl!;
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
                  </div>
                )}

                {/* Video Attachment with Inline Player, Duration Badge, and Download */}
                {msg.isVideo && msg.videoUrl && (
                  <div className="mb-1.5 rounded-xl overflow-hidden max-w-[320px] shadow-sm relative group/vid bg-black/10 dark:bg-black/40">
                    <video
                      src={resolveDisplayUrl(msg.videoUrl)}
                      controls
                      preload="metadata"
                      className="w-full h-auto max-h-80 object-contain rounded-xl bg-black"
                      onError={() => {
                        void triggerSilentUrlRefresh(msg.videoUrl, true);
                      }}
                    />
                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/vid:opacity-100 transition-opacity bg-black/65 backdrop-blur-xs rounded-lg p-1 text-white shadow-md z-10">
                      <a
                        href={resolveDisplayUrl(msg.videoUrl)}
                        download={`tg_video_${Date.now()}.mp4`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const resolved = resolveDisplayUrl(msg.videoUrl);
                          if (msg.videoUrl && isSignedResourceUrlExpiringSoon(resolved)) {
                            e.preventDefault();
                            void triggerSilentUrlRefresh(msg.videoUrl, true).then((nextUrl) => {
                              const a = document.createElement('a');
                              a.href = nextUrl || resolved || msg.videoUrl!;
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
                )}

                {/* File Attachment */}
                {msg.isFile && (
                  <div className="p-2.5 rounded-xl bg-black/5 dark:bg-white/10 flex items-center justify-between gap-3 text-xs mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-6 h-6 text-[#2481cc] shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{msg.fileName || '文档附件'}</div>
                        <div className="text-[10px] opacity-70">{msg.fileSize || '128 KB'}</div>
                      </div>
                    </div>
                    {msg.fileUrl ? (
                      <a
                        href={resolveDisplayUrl(msg.fileUrl) || '#'}
                        download={msg.fileName || 'file'}
                        onClick={(e) => {
                          const resolved = resolveDisplayUrl(msg.fileUrl);
                          if (msg.fileUrl && isSignedResourceUrlExpiringSoon(resolved)) {
                            e.preventDefault();
                            void triggerSilentUrlRefresh(msg.fileUrl, true).then((nextUrl) => {
                              const a = document.createElement('a');
                              a.href = nextUrl || resolved || msg.fileUrl!;
                              a.download = msg.fileName || 'file';
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                            });
                          }
                        }}
                        className="p-1.5 text-[#2481cc] dark:text-[#2ba0ff] hover:bg-[#2481cc]/10 rounded-lg cursor-pointer"
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
                  <div className="flex flex-col gap-2 min-w-[220px]">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => void handlePlayAudio(msg.id, msg.audioUrl)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-105 shrink-0 ${
                          isMe
                            ? 'bg-[#2481cc] text-white'
                            : 'bg-[#2481cc] text-white'
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
                        <div className="h-1.5 w-full bg-black/10 dark:bg-white/20 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-100 ${
                              isMe ? 'bg-[#2481cc] dark:bg-white' : 'bg-[#2481cc]'
                            }`}
                            style={{ width: `${audioProgress[msg.id] || 0}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] mt-1 opacity-70 tabular-nums">
                          <span>{msg.audioDuration ? `${msg.audioDuration}"` : '0:04'}</span>
                          <span className="flex items-center gap-1.5">
                            {(msg.isMasterVoice || msg.voiceName) && (
                              <span className="text-[10px] text-[#2481cc] dark:text-cyan-300">
                                🎙️ {msg.voiceName || '个人预设音色'}
                              </span>
                            )}
                            <span>语音消息</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Speech to Text Transcribe toggle */}
                    {msg.sttText ? (
                      <div className="mt-1 pt-1.5 border-t border-black/10 dark:border-white/10 text-xs">
                        <div className="text-[11px] opacity-70 mb-0.5 select-none">转文字:</div>
                        <p className="select-text cursor-text">{msg.sttText}</p>
                        {msg.translatedText && (
                          <p className="mt-1 font-medium text-[#2481cc] dark:text-[#2ba0ff] select-text cursor-text">
                            译文: {msg.translatedText}
                          </p>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleTranscribeAudio(msg)}
                        disabled={transcribingMap[msg.id]}
                        className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] hover:underline self-start cursor-pointer mt-0.5"
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
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#2481cc] dark:text-[#2ba0ff]">
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
                                className="text-[10.5px] text-[#64748b] dark:text-[#7f93a5] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] hover:underline cursor-pointer"
                              >
                                {isShowingOriginalOverlay ? '收起原文' : '查看原文'}
                              </button>
                            </div>
                            {isShowingOriginalOverlay && msg.text && (
                              <div className="mt-1.5 p-2 rounded-lg bg-[#f8fafc] dark:bg-[#101b26]/75 border border-[#e2e8f0] dark:border-white/10 text-xs text-[#475569] dark:text-[#cbd5e1] select-text">
                                <div className="text-[10px] opacity-70 mb-0.5 select-none">原文：</div>
                                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <>
                          {!msg.isImage && !msg.isFile && !msg.isVideo && (
                            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words select-text cursor-text">
                              {msg.text}
                            </p>
                          )}
                          {msg.isImage && msg.text && msg.text.trim() && !msg.text.startsWith('[照片]') && !/\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)$/i.test(msg.text.trim()) && (
                            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words select-text cursor-text mt-1">
                              {msg.text}
                            </p>
                          )}
                          {msg.isVideo && msg.text && msg.text.trim() && !msg.text.startsWith('[视频]') && !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(msg.text.trim()) && (
                            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words select-text cursor-text mt-1">
                              {msg.text}
                            </p>
                          )}

                          {/* Official Telegram Inline Translation Card */}
                          {msg.isTranslating ? (
                            <div
                              className={`mt-2 p-2 rounded-xl border text-[11px] flex items-center gap-1.5 ${
                                isMe
                                  ? 'bg-white/10 border-white/20 text-white/85'
                                  : 'bg-[#f8fafc] dark:bg-[#101b26]/75 border-[#e2e8f0] dark:border-white/10 text-[#2481cc] dark:text-[#2ba0ff]'
                              }`}
                            >
                              <RotateCw className="w-3 h-3 animate-spin shrink-0" />
                              <span>正在翻译中...</span>
                            </div>
                          ) : msg.translatedText ? (
                            <div
                              className={`mt-2 p-2.5 rounded-xl border text-xs select-text cursor-text ${
                                isMe
                                  ? 'bg-white/12 border-white/20 text-white/95'
                                  : 'bg-[#f8fafc] dark:bg-[#101b26]/75 border-[#e2e8f0] dark:border-white/10 text-[#1e293b] dark:text-[#e2e8f0]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1 select-none">
                                <span
                                  className={`inline-flex items-center gap-1 text-[10.5px] font-medium ${
                                    isMe ? 'text-white/80' : 'text-[#2481cc] dark:text-[#2ba0ff]'
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
                                          : 'text-[#64748b] hover:text-[#2481cc] hover:bg-black/5 dark:text-[#7f93a5] dark:hover:text-white'
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
                                        : 'text-[#64748b] hover:text-[#2481cc] hover:bg-black/5 dark:text-[#7f93a5] dark:hover:text-white'
                                    }`}
                                  >
                                    {copiedId === `${msg.id}_tr` ? (
                                      <Check className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              </div>
                              <p className="leading-relaxed font-normal select-text cursor-text">{msg.translatedText}</p>
                            </div>
                          ) : msg.translationError ? (
                            <div
                              className={`mt-2 pt-1.5 border-t text-[11px] flex items-center justify-between gap-2 select-text cursor-text ${
                                isMe
                                  ? 'border-white/20 text-amber-200'
                                  : 'border-rose-500/20 text-rose-500 dark:text-rose-400'
                              }`}
                            >
                              <span className="min-w-0 break-words">译文失败：{msg.translationError}</span>
                              {onRetranslateMessage && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onRetranslateMessage(msg.id);
                                  }}
                                  className="shrink-0 px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-300 font-semibold text-[10.5px] cursor-pointer"
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
                    className={`flex flex-wrap items-center gap-1 mt-1.5 pt-1 border-t ${
                      isMe ? 'border-white/15' : 'border-black/5 dark:border-white/10'
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
                              ? 'bg-[#e8f3ff] border-[#2481cc] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff]'
                              : 'bg-[#f1f5f9] dark:bg-white/10 border-transparent text-[#0f172a] dark:text-white/90 hover:bg-[#e2e8f0]'
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
                <div
                  className={`flex items-center justify-end gap-1 mt-1.5 text-[10px] select-none tabular-nums ${
                    isMe ? 'text-white/80' : 'text-[#64748b] dark:text-[#7f93a5]'
                  }`}
                >
                  {msg.isPinned && (
                    <Pin
                      className={`w-3 h-3 fill-current mr-0.5 ${
                        isMe ? 'text-white/90' : 'text-[#2481cc] dark:text-[#2ba0ff]'
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
                        <CheckCheck className="w-3.5 h-3.5 text-white/95 dark:text-[#2ba0ff]" />
                      </span>
                    ) : chat.id.startsWith('tg_') && currentAccountId !== 'acc_telegram_bot' && typeof msg.telegramMessageId === 'number' ? (
                      typeof chat.readOutboxMaxId === 'number' && msg.telegramMessageId <= chat.readOutboxMaxId ? (
                        <span title={chat.isGroup ? '已有成员已读' : '对方已读'} className="inline-flex items-center">
                          <CheckCheck className="w-3.5 h-3.5 text-white/95 dark:text-[#2ba0ff]" />
                        </span>
                      ) : (
                        <span title={chat.isGroup ? '已送达（暂未有成员已读）' : '已送达（对方未读）'} className="inline-flex items-center">
                          <Check className="w-3.5 h-3.5 text-white/80 dark:text-[#7f95ab]" />
                        </span>
                      )
                    ) : (
                      <CheckCheck className="w-3.5 h-3.5 text-white/95 dark:text-[#2ba0ff]" />
                    )
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
        <div className="bg-[#f0f7ff] dark:bg-[#112031] border-t border-[#bfdbfe] dark:border-[#243b55] px-4 py-2.5 flex items-center justify-between gap-2 text-xs shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-[#2481cc] dark:text-[#2ba0ff] tabular-nums">
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
              className="px-2 py-1 rounded-lg bg-white dark:bg-[#1a2c42] border border-[#dbeafe] dark:border-[#2a4360] text-[#0f172a] dark:text-white hover:bg-[#e8f3ff] cursor-pointer text-[11px]"
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
              className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] disabled:opacity-40 text-white font-medium flex items-center gap-1.5 cursor-pointer"
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
              className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white font-medium flex items-center gap-1.5 cursor-pointer"
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
              className="px-2.5 py-1.5 rounded-lg text-[#64748b] dark:text-[#9aa7b5] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            >
              退出多选
            </button>
          </div>
        </div>
      )}

      {/* 4. Official Telegram Composer (Structured Dual-Layer Input Area) */}
      <footer onPaste={handlePaste} className="bg-white/95 dark:bg-[#09111d]/95 backdrop-blur-md border-t border-[#e2e8f0] dark:border-[#162436] px-4 py-2.5 shrink-0 transition-colors">
        {/* AI Generating Indicator */}
        {isGeneratingAi && (
          <div className="mb-2 px-3 py-2 bg-[#e8f3ff] dark:bg-[#2481cc]/10 border border-[#bfdbfe] dark:border-[#2481cc]/30 rounded-xl flex items-center gap-2 text-xs text-[#2481cc] dark:text-[#2ba0ff] animate-pulse">
            <Sparkles className="w-4 h-4 animate-spin text-amber-500" />
            <span>AI 正在深度检索该客户全息画像与过往约定，生成真人拟真回复...</span>
          </div>
        )}

        {/* AI Holographic Memory Suggestion Card */}
        {aiSuggestion && (
          <div className="mb-2.5 p-3.5 bg-gradient-to-r from-[#eff6ff] via-[#f8fafc] to-transparent dark:from-[#2481cc]/15 dark:via-purple-500/10 dark:to-transparent border border-[#bfdbfe] dark:border-[#2481cc]/35 rounded-xl flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2481cc] dark:text-[#2ba0ff]">
                <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>AI 回复建议</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAiSuggestion(null);
                  setAiSuggestionTranslation(null);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white p-0.5 cursor-pointer"
                title="关闭建议"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Bilingual Content Box */}
            <div className="bg-white dark:bg-[#101b26]/90 p-3 rounded-lg border border-[#e2e8f0] dark:border-white/5 select-text space-y-2.5">
              {/* 1. Foreign Outbound Text */}
              <div>
                <span className="text-[10px] font-semibold text-[#64748b] dark:text-[#7f93a5] block mb-1">
                  外文译稿：
                </span>
                <div className="text-xs text-[#0f172a] dark:text-[#f5f7fa] leading-relaxed font-sans">
                  {aiSuggestion}
                </div>
              </div>

              {/* 2. Chinese Meaning Translation */}
              {aiSuggestionTranslation ? (
                <div className="pt-2 border-t border-[#e2e8f0] dark:border-white/10 text-xs text-[#2481cc] dark:text-[#2ba0ff] flex items-start gap-1.5">
                  <Languages className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-80" />
                  <div className="flex-1">
                    <span className="text-[10px] font-semibold text-[#64748b] dark:text-gray-400 block mb-0.5">
                      中文对照：
                    </span>
                    <span className="leading-relaxed font-sans text-[#1e293b] dark:text-gray-200">
                      {aiSuggestionTranslation}
                    </span>
                  </div>
                </div>
              ) : isTranslatingSuggestion ? (
                <div className="pt-2 border-t border-[#e2e8f0] dark:border-white/10 text-[11px] text-[#2481cc] dark:text-[#2ba0ff] flex items-center gap-1.5 animate-pulse">
                  <Languages className="w-3 h-3 animate-spin shrink-0" />
                  <span>正在获取中文含义翻译...</span>
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
                className="px-2.5 py-1 rounded-lg bg-[#f1f5f9] dark:bg-[#242f3d] hover:bg-[#e2e8f0] dark:hover:bg-[#2c3a4b] text-[#0f172a] dark:text-white font-medium text-[11px] cursor-pointer transition-colors"
              >
                填入输入框
              </button>
              <button
                type="button"
                disabled={isSending}
                onClick={async () => {
                  if (isSending) return;
                  setIsSending(true);
                  const targetSuggestion = aiSuggestion;
                  const targetTranslation = aiSuggestionTranslation;
                  setAiSuggestion(null);
                  setAiSuggestionTranslation(null);
                  try {
                    let cnTranslation = targetTranslation || '';
                    if (
                      !cnTranslation &&
                      outboundTargetLang &&
                      normalizeChatLangCode(outboundTargetLang) !== normalizeChatLangCode(inboundTargetLang)
                    ) {
                      try {
                        cnTranslation = await translateText(
                          targetSuggestion,
                          outboundTargetLang,
                          inboundTargetLang,
                          customLLMConfig,
                          translationSettings?.preferredEngine || 'gemini',
                          undefined,
                          translationSettings?.geminiModel,
                          translationSettings?.geminiApiKey,
                          translationSettings?.customModelName
                        );
                      } catch (transErr: any) {
                        setSyncNotice(`对照翻译失败: ${transErr?.message || '请检查翻译通道配置'}`);
                        setTimeout(() => setSyncNotice(null), 4000);
                      }
                    }
                    onSendMessage({
                      sender: 'me',
                      text: targetSuggestion,
                      translatedText: cnTranslation,
                      replyTo: replyingTo ? buildReplyPayload(replyingTo, chat.title) : undefined,
                      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
                    });
                    if (replyingTo) setReplyingTo(null);
                    const lastPeerMsg = [...messages].reverse().find((m) => m.sender === 'peer');
                    submitTrainingFeedbackApi({
                      snippet: targetSuggestion.slice(0, 500),
                      peerCue: lastPeerMsg?.text ? lastPeerMsg.text.slice(0, 200) : undefined,
                      engineLicenseKey: customLLMConfig?.engineLicenseKey,
                    }).catch(() => {});
                  } finally {
                    setIsSending(false);
                  }
                }}
                className={`px-3 py-1 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] text-white font-medium text-[11px] cursor-pointer flex items-center gap-1 shadow-xs transition-all ${
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
            <div className="mb-2 px-3 py-2 bg-rose-500/10 dark:bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10.5px] font-semibold text-rose-600 dark:text-rose-300 block">
                    翻译预览失败（发送未受阻，可直接发送原文）
                  </span>
                  <span className="text-[11px] text-rose-700 dark:text-rose-200 truncate block">
                    {previewError}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewRetryNonce((n) => n + 1)}
                  className="px-2 py-1 rounded-md bg-white/80 dark:bg-[#162333] border border-rose-500/30 hover:bg-white text-rose-600 dark:text-rose-300 text-[11px] font-semibold cursor-pointer"
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
            <div className="mb-2 px-3 py-1.5 bg-[#f0f7ff] dark:bg-[#1a2530] border border-[#dbeafe] dark:border-[#242f3d] rounded-xl flex items-center justify-between text-xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 min-w-0">
                <Languages className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-[#64748b] dark:text-[#7f93a5] block">
                    译文预览：
                  </span>
                  <span className="text-xs font-medium text-[#0f172a] dark:text-[#f5f7fa] truncate block">
                    {translatedPreview}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <span className="text-[10px] text-[#64748b] dark:text-[#7f93a5]">
                  {sendWithEnter ? 'Enter' : 'Ctrl+Enter'} 发送
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setTranslatedPreview('');
                    setTranslatedPreviewSource('');
                    setPreviewError('');
                  }}
                  className="p-1 text-[#64748b] hover:text-[#0f172a] dark:hover:text-white rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-colors"
                  title="取消此译文预览 (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )
        )}

        {/* Reply Quote Banner above Input */}
        {replyingTo && (
          <div className="mb-2 p-2 px-3 bg-[#f0f7ff] dark:bg-[#0e1928] border border-[#bfdbfe] dark:border-[#2ba0ff]/35 rounded-xl flex items-center justify-between text-xs animate-in fade-in duration-150">
            <div className="min-w-0 pr-2">
              <div className="font-semibold text-[#2481cc] dark:text-[#2ba0ff] flex items-center gap-1.5">
                <Reply className="w-3.5 h-3.5" />
                <span>回复 {replyingTo.sender === 'me' ? '我' : (chat.title || '对方')}</span>
              </div>
              <div className="text-[11px] text-[#64748b] dark:text-[#7f93a5] truncate mt-0.5">
                {replyingTo.text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="p-1 text-[#64748b] hover:text-[#0f172a] dark:hover:text-white cursor-pointer shrink-0"
              title="取消回复"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Edit Message Banner above Input */}
        {editingMessage && (
          <div className="mb-2 p-2 px-3 bg-amber-50 dark:bg-amber-500/12 border border-amber-300/70 dark:border-amber-500/35 rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
            <div className="min-w-0 pr-2 flex-1">
              <div className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>正在编辑消息</span>
                </span>
                {translationSettings?.autoTranslateOutbound !== false && (
                  <label className="inline-flex items-center gap-1 text-[11px] font-normal text-[#475569] dark:text-[#cbd5e1] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={translateOnEdit}
                      onChange={(e) => setTranslateOnEdit(e.target.checked)}
                      className="rounded border-amber-400 text-[#2481cc] focus:ring-[#2481cc]"
                    />
                    <span>重新翻译为外文</span>
                  </label>
                )}
              </div>
              <div className="text-[11px] text-[#64748b] dark:text-[#7f93a5] truncate mt-0.5">
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
              className="p-1 text-[#64748b] hover:text-[#0f172a] dark:hover:text-white cursor-pointer shrink-0"
              title="取消编辑"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Attachment Menu Popup */}
        {isAttachmentMenuOpen && (
          <div className="absolute bottom-24 left-4 bg-white dark:bg-[#17212b] rounded-2xl shadow-2xl border border-[#e2e8f0] dark:border-[#243547] p-2 flex flex-col gap-1 z-30 animate-in fade-in zoom-in-95 duration-150 text-xs select-none">
            <button
              type="button"
              onClick={() => {
                imageInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#202b36] text-[#0f172a] dark:text-white cursor-pointer font-medium"
            >
              <ImageIcon className="w-4 h-4 text-[#2481cc]" />
              <span>照片或图片</span>
            </button>
            <button
              type="button"
              onClick={() => {
                videoInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#202b36] text-[#0f172a] dark:text-white cursor-pointer font-medium"
            >
              <Video className="w-4 h-4 text-[#2481cc]" />
              <span>视频消息</span>
            </button>
            <button
              type="button"
              onClick={() => {
                audioInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#202b36] text-[#0f172a] dark:text-white cursor-pointer font-medium"
            >
              <Music className="w-4 h-4 text-[#2481cc]" />
              <span>音频与语音</span>
            </button>
            <button
              type="button"
              onClick={() => {
                fileInputRef.current?.click();
                setIsAttachmentMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#202b36] text-[#0f172a] dark:text-white cursor-pointer font-medium"
            >
              <FileText className="w-4 h-4 text-[#2481cc]" />
              <span>文档与文件</span>
            </button>
          </div>
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
          <div className="mb-2.5 p-2.5 bg-[#f0f7ff] dark:bg-[#1a2530] border border-[#2481cc]/40 rounded-xl flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150 shadow-xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-black/10 dark:border-white/10 bg-black/5">
                <img
                  src={pastedImage.dataUrl}
                  alt="pasted preview"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#2481cc] dark:text-[#2ba0ff] flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>已捕获剪贴板照片</span>
                  <span className="text-[10px] text-gray-500 font-normal">
                    ({(pastedImage.file.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <div className="text-[11px] text-[#64748b] dark:text-[#7f93a5] truncate mt-0.5">
                  {inputText.trim() ? `配文: ${inputText}` : `可在输入框输入配文，或直接点击发送 (${sendWithEnter ? 'Enter' : 'Ctrl+Enter'})`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => clearPastedImage(true)}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                title="取消发送此图片 (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleSendPastedImage}
                className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] text-white font-medium text-xs cursor-pointer flex items-center gap-1.5 shadow-xs"
                title={`立即发送照片 (${sendWithEnter ? 'Enter' : 'Ctrl+Enter'})`}
              >
                <Send className="w-3 h-3" />
                <span>发送照片</span>
              </button>
            </div>
          </div>
        )}

        {/* Composer Top Utility Strip: Active Persona + Outbound Auto-Translate Target */}
        <div className="flex items-center justify-between gap-2 mb-2 text-[11.5px]">
          <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={onOpenKnowledgeEvolution}
              title="查看或切换人设资料"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-medium cursor-pointer transition-colors shrink-0 ${
                activeRightPanel === 'persona'
                  ? 'bg-[#2481cc] border-[#2481cc] text-white dark:bg-[#132234] dark:border-[#2ba0ff]/45 dark:text-[#2ba0ff]'
                  : 'bg-[#f0f7ff] hover:bg-[#e0efff] dark:bg-[#0e1726] dark:hover:bg-[#142236] border-[#dbeafe] dark:border-[#1a2b40] text-[#2481cc] dark:text-[#2ba0ff]'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span className="truncate max-w-[160px]">人设: {activePersonaName}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (onOpenTranslation) {
                  onOpenTranslation();
                } else {
                  setIsTranslateBarVisible(true);
                  setIsLangMenuOpen((v) => !v);
                }
              }}
              title="配置发信自动翻译语言"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                activeRightPanel === 'translation'
                  ? 'bg-[#e8f3ff] border-[#bfdbfe] text-[#2481cc] dark:bg-[#132234] dark:border-[#2ba0ff]/45 dark:text-[#2ba0ff]'
                  : 'border-transparent text-[#475569] hover:text-[#2481cc] hover:bg-[#f1f5f9] dark:text-[#94a3b8] dark:hover:text-[#2ba0ff] dark:hover:bg-[#101c2d]'
              }`}
            >
              <Languages className="w-3.5 h-3.5 text-[#16a34a] dark:text-emerald-400" />
              <span>发送时自动译为: {getLanguageDisplayName(outboundTargetLang)}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsVoiceStudioOpen(true)}
            title="打开音色克隆与语音合成工作室"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[#64748b] hover:text-[#2481cc] hover:bg-[#f1f5f9] dark:text-[#94a3b8] dark:hover:text-[#2ba0ff] dark:hover:bg-[#101c2d] transition-colors cursor-pointer shrink-0"
          >
            <AudioWaveform className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">音色合成</span>
          </button>
        </div>

        {/* Main Input Container + Bottom Compact Action Row */}
        <div className="rounded-xl border border-[#e2e8f0] dark:border-[#18273a] bg-[#f8fafc] dark:bg-[#0e1726] focus-within:bg-white dark:focus-within:bg-[#101b2c] focus-within:border-[#2481cc] dark:focus-within:border-[#2ba0ff] transition-all">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              editingMessage
                ? '修改消息...'
                : pastedImage
                ? '添加图片说明（可选）...'
                : '输入消息（支持自动翻译与 Ctrl+V 粘贴图片）...'
            }
            className="w-full bg-transparent text-[#0f172a] dark:text-[#f5f7fa] text-[13.5px] px-3.5 pt-2.5 pb-1.5 focus:outline-none placeholder-[#94a3b8] dark:placeholder-[#7f93a5]"
          />

          <div className="px-2.5 pb-2 pt-1 flex items-center justify-between border-t border-[#e2e8f0]/60 dark:border-white/5">
            {/* Left Tools */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsAttachmentMenuOpen(!isAttachmentMenuOpen)}
                title="附加文件、图片或文档"
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                  isAttachmentMenuOpen
                    ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff]'
                    : 'hover:bg-[#e2e8f0]/60 dark:hover:bg-white/10 text-[#64748b] dark:text-[#a0acb8] hover:text-[#2481cc] dark:hover:text-white'
                }`}
              >
                <Paperclip className="w-4 h-4 -rotate-45" />
              </button>

              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                title="表情与贴纸"
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                  showEmojiPicker
                    ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff]'
                    : 'hover:bg-[#e2e8f0]/60 dark:hover:bg-white/10 text-[#64748b] dark:text-[#a0acb8] hover:text-[#2481cc] dark:hover:text-white'
                }`}
              >
                <Smile className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsVoiceStudioOpen(true)}
                title="语音合成"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#64748b] dark:text-[#a0acb8] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] hover:bg-[#e2e8f0]/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <AudioWaveform className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleGenerateAiSuggestion}
                disabled={isGeneratingAi}
                title="基于人设与最近30条对话生成 AI 拟真回复"
                className={`flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  isGeneratingAi
                    ? 'bg-[#e8f3ff] text-[#2481cc] dark:bg-[#2481cc]/20 dark:text-[#2ba0ff]'
                    : 'hover:bg-[#e8f3ff] text-[#2481cc] dark:text-[#2ba0ff] dark:hover:bg-[#2481cc]/15'
                }`}
              >
                <Sparkles className={`w-3.5 h-3.5 ${isGeneratingAi ? 'animate-spin' : ''}`} />
                <span>{isGeneratingAi ? '生成中...' : 'AI 建议回复'}</span>
              </button>
            </div>

            {/* Right Actions: Shortcut hint + Mic / Send Button */}
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[11px] text-[#94a3b8] dark:text-[#7f93a5] select-none">
                {sendWithEnter ? 'Enter 发送' : 'Ctrl+Enter 发送'}
              </span>

              {inputText.trim() || pastedImage ? (
                <button
                  type="button"
                  disabled={isSending}
                  onClick={pastedImage ? handleSendPastedImage : () => void handleSendText()}
                  title={editingMessage ? '保存修改' : pastedImage ? '发送照片' : '发送消息'}
                  className={`h-8 px-3.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shadow-xs shrink-0 ${
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
                      : 'bg-[#f1f5f9] hover:bg-[#e8f3ff] text-[#475569] hover:text-[#2481cc] dark:bg-[#202b36] dark:text-[#a0acb8] dark:hover:text-[#2ba0ff]'
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
      {messageContextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-[#17212b] border border-[#e0e4e8] dark:border-[#2b3848] rounded-2xl p-1.5 shadow-2xl min-w-[170px] text-xs select-none animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: `${messageContextMenu.x}px`,
            top: `${messageContextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quick Reaction Bar in Context Menu */}
          <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-black/5 dark:border-white/10">
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
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] text-[#111827] dark:text-white cursor-pointer font-medium"
          >
            <Reply className="w-4 h-4 text-[#2481cc]" />
            <span>回复消息</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const target = messageContextMenu.message;
              setMessageContextMenu(null);
              handleOpenForwardModal([target]);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] text-[#111827] dark:text-white cursor-pointer font-medium"
          >
            <Forward className="w-4 h-4 text-[#2481cc]" />
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
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] text-[#111827] dark:text-white cursor-pointer font-medium"
          >
            <CheckSquare className="w-4 h-4 text-[#707579] dark:text-[#a0acb8]" />
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
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] text-[#111827] dark:text-white cursor-pointer font-medium"
          >
            <Copy className="w-4 h-4 text-[#707579] dark:text-[#a0acb8]" />
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
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] text-[#111827] dark:text-white cursor-pointer font-medium"
            >
              <Languages className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff]" />
              <span>{messageContextMenu.message.translatedText ? '重新翻译' : '翻译此消息'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onTogglePinMessage?.(messageContextMenu.message.id);
              setMessageContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] text-[#111827] dark:text-white cursor-pointer font-medium"
          >
            <Pin className="w-4 h-4 text-[#707579] dark:text-[#a0acb8]" />
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
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-[#202b36] text-[#111827] dark:text-white cursor-pointer font-medium"
            >
              <Edit2 className="w-4 h-4 text-[#707579] dark:text-[#a0acb8]" />
              <span>编辑消息</span>
            </button>
          )}

          <div className="my-1 border-t border-black/5 dark:border-white/10" />

          <button
            type="button"
            onClick={() => {
              const target = messageContextMenu.message;
              setMessageContextMenu(null);
              setRevokeSingleDelete(true);
              setMessageToDelete(target);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-red-500/10 text-red-500 dark:text-red-400 cursor-pointer font-medium"
          >
            <Trash2 className="w-4 h-4 text-red-500" />
            <span>删除单条消息</span>
          </button>
        </div>
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
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
            <div className="bg-white dark:bg-[#1e2c3a] border border-[#e0e4e8] dark:border-[#2b3c4e] rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/10 dark:bg-red-500/20 text-red-500 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#111827] dark:text-white">
                    删除此条消息？
                  </h3>
                  <p className="text-xs text-[#707579] dark:text-[#7f93a5] mt-0.5">
                    {isLocalOnly
                      ? '该消息未送达 Telegram 云端，确认后将仅从本地列表移除。'
                      : messageToDelete.sender === 'me'
                        ? '确定删除您发送的这条消息吗？'
                        : '确定删除客户发送的这条消息吗？'}
                  </p>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-black/5 dark:bg-black/20 text-xs text-[#707579] dark:text-[#a0acb8] truncate border border-black/5 dark:border-white/5">
                “{messageToDelete.text || (messageToDelete.isAudio ? '🎤 语音消息' : messageToDelete.isVideo ? '🎬 视频消息' : messageToDelete.isImage ? '🖼️ 图片消息' : '消息内容')}”
              </div>

              {showRevokeOption && (
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-black/5 dark:bg-[#243242] cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={revokeSingleDelete}
                    onChange={(e) => setRevokeSingleDelete(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-[#2481cc] focus:ring-[#2481cc]"
                  />
                  <span className="text-[#111827] dark:text-[#eef4fb] leading-snug">
                    同时为对方删除 / 双向撤回
                  </span>
                </label>
              )}

              {showSupergroupHint && !showPeerGroupHint && (
                <p className="text-[11px] text-[#64748b] dark:text-[#9aa7b5] leading-snug">
                  提示：在超级群组/频道中删除消息将直接从云端对所有成员删除。
                </p>
              )}

              {showPeerGroupHint && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                  提示：在群组/频道中删除他人消息需要具备管理员删除权限，否则 Telegram 服务端将拒绝撤回（超级群组删除将对全员生效）。
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMessageToDelete(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#707579] dark:text-[#a0acb8] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteMessage}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-500 hover:bg-red-600 text-white shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1e2c3a] border border-[#e0e4e8] dark:border-[#2b3c4e] rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 dark:bg-red-500/20 text-red-500 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#111827] dark:text-white">
                  批量删除 {selectedMessageIds.size} 条消息？
                </h3>
                <p className="text-xs text-[#707579] dark:text-[#7f93a5] mt-0.5">
                  删除操作将同步到 Telegram 云端及本地记录，不可恢复。
                </p>
              </div>
            </div>

            {isTgUserChat && !isSupergroupOrChannel && (
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-black/5 dark:bg-[#243242] cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={revokeBatchDelete}
                  onChange={(e) => setRevokeBatchDelete(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 text-[#2481cc] focus:ring-[#2481cc]"
                />
                <span className="text-[#111827] dark:text-[#eef4fb] leading-snug">
                  同时为对方删除 / 双向撤回
                </span>
              </label>
            )}

            {isTgUserChat && isSupergroupOrChannel && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                提示：在超级群组/频道中批量删除将对所有成员生效；若包含他人消息需具备管理员权限。
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isBatchDeleting}
                onClick={() => setShowBatchDeleteModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-[#707579] dark:text-[#a0acb8] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isBatchDeleting}
                onClick={() => void handleConfirmBatchDelete()}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#17212b] border border-[#e0e4e8] dark:border-[#243547] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-4 py-3 border-b border-[#e0e4e8] dark:border-[#243547] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Forward className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff]" />
                <span className="font-semibold text-sm text-[#111827] dark:text-white">
                  转发 {forwardModalMessages.length} 条消息至...
                </span>
              </div>
              <button
                type="button"
                onClick={() => setForwardModalMessages(null)}
                className="p-1 text-[#707579] hover:text-[#111827] dark:text-[#7f93a5] dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 border-b border-[#e0e4e8] dark:border-[#243547] space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#707579] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={forwardSearch}
                  onChange={(e) => setForwardSearch(e.target.value)}
                  placeholder="搜索目标会话、联系人或群组..."
                  autoFocus
                  className="w-full bg-[#f0f2f5] dark:bg-[#202b36] pl-8 pr-3 py-1.5 rounded-lg text-xs text-[#111827] dark:text-white focus:outline-none border border-transparent focus:border-[#2ba0ff]/50"
                />
              </div>
              <label className="flex items-center gap-2 text-[11.5px] text-[#64748b] dark:text-[#9aa7b5] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forwardDropAuthor}
                  onChange={(e) => setForwardDropAuthor(e.target.checked)}
                  className="rounded border-gray-300 text-[#2481cc] focus:ring-[#2481cc]"
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
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#f0f7ff] dark:hover:bg-[#202b36] transition-colors text-left cursor-pointer disabled:opacity-50"
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
                      <div className="text-xs font-semibold text-[#111827] dark:text-white truncate">
                        {targetChat.title}
                      </div>
                      <div className="text-[11px] text-[#707579] dark:text-[#7f93a5] truncate">
                        {targetChat.username || (targetChat.isGroup ? '群组' : targetChat.isChannel ? '频道' : '私聊对话')}
                      </div>
                    </div>
                    <Forward className="w-3.5 h-3.5 text-[#2481cc] shrink-0" />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

