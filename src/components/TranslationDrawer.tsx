import React, { useState, useMemo } from 'react';
import {
  Languages,
  X,
  ArrowRightLeft,
  CheckCircle2,
  Cpu,
  Sparkles,
  Search,
  Link,
  RefreshCw,
} from 'lucide-react';
import { TranslationSettings, CustomLLMConfig } from '../types';
import { SUPPORTED_LANGUAGES } from '../data/mockData';
import {
  pingCustomLLM,
  normalizeCustomModelIdInput,
  inferGatewayProtocolFromUrlAndModel,
} from '../services/apiService';

interface TranslationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  settings: TranslationSettings;
  onUpdateSettings: (settings: TranslationSettings) => void;
  customLlmEnabled?: boolean;
  customLlmConfig?: CustomLLMConfig;
  onUpdateCustomLlmConfig?: (config: CustomLLMConfig, nextTranslationSettings?: TranslationSettings) => void;
  onGoToModelSettings?: () => void;
  embedded?: boolean;
}

const CUSTOM_TRANSLATION_MODEL_PRESETS: Array<{ value: string; label: string }> = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini (OpenAI 轻量高速)' },
  { value: 'gpt-4o', label: 'gpt-4o (OpenAI 旗舰)' },
  { value: 'deepseek-chat', label: 'deepseek-chat (DeepSeek-V3)' },
  { value: 'deepseek-reasoner', label: 'deepseek-reasoner (DeepSeek-R1)' },
  { value: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet-20241022 (Claude 3.5)' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Google Gemini 最新高速)' },
  { value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite (Google Gemini 最新轻量)' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Google Gemini 高速)' },
  { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro (Google Gemini 旗舰)' },
  { value: 'gemma-4-26b-a4b-it', label: 'gemma-4-26b-a4b-it (Google Gemma 4 26B 极速直译)' },
  { value: 'gemma-4-31b-it', label: 'gemma-4-31b-it (Google Gemma 4 31B 高精度)' },
];

export const TranslationDrawer: React.FC<TranslationDrawerProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  customLlmConfig,
  onUpdateCustomLlmConfig,
  onGoToModelSettings,
  embedded = false,
}) => {
  const [langSearch, setLangSearch] = useState('');
  const [isProbingModels, setIsProbingModels] = useState(false);
  const [probedModels, setProbedModels] = useState<string[]>([]);
  const [probeFeedback, setProbeFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [modeGuardNotice, setModeGuardNotice] = useState<{
    type: 'need_custom' | 'locked_custom' | 'dual_off';
    message: string;
  } | null>(null);

  const filteredSourceLanguages = useMemo(() => {
    const q = langSearch.trim().toLowerCase();
    if (!q) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter(
      (l) =>
        l.code === settings.defaultSourceLang ||
        l.code.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q)
    );
  }, [langSearch, settings.defaultSourceLang]);

  const filteredTargetLanguages = useMemo(() => {
    const base = SUPPORTED_LANGUAGES.filter((l) => l.code !== 'Auto');
    const q = langSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (l) =>
        l.code === settings.defaultTargetLang ||
        l.code.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q)
    );
  }, [langSearch, settings.defaultTargetLang]);

  if (!isOpen && !embedded) return null;

  const isDualOff = Boolean(
    customLlmConfig && (customLlmConfig.enabled === false || customLlmConfig.explicitlyDisabled)
  );
  const isCustomPriorityEnabled = Boolean(
    !isDualOff && customLlmConfig?.enabled && customLlmConfig?.engineMode === 'custom'
  );
  const masterMode: 'cloud' | 'custom' | 'dual_off' = isDualOff
    ? 'dual_off'
    : isCustomPriorityEnabled
    ? 'custom'
    : 'cloud';

  const currentCustomModel =
    (settings.customModelName ?? '').trim() ||
    (customLlmConfig?.modelName && customLlmConfig.engineMode === 'custom' ? customLlmConfig.modelName : '') ||
    'gpt-4o-mini';

  const gatewayUrl = (customLlmConfig?.baseUrl || '').trim();
  const gatewayKey = (customLlmConfig?.apiKey || '').trim();
  const isLocalhostGateway =
    gatewayUrl.includes('localhost') || gatewayUrl.includes('127.0.0.1');
  const isGatewayReady = Boolean(gatewayUrl && (gatewayKey || isLocalhostGateway));

  const isPresetModelValue = CUSTOM_TRANSLATION_MODEL_PRESETS.some(
    (m) => m.value === (settings.customModelName ?? currentCustomModel)
  );

  const rawInputModel = (settings.customModelName ?? currentCustomModel).trim();
  const detectedCustomProtocol = inferGatewayProtocolFromUrlAndModel(
    gatewayUrl,
    rawInputModel,
    customLlmConfig?.protocol || 'auto'
  );
  const normalizedInputModel = normalizeCustomModelIdInput(rawInputModel, detectedCustomProtocol);
  const hasAliasMapping = Boolean(
    rawInputModel && normalizedInputModel && normalizedInputModel !== rawInputModel
  );
  const hasUnresolvedWhitespace = Boolean(normalizedInputModel && /\s/.test(normalizedInputModel));

  const handleProbeGatewayModels = async () => {
    if (!gatewayUrl) return;
    setIsProbingModels(true);
    setProbeFeedback(null);
    const selectedProto =
      customLlmConfig?.protocol === 'openai' ||
      customLlmConfig?.protocol === 'gemini' ||
      customLlmConfig?.protocol === 'anthropic' ||
      customLlmConfig?.protocol === 'auto'
        ? customLlmConfig.protocol
        : 'auto';
    const res = await pingCustomLLM(
      gatewayUrl,
      gatewayKey,
      '',
      customLlmConfig?.customHeaders || '',
      selectedProto,
      'custom'
    );
    setIsProbingModels(false);
    const list = Array.isArray(res.suggestedModels) ? res.suggestedModels : [];
    setProbedModels(list);
    if (res.ok && list.length > 0) {
      setProbeFeedback({
        ok: true,
        message: `探测到当前密钥支持 ${list.length} 个模型，点击下方型号一键填入：`,
      });
    } else if (res.ok) {
      setProbeFeedback({
        ok: true,
        message: res.message || '网关连接正常，但未返回模型列表，请手动填写标准模型 ID。',
      });
    } else {
      setProbeFeedback({
        ok: false,
        message: res.error || '未能探测到可用模型列表，请检查网关网址或密钥。',
      });
    }
  };

  const handleSwap = () => {
    if (settings.defaultSourceLang !== 'Auto') {
      onUpdateSettings({
        ...settings,
        defaultSourceLang: settings.defaultTargetLang,
        defaultTargetLang: settings.defaultSourceLang,
      });
    }
  };

  const innerContent = (
    <>
      {/* Header (Standalone Modal Mode Only) */}
      {!embedded && (
        <div className="px-5 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2481cc]/12 dark:bg-[#2ba0ff]/12 aurora:bg-[#14b8a6]/15 border border-[#2481cc]/25 dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/30 flex items-center justify-center text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]">
              <Languages className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">实时聊天双向翻译设置</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] hover:bg-black/5 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className={`${embedded ? 'p-4 space-y-3.5' : 'p-6 space-y-4'} overflow-y-auto flex-1`}>
        {/* Language Pair Select */}
        <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-3">
          <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">默认翻译语言对</div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={langSearch}
              onChange={(e) => setLangSearch(e.target.value)}
              placeholder="搜索语言名或代码..."
              className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            {/* Source Lang */}
            <div className="min-w-0">
              <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-1 truncate">
                客户语言 (接收/发送目标)
              </label>
              <select
                value={settings.defaultSourceLang}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, defaultSourceLang: e.target.value })
                }
                className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-2 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
              >
                {filteredSourceLanguages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Swap Button */}
            <button
              onClick={handleSwap}
              disabled={settings.defaultSourceLang === 'Auto'}
              title="互换语言"
              className="p-2 rounded-lg bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#1a2e45] aurora:bg-[#13252e] aurora:hover:bg-[#18303b] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] disabled:opacity-30 cursor-pointer transition-colors shrink-0"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>

            {/* Target Lang */}
            <div className="min-w-0">
              <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block mb-1 truncate">
                我方母语 (阅读语言)
              </label>
              <select
                value={settings.defaultTargetLang}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, defaultTargetLang: e.target.value })
                }
                className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-2 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
              >
                {filteredTargetLanguages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Customer Language Presets */}
          <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
            <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">常用语种：</span>
            {[
              { code: 'Auto', label: '自动识别' },
              { code: 'English', label: '英语' },
              { code: 'Spanish', label: '西班牙语' },
              { code: 'Portuguese', label: '葡萄牙语' },
              { code: 'French', label: '法语' },
              { code: 'German', label: '德语' },
              { code: 'it', label: '意大利语' },
              { code: 'Russian', label: '俄语' },
              { code: 'uk', label: '乌克兰语' },
              { code: 'Turkish', label: '土耳其语' },
              { code: 'Arabic', label: '阿拉伯语' },
              { code: 'fa', label: '波斯语' },
              { code: 'he', label: '希伯来语' },
              { code: 'Japanese', label: '日语' },
              { code: 'Korean', label: '韩语' },
              { code: 'Vietnamese', label: '越南语' },
              { code: 'Thai', label: '泰语' },
              { code: 'Indonesian', label: '印尼语' },
              { code: 'ms', label: '马来语' },
              { code: 'tl', label: '菲律宾语' },
              { code: 'hi', label: '印地语' },
            ].map((p) => (
              <button
                key={p.code}
                type="button"
                onClick={() => onUpdateSettings({ ...settings, defaultSourceLang: p.code })}
                className={`px-2 py-0.5 rounded-md text-[11px] cursor-pointer transition-colors border ${
                  settings.defaultSourceLang === p.code
                    ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#0d9488] text-white font-semibold shadow-xs'
                    : 'bg-white dark:bg-[#08101a] aurora:bg-[#081014] border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:border-[#2481cc]/40 dark:hover:border-[#2ba0ff]/40 aurora:hover:border-[#2dd4bf]/40 hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Translation Toggles */}
        <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2.5">
          <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">翻译行为控制</div>

          <label className="flex items-center justify-between py-1 cursor-pointer">
            <span className="text-xs text-[#334155] dark:text-[#dbe6f0] aurora:text-[#d5e8ed]">私聊消息自动翻译</span>
            <input
              type="checkbox"
              checked={settings.autoTranslatePrivate !== false}
              onChange={(e) =>
                onUpdateSettings({ ...settings, autoTranslatePrivate: e.target.checked })
              }
              className="w-4 h-4 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-1 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] cursor-pointer">
            <span className="text-xs text-[#334155] dark:text-[#dbe6f0] aurora:text-[#d5e8ed]">群聊 / 频道自动翻译</span>
            <input
              type="checkbox"
              checked={settings.autoTranslateGroups === true}
              onChange={(e) =>
                onUpdateSettings({ ...settings, autoTranslateGroups: e.target.checked })
              }
              className="w-4 h-4 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-1 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] cursor-pointer">
            <span className="text-xs text-[#334155] dark:text-[#dbe6f0] aurora:text-[#d5e8ed]">接收消息自动翻译</span>
            <input
              type="checkbox"
              checked={settings.autoTranslateInbound}
              onChange={(e) =>
                onUpdateSettings({ ...settings, autoTranslateInbound: e.target.checked })
              }
              className="w-4 h-4 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-1 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] cursor-pointer">
            <span className="text-xs text-[#334155] dark:text-[#dbe6f0] aurora:text-[#d5e8ed]">输入实时翻译预览</span>
            <input
              type="checkbox"
              checked={settings.autoTranslateOutbound}
              onChange={(e) =>
                onUpdateSettings({ ...settings, autoTranslateOutbound: e.target.checked })
              }
              className="w-4 h-4 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-1 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] cursor-pointer">
            <span className="text-xs text-[#334155] dark:text-[#dbe6f0] aurora:text-[#d5e8ed]">双语对照显示</span>
            <input
              type="checkbox"
              checked={settings.showOriginalAndTranslation}
              onChange={(e) =>
                onUpdateSettings({ ...settings, showOriginalAndTranslation: e.target.checked })
              }
              className="w-4 h-4 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] cursor-pointer"
            />
          </label>
        </div>

        {/* Engine Selection */}
        <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">翻译计算引擎</div>
            {onGoToModelSettings && (
              <button
                type="button"
                onClick={onGoToModelSettings}
                className="text-[11px] font-medium text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:underline cursor-pointer"
              >
                切换主引擎 →
              </button>
            )}
          </div>

          {/* Master Mode Banner */}
          <div
            className={`p-2.5 rounded-lg border text-[11px] leading-relaxed ${
              masterMode === 'custom'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                : masterMode === 'dual_off'
                ? 'bg-slate-500/10 border-slate-400/30 text-slate-700 dark:text-slate-300 aurora:text-[#b7d0d8]'
                : 'bg-[#e8f3ff] dark:bg-[#2ba0ff]/10 aurora:bg-[#112d36] border-[#bfdbfe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/35 text-[#0284c7] dark:text-[#93c5fd] aurora:text-[#5eead4]'
            }`}
          >
            {masterMode === 'custom'
              ? `当前主引擎：优先自有密钥回复（支持「谷歌机翻」或「自定义模型」，型号：${currentCustomModel}）`
              : masterMode === 'dual_off'
              ? '当前主引擎：双关状态（官方与自有大模型均已关闭，仅允许使用「谷歌机翻」）'
              : '当前主引擎：官方大模型优先（支持「谷歌机翻」或「云端大模型」，多通道智能测速排队、最快优先）'}
          </div>
          <p className="text-[10.5px] leading-snug text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
            说明：对方发来的消息（私聊与群聊）及历史消息统一使用「谷歌机翻」不占密钥；选中大模型通道时，仅用于我方输入与发出的聊天消息。
          </p>

          <div className="grid grid-cols-3 gap-2">
            {/* Option 1: Google Machine Translate (Universal across all 3 master modes) */}
            {(() => {
              const allowed = true;
              const active = settings.preferredEngine === 'google' && allowed;
              return (
                <button
                  type="button"
                  onClick={() => {
                    setModeGuardNotice(null);
                    onUpdateSettings({ ...settings, preferredEngine: 'google' });
                  }}
                  className={`p-2.5 rounded-lg border text-xs text-left transition-colors ${
                    active
                      ? 'cursor-pointer border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]'
                      : 'cursor-pointer border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:border-[#2481cc]/40 dark:hover:border-[#2ba0ff]/40 aurora:hover:border-[#2dd4bf]/40'
                  }`}
                >
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5 text-[11px]">
                    <Languages className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] shrink-0" />
                    <span className="truncate">谷歌机翻</span>
                  </div>
                  <p className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-1 leading-tight">
                    全模式通用免密钥直译
                  </p>
                </button>
              );
            })()}

            {/* Option 2: Cloud Knowledge Base LLM (Gemma 4 / Qwen3.8 / GPT-OSS, Allowed ONLY in 'cloud') */}
            {(() => {
              const allowed = masterMode === 'cloud';
              const active = settings.preferredEngine === 'gemini' && allowed;
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (!allowed) {
                      setModeGuardNotice({
                        type: masterMode === 'dual_off' ? 'dual_off' : 'locked_custom',
                        message:
                          masterMode === 'dual_off'
                            ? '当前处于双关状态，云端大模型已禁用，仅支持「谷歌机翻」；请前往「模型」开启官方大模型或优先自有密钥。'
                            : '已开启「优先自有密钥回复」，官方云端大模型已关闭，当前仅支持「自定义模型」翻译。',
                      });
                      return;
                    }
                    setModeGuardNotice(null);
                    onUpdateSettings({
                      ...settings,
                      preferredEngine: 'gemini',
                      geminiModel: 'auto',
                    });
                  }}
                  className={`p-2.5 rounded-lg border text-xs text-left transition-colors ${
                    !allowed
                      ? 'opacity-45 cursor-not-allowed border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] bg-[#f1f5f9] dark:bg-[#08101a]/60 aurora:bg-[#081014]/60 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]'
                      : active
                      ? 'cursor-pointer border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]'
                      : 'cursor-pointer border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:border-[#2481cc]/40 dark:hover:border-[#2ba0ff]/40 aurora:hover:border-[#2dd4bf]/40'
                  }`}
                >
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5 text-[11px]">
                    <Sparkles className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] shrink-0" />
                    <span className="truncate">云端大模型</span>
                  </div>
                  <p className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-1 leading-tight truncate">
                    {allowed ? '多通道智能排队 · 最快优先' : masterMode === 'dual_off' ? '双关已禁用' : '自有模式已关闭'}
                  </p>
                </button>
              );
            })()}

            {/* Option 3: Custom LLM (Allowed ONLY in 'custom') */}
            {(() => {
              const allowed = masterMode === 'custom';
              const active = settings.preferredEngine === 'custom_llm' && allowed;
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (!allowed) {
                      setModeGuardNotice({
                        type: 'need_custom',
                        message: '使用「自定义模型」翻译将强制关闭官方大模型与云端话术检索，所有回复/人设/全息记忆同步改走您的自有密钥。',
                      });
                      return;
                    }
                    setModeGuardNotice(null);
                    onUpdateSettings({
                      ...settings,
                      preferredEngine: 'custom_llm',
                      customModelName: currentCustomModel,
                    });
                  }}
                  className={`p-2.5 rounded-lg border text-xs text-left transition-colors ${
                    !allowed
                      ? 'opacity-50 cursor-not-allowed border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] bg-[#f1f5f9] dark:bg-[#08101a]/60 aurora:bg-[#081014]/60 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]'
                      : active
                      ? 'cursor-pointer border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#2dd4bf] bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]'
                      : 'cursor-pointer border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:border-[#2481cc]/40 dark:hover:border-[#2ba0ff]/40 aurora:hover:border-[#2dd4bf]/40'
                  }`}
                >
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5 text-[11px]">
                    <Cpu className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="truncate">自定义模型</span>
                  </div>
                  <p className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-1 leading-tight truncate">
                    {!allowed
                      ? '需开启自有密钥'
                      : isGatewayReady
                      ? `已就绪 (${currentCustomModel})`
                      : '待配置网关'}
                  </p>
                </button>
              );
            })()}
          </div>

          {/* Prompt when user tries to pick a locked engine */}
          {modeGuardNotice && (
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed space-y-2">
              <div>{modeGuardNotice.message}</div>
              <div className="flex items-center justify-end gap-2">
                {modeGuardNotice.type === 'need_custom' && isGatewayReady && onUpdateCustomLlmConfig && customLlmConfig && (
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateCustomLlmConfig(
                        {
                          ...customLlmConfig,
                          enabled: true,
                          explicitlyDisabled: false,
                          engineMode: 'custom',
                          enableKnowledgeBaseRAG: false,
                        },
                        {
                          ...settings,
                          preferredEngine: 'custom_llm',
                          customModelName: currentCustomModel,
                        }
                      );
                      setModeGuardNotice(null);
                    }}
                    className="px-2.5 py-1 rounded-md bg-amber-500/25 hover:bg-amber-500/35 text-amber-900 dark:text-amber-100 font-semibold cursor-pointer transition-colors"
                  >
                    确认开启优先自有密钥并切换
                  </button>
                )}
                {onGoToModelSettings && (
                  <button
                    type="button"
                    onClick={onGoToModelSettings}
                    className="px-2.5 py-1 rounded-md bg-white/80 dark:bg-[#08101a]/80 aurora:bg-[#081014]/80 border border-amber-500/30 hover:bg-white dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-amber-800 dark:text-amber-200 font-semibold cursor-pointer transition-colors"
                  >
                    前往模型页配置
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Custom Translation Model Selector Only (Strictly enabled when Custom Priority Reply is ON) */}
          {settings.preferredEngine === 'custom_llm' && masterMode === 'custom' && (
            <div className="mt-3 pt-3 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                    选择翻译模型型号（支持自由输入）
                  </label>
                </div>
                <select
                  value={isPresetModelValue ? (settings.customModelName ?? currentCustomModel) : '__custom__'}
                  onChange={(e) => {
                    if (masterMode !== 'custom') {
                      setModeGuardNotice({
                        type: 'need_custom',
                        message: '使用「自定义模型」翻译将强制关闭官方大模型与云端话术检索。',
                      });
                      return;
                    }
                    if (e.target.value !== '__custom__') {
                      onUpdateSettings({ ...settings, customModelName: e.target.value });
                    } else {
                      onUpdateSettings({ ...settings, customModelName: '' });
                    }
                  }}
                  className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-3 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                >
                  {CUSTOM_TRANSLATION_MODEL_PRESETS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                  <option value="__custom__">自定义输入其他型号...</option>
                </select>
                <input
                  type="text"
                  value={settings.customModelName ?? currentCustomModel}
                  onChange={(e) => {
                    if (masterMode !== 'custom') {
                      setModeGuardNotice({
                        type: 'need_custom',
                        message: '使用「自定义模型」翻译将强制关闭官方大模型与云端话术检索。',
                      });
                      return;
                    }
                    onUpdateSettings({ ...settings, customModelName: e.target.value });
                  }}
                  placeholder="请输入标准模型 ID，如 gpt-4o / deepseek-chat / gemma-4-26b-a4b-it"
                  className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-3 py-1.5 text-xs font-mono text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                />
                {hasAliasMapping && (
                  <div className="flex items-center justify-between gap-2 text-[10.5px] text-sky-700 dark:text-sky-300 bg-sky-500/10 border border-sky-500/25 rounded-md px-2 py-1">
                    <span className="truncate">
                      已自动兼容识别为：<code className="font-mono font-semibold">{normalizedInputModel}</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, customModelName: normalizedInputModel })}
                      className="px-1.5 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 font-semibold cursor-pointer shrink-0 transition-colors"
                    >
                      替换为标准 ID
                    </button>
                  </div>
                )}
                {hasUnresolvedWhitespace && (
                  <p className="text-[10.5px] text-amber-700 dark:text-amber-400 leading-snug">
                    提示：标准模型 ID 不能包含空格（如 gemma-4-26b-a4b-it、gpt-4o-mini），否则网关会报 HTTP 400。
                  </p>
                )}
                {isGatewayReady && (
                  <div className="space-y-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={handleProbeGatewayModels}
                      disabled={isProbingModels}
                      className="w-full py-1.5 px-2.5 rounded-lg bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#1a2e45] aurora:bg-[#13252e] aurora:hover:bg-[#18303b] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[11px] font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] ${isProbingModels ? 'animate-spin' : ''}`} />
                      <span>{isProbingModels ? '正在探测当前密钥可用型号...' : '探测当前密钥可用型号（免测试扣费）'}</span>
                    </button>
                    {probeFeedback && (
                      <div
                        className={`text-[10.5px] leading-snug px-2 py-1 rounded-md border ${
                          probeFeedback.ok
                            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {probeFeedback.message}
                      </div>
                    )}
                    {probedModels.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-0.5">
                        {probedModels.map((modelId) => {
                          const isSelected = normalizedInputModel === modelId;
                          return (
                            <button
                              key={modelId}
                              type="button"
                              onClick={() => onUpdateSettings({ ...settings, customModelName: modelId })}
                              className={`px-2 py-0.5 rounded-md text-[10.5px] font-mono border cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#0d9488] text-white font-semibold'
                                  : 'bg-white dark:bg-[#08101a] aurora:bg-[#081014] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:border-[#2481cc] dark:hover:border-[#2ba0ff] aurora:hover:border-[#2dd4bf]'
                              }`}
                            >
                              {modelId}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                  isGatewayReady
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-300'
                }`}
              >
                {isGatewayReady ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Link className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="leading-snug">
                  {isGatewayReady
                    ? '已开启自定义优先回复，当前翻译使用「模型 → 接入自有模型网关」的接入网址与密钥。'
                    : '接入口统一走「模型 → 接入自有模型网关」，请先前往该页填写接入网址与密钥。'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {!embedded && (
        <div className="px-5 py-3 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-xs font-semibold shadow-sm cursor-pointer transition-colors"
          >
            完成设定
          </button>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-full min-h-0 select-none text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
        {innerContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] w-full max-w-lg rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
        {innerContent}
      </div>
    </div>
  );
};

