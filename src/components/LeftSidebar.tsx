import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Languages,
  Cpu,
  Brain,
  Plus,
  AudioWaveform,
  Sparkles,
  Bot,
  ChevronUp,
  ChevronDown,
  Pencil,
  FolderPlus,
  Trash2,
  X,
  Check
} from 'lucide-react';
import { Account, AccountGroup } from '../types';
import { resolveAccountAvatarSrc } from '../services/apiService';

const TOOLS_COLLAPSED_STORAGE_KEY = 'hs_left_sidebar_tools_collapsed';
const ACCOUNT_RAIL_HEIGHT_STORAGE_KEY = 'hs_left_sidebar_account_height';
const GROUP_COLORS = ['#2ba0ff', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#10b981'];
const DEFAULT_ACCOUNT_RAIL_HEIGHT = 220;
const MIN_ACCOUNT_RAIL_HEIGHT = 96;

interface LeftSidebarProps {
  accounts: Account[];
  accountGroups?: AccountGroup[];
  activeAccountId: string;
  onSelectAccount: (accountId: string) => void;
  onUpdateAccountRemark?: (accountId: string, remark: string) => void;
  onUpdateAccountMeta?: (accountId: string, meta: { remark?: string; groupId?: string }) => void;
  onCreateAccountGroup?: (name: string, color?: string) => AccountGroup | null;
  onRenameAccountGroup?: (groupId: string, name: string, color?: string) => void;
  onDeleteAccountGroup?: (groupId: string) => void;
  onToggleAccountGroupCollapse?: (groupId: string) => void;
  onReorderAccountGroups?: (sourceGroupId: string, targetGroupId: string, position: 'before' | 'after') => void;
  onReorderAccounts?: (sourceAccountId: string, targetAccountId: string, position: 'before' | 'after') => void;
  onMoveAccountToGroup?: (accountId: string, targetGroupId?: string) => void;
  onOpenMenuDrawer: () => void;
  onOpenTranslation: () => void;
  onOpenAddAccount: () => void;
  onOpenCustomLLM: () => void;
  onOpenCustomerMemory: () => void;
  onOpenVoiceStudio?: () => void;
  onOpenDatabase?: () => void;
  onOpenMasterVoiceprint?: () => void;
  onOpenKnowledgeEvolution?: () => void;
  onOpenAiAssistant?: () => void;
  isAiAssistantOpen?: boolean;
  isMasterVoiceActive?: boolean;
  activeTab: 'chats' | 'memory' | 'llm' | 'translation' | 'voice' | 'persona';
  setActiveTab: (tab: 'chats' | 'memory' | 'llm' | 'translation' | 'voice' | 'persona') => void;
  compact?: boolean;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = React.memo(({
  accounts,
  accountGroups = [],
  activeAccountId,
  onSelectAccount,
  onUpdateAccountRemark,
  onUpdateAccountMeta,
  onCreateAccountGroup,
  onRenameAccountGroup,
  onDeleteAccountGroup,
  onToggleAccountGroupCollapse,
  onReorderAccountGroups,
  onReorderAccounts,
  onMoveAccountToGroup,
  onOpenMenuDrawer,
  onOpenTranslation,
  onOpenAddAccount,
  onOpenCustomLLM,
  onOpenCustomerMemory,
  onOpenMasterVoiceprint,
  onOpenKnowledgeEvolution,
  onOpenAiAssistant,
  isAiAssistantOpen,
  isMasterVoiceActive,
  activeTab,
  setActiveTab,
  compact = false,
}) => {
  const [failedAvatarKeys, setFailedAvatarKeys] = useState<Record<string, string>>({});
  const [avatarRetryNonce, setAvatarRetryNonce] = useState<Record<string, number>>({});
  const avatarRetryTimersRef = useRef<Record<string, number>>({});
  useEffect(() => {
    return () => {
      Object.values(avatarRetryTimersRef.current).forEach((t) => window.clearTimeout(t));
      avatarRetryTimersRef.current = {};
    };
  }, []);
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
    groupId: string;
    newGroupName: string;
  } | null>(null);
  const [groupEditorState, setGroupEditorState] = useState<{
    mode: 'create' | 'edit';
    groupId?: string;
    top: number;
    left: number;
    name: string;
    color: string;
  } | null>(null);
  const [dragPayload, setDragPayload] = useState<{ type: 'account' | 'group'; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<
    | { kind: 'account'; accountId: string; position: 'before' | 'after' }
    | { kind: 'group-reorder'; groupId: string; position: 'before' | 'after' }
    | { kind: 'group-drop'; groupId: string }
    | null
  >(null);

  const asideRef = useRef<HTMLElement | null>(null);
  const topSectionRef = useRef<HTMLDivElement | null>(null);
  const remarkPopoverRef = useRef<HTMLDivElement | null>(null);
  const remarkInputRef = useRef<HTMLInputElement | null>(null);
  const groupPopoverRef = useRef<HTMLDivElement | null>(null);
  const groupInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (!groupEditorState) return;
    const focusTimer = setTimeout(() => {
      groupInputRef.current?.focus();
      groupInputRef.current?.select();
    }, 10);
    const handleOutside = (e: MouseEvent) => {
      if (groupPopoverRef.current && !groupPopoverRef.current.contains(e.target as Node)) {
        setGroupEditorState(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setGroupEditorState(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [groupEditorState?.mode, groupEditorState?.groupId]);

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
    if ((!onUpdateAccountMeta && !onUpdateAccountRemark) || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const asideRight = asideRef.current?.getBoundingClientRect().right;
    const top = Math.max(12, Math.min(window.innerHeight - 335, rect.top - 16));
    const left = (asideRight ?? rect.right) + 8;
    setGroupEditorState(null);
    setEditingRemarkState({
      accountId: acc.id,
      top,
      left,
      value: acc.remark || '',
      groupId: acc.groupId || '',
      newGroupName: '',
    });
  };

  const commitRemarkEditor = (nextVal?: string, overrideGroupId?: string) => {
    if (!editingRemarkState) return;
    const finalRemark = (nextVal !== undefined ? nextVal : editingRemarkState.value).trim();
    let finalGroupId = overrideGroupId !== undefined ? overrideGroupId : editingRemarkState.groupId;
    const pendingNewGroupName = editingRemarkState.newGroupName.trim();
    if (nextVal === undefined && overrideGroupId === undefined && pendingNewGroupName && onUpdateAccountMeta) {
      const existingGroup = accountGroups.find((g) => g.name.trim() === pendingNewGroupName);
      if (existingGroup) {
        finalGroupId = existingGroup.id;
      } else if (onCreateAccountGroup) {
        const created = onCreateAccountGroup(
          pendingNewGroupName,
          GROUP_COLORS[accountGroups.length % GROUP_COLORS.length]
        );
        if (created) {
          finalGroupId = created.id;
        }
      }
    }
    if (onUpdateAccountMeta) {
      onUpdateAccountMeta(editingRemarkState.accountId, {
        remark: finalRemark,
        groupId: finalGroupId,
      });
    } else if (onUpdateAccountRemark) {
      onUpdateAccountRemark(editingRemarkState.accountId, finalRemark);
    }
    setEditingRemarkState(null);
  };

  const openGroupEditor = (
    mode: 'create' | 'edit',
    group: AccountGroup | undefined,
    anchorEl: HTMLElement | null
  ) => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const asideRight = asideRef.current?.getBoundingClientRect().right;
    const top = Math.max(12, Math.min(window.innerHeight - 250, rect.top - 16));
    const left = (asideRight ?? rect.right) + 8;
    setEditingRemarkState(null);
    setGroupEditorState({
      mode,
      groupId: group?.id,
      top,
      left,
      name: group?.name || '',
      color: group?.color || GROUP_COLORS[accountGroups.length % GROUP_COLORS.length],
    });
  };

  const commitGroupEditor = () => {
    if (!groupEditorState) return;
    const cleanName = groupEditorState.name.trim();
    if (!cleanName) return;
    if (groupEditorState.mode === 'create') {
      onCreateAccountGroup?.(cleanName, groupEditorState.color);
    } else if (groupEditorState.groupId) {
      onRenameAccountGroup?.(groupEditorState.groupId, cleanName, groupEditorState.color);
    }
    setGroupEditorState(null);
  };

  const totalUnread = accounts.reduce((acc, curr) => acc + (curr.unreadTotal || 0), 0);

  const railItemClass = (isActive: boolean) =>
    `w-full ${compact ? 'h-10' : 'h-14'} flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer relative group border ${
      isActive
        ? 'bg-[#e8f3ff] dark:bg-[#12253c] aurora:bg-[#112e37] linen:bg-[#a6907c]/75 border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/55 linen:border-[#f3e6d3]/40 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#fff9f0] font-medium shadow-[inset_3px_0_0_#2ba0ff] aurora:shadow-[0_0_16px_rgba(45,212,191,0.22),inset_3px_0_0_#2dd4bf] linen:shadow-xs'
        : 'border-transparent text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] linen:text-[#eee4d6]/90 hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-white hover:bg-black/5 dark:hover:bg-[#101c2d] aurora:hover:bg-[#112028] linen:hover:bg-white/10'
    }`;

  return (
    <aside
      ref={asideRef}
      className={`${compact ? 'w-[68px] py-2.5' : 'w-[120px] py-3.5'} bg-[#f8fafc]/95 dark:bg-[#060b13]/95 aurora:bg-[#0b1318]/95 linen:hs-linen-rail-bg backdrop-blur-md border-r border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] linen:border-[#5d4c3e] flex flex-col items-center shrink-0 select-none h-full z-30 relative transition-[width,colors] duration-150 text-[#475569] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#f5ede2]`}
    >
      {/* 1. Top Section: HumanSense Brand Logo + Main Menu + Feature Activity Rail */}
      <div ref={topSectionRef} className={`flex flex-col items-center w-full ${compact ? 'gap-1.5' : 'gap-2'} shrink-0`}>
        {/* HumanSense Brand Icon & Main Menu Trigger */}
        <button
          onClick={onOpenMenuDrawer}
          title="打开主菜单"
          className="w-12 h-12 rounded-xl hover:bg-[#e2e8f0]/60 dark:hover:bg-[#122033] aurora:hover:bg-[#12242d] linen:hover:bg-white/10 flex items-center justify-center transition-all cursor-pointer group p-1.5"
        >
          <img
            src="/app-icon.png"
            alt="HumanSense"
            className="w-9 h-9 rounded-lg object-cover ring-1 ring-[#2ba0ff]/30 dark:ring-[#2ba0ff]/40 aurora:ring-[#2dd4bf]/45 linen:ring-[#e8d9c4]/40 group-hover:ring-[#2ba0ff] aurora:group-hover:ring-[#2dd4bf] linen:group-hover:ring-[#f6ebdc] transition-all shadow-xs"
          />
        </button>

        {/* Hairline Divider */}
        <div className="w-10 h-px bg-[#e2e8f0] dark:bg-[#18273a] aurora:bg-[#1a2e38] linen:bg-white/20 my-0.5" />

        {/* Feature Navigation Rail Items */}
        <div className={`w-full flex flex-col items-center gap-2 ${compact ? 'px-1.5' : 'px-2.5'}`}>
          {/* 1. 所有消息 (Chats) */}
          <button
            onClick={() => setActiveTab('chats')}
            title="聊天"
            className={railItemClass(activeTab === 'chats' && !isAiAssistantOpen)}
          >
            <div className="relative">
              <MessageSquare className="w-5 h-5" />
              {totalUnread > 0 && (
                <span className="hs-accent-bg absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 bg-[#2ba0ff] aurora:bg-[#14b8a6] linen:bg-[#b56742] text-white text-[10px] font-bold rounded-full flex items-center justify-center tabular-nums shadow-xs border border-[#f8fafc] dark:border-[#060b13] aurora:border-[#0b1318] linen:border-[#786554]">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </div>
            {!compact && <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">聊天</span>}
          </button>

          {/* 1.5 独立 AI助手入口 (位于聊天正下方、展开/收起上方，不随功能区折叠) */}
          <button
            type="button"
            onClick={() => onOpenAiAssistant?.()}
            title="AI助手（业务、话术、产品、截图排障问答与 1-7 天流程）"
            className={railItemClass(Boolean(isAiAssistantOpen))}
          >
            <Bot className="w-5 h-5 group-hover:scale-105 transition-transform" />
            {!compact && <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">AI助手</span>}
          </button>

          {/* Collapse/Expand Toggle for Feature Tools (图2) */}
          <button
            type="button"
            onClick={() => setIsToolsCollapsed((prev) => !prev)}
            title={isToolsCollapsed ? '展开功能区（记忆/模型/翻译/音色/人设）' : '向上收起功能区'}
            className="w-full h-5 flex items-center justify-center gap-0.5 rounded-lg text-[10px] text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] linen:text-[#efe5d7]/85 hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-white hover:bg-black/5 dark:hover:bg-[#101c2d] aurora:hover:bg-[#112028] linen:hover:bg-white/10 transition-colors cursor-pointer"
          >
            {isToolsCollapsed ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                {!compact && <span>展开</span>}
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                {!compact && <span>收起</span>}
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
            {!compact && <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">记忆</span>}
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
            {!compact && <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">模型</span>}
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
            {!compact && <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">翻译</span>}
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
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#2ba0ff] aurora:bg-[#2dd4bf] linen:bg-[#e9b87a] ring-2 ring-[#f8fafc] dark:ring-[#060b13] aurora:ring-[#0b1318] linen:ring-[#6d5b4b]" />
              )}
            </div>
            {!compact && <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">音色</span>}
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
            {!compact && <span className="text-xs leading-none mt-1.5 whitespace-nowrap tracking-wide">人设</span>}
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
            isDraggingSplit ? 'bg-[#2ba0ff]/10 aurora:bg-[#2dd4bf]/10 linen:bg-white/10' : ''
          }`}
        >
          <div
            className={`w-full border-t transition-colors relative flex items-center justify-center ${
              isDraggingSplit
                ? 'border-[#2ba0ff] aurora:border-[#2dd4bf] linen:border-[#f3e6d3]'
                : 'border-[#e2e8f0] dark:border-[#162436] aurora:border-[#182b34] linen:border-white/15 group-hover:border-[#2ba0ff]/70 aurora:group-hover:border-[#2dd4bf]/70 linen:group-hover:border-[#f3e6d3]/70'
            }`}
          >
            <span
              className={`w-7 h-1 rounded-full -mt-px transition-colors ${
                isDraggingSplit
                  ? 'bg-[#2ba0ff] aurora:bg-[#2dd4bf] linen:bg-[#f3e6d3]'
                  : 'bg-[#cbd5e1] dark:bg-[#253a54] aurora:bg-[#24434f] linen:bg-white/30 group-hover:bg-[#2ba0ff] aurora:group-hover:bg-[#2dd4bf] linen:group-hover:bg-[#f3e6d3]'
              }`}
            />
          </div>
        </div>

        <div
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDropTarget(null);
            }
          }}
          className="flex-1 min-h-0 flex flex-col items-center gap-2.5 w-full overflow-y-auto no-scrollbar py-1.5"
        >
          {(() => {
            const canEditAccount = Boolean(onUpdateAccountMeta || onUpdateAccountRemark);
            const renderAccountItem = (acc: Account) => {
              const isSelected = acc.id === activeAccountId;
              const resolvedAvatarSrc = resolveAccountAvatarSrc(acc.id, acc.avatarUrl);
              const retryKey = acc.id;
              const retryCount = avatarRetryNonce[retryKey] || 0;
              const avatarRenderKey = `${resolvedAvatarSrc || ''}|${retryCount}`;
              const canRenderAvatarImg = Boolean(resolvedAvatarSrc) && failedAvatarKeys[acc.id] !== avatarRenderKey;
              const remarkText = acc.remark?.trim() || '';
              const groupObj = acc.groupId ? accountGroups.find((g) => g.id === acc.groupId) : undefined;
              const canDragAcc = Boolean(onReorderAccounts);
              const isDraggingThisAcc = dragPayload?.type === 'account' && dragPayload.id === acc.id;
              const isDropBeforeAcc =
                dropTarget?.kind === 'account' && dropTarget.accountId === acc.id && dropTarget.position === 'before';
              const isDropAfterAcc =
                dropTarget?.kind === 'account' && dropTarget.accountId === acc.id && dropTarget.position === 'after';
              return (
                <div
                  key={acc.id}
                  draggable={canDragAcc}
                  onDragStart={(e) => {
                    if (!canDragAcc) return;
                    e.stopPropagation();
                    setDragPayload({ type: 'account', id: acc.id });
                    e.dataTransfer.effectAllowed = 'move';
                    try {
                      e.dataTransfer.setData('text/plain', `account:${acc.id}`);
                    } catch {}
                  }}
                  onDragOver={(e) => {
                    if (!canDragAcc || dragPayload?.type !== 'account' || dragPayload.id === acc.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    const rect = e.currentTarget.getBoundingClientRect();
                    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    setDropTarget((prev) =>
                      prev?.kind === 'account' && prev.accountId === acc.id && prev.position === position
                        ? prev
                        : { kind: 'account', accountId: acc.id, position }
                    );
                  }}
                  onDrop={(e) => {
                    if (!canDragAcc || dragPayload?.type !== 'account' || dragPayload.id === acc.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    onReorderAccounts?.(dragPayload.id, acc.id, position);
                    setDragPayload(null);
                    setDropTarget(null);
                  }}
                  onDragEnd={() => {
                    setDragPayload(null);
                    setDropTarget(null);
                  }}
                  className={`relative group flex flex-col items-center shrink-0 w-full px-1 py-0.5 rounded-lg transition-all ${
                    isDraggingThisAcc ? 'opacity-45' : ''
                  } ${
                    isDropBeforeAcc ? 'border-t-2 border-t-[#2ba0ff] aurora:border-t-[#2dd4bf] linen:border-t-[#d4a373]' : ''
                  } ${
                    isDropAfterAcc ? 'border-b-2 border-b-[#2ba0ff] aurora:border-b-[#2dd4bf] linen:border-b-[#d4a373]' : ''
                  }`}
                >
                  <button
                    onClick={() => onSelectAccount(acc.id)}
                    onContextMenu={(e) => {
                      if (!canEditAccount) return;
                      e.preventDefault();
                      openRemarkEditor(acc, e.currentTarget);
                    }}
                    title={`${remarkText ? `[自定义名: ${remarkText}] ` : ''}${groupObj ? `[分组: ${groupObj.name}] ` : ''}${acc.name} (${acc.username})${
                      acc.status === 'expired'
                        ? ' · 会话已失效，请重新登录'
                        : acc.status === 'away'
                        ? ' · 连接中'
                        : ''
                    }${canEditAccount ? ' · 右键可设置自定义名与分组' : ''}`}
                    className="relative cursor-pointer focus:outline-none shrink-0"
                  >
                    <div
                      className={`relative w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold transition-all overflow-hidden ${
                        isSelected
                          ? 'ring-2 ring-[#2ba0ff] aurora:ring-[#2dd4bf] linen:ring-[#f3e6d3] ring-offset-1 ring-offset-[#f8fafc] dark:ring-offset-[#060b13] aurora:ring-offset-[#0b1318] linen:ring-offset-[#756252] scale-105 shadow-sm'
                          : 'opacity-75 hover:opacity-100 hover:scale-105'
                      }`}
                      style={{ backgroundColor: acc.avatarBg }}
                    >
                      <span className="text-white text-xs font-bold select-none">{acc.avatarInitial}</span>
                      {canRenderAvatarImg && (
                        <img
                          draggable={false}
                          src={resolvedAvatarSrc}
                          alt={remarkText || acc.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover absolute inset-0"
                          onLoad={() => {
                            if (avatarRetryTimersRef.current[retryKey]) {
                              window.clearTimeout(avatarRetryTimersRef.current[retryKey]);
                              delete avatarRetryTimersRef.current[retryKey];
                            }
                            setFailedAvatarKeys((prev) => {
                              if (!(acc.id in prev)) return prev;
                              const next = { ...prev };
                              delete next[acc.id];
                              return next;
                            });
                          }}
                          onError={() => {
                            setFailedAvatarKeys((prev) =>
                              prev[acc.id] === avatarRenderKey ? prev : { ...prev, [acc.id]: avatarRenderKey }
                            );
                            if (retryCount < 2 && !avatarRetryTimersRef.current[retryKey]) {
                              const delayMs = retryCount === 0 ? 2500 : 6500;
                              avatarRetryTimersRef.current[retryKey] = window.setTimeout(() => {
                                delete avatarRetryTimersRef.current[retryKey];
                                setAvatarRetryNonce((p) => ({ ...p, [retryKey]: (p[retryKey] || 0) + 1 }));
                              }, delayMs);
                            }
                          }}
                        />
                      )}
                    </div>

                    {/* Status Dot */}
                    <span
                      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#f8fafc] dark:border-[#060b13] aurora:border-[#0b1318] linen:border-[#756252] ${
                        acc.status === 'online'
                          ? 'bg-emerald-500'
                          : acc.status === 'away'
                          ? 'bg-amber-400'
                          : acc.status === 'expired'
                          ? 'bg-rose-500 animate-pulse'
                          : 'bg-slate-400 dark:bg-slate-500 aurora:bg-[#5a7782] linen:bg-[#b8aa99]'
                      }`}
                    />
                  </button>

                  {/* Hover Quick Remark & Group Edit Trigger */}
                  {canEditAccount && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRemarkEditor(acc, e.currentTarget.parentElement);
                      }}
                      title={remarkText ? `编辑自定义名与分组：${remarkText}` : '设置自定义名与分组'}
                      className={`opacity-0 group-hover:opacity-100 focus:opacity-100 absolute -top-1 ${compact ? 'right-1' : 'right-3.5'} w-4 h-4 rounded-full bg-white dark:bg-[#0f1a29] aurora:bg-[#101c23] linen:bg-[#f8f2e7] border border-[#cbd5e1] dark:border-[#243952] aurora:border-[#223d47] linen:border-[#cbbba2] text-[#475569] dark:text-[#9cb2c9] aurora:text-[#8eb2bd] linen:text-[#5c4b3b] hover:text-[#2ba0ff] aurora:hover:text-[#2dd4bf] linen:hover:text-[#a86a43] flex items-center justify-center shadow-xs transition-opacity cursor-pointer z-10`}
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                  )}

                  {/* Account Custom Name / Remark Badge */}
                  {remarkText && (
                    <button
                      type="button"
                      onClick={(e) => {
                        if (canEditAccount) {
                          e.stopPropagation();
                          openRemarkEditor(acc, e.currentTarget);
                        } else {
                          onSelectAccount(acc.id);
                        }
                      }}
                      title={`自定义名: ${remarkText}（原名: ${acc.name}）`}
                      className={`mt-1 ${compact ? 'w-[56px] max-w-[56px] px-1' : 'w-[108px] max-w-[108px] px-1.5'} truncate py-0.5 rounded text-[10px] leading-tight cursor-pointer transition-colors text-center ${
                        isSelected
                          ? 'bg-[#e8f3ff] dark:bg-[#12253c] aurora:bg-[#112e37] linen:bg-[#a6907c]/80 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-white font-medium'
                          : 'text-[#64748b] dark:text-[#8ea4ba] aurora:text-[#8ca9b3] linen:text-[#efe5d7]/90 hover:text-[#0f172a] dark:hover:text-[#eef4fb] linen:hover:text-white'
                      }`}
                    >
                      {remarkText}
                    </button>
                  )}
                </div>
              );
            };

            if (accountGroups.length === 0) {
              return accounts.map(renderAccountItem);
            }

            const validGroupIds = new Set(accountGroups.map((g) => g.id));
            const ungroupedAccounts = accounts.filter((a) => !a.groupId || !validGroupIds.has(a.groupId));

            return (
              <>
                {accountGroups.map((grp) => {
                  const groupAccounts = accounts.filter((a) => a.groupId === grp.id);
                  const groupUnread = groupAccounts.reduce((sum, a) => sum + (a.unreadTotal || 0), 0);
                  const canDragGrp = Boolean(onReorderAccountGroups);
                  const isDraggingThisGrp = dragPayload?.type === 'group' && dragPayload.id === grp.id;
                  const isGrpDropBefore =
                    dropTarget?.kind === 'group-reorder' && dropTarget.groupId === grp.id && dropTarget.position === 'before';
                  const isGrpDropAfter =
                    dropTarget?.kind === 'group-reorder' && dropTarget.groupId === grp.id && dropTarget.position === 'after';
                  const isAccIntoThisGrp = dropTarget?.kind === 'group-drop' && dropTarget.groupId === grp.id;
                  return (
                    <div key={grp.id} className="w-full flex flex-col items-center gap-2">
                      <div
                        draggable={canDragGrp}
                        onDragStart={(e) => {
                          if (!canDragGrp) return;
                          setDragPayload({ type: 'group', id: grp.id });
                          e.dataTransfer.effectAllowed = 'move';
                          try {
                            e.dataTransfer.setData('text/plain', `group:${grp.id}`);
                          } catch {}
                        }}
                        onDragOver={(e) => {
                          if (dragPayload?.type === 'group' && canDragGrp && dragPayload.id !== grp.id) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            const rect = e.currentTarget.getBoundingClientRect();
                            const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                            setDropTarget((prev) =>
                              prev?.kind === 'group-reorder' && prev.groupId === grp.id && prev.position === position
                                ? prev
                                : { kind: 'group-reorder', groupId: grp.id, position }
                            );
                          } else if (dragPayload?.type === 'account' && onMoveAccountToGroup) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            setDropTarget((prev) =>
                              prev?.kind === 'group-drop' && prev.groupId === grp.id
                                ? prev
                                : { kind: 'group-drop', groupId: grp.id }
                            );
                          }
                        }}
                        onDrop={(e) => {
                          if (dragPayload?.type === 'group' && canDragGrp && dragPayload.id !== grp.id) {
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                            onReorderAccountGroups?.(dragPayload.id, grp.id, position);
                          } else if (dragPayload?.type === 'account' && onMoveAccountToGroup) {
                            e.preventDefault();
                            onMoveAccountToGroup(dragPayload.id, grp.id);
                          }
                          setDragPayload(null);
                          setDropTarget(null);
                        }}
                        onDragEnd={() => {
                          setDragPayload(null);
                          setDropTarget(null);
                        }}
                        className={`w-full px-1.5 py-0.5 flex items-center gap-0.5 group/grp rounded-md transition-all ${
                          isDraggingThisGrp ? 'opacity-45' : ''
                        } ${
                          isGrpDropBefore ? 'border-t-2 border-t-[#2ba0ff] aurora:border-t-[#2dd4bf] linen:border-t-[#d4a373]' : ''
                        } ${
                          isGrpDropAfter ? 'border-b-2 border-b-[#2ba0ff] aurora:border-b-[#2dd4bf] linen:border-b-[#d4a373]' : ''
                        } ${
                          isAccIntoThisGrp ? 'ring-1 ring-[#2ba0ff] aurora:ring-[#2dd4bf] linen:ring-[#d4a373] bg-[#2ba0ff]/10 aurora:bg-[#2dd4bf]/10 linen:bg-[#d4a373]/20' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onToggleAccountGroupCollapse?.(grp.id)}
                          onContextMenu={(e) => {
                            if (!onRenameAccountGroup && !onDeleteAccountGroup) return;
                            e.preventDefault();
                            openGroupEditor('edit', grp, e.currentTarget);
                          }}
                          title={`${grp.name} (${groupAccounts.length} 个账号)${groupUnread > 0 ? ` · ${groupUnread} 条未读` : ''} · 点击${grp.collapsed ? '展开' : '折叠'}，右键管理分组`}
                          className="flex-1 min-w-0 flex items-center gap-1 px-1.5 py-1 rounded-md text-[10.5px] font-medium bg-black/[0.03] dark:bg-white/[0.04] aurora:bg-[#112028]/80 linen:bg-white/10 hover:bg-black/[0.07] dark:hover:bg-white/[0.08] aurora:hover:bg-[#162b35] linen:hover:bg-white/20 text-[#475569] dark:text-[#9cb2c9] aurora:text-[#8eb2bd] linen:text-[#f5ede2] transition-colors cursor-pointer"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: grp.color || '#2ba0ff' }}
                          />
                          <span className="truncate flex-1 text-left" title={grp.name}>{grp.name}</span>
                          <span className="text-[9px] opacity-65 tabular-nums shrink-0">{groupAccounts.length}</span>
                          <ChevronDown
                            className={`w-2.5 h-2.5 shrink-0 opacity-60 transition-transform ${
                              grp.collapsed ? '-rotate-90' : ''
                            }`}
                          />
                        </button>
                        {(onRenameAccountGroup || onDeleteAccountGroup) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openGroupEditor('edit', grp, e.currentTarget);
                            }}
                            title={`管理分组「${grp.name}」`}
                            className="hidden group-hover/grp:inline-flex focus:inline-flex p-0.5 rounded text-[#64748b] linen:text-[#e9dfd1]/85 hover:text-[#2ba0ff] aurora:hover:text-[#2dd4bf] linen:hover:text-white cursor-pointer shrink-0"
                          >
                            <Pencil className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                      {!grp.collapsed && groupAccounts.map(renderAccountItem)}
                    </div>
                  );
                })}

                {(ungroupedAccounts.length > 0 ||
                  (dragPayload?.type === 'account' &&
                    Boolean(onMoveAccountToGroup) &&
                    Boolean(accounts.find((a) => a.id === dragPayload.id)?.groupId))) && (
                  <div className="w-full flex flex-col items-center gap-2 pt-0.5">
                    <div
                      onDragOver={(e) => {
                        if (dragPayload?.type !== 'account' || !onMoveAccountToGroup) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTarget((prev) =>
                          prev?.kind === 'group-drop' && prev.groupId === ''
                            ? prev
                            : { kind: 'group-drop', groupId: '' }
                        );
                      }}
                      onDrop={(e) => {
                        if (dragPayload?.type !== 'account' || !onMoveAccountToGroup) return;
                        e.preventDefault();
                        onMoveAccountToGroup(dragPayload.id, undefined);
                        setDragPayload(null);
                        setDropTarget(null);
                      }}
                      className={`w-full px-2 py-0.5 flex items-center justify-center rounded-md transition-all ${
                        dropTarget?.kind === 'group-drop' && dropTarget.groupId === ''
                          ? 'ring-1 ring-[#2ba0ff] aurora:ring-[#2dd4bf] linen:ring-[#d4a373] bg-[#2ba0ff]/10 aurora:bg-[#2dd4bf]/10 linen:bg-[#d4a373]/20'
                          : ''
                      }`}
                    >
                      <span className="text-[9px] text-[#94a3b8] dark:text-[#5c748c] aurora:text-[#5d7b87] linen:text-[#e9dfd1]/85 truncate">
                        {ungroupedAccounts.length > 0 ? `未分组 (${ungroupedAccounts.length})` : '拖到此处移出分组'}
                      </span>
                    </div>
                    {ungroupedAccounts.map(renderAccountItem)}
                  </div>
                )}
              </>
            );
          })()}

          {/* Quick Add Account Button */}
          <button
            onClick={onOpenAddAccount}
            title="添加账号"
            className="w-10 h-10 rounded-full border border-dashed border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#213a45] linen:border-white/35 hover:border-[#2ba0ff] aurora:hover:border-[#2dd4bf] linen:hover:border-[#fff8ee] bg-white/80 dark:bg-[#0e1726]/80 aurora:bg-[#101c23]/85 linen:bg-white/12 hover:bg-[#e8f3ff] dark:hover:bg-[#2ba0ff]/15 aurora:hover:bg-[#2dd4bf]/15 linen:hover:bg-white/22 text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] linen:text-[#f5ede2] hover:text-[#0284c7] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] linen:hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0 group hover:scale-105"
          >
            <Plus className="w-[18px] h-[18px] group-hover:rotate-90 transition-transform duration-200" />
          </button>

          {/* Quick Add Account Group Button */}
          {onCreateAccountGroup && (
            <button
              type="button"
              onClick={(e) => openGroupEditor('create', undefined, e.currentTarget)}
              title="新建账号分组"
              className={`${compact ? 'w-10' : 'w-12'} h-6 rounded-md border border-dashed border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#213a45] linen:border-white/30 hover:border-[#2ba0ff] aurora:hover:border-[#2dd4bf] linen:hover:border-[#fff8ee] linen:bg-white/10 text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] linen:text-[#f5ede2] hover:text-[#0284c7] dark:hover:text-[#2ba0ff] aurora:hover:text-[#5eead4] linen:hover:text-white flex items-center justify-center gap-1 text-[10px] transition-colors cursor-pointer shrink-0`}
            >
              <FolderPlus className="w-3 h-3" />
              {!compact && <span>分组</span>}
            </button>
          )}
        </div>
      </div>

      {/* Account Custom Name & Group Floating Editor Popover */}
      {editingRemarkState && (() => {
        const targetAcc = accounts.find((a) => a.id === editingRemarkState.accountId);
        if (!targetAcc) return null;
        return (
          <div
            ref={remarkPopoverRef}
            style={{ top: editingRemarkState.top, left: editingRemarkState.left }}
            className="fixed z-50 w-64 rounded-xl bg-white dark:bg-[#0d1724] aurora:bg-[#0e1b22] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1f3944] linen:border-[#d5c6ae] shadow-xl linen:shadow-sm p-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="min-w-0">
                <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] truncate">
                  自定义名与分组
                </div>
                <div className="text-[11px] text-[#64748b] dark:text-[#7f95ab] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] truncate">
                  原账号：{targetAcc.name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingRemarkState(null)}
                title="关闭"
                className="p-1 rounded-md text-[#64748b] hover:text-[#0f172a] dark:text-[#7f95ab] dark:hover:text-[#eef4fb] linen:text-[#6e5c4a] linen:hover:text-[#2b2118] hover:bg-black/5 dark:hover:bg-white/5 linen:hover:bg-[#e9decb] cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <label className="block text-[11px] text-[#64748b] dark:text-[#8ea4ba] aurora:text-[#8ca9b3] linen:text-[#6e5c4a] mb-1">
              自定义名称
            </label>
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
              placeholder="输入自定义名称（最多24字）"
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081217] linen:bg-[#efe6d6] border border-[#cbd5e1] dark:border-[#243952] aurora:border-[#203944] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder:text-[#94a3b8] linen:placeholder:text-[#8f7e6c] focus:outline-none focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
            />

            {onUpdateAccountMeta && (
              <div className="mt-2.5">
                <label className="block text-[11px] text-[#64748b] dark:text-[#8ea4ba] aurora:text-[#8ca9b3] linen:text-[#6e5c4a] mb-1">
                  所属分组
                </label>
                <select
                  value={editingRemarkState.groupId}
                  onChange={(e) =>
                    setEditingRemarkState((prev) => (prev ? { ...prev, groupId: e.target.value } : null))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081217] linen:bg-[#efe6d6] border border-[#cbd5e1] dark:border-[#243952] aurora:border-[#203944] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] focus:outline-none focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] cursor-pointer"
                >
                  <option value="">未分组</option>
                  {accountGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>

                {onCreateAccountGroup && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <input
                      type="text"
                      maxLength={24}
                      value={editingRemarkState.newGroupName}
                      onChange={(e) =>
                        setEditingRemarkState((prev) =>
                          prev ? { ...prev, newGroupName: e.target.value } : null
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && editingRemarkState.newGroupName.trim()) {
                          e.preventDefault();
                          const created = onCreateAccountGroup(
                            editingRemarkState.newGroupName,
                            GROUP_COLORS[accountGroups.length % GROUP_COLORS.length]
                          );
                          if (created) {
                            setEditingRemarkState((prev) =>
                              prev ? { ...prev, groupId: created.id, newGroupName: '' } : null
                            );
                          }
                        }
                      }}
                      placeholder="或输入新分组名快速创建"
                      className="flex-1 min-w-0 px-2 py-1 rounded-md bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081217] linen:bg-[#efe6d6] border border-[#cbd5e1] dark:border-[#243952] aurora:border-[#203944] linen:border-[#cbbba2] text-[11px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder:text-[#94a3b8] linen:placeholder:text-[#8f7e6c] focus:outline-none focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                    />
                    <button
                      type="button"
                      disabled={!editingRemarkState.newGroupName.trim()}
                      onClick={() => {
                        const created = onCreateAccountGroup(
                          editingRemarkState.newGroupName,
                          GROUP_COLORS[accountGroups.length % GROUP_COLORS.length]
                        );
                        if (created) {
                          setEditingRemarkState((prev) =>
                            prev ? { ...prev, groupId: created.id, newGroupName: '' } : null
                          );
                        }
                      }}
                      className="px-2 py-1 rounded-md text-[11px] bg-black/5 dark:bg-white/10 linen:bg-[#a86a43]/15 hover:bg-[#2ba0ff]/15 linen:hover:bg-[#a86a43]/25 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#5eead4] linen:text-[#8c522d] disabled:opacity-40 cursor-pointer shrink-0"
                    >
                      新建
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-1.5 mt-3">
              {targetAcc.remark ? (
                <button
                  type="button"
                  onClick={() => commitRemarkEditor('')}
                  className="px-2 py-1 rounded-md text-[11px] text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                >
                  清空名称
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingRemarkState(null)}
                  className="px-2.5 py-1 rounded-md text-[11px] text-[#64748b] dark:text-[#8ea4ba] linen:text-[#6e5c4a] hover:bg-black/5 dark:hover:bg-white/5 linen:hover:bg-[#e9decb] cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => commitRemarkEditor()}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#2ba0ff] aurora:bg-[#14b8a6] linen:bg-[#a86a43] text-white hover:opacity-90 flex items-center gap-1 cursor-pointer"
                >
                  <Check className="w-3 h-3" />
                  <span>保存</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Account Group Create / Rename / Delete Popover */}
      {groupEditorState && (
        <div
          ref={groupPopoverRef}
          style={{ top: groupEditorState.top, left: groupEditorState.left }}
          className="fixed z-50 w-60 rounded-xl bg-white dark:bg-[#0d1724] aurora:bg-[#0e1b22] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#1f3944] linen:border-[#d5c6ae] shadow-xl linen:shadow-sm p-3 text-xs"
        >
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
              {groupEditorState.mode === 'create' ? '新建账号分组' : '编辑账号分组'}
            </div>
            <button
              type="button"
              onClick={() => setGroupEditorState(null)}
              title="关闭"
              className="p-1 rounded-md text-[#64748b] hover:text-[#0f172a] dark:text-[#7f95ab] dark:hover:text-[#eef4fb] linen:text-[#6e5c4a] linen:hover:text-[#2b2118] hover:bg-black/5 dark:hover:bg-white/5 linen:hover:bg-[#e9decb] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <input
            ref={groupInputRef}
            type="text"
            maxLength={24}
            value={groupEditorState.name}
            onChange={(e) =>
              setGroupEditorState((prev) => (prev ? { ...prev, name: e.target.value } : null))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitGroupEditor();
              }
            }}
            placeholder="分组名称（如：主力客服、欧美组）"
            className="w-full px-2.5 py-1.5 rounded-lg bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081217] linen:bg-[#efe6d6] border border-[#cbd5e1] dark:border-[#243952] aurora:border-[#203944] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder:text-[#94a3b8] linen:placeholder:text-[#8f7e6c] focus:outline-none focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
          />

          <div className="flex items-center gap-2 mt-2.5">
            <span className="text-[11px] text-[#64748b] dark:text-[#8ea4ba] linen:text-[#6e5c4a] shrink-0">标记色</span>
            <div className="flex items-center gap-1.5">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setGroupEditorState((prev) => (prev ? { ...prev, color: c } : null))}
                  className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                    groupEditorState.color === c ? 'scale-115 ring-2 ring-offset-1 ring-[#2ba0ff] linen:ring-[#a86a43] dark:ring-offset-[#0d1724] linen:ring-offset-[#f8f2e7]' : 'opacity-75 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-1.5 mt-3">
            {groupEditorState.mode === 'edit' && groupEditorState.groupId && onDeleteAccountGroup ? (
              <button
                type="button"
                onClick={() => {
                  onDeleteAccountGroup(groupEditorState.groupId!);
                  setGroupEditorState(null);
                }}
                title="删除分组（组内账号将移回未分组，不会被删除）"
                className="px-2 py-1 rounded-md text-[11px] text-rose-500 hover:bg-rose-500/10 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>删除</span>
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setGroupEditorState(null)}
                className="px-2.5 py-1 rounded-md text-[11px] text-[#64748b] dark:text-[#8ea4ba] linen:text-[#6e5c4a] hover:bg-black/5 dark:hover:bg-white/5 linen:hover:bg-[#e9decb] cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!groupEditorState.name.trim()}
                onClick={commitGroupEditor}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#2ba0ff] aurora:bg-[#14b8a6] linen:bg-[#a86a43] text-white hover:opacity-90 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3 h-3" />
                <span>{groupEditorState.mode === 'create' ? '创建' : '保存'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
});

