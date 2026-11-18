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
  onUpdateProfile: (updated: CustomerProfile, options?: { skipRemoteSave?: boolean }) => void;
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
  const [newLikeInput, setNewLikeInput] = useState('');
  const [newTabooInput, setNewTabooInput] = useState('');
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [memDate, setMemDate] = useState(new Date().toISOString().split('T')[0]);
  const [memTopic, setMemTopic] = useState('');
  const [memSummary, setMemSummary] = useState('');
  const [memEmotion, setMemEmotion] = useState('日常交流');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
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

  const showTransientSuccess = (noticeText: string | null, durationMs = 3000) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    if (noticeText) {
      setSaveSuccessMsg(false);
      setInfoNotice(noticeText);
      feedbackTimerRef.current = setTimeout(() => {
        setInfoNotice(null);
        feedbackTimerRef.current = null;
      }, durationMs);
    } else {
      setInfoNotice(null);
      setSaveSuccessMsg(true);
      feedbackTimerRef.current = setTimeout(() => {
        setSaveSuccessMsg(false);
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
    setSaveSuccessMsg(false);
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
      ? { ...profile, accountId: profile.accountId || effectiveAccountId }
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

  const commitProfileUpdate = (updated: CustomerProfile, options?: { skipRemoteSave?: boolean }) => {
    const targetAccId = currentAccountId || updated.accountId || effectiveAccountId;
    const targetChatId = chatId || updated.chatId || currentProfile.chatId;
    const scopedUpdated: CustomerProfile = {
      ...updated,
      chatId: targetChatId,
      accountId: targetAccId,
    };
    onUpdateProfile(scopedUpdated, options);
    if (!embedded && targetChatId && targetChatId !== 'current') {
      saveLocalCustomerProfile(targetChatId, scopedUpdated, targetAccId);
      if (!options?.skipRemoteSave) {
        void saveCustomerProfile(targetChatId, scopedUpdated, targetAccId);
      }
    }
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
        commitProfileUpdate(scopedFresh, { skipRemoteSave: true });
        showTransientSuccess(sparseNotice, sparseNotice ? 4500 : 3000);
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
  const handleAddLike = () => {
    if (!newLikeInput.trim()) return;
    const updated = {
      ...currentProfile,
      likesInterests: [...currentProfile.likesInterests, newLikeInput.trim()],
    };
    commitProfileUpdate(updated);
    setNewLikeInput('');
  };

  // Remove like
  const handleRemoveLike = (idx: number) => {
    const updated = {
      ...currentProfile,
      likesInterests: currentProfile.likesInterests.filter((_, i) => i !== idx),
    };
    commitProfileUpdate(updated);
  };

  // Add taboo
  const handleAddTaboo = () => {
    if (!newTabooInput.trim()) return;
    const updated = {
      ...currentProfile,
      dislikesTaboos: [...currentProfile.dislikesTaboos, newTabooInput.trim()],
    };
    commitProfileUpdate(updated);
    setNewTabooInput('');
  };

  // Remove taboo
  const handleRemoveTaboo = (idx: number) => {
    const updated = {
      ...currentProfile,
      dislikesTaboos: currentProfile.dislikesTaboos.filter((_, i) => i !== idx),
    };
    commitProfileUpdate(updated);
  };

  // Add memory
  const handleSaveNewMemory = () => {
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
    };
    commitProfileUpdate(updated);

    setMemTopic('');
    setMemSummary('');
    setIsAddingMemory(false);
  };

  // Remove memory
  const handleRemoveMemory = (id: string) => {
    const updated = {
      ...currentProfile,
      keyMemories: currentProfile.keyMemories.filter((m) => m.id !== id),
    };
    commitProfileUpdate(updated);
  };

  // Manual attributes editing
  const handleStartEdit = () => {
    setEditAge(currentProfile.ageEstimate || '');
    setEditLocation(currentProfile.locationTimezone || '');
    setEditOccupation(currentProfile.occupation || '');
    setEditTone(currentProfile.toneStyle || '');
    setEditStage(currentProfile.relationshipStage || '');
    setEditFamilyMarital(currentProfile.familyMaritalStatus || '');
    setEditActiveSchedule(currentProfile.activeSchedule || '');
    setEditEmotionalNeeds(currentProfile.emotionalNeeds || '');
    setIsEditingAttributes(true);
  };

  const handleSaveAttributes = () => {
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
    commitProfileUpdate(updated);
    setIsEditingAttributes(false);
    showTransientSuccess(null, 2500);
  };

  // Manual investment & strategy editing
  const handleStartEditStrategy = () => {
    setEditFinancialProfile(currentProfile.financialProfile || '');
    setEditInvestmentAttitude(currentProfile.investmentAttitude || '');
    setEditTrustLevel(currentProfile.trustLevel || '');
    setEditNextStepStrategy(currentProfile.nextStepStrategy || '');
    setIsEditingStrategy(true);
  };

  const handleSaveStrategy = () => {
    const updated = {
      ...currentProfile,
      financialProfile: editFinancialProfile.trim(),
      investmentAttitude: editInvestmentAttitude.trim(),
      trustLevel: editTrustLevel.trim(),
      nextStepStrategy: editNextStepStrategy.trim(),
      updatedAt: Date.now(),
    };
    commitProfileUpdate(updated);
    setIsEditingStrategy(false);
    showTransientSuccess(null, 2500);
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
        <div className="px-5 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2481cc]/12 dark:bg-[#2ba0ff]/12 aurora:bg-[#14b8a6]/15 border border-[#2481cc]/25 dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/30 flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] shrink-0">
              <Brain className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] truncate">
                  {chatTitle || '当前联系人'} · 全息记忆
                </h2>
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] shrink-0">
                  · {currentProfile.relationshipStage || '尚未分析'}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] hover:bg-black/5 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* AI Deep Analysis Bar */}
      <div className="px-4 py-2.5 bg-[#f8fafc]/90 dark:bg-[#0d1726]/90 aurora:bg-[#0e1920]/90 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between gap-3 shrink-0">
        <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
          <span>AI 对话画像提炼</span>
        </div>
          <button
            onClick={handleTriggerAnalysis}
            disabled={isAnalyzing}
            className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-xs font-medium flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors disabled:opacity-50 shrink-0"
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
            <span>已成功从历史记录更新客户全息画像与记忆！</span>
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
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                <span>基础属性与特征</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => (isEditingAttributes ? handleSaveAttributes() : handleStartEdit())}
                  className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:opacity-80 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{isEditingAttributes ? '保存修改' : '手动修改'}</span>
                </button>
                {isEditingAttributes && (
                  <button
                    onClick={() => setIsEditingAttributes(false)}
                    className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] cursor-pointer"
                  >
                    取消
                  </button>
                )}
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] font-mono tabular-nums">
                  {currentProfile.totalMessagesCount} 条消息
                </span>
              </div>
            </div>

            {isEditingAttributes ? (
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-1">当前关系阶段（自动联动 AI 回复分阶段话术）</label>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {['初识破冰', '朋友熟络', '情感升温', '信任深化', '投资切入'].map((stageOpt) => (
                      <button
                        key={stageOpt}
                        type="button"
                        onClick={() => setEditStage(stageOpt)}
                        className={`px-2 py-0.5 rounded-md text-[11px] border cursor-pointer transition-colors ${
                          editStage === stageOpt
                            ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white border-transparent'
                            : 'bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#475569] dark:text-[#b4c6d8] border-[#cbd5e1] dark:border-[#1e3148] hover:border-[#2481cc]'
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
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">年龄 / 生日</label>
                    <input
                      type="text"
                      value={editAge}
                      onChange={(e) => setEditAge(e.target.value)}
                      placeholder="如: 28岁 / 6月"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">所在地 / 时区</label>
                    <input
                      type="text"
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                      placeholder="如: 伊斯坦布尔 (UTC+3)"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">婚恋与家庭状态</label>
                    <input
                      type="text"
                      value={editFamilyMarital}
                      onChange={(e) => setEditFamilyMarital(e.target.value)}
                      placeholder="如: 单身 / 已婚有娃 / 独居"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">作息活跃窗口</label>
                    <input
                      type="text"
                      value={editActiveSchedule}
                      onChange={(e) => setEditActiveSchedule(e.target.value)}
                      placeholder="如: 晚21点后活跃 / 周末休息"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">职业 / 身份</label>
                  <input
                    type="text"
                    value={editOccupation}
                    onChange={(e) => setEditOccupation(e.target.value)}
                    placeholder="如: 医院职员 / 外贸老板"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">沟通习惯与语气偏好</label>
                  <input
                    type="text"
                    value={editTone}
                    onChange={(e) => setEditTone(e.target.value)}
                    placeholder="如: 慢热真诚 / 喜欢生活分享"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">深层情感诉求与生活痛点</label>
                  <textarea
                    rows={2}
                    value={editEmotionalNeeds}
                    onChange={(e) => setEditEmotionalNeeds(e.target.value)}
                    placeholder="如: 工作辛苦缺少倾听陪伴，希望能改善家人生活条件"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] resize-none"
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSaveAttributes}
                    className="px-3 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  >
                    保存客情特征
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 pt-1 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">当前关系阶段</span>
                    <span className="font-medium text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] text-xs mt-0.5 block truncate">
                      {currentProfile.relationshipStage || '待分析'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">年龄 / 生日</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-xs mt-0.5 block truncate">
                      {currentProfile.ageEstimate || '待确认'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">所在地 / 时区</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-xs mt-0.5 block truncate">
                      {currentProfile.locationTimezone || '待确认'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">婚恋与家庭状态</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-xs mt-0.5 block truncate">
                      {currentProfile.familyMaritalStatus || '待确认'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">职业 / 身份</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-xs mt-0.5 block truncate">
                      {currentProfile.occupation || '待确认'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">活跃作息窗口</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-xs mt-0.5 block truncate">
                      {currentProfile.activeSchedule || '待观察'}
                    </span>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                  <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">沟通习惯与语气偏好</span>
                  <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] leading-relaxed">
                    {currentProfile.toneStyle || '待提炼'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 2. Likes & Topics */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
              <span className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                <span className="tabular-nums">爱好与关注话题 ({currentProfile.likesInterests.length})</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 min-h-[24px]">
              {currentProfile.likesInterests.length === 0 ? (
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">暂无记录</span>
              ) : (
                currentProfile.likesInterests.map((like, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-lg bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] border border-[#bfdbfe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/35 text-[#0f172a] dark:text-[#dbeafe] aurora:text-[#ccfbf1] text-xs flex items-center gap-1.5"
                  >
                    <span>{like}</span>
                    <button
                      onClick={() => handleRemoveLike(i)}
                      className="text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-white cursor-pointer transition-colors"
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
                className="flex-1 bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none transition-colors"
              />
              <button
                onClick={handleAddLike}
                className="px-3 py-1.5 rounded-lg bg-[#e8f3ff] dark:bg-[#12263f] aurora:bg-[#112d36] hover:bg-[#dbeafe] dark:hover:bg-[#183354] aurora:hover:bg-[#153a44] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] text-xs font-medium cursor-pointer transition-colors shrink-0 border border-[#bfdbfe] dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35"
              >
                添加
              </button>
            </div>
          </div>

          {/* 3. Dislikes & Taboos */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                <span className="tabular-nums">避讳与敏感雷区 ({currentProfile.dislikesTaboos.length})</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 min-h-[24px]">
              {currentProfile.dislikesTaboos.length === 0 ? (
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">暂无记录</span>
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
                className="flex-1 bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none transition-colors"
              />
              <button
                onClick={handleAddTaboo}
                className="px-3 py-1.5 rounded-lg bg-[#e8f3ff] dark:bg-[#12263f] aurora:bg-[#112d36] hover:bg-[#dbeafe] dark:hover:bg-[#183354] aurora:hover:bg-[#153a44] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] text-xs font-medium cursor-pointer transition-colors shrink-0 border border-[#bfdbfe] dark:border-[#2ba0ff]/30 aurora:border-[#2dd4bf]/35"
              >
                添加
              </button>
            </div>
          </div>

          {/* 4. Emotional Needs (Always visible & manually editable via Attributes) */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
              <span className="flex items-center gap-1.5">
                <HeartHandshake className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                <span>核心诉求分析</span>
              </span>
              {!isEditingAttributes && (
                <button
                  onClick={handleStartEdit}
                  className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:opacity-80 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>补录/修改</span>
                </button>
              )}
            </div>
            <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] bg-white dark:bg-[#08101a] aurora:bg-[#081014] p-2.5 rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] leading-relaxed">
              {currentProfile.emotionalNeeds || '暂无记录（待真实沟通后提炼或点击右上角手动补录）'}
            </p>
          </div>

          {/* 4.5 Financial, Investment Attitude & Next-Step Strategy */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                <span>经济投资画像与推进策略</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => (isEditingStrategy ? handleSaveStrategy() : handleStartEditStrategy())}
                  className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:opacity-80 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{isEditingStrategy ? '保存策略' : '手动修改'}</span>
                </button>
                {isEditingStrategy && (
                  <button
                    onClick={() => setIsEditingStrategy(false)}
                    className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] cursor-pointer"
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
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">当前信任度</label>
                    <input
                      type="text"
                      value={editTrustLevel}
                      onChange={(e) => setEditTrustLevel(e.target.value)}
                      placeholder="如: 中（建立好感）"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">投资态度与顾虑</label>
                    <input
                      type="text"
                      value={editInvestmentAttitude}
                      onChange={(e) => setEditInvestmentAttitude(e.target.value)}
                      placeholder="如: 想找副业但怕亏本"
                      className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">经济实力与资金线索</label>
                  <input
                    type="text"
                    value={editFinancialProfile}
                    onChange={(e) => setEditFinancialProfile(e.target.value)}
                    placeholder="如: 月薪普通有房贷压力，渴望稳定额外收入"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">下一步推进策略建议</label>
                  <textarea
                    rows={2}
                    value={editNextStepStrategy}
                    onChange={(e) => setEditNextStepStrategy(e.target.value)}
                    placeholder="如: 先关心工作辛苦与家庭近况巩固情感链接，待对方主动问副业后再轻聊思路"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] resize-none"
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSaveStrategy}
                    className="px-3 py-1.5 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  >
                    保存推进策略
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-0.5 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">当前信任度</span>
                    <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-xs mt-0.5 block">
                      {currentProfile.trustLevel || '低（初识）'}
                    </span>
                  </div>
                  <div className="col-span-2 pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">投资态度与顾虑</span>
                    <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] leading-relaxed mt-0.5">
                      {currentProfile.investmentAttitude || '待观察'}
                    </p>
                  </div>
                  <div className="col-span-2 pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">经济实力与资金线索</span>
                    <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] leading-relaxed mt-0.5">
                      {currentProfile.financialProfile || '待进一步了解'}
                    </p>
                  </div>
                </div>
                <div className="pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                  <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-0.5">AI / 运营下一步推进建议</span>
                  <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] bg-white dark:bg-[#08101a] aurora:bg-[#081014] p-2.5 rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] leading-relaxed">
                    {currentProfile.nextStepStrategy || '自然破冰与日常共情，暂不提及投资'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 5. Key Shared Memories */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                <span className="tabular-nums">重要约定与关键事件 ({currentProfile.keyMemories.length})</span>
              </span>
              <button
                onClick={() => setIsAddingMemory(!isAddingMemory)}
                className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>{isAddingMemory ? '收起' : '手动补录'}</span>
              </button>
            </div>

            {isAddingMemory && (
              <div className="p-3 bg-white dark:bg-[#08101a] aurora:bg-[#081014] rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={memDate}
                    onChange={(e) => setMemDate(e.target.value)}
                    className="bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]"
                  />
                  <input
                    type="text"
                    value={memTopic}
                    onChange={(e) => setMemTopic(e.target.value)}
                    placeholder="事件主题 (如: 方案交付约定)"
                    className="bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782]"
                  />
                </div>
                <textarea
                  value={memSummary}
                  onChange={(e) => setMemSummary(e.target.value)}
                  placeholder="详情与约定事项..."
                  rows={2}
                  className="w-full bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] rounded-lg p-2 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none resize-none"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setIsAddingMemory(false)}
                    className="px-2.5 py-1 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveNewMemory}
                    className="px-3 py-1 bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  >
                    保存记忆
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {currentProfile.keyMemories.length === 0 ? (
                <div className="text-center py-3 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                  暂无事件记录
                </div>
              ) : (
                currentProfile.keyMemories.map((mem) => (
                  <div
                    key={mem.id}
                    className="p-2.5 bg-white dark:bg-[#08101a] aurora:bg-[#081014] rounded-lg border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] hover:border-[#2481cc]/40 dark:hover:border-[#2ba0ff]/40 aurora:hover:border-[#2dd4bf]/40 transition-colors relative group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">{mem.topic}</span>
                        {mem.emotion && (
                          <span className="text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] text-[10px]">
                            · {mem.emotion}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] font-mono tabular-nums">{mem.date}</span>
                        <button
                          onClick={() => handleRemoveMemory(mem.id)}
                          className="opacity-0 group-hover:opacity-100 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-rose-600 dark:hover:text-rose-400 p-0.5 cursor-pointer transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] leading-relaxed">{mem.summary}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] bg-[#f8fafc]/90 dark:bg-[#0d1726]/90 aurora:bg-[#0e1920]/90 flex items-center justify-between shrink-0">
          <button
            onClick={handleExportData}
            className="flex items-center gap-1.5 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出 JSON 档案</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-xs font-medium shadow-xs cursor-pointer transition-colors"
          >
            {embedded ? '收起面板' : '完成'}
          </button>
        </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
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
          className="fixed inset-y-0 right-0 z-40 w-full max-w-[400px] lg:static lg:z-20 lg:w-[400px] lg:shrink-0 h-full flex flex-col overflow-hidden bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border-l border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] shadow-2xl lg:shadow-none text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] select-none animate-in slide-in-from-right duration-200"
        >
          {bodyContent}
        </aside>
      </>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex justify-end z-50 select-none">
      <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border-l border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] w-full max-w-md h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
        {bodyContent}
      </div>
    </div>
  );
};
