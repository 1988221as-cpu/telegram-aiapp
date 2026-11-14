import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Link,
  X,
  ShieldCheck,
  Database,
  Lock,
  Globe,
  Eye,
  EyeOff,
} from 'lucide-react';
import { CustomLLMConfig } from '../types';
import {
  pingCustomLLM,
  fetchKnowledgeBase,
  syncCustomLLMConfigApi,
  isBuiltInCloudGatewayUrl,
  inferGatewayProtocolFromUrlAndModel,
  fetchCustomLlmUsageStats,
  ModelUsageDetail,
} from '../services/apiService';

interface CustomLLMModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: CustomLLMConfig;
  onSaveConfig: (config: CustomLLMConfig) => void;
  embedded?: boolean;
}

const CHAT_MEMORY_MODEL_PRESETS: Array<{ value: string; label: string }> = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini (OpenAI 轻量高速)' },
  { value: 'gpt-4o', label: 'gpt-4o (OpenAI 旗舰)' },
  { value: 'deepseek-chat', label: 'deepseek-chat (DeepSeek-V3)' },
  { value: 'deepseek-reasoner', label: 'deepseek-reasoner (DeepSeek-R1)' },
  { value: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet-20241022 (Claude 3.5)' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Google Gemini 最新高速)' },
  { value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite (Google Gemini 最新轻量)' },
  { value: 'gemini-flash-latest', label: 'gemini-flash-latest (Google Gemini 官方最新)' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Google Gemini 2.5 高速)' },
  { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro (Google Gemini 2.5 旗舰)' },
  { value: 'gemini-4-hydrogen', label: 'gemini-4-hydrogen' },
];

function sanitizeConfigForUi(cfg: CustomLLMConfig): CustomLLMConfig {
  const baseUrl = isBuiltInCloudGatewayUrl(cfg.baseUrl) ? '' : cfg.baseUrl || '';
  const engineMode: 'cloud' | 'custom' = cfg.engineMode === 'custom' ? 'custom' : 'cloud';
  const enabled = Boolean(cfg.enabled);
  const modelName = (cfg.modelName || '').trim() || 'gpt-4o-mini';
  return {
    ...cfg,
    enabled,
    engineMode,
    modelName,
    protocol: inferGatewayProtocolFromUrlAndModel(baseUrl, modelName),
    baseUrl,
    knowledgeBaseApiUrl: '',
    enableKnowledgeBaseRAG: engineMode === 'cloud' && enabled,
    engineLicenseKey: '',
  };
}

export const CustomLLMModal: React.FC<CustomLLMModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  embedded = false,
}) => {
  const [formData, setFormData] = useState<CustomLLMConfig>(() => sanitizeConfigForUi(config));
  const [activeTab, setActiveTab] = useState<'cloud' | 'custom'>(() =>
    config.enabled && config.engineMode === 'custom' ? 'custom' : 'cloud'
  );
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [testResult, setTestResult] = useState<{
    tested: boolean;
    ok: boolean;
    latencyMs?: number;
    message?: string;
    suggestedModels?: string[];
    modelDetails?: ModelUsageDetail[];
  } | null>(null);
  const [currentModelUsage, setCurrentModelUsage] = useState<ModelUsageDetail | null>(null);

  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      const cleaned = sanitizeConfigForUi(config);
      setFormData(cleaned);
      if (!prevOpenRef.current) {
        setActiveTab(cleaned.enabled && cleaned.engineMode === 'custom' ? 'custom' : 'cloud');
        setTestResult(null);
      }
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, config]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'custom') return;
    const cleanModel = (formData.modelName || '').trim();
    if (!cleanModel || /\s/.test(cleanModel)) {
      setCurrentModelUsage(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchCustomLlmUsageStats(formData.baseUrl || '', formData.apiKey || '', cleanModel).then((usage) => {
        if (!cancelled) setCurrentModelUsage(usage);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, activeTab, formData.baseUrl, formData.apiKey, formData.modelName]);

  if (!isOpen) return null;

  const isCloudTab = activeTab === 'cloud';
  const isCloudModeEnabled = Boolean(formData.enabled && formData.engineMode !== 'custom');
  const isCustomPriorityEnabled = Boolean(formData.enabled && formData.engineMode === 'custom');
  const currentChatModel = (formData.modelName || '').trim() || 'gpt-4o-mini';
  const isPresetChatModel = CHAT_MEMORY_MODEL_PRESETS.some(
    (m) => m.value === (formData.modelName ?? currentChatModel)
  );

  const handleTestCloudEngineAndRag = async () => {
    setIsTesting(true);
    setTestResult(null);

    const [llmRes, kbRes] = await Promise.all([
      pingCustomLLM(
        '',
        '',
        'gemini-4-hydrogen',
        '',
        'openai',
        'cloud'
      ),
      fetchKnowledgeBase('成交话术', { ...formData, engineMode: 'cloud', enableKnowledgeBaseRAG: true }),
    ]);

    setIsTesting(false);

    if (llmRes.ok && kbRes.ok) {
      setTestResult({
        tested: true,
        ok: true,
        latencyMs: llmRes.latencyMs,
        message: `HumanSense 云端引擎与话术检索 (Cloud RAG) 连通正常！延迟 ${llmRes.latencyMs ?? 0}ms${
          kbRes.matchedCount ? ` · 匹配 ${kbRes.matchedCount} 条语境` : ''
        }`,
      });
      return;
    }

    if (!llmRes.ok) {
      setTestResult({
        tested: true,
        ok: false,
        message: `云端引擎连接失败：${llmRes.error || '请检查网络或会员登录状态'}`,
      });
      return;
    }

    setTestResult({
      tested: true,
      ok: false,
      message: `云端引擎已响应 (${llmRes.latencyMs ?? 0}ms)，但话术检索异常：${kbRes.error || '检索未连通'}`,
    });
  };

  const handleTestCustomGateway = async () => {
    setIsTesting(true);
    setTestResult(null);

    const cleanBaseUrl = (formData.baseUrl || '').replace(/^[^\x21-\x7E]+|[^\x21-\x7E]+$/g, '').trim();
    const cleanApiKey = (formData.apiKey || '')
      .replace(/^[^\x21-\x7E]+|[^\x21-\x7E]+$/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
    const cleanModel = (formData.modelName || '').trim();

    if (cleanApiKey !== formData.apiKey || cleanBaseUrl !== formData.baseUrl) {
      setFormData((prev) => ({
        ...prev,
        baseUrl: cleanBaseUrl,
        apiKey: cleanApiKey,
      }));
    }

    if (!cleanBaseUrl) {
      setIsTesting(false);
      setTestResult({
        tested: true,
        ok: false,
        message: '连接失败：请填写自定义大模型网站接入地址 (Base URL)。',
      });
      return;
    }

    if (!cleanBaseUrl.startsWith('http://') && !cleanBaseUrl.startsWith('https://')) {
      setIsTesting(false);
      setTestResult({
        tested: true,
        ok: false,
        message: '连接失败：大模型接入网址必须以 https:// 或 http:// 开头。',
      });
      return;
    }

    if (isBuiltInCloudGatewayUrl(cleanBaseUrl)) {
      setIsTesting(false);
      setTestResult({
        tested: true,
        ok: false,
        message: '连接失败：自有模型网关禁止填入云端官方网关地址，请填写您自己的模型服务网址。',
      });
      return;
    }

    const probeModel = isCustomPriorityEnabled ? (cleanModel || 'gpt-4o-mini') : '';
    const inferredProto = inferGatewayProtocolFromUrlAndModel(cleanBaseUrl, probeModel);
    const result = await pingCustomLLM(
      cleanBaseUrl,
      cleanApiKey,
      probeModel,
      '',
      inferredProto,
      'custom'
    );

    setIsTesting(false);
    if (result.currentModelUsage) {
      setCurrentModelUsage(result.currentModelUsage);
    }
    setTestResult({
      tested: true,
      ok: result.ok,
      latencyMs: result.latencyMs,
      suggestedModels: Array.isArray(result.suggestedModels) ? result.suggestedModels : undefined,
      modelDetails: Array.isArray(result.modelDetails) ? result.modelDetails : undefined,
      message: result.ok
        ? result.message ||
          (isCustomPriorityEnabled
            ? `优先自有密钥网关与模型 (${probeModel}) 握手成功！响应延迟 ${result.latencyMs ?? 0}ms。`
            : `网关握手成功！响应延迟 ${result.latencyMs ?? 0}ms，可用于自定义翻译与音色克隆。`)
        : `连接失败：${result.error || '请检查接入网址或 API 密钥'}`,
    });
  };

  const handleSave = () => {
    const cleanBaseUrl = (formData.baseUrl || '').replace(/^[^\x21-\x7E]+|[^\x21-\x7E]+$/g, '').trim();
    const cleanApiKey = (formData.apiKey || '')
      .replace(/^[^\x21-\x7E]+|[^\x21-\x7E]+$/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
    const cleanModelName = (formData.modelName || '').trim();
    const savingCustomPriority = Boolean(formData.enabled && formData.engineMode === 'custom');

    if (savingCustomPriority) {
      if (!cleanBaseUrl || (!cleanBaseUrl.startsWith('http://') && !cleanBaseUrl.startsWith('https://'))) {
        setActiveTab('custom');
        setTestResult({
          tested: true,
          ok: false,
          message: '保存失败：已开启「启用优先自有密钥回复」，请填写以 http:// 或 https:// 开头的大模型接入网址 (Base URL)。',
        });
        return;
      }
      if (isBuiltInCloudGatewayUrl(cleanBaseUrl)) {
        setActiveTab('custom');
        setTestResult({
          tested: true,
          ok: false,
          message: '保存失败：自有模型网关禁止填入云端引擎地址，请填写您的自有 API 网址。',
        });
        return;
      }
      const isLocalhostUrl =
        cleanBaseUrl.includes('localhost') ||
        cleanBaseUrl.includes('127.0.0.1') ||
        cleanBaseUrl.includes('[::1]');
      if (!cleanApiKey && !isLocalhostUrl) {
        setActiveTab('custom');
        setTestResult({
          tested: true,
          ok: false,
          message: '保存失败：已开启「启用优先自有密钥回复」，请填写 API 密钥 (Key)。',
        });
        return;
      }
      if (!cleanModelName) {
        setActiveTab('custom');
        setTestResult({
          tested: true,
          ok: false,
          message: '保存失败：已开启「启用优先自有密钥回复」，请选择或输入对话与记忆模型型号。',
        });
        return;
      }
    }

    const cleanToSave: CustomLLMConfig = sanitizeConfigForUi({
      ...formData,
      engineMode: savingCustomPriority ? 'custom' : 'cloud',
      enabled: Boolean(formData.enabled),
      baseUrl: cleanBaseUrl,
      apiKey: cleanApiKey,
      modelName: cleanModelName || 'gpt-4o-mini',
      protocol: inferGatewayProtocolFromUrlAndModel(cleanBaseUrl, cleanModelName || 'gpt-4o-mini'),
      enableKnowledgeBaseRAG: !savingCustomPriority && Boolean(formData.enabled),
    });

    setTestResult(null);
    onSaveConfig(cleanToSave);
    syncCustomLLMConfigApi(cleanToSave).catch(() => {});
    if (embedded) {
      setSaveFeedback(true);
      setTimeout(() => setSaveFeedback(false), 2500);
    } else {
      onClose();
    }
  };

  const panelBody = (
    <>
      {!embedded && (
        <div className="px-5 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] flex items-center justify-between shrink-0 bg-[#f8fafc] dark:bg-[#0b1523]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2481cc]/15 dark:bg-[#2ba0ff]/15 flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff]">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#0f172a] dark:text-white">HumanSense · 智能大模型与自有网关</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 flex-1">
        {saveFeedback && (
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>配置已保存并即时生效！</span>
          </div>
        )}

        {/* Two Channel Tabs (Cloud Engine vs Custom API Gateway) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('cloud');
              setTestResult(null);
            }}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              isCloudTab
                ? 'border-[#2481cc] dark:border-[#2ba0ff] bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 text-[#0f172a] dark:text-white shadow-xs'
                : 'border-[#e2e8f0] dark:border-[#18273a] bg-[#f8fafc] dark:bg-[#0e1726]/85 text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5 text-xs font-semibold">
              <span className="flex items-center gap-1.5 min-w-0">
                <Lock className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] shrink-0" />
                <span className="truncate">HumanSense 云端引擎</span>
              </span>
              {isCloudModeEnabled && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="当前主引擎运行中" />
              )}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('custom');
              setTestResult(null);
            }}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              !isCloudTab
                ? 'border-[#2481cc] dark:border-[#2ba0ff] bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 text-[#0f172a] dark:text-white shadow-xs'
                : 'border-[#e2e8f0] dark:border-[#18273a] bg-[#f8fafc] dark:bg-[#0e1726]/85 text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5 text-xs font-semibold">
              <span className="flex items-center gap-1.5 min-w-0">
                <Link className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                <span className="truncate">接入自有模型网关</span>
              </span>
              {isCustomPriorityEnabled && (
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="当前优先自有密钥运行中" />
              )}
            </div>
          </button>
        </div>

        {isCloudTab ? (
          /* 图2：HumanSense 云端引擎与话术检索开关（与图1 优先自有密钥回复严格互斥） */
          <>
            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Database className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] shrink-0" />
                  <span className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] truncate">
                    启用 HumanSense 云端引擎与话术检索
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={isCloudModeEnabled}
                    onChange={(e) => {
                      const nextEnabled = e.target.checked;
                      setTestResult(null);
                      const nextConfig: CustomLLMConfig = sanitizeConfigForUi({
                        ...formData,
                        engineMode: 'cloud',
                        enabled: nextEnabled,
                        enableKnowledgeBaseRAG: nextEnabled,
                      });
                      setFormData(nextConfig);
                      onSaveConfig(nextConfig);
                      syncCustomLLMConfigApi(nextConfig).catch(() => {});
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#cbd5e1] dark:bg-[#202e3d] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2481cc]"></div>
                </label>
              </div>

              {isCustomPriorityEnabled && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  当前已开启「优先自有密钥回复」，云端话术检索已自动关闭；开启此开关将自动关闭优先自有密钥并恢复云端主引擎。
                </div>
              )}

              <div className="p-2.5 rounded-lg bg-white dark:bg-[#090f19] border border-[#e2e8f0] dark:border-[#18273a] text-[11px] text-[#475569] dark:text-[#9bb3c9] leading-relaxed">
                <div>云端引擎模式负责：<span className="font-medium text-[#0f172a] dark:text-[#eef4fb]">智能聊天回复（含 Cloud RAG 话术）、谷歌大模型 (Gemma 4 26B / 31B) 翻译、客户全息记忆提炼</span>。</div>
                <div className="mt-1 text-[10.5px] text-[#64748b] dark:text-[#7b93ad]">
                  在云端模式下，音色克隆生成可独立走「接入自有模型网关」；如需使用自定义翻译选择其他大模型，请先前往「接入自有模型网关」开启「启用优先自有密钥回复」。
                </div>
              </div>
            </div>

            {/* Temperature */}
            <div className="space-y-1.5 bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3 rounded-xl border border-[#e2e8f0] dark:border-[#18273a]">
              <div className="flex items-center justify-between text-xs text-[#0f172a] dark:text-[#eef4fb]">
                <span>模型发散度 / 随机性 (Temperature)</span>
                <span className="font-mono tabular-nums text-[#2481cc] dark:text-[#2ba0ff] font-semibold">
                  {formData.temperature}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={formData.temperature}
                onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                className="w-full accent-[#2481cc] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-[#64748b] dark:text-[#7b93ad]">
                <span>严谨准确 (0.0)</span>
                <span>自然多情 (0.7)</span>
                <span>天马行空 (1.5)</span>
              </div>
            </div>

            {/* Unified Cloud Engine + RAG Ping Test */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleTestCloudEngineAndRag}
                disabled={isTesting}
                className="w-full py-2.5 rounded-xl bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#1a2e45] text-[#0f172a] dark:text-white border border-[#cbd5e1] dark:border-[#21354c] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
              >
                {isTesting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-[#2481cc] dark:text-[#2ba0ff]" />
                    <span>正在检测云端引擎与话术检索连通性...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                    <span>一键测试云端引擎与话术检索连通性 (Ping Test)</span>
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          /* 图1：接入自有模型网关（新增 启用优先自有密钥回复 开关 + 统一 Base URL / Key + 对话记忆模型型号） */
          <>
            {/* Priority Custom Key Switch (Mutually Exclusive with 图2 Cloud RAG) */}
            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Cpu className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
                  <span className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] truncate">
                    启用优先自有密钥回复
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={isCustomPriorityEnabled}
                    onChange={(e) => {
                      const nextCustomPriority = e.target.checked;
                      setTestResult(null);
                      if (nextCustomPriority) {
                        const cleanBaseUrl = (formData.baseUrl || '').replace(/^[^\x21-\x7E]+|[^\x21-\x7E]+$/g, '').trim();
                        const cleanApiKey = (formData.apiKey || '')
                          .replace(/^[^\x21-\x7E]+|[^\x21-\x7E]+$/g, '')
                          .replace(/[^\x20-\x7E]/g, '')
                          .trim();
                        const cleanModelName = (formData.modelName || '').trim() || 'gpt-4o-mini';
                        const nextConfig: CustomLLMConfig = sanitizeConfigForUi({
                          ...formData,
                          engineMode: 'custom',
                          enabled: true,
                          enableKnowledgeBaseRAG: false,
                          baseUrl: cleanBaseUrl,
                          apiKey: cleanApiKey,
                          modelName: cleanModelName,
                        });
                        setFormData(nextConfig);

                        const isValidUrl =
                          Boolean(cleanBaseUrl) &&
                          (cleanBaseUrl.startsWith('http://') || cleanBaseUrl.startsWith('https://')) &&
                          !isBuiltInCloudGatewayUrl(cleanBaseUrl);
                        const isLocalhostUrl =
                          cleanBaseUrl.includes('localhost') ||
                          cleanBaseUrl.includes('127.0.0.1') ||
                          cleanBaseUrl.includes('[::1]');
                        const hasKey = Boolean(cleanApiKey) || isLocalhostUrl;
                        if (isValidUrl && hasKey) {
                          onSaveConfig(nextConfig);
                          syncCustomLLMConfigApi(nextConfig).catch(() => {});
                        } else {
                          setTestResult({
                            tested: false,
                            ok: false,
                            message: '已打开「启用优先自有密钥回复」开关，请补全下方接入网址 (Base URL) 与 API 密钥后点击「保存配置」生效。',
                          });
                        }
                      } else {
                        const nextConfig: CustomLLMConfig = sanitizeConfigForUi({
                          ...formData,
                          engineMode: 'cloud',
                          enabled: false,
                          enableKnowledgeBaseRAG: false,
                        });
                        setFormData(nextConfig);
                        onSaveConfig(nextConfig);
                        syncCustomLLMConfigApi(nextConfig).catch(() => {});
                      }
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#cbd5e1] dark:bg-[#202e3d] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
              <p className="text-[11px] text-[#64748b] dark:text-[#7b93ad] leading-relaxed">
                开启后将自动关闭云端话术检索，所有<span className="font-medium text-[#0f172a] dark:text-[#eef4fb]">聊天 AI 回复（沿用原人设与提示词）、客户记忆提炼及聊天翻译</span>统一改走下方自有密钥；开启云端开关则自动切回云端。
              </p>
            </div>

            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] p-3.5 space-y-3.5">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#e2e8f0] dark:border-[#18273a]">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] shrink-0" />
                  <span className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] truncate">
                    自定义大模型网站接入地址连接
                  </span>
                </div>
                <span className="text-[10.5px] font-medium text-[#64748b] dark:text-[#7b93ad] shrink-0">
                  {isCustomPriorityEnabled ? '全链路统一入口' : '翻译 / 音色统一入口'}
                </span>
              </div>

              {/* Base URL */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">
                    大模型接入网址 (Base URL)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, baseUrl: 'https://api.openai.com/v1' })}
                      className="text-[11px] text-[#0284c7] dark:text-[#2ba0ff] hover:underline cursor-pointer font-medium"
                    >
                      OpenAI
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, baseUrl: 'https://api.deepseek.com/v1' })}
                      className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer font-medium"
                    >
                      DeepSeek
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, baseUrl: 'https://generativelanguage.googleapis.com' })
                      }
                      className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer font-medium"
                    >
                      Google Gemini
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                  placeholder="输入自定义大模型网站/API 地址，如 https://api.openai.com/v1"
                  className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-2 text-xs font-mono text-[#0f172a] dark:text-[#eef4fb] placeholder-[#94a3b8] dark:placeholder-[#4e657e] focus:outline-none focus:border-[#2ba0ff]"
                />
                <p className="text-[10.5px] text-[#64748b] dark:text-[#7b93ad] leading-snug">
                  支持 OneAPI / NewAPI / OpenRouter / 自建反代或官方端点。
                </p>
              </div>

              {/* API Key */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">API 密钥 (Key)</label>
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="text-[10.5px] text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{showKey ? '隐藏' : '显示'}</span>
                  </button>
                </div>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={formData.apiKey}
                  onChange={(e) => {
                    const cleaned = e.target.value
                      .replace(/^[^\x21-\x7E]+|[^\x21-\x7E]+$/g, '')
                      .replace(/[^\x20-\x7E]/g, '');
                    setFormData({ ...formData, apiKey: cleaned });
                  }}
                  placeholder="sk-... 密钥安全直传"
                  className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-2 text-xs font-mono text-[#0f172a] dark:text-[#eef4fb] placeholder-[#94a3b8] dark:placeholder-[#4e657e] focus:outline-none focus:border-[#2ba0ff]"
                />
              </div>

              {/* Chat & Memory Model Selector (shown when Priority Custom Key Reply is ON) */}
              {isCustomPriorityEnabled && (
                <div className="space-y-1.5 pt-2 border-t border-[#e2e8f0] dark:border-[#18273a]">
                  <label className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] block">
                    对话与记忆模型型号 (Model Name · 支持自由输入)
                  </label>
                  <select
                    value={isPresetChatModel ? (formData.modelName ?? currentChatModel) : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') {
                        setFormData({ ...formData, modelName: e.target.value });
                      } else {
                        setFormData({ ...formData, modelName: '' });
                      }
                    }}
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
                  >
                    {CHAT_MEMORY_MODEL_PRESETS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                    <option value="__custom__">自定义输入其他型号...</option>
                  </select>
                  <input
                    type="text"
                    value={formData.modelName ?? currentChatModel}
                    onChange={(e) => setFormData({ ...formData, modelName: e.target.value })}
                    placeholder="输入用于聊天回复、记忆提炼与翻译的模型型号，如 gpt-4o-mini"
                    className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-2 text-xs font-mono text-[#0284c7] dark:text-[#9ec2e6] placeholder-[#94a3b8] dark:placeholder-[#4e657e] focus:outline-none focus:border-[#2ba0ff]"
                  />
                  {/\s/.test((formData.modelName || '').trim()) ? (
                    <p className="text-[10.5px] text-amber-600 dark:text-amber-400 leading-snug">
                      提示：模型型号不能包含空格，请填写无空格的官方模型 ID（例如 gemini-3.1-flash-lite、gpt-4o-mini）。
                    </p>
                  ) : currentModelUsage ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-[#64748b] dark:text-[#7b93ad] pt-0.5">
                      <span className="px-1.5 py-0.5 rounded bg-[#2481cc]/10 dark:bg-[#2ba0ff]/15 text-[#2481cc] dark:text-[#2ba0ff] font-medium">
                        {currentModelUsage.tierTag}
                      </span>
                      <span>
                        今日已用 <span className="font-mono font-semibold text-[#0f172a] dark:text-[#eef4fb]">{currentModelUsage.todayCount}</span> 次
                      </span>
                      {currentModelUsage.rateLimitRemaining && (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          · 网关剩余 {currentModelUsage.rateLimitRemaining}
                          {currentModelUsage.rateLimitLimit ? `/${currentModelUsage.rateLimitLimit}` : ''}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Custom Gateway Ping Test */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleTestCustomGateway}
                disabled={isTesting || !formData.baseUrl}
                className="w-full py-2.5 rounded-xl bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#1a2e45] text-[#0f172a] dark:text-white border border-[#cbd5e1] dark:border-[#21354c] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
              >
                {isTesting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-[#2481cc] dark:text-[#2ba0ff]" />
                    <span>正在握手连通性与密钥校验...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                    <span>一键连通性测试 (Ping Test)</span>
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {testResult && (
          <div
            className={`p-3 rounded-lg text-xs flex items-start gap-2 border ${
              testResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="leading-relaxed break-words">{testResult.message}</div>
              {((Array.isArray(testResult.modelDetails) && testResult.modelDetails.length > 0) ||
                (Array.isArray(testResult.suggestedModels) && testResult.suggestedModels.length > 0)) && (
                <div className="pt-1 border-t border-current/15 space-y-1.5">
                  <div className="text-[10.5px] opacity-85 font-medium">
                    当前密钥探测到的最新对话模型（按版本新旧排序，点击一键填入）：
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(testResult.modelDetails && testResult.modelDetails.length > 0
                      ? testResult.modelDetails
                      : (testResult.suggestedModels || []).map((id) => ({
                          id,
                          tierTag: '',
                          todayCount: 0,
                        }))
                    ).map((item: ModelUsageDetail) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setFormData((prev) => ({
                            ...prev,
                            modelName: item.id,
                            protocol: inferGatewayProtocolFromUrlAndModel(prev.baseUrl, item.id),
                          }));
                          setCurrentModelUsage(item.tierTag ? item : null);
                          setTestResult({
                            tested: false,
                            ok: true,
                            message: `已填入可用模型「${item.id}」，请再次点击「一键连通性测试」或直接「保存配置」。`,
                          });
                        }}
                        className="px-2 py-1 rounded-md text-[11px] bg-white/85 dark:bg-[#090f19]/90 border border-current/25 hover:border-[#2ba0ff] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] cursor-pointer transition-colors flex items-center gap-1.5"
                      >
                        <span className="font-mono">{item.id}</span>
                        {item.tierTag && (
                          <span className="px-1 py-0.2 rounded text-[9.5px] bg-[#2481cc]/10 dark:bg-[#2ba0ff]/15 text-[#2481cc] dark:text-[#2ba0ff] font-sans">
                            {item.tierTag}
                          </span>
                        )}
                        {item.todayCount > 0 && (
                          <span className="text-[9.5px] opacity-75 font-sans">今日 {item.todayCount} 次</span>
                        )}
                        {item.rateLimitRemaining && (
                          <span className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-sans">
                            余 {item.rateLimitRemaining}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#e2e8f0] dark:border-[#162436] bg-[#f8fafc]/90 dark:bg-[#0b1523]/90 flex items-center justify-end gap-2 shrink-0">
        <button
          onClick={onClose}
          className="px-3.5 py-2 rounded-lg text-xs text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#172638] cursor-pointer"
        >
          {embedded ? '收起' : '取消'}
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-[#2481cc] hover:bg-[#1e70b5] text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
        >
          保存配置
        </button>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden text-[#0f172a] dark:text-[#eef4fb]">
        {panelBody}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-white dark:bg-[#0b1523] border border-[#e2e8f0] dark:border-[#18273a] w-full max-w-xl rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">
        {panelBody}
      </div>
    </div>
  );
};

