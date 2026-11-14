import React, { useEffect } from 'react';
import {
  Brain,
  Cpu,
  Languages,
  AudioWaveform,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Account,
  Chat,
  CustomerProfile,
  CustomLLMConfig,
  Message,
  TranslationSettings,
} from '../types';
import { CustomerMemoryDrawer } from './CustomerMemoryDrawer';
import { CustomLLMModal } from './CustomLLMModal';
import { TranslationDrawer } from './TranslationDrawer';
import { MasterVoiceprintModal } from './MasterVoiceprintModal';
import { KnowledgeEvolutionModal } from './KnowledgeEvolutionModal';
import { saveCustomerProfile, saveLocalCustomerProfile } from '../services/apiService';

export type RightPanelTab = 'memory' | 'llm' | 'translation' | 'voice' | 'persona';

interface UnifiedRightDockProps {
  activePanel: RightPanelTab | null;
  onSelectPanel: (panel: RightPanelTab) => void;
  onClose: () => void;
  // Memory props
  customerProfile: CustomerProfile | null;
  onUpdateCustomerProfile: (updated: CustomerProfile) => void;
  activeChatId: string | null;
  activeAccountId: string;
  currentChat: Chat | null;
  currentMessages: Message[];
  // LLM props
  customLLMConfig: CustomLLMConfig;
  onSaveCustomLLMConfig: (config: CustomLLMConfig) => void;
  // Translation props
  translationSettings: TranslationSettings;
  onUpdateTranslationSettings: (settings: TranslationSettings) => void;
  // Voiceprint status indicator
  isMasterVoiceActive?: boolean;
  // Account context (unused if needed later)
  currentAccount?: Account;
}

const PANEL_TABS: Array<{
  id: RightPanelTab;
  label: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'memory', label: '记忆', title: '当前联系人 · 全息记忆', icon: Brain },
  { id: 'llm', label: '模型', title: '智能大模型与云端引擎', icon: Cpu },
  { id: 'translation', label: '翻译', title: '实时聊天双向翻译设置', icon: Languages },
  { id: 'voice', label: '音色', title: '参考录音与预设音色配置', icon: AudioWaveform },
  { id: 'persona', label: '人设', title: '角色人设资料与试聊沙盒', icon: Sparkles },
];

export const UnifiedRightDock: React.FC<UnifiedRightDockProps> = ({
  activePanel,
  onSelectPanel,
  onClose,
  customerProfile,
  onUpdateCustomerProfile,
  activeChatId,
  activeAccountId,
  currentChat,
  currentMessages,
  customLLMConfig,
  onSaveCustomLLMConfig,
  translationSettings,
  onUpdateTranslationSettings,
  isMasterVoiceActive,
}) => {
  useEffect(() => {
    if (!activePanel) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePanel, onClose]);

  if (!activePanel) return null;

  const activeMeta = PANEL_TABS.find((t) => t.id === activePanel) || PANEL_TABS[0];
  const ActiveIcon = activeMeta.icon;

  return (
    <>
      {/* Narrow-viewport backdrop (< 1024px) */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-30 lg:hidden animate-in fade-in duration-150"
        aria-hidden="true"
      />

      {/* Docked Push Split Sidebar on Desktop (>= 1024px), Slide-Over Drawer on Narrow Viewports */}
      <aside
        aria-label={activeMeta.title}
        className="fixed inset-y-0 right-0 z-40 w-full max-w-[440px] lg:static lg:z-20 lg:w-[440px] lg:shrink-0 h-full flex flex-col overflow-hidden bg-white/95 dark:bg-[#09111b]/95 backdrop-blur-xl border-l border-[#e2e8f0] dark:border-[#18273a] shadow-2xl lg:shadow-[-12px_0_32px_-16px_rgba(2,8,20,0.35)] text-[#0f172a] dark:text-[#eef4fb] select-none transition-colors animate-in slide-in-from-right duration-200"
      >
        {/* Top Precision Hairline Accent */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#2481cc]/60 dark:via-[#2ba0ff]/75 to-transparent shrink-0" />

        {/* Unified Dock Header */}
        <div className="px-4 pt-3 pb-2.5 border-b border-[#e2e8f0] dark:border-[#162436] bg-[#f8fafc]/90 dark:bg-[#0b1523]/90 shrink-0 space-y-2.5">
          {/* Row 1: Active Panel Identity + Close */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 border border-[#bfdbfe] dark:border-[#2ba0ff]/25 flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff] shrink-0">
                <ActiveIcon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[13.5px] font-semibold text-[#0f172a] dark:text-[#f1f6fc] truncate leading-tight">
                  {activePanel === 'memory'
                    ? `${currentChat?.title || '当前联系人'} · 全息记忆`
                    : activeMeta.title}
                </h2>
                <p className="text-[11px] text-[#64748b] dark:text-[#7b93ad] truncate leading-tight mt-0.5">
                  {activePanel === 'memory'
                    ? `${customerProfile?.relationshipStage || '沟通中'} · 右侧协同面板`
                    : activePanel === 'llm'
                    ? customLLMConfig.enabled === false || customLLMConfig.explicitlyDisabled
                      ? '双关状态 · 仅支持谷歌机翻'
                      : customLLMConfig.enabled && customLLMConfig.engineMode === 'custom'
                      ? '优先自有密钥回复 · 全链路直连'
                      : customLLMConfig.baseUrl
                      ? '云端主引擎与自有模型网关'
                      : '云端引擎与话术检索'
                    : activePanel === 'translation'
                    ? customLLMConfig.enabled === false || customLLMConfig.explicitlyDisabled
                      ? '双关模式 · 仅支持谷歌机翻'
                      : customLLMConfig.enabled && customLLMConfig.engineMode === 'custom'
                      ? '自有密钥模式 · 锁定自定义模型'
                      : '官方引擎模式 · 支持谷歌机翻 / Gemma 4'
                    : activePanel === 'voice'
                    ? '原声采样与音色参数微调'
                    : '人设档案、五阶提示词与试聊'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              title="收起右侧面板 (Esc)"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-white hover:bg-[#e2e8f0]/70 dark:hover:bg-[#172638] transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Row 2: 5-in-1 Mutual-Exclusive Segmented Switcher */}
          <div
            role="tablist"
            aria-label="右侧功能工作台切换"
            className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-[#eef2f6] dark:bg-[#060c14] border border-[#e2e8f0] dark:border-[#152233]"
          >
            {PANEL_TABS.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activePanel === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => onSelectPanel(tab.id)}
                  className={`h-8 px-1.5 rounded-lg text-[11.5px] font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap relative ${
                    isSelected
                      ? 'bg-white dark:bg-[#132234] text-[#2481cc] dark:text-[#2ba0ff] shadow-xs border border-[#cbd5e1]/80 dark:border-[#2ba0ff]/35 font-semibold'
                      : 'text-[#64748b] dark:text-[#7b93ad] hover:text-[#0f172a] dark:hover:text-[#e2ebf5] hover:bg-white/60 dark:hover:bg-[#0e1928] border border-transparent'
                  }`}
                >
                  <span className="relative shrink-0">
                    <Icon className="w-3.5 h-3.5" />
                    {tab.id === 'voice' && isMasterVoiceActive && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#2481cc] dark:bg-[#2ba0ff]" />
                    )}
                  </span>
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dock Body: Active Panel Content (Embedded Mode) */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {activePanel === 'memory' && (
            <CustomerMemoryDrawer
              isOpen={true}
              embedded={true}
              onClose={onClose}
              profile={customerProfile}
              chatId={activeChatId || ''}
              currentAccountId={activeAccountId}
              onUpdateProfile={(updated) => {
                onUpdateCustomerProfile(updated);
                if (activeChatId) {
                  saveLocalCustomerProfile(activeChatId, updated);
                  saveCustomerProfile(activeChatId, updated);
                }
              }}
              customConfig={customLLMConfig}
              chatTitle={currentChat?.title || '当前联系人'}
              messages={currentMessages}
            />
          )}

          {activePanel === 'llm' && (
            <CustomLLMModal
              isOpen={true}
              embedded={true}
              onClose={onClose}
              config={customLLMConfig}
              onSaveConfig={onSaveCustomLLMConfig}
            />
          )}

          {activePanel === 'translation' && (
            <TranslationDrawer
              isOpen={true}
              embedded={true}
              onClose={onClose}
              settings={translationSettings}
              onUpdateSettings={onUpdateTranslationSettings}
              customLlmEnabled={Boolean(
                customLLMConfig.baseUrl &&
                  (customLLMConfig.apiKey ||
                    customLLMConfig.baseUrl.includes('localhost') ||
                    customLLMConfig.baseUrl.includes('127.0.0.1'))
              )}
              customLlmConfig={customLLMConfig}
              onUpdateCustomLlmConfig={onSaveCustomLLMConfig}
              onGoToModelSettings={() => onSelectPanel('llm')}
            />
          )}

          {activePanel === 'voice' && (
            <MasterVoiceprintModal
              isOpen={true}
              embedded={true}
              onClose={onClose}
            />
          )}

          {activePanel === 'persona' && (
            <KnowledgeEvolutionModal
              isOpen={true}
              embedded={true}
              onClose={onClose}
              customConfig={customLLMConfig}
            />
          )}
        </div>
      </aside>
    </>
  );
};
