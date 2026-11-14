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
} from 'lucide-react';
import { TranslationSettings, CustomLLMConfig } from '../types';
import { SUPPORTED_LANGUAGES } from '../data/mockData';

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
  { value: 'DeepSeek-V4.1-Flash', label: 'DeepSeek-V4.1-Flash' },
  { value: 'DeepSeek-V4-Pro', label: 'DeepSeek-V4-Pro' },
  { value: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet-20241022' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Google Gemini 高速)' },
  { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro (Google Gemini 旗舰)' },
  { value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
  { value: 'gemini-4-hydrogen', label: 'gemini-4-hydrogen' },
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
        <div className="px-5 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2ba0ff]/12 border border-[#2ba0ff]/25 flex items-center justify-center text-[#0284c7] dark:text-[#2ba0ff]">
              <Languages className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#0f172a] dark:text-[#eef4fb]">实时聊天双向翻译设置</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className={`${embedded ? 'p-4 space-y-3.5' : 'p-6 space-y-4'} overflow-y-auto flex-1`}>
        {/* Language Pair Select */}
        <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-3">
          <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">默认翻译语言对</div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#64748b] dark:text-[#7f95ab] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={langSearch}
              onChange={(e) => setLangSearch(e.target.value)}
              placeholder="搜索语言名或代码..."
              className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-[#0f172a] dark:text-[#eef4fb] placeholder-[#94a3b8] dark:placeholder-[#4e657e] focus:outline-none focus:border-[#2ba0ff]"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            {/* Source Lang */}
            <div className="min-w-0">
              <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1 truncate">
                客户语言 (接收/发送目标)
              </label>
              <select
                value={settings.defaultSourceLang}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, defaultSourceLang: e.target.value })
                }
                className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-2.5 py-2 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
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
              className="p-2 rounded-lg bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132033] dark:hover:bg-[#1a2b44] border border-[#e2e8f0] dark:border-[#1e3148] text-[#475569] dark:text-[#9bb3c9] hover:text-[#0f172a] dark:hover:text-white disabled:opacity-30 cursor-pointer transition-colors shrink-0"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>

            {/* Target Lang */}
            <div className="min-w-0">
              <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block mb-1 truncate">
                我方母语 (阅读语言)
              </label>
              <select
                value={settings.defaultTargetLang}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, defaultTargetLang: e.target.value })
                }
                className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-2.5 py-2 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
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
          <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-[#e2e8f0] dark:border-[#152234]">
            <span className="text-[10px] text-[#64748b] dark:text-[#7f95ab]">常用语种：</span>
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
                    ? 'bg-[#2ba0ff] border-[#2ba0ff] text-white font-semibold shadow-xs'
                    : 'bg-white dark:bg-[#090f19] border-[#e2e8f0] dark:border-[#18273a] text-[#475569] dark:text-[#8eaec9] hover:border-[#2ba0ff]/40 hover:text-[#0f172a] dark:hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Translation Toggles */}
        <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-2.5">
          <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">翻译行为控制</div>

          <label className="flex items-center justify-between py-1 cursor-pointer">
            <span className="text-xs text-[#334155] dark:text-[#dbe6f0]">接收消息自动翻译</span>
            <input
              type="checkbox"
              checked={settings.autoTranslateInbound}
              onChange={(e) =>
                onUpdateSettings({ ...settings, autoTranslateInbound: e.target.checked })
              }
              className="w-4 h-4 accent-[#2ba0ff] cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-1 border-t border-[#e2e8f0] dark:border-[#152234] cursor-pointer">
            <span className="text-xs text-[#334155] dark:text-[#dbe6f0]">输入实时翻译预览</span>
            <input
              type="checkbox"
              checked={settings.autoTranslateOutbound}
              onChange={(e) =>
                onUpdateSettings({ ...settings, autoTranslateOutbound: e.target.checked })
              }
              className="w-4 h-4 accent-[#2ba0ff] cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between py-1 border-t border-[#e2e8f0] dark:border-[#152234] cursor-pointer">
            <span className="text-xs text-[#334155] dark:text-[#dbe6f0]">双语对照显示</span>
            <input
              type="checkbox"
              checked={settings.showOriginalAndTranslation}
              onChange={(e) =>
                onUpdateSettings({ ...settings, showOriginalAndTranslation: e.target.checked })
              }
              className="w-4 h-4 accent-[#2ba0ff] cursor-pointer"
            />
          </label>
        </div>

        {/* Engine Selection */}
        <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">翻译计算引擎</div>
            {onGoToModelSettings && (
              <button
                type="button"
                onClick={onGoToModelSettings}
                className="text-[11px] font-medium text-[#2481cc] dark:text-[#2ba0ff] hover:underline cursor-pointer"
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
                ? 'bg-slate-500/10 border-slate-400/30 text-slate-700 dark:text-slate-300'
                : 'bg-[#e8f3ff] dark:bg-[#2ba0ff]/10 border-[#bfdbfe] dark:border-[#2ba0ff]/25 text-[#1e40af] dark:text-[#93c5fd]'
            }`}
          >
            {masterMode === 'custom'
              ? `当前主引擎：优先自有密钥回复（仅允许使用「自定义模型」，型号：${currentCustomModel}）`
              : masterMode === 'dual_off'
              ? '当前主引擎：双关状态（官方与自有大模型均已关闭，仅允许使用「谷歌机翻」）'
              : '当前主引擎：官方大模型优先（仅支持「谷歌机翻」或「谷歌大模型 Gemma 4」，不可选自定义模型）'}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Option 1: Google Machine Translate (Allowed in 'cloud' and 'dual_off') */}
            {(() => {
              const allowed = masterMode !== 'custom';
              const active = settings.preferredEngine === 'google' && allowed;
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (!allowed) {
                      setModeGuardNotice({
                        type: 'locked_custom',
                        message: '已开启「优先自有密钥回复」，当前仅可使用「自定义模型」翻译；如需使用谷歌机翻，请先切回云端主引擎或双关状态。',
                      });
                      return;
                    }
                    setModeGuardNotice(null);
                    onUpdateSettings({ ...settings, preferredEngine: 'google', googleApiKey: '' });
                  }}
                  className={`p-2.5 rounded-lg border text-xs text-left transition-colors ${
                    !allowed
                      ? 'opacity-45 cursor-not-allowed border-[#e2e8f0] dark:border-[#18273a] bg-[#f1f5f9] dark:bg-[#090f19]/60 text-[#64748b] dark:text-[#64748b]'
                      : active
                      ? 'cursor-pointer border-[#2ba0ff] bg-[#2ba0ff]/12 text-[#0f172a] dark:text-white'
                      : 'cursor-pointer border-[#cbd5e1] dark:border-[#1e3148] bg-white dark:bg-[#090f19] text-[#64748b] dark:text-[#7f95ab] hover:border-[#2ba0ff]/40'
                  }`}
                >
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5 text-[11px]">
                    <Languages className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 shrink-0" />
                    <span className="truncate">谷歌机翻</span>
                  </div>
                  <p className="text-[10px] text-[#64748b] dark:text-[#7f95ab] mt-1 leading-tight">
                    {allowed ? '免密钥直译' : '自有模式锁定'}
                  </p>
                </button>
              );
            })()}

            {/* Option 2: Google Gemma LLM (Allowed ONLY in 'cloud') */}
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
                            ? '当前处于双关状态，谷歌大模型已禁用，仅支持「谷歌机翻」；请前往「模型」开启官方大模型或优先自有密钥。'
                            : '已开启「优先自有密钥回复」，官方谷歌大模型已关闭，当前仅支持「自定义模型」翻译。',
                      });
                      return;
                    }
                    setModeGuardNotice(null);
                    onUpdateSettings({
                      ...settings,
                      preferredEngine: 'gemini',
                      geminiApiKey: '',
                      geminiModel:
                        settings.geminiModel === 'gemma-4-31b-it'
                          ? 'gemma-4-31b-it'
                          : 'gemma-4-26b-a4b-it',
                    });
                  }}
                  className={`p-2.5 rounded-lg border text-xs text-left transition-colors ${
                    !allowed
                      ? 'opacity-45 cursor-not-allowed border-[#e2e8f0] dark:border-[#18273a] bg-[#f1f5f9] dark:bg-[#090f19]/60 text-[#64748b] dark:text-[#64748b]'
                      : active
                      ? 'cursor-pointer border-[#2ba0ff] bg-[#2ba0ff]/12 text-[#0f172a] dark:text-white'
                      : 'cursor-pointer border-[#cbd5e1] dark:border-[#1e3148] bg-white dark:bg-[#090f19] text-[#64748b] dark:text-[#7f95ab] hover:border-[#2ba0ff]/40'
                  }`}
                >
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5 text-[11px]">
                    <Sparkles className="w-3.5 h-3.5 text-[#2ba0ff] shrink-0" />
                    <span className="truncate">谷歌大模型</span>
                  </div>
                  <p className="text-[10px] text-[#64748b] dark:text-[#7f95ab] mt-1 leading-tight">
                    {allowed ? 'Gemma 4 直译' : masterMode === 'dual_off' ? '双关已禁用' : '自有模式已关闭'}
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
                      ? 'opacity-50 cursor-not-allowed border-[#e2e8f0] dark:border-[#18273a] bg-[#f1f5f9] dark:bg-[#090f19]/60 text-[#64748b] dark:text-[#64748b]'
                      : active
                      ? 'cursor-pointer border-[#2ba0ff] bg-[#2ba0ff]/12 text-[#0f172a] dark:text-white'
                      : 'cursor-pointer border-[#cbd5e1] dark:border-[#1e3148] bg-white dark:bg-[#090f19] text-[#64748b] dark:text-[#7f95ab] hover:border-[#2ba0ff]/40'
                  }`}
                >
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5 text-[11px]">
                    <Cpu className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
                    <span className="truncate">自定义模型</span>
                  </div>
                  <p className="text-[10px] text-[#64748b] dark:text-[#7f95ab] mt-1 leading-tight truncate">
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
                    className="px-2.5 py-1 rounded-md bg-white/70 dark:bg-[#090f19]/80 border border-amber-500/30 hover:bg-white text-amber-800 dark:text-amber-200 font-semibold cursor-pointer transition-colors"
                  >
                    前往模型页配置
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Google Knowledge Base LLM Model Selector (Gemma 4 26B / 31B, keyless, Cloud Priority Only) */}
          {masterMode === 'cloud' && settings.preferredEngine === 'gemini' && (
            <div className="mt-3 pt-3 border-t border-[#e2e8f0] dark:border-[#152234] space-y-1.5">
              <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab] block">
                选择谷歌大模型翻译型号
              </label>
              <select
                value={
                  settings.geminiModel === 'gemma-4-31b-it'
                    ? 'gemma-4-31b-it'
                    : 'gemma-4-26b-a4b-it'
                }
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    geminiModel: e.target.value,
                    geminiApiKey: '',
                  })
                }
                className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
              >
                <option value="gemma-4-26b-a4b-it">Gemma 4 26B 适合即时聊天秒翻译</option>
                <option value="gemma-4-31b-it">Gemma 4 31B 适合复杂商务对话</option>
              </select>
            </div>
          )}

          {/* Custom Translation Model Selector Only (Strictly enabled when Custom Priority Reply is ON) */}
          {settings.preferredEngine === 'custom_llm' && masterMode === 'custom' && (
            <div className="mt-3 pt-3 border-t border-[#e2e8f0] dark:border-[#152234] space-y-2.5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-[#64748b] dark:text-[#7f95ab]">
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
                  className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
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
                  placeholder="请输入翻译模型型号，例如：gpt-4o / deepseek-chat / claude-3-5-sonnet"
                  className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-1.5 text-xs font-mono text-[#0284c7] dark:text-[#9ec2e6] placeholder-[#94a3b8] dark:placeholder-[#4e657e] focus:outline-none focus:border-[#2ba0ff]"
                />
              </div>

              <div
                className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                  isGatewayReady
                    ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/8 border-amber-500/25 text-amber-700 dark:text-amber-300'
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
        <div className="px-5 py-3 border-t border-[#e2e8f0] dark:border-[#18273a] bg-[#f8fafc] dark:bg-[#070d16] flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#2ba0ff] hover:bg-[#1e8ee8] text-white text-xs font-semibold shadow-sm cursor-pointer transition-colors"
          >
            完成设定
          </button>
        </div>
      )}
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-white dark:bg-[#0b121e] border border-[#e2e8f0] dark:border-[#1e3148] w-full max-w-lg rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh] text-[#0f172a] dark:text-[#eef4fb]">
        {innerContent}
      </div>
    </div>
  );
};

