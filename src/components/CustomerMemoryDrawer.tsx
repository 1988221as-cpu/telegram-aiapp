import React, { useState, useEffect, useRef } from 'react';
import {
  Brain,
  Sparkles,
  User,
  Tag,
  ShieldAlert,
  Calendar,
  RefreshCw,
  Plus,
  Trash2,
  X,
  CheckCircle2,
  Download,
  Edit3,
  HeartHandshake,
  TrendingUp,
} from 'lucide-react';
import { CustomerProfile, CustomerMemoryItem, CustomLLMConfig } from '../types';
import {
  analyzeCustomerMemory,
  saveCustomerProfile,
  saveLocalCustomerProfile,
  normalizeProfileChatId,
} from '../services/apiService';

interface CustomerMemoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  profile: CustomerProfile | null;
  chatId?: string;
  currentAccountId?: string;
  onUpdateProfile: (
    updated: CustomerProfile,
    options?: { skipRemoteSave?: boolean }
  ) => void | boolean | Promise<boolean>;
  customConfig: CustomLLMConfig;
  chatTitle: string;
  messages?: any[];
  embedded?: boolean;
  sideDocked?: boolean;
}

export const CustomerMemoryDrawer: React.FC<CustomerMemoryDrawerProps> = ({
  isOpen,
  onClose,
  profile,
  chatId,
  currentAccountId,
  onUpdateProfile,
  customConfig,
  chatTitle,
  messages,
  embedded = false,
  sideDocked = false,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [newLikeInput, setNewLikeInput] = useState('');
  const [newTabooInput, setNewTabooInput] = useState('');
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [memDate, setMemDate] = useState(new Date().toISOString().split('T')[0]);
  const [memTopic, setMemTopic] = useState('');
  const [memSummary, setMemSummary] = useState('');
  const [memEmotion, setMemEmotion] = useState('日常交流');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Manual attributes editing
  const [isEditingAttributes, setIsEditingAttributes] = useState(false);
  const [editAge, setEditAge] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editOccupation, setEditOccupation] = useState('');
  const [editTone, setEditTone] = useState('');
  const [editStage, setEditStage] = useState('');
  const [editFamilyMarital, setEditFamilyMarital] = useState('');
  const [editActiveSchedule, setEditActiveSchedule] = useState('');
  const [editEmotionalNeeds, setEditEmotionalNeeds] = useState('');

  // Manual investment & strategy editing
  const [isEditingStrategy, setIsEditingStrategy] = useState(false);
  const [editFinancialProfile, setEditFinancialProfile] = useState('');
  const [editInvestmentAttitude, setEditInvestmentAttitude] = useState('');
  const [editTrustLevel, setEditTrustLevel] = useState('');
  const [editNextStepStrategy, setEditNextStepStrategy] = useState('');

  const activeScope = `${chatId || ''}::${currentAccountId || ''}`;
  const activeScopeRef = useRef(activeScope);
  activeScopeRef.current = activeScope;
  const analyzeSeqRef = useRef(0);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTransientError = (msg: string, durationMs = 4500) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setErrorMessage(msg);
    errorTimerRef.current = setTimeout(() => {
      setErrorMessage(null);
      errorTimerRef.current = null;
    }, durationMs);
  };

  const showTransientSuccess = (noticeText: string | null, durationMs = 3000, successBannerText?: string) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    if (noticeText) {
      setSaveSuccessMsg(null);
      setInfoNotice(noticeText);
      feedbackTimerRef.current = setTimeout(() => {
        setInfoNotice(null);
        feedbackTimerRef.current = null;
      }, durationMs);
    } else {
      setInfoNotice(null);
      setSaveSuccessMsg(successBannerText || '已成功从历史记录更新客户全息画像与记忆！');
      feedbackTimerRef.current = setTimeout(() => {
        setSaveSuccessMsg(null);
        feedbackTimerRef.current = null;
      }, durationMs);
    }
  };

  useEffect(() => {
    analyzeSeqRef.current += 1;
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setIsAnalyzing(false);
    setIsEditingAttributes(false);
    setIsEditingStrategy(false);
    setIsAddingMemory(false);
    setMemDate(new Date().toISOString().split('T')[0]);
    setMemTopic('');
    setMemSummary('');
    setMemEmotion('日常交流');
    setNewLikeInput('');
    setNewTabooInput('');
    setErrorMessage(null);
    setInfoNotice(null);
    setSaveSuccessMsg(null);
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [chatId, currentAccountId]);

  if (!isOpen) return null;

  const normalizeAccountKey = (id?: string) => {
    const raw = String(id || '').trim();
    return raw.startsWith('acc_tg_') ? raw.slice('acc_tg_'.length) : raw;
  };
  const isSameAccountScope = (a?: string, b?: string) => {
    if (!a || !b) return true;
    if (a === b) return true;
    return normalizeAccountKey(a) === normalizeAccountKey(b);
  };

  const effectiveAccountId =
    currentAccountId ||
    (profile && (!chatId || normalizeProfileChatId(profile.chatId) === normalizeProfileChatId(chatId)) ? profile.accountId : '') ||
    '';

  const scopedProfile =
    profile &&
    (!chatId || normalizeProfileChatId(profile.chatId) === normalizeProfileChatId(chatId)) &&
    isSameAccountScope(profile.accountId, effectiveAccountId)
      ? {
          ...profile,
          accountId: profile.accountId || effectiveAccountId,
          likesInterests: Array.isArray(profile.likesInterests) ? profile.likesInterests : [],
          dislikesTaboos: Array.isArray(profile.dislikesTaboos) ? profile.dislikesTaboos : [],
          keyMemories: Array.isArray(profile.keyMemories) ? profile.keyMemories : [],
        }
      : null;

  const currentProfile: CustomerProfile = scopedProfile || {
    chatId: chatId || 'current',
    accountId: effectiveAccountId,
    clientName: chatTitle || '当前联系人',
    relationshipStage: '尚未分析',
    ageEstimate: '',
    occupation: '',
    locationTimezone: '',
    familyMaritalStatus: '',
    activeSchedule: '',
    toneStyle: '',
    likesInterests: [],
    dislikesTaboos: [],
    emotionalNeeds: '',
    financialProfile: '',
    investmentAttitude: '',
    trustLevel: '',
    nextStepStrategy: '',
    keyMemories: [],
    totalMessagesCount: 0,
    updatedAt: Date.now(),
  };

  const commitProfileUpdate = async (
    updated: CustomerProfile,
    options?: { skipRemoteSave?: boolean }
  ): Promise<boolean> => {
    const targetAccId = currentAccountId || updated.accountId || effectiveAccountId;
    const targetChatId = chatId || updated.chatId || currentProfile.chatId;
    const scopedUpdated: CustomerProfile = {
      ...updated,
      chatId: targetChatId,
      accountId: targetAccId,
    };
    const parentResult = await onUpdateProfile(scopedUpdated, options);
    if (!embedded && targetChatId && targetChatId !== 'current') {
      saveLocalCustomerProfile(targetChatId, scopedUpdated, targetAccId);
      if (!options?.skipRemoteSave) {
        return await saveCustomerProfile(targetChatId, scopedUpdated, targetAccId);
      }
    }
    return parentResult !== false;
  };

  // Run AI Deep Analysis over unified cloud + local conversation history
  const handleTriggerAnalysis = async () => {
    if ((!messages || messages.length === 0) && (!currentProfile.chatId || currentProfile.chatId === 'current')) {
      showTransientError('当前联系人暂无真实对话记录。请在与客户进行真实沟通后，再执行全息画像与长效记忆提炼。', 4000);
      return;
    }

    const requestChatId = currentProfile.chatId;
    const requestAccountId = effectiveAccountId;
    const requestScope = activeScope;
    const requestSeq = ++analyzeSeqRef.current;

    setIsAnalyzing(true);
    setIsEditingAttributes(false);
    setIsEditingStrategy(false);
    setErrorMessage(null);
    setInfoNotice(null);
    try {
      let sparseNotice: string | null = null;
      const freshProfile = await analyzeCustomerMemory(
        requestChatId,
        customConfig,
        requestAccountId,
        messages,
        chatTitle,
        (msg) => {
          sparseNotice = msg;
        }
      );
      if (freshProfile) {
        const scopedFresh: CustomerProfile = {
          ...freshProfile,
          chatId: freshProfile.chatId || requestChatId,
          accountId: freshProfile.accountId || requestAccountId,
        };
        if (activeScopeRef.current !== requestScope) {
          saveLocalCustomerProfile(requestChatId, scopedFresh, requestAccountId);
          return;
        }
        await commitProfileUpdate(scopedFresh, { skipRemoteSave: true });
        showTransientSuccess(sparseNotice, sparseNotice ? 4500 : 3000, '已成功从历史记录更新客户全息画像与记忆！');
      } else if (activeScopeRef.current === requestScope) {
        setErrorMessage('AI 记忆提炼未返回有效画像数据，请稍后重试');
      }
    } catch (err: any) {
      if (activeScopeRef.current === requestScope) {
        if (errorTimerRef.current) {
          clearTimeout(errorTimerRef.current);
          errorTimerRef.current = null;
        }
        setErrorMessage(err?.message || 'AI 记忆提炼失败，请检查网络或模型配置');
      }
    } finally {
      if (activeScopeRef.current === requestScope && analyzeSeqRef.current === requestSeq) {
        setIsAnalyzing(false);
      }
    }
  };

  // Add like
  const handleAddLike = async () => {
    if (!newLikeInput.trim()) return;
    const updated = {
      ...currentProfile,
      likesInterests: [...currentProfile.likesInterests, newLikeInput.trim()],
      updatedAt: Date.now(),
    };
    setNewLikeInput('');
    const synced = await commitProfileUpdate(updated);
    if (!synced) {
      setSaveSuccessMsg(null);
      showTransientError('偏好标签已暂存界面，但写入本地电脑数据库失败（请检查登录状态或本地服务状态）', 5000);
    }
  };

  // Remove like
  const handleRemoveLike = async (idx: number) => {
    const updated = {
      ...currentProfile,
      likesInterests: currentProfile.likesInterests.filter((_, i) => i !== idx),
      updatedAt: Date.now(),
    };
    const synced = await commitProfileUpdate(updated);
    if (!synced) {
      setSaveSuccessMsg(null);
      showTransientError('偏好标签已从界面移除，但写入本地电脑数据库失败（请检查登录状态或本地服务状态）', 5000);
    }
  };

  // Add taboo
  const handleAddTaboo = async () => {
    if (!newTabooInput.trim()) return;
    const updated = {
      ...currentProfile,
      dislikesTaboos: [...currentProfile.dislikesTaboos, newTabooInput.trim()],
      updatedAt: Date.now(),
    };
    setNewTabooInput('');
    const synced = await commitProfileUpdate(updated);
    if (!synced) {
      setSaveSuccessMsg(null);
      showTransientError('避讳要点已暂存界面，但写入本地电脑数据库失败（请检查登录状态或本地服务状态）', 5000);
    }
  };

  // Remove taboo
  const handleRemoveTaboo = async (idx: number) => {
    const updated = {
      ...currentProfile,
      dislikesTaboos: currentProfile.dislikesTaboos.filter((_, i) => i !== idx),
      updatedAt: Date.now(),
    };
    const synced = await commitProfileUpdate(updated);
    if (!synced) {
      setSaveSuccessMsg(null);
      showTransientError('避讳要点已从界面移除，但写入本地电脑数据库失败（请检查登录状态或本地服务状态）', 5000);
    }
  };

  // Add memory
  const handleSaveNewMemory = async () => {
    if (!memTopic.trim() || !memSummary.trim()) {
      showTransientError('请填写记忆主题与摘要', 3000);
      return;
    }

    const newMemItem: CustomerMemoryItem = {
      id: `mem_${Date.now()}`,
      date: memDate,
      topic: memTopic.trim(),
      summary: memSummary.trim(),
      emotion: memEmotion,
    };

    const updated = {
      ...currentProfile,
      keyMemories: [newMemItem, ...currentProfile.keyMemories],
      updatedAt: Date.now(),
    };
    setMemTopic('');
    setMemSummary('');
    setIsAddingMemory(false);
    const synced = await commitProfileUpdate(updated);
    if (!synced) {
      setSaveSuccessMsg(null);
      showTransientError('关键记忆已暂存界面，但写入本地电脑数据库失败（请检查登录状态或本地服务状态）', 5000);
    }
  };

  // Remove memory
  const handleRemoveMemory = async (id: string) => {
    const updated = {
      ...currentProfile,
      keyMemories: currentProfile.keyMemories.filter((m) => m.id !== id),
      updatedAt: Date.now(),
    };
    const synced = await commitProfileUpdate(updated);
    if (!synced) {
      setSaveSuccessMsg(null);
      showTransientError('关键记忆已从界面移除，但写入本地电脑数据库失败（请检查登录状态或本地服务状态）', 5000);
    }
  };

  const cleanEditableValue = (val?: string | null) => {
    const s = String(val ?? '').trim();
    if (
      !s ||
      [
        '-',
        '未知',
        '未提及',
        '待分析',
        '待确认',
        '待沟通分析',
        '待观察',
        '待进一步了解',
        '待进一步沟通交流',
        '暂无对话数据',
        '暂无足够对话记录',
        '暂无记录（待真实沟通后提炼）',
        '尚未分析',
        '尚未沟通',
      ].includes(s)
    ) {
      return '';
    }
    return s;
  };

  // Manual attributes editing
  const handleStartEdit = () => {
    setEditAge(cleanEditableValue(currentProfile.ageEstimate));
    setEditLocation(cleanEditableValue(currentProfile.locationTimezone));
    setEditOccupation(cleanEditableValue(currentProfile.occupation));
    setEditTone(cleanEditableValue(currentProfile.toneStyle));
    setEditStage(cleanEditableValue(currentProfile.relationshipStage));
    setEditFamilyMarital(cleanEditableValue(currentProfile.familyMaritalStatus));
    setEditActiveSchedule(cleanEditableValue(currentProfile.activeSchedule));
    setEditEmotionalNeeds(cleanEditableValue(currentProfile.emotionalNeeds));
    setIsEditingAttributes(true);
  };

  const handleSaveAttributes = async () => {
    if (isSavingProfile) return;
    const updated = {
      ...currentProfile,
      ageEstimate: editAge.trim(),
      locationTimezone: editLocation.trim(),
      occupation: editOccupation.trim(),
      toneStyle: editTone.trim(),
      relationshipStage: editStage.trim() || '尚未分析',
      familyMaritalStatus: editFamilyMarital.trim(),
      activeSchedule: editActiveSchedule.trim(),
      emotionalNeeds: editEmotionalNeeds.trim(),
      updatedAt: Date.now(),
    };
    setIsSavingProfile(true);
    try {
      const synced = await commitProfileUpdate(updated);
      setIsEditingAttributes(false);
      if (synced) {
        setErrorMessage(null);
        showTransientSuccess(null, 2500, '已保存客情特征并同步至全链路 AI 档案');
      } else {
        setSaveSuccessMsg(null);
        showTransientError('已暂存界面缓存，但写入本地电脑数据库失败（请检查登录状态或本地服务状态）', 5000);
      }
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Manual investment & strategy editing
  const handleStartEditStrategy = () => {
    setEditFinancialProfile(cleanEditableValue(currentProfile.financialProfile));
    setEditInvestmentAttitude(cleanEditableValue(currentProfile.investmentAttitude));
    setEditTrustLevel(cleanEditableValue(currentProfile.trustLevel));
    setEditNextStepStrategy(cleanEditableValue(currentProfile.nextStepStrategy));
    setIsEditingStrategy(true);
  };

  const handleSaveStrategy = async () => {
    if (isSavingProfile) return;
    const updated = {
      ...currentProfile,
      financialProfile: editFinancialProfile.trim(),
      investmentAttitude: editInvestmentAttitude.trim(),
      trustLevel: editTrustLevel.trim(),
      nextStepStrategy: editNextStepStrategy.trim(),
      updatedAt: Date.now(),
    };
    setIsSavingProfile(true);
    try {
      const synced = await commitProfileUpdate(updated);
      setIsEditingStrategy(false);
      if (synced) {
        setErrorMessage(null);
        showTransientSuccess(null, 2500, '已保存经济投资画像与推进策略');
      } else {
        setSaveSuccessMsg(null);
        showTransientError('已暂存界面缓存，但写入本地电脑数据库失败（请检查登录状态或本地服务状态）', 5000);
      }
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Export customer chat data
  const handleExportData = () => {
    const jsonStr = JSON.stringify(currentProfile, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customer_memory_${currentProfile.chatId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bodyContent = (
    <>
      {!embedded && (
        <div className="px-5 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-between bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2481cc]/12 dark:bg-[#2ba0ff]/12 aurora:bg-[#14b8a6]/15 linen:bg-[#a86a43]/15 border border-[#2481cc]/25 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/30 linen:border-[#cbbba2] flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] shrink-0">
              <Brain className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] truncate">
                  {chatTitle || '当前联系人'} · 全息记忆
                </h2>
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] shrink-0">
                  · {currentProfile.relationshipStage || '尚未分析'}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-black/5 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e5d9c5] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* AI Deep Analysis Bar */}
      <div className="px-4 py-2.5 bg-[#f8fafc]/90 dark:bg-[#0d1726]/90 aurora:bg-[#0e1920]/90 linen:bg-[#f0e6d5]/90 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-between gap-3 shrink-0">
        <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
          <span>AI 对话画像提炼</span>
        </div>
          <button
            onClick={handleTriggerAnalysis}
            disabled={isAnalyzing}
            className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] text-white text-xs font-medium flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors disabled:opacity-50 shrink-0"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>提炼中...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>立即提炼</span>
              </>
            )}
          </button>
        </div>

        {saveSuccessMsg && (
          <div className="px-5 py-2 bg-emerald-500/10 border-b border-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}

        {infoNotice && !saveSuccessMsg && (
          <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>{infoNotice}</span>
          </div>
        )}

        {errorMessage && (
          <div className="px-5 py-2.5 bg-rose-500/10 dark:bg-rose-500/15 border-b border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-white p-0.5 rounded cursor-pointer transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {/* 1. Basic Stats & Attributes */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                <span>基础属性与特征</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => (isEditingAttributes ? handleSaveAttributes() : handleStartEdit())}
                  className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:opacity-80 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{isEditingAttributes ? '保存修改' : '手动修改'}</span>
                </button>
                {isEditingAttributes && (
                  <button
                    onClick={() => setIsEditingAttributes(false)}
                    className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer"
                  >
                    取消
                  </button>
                )}
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] font-mono tabular-nums">
                  {currentProfile.totalMessagesCount} 条消息
                </span>
              </div>
            </div>

            {isEditingAttributes ? (
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-1">当前关系阶段（自动联动 AI 回复分阶段话术）</label>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {['初识破冰', '朋友熟络', '情感升温', '信任深化', '投资切入'].map((stageOpt) => (
                      <button
                        key={stageOpt}
                        type="button"
                        onClick={() => setEditStage(stageOpt)}
                        className={`px-2 py-0.5 rounded-md text-[11px] border cursor-pointer transition-colors ${
                          editStage === stageOpt
                            ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43] text-white border-transparent'
                            : 'bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] text-[#475569] dark:text-[#b4c6d8] linen:text-[#4e3f32] border-[#cbd5e1] dark:border-[#1e3148] linen:border-[#cbbba2] hover:border-[#2481cc] linen:hover:border-[#a86a43]'
                        }`}
                      >
                        {stageOpt}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={editStage}
                    onChange={(e) => setEditStage(e.target.value)}
                    placeholder="如: 朋友熟络 / 情感升温 / 投资切入"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">年龄 / 生日</label>
                    <input
                      type="text"
                      value={editAge}
                      onChange={(e) => setEditAge(e.target.value)}
                      placeholder="如: 28岁 / 6月"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">所在地 / 时区</label>
                    <input
                      type="text"
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                      placeholder="如: 伊斯坦布尔 (UTC+3)"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">婚恋与家庭状态</label>
                    <input
                      type="text"
                      value={editFamilyMarital}
                      onChange={(e) => setEditFamilyMarital(e.target.value)}
                      placeholder="如: 单身 / 已婚有娃 / 独居"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">作息活跃窗口</label>
                    <input
                      type="text"
                      value={editActiveSchedule}
                      onChange={(e) => setEditActiveSchedule(e.target.value)}
                      placeholder="如: 晚21点后活跃 / 周末休息"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">职业 / 身份</label>
                  <input
                    type="text"
                    value={editOccupation}
                    onChange={(e) => setEditOccupation(e.target.value)}
                    placeholder="如: 医院职员 / 外贸老板"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">沟通习惯与语气偏好</label>
                  <input
                    type="text"
                    value={editTone}
                    onChange={(e) => setEditTone(e.target.value)}
                    placeholder="如: 慢热真诚 / 喜欢生活分享"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">深层情感诉求与生活痛点</label>
                  <textarea
                    rows={2}
                    value={editEmotionalNeeds}
                    onChange={(e) => setEditEmotionalNeeds(e.target.value)}
                    placeholder="如: 工作辛苦缺少倾听陪伴，希望能改善家人生活条件"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] resize-none"
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSaveAttributes}
                    disabled={isSavingProfile}
                    className="px-3 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] text-white rounded-lg text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {isSavingProfile ? '保存中...' : '保存客情特征'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 pt-1 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block">当前关系阶段</span>
                    <span className="font-medium text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] text-xs mt-0.5 block break-words">
                      {currentProfile.relationshipStage || '待分析'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block">年龄 / 生日</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] text-xs mt-0.5 block break-words">
                      {currentProfile.ageEstimate || '待确认'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block">所在地 / 时区</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] text-xs mt-0.5 block break-words">
                      {currentProfile.locationTimezone || '待确认'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block">婚恋与家庭状态</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] text-xs mt-0.5 block break-words">
                      {currentProfile.familyMaritalStatus || '待确认'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block">职业 / 身份</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] text-xs mt-0.5 block break-words">
                      {currentProfile.occupation || '待确认'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block">活跃作息窗口</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] text-xs mt-0.5 block break-words">
                      {currentProfile.activeSchedule || '待观察'}
                    </span>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
                  <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">沟通习惯与语气偏好</span>
                  <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] leading-relaxed">
                    {currentProfile.toneStyle || '待提炼'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 2. Likes & Topics */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
              <span className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                <span className="tabular-nums">爱好与关注话题 ({currentProfile.likesInterests.length})</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 min-h-[24px]">
              {currentProfile.likesInterests.length === 0 ? (
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">暂无记录</span>
              ) : (
                currentProfile.likesInterests.map((like, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-lg bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 border border-[#bfdbfe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2] text-[#0f172a] dark:text-[#dbeafe] aurora:text-[#ccfbf1] linen:text-[#6b3c1f] text-xs flex items-center gap-1.5"
                  >
                    <span>{like}</span>
                    <button
                      onClick={() => handleRemoveLike(i)}
                      className="text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#8c522d] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-white linen:hover:text-[#2b2118] cursor-pointer transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={newLikeInput}
                onChange={(e) => setNewLikeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddLike()}
                placeholder="添加关注话题或偏好..."
                className="flex-1 bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none transition-colors"
              />
              <button
                onClick={handleAddLike}
                className="px-3 py-1.5 rounded-lg bg-[#e8f3ff] dark:bg-[#12263f] aurora:bg-[#112d36] linen:bg-[#a86a43]/15 hover:bg-[#dbeafe] dark:hover:bg-[#183354] aurora:hover:bg-[#153a44] linen:hover:bg-[#a86a43]/25 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] text-xs font-medium cursor-pointer transition-colors shrink-0 border border-[#bfdbfe] dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2]"
              >
                添加
              </button>
            </div>
          </div>

          {/* 3. Dislikes & Taboos */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                <span className="tabular-nums">避讳与敏感雷区 ({currentProfile.dislikesTaboos.length})</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 min-h-[24px]">
              {currentProfile.dislikesTaboos.length === 0 ? (
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">暂无记录</span>
              ) : (
                currentProfile.dislikesTaboos.map((taboo, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-1.5"
                  >
                    <span>{taboo}</span>
                    <button
                      onClick={() => handleRemoveTaboo(i)}
                      className="text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-200 cursor-pointer transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={newTabooInput}
                onChange={(e) => setNewTabooInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTaboo()}
                placeholder="添加避讳要点..."
                className="flex-1 bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none transition-colors"
              />
              <button
                onClick={handleAddTaboo}
                className="px-3 py-1.5 rounded-lg bg-[#e8f3ff] dark:bg-[#12263f] aurora:bg-[#112d36] linen:bg-[#a86a43]/15 hover:bg-[#dbeafe] dark:hover:bg-[#183354] aurora:hover:bg-[#153a44] linen:hover:bg-[#a86a43]/25 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] text-xs font-medium cursor-pointer transition-colors shrink-0 border border-[#bfdbfe] dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2]"
              >
                添加
              </button>
            </div>
          </div>

          {/* 4. Emotional Needs (Always visible & manually editable via Attributes) */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
              <span className="flex items-center gap-1.5">
                <HeartHandshake className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                <span>核心诉求分析</span>
              </span>
              {!isEditingAttributes && (
                <button
                  onClick={handleStartEdit}
                  className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:opacity-80 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>补录/修改</span>
                </button>
              )}
            </div>
            <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] p-2.5 rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] leading-relaxed">
              {currentProfile.emotionalNeeds || '暂无记录（待真实沟通后提炼或点击右上角手动补录）'}
            </p>
          </div>

          {/* 4.5 Financial, Investment Attitude & Next-Step Strategy */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                <span>经济投资画像与推进策略</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => (isEditingStrategy ? handleSaveStrategy() : handleStartEditStrategy())}
                  className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:opacity-80 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{isEditingStrategy ? '保存策略' : '手动修改'}</span>
                </button>
                {isEditingStrategy && (
                  <button
                    onClick={() => setIsEditingStrategy(false)}
                    className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>

            {isEditingStrategy ? (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">当前信任度</label>
                    <input
                      type="text"
                      value={editTrustLevel}
                      onChange={(e) => setEditTrustLevel(e.target.value)}
                      placeholder="如: 中（建立好感）"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">投资态度与顾虑</label>
                    <input
                      type="text"
                      value={editInvestmentAttitude}
                      onChange={(e) => setEditInvestmentAttitude(e.target.value)}
                      placeholder="如: 想找副业但怕亏本"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">经济实力与资金线索</label>
                  <input
                    type="text"
                    value={editFinancialProfile}
                    onChange={(e) => setEditFinancialProfile(e.target.value)}
                    placeholder="如: 月薪普通有房贷压力，渴望稳定额外收入"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">下一步推进策略建议</label>
                  <textarea
                    rows={2}
                    value={editNextStepStrategy}
                    onChange={(e) => setEditNextStepStrategy(e.target.value)}
                    placeholder="如: 先关心工作辛苦与家庭近况巩固情感链接，待对方主动问副业后再轻聊思路"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] resize-none"
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSaveStrategy}
                    disabled={isSavingProfile}
                    className="px-3 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] text-white rounded-lg text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {isSavingProfile ? '保存中...' : '保存推进策略'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-0.5 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block">当前信任度</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] text-xs mt-0.5 block">
                      {currentProfile.trustLevel || '低（初识）'}
                    </span>
                  </div>
                  <div className="col-span-2 pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block">投资态度与顾虑</span>
                    <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] leading-relaxed mt-0.5">
                      {currentProfile.investmentAttitude || '待观察'}
                    </p>
                  </div>
                  <div className="col-span-2 pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block">经济实力与资金线索</span>
                    <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] leading-relaxed mt-0.5">
                      {currentProfile.financialProfile || '待进一步了解'}
                    </p>
                  </div>
                </div>
                <div className="pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
                  <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] block mb-0.5">AI / 运营下一步推进建议</span>
                  <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] p-2.5 rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] leading-relaxed">
                    {currentProfile.nextStepStrategy || '自然破冰与日常共情，暂不提及投资'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 5. Key Shared Memories */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                <span className="tabular-nums">重要约定与关键事件 ({currentProfile.keyMemories.length})</span>
              </span>
              <button
                onClick={() => setIsAddingMemory(!isAddingMemory)}
                className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>{isAddingMemory ? '收起' : '手动补录'}</span>
              </button>
            </div>

            {isAddingMemory && (
              <div className="p-3 bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={memDate}
                    onChange={(e) => setMemDate(e.target.value)}
                    className="bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#f8f2e7] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]"
                  />
                  <input
                    type="text"
                    value={memTopic}
                    onChange={(e) => setMemTopic(e.target.value)}
                    placeholder="事件主题 (如: 方案交付约定)"
                    className="bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#f8f2e7] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-2 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c]"
                  />
                </div>
                <textarea
                  value={memSummary}
                  onChange={(e) => setMemSummary(e.target.value)}
                  placeholder="详情与约定事项..."
                  rows={2}
                  className="w-full bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#f8f2e7] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] rounded-lg p-2 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none resize-none"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setIsAddingMemory(false)}
                    className="px-2.5 py-1 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveNewMemory}
                    className="px-3 py-1 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  >
                    保存记忆
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {currentProfile.keyMemories.length === 0 ? (
                <div className="text-center py-3 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                  暂无事件记录
                </div>
              ) : (
                currentProfile.keyMemories.map((mem) => (
                  <div
                    key={mem.id}
                    className="p-2.5 bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] hover:border-[#2481cc]/40 dark:hover:border-[#2ba0ff]/40 aurora:hover:border-[#2dd4bf]/40 linen:hover:border-[#a86a43]/50 transition-colors relative group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">{mem.topic}</span>
                        {mem.emotion && (
                          <span className="text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] text-[10px]">
                            · {mem.emotion}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] font-mono tabular-nums">{mem.date}</span>
                        <button
                          onClick={() => handleRemoveMemory(mem.id)}
                          className="opacity-0 group-hover:opacity-100 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-rose-600 dark:hover:text-rose-400 p-0.5 cursor-pointer transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] leading-relaxed">{mem.summary}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc]/90 dark:bg-[#0d1726]/90 aurora:bg-[#0e1920]/90 linen:bg-[#f0e6d5]/90 flex items-center justify-between shrink-0">
          <button
            onClick={handleExportData}
            className="flex items-center gap-1.5 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出 JSON 档案</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] linen:bg-[#a86a43] linen:hover:bg-[#8f5734] text-white text-xs font-medium shadow-xs cursor-pointer transition-colors"
          >
            {embedded ? '收起面板' : '完成'}
          </button>
        </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
        {bodyContent}
      </div>
    );
  }

  if (sideDocked) {
    return (
      <>
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-30 lg:hidden animate-in fade-in duration-150"
          aria-hidden="true"
        />
        <aside
          aria-label={`${chatTitle || '当前联系人'} · 全息记忆`}
          className="fixed inset-y-0 right-0 z-40 w-full max-w-[400px] lg:static lg:z-20 lg:w-[400px] lg:shrink-0 h-full flex flex-col overflow-hidden bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border-l border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] shadow-2xl lg:shadow-none text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] select-none animate-in slide-in-from-right duration-200"
        >
          {bodyContent}
        </aside>
      </>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 linen:bg-black/40 backdrop-blur-xs flex justify-end z-50 select-none">
      <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border-l border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] w-full max-w-md h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
        {bodyContent}
      </div>
    </div>
  );
};
