import React from 'react';
import {
  MessageSquare,
  Languages,
  Cpu,
  Brain,
  Plus,
  AudioWaveform,
  Sparkles
} from 'lucide-react';
import { Account } from '../types';

interface LeftSidebarProps {
  accounts: Account[];
  activeAccountId: string;
  onSelectAccount: (accountId: string) => void;
  onOpenMenuDrawer: () => void;
  onOpenTranslation: () => void;
  onOpenAddAccount: () => void;
  onOpenCustomLLM: () => void;
  onOpenCustomerMemory: () => void;
  onOpenVoiceStudio?: () => void;
  onOpenDatabase?: () => void;
  onOpenMasterVoiceprint?: () => void;
  onOpenKnowledgeEvolution?: () => void;
  isMasterVoiceActive?: boolean;
  activeTab: 'chats' | 'memory' | 'llm' | 'translation' | 'voice' | 'persona';
  setActiveTab: (tab: 'chats' | 'memory' | 'llm' | 'translation' | 'voice' | 'persona') => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  accounts,
  activeAccountId,
  onSelectAccount,
  onOpenMenuDrawer,
  onOpenTranslation,
  onOpenAddAccount,
  onOpenCustomLLM,
  onOpenCustomerMemory,
  onOpenMasterVoiceprint,
  onOpenKnowledgeEvolution,
  isMasterVoiceActive,
  activeTab,
  setActiveTab,
}) => {
  const totalUnread = accounts.reduce((acc, curr) => acc + (curr.unreadTotal || 0), 0);

  const railItemClass = (isActive: boolean) =>
    `w-full h-14 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer relative group border ${
      isActive
        ? 'bg-[#e8f3ff] dark:bg-[#12253c] border-[#bfdbfe] dark:border-[#2ba0ff]/35 text-[#0284c7] dark:text-[#2ba0ff] font-medium shadow-[inset_3px_0_0_#2ba0ff]'
        : 'border-transparent text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-[#eef4fb] hover:bg-black/5 dark:hover:bg-[#101c2d]'
    }`;

  return (
    <aside className="w-[84px] bg-[#f8fafc]/95 dark:bg-[#060b13]/95 backdrop-blur-md border-r border-[#e2e8f0] dark:border-[#162436] flex flex-col items-center py-3.5 shrink-0 select-none justify-between h-full z-30 relative transition-colors text-[#475569] dark:text-[#eef4fb]">
      {/* 1. Top Section: HumanSense Brand Logo + Main Menu + Feature Activity Rail */}
      <div className="flex flex-col items-center w-full gap-2 shrink-0">
        {/* HumanSense Brand Icon & Main Menu Trigger */}
        <button
          onClick={onOpenMenuDrawer}
          title="打开主菜单"
          className="w-12 h-12 rounded-xl hover:bg-[#e2e8f0]/60 dark:hover:bg-[#122033] flex items-center justify-center transition-all cursor-pointer group p-1.5"
        >
          <img
            src="/app-icon.png"
            alt="HumanSense"
            className="w-9 h-9 rounded-lg object-cover ring-1 ring-[#2ba0ff]/30 dark:ring-[#2ba0ff]/40 group-hover:ring-[#2ba0ff] transition-all shadow-xs"
          />
        </button>

        {/* Hairline Divider */}
        <div className="w-10 h-px bg-[#e2e8f0] dark:bg-[#18273a] my-0.5" />

        {/* Feature Navigation Rail Items */}
        <div className="w-full flex flex-col items-center gap-2 px-2.5">
          {/* 1. 所有消息 (Chats) */}
          <button
            onClick={() => setActiveTab('chats')}
            title="聊天"
            className={railItemClass(activeTab === 'chats')}
          >
            <div className="relative">
              <MessageSquare className="w-5 h-5" />
              {totalUnread > 0 && (
                <span className="absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 bg-[#2ba0ff] text-white text-[10px] font-bold rounded-full flex items-center justify-center tabular-nums shadow-xs border border-[#f8fafc] dark:border-[#060b13]">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </div>
            <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">聊天</span>
          </button>

          {/* 2. 客户全息记忆 (Customer Memory) */}
          <button
            onClick={() => {
              setActiveTab('memory');
              onOpenCustomerMemory();
            }}
            title="全息记忆"
            className={railItemClass(activeTab === 'memory')}
          >
            <Brain className="w-5 h-5 group-hover:scale-105 transition-transform" />
            <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">记忆</span>
          </button>

          {/* 3. 大模型接入 (LLM Integration) */}
          <button
            onClick={() => {
              setActiveTab('llm');
              onOpenCustomLLM();
            }}
            title="大模型"
            className={railItemClass(activeTab === 'llm')}
          >
            <Cpu className="w-5 h-5 group-hover:scale-105 transition-transform" />
            <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">模型</span>
          </button>

          {/* 4. 翻译调整 (Translation Settings) */}
          <button
            onClick={() => {
              setActiveTab('translation');
              onOpenTranslation();
            }}
            title="翻译调整"
            className={railItemClass(activeTab === 'translation')}
          >
            <Languages className="w-5 h-5 group-hover:scale-105 transition-transform" />
            <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">翻译</span>
          </button>

          {/* 5. 预设音色与参考录音 */}
          <button
            onClick={() => {
              setActiveTab('voice');
              onOpenMasterVoiceprint?.();
            }}
            title="音色预设"
            className={railItemClass(activeTab === 'voice')}
          >
            <div className="relative">
              <AudioWaveform className="w-5 h-5 group-hover:scale-105 transition-transform" />
              {isMasterVoiceActive && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#2ba0ff] ring-2 ring-[#f8fafc] dark:ring-[#060b13]" />
              )}
            </div>
            <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">音色</span>
          </button>

          {/* 6. 人设资料 (Persona Profile Studio) */}
          <button
            onClick={() => {
              setActiveTab('persona');
              onOpenKnowledgeEvolution?.();
            }}
            title="人设资料"
            className={railItemClass(activeTab === 'persona')}
          >
            <Sparkles className="w-5 h-5 group-hover:scale-105 transition-transform" />
            <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">人设</span>
          </button>
        </div>
      </div>

      {/* 2. Bottom Multi-Account Switcher Rail */}
      <div className="w-full flex flex-col items-center pt-3 border-t border-[#e2e8f0] dark:border-[#162436] shrink-0">
        <div className="flex flex-col items-center gap-2.5 w-full max-h-[210px] overflow-y-auto no-scrollbar py-1">
          {accounts.map((acc) => {
            const isSelected = acc.id === activeAccountId;
            return (
              <button
                key={acc.id}
                onClick={() => onSelectAccount(acc.id)}
                title={`${acc.name} (${acc.username})${
                  acc.status === 'expired'
                    ? ' · 会话已失效，请重新登录'
                    : acc.status === 'away'
                    ? ' · 连接中'
                    : ''
                }`}
                className="relative group cursor-pointer focus:outline-none shrink-0"
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold transition-all overflow-hidden ${
                    isSelected
                      ? 'ring-2 ring-[#2ba0ff] ring-offset-1 ring-offset-[#f8fafc] dark:ring-offset-[#060b13] scale-105 shadow-sm'
                      : 'opacity-75 hover:opacity-100 hover:scale-105'
                  }`}
                  style={{ backgroundColor: acc.avatarBg }}
                >
                  {acc.avatarUrl ? (
                    <img
                      src={acc.avatarUrl}
                      alt={acc.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-white text-xs font-bold">{acc.avatarInitial}</span>
                  )}
                </div>

                {/* Status Dot */}
                <span
                  className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#f8fafc] dark:border-[#060b13] ${
                    acc.status === 'online'
                      ? 'bg-emerald-500'
                      : acc.status === 'away'
                      ? 'bg-amber-400'
                      : acc.status === 'expired'
                      ? 'bg-rose-500 animate-pulse'
                      : 'bg-slate-400 dark:bg-slate-500'
                  }`}
                />
              </button>
            );
          })}

          {/* Quick Add Account Button */}
          <button
            onClick={onOpenAddAccount}
            title="添加账号"
            className="w-10 h-10 rounded-full border border-dashed border-[#cbd5e1] dark:border-[#1e3148] hover:border-[#2ba0ff] bg-white/80 dark:bg-[#0e1726]/80 hover:bg-[#e8f3ff] dark:hover:bg-[#2ba0ff]/15 text-[#64748b] dark:text-[#7f95ab] hover:text-[#0284c7] dark:hover:text-[#2ba0ff] flex items-center justify-center transition-all cursor-pointer shrink-0 group hover:scale-105"
          >
            <Plus className="w-[18px] h-[18px] group-hover:rotate-90 transition-transform duration-200" />
          </button>
        </div>
      </div>
    </aside>
  );
};

