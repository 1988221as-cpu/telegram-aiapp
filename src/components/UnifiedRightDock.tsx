import React, { useEffect, useRef } from 'react';
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
  onSaveCustomLLMConfig: (config: CustomLLMConfig, nextTranslationSettings?: TranslationSettings) => void;
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
  { id: 'voice', label: '音色', title: '真人声纹样本克隆配置', icon: AudioWaveform },
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
  const pointerDownOnBackdropRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isOpen = Boolean(activePanel);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const rafId = window.requestAnimationFrame(() => {
      const panelEl = dialogRef.current;
      if (panelEl && !panelEl.contains(document.activeElement)) {
        panelEl.focus({ preventScroll: true });
      }
    });
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', handleKeyDown);
      const prevEl = previousFocusRef.current;
      previousFocusRef.current = null;
      if (prevEl && prevEl.isConnected) {
        prevEl.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  if (!activePanel) return null;

  const activeMeta = PANEL_TABS.find((t) => t.id === activePanel) || PANEL_TABS[0];
  const ActiveIcon = activeMeta.icon;

  return (
    <div
      onMouseDown={(e) => {
        pointerDownOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (e.target !== e.currentTarget) {
          pointerDownOnBackdropRef.current = false;
        }
      }}
      onClick={(e) => {
        const shouldClose =
          pointerDownOnBackdropRef.current && e.target === e.currentTarget;
        pointerDownOnBackdropRef.current = false;
        if (shouldClose) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/65 animate-in fade-in duration-150"
    >
      {/* Standalone Modal Page Overlay (Detached from Chat Workspace) */}
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={activeMeta.title}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${
          activePanel === 'persona' || activePanel === 'memory' ? 'max-w-5xl' : 'max-w-4xl'
        } h-[90vh] max-h-[880px] rounded-2xl flex flex-col overflow-hidden bg-white dark:bg-[#09111b] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1c343e] linen:border-[#d5c6ae] shadow-2xl linen:shadow-sm text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] select-none outline-none transition-colors animate-in zoom-in-95 fade-in duration-150`}
      >
        {/* Top Precision Hairline Accent */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#2481cc]/60 dark:via-[#2ba0ff]/75 aurora:via-[#2dd4bf]/80 linen:via-[#a86a43]/75 to-transparent shrink-0" />

        {/* Unified Dock Header */}
        <div className="px-4 pt-3 pb-2.5 border-b border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc]/90 dark:bg-[#0b1523]/90 aurora:bg-[#0e1920]/92 linen:bg-[#f0e6d5]/92 shrink-0 space-y-2.5">
          {/* Row 1: Active Panel Identity + Close */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#e8f3ff] dark:bg-[#2ba0ff]/12 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 border border-[#bfdbfe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/35 linen:border-[#cbbba2] flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] shrink-0">
                <ActiveIcon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[13.5px] font-semibold text-[#0f172a] dark:text-[#f1f6fc] aurora:text-[#ecf6f8] linen:text-[#2b2118] truncate leading-tight">
                  {activePanel === 'memory'
                    ? `${currentChat?.title || '当前联系人'} · 全息记忆`
                    : activeMeta.title}
                </h2>
                <p className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] truncate leading-tight mt-0.5">
                  {activePanel === 'memory'
                    ? `${customerProfile?.relationshipStage || '尚未分析'} · 独立配置页`
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
                      : '官方引擎模式 · 支持谷歌机翻 / 云端大模型'
                    : activePanel === 'voice'
                    ? '个人声纹样本、克隆引擎与语速音高配置'
                    : '人设档案、五阶提示词与试聊'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              title="关闭并返回聊天 (Esc)"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-[#e2e8f0]/70 dark:hover:bg-[#172638] aurora:hover:bg-[#152934] linen:hover:bg-[#e5d9c6] transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Row 2: 5-in-1 Mutual-Exclusive Segmented Switcher */}
          <div
            role="tablist"
            aria-label="独立功能配置页切换"
            className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-[#eef2f6] dark:bg-[#060c14] aurora:bg-[#081014] linen:bg-[#e7dccb] border border-[#e2e8f0] dark:border-[#152233] aurora:border-[#182b34] linen:border-[#cbbba2]"
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
                      ? 'bg-white dark:bg-[#132234] aurora:bg-[#112d36] linen:bg-[#faf5ec] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] shadow-xs border border-[#cbd5e1]/80 dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/45 linen:border-[#cbbba2] font-semibold'
                      : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#e2ebf5] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-white/60 dark:hover:bg-[#0e1928] aurora:hover:bg-[#112028] linen:hover:bg-[#f4ece0] border border-transparent'
                  }`}
                >
                  <span className="relative shrink-0">
                    <Icon className="w-3.5 h-3.5" />
                    {tab.id === 'voice' && isMasterVoiceActive && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#2dd4bf] linen:bg-[#a86a43]" />
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
              onUpdateProfile={async (updated, options) => {
                const targetChatId = updated.chatId && updated.chatId !== 'current' ? updated.chatId : activeChatId;
                const targetAccountId = updated.accountId || activeAccountId;
                const normalizedUpdated: CustomerProfile = {
                  ...updated,
                  chatId: targetChatId || 'current',
                  accountId: targetAccountId,
                };
                onUpdateCustomerProfile(normalizedUpdated);
                if (targetChatId && targetChatId !== 'current') {
                  saveLocalCustomerProfile(targetChatId, normalizedUpdated, targetAccountId);
                  if (!options?.skipRemoteSave) {
                    return await saveCustomerProfile(targetChatId, normalizedUpdated, targetAccountId);
                  }
                }
                return true;
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
              activeAccountId={activeAccountId}
              activeChatId={activeChatId}
              currentChat={currentChat}
              currentMessages={currentMessages}
            />
          )}
        </div>
      </section>
    </div>
  );
};
