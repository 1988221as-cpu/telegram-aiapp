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
  connectionPhase?: 'online' | 'connecting' | 'reconnecting' | 'restoring' | 'offline' | 'expired';
  bio?: string;
  remark?: string;
  groupId?: string;
  lastError?: string | null;
  retryCount?: number;
  nextRetryAt?: number;
  lastConnectedAt?: number | null;
  floodWaitUntil?: number;
  floodWaitMethod?: string;
  peerFloodRestricted?: boolean;
  peerFloodReason?: string;
}

export interface AccountGroup {
  id: string;
  name: string;
  color?: string;
  collapsed?: boolean;
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
  lastDate?: number;
  unreadCount: number;
  sourceLang: string;
  targetLang: string;
  isPinned?: boolean;
  pinOrder?: number;
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
  hasCustomRemark?: boolean;
  translationEnabled?: boolean;
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

export interface TelegramCommonChatItem {
  id: string;
  title: string;
  username?: string;
  memberCount?: number;
  isChannel?: boolean;
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
  currentUserRole?: 'creator' | 'admin' | 'member';
  canRemoveMembers?: boolean;
  inviteLink?: string;
  participants?: TelegramChatParticipant[];
  participantsError?: string;
  commonChats?: TelegramCommonChatItem[];
  code?: string;
  error?: string;
}

export interface TelegramMessageReadParticipant {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  readAt?: number;
  isOnline?: boolean;
  statusText?: string;
}

export interface TelegramMessageReadParticipantsResponse {
  ok: boolean;
  chatId?: string;
  telegramMessageId?: number;
  participants?: TelegramMessageReadParticipant[];
  hint?: string;
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
  clientMessageId?: string;
  telegramMessageId?: number;
  chatId: string;
  accountId: string;
  sender: 'me' | 'peer' | 'system';
  senderName?: string;
  senderId?: string;
  senderAvatarUrl?: string;
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
  deliveryStatus?: 'delivered' | 'failed' | 'retrying' | 'pending' | 'paused';
  queuePauseReason?: string;
  floodWaitUntil?: number;
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
  isCall?: boolean;
  callType?: 'incoming' | 'outgoing' | 'missed';
  callDuration?: number;
  isVideoCall?: boolean;
  telegramCallId?: string;
  systemEventType?: 'join' | 'leave' | 'service';
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
  hasEngineLicenseKey?: boolean;
  protocol: 'auto' | 'openai' | 'gemini' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  hasApiKey?: boolean;
  modelName: string;
  temperature: number;
  customHeaders: string;
  useForTranslation: boolean;
  enableKnowledgeBaseRAG?: boolean;
  knowledgeBaseApiUrl?: string;
  knowledgeBaseApiKey?: string;
  hasKnowledgeBaseApiKey?: boolean;
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
  autoTranslateGroups?: boolean;
  autoTranslatePrivate?: boolean;
  showOriginalAndTranslation: boolean;
  preferredEngine: 'gemini' | 'google' | 'custom_llm';
  geminiModel?: string;
  geminiApiKey?: string;
  hasGeminiApiKey?: boolean;
  googleApiKey?: string;
  hasGoogleApiKey?: boolean;
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
  familyMaritalStatus?: string;
  activeSchedule?: string;
  toneStyle: string;
  likesInterests: string[];
  dislikesTaboos: string[];
  emotionalNeeds: string;
  financialProfile?: string;
  investmentAttitude?: string;
  trustLevel?: string;
  nextStepStrategy?: string;
  keyMemories: CustomerMemoryItem[];
  totalMessagesCount: number;
  lastAnalyzedAt?: number;
  updatedAt: number;
}

export type VoiceCloneProvider =
  | 'elevenlabs'
  | 'siliconflow_cosyvoice'
  | 'fish_audio'
  | 'gpt_sovits'
  | 'openai_clone_compat';

export interface MasterVoiceprint {
  id: string;
  name: string;
  enabledAsDefault: boolean;
  pitch: number;
  rate: number;
  timbreTag: string;
  baseVoice?: 'Kore' | 'Zephyr' | 'Fenrir' | 'Puck' | 'Charon';
  gender?: 'female' | 'male';
  ttsModel?: string;
  updatedAt?: number;
  cloneMode?: 'preset' | 'voice_clone';
  sampleId?: string;
  sampleFileName?: string;
  sampleMimeType?: string;
  cloneProvider?: VoiceCloneProvider;
  cloneGatewayUrl?: string;
  cloneApiKey?: string;
  hasCloneApiKey?: boolean;
  cloneVoiceId?: string;
  sampleAudioUrl?: string;
  duration?: number;
  recordedAt?: number;
  warmth?: number;
  sampleTranscript?: string;
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
  chatId?: string;
  telegramCallId?: string;
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
  accountId?: string;
  category: 'icebreaker' | 'life_emotion' | 'wealth_investment' | 'trust_defense' | string;
  title: string;
  content: string;
  keywords: string[];
  sourceType: 'manual_text' | 'file_upload' | 'auto_chat_distill' | 'manual_distill' | string;
  sourceFile?: string;
  isActive: boolean;
  hitCount: number;
  createdAt: number;
  updatedAt: number;
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
  accountId?: string;
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
  lastLearnedMessageCreatedAt?: number;
  totalConversationsAnalyzed: number;
  totalHabitsLearned: number;
  autoEvolutionActive: boolean;
  habits: EvolutionHabitItem[];
  transcripts?: ChatTranscriptItem[];
}

export interface EvolutionLogItem {
  id: string;
  accountId?: string;
  logType: string;
  details: string;
  itemsLearned: number;
  createdAt: number;
}

export type AppThemeMode = 'light' | 'dark' | 'aurora' | 'linen';

export type OfficialThemePresetId =
  | 'tg_classic'
  | 'tg_day_blue'
  | 'tg_night'
  | 'tg_tinted'
  | 'aurora'
  | 'linen';

export type OfficialWallpaperId =
  | 'default'
  | 'tg_doodle'
  | 'tg_sky'
  | 'tg_ocean'
  | 'tg_sunset'
  | 'solid';

export type BubbleCornerStyle = 'compact' | 'standard' | 'rounded';

export interface ChatAppearanceSettings {
  presetId: OfficialThemePresetId;
  baseTheme: AppThemeMode;
  accentColor: string | null; // null = theme default accent
  wallpaperId: OfficialWallpaperId;
  wallpaperIntensity: number; // 0..100
  bubbleStyle: BubbleCornerStyle;
}

export interface WorkflowPlaybookItem {
  day: number;
  label: string;
  title: string;
  keywords?: string[];
  content: string;
}

export interface AiQaMatchedKnowledge {
  id: string | number;
  title: string;
  category?: string;
  contentPreview?: string;
  finalScore?: number;
  appliedLikely?: boolean;
  appliedSignals?: string[];
}

export interface AiQaTurnMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}

export interface AiQaResponse {
  ok: boolean;
  answer: string;
  question?: string;
  imageCount?: number;
  model?: string;
  knowledgeUsed?: boolean;
  matchedCount?: number;
  expandedChineseQuery?: string;
  matchedKnowledge?: AiQaMatchedKnowledge[];
  code?: string;
  error?: string;
  message?: string;
}

export interface AiQaLocalChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images?: string[];
  createdAt: number;
  model?: string;
  knowledgeUsed?: boolean;
  matchedCount?: number;
  matchedKnowledge?: AiQaMatchedKnowledge[];
  errorCode?: string;
  isError?: boolean;
}


