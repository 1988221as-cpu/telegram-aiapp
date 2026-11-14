declare const __APP_VERSION__: string | undefined;

export interface Account {
  id: string;
  name: string;
  username: string;
  phone: string;
  avatarUrl?: string;
  avatarBg: string;
  avatarInitial: string;
  unreadTotal: number;
  isActive: boolean;
  status: 'online' | 'offline' | 'away' | 'expired';
  bio?: string;
}

export interface Chat {
  id: string;
  accountId: string;
  title: string;
  avatarUrl?: string;
  avatarBg: string;
  avatarInitial: string;
  isGroup: boolean;
  isArchived?: boolean;
  isVerified?: boolean;
  isOnline?: boolean;
  statusText?: string;
  lastMessage: string;
  lastTime: string;
  unreadCount: number;
  sourceLang: string;
  targetLang: string;
  isPinned?: boolean;
  memberCount?: number;
  onlineCount?: number;
  isChannel?: boolean;
  isBot?: boolean;
  description?: string;
  username?: string;
  inviteLink?: string;
  pinnedMessageId?: string;
  isMuted?: boolean;
  readOutboxMaxId?: number;
  readInboxMaxId?: number;
  phone?: string;
  isBlocked?: boolean;
}

export interface TelegramChatParticipant {
  id: string;
  name: string;
  username?: string;
  role: 'creator' | 'admin' | 'member';
  isBot?: boolean;
  isOnline?: boolean;
  statusText?: string;
  avatarUrl?: string;
}

export interface TelegramChatFullInfo {
  ok: boolean;
  chatId: string;
  title?: string;
  username?: string;
  description?: string;
  isGroup?: boolean;
  isChannel?: boolean;
  isBot?: boolean;
  isVerified?: boolean;
  isOnline?: boolean;
  statusText?: string;
  phone?: string;
  isBlocked?: boolean;
  isContact?: boolean;
  isSelf?: boolean;
  memberCount?: number;
  onlineCount?: number;
  inviteLink?: string;
  participants?: TelegramChatParticipant[];
  participantsError?: string;
  code?: string;
  error?: string;
}

export interface TelegramStickerItem {
  docId: string;
  accessHash: string;
  fileReferenceBase64: string;
  setId: string;
  setAccessHash: string;
  shortName: string;
  emoji: string;
  mimeType: string;
  isAnimated: boolean;
  isVideo: boolean;
  thumbUrl: string;
}

export interface TelegramStickerPack {
  id: string;
  accessHash: string;
  shortName: string;
  title: string;
  count: number;
  stickers: TelegramStickerItem[];
}

export interface Message {
  id: string;
  telegramMessageId?: number;
  chatId: string;
  accountId: string;
  sender: 'me' | 'peer' | 'system';
  senderName?: string;
  text: string;
  translatedText?: string;
  translationError?: string;
  translationErrorChannel?: 'live_gemini' | 'live_custom_llm' | 'live_google' | 'history_google' | 'manual';
  isTranslating?: boolean;
  isAudio?: boolean;
  audioDuration?: number;
  audioUrl?: string;
  voiceName?: string;
  voiceTone?: string;
  isMasterVoice?: boolean;
  sttText?: string;
  isTranscribing?: boolean;
  isImage?: boolean;
  imageUrl?: string;
  imageCaption?: string;
  isVideo?: boolean;
  videoUrl?: string;
  videoDuration?: number;
  videoWidth?: number;
  videoHeight?: number;
  timestamp: string;
  createdAt?: number;
  status: 'sending' | 'sent' | 'read';
  deliveryStatus?: 'delivered' | 'failed' | 'retrying' | 'pending';
  replyTo?: { id: string; telegramMessageId?: number; senderName?: string; text: string };
  reactions?: Record<string, number>;
  myReactions?: string[];
  isPinned?: boolean;
  isEdited?: boolean;
  forwardFrom?: string;
  isFile?: boolean;
  fileName?: string;
  fileSize?: string;
  fileUrl?: string;
}

export interface MemberUser {
  id: string;
  username: string;
  role: string;
  plan?: string;
  vipExpiresAt?: number;
  boundDeviceId?: string;
  maxAccounts?: number;
}

export interface CustomLLMConfig {
  enabled: boolean;
  explicitlyDisabled?: boolean;
  engineMode?: 'cloud' | 'custom';
  engineLicenseKey?: string;
  protocol: 'openai' | 'gemini' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  customHeaders: string;
  useForTranslation: boolean;
  enableKnowledgeBaseRAG?: boolean;
  knowledgeBaseApiUrl?: string;
  knowledgeBaseApiKey?: string;
  pingStatus?: {
    ok: boolean;
    latencyMs?: number;
    message?: string;
  };
}

export interface TranslationSettings {
  defaultSourceLang: string;
  defaultTargetLang: string;
  autoTranslateInbound: boolean;
  autoTranslateOutbound: boolean;
  showOriginalAndTranslation: boolean;
  preferredEngine: 'gemini' | 'google' | 'custom_llm';
  geminiModel?: string;
  geminiApiKey?: string;
  googleApiKey?: string;
  customModelName?: string;
}

export interface CustomerMemoryItem {
  id: string;
  date: string;
  topic: string;
  summary: string;
  emotion?: string;
}

export interface CustomerProfile {
  chatId: string;
  accountId: string;
  clientName: string;
  relationshipStage: string;
  ageEstimate?: string;
  occupation?: string;
  locationTimezone?: string;
  toneStyle: string;
  likesInterests: string[];
  dislikesTaboos: string[];
  emotionalNeeds: string;
  keyMemories: CustomerMemoryItem[];
  totalMessagesCount: number;
  lastAnalyzedAt?: number;
  updatedAt: number;
}

export interface MasterVoiceprint {
  id: string;
  name: string;
  sampleAudioUrl?: string;
  duration: number;
  recordedAt: number;
  enabledAsDefault: boolean;
  pitch: number;
  rate: number;
  warmth: number;
  timbreTag: string;
  sampleTranscript: string;
  baseVoice?: 'Kore' | 'Zephyr' | 'Fenrir' | 'Puck' | 'Charon';
  gender?: 'female' | 'male';
  ttsModel?: string;
}

export interface TelegramContact {
  id: string;
  name: string;
  phone?: string;
  username?: string;
  avatarBg?: string;
  avatarInitial?: string;
  avatarUrl?: string;
  status?: 'online' | 'offline';
  statusText?: string;
  bio?: string;
  isBlocked?: boolean;
  isContact?: boolean;
}

export interface TelegramCallRecord {
  id: string;
  accountId?: string;
  contactName: string;
  avatarBg: string;
  avatarInitial: string;
  avatarUrl?: string;
  type: 'incoming' | 'outgoing' | 'missed';
  duration: string;
  timestamp: string;
  isVideo?: boolean;
}

export interface SystemProxyConfig {
  enabled: boolean;
  type: 'socks5' | 'socks4';
  host: string;
  port: number;
  username?: string;
  password?: string;
  hasPassword?: boolean;
}

export type StagedPromptKey = 'icebreaker' | 'dailyFriend' | 'emotionalLove' | 'wealthDiscussion' | 'trustDefense';

export interface GlobalPersonaConfig {
  personaName: string;
  personaRole: string;
  age: string;
  location: string;
  personalityTraits: string[];
  lifeStyleDetails: string;
  investmentPhilosophy: string;
  stagedPrompts: {
    icebreaker: string;
    dailyFriend: string;
    emotionalLove: string;
    wealthDiscussion: string;
    trustDefense: string;
  };
  tabooKeywords: string[];
  customSystemInstruction?: string;
  activeStage?: StagedPromptKey;
}

export interface KnowledgeBaseItem {
  id: string;
  category: 'icebreaker' | 'life_emotion' | 'wealth_investment' | 'trust_defense' | string;
  title: string;
  content: string;
  keywords: string[];
  source_type: 'manual_text' | 'import_file' | 'evolved_extraction';
  source_file?: string;
  is_active: number;
  hit_count: number;
  created_at: number;
  updated_at: number;
}

export interface EvolutionHabitItem {
  id: string;
  type: 'greeting' | 'emotional_bonding' | 'wealth_transition' | 'objection_handling' | 'favorite_phrase' | 'oral_slang' | 'chat_mirroring' | 'pacing_breath';
  title: string;
  description: string;
  examplePattern: string;
  confidenceScore: number;
  appliedCount: number;
  isActive: boolean;
  extractedAt: number;
}

export interface ChatTranscriptItem {
  id: string;
  title: string;
  description: string;
  dialogueText: string;
  learnedStyle: string;
  roundCount: number;
  characterCount: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EvolutionEngineState {
  version: string;
  lastEvolvedAt: number;
  totalConversationsAnalyzed: number;
  totalHabitsLearned: number;
  autoEvolutionActive: boolean;
  habits: EvolutionHabitItem[];
  transcripts?: ChatTranscriptItem[];
}

export interface EvolutionLogItem {
  id: string;
  log_type: string;
  details: string;
  items_learned: number;
  created_at: number;
}

