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
} from 'lucide-react';
import { CustomerProfile, CustomerMemoryItem, CustomLLMConfig } from '../types';
import { analyzeCustomerMemory, saveCustomerProfile, saveLocalCustomerProfile } from '../services/apiService';

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Manual attributes editing
  const [isEditingAttributes, setIsEditingAttributes] = useState(false);
  const [editAge, setEditAge] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editOccupation, setEditOccupation] = useState('');
  const [editTone, setEditTone] = useState('');
  const [editStage, setEditStage] = useState('');

  const activeScope = `${chatId || ''}::${currentAccountId || ''}`;
  const activeScopeRef = useRef(activeScope);
  activeScopeRef.current = activeScope;

  useEffect(() => {
    setIsEditingAttributes(false);
    setIsAddingMemory(false);
    setNewLikeInput('');
    setNewTabooInput('');
    setErrorMessage(null);
    setSaveSuccessMsg(false);
  }, [chatId, currentAccountId]);

  if (!isOpen) return null;

  const effectiveAccountId =
    currentAccountId ||
    (profile && (!chatId || profile.chatId === chatId) ? profile.accountId : '') ||
    '';

  const scopedProfile =
    profile &&
    (!chatId || profile.chatId === chatId) &&
    (!effectiveAccountId || !profile.accountId || profile.accountId === effectiveAccountId)
      ? { ...profile, accountId: profile.accountId || effectiveAccountId }
      : null;

  const currentProfile: CustomerProfile = scopedProfile || {
    chatId: chatId || 'current',
    accountId: effectiveAccountId,
    clientName: chatTitle || '当前联系人',
    relationshipStage: '沟通中',
    ageEstimate: '待分析',
    occupation: '待分析',
    locationTimezone: '待确认',
    toneStyle: '自然亲切、高效沟通',
    likesInterests: [],
    dislikesTaboos: [],
    emotionalNeeds: '暂无记录',
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
    if (!embedded && !options?.skipRemoteSave && targetChatId && targetChatId !== 'current') {
      void saveCustomerProfile(targetChatId, scopedUpdated, targetAccId);
    }
  };

  // Run AI Deep Analysis over unified cloud + local conversation history
  const handleTriggerAnalysis = async () => {
    if ((!messages || messages.length === 0) && (!currentProfile.chatId || currentProfile.chatId === 'current')) {
      setErrorMessage('当前联系人暂无真实对话记录。请在与客户进行真实沟通后，再执行全息画像与长效记忆提炼。');
      setTimeout(() => setErrorMessage(null), 4000);
      return;
    }

    const requestChatId = currentProfile.chatId;
    const requestAccountId = effectiveAccountId;
    const requestScope = activeScope;

    setIsAnalyzing(true);
    setErrorMessage(null);
    try {
      const freshProfile = await analyzeCustomerMemory(
        requestChatId,
        customConfig,
        requestAccountId,
        messages,
        chatTitle
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
        setSaveSuccessMsg(true);
        setTimeout(() => setSaveSuccessMsg(false), 3000);
      }
    } catch (err: any) {
      if (activeScopeRef.current === requestScope) {
        setErrorMessage(err?.message || 'AI 记忆提炼失败，请检查网络或模型配置');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } finally {
      if (activeScopeRef.current === requestScope) {
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
      setErrorMessage('请填写记忆主题与摘要');
      setTimeout(() => setErrorMessage(null), 3000);
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
    setEditStage(currentProfile.relationshipStage || '沟通中');
    setIsEditingAttributes(true);
  };

  const handleSaveAttributes = () => {
    const updated = {
      ...currentProfile,
      ageEstimate: editAge.trim() || '待确认',
      locationTimezone: editLocation.trim() || '待确认',
      occupation: editOccupation.trim() || '待确认',
      toneStyle: editTone.trim() || '自然亲切、高效沟通',
      relationshipStage: editStage.trim() || '沟通中',
      updatedAt: Date.now(),
    };
    commitProfileUpdate(updated);
    setIsEditingAttributes(false);
    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 2500);
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
        <div className="px-5 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] flex items-center justify-between bg-[#f8fafc] dark:bg-[#0b1523]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2481cc]/15 dark:bg-[#2ba0ff]/15 border border-[#2481cc]/25 dark:border-[#2ba0ff]/30 flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff] shrink-0">
              <Brain className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-[#0f172a] dark:text-white truncate">
                  {chatTitle || '当前联系人'} · 全息记忆
                </h2>
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] shrink-0">
                  · {currentProfile.relationshipStage || '沟通中'}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* AI Deep Analysis Bar */}
      <div className="px-4 py-2.5 bg-[#f8fafc]/90 dark:bg-[#0d1726]/90 border-b border-[#e2e8f0] dark:border-[#162436] flex items-center justify-between gap-3 shrink-0">
        <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff]" />
          <span>AI 对话画像提炼</span>
        </div>
          <button
            onClick={handleTriggerAnalysis}
            disabled={isAnalyzing}
            className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#2074b8] text-white text-xs font-medium flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors disabled:opacity-50 shrink-0"
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
          <div className="px-5 py-2 bg-emerald-500/10 border-b border-emerald-500/25 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>已成功从历史记录更新客户全息画像与记忆！</span>
          </div>
        )}

        {errorMessage && (
          <div className="px-5 py-2.5 bg-rose-500/15 border-b border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-white p-0.5 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {/* 1. Basic Stats & Attributes */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff]" />
                <span>基础属性与特征</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => (isEditingAttributes ? handleSaveAttributes() : handleStartEdit())}
                  className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] hover:opacity-80 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{isEditingAttributes ? '保存修改' : '手动修改'}</span>
                </button>
                {isEditingAttributes && (
                  <button
                    onClick={() => setIsEditingAttributes(false)}
                    className="text-[11px] text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white cursor-pointer"
                  >
                    取消
                  </button>
                )}
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] font-mono tabular-nums">
                  {currentProfile.totalMessagesCount} 条消息
                </span>
              </div>
            </div>

            {isEditingAttributes ? (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] block mb-0.5">年龄 / 生日</label>
                    <input
                      type="text"
                      value={editAge}
                      onChange={(e) => setEditAge(e.target.value)}
                      placeholder="如: 28岁 / 6月"
                      className="w-full bg-white dark:bg-[#08101a] border border-[#cbd5e1] dark:border-[#1d2e44] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-white focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] block mb-0.5">所在地 / 时区</label>
                    <input
                      type="text"
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                      placeholder="如: 伦敦 (UTC+0)"
                      className="w-full bg-white dark:bg-[#08101a] border border-[#cbd5e1] dark:border-[#1d2e44] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-white focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] block mb-0.5">职业 / 身份</label>
                  <input
                    type="text"
                    value={editOccupation}
                    onChange={(e) => setEditOccupation(e.target.value)}
                    placeholder="如: 外贸采购经理 / 投资人"
                    className="w-full bg-white dark:bg-[#08101a] border border-[#cbd5e1] dark:border-[#1d2e44] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-white focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#64748b] dark:text-[#7b93ad] block mb-0.5">沟通习惯与语气偏好</label>
                  <input
                    type="text"
                    value={editTone}
                    onChange={(e) => setEditTone(e.target.value)}
                    placeholder="如: 讲究效率、干脆利落"
                    className="w-full bg-white dark:bg-[#08101a] border border-[#cbd5e1] dark:border-[#1d2e44] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-white focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff]"
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSaveAttributes}
                    className="px-3 py-1.5 bg-[#2481cc] hover:bg-[#1e70b5] text-white rounded-lg text-xs font-medium cursor-pointer"
                  >
                    保存客情特征
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 pt-1 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] block">年龄 / 生日</span>
                    <span className="font-medium text-[#0f172a] dark:text-white text-xs mt-0.5 block truncate">
                      {currentProfile.ageEstimate || '待确认'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] block">所在地 / 时区</span>
                    <span className="font-medium text-[#0f172a] dark:text-white text-xs mt-0.5 block truncate">
                      {currentProfile.locationTimezone || '待确认'}
                    </span>
                  </div>
                  <div className="col-span-2 pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a]">
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] block">职业 / 身份</span>
                    <span className="font-medium text-[#0f172a] dark:text-white text-xs mt-0.5 block truncate">
                      {currentProfile.occupation || '待确认'}
                    </span>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-[#e2e8f0] dark:border-[#18273a]">
                  <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] block mb-0.5">沟通习惯与语气偏好</span>
                  <p className="text-xs text-[#475569] dark:text-[#9bb3c9] leading-relaxed">
                    {currentProfile.toneStyle || '待提炼'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 2. Likes & Topics */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">
              <span className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff]" />
                <span className="tabular-nums">爱好与关注话题 ({currentProfile.likesInterests.length})</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 min-h-[24px]">
              {currentProfile.likesInterests.length === 0 ? (
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad]">暂无记录</span>
              ) : (
                currentProfile.likesInterests.map((like, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-lg bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 border border-[#bfdbfe] dark:border-[#2ba0ff]/25 text-[#0f172a] dark:text-[#dbeafe] text-xs flex items-center gap-1.5"
                  >
                    <span>{like}</span>
                    <button
                      onClick={() => handleRemoveLike(i)}
                      className="text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white cursor-pointer transition-colors"
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
                className="flex-1 bg-white dark:bg-[#08101a] border border-[#cbd5e1] dark:border-[#1d2e44] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-white placeholder-[#94a3b8] dark:placeholder-[#5b7490] focus:outline-none transition-colors"
              />
              <button
                onClick={handleAddLike}
                className="px-3 py-1.5 rounded-lg bg-[#e8f3ff] dark:bg-[#162538] hover:bg-[#dbeafe] dark:hover:bg-[#1e334d] text-[#2481cc] dark:text-[#2ba0ff] text-xs font-medium cursor-pointer transition-colors shrink-0 border border-[#bfdbfe]/60 dark:border-[#243952]"
              >
                添加
              </button>
            </div>
          </div>

          {/* 3. Dislikes & Taboos */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                <span className="tabular-nums">避讳与敏感雷区 ({currentProfile.dislikesTaboos.length})</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 min-h-[24px]">
              {currentProfile.dislikesTaboos.length === 0 ? (
                <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad]">暂无记录</span>
              ) : (
                currentProfile.dislikesTaboos.map((taboo, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-1.5"
                  >
                    <span>{taboo}</span>
                    <button
                      onClick={() => handleRemoveTaboo(i)}
                      className="text-rose-400 hover:text-rose-600 dark:hover:text-rose-200 cursor-pointer transition-colors"
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
                className="flex-1 bg-white dark:bg-[#08101a] border border-[#cbd5e1] dark:border-[#1d2e44] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-white placeholder-[#94a3b8] dark:placeholder-[#5b7490] focus:outline-none transition-colors"
              />
              <button
                onClick={handleAddTaboo}
                className="px-3 py-1.5 rounded-lg bg-[#e8f3ff] dark:bg-[#162538] hover:bg-[#dbeafe] dark:hover:bg-[#1e334d] text-[#2481cc] dark:text-[#2ba0ff] text-xs font-medium cursor-pointer transition-colors shrink-0 border border-[#bfdbfe]/60 dark:border-[#243952]"
              >
                添加
              </button>
            </div>
          </div>

          {/* 4. Emotional Needs */}
          {currentProfile.emotionalNeeds && currentProfile.emotionalNeeds !== '暂无特定记录' && currentProfile.emotionalNeeds !== '暂无记录' && (
            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-1.5">
              <span className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] block">核心诉求分析</span>
              <p className="text-xs text-[#475569] dark:text-[#9bb3c9] bg-white dark:bg-[#08101a] p-2.5 rounded-lg border border-[#e2e8f0] dark:border-[#18273a] leading-relaxed">
                {currentProfile.emotionalNeeds}
              </p>
            </div>
          )}

          {/* 5. Key Shared Memories */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff]" />
                <span className="tabular-nums">重要约定与关键事件 ({currentProfile.keyMemories.length})</span>
              </span>
              <button
                onClick={() => setIsAddingMemory(!isAddingMemory)}
                className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>{isAddingMemory ? '收起' : '手动补录'}</span>
              </button>
            </div>

            {isAddingMemory && (
              <div className="p-3 bg-white dark:bg-[#08101a] rounded-lg border border-[#e2e8f0] dark:border-[#18273a] space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={memDate}
                    onChange={(e) => setMemDate(e.target.value)}
                    className="bg-[#f8fafc] dark:bg-[#0e1726] border border-[#cbd5e1] dark:border-[#1d2e44] rounded-lg px-2 py-1.5 text-xs text-[#0f172a] dark:text-white"
                  />
                  <input
                    type="text"
                    value={memTopic}
                    onChange={(e) => setMemTopic(e.target.value)}
                    placeholder="事件主题 (如: 方案交付约定)"
                    className="bg-[#f8fafc] dark:bg-[#0e1726] border border-[#cbd5e1] dark:border-[#1d2e44] rounded-lg px-2 py-1.5 text-xs text-[#0f172a] dark:text-white"
                  />
                </div>
                <textarea
                  value={memSummary}
                  onChange={(e) => setMemSummary(e.target.value)}
                  placeholder="详情与约定事项..."
                  rows={2}
                  className="w-full bg-[#f8fafc] dark:bg-[#0e1726] border border-[#cbd5e1] dark:border-[#1d2e44] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] rounded-lg p-2 text-xs text-[#0f172a] dark:text-white placeholder-[#94a3b8] dark:placeholder-[#5b7490] focus:outline-none resize-none"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setIsAddingMemory(false)}
                    className="px-2.5 py-1 text-xs text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveNewMemory}
                    className="px-3 py-1 bg-[#2481cc] hover:bg-[#1e70b5] text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  >
                    保存记忆
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {currentProfile.keyMemories.length === 0 ? (
                <div className="text-center py-3 text-xs text-[#64748b] dark:text-[#7b93ad]">
                  暂无事件记录
                </div>
              ) : (
                currentProfile.keyMemories.map((mem) => (
                  <div
                    key={mem.id}
                    className="p-2.5 bg-white dark:bg-[#08101a] rounded-lg border border-[#e2e8f0] dark:border-[#18273a] hover:border-[#2481cc]/40 dark:hover:border-[#2ba0ff]/40 transition-colors relative group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs text-[#0f172a] dark:text-white">{mem.topic}</span>
                        {mem.emotion && (
                          <span className="text-[#64748b] dark:text-[#7b93ad] text-[10px]">
                            · {mem.emotion}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] font-mono tabular-nums">{mem.date}</span>
                        <button
                          onClick={() => handleRemoveMemory(mem.id)}
                          className="opacity-0 group-hover:opacity-100 text-[#64748b] dark:text-[#7b93ad] hover:text-rose-500 dark:hover:text-rose-400 p-0.5 cursor-pointer transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-[#475569] dark:text-[#9bb3c9] leading-relaxed">{mem.summary}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#e2e8f0] dark:border-[#162436] bg-[#f8fafc]/90 dark:bg-[#0b1523]/90 flex items-center justify-between shrink-0">
          <button
            onClick={handleExportData}
            className="flex items-center gap-1.5 text-xs text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出 JSON 档案</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1e70b5] text-white text-xs font-medium shadow-xs cursor-pointer transition-colors"
          >
            {embedded ? '收起面板' : '完成'}
          </button>
        </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden text-[#0f172a] dark:text-[#eef4fb]">
        {bodyContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex justify-end z-50 select-none">
      <div className="bg-white dark:bg-[#09111b] border-l border-[#e2e8f0] dark:border-[#18273a] w-full max-w-md h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 text-[#0f172a] dark:text-[#eef4fb]">
        {bodyContent}
      </div>
    </div>
  );
};
