import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Languages,
  Cpu,
  Brain,
  Plus,
  AudioWaveform,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Pencil,
  X,
  Check
} from 'lucide-react';
import { Account } from '../types';

const TOOLS_COLLAPSED_STORAGE_KEY = 'hs_left_sidebar_tools_collapsed';
const ACCOUNT_RAIL_HEIGHT_STORAGE_KEY = 'hs_left_sidebar_account_height';
const DEFAULT_ACCOUNT_RAIL_HEIGHT = 220;
const MIN_ACCOUNT_RAIL_HEIGHT = 96;

interface LeftSidebarProps {
  accounts: Account[];
  activeAccountId: string;
  onSelectAccount: (accountId: string) => void;
  onUpdateAccountRemark?: (accountId: string, remark: string) => void;
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
  onUpdateAccountRemark,
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
  const [failedAvatarKeys, setFailedAvatarKeys] = useState<Record<string, string>>({});
  const [isToolsCollapsed, setIsToolsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TOOLS_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [accountRailHeight, setAccountRailHeight] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem(ACCOUNT_RAIL_HEIGHT_STORAGE_KEY));
      return Number.isFinite(raw) && raw >= MIN_ACCOUNT_RAIL_HEIGHT ? raw : DEFAULT_ACCOUNT_RAIL_HEIGHT;
    } catch {
      return DEFAULT_ACCOUNT_RAIL_HEIGHT;
    }
  });
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [editingRemarkState, setEditingRemarkState] = useState<{
    accountId: string;
    top: number;
    left: number;
    value: string;
  } | null>(null);

  const asideRef = useRef<HTMLElement | null>(null);
  const topSectionRef = useRef<HTMLDivElement | null>(null);
  const remarkPopoverRef = useRef<HTMLDivElement | null>(null);
  const remarkInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(TOOLS_COLLAPSED_STORAGE_KEY, String(isToolsCollapsed));
    } catch {}
  }, [isToolsCollapsed]);

  useEffect(() => {
    if (isDraggingSplit) return;
    try {
      localStorage.setItem(ACCOUNT_RAIL_HEIGHT_STORAGE_KEY, String(accountRailHeight));
    } catch {}
  }, [accountRailHeight, isDraggingSplit]);

  useEffect(() => {
    if (!editingRemarkState) return;
    const focusTimer = setTimeout(() => {
      remarkInputRef.current?.focus();
      remarkInputRef.current?.select();
    }, 10);
    const handleOutside = (e: MouseEvent) => {
      if (remarkPopoverRef.current && !remarkPopoverRef.current.contains(e.target as Node)) {
        setEditingRemarkState(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingRemarkState(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [editingRemarkState?.accountId]);

  const handleStartDragSplit = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = accountRailHeight;
    setIsDraggingSplit(true);

    const onMove = (moveEvt: PointerEvent) => {
      const deltaY = startY - moveEvt.clientY;
      const asideH = asideRef.current?.clientHeight || window.innerHeight;
      const topH = topSectionRef.current?.offsetHeight || 140;
      const maxAllowed = Math.max(MIN_ACCOUNT_RAIL_HEIGHT, asideH - topH - 28);
      const next = Math.round(Math.min(maxAllowed, Math.max(MIN_ACCOUNT_RAIL_HEIGHT, startHeight + deltaY)));
      setAccountRailHeight(next);
    };

    const onUp = () => {
      setIsDraggingSplit(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const openRemarkEditor = (acc: Account, anchorEl: HTMLElement | null) => {
    if (!onUpdateAccountRemark || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 170, Math.max(12, rect.top - 16));
    const left = rect.right + 10;
    setEditingRemarkState({
      accountId: acc.id,
      top,
      left,
      value: acc.remark || '',
    });
  };

  const commitRemarkEditor = (nextVal?: string) => {
    if (!editingRemarkState || !onUpdateAccountRemark) return;
    const finalRemark = (nextVal !== undefined ? nextVal : editingRemarkState.value).trim();
    onUpdateAccountRemark(editingRemarkState.accountId, finalRemark);
    setEditingRemarkState(null);
  };

  const totalUnread = accounts.reduce((acc, curr) => acc + (curr.unreadTotal || 0), 0);

  const railItemClass = (isActive: boolean) =>
    `w-full h-14 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer relative group border ${
      isActive
        ? 'bg-[#e8f3ff] dark:bg-[#12253c] aurora:bg-[#112e37] border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/55 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] font-medium shadow-[inset_3px_0_0_#2ba0ff] aurora:shadow-[0_0_16px_rgba(45,212,191,0.22),inset_3px_0_0_#2dd4bf]'
        : 'border-transparent text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] hover:bg-black/5 dark:hover:bg-[#101c2d] aurora:hover:bg-[#112028]'
    }`;

  return (
    <aside
      ref={asideRef}
      className="w-[84px] bg-[#f8fafc]/95 dark:bg-[#060b13]/95 aurora:bg-[#0b1318]/95 backdrop-blur-md border-r border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] flex flex-col items-center py-3.5 shrink-0 select-none h-full z-30 relative transition-colors text-[#475569] dark:text-[#eef4fb] aurora:text-[#ecf6f8]"
    >
      {/* 1. Top Section: HumanSense Brand Logo + Main Menu + Feature Activity Rail */}
      <div ref={topSectionRef} className="flex flex-col items-center w-full gap-2 shrink-0">
        {/* HumanSense Brand Icon & Main Menu Trigger */}
        <button
          onClick={onOpenMenuDrawer}
          title="打开主菜单"
          className="w-12 h-12 rounded-xl hover:bg-[#e2e8f0]/60 dark:hover:bg-[#122033] aurora:hover:bg-[#12242d] flex items-center justify-center transition-all cursor-pointer group p-1.5"
        >
          <img
            src="/app-icon.png"
            alt="HumanSense"
            className="w-9 h-9 rounded-lg object-cover ring-1 ring-[#2ba0ff]/30 dark:ring-[#2ba0ff]/40 aurora:ring-[#2dd4bf]/45 group-hover:ring-[#2ba0ff] aurora:group-hover:ring-[#2dd4bf] transition-all shadow-xs"
          />
        </button>

        {/* Hairline Divider */}
        <div className="w-10 h-px bg-[#e2e8f0] dark:bg-[#18273a] aurora:bg-[#1a2e38] my-0.5" />

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
                <span className="absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 bg-[#2ba0ff] aurora:bg-[#14b8a6] text-white text-[10px] font-bold rounded-full flex items-center justify-center tabular-nums shadow-xs border border-[#f8fafc] dark:border-[#060b13] aurora:border-[#0b1318]">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </div>
            <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">聊天</span>
          </button>

          {/* Collapse/Expand Toggle for Feature Tools (图2) */}
          <button
            type="button"
            onClick={() => setIsToolsCollapsed((prev) => !prev)}
            title={isToolsCollapsed ? '展开功能区（记忆/模型/翻译/音色/人设）' : '向上收起功能区'}
            className="w-full h-5 flex items-center justify-center gap-0.5 rounded-lg text-[10px] text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] hover:bg-black/5 dark:hover:bg-[#101c2d] aurora:hover:bg-[#112028] transition-colors cursor-pointer"
          >
            {isToolsCollapsed ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>展开</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>收起</span>
              </>
            )}
          </button>

          <div
            aria-hidden={isToolsCollapsed}
            className={`w-full grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
              isToolsCollapsed ? 'grid-rows-[0fr] opacity-0 pointer-events-none' : 'grid-rows-[1fr] opacity-100'
            }`}
          >
            <div className="overflow-hidden flex flex-col items-center gap-2">
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
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#2ba0ff] aurora:bg-[#2dd4bf] ring-2 ring-[#f8fafc] dark:ring-[#060b13] aurora:ring-[#0b1318]" />
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
        </div>
      </div>

      {/* Middle flexible gap so bottom account rail can expand upward freely */}
      <div className="flex-1 min-h-[4px] w-full" />

      {/* 2. Bottom Multi-Account Switcher Rail */}
      <div
        style={{ height: `${accountRailHeight}px` }}
        className="w-full flex flex-col items-center shrink min-h-[96px]"
      >
        {/* Draggable Top Divider Handle (图1) */}
        <div
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={handleStartDragSplit}
          title="按住上下拖动可调整账号列表高度"
          className={`w-full h-3 flex items-center justify-center cursor-ns-resize group shrink-0 touch-none ${
            isDraggingSplit ? 'bg-[#2ba0ff]/10 aurora:bg-[#2dd4bf]/10' : ''
          }`}
        >
          <div
            className={`w-full border-t transition-colors relative flex items-center justify-center ${
              isDraggingSplit
                ? 'border-[#2ba0ff] aurora:border-[#2dd4bf]'
                : 'border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] group-hover:border-[#2ba0ff]/70 aurora:group-hover:border-[#2dd4bf]/70'
            }`}
          >
            <span
              className={`w-7 h-1 rounded-full -mt-px transition-colors ${
                isDraggingSplit
                  ? 'bg-[#2ba0ff] aurora:bg-[#2dd4bf]'
                  : 'bg-[#cbd5e1] dark:bg-[#253a54] aurora:bg-[#24434f] group-hover:bg-[#2ba0ff] aurora:group-hover:bg-[#2dd4bf]'
              }`}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col items-center gap-2.5 w-full overflow-y-auto no-scrollbar py-1.5">
          {accounts.map((acc) => {
            const isSelected = acc.id === activeAccountId;
            const avatarRenderKey = `${acc.avatarUrl || ''}|${acc.status}`;
            const canRenderAvatarImg = Boolean(acc.avatarUrl) && failedAvatarKeys[acc.id] !== avatarRenderKey;
            const remarkText = acc.remark?.trim() || '';
            return (
              <div
                key={acc.id}
                className="relative group flex flex-col items-center shrink-0 w-full px-1"
              >
                <button
                  onClick={() => onSelectAccount(acc.id)}
                  onContextMenu={(e) => {
                    if (!onUpdateAccountRemark) return;
                    e.preventDefault();
                    openRemarkEditor(acc, e.currentTarget);
                  }}
                  title={`${remarkText ? `[备注: ${remarkText}] ` : ''}${acc.name} (${acc.username})${
                    acc.status === 'expired'
                      ? ' · 会话已失效，请重新登录'
                      : acc.status === 'away'
                      ? ' · 连接中'
                      : ''
                  }${onUpdateAccountRemark ? ' · 右键可添加/修改备注' : ''}`}
                  className="relative cursor-pointer focus:outline-none shrink-0"
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold transition-all overflow-hidden ${
                      isSelected
                        ? 'ring-2 ring-[#2ba0ff] aurora:ring-[#2dd4bf] ring-offset-1 ring-offset-[#f8fafc] dark:ring-offset-[#060b13] aurora:ring-offset-[#0b1318] scale-105 shadow-sm'
                        : 'opacity-75 hover:opacity-100 hover:scale-105'
                    }`}
                    style={{ backgroundColor: acc.avatarBg }}
                  >
                    {canRenderAvatarImg ? (
                      <img
                        src={acc.avatarUrl}
                        alt={acc.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                        onError={() => {
                          setFailedAvatarKeys((prev) =>
                            prev[acc.id] === avatarRenderKey ? prev : { ...prev, [acc.id]: avatarRenderKey }
                          );
                        }}
                      />
                    ) : (
                      <span className="text-white text-xs font-bold">{acc.avatarInitial}</span>
                    )}
                  </div>

                  {/* Status Dot */}
                  <span
                    className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#f8fafc] dark:border-[#060b13] aurora:border-[#0b1318] ${
                      acc.status === 'online'
                        ? 'bg-emerald-500'
                        : acc.status === 'away'
                        ? 'bg-amber-400'
                        : acc.status === 'expired'
                        ? 'bg-rose-500 animate-pulse'
                        : 'bg-slate-400 dark:bg-slate-500 aurora:bg-[#5a7782]'
                    }`}
                  />
                </button>

                {/* Hover Quick Remark Edit Trigger (图3) */}
                {onUpdateAccountRemark && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openRemarkEditor(acc, e.currentTarget.parentElement);
                    }}
                    title={remarkText ? `编辑备注：${remarkText}` : '添加账号备注'}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 absolute -top-1 right-3.5 w-4 h-4 rounded-full bg-white dark:bg-[#0f1a29] aurora:bg-[#101c23] border border-[#cbd5e1] dark:border-[#243952] aurora:border-[#223d47] text-[#475569] dark:text-[#9cb2c9] aurora:text-[#8eb2bd] hover:text-[#2ba0ff] aurora:hover:text-[#2dd4bf] flex items-center justify-center shadow-xs transition-opacity cursor-pointer z-10"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                )}

                {/* Account Remark Badge */}
                {remarkText && (
                  <button
                    type="button"
                    onClick={(e) => {
                      if (onUpdateAccountRemark) {
                        e.stopPropagation();
                        openRemarkEditor(acc, e.currentTarget);
                      } else {
                        onSelectAccount(acc.id);
                      }
                    }}
                    title={`备注: ${remarkText}`}
                    className={`mt-1 max-w-[74px] truncate px-1.5 py-0.5 rounded text-[10px] leading-tight cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#e8f3ff] dark:bg-[#12253c] aurora:bg-[#112e37] text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] font-medium'
                        : 'text-[#64748b] dark:text-[#8ea4ba] aurora:text-[#8ca9b3] hover:text-[#0f172a] dark:hover:text-[#eef4fb]'
                    }`}
                  >
                    {remarkText}
                  </button>
                )}
              </div>
            );
          })}

          {/* Quick Add Account Button */}
          <button
            onClick={onOpenAddAccount}
            title="添加账号"
            className="w-10 h-10 rounded-full border border-dashed border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#213a45] hover:border-[#2ba0ff] aurora:hover:border-[#2dd4bf] bg-white/80 dark:bg-[#0e1726]/80 aurora:bg-[#101c23]/85 hover:bg-[#e8f3ff] dark:hover:bg-[#2ba0ff]/15 aurora:hover:bg-[#2dd4bf]/15 text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] hover:text-[#0284c7] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] flex items-center justify-center transition-all cursor-pointer shrink-0 group hover:scale-105"
          >
            <Plus className="w-[18px] h-[18px] group-hover:rotate-90 transition-transform duration-200" />
          </button>
        </div>
      </div>

      {/* Account Remark Floating Editor Popover (图3) */}
      {editingRemarkState && (() => {
        const targetAcc = accounts.find((a) => a.id === editingRemarkState.accountId);
        if (!targetAcc) return null;
        return (
          <div
            ref={remarkPopoverRef}
            style={{ top: editingRemarkState.top, left: editingRemarkState.left }}
            className="fixed z-50 w-56 rounded-xl bg-white dark:bg-[#0d1724] aurora:bg-[#0e1b22] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1f3944] shadow-xl p-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] truncate">
                  账号备注
                </div>
                <div className="text-[11px] text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] truncate">
                  {targetAcc.name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingRemarkState(null)}
                title="关闭"
                className="p-1 rounded-md text-[#64748b] hover:text-[#0f172a] dark:text-[#7f95ab] dark:hover:text-[#eef4fb] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <input
              ref={remarkInputRef}
              type="text"
              maxLength={24}
              value={editingRemarkState.value}
              onChange={(e) =>
                setEditingRemarkState((prev) => (prev ? { ...prev, value: e.target.value } : null))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRemarkEditor();
                }
              }}
              placeholder="输入备注名（最多24字）"
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081217] border border-[#cbd5e1] dark:border-[#243952] aurora:border-[#203944] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
            />

            <div className="flex items-center justify-between gap-1.5 mt-2.5">
              {targetAcc.remark ? (
                <button
                  type="button"
                  onClick={() => commitRemarkEditor('')}
                  className="px-2 py-1 rounded-md text-[11px] text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                >
                  清空
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingRemarkState(null)}
                  className="px-2.5 py-1 rounded-md text-[11px] text-[#64748b] dark:text-[#8ea4ba] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => commitRemarkEditor()}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#2ba0ff] aurora:bg-[#14b8a6] text-white hover:opacity-90 flex items-center gap-1 cursor-pointer"
                >
                  <Check className="w-3 h-3" />
                  <span>保存</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </aside>
  );
};

