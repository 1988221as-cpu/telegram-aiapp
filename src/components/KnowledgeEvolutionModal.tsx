import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  X,
  Check,
  Compass,
  Layers,
  Coffee,
  Heart,
  DollarSign,
  ShieldCheck,
  MessageCircle,
  RotateCcw,
  Users,
  Cloud,
  UserCheck,
  BookOpen,
  FileText,
  Cpu,
  Plus,
  Upload,
  Trash2,
  Edit3,
  Power,
  Search,
  Download,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  GlobalPersonaConfig,
  StagedPromptKey,
  CustomLLMConfig,
  KnowledgeBaseItem,
  ChatTranscriptItem,
  EvolutionEngineState,
  EvolutionLogItem,
  Chat,
  Message,
} from '../types';
import {
  fetchGlobalPersonaApi,
  saveGlobalPersonaApi,
  resetGlobalPersonaApi,
  importPersonaTemplateApi,
  testPersonaReplyApi,
  fetchKnowledgeItemsApi,
  createKnowledgeItemApi,
  updateKnowledgeItemApi,
  deleteKnowledgeItemApi,
  toggleKnowledgeItemApi,
  clearAllKnowledgeApi,
  uploadKnowledgeDocApi,
  fetchTranscriptsApi,
  createTranscriptApi,
  importTranscriptFromChatApi,
  deleteTranscriptApi,
  toggleTranscriptApi,
  fetchEvolutionStatusApi,
  triggerEvolutionLearnApi,
  toggleEvolutionHabitApi,
} from '../services/apiService';

interface KnowledgeEvolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  customConfig?: CustomLLMConfig;
  embedded?: boolean;
  activeAccountId?: string;
  activeChatId?: string | null;
  currentChat?: Chat | null;
  currentMessages?: Message[];
}

type ModalTab = 'persona' | 'knowledge' | 'transcripts' | 'evolution' | 'sandbox';

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'icebreaker', label: '初识破冰' },
  { value: 'life_emotion', label: '生活情绪' },
  { value: 'wealth_investment', label: '专业价值' },
  { value: 'trust_defense', label: '信任化解' },
];

const CATEGORY_LABELS: Record<string, string> = {
  icebreaker: '初识破冰',
  life_emotion: '生活情绪',
  wealth_investment: '专业价值',
  trust_defense: '信任化解',
};

const HABIT_TYPE_LABELS: Record<string, string> = {
  oral_slang: '口语助词',
  chat_mirroring: '对话同频',
  pacing_breath: '短句呼吸',
  emotional_bonding: '情绪共鸣',
  wealth_transition: '价值过渡',
  objection_handling: '顾虑化解',
  greeting: '开场问候',
  favorite_phrase: '高频表达',
};

function formatDateTime(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return '暂无';
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '暂无';
  }
}

export const KnowledgeEvolutionModal: React.FC<KnowledgeEvolutionModalProps> = ({
  isOpen,
  onClose,
  customConfig,
  embedded = false,
  activeAccountId,
  activeChatId,
  currentChat,
  currentMessages,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('persona');

  const isDualOffMode = Boolean(
    customConfig && (customConfig.enabled === false || customConfig.explicitlyDisabled === true)
  );
  const isCustomLlmMode = Boolean(
    customConfig && !isDualOffMode && customConfig.engineMode === 'custom'
  );
  const isCloudLlmMode = !isDualOffMode && !isCustomLlmMode;

  // 1. Persona State
  const [persona, setPersona] = useState<GlobalPersonaConfig | null>(null);
  const [isLoadingPersona, setIsLoadingPersona] = useState<boolean>(false);
  const [activeStageEdit, setActiveStageEdit] = useState<StagedPromptKey>('icebreaker');
  const [isSavingPersona, setIsSavingPersona] = useState<boolean>(false);
  const [personaSaveSuccess, setPersonaSaveSuccess] = useState<boolean>(false);
  const [isResettingPersona, setIsResettingPersona] = useState<boolean>(false);
  const [isImportingTemplate, setIsImportingTemplate] = useState<boolean>(false);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<'reset' | 'import' | null>(null);
  const [personaActionError, setPersonaActionError] = useState<string>('');
  const [traitInput, setTraitInput] = useState<string>('');
  const [tabooInput, setTabooInput] = useState<string>('');
  const [savedPersonaSnapshot, setSavedPersonaSnapshot] = useState<string>('');

  // 2. Local Knowledge Base State
  const [kbItems, setKbItems] = useState<KnowledgeBaseItem[]>([]);
  const [kbLogs, setKbLogs] = useState<EvolutionLogItem[]>([]);
  const [kbStats, setKbStats] = useState<{
    totalItems: number;
    activeItemsCount?: number;
    autoLearnedCount: number;
    customDocCount: number;
    totalHits: number;
  }>({
    totalItems: 0,
    activeItemsCount: 0,
    autoLearnedCount: 0,
    customDocCount: 0,
    totalHits: 0,
  });
  const [isLoadingKb, setIsLoadingKb] = useState<boolean>(false);
  const [kbFilterCategory, setKbFilterCategory] = useState<string>('all');
  const [kbSearch, setKbSearch] = useState<string>('');
  const [kbFeedback, setKbFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Manual CRUD form
  const [showKbForm, setShowKbForm] = useState<boolean>(false);
  const [editingKbId, setEditingKbId] = useState<string | null>(null);
  const [kbFormCategory, setKbFormCategory] = useState<string>('life_emotion');
  const [kbFormTitle, setKbFormTitle] = useState<string>('');
  const [kbFormContent, setKbFormContent] = useState<string>('');
  const [kbFormKeywords, setKbFormKeywords] = useState<string>('');
  const [isSavingKb, setIsSavingKb] = useState<boolean>(false);

  // Document Upload & Chunked Training
  const [uploadCategory, setUploadCategory] = useState<string>('auto');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingDoc, setIsUploadingDoc] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmClearKb, setConfirmClearKb] = useState<boolean>(false);
  const [confirmDeleteKbId, setConfirmDeleteKbId] = useState<string | null>(null);

  // 3. Full Dialogue Transcripts State
  const [transcripts, setTranscripts] = useState<ChatTranscriptItem[]>([]);
  const [isLoadingTranscripts, setIsLoadingTranscripts] = useState<boolean>(false);
  const [transcriptFeedback, setTranscriptFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [importChatCustomTitle, setImportChatCustomTitle] = useState<string>('');
  const [isImportingChatTranscript, setIsImportingChatTranscript] = useState<boolean>(false);
  const [showTranscriptForm, setShowTranscriptForm] = useState<boolean>(false);
  const [newTransTitle, setNewTransTitle] = useState<string>('');
  const [newTransDesc, setNewTransDesc] = useState<string>('');
  const [newTransDialogue, setNewTransDialogue] = useState<string>('');
  const [newTransStyle, setNewTransStyle] = useState<string>('');
  const [isCreatingTranscript, setIsCreatingTranscript] = useState<boolean>(false);
  const [expandedTranscriptId, setExpandedTranscriptId] = useState<string | null>(null);
  const [confirmDeleteTranscriptId, setConfirmDeleteTranscriptId] = useState<string | null>(null);

  // 4. Self-Evolution Engine State
  const [evolutionState, setEvolutionState] = useState<EvolutionEngineState | null>(null);
  const [evolutionLogs, setEvolutionLogs] = useState<EvolutionLogItem[]>([]);
  const [isLoadingEvolution, setIsLoadingEvolution] = useState<boolean>(false);
  const [evolutionSampleInput, setEvolutionSampleInput] = useState<string>('');
  const [isRunningEvolution, setIsRunningEvolution] = useState<boolean>(false);
  const [evolutionFeedback, setEvolutionFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 5. Sandbox State
  const [sandboxStage, setSandboxStage] = useState<StagedPromptKey>('icebreaker');
  const [sandboxInput, setSandboxInput] = useState<string>('');
  const [sandboxRecentHistory, setSandboxRecentHistory] = useState<string>('');
  const [showRecentHistoryInput, setShowRecentHistoryInput] = useState<boolean>(false);
  const [sandboxChatTranscript, setSandboxChatTranscript] = useState<string>('');
  const [showTranscriptInput, setShowTranscriptInput] = useState<boolean>(false);
  const [sandboxResult, setSandboxResult] = useState<{
    reply: string;
    matchedKnowledge: any[];
    ragSources?: {
      cloudRagEnabled?: boolean;
      localRagEnabled?: boolean;
      cloudRagMatchedCount?: number;
      localRagMatchedCount?: number;
    };
    appliedHabits: any[];
    source: string;
  } | null>(null);
  const [isTestingReply, setIsTestingReply] = useState<boolean>(false);
  const [sandboxError, setSandboxError] = useState<string>('');

  useEffect(() => {
    if (!isOpen && !embedded) return;
    loadPersonaData();
    loadKnowledgeData();
    loadTranscriptsData();
    loadEvolutionData();
  }, [isOpen, embedded, activeAccountId]);

  const buildNormalizedPersonaPayload = (
    p: GlobalPersonaConfig,
    traitsDraft: string,
    taboosDraft: string
  ): GlobalPersonaConfig => ({
    ...p,
    personalityTraits: traitsDraft
      .split(/[,，\n]+/)
      .map((t) => t.trim())
      .filter(Boolean),
    tabooKeywords: taboosDraft
      .split(/[,，\n]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  });

  const serializePersonaSnapshot = (p: GlobalPersonaConfig) =>
    JSON.stringify({
      personaName: p.personaName || '',
      personaRole: p.personaRole || '',
      age: p.age || '',
      location: p.location || '',
      personalityTraits: p.personalityTraits || [],
      lifeStyleDetails: p.lifeStyleDetails || '',
      investmentPhilosophy: p.investmentPhilosophy || '',
      tabooKeywords: p.tabooKeywords || [],
      activeStage: p.activeStage || 'icebreaker',
      stagedPrompts: p.stagedPrompts || {},
      customSystemInstruction: p.customSystemInstruction || '',
    });

  const syncLoadedPersonaState = (loaded: GlobalPersonaConfig) => {
    const traitsStr = (loaded.personalityTraits || []).join(', ');
    const taboosStr = (loaded.tabooKeywords || []).join(', ');
    setPersona(loaded);
    setTraitInput(traitsStr);
    setTabooInput(taboosStr);
    setSavedPersonaSnapshot(
      serializePersonaSnapshot(buildNormalizedPersonaPayload(loaded, traitsStr, taboosStr))
    );
    if (loaded.activeStage) {
      setActiveStageEdit(loaded.activeStage);
      setSandboxStage(loaded.activeStage);
    }
  };

  const loadPersonaData = async () => {
    setIsLoadingPersona(true);
    try {
      const pRes = await fetchGlobalPersonaApi(activeAccountId);
      if (pRes.success && pRes.persona) {
        syncLoadedPersonaState(pRes.persona);
      }
    } catch (err) {
      console.error('Failed to load persona data:', err);
    } finally {
      setIsLoadingPersona(false);
    }
  };

  const loadKnowledgeData = async () => {
    setIsLoadingKb(true);
    try {
      const res = await fetchKnowledgeItemsApi(activeAccountId);
      if (res.error) {
        setKbFeedback({ type: 'error', text: res.error });
      }
      setKbItems(res.items || []);
      setKbLogs(res.logs || []);
      if (res.stats) {
        setKbStats(res.stats);
      }
    } catch (err: any) {
      setKbFeedback({ type: 'error', text: err?.message || '加载本地知识库失败' });
    } finally {
      setIsLoadingKb(false);
    }
  };

  const loadTranscriptsData = async () => {
    setIsLoadingTranscripts(true);
    try {
      const res = await fetchTranscriptsApi(activeAccountId);
      if (!res.success) {
        setTranscriptFeedback({ type: 'error', text: res.error || '加载整文范本库失败' });
      } else {
        setTranscripts(res.transcripts || []);
      }
    } catch (err: any) {
      setTranscriptFeedback({ type: 'error', text: err?.message || '加载整文范本库异常' });
    } finally {
      setIsLoadingTranscripts(false);
    }
  };

  const loadEvolutionData = async () => {
    setIsLoadingEvolution(true);
    try {
      const res = await fetchEvolutionStatusApi(activeAccountId);
      if (res.success && res.state) {
        setEvolutionState(res.state);
        setEvolutionLogs(res.logs || []);
      } else if (!res.success && res.error) {
        setEvolutionFeedback({ type: 'error', text: res.error });
      }
    } catch (err: any) {
      setEvolutionFeedback({ type: 'error', text: err?.message || '加载自进化引擎状态失败' });
    } finally {
      setIsLoadingEvolution(false);
    }
  };

  // ==================== PERSONA HANDLERS ====================
  const handleSavePersona = async (): Promise<boolean> => {
    if (!persona) return false;
    setIsSavingPersona(true);
    setPersonaActionError('');
    try {
      const normalizedPersona = buildNormalizedPersonaPayload(persona, traitInput, tabooInput);
      const res = await saveGlobalPersonaApi(normalizedPersona, activeAccountId);
      if (res.success) {
        const finalPersona = res.persona || normalizedPersona;
        const nextTraitsStr = (finalPersona.personalityTraits || []).join(', ');
        const nextTaboosStr = (finalPersona.tabooKeywords || []).join(', ');
        setPersona(finalPersona);
        setTraitInput(nextTraitsStr);
        setTabooInput(nextTaboosStr);
        setSavedPersonaSnapshot(
          serializePersonaSnapshot(buildNormalizedPersonaPayload(finalPersona, nextTraitsStr, nextTaboosStr))
        );
        setPersonaSaveSuccess(true);
        setTimeout(() => setPersonaSaveSuccess(false), 3000);
        return true;
      } else {
        setPersonaActionError((res as any)?.error || '保存人设配置失败，请重试');
        return false;
      }
    } catch (err: any) {
      console.error(err);
      setPersonaActionError(err?.message || '保存人设配置异常');
      return false;
    } finally {
      setIsSavingPersona(false);
    }
  };

  const handleResetPersona = () => {
    setPersonaActionError('');
    setPendingConfirmAction('reset');
  };

  const executeResetPersona = async () => {
    setIsResettingPersona(true);
    setPersonaActionError('');
    try {
      const res = await resetGlobalPersonaApi(activeAccountId);
      if (res.success && res.persona) {
        syncLoadedPersonaState(res.persona);
        setPendingConfirmAction(null);
        setPersonaSaveSuccess(true);
        setTimeout(() => setPersonaSaveSuccess(false), 3000);
      } else {
        setPersonaActionError((res as any)?.error || '清空全局人设失败，请重试');
      }
    } catch (err: any) {
      console.error('Failed to reset persona:', err);
      setPersonaActionError(err?.message || '清空全局人设异常');
    } finally {
      setIsResettingPersona(false);
    }
  };

  const handleImportTemplate = () => {
    setPersonaActionError('');
    setPendingConfirmAction('import');
  };

  const executeImportTemplate = async () => {
    setIsImportingTemplate(true);
    setPersonaActionError('');
    try {
      const res = await importPersonaTemplateApi(activeAccountId);
      if (res.success && res.persona) {
        syncLoadedPersonaState(res.persona);
        setPendingConfirmAction(null);
        setPersonaSaveSuccess(true);
        setTimeout(() => setPersonaSaveSuccess(false), 3000);
      } else {
        setPersonaActionError((res as any)?.error || '导入参考人设模板失败，请重试');
      }
    } catch (err: any) {
      console.error('Failed to import persona template:', err);
      setPersonaActionError(err?.message || '导入参考人设模板异常');
    } finally {
      setIsImportingTemplate(false);
    }
  };

  // ==================== KNOWLEDGE BASE HANDLERS ====================
  const resetKbForm = () => {
    setEditingKbId(null);
    setKbFormCategory('life_emotion');
    setKbFormTitle('');
    setKbFormContent('');
    setKbFormKeywords('');
    setShowKbForm(false);
  };

  const handleStartEditKb = (item: KnowledgeBaseItem) => {
    setEditingKbId(item.id);
    setKbFormCategory(CATEGORY_LABELS[item.category] ? item.category : 'life_emotion');
    setKbFormTitle(item.title || '');
    setKbFormContent(item.content || '');
    setKbFormKeywords((item.keywords || []).join(', '));
    setShowKbForm(true);
    setKbFeedback(null);
  };

  const handleSaveKbItem = async () => {
    const title = kbFormTitle.trim();
    const content = kbFormContent.trim();
    if (!title || !content) {
      setKbFeedback({ type: 'error', text: '请填写知识条目标题与正文内容' });
      return;
    }
    const keywords = kbFormKeywords
      .split(/[,，\n]+/)
      .map((k) => k.trim())
      .filter(Boolean);

    setIsSavingKb(true);
    setKbFeedback(null);
    try {
      if (editingKbId) {
        const res = await updateKnowledgeItemApi(editingKbId, {
          category: kbFormCategory,
          title,
          content,
          keywords,
          accountId: activeAccountId,
        });
        if (!res.success) {
          setKbFeedback({ type: 'error', text: res.error || '更新知识条目失败' });
          return;
        }
        setKbFeedback({ type: 'success', text: `已更新知识条目「${title}」` });
      } else {
        const res = await createKnowledgeItemApi({
          category: kbFormCategory,
          title,
          content,
          keywords,
          accountId: activeAccountId,
        });
        if (!res.success) {
          setKbFeedback({ type: 'error', text: res.error || '新增知识条目失败' });
          return;
        }
        setKbFeedback({ type: 'success', text: `已添加并训练知识条目「${title}」` });
      }
      resetKbForm();
      await loadKnowledgeData();
    } finally {
      setIsSavingKb(false);
    }
  };

  const handleToggleKbItem = async (id: string) => {
    setKbFeedback(null);
    const res = await toggleKnowledgeItemApi(id, activeAccountId);
    if (!res.success) {
      setKbFeedback({ type: 'error', text: res.error || '切换启用状态失败' });
      return;
    }
    await loadKnowledgeData();
  };

  const handleDeleteKbItem = async (id: string) => {
    setKbFeedback(null);
    const res = await deleteKnowledgeItemApi(id, activeAccountId);
    if (!res.success) {
      setKbFeedback({ type: 'error', text: res.error || '删除知识条目失败' });
      return;
    }
    setConfirmDeleteKbId(null);
    setKbFeedback({ type: 'success', text: '已删除该知识条目' });
    await loadKnowledgeData();
  };

  const handleClearAllKb = async () => {
    setKbFeedback(null);
    const res = await clearAllKnowledgeApi(kbFilterCategory, activeAccountId);
    if (!res.success) {
      setKbFeedback({ type: 'error', text: res.error || '清空知识库失败' });
      return;
    }
    setConfirmClearKb(false);
    setKbFeedback({
      type: 'success',
      text:
        kbFilterCategory === 'all'
          ? '已清空当前账号全部本地知识条目'
          : `已清空分类「${CATEGORY_LABELS[kbFilterCategory] || kbFilterCategory}」条目`,
    });
    await loadKnowledgeData();
  };

  const handleUploadDocument = async () => {
    if (!selectedFile) {
      setKbFeedback({ type: 'error', text: '请先选择要解析训练的文档 (.txt / .md / .csv / .json / .pdf)' });
      return;
    }
    setIsUploadingDoc(true);
    setKbFeedback(null);
    try {
      const res = await uploadKnowledgeDocApi({
        file: selectedFile,
        category: uploadCategory,
        customConfig,
        accountId: activeAccountId,
      });
      if (!res.success) {
        setKbFeedback({ type: 'error', text: res.error || '文档解析训练失败' });
        return;
      }
      const chunksNote = res.totalChunks && res.totalChunks > 1 ? `（共 ${res.totalChunks} 段安全切片）` : '';
      const dupNote = res.skippedDuplicates ? `，去重跳过 ${res.skippedDuplicates} 条` : '';
      setKbFeedback({
        type: 'success',
        text: `文档《${selectedFile.name}》解析成功 [${res.detectedEncoding || 'utf-8'}]，入库 ${res.itemsLearned || 0} 条知识${chunksNote}${dupNote}`,
      });
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await loadKnowledgeData();
    } catch (err: any) {
      setKbFeedback({ type: 'error', text: err?.message || '文档上传异常' });
    } finally {
      setIsUploadingDoc(false);
    }
  };

  // ==================== TRANSCRIPTS HANDLERS ====================
  const handleImportFromCurrentChat = async () => {
    if (!activeChatId) {
      setTranscriptFeedback({ type: 'error', text: '请先在左侧聊天列表中选中一位客户会话，再执行一键导入' });
      return;
    }
    setIsImportingChatTranscript(true);
    setTranscriptFeedback(null);
    try {
      const res = await importTranscriptFromChatApi({
        chatId: activeChatId,
        accountId: activeAccountId,
        customTitle: importChatCustomTitle.trim() || undefined,
        chatTitle: currentChat?.title || undefined,
        messages: currentMessages,
        customConfig,
      });
      if (!res.success) {
        setTranscriptFeedback({
          type: 'error',
          text: res.error || '从当前客户导入整文失败',
        });
        return;
      }
      setImportChatCustomTitle('');
      setTranscriptFeedback({
        type: 'success',
        text: `已导入《${res.title}》（${res.roundCount || 0} 轮 / ${res.characterCount || 0} 字），并提炼风格：${res.learnedStyle || '已生成'}`,
      });
      await loadTranscriptsData();
    } catch (err: any) {
      setTranscriptFeedback({
        type: 'error',
        text: err?.message || '从当前客户导入整文异常',
      });
    } finally {
      setIsImportingChatTranscript(false);
    }
  };

  const handleCreateTranscript = async () => {
    const title = newTransTitle.trim();
    const dialogueText = newTransDialogue.trim();
    if (!title || !dialogueText) {
      setTranscriptFeedback({ type: 'error', text: '请填写范本标题与整篇对话实录内容' });
      return;
    }
    setIsCreatingTranscript(true);
    setTranscriptFeedback(null);
    try {
      const res = await createTranscriptApi({
        title,
        description: newTransDesc.trim(),
        dialogueText,
        learnedStyle: newTransStyle.trim() || undefined,
        customConfig,
        accountId: activeAccountId,
      });
      if (!res.success) {
        setTranscriptFeedback({ type: 'error', text: res.error || '保存整文范本失败' });
        return;
      }
      setNewTransTitle('');
      setNewTransDesc('');
      setNewTransDialogue('');
      setNewTransStyle('');
      setShowTranscriptForm(false);
      setTranscriptFeedback({
        type: 'success',
        text: `已新增整文范本《${title}》，提炼风格：${res.learnedStyle || '已保存'}`,
      });
      await loadTranscriptsData();
    } catch (err: any) {
      setTranscriptFeedback({
        type: 'error',
        text: err?.message || '保存整文范本异常',
      });
    } finally {
      setIsCreatingTranscript(false);
    }
  };

  const handleToggleTranscript = async (id: string) => {
    setTranscriptFeedback(null);
    const res = await toggleTranscriptApi(id, activeAccountId);
    if (!res.success) {
      setTranscriptFeedback({ type: 'error', text: res.error || '切换整文范本状态失败' });
      return;
    }
    await loadTranscriptsData();
  };

  const handleDeleteTranscript = async (id: string) => {
    setTranscriptFeedback(null);
    const res = await deleteTranscriptApi(id, activeAccountId);
    if (!res.success) {
      setTranscriptFeedback({ type: 'error', text: res.error || '删除整文范本失败' });
      return;
    }
    setConfirmDeleteTranscriptId(null);
    setTranscriptFeedback({ type: 'success', text: '已删除该整文范本' });
    await loadTranscriptsData();
  };

  // ==================== EVOLUTION HANDLERS ====================
  const handleRunEvolutionLearn = async () => {
    setIsRunningEvolution(true);
    setEvolutionFeedback(null);
    try {
      const sampleTexts = evolutionSampleInput
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 10);
      const res = await triggerEvolutionLearnApi(
        sampleTexts.length > 0 ? sampleTexts : undefined,
        customConfig,
        undefined,
        activeAccountId
      );
      if (!res.success) {
        setEvolutionFeedback({ type: 'error', text: res.error || '自进化学习失败' });
        return;
      }
      if (res.state) {
        setEvolutionState(res.state);
      }
      setEvolutionSampleInput('');
      const skippedMsg = res.skippedDuplicateHabits ? `，去重跳过 ${res.skippedDuplicateHabits} 项重复技巧` : '';
      const syncMsg = res.syncedToBackendLlm ? '，并已同步至后台引擎' : '';
      setEvolutionFeedback({
        type: 'success',
        text: `学习完成：分析 ${res.analyzedConversationsCount || 0} 组会话语料，新增 ${res.newHabitsLearned || 0} 项实战习惯${skippedMsg}${syncMsg}`,
      });
      await loadEvolutionData();
    } catch (err: any) {
      setEvolutionFeedback({
        type: 'error',
        text: err?.message || '自进化学习请求异常',
      });
    } finally {
      setIsRunningEvolution(false);
    }
  };

  const handleToggleHabit = async (habitId: string) => {
    setEvolutionFeedback(null);
    const res = await toggleEvolutionHabitApi(habitId, activeAccountId);
    if (!res.success) {
      setEvolutionFeedback({ type: 'error', text: res.error || '切换习惯状态失败' });
      return;
    }
    if (res.state) {
      setEvolutionState(res.state);
    } else {
      await loadEvolutionData();
    }
  };

  // ==================== SANDBOX HANDLER ====================
  const handleRunSandbox = async () => {
    if (!sandboxInput.trim()) return;
    setIsTestingReply(true);
    setSandboxError('');
    setSandboxResult(null);
    try {
      const res = await testPersonaReplyApi({
        message: sandboxInput.trim(),
        stage: sandboxStage,
        recentChatHistory: sandboxRecentHistory.trim() || undefined,
        chatTranscript: sandboxChatTranscript.trim() || undefined,
        customConfig,
        accountId: activeAccountId,
      });
      if (res.success) {
        setSandboxResult({
          reply: res.reply || '无回复内容',
          matchedKnowledge: res.matchedKnowledge || [],
          ragSources: res.ragSources,
          appliedHabits: res.appliedHabits || [],
          source: res.source || 'lingxi-cloud',
        });
      } else {
        setSandboxResult(null);
        setSandboxError(res.error || '试聊演算失败，请检查云端引擎或认证状态');
      }
    } catch (err: any) {
      setSandboxResult(null);
      setSandboxError(err?.message || '试聊请求异常');
    } finally {
      setIsTestingReply(false);
    }
  };

  if (!isOpen && !embedded) return null;

  const hasUnsavedPersonaChanges = Boolean(
    persona &&
      savedPersonaSnapshot &&
      serializePersonaSnapshot(buildNormalizedPersonaPayload(persona, traitInput, tabooInput)) !==
        savedPersonaSnapshot
  );

  const filteredKbItems = kbItems.filter((item) => {
    if (kbFilterCategory !== 'all' && item.category !== kbFilterCategory) return false;
    const q = kbSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      item.title?.toLowerCase().includes(q) ||
      item.content?.toLowerCase().includes(q) ||
      (item.keywords || []).some((k) => k.toLowerCase().includes(q))
    );
  });

  const innerContent = (
    <>
      {/* Modal Top Bar (Standalone Modal Mode Only) */}
      {!embedded && (
        <header className="px-6 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-between shrink-0 bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#2481cc]/12 dark:bg-[#2ba0ff]/12 aurora:bg-[#14b8a6]/15 linen:bg-[#a86a43]/15 border border-[#2481cc]/25 dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/30 linen:border-[#a86a43]/30 flex items-center justify-center text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                人设与知识进化中心
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-black/5 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
      )}

      {/* Tab Bar */}
      <div
        className={`${
          embedded ? 'px-3 pt-2' : 'px-6 pt-3'
        } pb-0 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc]/80 dark:bg-[#0d1726]/80 aurora:bg-[#0e1920]/80 linen:bg-[#f0e6d5]/85 flex items-center justify-between shrink-0 overflow-x-auto`}
      >
        <div className="flex items-center gap-1">
          {[
            { id: 'persona', label: embedded ? '人设' : '人设与五阶提示词', icon: Users },
            { id: 'knowledge', label: embedded ? '知识库' : '本地知识库', icon: BookOpen },
            { id: 'transcripts', label: embedded ? '整文库' : '整文范本库', icon: FileText },
            { id: 'evolution', label: embedded ? '自进化' : '自进化引擎', icon: Cpu },
            { id: 'sandbox', label: embedded ? '试聊' : '人设效果试聊', icon: Send },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const isLocalOnlyTab = tab.id === 'knowledge' || tab.id === 'transcripts';
            const showInactiveTag = isLocalOnlyTab && !isCustomLlmMode;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ModalTab)}
                className={`${
                  embedded ? 'px-2.5 py-2 text-[11px]' : 'px-3.5 py-2.5 text-xs sm:text-sm'
                } font-medium rounded-t-lg transition-all flex items-center gap-1.5 border-b-2 cursor-pointer whitespace-nowrap ${
                  active
                    ? 'text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#a86a43] bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7]'
                    : showInactiveTag
                    ? 'text-[#94a3b8] dark:text-[#5b748f] aurora:text-[#5d7b86] linen:text-[#8a7662] border-transparent hover:text-[#475569] dark:hover:text-[#b4c6d8] aurora:hover:text-[#b7d0d8] hover:bg-black/5 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb]'
                    : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] border-transparent hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-black/5 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {showInactiveTag && (
                  <span className="px-1 py-0.2 rounded text-[9.5px] font-medium bg-slate-200/80 linen:bg-[#e5d9c5] dark:bg-[#162638] aurora:bg-[#152934] linen:bg-[#e7dccb] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                    未生效
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {!embedded && persona && (
          <div className="hidden lg:flex items-center gap-1.5 pb-2 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
            <span>当前主控人设:</span>
            <span className="text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] font-semibold">
              {persona.personaName
                ? `${persona.personaName}${persona.personaRole ? ` (${persona.personaRole})` : ''}`
                : '未命名'}
            </span>
          </div>
        )}
      </div>

      {/* Modal Body */}
      <div
        className={`flex-1 overflow-y-auto ${
          embedded ? 'p-4 space-y-4' : 'p-6 space-y-6'
        } bg-white dark:bg-transparent aurora:bg-transparent linen:bg-transparent select-text`}
      >
        {/* ==================== TAB 1: GLOBAL PERSONA & STAGED PROMPTS ==================== */}
        {activeTab === 'persona' && isLoadingPersona && !persona && (
          <div className="py-20 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
            正在加载人设资料档案...
          </div>
        )}

        {activeTab === 'persona' && persona && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                  <span>角色档案：{persona.personaName || '未命名'}</span>
                </h3>
                {hasUnsavedPersonaChanges && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                    有未保存修改
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {personaSaveSuccess && !hasUnsavedPersonaChanges && (
                  <span className="text-[11px] text-emerald-700 dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] flex items-center gap-1 font-medium">
                    <Check className="w-3.5 h-3.5" /> 已生效
                  </span>
                )}
                <button
                  type="button"
                  disabled={isImportingTemplate}
                  onClick={handleImportTemplate}
                  title="显式导入一套可编辑的通用人设参考模板"
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#1a2e45] aurora:bg-[#13252e] linen:bg-[#e7dccb] aurora:hover:bg-[#18303b] linen:hover:bg-[#dfd2bc] text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] text-[11px] font-medium rounded-lg border border-[#cbd5e1] dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/30 linen:border-[#a86a43]/30 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{isImportingTemplate ? '导入中...' : '导入模板'}</span>
                </button>
                <button
                  type="button"
                  disabled={isResettingPersona}
                  onClick={handleResetPersona}
                  title="清空当前人设档案与五阶提示词，恢复为空白初始状态"
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-[#f8fafc] hover:bg-[#f1f5f9] dark:bg-[#0e1726] dark:hover:bg-[#152438] aurora:bg-[#101c23] linen:bg-[#efe6d6] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb] text-[#64748b] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] text-[11px] font-medium rounded-lg border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>清空</span>
                </button>
                <button
                  type="button"
                  disabled={isSavingPersona}
                  onClick={handleSavePersona}
                  className="px-3 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-[11px] font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingPersona ? '保存中...' : '保存并生效'}
                </button>
              </div>
            </div>

            {personaActionError && (
              <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-400">
                {personaActionError}
              </div>
            )}

            {pendingConfirmAction && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 flex flex-wrap items-center justify-between gap-2.5">
                <p className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed">
                  {pendingConfirmAction === 'reset'
                    ? '确认清空当前全局人设档案与五阶提示词，恢复为空白初始状态？'
                    : '确认导入参考人设模板？导入后将覆盖当前空白或已填人设字段，您可在此基础上自由修改。'}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isResettingPersona || isImportingTemplate}
                    onClick={() => setPendingConfirmAction(null)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#efe6d6] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb] cursor-pointer disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={isResettingPersona || isImportingTemplate}
                    onClick={() => {
                      if (pendingConfirmAction === 'reset') {
                        void executeResetPersona();
                      } else {
                        void executeImportTemplate();
                      }
                    }}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold text-white cursor-pointer disabled:opacity-50 ${
                      pendingConfirmAction === 'reset'
                        ? 'bg-rose-600 hover:bg-rose-500'
                        : 'bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734]'
                    }`}
                  >
                    {pendingConfirmAction === 'reset'
                      ? isResettingPersona
                        ? '清空中...'
                        : '确认清空'
                      : isImportingTemplate
                        ? '导入中...'
                        : '确认导入'}
                  </button>
                </div>
              </div>
            )}

            <div className={embedded ? 'space-y-4' : 'grid grid-cols-1 lg:grid-cols-12 gap-6'}>
              {/* Basic Persona Profile */}
              <div
                className={`${
                  embedded ? '' : 'lg:col-span-5'
                } space-y-3 bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]`}
              >
                <h4 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] uppercase tracking-wider flex items-center gap-2 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] pb-2">
                  <Compass className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                  <span>角色人设资料基本面</span>
                </h4>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">
                      人设姓名 / 昵称
                    </label>
                    <input
                      type="text"
                      value={persona.personaName}
                      onChange={(e) => setPersona({ ...persona, personaName: e.target.value })}
                      placeholder="角色姓名或昵称"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">
                      年龄 / 外貌感知
                    </label>
                    <input
                      type="text"
                      value={persona.age}
                      onChange={(e) => setPersona({ ...persona, age: e.target.value })}
                      placeholder="例如：28岁"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">身份职业背景</label>
                  <input
                    type="text"
                    value={persona.personaRole}
                    onChange={(e) => setPersona({ ...persona, personaRole: e.target.value })}
                    placeholder="请输入职业、身份或业务角色"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">
                    常居地 / 生活城市
                  </label>
                  <input
                    type="text"
                    value={persona.location}
                    onChange={(e) => setPersona({ ...persona, location: e.target.value })}
                    placeholder="例如：新加坡 / 上海"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">
                    性格特征标签 (逗号分隔)
                  </label>
                  <input
                    type="text"
                    value={traitInput}
                    onChange={(e) => setTraitInput(e.target.value)}
                    placeholder="知性温柔, 情绪稳定, 独立自律, 懂生活"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">
                    生活方式细节与日常习惯
                  </label>
                  <textarea
                    rows={3}
                    value={persona.lifeStyleDetails}
                    onChange={(e) => setPersona({ ...persona, lifeStyleDetails: e.target.value })}
                    placeholder="填写角色的作息、爱好与日常沟通细节..."
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg p-2.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">
                    核心专业视角 / 理念底色
                  </label>
                  <textarea
                    rows={3}
                    value={persona.investmentPhilosophy}
                    onChange={(e) => setPersona({ ...persona, investmentPhilosophy: e.target.value })}
                    placeholder="填写角色的专业理念、服务原则或价值观底色..."
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg p-2.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">
                    绝对红线禁忌词 (逗号分隔，严禁出现)
                  </label>
                  <input
                    type="text"
                    value={tabooInput}
                    onChange={(e) => setTabooInput(e.target.value)}
                    placeholder="例如：包赚不赔, 稳赚, guaranteed profit"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>
              </div>

              {/* 5-Stage Staged Prompts Editor */}
              <div
                className={`${
                  embedded ? '' : 'lg:col-span-7'
                } space-y-3.5 bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex flex-col justify-between`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] pb-2">
                    <h4 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] uppercase tracking-wider flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                      <span>五阶段沟通策略与提示词</span>
                    </h4>
                  </div>

                  <div
                    className={`${
                      embedded ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-2 sm:grid-cols-5 gap-1.5'
                    } bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] p-1.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]`}
                  >
                    {[
                      { key: 'icebreaker', label: '1.初识破冰', icon: Sparkles },
                      { key: 'dailyFriend', label: '2.朋友日常', icon: Coffee },
                      { key: 'emotionalLove', label: '3.情感升温', icon: Heart },
                      { key: 'wealthDiscussion', label: '4.价值探讨', icon: DollarSign },
                      { key: 'trustDefense', label: '5.信任化解', icon: ShieldCheck },
                    ].map((stage) => {
                      const Icon = stage.icon;
                      const isCurrent = activeStageEdit === stage.key;
                      return (
                        <button
                          key={stage.key}
                          type="button"
                          onClick={() => setActiveStageEdit(stage.key as StagedPromptKey)}
                          className={`flex flex-col items-center justify-center p-2 rounded-lg text-[11px] font-medium transition-all cursor-pointer border ${
                            isCurrent
                              ? 'bg-[#e8f3ff] dark:bg-[#12263f] aurora:bg-[#112d36] linen:bg-[#a86a43]/15 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] shadow-xs border-[#bfdbfe] dark:border-[#2ba0ff]/40 aurora:border-[#2dd4bf]/40 linen:border-[#a86a43]/40'
                              : 'border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 mb-1" />
                          <span className="truncate max-w-full">{stage.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                        阶段指导提示词：
                        {activeStageEdit === 'icebreaker'
                          ? '新朋友初识破冰'
                          : activeStageEdit === 'dailyFriend'
                          ? '日常朋友互动与生活分享'
                          : activeStageEdit === 'emotionalLove'
                          ? '关系升温与情感陪伴'
                          : activeStageEdit === 'wealthDiscussion'
                          ? '自然引申专业话题与合作探讨'
                          : '疑虑化解与安全感构建'}
                      </span>
                    </div>
                    <textarea
                      rows={embedded ? 5 : 7}
                      value={persona.stagedPrompts?.[activeStageEdit] || ''}
                      onChange={(e) =>
                        setPersona({
                          ...persona,
                          stagedPrompts: {
                            ...persona.stagedPrompts,
                            [activeStageEdit]: e.target.value,
                          },
                        })
                      }
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-xl p-3 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] leading-relaxed font-mono focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] resize-y"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-semibold text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] block">
                        追加全局人设指令 (System Instruction)
                      </label>
                      <span className="text-[10px] font-mono tabular-nums text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                        {(persona.customSystemInstruction || '').length} 字
                      </span>
                    </div>
                    <textarea
                      rows={embedded ? 4 : 6}
                      placeholder="输入补充个人经历、语气偏好或业务边界..."
                      value={persona.customSystemInstruction || ''}
                      onChange={(e) => setPersona({ ...persona, customSystemInstruction: e.target.value })}
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-xl p-3 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] leading-relaxed font-mono focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] resize-y min-h-[100px]"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-end">
                  <button
                    type="button"
                    disabled={isSavingPersona}
                    onClick={handleSavePersona}
                    className="px-4 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    保存人设配置
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: LOCAL KNOWLEDGE BASE (CRUD + REAL DOC UPLOAD) ==================== */}
        {activeTab === 'knowledge' && (
          <div className="space-y-4">
            {!isCustomLlmMode && (
              <div className="px-3.5 py-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div>
                  <span className="font-semibold">
                    {isCloudLlmMode
                      ? '当前为官方大模型（已使用云端自建知识库），软件本地知识库与整文范本仅在切换至「自定义大模型」时生效。'
                      : '当前处于「双关状态」（官方大模型与自定义大模型均已关闭），软件本地知识库与整文范本仅在切换至「自定义大模型」时生效。'}
                  </span>
                  <span className="block text-[11px] opacity-85 mt-0.5">
                    官方大模型默认只结合全局人设/个人资料、客户全息记忆与最近 30 条对话及云端自建知识库；您仍可在此提前维护本地知识条目，切换至自定义大模型后即刻注入。
                  </span>
                </div>
              </div>
            )}
            <div className={!isCustomLlmMode ? 'space-y-4 opacity-60 transition-opacity' : 'space-y-4'}>
            {/* Metrics Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: '知识总条目', value: kbStats.totalItems },
                { label: '已启用生效', value: kbStats.activeItemsCount ?? kbItems.filter((i) => i.isActive).length },
                { label: '文档切片数', value: kbStats.customDocCount },
                { label: 'RAG 命中次', value: kbStats.totalHits },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl px-3 py-2.5"
                >
                  <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">{stat.label}</div>
                  <div className="text-base font-bold font-mono tabular-nums text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] mt-0.5">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {kbFeedback && (
              <div
                className={`px-3 py-2 rounded-lg border text-xs flex items-start gap-2 ${
                  kbFeedback.type === 'error'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{kbFeedback.text}</span>
              </div>
            )}

            {/* Document Upload & Chunked Distillation Card */}
            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                  <Upload className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                  <span>文档真实解析与分段切片训练 (.txt / .md / .csv / .json / .pdf)</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.markdown,.csv,.json,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setSelectedFile(f);
                    setKbFeedback(null);
                  }}
                  className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] file:mr-2.5 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-[#cbd5e1] dark:file:border-[#1e3148] aurora:file:border-[#203742] linen:file:border-[#cbbba2] file:text-xs file:font-medium file:bg-white dark:file:bg-[#08101a] aurora:file:bg-[#081014] linen:file:bg-[#faf5ec] file:text-[#0f172a] dark:file:text-[#eef4fb] aurora:file:text-[#ecf6f8] linen:file:text-[#2b2118] hover:file:bg-[#f1f5f9] dark:hover:file:bg-[#152438] aurora:hover:file:bg-[#152934] linen:hover:file:bg-[#e7dccb] cursor-pointer max-w-full"
                />
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                >
                  <option value="auto">AI 自动按阶段归类</option>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      指定：{opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedFile || isUploadingDoc}
                  onClick={handleUploadDocument}
                  className="px-3 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isUploadingDoc ? 'animate-spin' : ''}`} />
                  <span>{isUploadingDoc ? '解析与分段提炼中...' : '上传并训练'}</span>
                </button>
              </div>
              {selectedFile && (
                <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                  已选择：<span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">{selectedFile.name}</span>（
                  {(selectedFile.size / 1024).toFixed(1)} KB）— 超长文档将自动按段落边界安全分段提炼并去重入库，加密/损坏文件将直接拦截报错。
                </div>
              )}
            </div>

            {/* Toolbar: Filter + Search + Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {[{ value: 'all', label: '全部' }, ...CATEGORY_OPTIONS].map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setKbFilterCategory(cat.value)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors ${
                      kbFilterCategory === cat.value
                        ? 'bg-[#e8f3ff] dark:bg-[#12263f] aurora:bg-[#112d36] linen:bg-[#a86a43]/15 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] border-[#bfdbfe] dark:border-[#2ba0ff]/40 aurora:border-[#2dd4bf]/40 linen:border-[#a86a43]/40'
                        : 'bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#efe6d6] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={kbSearch}
                    onChange={(e) => setKbSearch(e.target.value)}
                    placeholder="检索标题/关键词..."
                    className="pl-8 pr-2.5 py-1.5 bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] w-40"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (showKbForm && !editingKbId) {
                      resetKbForm();
                    } else {
                      resetKbForm();
                      setShowKbForm(true);
                    }
                  }}
                  className="px-2.5 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>手工新增</span>
                </button>
                {kbItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmClearKb((v) => !v)}
                    className="px-2.5 py-1.5 bg-[#f8fafc] hover:bg-rose-50 dark:bg-[#0e1726] dark:hover:bg-rose-950/30 aurora:bg-[#101c23] linen:bg-[#efe6d6] aurora:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-xs font-medium rounded-lg cursor-pointer transition-colors"
                  >
                    清空当前分类
                  </button>
                )}
              </div>
            </div>

            {confirmClearKb && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-700/50 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-rose-800 dark:text-rose-200">
                  确认清空当前账号{kbFilterCategory === 'all' ? '全部' : `「${CATEGORY_LABELS[kbFilterCategory] || kbFilterCategory}」`}本地知识条目？该操作不可恢复。
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmClearKb(false)}
                    className="px-2.5 py-1 text-xs rounded-lg bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#efe6d6] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAllKb}
                    className="px-3 py-1 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
                  >
                    确认清空
                  </button>
                </div>
              </div>
            )}

            {/* Manual Create / Edit Form */}
            {showKbForm && (
              <div className="bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#efe6d6] border border-[#2481cc]/40 dark:border-[#2ba0ff]/40 aurora:border-[#2dd4bf]/40 linen:border-[#a86a43]/40 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                    {editingKbId ? '编辑知识条目' : '手工录入知识条目'}
                  </h4>
                  <button
                    type="button"
                    onClick={resetKbForm}
                    className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer"
                  >
                    取消
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    value={kbFormCategory}
                    onChange={(e) => setKbFormCategory(e.target.value)}
                    className="bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]"
                  >
                    {CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={kbFormTitle}
                    onChange={(e) => setKbFormTitle(e.target.value)}
                    placeholder="标题（如：报价异议处理话术）"
                    className="sm:col-span-2 bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c]"
                  />
                </div>
                <textarea
                  rows={3}
                  value={kbFormContent}
                  onChange={(e) => setKbFormContent(e.target.value)}
                  placeholder="填写标准业务知识、话术原则或客户常见问答..."
                  className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg p-2.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c]"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={kbFormKeywords}
                    onChange={(e) => setKbFormKeywords(e.target.value)}
                    placeholder="检索关键词（逗号分隔，支持多语种）"
                    className="flex-1 min-w-[180px] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c]"
                  />
                  <button
                    type="button"
                    disabled={isSavingKb}
                    onClick={handleSaveKbItem}
                    className="px-3.5 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    {isSavingKb ? '保存中...' : editingKbId ? '保存修改' : '确认入库'}
                  </button>
                </div>
              </div>
            )}

            {/* Knowledge Items List */}
            {isLoadingKb ? (
              <div className="py-10 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">正在加载知识库...</div>
            ) : filteredKbItems.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-xl text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                {kbItems.length === 0
                  ? '当前账号本地知识库为空，请通过上方“文档解析训练”或“手工新增”建立真实业务知识库。'
                  : '未找到符合当前筛选条件的知识条目。'}
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredKbItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      item.isActive
                        ? 'bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]'
                        : 'bg-[#f1f5f9]/60 dark:bg-[#08101a]/60 aurora:bg-[#081014]/60 linen:bg-[#faf5ec]/70 border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] opacity-70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-medium">
                            {CATEGORY_LABELS[item.category] || item.category}
                          </span>
                          <h5 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] truncate">
                            {item.title}
                          </h5>
                          <span className="text-[10px] font-mono text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                            命中 {item.hitCount || 0}
                          </span>
                        </div>
                        <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] mt-1.5 whitespace-pre-wrap leading-relaxed">
                          {item.content}
                        </p>
                        {(item.keywords?.length > 0 || item.sourceFile) && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {(item.keywords || []).map((kw, idx) => (
                              <span
                                key={idx}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32]"
                              >
                                {kw}
                              </span>
                            ))}
                            {item.sourceFile && item.sourceFile !== 'manual_input' && (
                              <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                                来源: {item.sourceFile}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          title={item.isActive ? '点击停用' : '点击启用'}
                          onClick={() => handleToggleKbItem(item.id)}
                          className={`p-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                            item.isActive
                              ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                              : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec]'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="编辑条目"
                          onClick={() => handleStartEditKb(item)}
                          className="p-1.5 rounded-lg border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] hover:text-[#0284c7] dark:hover:text-[#2ba0ff] aurora:hover:text-[#2dd4bf] cursor-pointer transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="删除条目"
                          onClick={() =>
                            setConfirmDeleteKbId((cur) => (cur === item.id ? null : item.id))
                          }
                          className="p-1.5 rounded-lg border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 aurora:hover:bg-rose-950/30 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {confirmDeleteKbId === item.id && (
                      <div className="mt-2 pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-rose-600 dark:text-rose-400">确认永久删除该知识条目？</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKbId(null)}
                            className="px-2 py-0.5 rounded bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] cursor-pointer"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteKbItem(item.id)}
                            className="px-2.5 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer"
                          >
                            确认删除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        )}

        {/* ==================== TAB 3: FULL DIALOGUE TRANSCRIPTS & ONE-CLICK CLIENT IMPORT ==================== */}
        {activeTab === 'transcripts' && (
          <div className="space-y-4">
            {!isCustomLlmMode && (
              <div className="px-3.5 py-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div>
                  <span className="font-semibold">
                    {isCloudLlmMode
                      ? '当前为官方大模型（已使用云端自建知识库），软件本地知识库与整文范本仅在切换至「自定义大模型」时生效。'
                      : '当前处于「双关状态」（官方大模型与自定义大模型均已关闭），软件本地知识库与整文范本仅在切换至「自定义大模型」时生效。'}
                  </span>
                  <span className="block text-[11px] opacity-85 mt-0.5">
                    官方大模型仅传入全局人设/个人资料、客户全息记忆与最近 30 条对话，不会读取整文范本库；您仍可预先导入整理范本，切换至「自定义大模型」后即刻生效。
                  </span>
                </div>
              </div>
            )}
            <div className={!isCustomLlmMode ? 'space-y-4 opacity-60 transition-opacity' : 'space-y-4'}>
            {transcriptFeedback && (
              <div
                className={`px-3 py-2 rounded-lg border text-xs flex items-start gap-2 ${
                  transcriptFeedback.type === 'error'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{transcriptFeedback.text}</span>
              </div>
            )}

            {/* One-Click Import From Current Client Card */}
            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                  <Download className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                  <span>从当前客户一键导入整文范本</span>
                </div>
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                  {activeChatId
                    ? `当前选中：${currentChat?.title || activeChatId} (${currentMessages?.length || 0} 条本地消息)`
                    : '未选中任何客户会话'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={importChatCustomTitle}
                  onChange={(e) => setImportChatCustomTitle(e.target.value)}
                  placeholder="可选自定义范本标题（留空将自动按客户姓名生成）"
                  className="flex-1 min-w-[200px] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
                <button
                  type="button"
                  disabled={!activeChatId || isImportingChatTranscript}
                  onClick={handleImportFromCurrentChat}
                  className="px-3 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isImportingChatTranscript ? 'animate-spin' : ''}`} />
                  <span>{isImportingChatTranscript ? '提炼导入中...' : '一键导入并提炼风格'}</span>
                </button>
              </div>
            </div>

            {/* Header & Toggle Manual Add */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                已入库整文范本 ({transcripts.length})
              </span>
              <button
                type="button"
                onClick={() => setShowTranscriptForm((v) => !v)}
                className="px-2.5 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showTranscriptForm ? '收起录入表单' : '手工录入整文范本'}</span>
              </button>
            </div>

            {showTranscriptForm && (
              <div className="bg-[#f8fafc] dark:bg-[#0e1726]/90 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#2481cc]/35 dark:border-[#2ba0ff]/40 aurora:border-[#2dd4bf]/40 linen:border-[#a86a43]/40 rounded-xl p-3.5 space-y-2.5">
                <input
                  type="text"
                  value={newTransTitle}
                  onChange={(e) => setNewTransTitle(e.target.value)}
                  placeholder="范本标题（如：高情商破冰与商务自然转接示范）"
                  className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
                <input
                  type="text"
                  value={newTransDesc}
                  onChange={(e) => setNewTransDesc(e.target.value)}
                  placeholder="场景说明（可选）"
                  className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
                <textarea
                  rows={5}
                  value={newTransDialogue}
                  onChange={(e) => setNewTransDialogue(e.target.value)}
                  placeholder="粘贴完整真实聊天对话实录（按行分隔，如 客户: ... / 我: ...）"
                  className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg p-2.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] font-mono focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
                <input
                  type="text"
                  value={newTransStyle}
                  onChange={(e) => setNewTransStyle(e.target.value)}
                  placeholder="可选自定义风格摘要（留空将自动调用大模型提炼口语习惯）"
                  className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isCreatingTranscript}
                    onClick={handleCreateTranscript}
                    className="px-3.5 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    {isCreatingTranscript ? '提炼入库中...' : '保存并提炼风格'}
                  </button>
                </div>
              </div>
            )}

            {isLoadingTranscripts ? (
              <div className="py-10 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">正在加载整文范本库...</div>
            ) : transcripts.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-xl text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                暂无整文对话范本。请从上方“当前客户一键导入”或“手工录入”添加真实会话样本。
              </div>
            ) : (
              <div className="space-y-2.5">
                {transcripts.map((t) => {
                  const isExpanded = expandedTranscriptId === t.id;
                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl border p-3 transition-colors ${
                        t.isActive
                          ? 'bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]'
                          : 'bg-[#f1f5f9]/70 dark:bg-[#08101a]/60 aurora:bg-[#081014]/60 linen:bg-[#faf5ec]/70 border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h5 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">{t.title}</h5>
                            <span className="text-[10px] font-mono text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                              {t.roundCount} 轮 · {t.characterCount} 字
                            </span>
                          </div>
                          {t.learnedStyle && (
                            <div className="mt-1.5 text-xs text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] bg-[#e8f3ff] dark:bg-[#2ba0ff]/10 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 border border-[#bfdbfe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/25 linen:border-[#a86a43]/25 rounded-lg px-2.5 py-1.5 leading-relaxed">
                              提炼风格：{t.learnedStyle}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            title={isExpanded ? '收起原文' : '展开原文'}
                            onClick={() => setExpandedTranscriptId(isExpanded ? null : t.id)}
                            className="p-1.5 rounded-lg border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb] cursor-pointer transition-colors"
                          >
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            title={t.isActive ? '停用该范本' : '启用该范本'}
                            onClick={() => handleToggleTranscript(t.id)}
                            className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
                              t.isActive
                                ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                                : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec]'
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="删除范本"
                            onClick={() =>
                              setConfirmDeleteTranscriptId((cur) => (cur === t.id ? null : t.id))
                            }
                            className="p-1.5 rounded-lg border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <pre className="mt-2.5 p-2.5 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[11px] text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] whitespace-pre-wrap max-h-56 overflow-y-auto font-mono leading-relaxed">
                          {t.dialogueText}
                        </pre>
                      )}

                      {confirmDeleteTranscriptId === t.id && (
                        <div className="mt-2 pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-rose-600 dark:text-rose-400">确认永久删除该整文范本？</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteTranscriptId(null)}
                              className="px-2 py-0.5 rounded bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] cursor-pointer"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTranscript(t.id)}
                              className="px-2.5 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer transition-colors"
                            >
                              确认删除
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            </div>
          </div>
        )}

        {/* ==================== TAB 4: SELF-EVOLUTION ENGINE & HABIT CONTROLS ==================== */}
        {activeTab === 'evolution' && (
          <div className="space-y-4">
            {/* Engine Status Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl px-3 py-2.5">
                <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">进化引擎版本</div>
                <div className="text-xs font-bold font-mono text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] mt-1 truncate">
                  {evolutionState?.version || 'v1.0.0'}
                </div>
              </div>
              <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl px-3 py-2.5">
                <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">已分析会话组</div>
                <div className="text-base font-bold font-mono tabular-nums text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] mt-0.5">
                  {evolutionState?.totalConversationsAnalyzed || 0}
                </div>
              </div>
              <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl px-3 py-2.5">
                <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">习得习惯总量</div>
                <div className="text-base font-bold font-mono tabular-nums text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] mt-0.5">
                  {evolutionState?.totalHabitsLearned || 0}
                </div>
              </div>
              <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl px-3 py-2.5">
                <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">最近进化时间</div>
                <div className="text-xs font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] mt-1">
                  {formatDateTime(evolutionState?.lastEvolvedAt)}
                </div>
              </div>
            </div>

            {evolutionFeedback && (
              <div
                className={`px-3 py-2 rounded-lg border text-xs flex items-start gap-2 ${
                  evolutionFeedback.type === 'error'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{evolutionFeedback.text}</span>
              </div>
            )}

            {/* Trigger Incremental Evolution Learning */}
            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                  <Cpu className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                  <span>增量会话自进化学习控制</span>
                </div>
                <button
                  type="button"
                  onClick={loadEvolutionData}
                  disabled={isLoadingEvolution}
                  className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingEvolution ? 'animate-spin' : ''}`} />
                  <span>刷新</span>
                </button>
              </div>
              <textarea
                rows={3}
                value={evolutionSampleInput}
                onChange={(e) => setEvolutionSampleInput(e.target.value)}
                placeholder="可选补充示范语料片段（留空则自动按消息水位线抽取当前账号新增真实聊天记录，避免重复提炼）..."
                className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg p-2.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                  学习水位线：{formatDateTime(evolutionState?.lastLearnedMessageCreatedAt)} · 已启用习惯{' '}
                  {(evolutionState?.habits || []).filter((h) => h.isActive).length}/
                  {(evolutionState?.habits || []).length}
                </span>
                <button
                  type="button"
                  disabled={isRunningEvolution}
                  onClick={handleRunEvolutionLearn}
                  className="px-3.5 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isRunningEvolution ? 'animate-spin' : ''}`} />
                  <span>{isRunningEvolution ? '正在萃取沟通习惯...' : '执行增量进化学习'}</span>
                </button>
              </div>
            </div>

            {/* Learned Habits List */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                已习得沟通习惯与风格技巧 ({evolutionState?.habits?.length || 0})
              </h4>
              {!evolutionState?.habits?.length ? (
                <div className="py-10 text-center border border-dashed border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-xl text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                  尚未提炼任何习惯规则。在积累真实聊天记录或补充语料后，点击上方“执行增量进化学习”。
                </div>
              ) : (
                <div className="space-y-2">
                  {evolutionState.habits.map((h) => (
                    <div
                      key={h.id}
                      className={`rounded-xl border p-3 transition-colors ${
                        h.isActive
                          ? 'bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]'
                          : 'bg-[#f1f5f9]/70 dark:bg-[#08101a]/60 aurora:bg-[#081014]/60 linen:bg-[#faf5ec]/70 border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-medium">
                              {HABIT_TYPE_LABELS[h.type] || h.type}
                            </span>
                            <span className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">{h.title}</span>
                            <span className="text-[10px] font-mono text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                              置信 {Math.round((Number(h.confidenceScore) || 0) * 100)}% · 应用 {h.appliedCount || 0} 次
                            </span>
                          </div>
                          {h.description && (
                            <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] leading-relaxed">
                              {h.description}
                            </p>
                          )}
                          {h.examplePattern && (
                            <div className="text-[11px] text-[#64748b] dark:text-[#8ea6bc] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1">
                              范例：{h.examplePattern}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          title={h.isActive ? '停用该习惯' : '启用该习惯'}
                          onClick={() => handleToggleHabit(h.id)}
                          className={`p-1.5 rounded-lg border shrink-0 cursor-pointer transition-colors ${
                            h.isActive
                              ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                              : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec]'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Training & Evolution Logs */}
            {(evolutionLogs.length > 0 || kbLogs.length > 0) && (
              <div className="space-y-2 pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
                <h4 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">近期训练与进化日志</h4>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {(evolutionLogs.length > 0 ? evolutionLogs : kbLogs).slice(0, 10).map((log) => (
                    <div
                      key={log.id}
                      className="text-[11px] bg-[#f8fafc] dark:bg-[#0e1726]/70 aurora:bg-[#101c23]/75 linen:bg-[#efe6d6]/75 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2"
                    >
                      <span className="text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] truncate">{log.details}</span>
                      <span className="text-[10px] font-mono text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] shrink-0">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 5: PERSONA SANDBOX ==================== */}
        {activeTab === 'sandbox' && (
          <div className="space-y-4">
            {hasUnsavedPersonaChanges && (
              <div className="px-3.5 py-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>您在「人设」页有尚未保存的修改，试聊将读取本地数据库已保存配置。</span>
                </div>
                <button
                  type="button"
                  disabled={isSavingPersona}
                  onClick={() => void handleSavePersona()}
                  className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isSavingPersona ? '保存中...' : '立即保存当前人设'}
                </button>
              </div>
            )}
            <div className={embedded ? 'space-y-4' : 'grid grid-cols-1 md:grid-cols-12 gap-5'}>
              {/* Input Panel */}
              <div
                className={`${
                  embedded ? '' : 'md:col-span-5'
                } bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] space-y-3.5`}
              >
                <div>
                  <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] block mb-1.5">
                    选择当前测试的客户沟通阶段
                  </label>
                  <select
                    value={sandboxStage}
                    onChange={(e) => setSandboxStage(e.target.value as StagedPromptKey)}
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-3 py-2 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  >
                    <option value="icebreaker">阶段 1: 新朋友初识破冰</option>
                    <option value="dailyFriend">阶段 2: 日常朋友互动与情绪价值</option>
                    <option value="emotionalLove">阶段 3: 情感升温与深度陪伴</option>
                    <option value="wealthDiscussion">阶段 4: 专业价值与合作探讨</option>
                    <option value="trustDefense">阶段 5: 疑虑化解与安全感构建</option>
                  </select>
                </div>

                <div>
                  <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">快捷测试语料：</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '初识询问', text: '你好，刚加上好友，请问你在哪座城市呀？' },
                      { label: '抱怨疲惫', text: '今天做项目被客户折腾惨了，加班到现在整个人都快散架了。' },
                      { label: '询问主业', text: '看你平时生活挺惬意的，你平时主要做什么方向呀？' },
                      { label: '疑虑试探', text: '网上聊天的真假难辨，我怎么知道你是认真交朋友的？' },
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSandboxInput(item.text)}
                        className="text-[10px] bg-white hover:bg-[#f1f5f9] dark:bg-[#08101a] dark:hover:bg-[#152438] aurora:bg-[#081014] linen:bg-[#faf5ec] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] px-2 py-1 rounded border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] transition-colors cursor-pointer"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl p-3 bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] flex items-center gap-1.5">
                      <MessageCircle className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                      <span>多轮历史消息上下文 (可选 · 最多30轮)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowRecentHistoryInput(!showRecentHistoryInput)}
                      className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer transition-colors"
                    >
                      {showRecentHistoryInput ? '收起' : '展开'}
                    </button>
                  </div>
                  {showRecentHistoryInput && (
                    <textarea
                      rows={3}
                      value={sandboxRecentHistory}
                      onChange={(e) => setSandboxRecentHistory(e.target.value)}
                      placeholder={'每行一条，例如：\n对方: 你好，想了解一下结算周期\n我: 你好呀，我们这边支持日常实时对账'}
                      className="w-full bg-[#f8fafc] dark:bg-[#060b14] aurora:bg-[#060c0f] linen:bg-[#fcf8f0] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg p-2 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] font-sans"
                    />
                  )}
                </div>

                <div className="border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl p-3 bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                      <span>整文语气示范片段 (可选)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowTranscriptInput(!showTranscriptInput)}
                      className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer transition-colors"
                    >
                      {showTranscriptInput ? '收起' : '展开'}
                    </button>
                  </div>
                  {showTranscriptInput && (
                    <textarea
                      rows={3}
                      value={sandboxChatTranscript}
                      onChange={(e) => setSandboxChatTranscript(e.target.value)}
                      placeholder="粘贴整文示范对话，测试模型对口语习惯与语气节奏的复刻效果..."
                      className="w-full bg-[#f8fafc] dark:bg-[#060b14] aurora:bg-[#060c0f] linen:bg-[#fcf8f0] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg p-2 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] font-sans"
                    />
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] block mb-1.5">
                    模拟客户发来的最新一条消息
                  </label>
                  <textarea
                    rows={3}
                    value={sandboxInput}
                    onChange={(e) => setSandboxInput(e.target.value)}
                    placeholder="输入测试客户发来的聊天内容..."
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg p-2.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>

                {sandboxError && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-400">
                    {sandboxError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isTestingReply || !sandboxInput.trim()}
                  onClick={handleRunSandbox}
                  className="w-full py-2.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${isTestingReply ? 'animate-pulse' : ''}`} />
                  <span>{isTestingReply ? '正在结合人设与知识进化库演算...' : '立即测试人设回复'}</span>
                </button>
              </div>

              {/* Output Panel */}
              <div
                className={`${
                  embedded ? '' : 'md:col-span-7'
                } bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex flex-col justify-between space-y-4`}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] pb-2">
                    <h4 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">人设效果试聊输出</h4>
                    {sandboxResult && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                        {sandboxResult.ragSources && (
                          <span className="px-1.5 py-0.5 rounded bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d]">
                            {sandboxResult.ragSources.cloudRagEnabled
                              ? `云端RAG(${sandboxResult.ragSources.cloudRagMatchedCount ?? 0})`
                              : sandboxResult.ragSources.localRagEnabled === false
                              ? '未启用知识库'
                              : `本地RAG(${sandboxResult.ragSources.localRagMatchedCount ?? 0})`}
                          </span>
                        )}
                        <span>{sandboxResult.source}</span>
                      </div>
                    )}
                  </div>

                  {sandboxResult ? (
                    <div className="space-y-3">
                      <div className="bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-xl p-3.5 text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] text-sm leading-relaxed shadow-xs">
                        <div className="mb-2 pb-2 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] text-xs font-semibold text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]">
                          {persona?.personaName || '主控人设'} 回复：
                        </div>
                        <p className="whitespace-pre-wrap text-xs sm:text-sm">{sandboxResult.reply}</p>
                      </div>

                      {sandboxResult.matchedKnowledge && sandboxResult.matchedKnowledge.length > 0 && (
                        <div className="bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] p-3 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
                          <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
                            <span className="text-[11px] font-semibold text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] flex items-center gap-1.5">
                              <Cloud className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                              <span>本次命中知识库要点：</span>
                            </span>
                            {sandboxResult.ragSources && (
                              <div className="flex flex-wrap items-center gap-1 text-[10px]">
                                {sandboxResult.ragSources.cloudRagEnabled && (
                                  <span className="px-1.5 py-0.5 rounded bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] font-medium">
                                    云端知识库 (Cloud RAG): {sandboxResult.ragSources.cloudRagMatchedCount ?? 0} 条
                                  </span>
                                )}
                                {(sandboxResult.ragSources.localRagEnabled ?? !sandboxResult.ragSources.cloudRagEnabled) && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-500/10 linen:bg-[#a86a43]/10 text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] font-medium">
                                    本地知识库: {sandboxResult.ragSources.localRagMatchedCount ?? 0} 条
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            {sandboxResult.matchedKnowledge.map((k: any, i: number) => {
                              const isCloud = k?.source === 'cloud_kb';
                              return (
                                <div key={i} className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] flex items-center gap-1.5">
                                  <span>•</span>
                                  <span
                                    className={`px-1 py-0.2 rounded text-[10px] font-medium shrink-0 ${
                                      isCloud
                                        ? 'bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d]'
                                        : 'bg-slate-500/10 linen:bg-[#a86a43]/10 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]'
                                    }`}
                                  >
                                    {isCloud ? '云端' : '本地'}
                                  </span>
                                  <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">{k.title || '知识条目'}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {sandboxResult.appliedHabits && sandboxResult.appliedHabits.length > 0 && (
                        <div className="bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] p-3 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
                          <span className="text-[11px] font-semibold text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] mb-1.5 flex items-center gap-1.5">
                            <Cpu className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                            <span>本次叠加自进化习惯：</span>
                          </span>
                          <div className="space-y-1">
                            {sandboxResult.appliedHabits.map((h: any, i: number) => (
                              <div key={i} className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32]">
                                • <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">{h.title}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-12 text-center text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                      <MessageCircle className="w-7 h-7 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">输入测试话语并点击“立即测试人设回复”，在此预览实际聊天气质</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-full min-h-0 select-none text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
        {innerContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl linen:shadow-sm overflow-hidden relative text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
        {innerContent}
      </div>
    </div>
  );
};
