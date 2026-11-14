import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import {
  GlobalPersonaConfig,
  StagedPromptKey,
  CustomLLMConfig,
} from '../types';
import {
  fetchGlobalPersonaApi,
  saveGlobalPersonaApi,
  resetGlobalPersonaApi,
  importPersonaTemplateApi,
  testPersonaReplyApi,
} from '../services/apiService';

interface KnowledgeEvolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  customConfig?: CustomLLMConfig;
  embedded?: boolean;
}

export const KnowledgeEvolutionModal: React.FC<KnowledgeEvolutionModalProps> = ({
  isOpen,
  onClose,
  customConfig,
  embedded = false,
}) => {
  const [activeTab, setActiveTab] = useState<'persona' | 'sandbox'>('persona');

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

  // 2. Sandbox State (blank initial state — no hardcoded persona transcripts)
  const [sandboxStage, setSandboxStage] = useState<StagedPromptKey>('icebreaker');
  const [sandboxInput, setSandboxInput] = useState<string>('');
  const [sandboxChatTranscript, setSandboxChatTranscript] = useState<string>('');
  const [showTranscriptInput, setShowTranscriptInput] = useState<boolean>(false);
  const [sandboxResult, setSandboxResult] = useState<{
    reply: string;
    matchedKnowledge: any[];
    appliedHabits: any[];
    source: string;
  } | null>(null);
  const [isTestingReply, setIsTestingReply] = useState<boolean>(false);
  const [sandboxError, setSandboxError] = useState<string>('');

  useEffect(() => {
    if (!isOpen && !embedded) return;
    loadPersonaData();
  }, [isOpen, embedded]);

  const loadPersonaData = async () => {
    setIsLoadingPersona(true);
    try {
      const pRes = await fetchGlobalPersonaApi();
      if (pRes.success && pRes.persona) {
        setPersona(pRes.persona);
        setTraitInput((pRes.persona.personalityTraits || []).join(', '));
        if (pRes.persona.activeStage) {
          setActiveStageEdit(pRes.persona.activeStage);
          setSandboxStage(pRes.persona.activeStage);
        }
      }
    } catch (err) {
      console.error('Failed to load persona data:', err);
    } finally {
      setIsLoadingPersona(false);
    }
  };

  const handleSavePersona = async () => {
    if (!persona) return;
    setIsSavingPersona(true);
    setPersonaActionError('');
    try {
      const normalizedPersona: GlobalPersonaConfig = {
        ...persona,
        personalityTraits: traitInput
          .split(/[,，\n]+/)
          .map((t) => t.trim())
          .filter(Boolean),
      };
      const res = await saveGlobalPersonaApi(normalizedPersona);
      if (res.success) {
        setPersona(res.persona || normalizedPersona);
        setPersonaSaveSuccess(true);
        setTimeout(() => setPersonaSaveSuccess(false), 3000);
      } else {
        setPersonaActionError((res as any)?.error || '保存人设配置失败，请重试');
      }
    } catch (err: any) {
      console.error(err);
      setPersonaActionError(err?.message || '保存人设配置异常');
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
      const res = await resetGlobalPersonaApi();
      if (res.success && res.persona) {
        setPersona(res.persona);
        setTraitInput((res.persona.personalityTraits || []).join(', '));
        if (res.persona.activeStage) {
          setActiveStageEdit(res.persona.activeStage);
          setSandboxStage(res.persona.activeStage);
        }
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
      const res = await importPersonaTemplateApi();
      if (res.success && res.persona) {
        setPersona(res.persona);
        setTraitInput((res.persona.personalityTraits || []).join(', '));
        if (res.persona.activeStage) {
          setActiveStageEdit(res.persona.activeStage);
          setSandboxStage(res.persona.activeStage);
        }
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

  const handleRunSandbox = async () => {
    if (!sandboxInput.trim()) return;
    setIsTestingReply(true);
    setSandboxError('');
    setSandboxResult(null);
    try {
      const res = await testPersonaReplyApi({
        message: sandboxInput.trim(),
        stage: sandboxStage,
        chatTranscript: sandboxChatTranscript.trim() || undefined,
        customConfig,
      });
      if (res.success) {
        setSandboxResult({
          reply: res.reply || '无回复内容',
          matchedKnowledge: res.matchedKnowledge || [],
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

  const innerContent = (
    <>
      {/* Modal Top Bar (Standalone Modal Mode Only) */}
      {!embedded && (
        <header className="px-6 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] flex items-center justify-between shrink-0 bg-[#f8fafc] dark:bg-[#070d16]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#2ba0ff]/12 border border-[#2ba0ff]/25 flex items-center justify-center text-[#0284c7] dark:text-[#2ba0ff]">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-[#0f172a] dark:text-[#eef4fb]">
                人设资料中心
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
      )}

      {/* Tab Bar */}
      <div className={`${embedded ? 'px-4 pt-2' : 'px-6 pt-3'} pb-0 border-b border-[#e2e8f0] dark:border-[#18273a] bg-[#f8fafc]/80 dark:bg-[#070d16]/75 flex items-center justify-between shrink-0 overflow-x-auto`}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('persona')}
            className={`${embedded ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-xs sm:text-sm'} font-medium rounded-t-lg transition-all flex items-center gap-1.5 border-b-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'persona'
                ? 'text-[#0284c7] dark:text-[#2ba0ff] border-[#2ba0ff] bg-white dark:bg-[#0b121e]'
                : 'text-[#64748b] dark:text-[#849cb3] border-transparent hover:text-[#0f172a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>人设资料与五阶提示词</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sandbox')}
            className={`${embedded ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-xs sm:text-sm'} font-medium rounded-t-lg transition-all flex items-center gap-1.5 border-b-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'sandbox'
                ? 'text-[#0284c7] dark:text-[#2ba0ff] border-[#2ba0ff] bg-white dark:bg-[#0b121e]'
                : 'text-[#64748b] dark:text-[#849cb3] border-transparent hover:text-[#0f172a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>人设效果试聊</span>
          </button>
        </div>

        {!embedded && persona && (
          <div className="hidden lg:flex items-center gap-1.5 pb-2 text-xs text-[#64748b] dark:text-[#7f95ab]">
            <span>当前主控人设:</span>
            <span className="text-[#0284c7] dark:text-[#2ba0ff] font-semibold">
              {persona.personaName
                ? `${persona.personaName}${persona.personaRole ? ` (${persona.personaRole})` : ''}`
                : '未命名'}
            </span>
          </div>
        )}
      </div>

      {/* Modal Body */}
      <div className={`flex-1 overflow-y-auto ${embedded ? 'p-4 space-y-4' : 'p-6 space-y-6'} bg-white dark:bg-transparent`}>
        {isLoadingPersona && !persona && (
          <div className="py-20 text-center text-xs text-[#64748b] dark:text-[#7f95ab]">
            正在加载人设资料档案...
          </div>
        )}

        {/* ==================== TAB 1: GLOBAL PERSONA & STAGED PROMPTS ==================== */}
        {activeTab === 'persona' && persona && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e2e8f0] dark:border-[#18273a]">
              <h3 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#2ba0ff]" />
                <span>角色档案：{persona.personaName || '未命名'}</span>
              </h3>

              <div className="flex items-center gap-1.5 flex-wrap">
                {personaSaveSuccess && (
                  <span className="text-[11px] text-emerald-600 dark:text-[#2ba0ff] flex items-center gap-1 font-medium">
                    <Check className="w-3.5 h-3.5" /> 已生效
                  </span>
                )}
                <button
                  type="button"
                  disabled={isImportingTemplate}
                  onClick={handleImportTemplate}
                  title="显式导入一套可编辑的通用人设参考模板"
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132033] dark:hover:bg-[#1a2b44] text-[#0284c7] dark:text-[#7cc4ff] text-[11px] font-medium rounded-lg border border-[#cbd5e1] dark:border-[#2ba0ff]/30 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{isImportingTemplate ? '导入中...' : '导入模板'}</span>
                </button>
                <button
                  type="button"
                  disabled={isResettingPersona}
                  onClick={handleResetPersona}
                  title="清空当前人设档案与五阶提示词，恢复为空白初始状态"
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-[#f8fafc] hover:bg-[#f1f5f9] dark:bg-[#0e1726] dark:hover:bg-[#162338] text-[#64748b] dark:text-[#9eb6cb] hover:text-[#0f172a] dark:hover:text-white text-[11px] font-medium rounded-lg border border-[#cbd5e1] dark:border-[#1e3148] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>清空</span>
                </button>
                <button
                  type="button"
                  disabled={isSavingPersona}
                  onClick={handleSavePersona}
                  className="px-3 py-1.5 bg-[#2ba0ff] hover:bg-[#1e8ee8] text-white text-[11px] font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingPersona ? '保存中...' : '保存并生效'}
                </button>
              </div>
            </div>

            {personaActionError && (
              <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
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
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white dark:bg-[#0e1726] border border-[#cbd5e1] dark:border-[#1e3148] text-[#475569] dark:text-[#cbd5e1] hover:bg-[#f1f5f9] dark:hover:bg-[#162338] cursor-pointer disabled:opacity-50"
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
                        : 'bg-[#2ba0ff] hover:bg-[#1e8ee8]'
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
              <div className={`${embedded ? '' : 'lg:col-span-5'} space-y-3 bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a]`}>
                <h4 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] uppercase tracking-wider flex items-center gap-2 border-b border-[#e2e8f0] dark:border-[#152234] pb-2">
                  <Compass className="w-3.5 h-3.5 text-[#2ba0ff]" />
                  <span>角色人设资料基本面</span>
                </h4>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1">人设姓名 / 昵称</label>
                    <input
                      type="text"
                      value={persona.personaName}
                      onChange={(e) => setPersona({ ...persona, personaName: e.target.value })}
                      placeholder="角色姓名或昵称"
                      className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1">年龄 / 外貌感知</label>
                    <input
                      type="text"
                      value={persona.age}
                      onChange={(e) => setPersona({ ...persona, age: e.target.value })}
                      placeholder="例如：28岁"
                      className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1">身份职业背景</label>
                  <input
                    type="text"
                    value={persona.personaRole}
                    onChange={(e) => setPersona({ ...persona, personaRole: e.target.value })}
                    placeholder="请输入职业、身份或业务角色"
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1">常居地 / 生活城市</label>
                  <input
                    type="text"
                    value={persona.location}
                    onChange={(e) => setPersona({ ...persona, location: e.target.value })}
                    placeholder="例如：新加坡 / 上海"
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1">性格特征标签 (逗号分隔)</label>
                  <input
                    type="text"
                    value={traitInput}
                    onChange={(e) => setTraitInput(e.target.value)}
                    placeholder="知性温柔, 情绪稳定, 独立自律, 懂生活"
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#dbe6f0] focus:outline-none focus:border-[#2ba0ff]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1">生活方式细节与日常习惯</label>
                  <textarea
                    rows={3}
                    value={persona.lifeStyleDetails}
                    onChange={(e) => setPersona({ ...persona, lifeStyleDetails: e.target.value })}
                    placeholder="填写角色的作息、爱好与日常沟通细节..."
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg p-2.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1">核心专业视角 / 理念底色</label>
                  <textarea
                    rows={3}
                    value={persona.investmentPhilosophy}
                    onChange={(e) => setPersona({ ...persona, investmentPhilosophy: e.target.value })}
                    placeholder="填写角色的专业理念、服务原则或价值观底色..."
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg p-2.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1">绝对红线禁忌词 (逗号分隔，严禁出现)</label>
                  <input
                    type="text"
                    value={(persona.tabooKeywords || []).join(', ')}
                    onChange={(e) =>
                      setPersona({
                        ...persona,
                        tabooKeywords: e.target.value.split(/[,，\s]+/).filter(Boolean),
                      })
                    }
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-2.5 py-1.5 text-xs text-[#0f172a] dark:text-[#dbe6f0] focus:outline-none focus:border-[#2ba0ff]"
                  />
                </div>
              </div>

              {/* 5-Stage Staged Prompts Editor */}
              <div className={`${embedded ? '' : 'lg:col-span-7'} space-y-3.5 bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] flex flex-col justify-between`}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#e2e8f0] dark:border-[#152234] pb-2">
                    <h4 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] uppercase tracking-wider flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-[#2ba0ff]" />
                      <span>五阶段沟通策略与提示词</span>
                    </h4>
                  </div>

                  <div className={`${embedded ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-2 sm:grid-cols-5 gap-1.5'} bg-white dark:bg-[#090f19] p-1.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a]`}>
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
                              ? 'bg-[#e8f3ff] dark:bg-[#13253b] text-[#0284c7] dark:text-[#2ba0ff] shadow-xs border-[#bfdbfe] dark:border-[#2ba0ff]/40'
                              : 'border-transparent text-[#64748b] dark:text-[#7e95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#111e30]'
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
                      <span className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">
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
                      className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-xl p-3 text-xs text-[#0f172a] dark:text-[#dbe6f0] leading-relaxed font-mono focus:outline-none focus:border-[#2ba0ff] resize-y"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-semibold text-[#475569] dark:text-[#8ea6bc] block">
                        追加全局人设指令 (System Instruction)
                      </label>
                      <span className="text-[10px] font-mono tabular-nums text-[#64748b] dark:text-[#6c8297]">
                        {(persona.customSystemInstruction || '').length} 字
                      </span>
                    </div>
                    <textarea
                      rows={embedded ? 4 : 6}
                      placeholder="输入补充个人经历、语气偏好或业务边界..."
                      value={persona.customSystemInstruction || ''}
                      onChange={(e) => setPersona({ ...persona, customSystemInstruction: e.target.value })}
                      className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-xl p-3 text-xs text-[#0f172a] dark:text-[#dbe6f0] leading-relaxed font-mono focus:outline-none focus:border-[#2ba0ff] resize-y min-h-[100px]"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#152234] flex items-center justify-end">
                  <button
                    type="button"
                    disabled={isSavingPersona}
                    onClick={handleSavePersona}
                    className="px-4 py-1.5 bg-[#2ba0ff] hover:bg-[#1e8ee8] text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    保存人设配置
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: PERSONA SANDBOX ==================== */}
        {activeTab === 'sandbox' && (
          <div className="space-y-4">
            <div className={embedded ? 'space-y-4' : 'grid grid-cols-1 md:grid-cols-12 gap-5'}>
              {/* Input Panel */}
              <div className={`${embedded ? '' : 'md:col-span-5'} bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-3.5`}>
                <div>
                  <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] block mb-1.5">
                    选择当前测试的客户沟通阶段
                  </label>
                  <select
                    value={sandboxStage}
                    onChange={(e) => setSandboxStage(e.target.value as StagedPromptKey)}
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-2 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
                  >
                    <option value="icebreaker">阶段 1: 新朋友初识破冰</option>
                    <option value="dailyFriend">阶段 2: 日常朋友互动与情绪价值</option>
                    <option value="emotionalLove">阶段 3: 情感升温与深度陪伴</option>
                    <option value="wealthDiscussion">阶段 4: 专业价值与合作探讨</option>
                    <option value="trustDefense">阶段 5: 疑虑化解与安全感构建</option>
                  </select>
                </div>

                <div>
                  <span className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1">快捷测试语料：</span>
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
                        className="text-[10px] bg-white hover:bg-[#f1f5f9] dark:bg-[#090f19] dark:hover:bg-[#132033] text-[#475569] dark:text-[#8fa7be] hover:text-[#0f172a] dark:hover:text-white px-2 py-1 rounded border border-[#cbd5e1] dark:border-[#1e3148] transition-colors cursor-pointer"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-[#e2e8f0] dark:border-[#18273a] rounded-xl p-3 bg-white dark:bg-[#090f19] space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#2ba0ff]" />
                      <span>上下文语境样本 (可选)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowTranscriptInput(!showTranscriptInput)}
                      className="text-[10px] text-[#64748b] dark:text-[#7890a6] hover:text-[#0f172a] dark:hover:text-white cursor-pointer"
                    >
                      {showTranscriptInput ? '收起' : '展开'}
                    </button>
                  </div>
                  {showTranscriptInput && (
                    <textarea
                      rows={3}
                      value={sandboxChatTranscript}
                      onChange={(e) => setSandboxChatTranscript(e.target.value)}
                      placeholder="粘贴几句历史对话上下文，测试模型与当前语气的连贯程度..."
                      className="w-full bg-[#f8fafc] dark:bg-[#060a12] border border-[#cbd5e1] dark:border-[#1b2b3d] rounded-lg p-2 text-xs text-[#0f172a] dark:text-[#cadbeb] focus:outline-none focus:border-[#2ba0ff] font-sans"
                    />
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] block mb-1.5">
                    模拟客户发来的最新一条消息
                  </label>
                  <textarea
                    rows={3}
                    value={sandboxInput}
                    onChange={(e) => setSandboxInput(e.target.value)}
                    placeholder="输入测试客户发来的聊天内容..."
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg p-2.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
                  />
                </div>

                {sandboxError && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
                    {sandboxError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isTestingReply || !sandboxInput.trim()}
                  onClick={handleRunSandbox}
                  className="w-full py-2.5 bg-[#2ba0ff] hover:bg-[#1e8ee8] text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${isTestingReply ? 'animate-pulse' : ''}`} />
                  <span>{isTestingReply ? '正在结合人设与云端语料演算...' : '立即测试人设回复'}</span>
                </button>
              </div>

              {/* Output Panel */}
              <div className={`${embedded ? '' : 'md:col-span-7'} bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] flex flex-col justify-between space-y-4`}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#e2e8f0] dark:border-[#152234] pb-2">
                    <h4 className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb]">人设效果试聊输出</h4>
                    {sandboxResult && (
                      <span className="text-[10px] font-mono text-[#64748b] dark:text-[#6c8297]">
                        {sandboxResult.source}
                      </span>
                    )}
                  </div>

                  {sandboxResult ? (
                    <div className="space-y-3">
                      <div className="bg-white dark:bg-[#0b1525] border border-[#cbd5e1] dark:border-[#1e3148] rounded-xl p-3.5 text-[#0f172a] dark:text-[#f0f4f8] text-sm leading-relaxed shadow-xs">
                        <div className="mb-2 pb-2 border-b border-[#e2e8f0] dark:border-[#152234] text-xs font-semibold text-[#0284c7] dark:text-[#2ba0ff]">
                          {persona?.personaName || '主控人设'} 回复：
                        </div>
                        <p className="whitespace-pre-wrap text-xs sm:text-sm">{sandboxResult.reply}</p>
                      </div>

                      {sandboxResult.matchedKnowledge && sandboxResult.matchedKnowledge.length > 0 && (
                        <div className="bg-white dark:bg-[#090f19] p-3 rounded-xl border border-[#e2e8f0] dark:border-[#18273a]">
                          <span className="text-[11px] font-semibold text-[#475569] dark:text-[#8ea6bc] mb-1.5 flex items-center gap-1.5">
                            <Cloud className="w-3.5 h-3.5 text-[#2ba0ff]" />
                            <span>云端语料引擎本次参考要点：</span>
                          </span>
                          <div className="space-y-1">
                            {sandboxResult.matchedKnowledge.map((k: any, i: number) => (
                              <div key={i} className="text-xs text-[#475569] dark:text-[#a9bed1]">
                                • <span className="font-medium text-[#0f172a] dark:text-white">{k.title || '云端话术片段'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-12 text-center text-[#64748b] dark:text-[#6e859b]">
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
      <div className="flex flex-col h-full min-h-0 select-none text-[#0f172a] dark:text-[#eef4fb]">
        {innerContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#0b121e] border border-[#e2e8f0] dark:border-[#1e3148] rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden relative text-[#0f172a] dark:text-[#eef4fb]">
        {innerContent}
      </div>
    </div>
  );
};

