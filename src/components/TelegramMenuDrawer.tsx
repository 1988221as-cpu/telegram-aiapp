import React, { useState } from 'react';
import {
  Users,
  Megaphone,
  User,
  Bookmark,
  Settings,
  Moon,
  Sun,
  UserPlus,
  ChevronDown,
  ChevronUp,
  X,
  Check,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { Account, AppThemeMode, MemberUser } from '../types';
import {
  APP_VERSION,
  disconnectTelegramAccount,
  checkAppUpdateApi,
  type AppUpdateCheckResult,
} from '../services/apiService';

interface TelegramMenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccount?: Account | null;
  accounts: Account[];
  onSelectAccount: (id: string) => void;
  onOpenAddAccount: () => void;
  onReloginAccount?: (account: Account) => void;
  onOpenTranslation?: () => void;
  onOpenSystemSettings?: () => void;
  onSelectChat?: (chatId: string) => void;
  onDeleteAccount?: (id: string) => void;
  theme: AppThemeMode;
  onToggleTheme: () => void;
  onSelectTheme?: (theme: AppThemeMode) => void;
  onOpenNewGroup?: () => void;
  onOpenNewChannel?: () => void;
  onOpenContacts?: () => void;
  onOpenTelegramSettings?: () => void;
  onOpenKnowledgeEvolution?: () => void;
  currentMember?: MemberUser | null;
  onMemberLogout?: () => void;
  onUpdateAvailable?: (info: AppUpdateCheckResult) => void;
}

export const TelegramMenuDrawer: React.FC<TelegramMenuDrawerProps> = ({
  isOpen,
  onClose,
  currentAccount,
  accounts,
  onSelectAccount,
  onOpenAddAccount,
  onReloginAccount,
  onSelectChat,
  onDeleteAccount,
  theme,
  onToggleTheme,
  onSelectTheme,
  onOpenNewGroup,
  onOpenNewChannel,
  onOpenContacts,
  onOpenTelegramSettings,
  currentMember,
  onMemberLogout,
  onUpdateAvailable,
}) => {
  const safeAccount: Account = currentAccount || {
    id: '',
    name: 'HumanSense 工作台',
    username: '',
    phone: '点击「+ 添加账号」关联',
    avatarBg: '#2481cc',
    avatarInitial: 'HS',
    avatarUrl: undefined,
    unreadTotal: 0,
    status: 'offline',
    isActive: false,
  };
  const [showAccountList, setShowAccountList] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [confirmingMemberLogout, setConfirmingMemberLogout] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [disconnectError, setDisconnectError] = useState<{
    accountId: string;
    message: string;
    canForceLocal?: boolean;
  } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs transition-opacity cursor-pointer"
        onClick={onClose}
      />

      {/* Slide-out Drawer from Left */}
      <div className="relative w-72 sm:w-80 h-full bg-white text-[#0f172a] dark:bg-[#0b131f] dark:text-[#eef4fb] aurora:bg-[#0c151b] aurora:text-[#ecf6f8] linen:bg-[#f4ede0] linen:text-[#2b2118] flex flex-col shadow-2xl z-10 animate-in slide-in-from-left duration-250 select-none border-r border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2] transition-colors">
        {/* 1. Profile Header */}
        <div className="p-4 bg-[#2481cc] dark:bg-gradient-to-br dark:from-[#122943] dark:to-[#0b1829] aurora:bg-gradient-to-br aurora:from-[#0f3d47] aurora:to-[#0a232b] linen:bg-gradient-to-br linen:from-[#7b6654] linen:to-[#5e4d3e] text-white flex flex-col justify-between shrink-0 relative overflow-hidden border-b border-transparent dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#5d4c3e]">
          <div className="flex items-start justify-between mb-3">
            <div className="relative">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shadow-md border-2 border-white/25 overflow-hidden"
                style={{ backgroundColor: safeAccount.avatarBg || '#2ba0ff' }}
              >
                {safeAccount.avatarUrl ? (
                  <img
                    src={safeAccount.avatarUrl}
                    alt={safeAccount.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{safeAccount.avatarInitial || 'TG'}</span>
                )}
              </div>
              {safeAccount.id && (
                <span
                  className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-[#0b1829] aurora:border-[#0a232b] linen:border-[#5e4d3e] ${
                    safeAccount.status === 'online'
                      ? 'bg-emerald-400'
                      : safeAccount.status === 'away'
                      ? 'bg-amber-400'
                      : safeAccount.status === 'expired'
                      ? 'bg-rose-500'
                      : 'bg-slate-400'
                  }`}
                  title={
                    safeAccount.status === 'online'
                      ? '已连接'
                      : safeAccount.status === 'away'
                      ? '重连中'
                      : safeAccount.status === 'expired'
                      ? '会话已失效，请重新登录'
                      : '离线'
                  }
                />
              )}
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-base truncate text-white leading-tight">
                {safeAccount.name || 'Telegram 用户'}
              </h3>
              <p className="text-xs text-white/80 truncate mt-0.5">
                {safeAccount.phone || safeAccount.username || '尚未关联账号'}
              </p>
            </div>

            <button
              onClick={() => setShowAccountList(!showAccountList)}
              className="p-1.5 rounded-lg text-white/90 hover:bg-white/15 transition-colors cursor-pointer shrink-0 ml-2"
              title="切换或管理账号"
            >
              {showAccountList ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Account Switcher Dropdown (Inside Header) */}
        {showAccountList && (
          <div className="bg-[#f8fafc] dark:bg-[#0e1726] aurora:bg-[#101c23] linen:bg-[#efe6d6] border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] p-2 flex flex-col gap-1 max-h-48 overflow-y-auto no-scrollbar animate-in slide-in-from-top-2 duration-150">
            {accounts.map((acc) => {
              const isConfirming = confirmingDeleteId === acc.id;
              const isDisconnecting = disconnectingId === acc.id;
              const accError = disconnectError?.accountId === acc.id ? disconnectError : null;
              return (
                <div
                  key={acc.id}
                  className={`flex flex-col p-2 rounded-xl text-left transition-colors border ${
                    acc.id === safeAccount.id
                      ? 'bg-[#e8f3ff] border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] linen:bg-[#e5d5bf] linen:border-[#c2a889] linen:text-[#7c4522]'
                      : 'border-transparent hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e6d9c4] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectAccount(acc.id);
                        setShowAccountList(false);
                      }}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="relative shrink-0">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: acc.avatarBg || '#2ba0ff' }}
                        >
                          {acc.avatarInitial || 'TG'}
                        </div>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#f8fafc] dark:border-[#0e1726] aurora:border-[#101c23] linen:border-[#efe6d6] ${
                            acc.status === 'online'
                              ? 'bg-emerald-500'
                              : acc.status === 'away'
                              ? 'bg-amber-400'
                              : acc.status === 'expired'
                              ? 'bg-rose-500'
                              : 'bg-slate-400'
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate flex items-center gap-1">
                          <span className="truncate">{acc.name}</span>
                          {acc.status === 'expired' && (
                            <span className="text-[10px] text-rose-600 dark:text-rose-400 aurora:text-rose-400 font-normal shrink-0">已失效</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] truncate">{acc.phone || acc.username}</div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0 ml-1">
                      {!isConfirming && acc.status === 'expired' && onReloginAccount && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReloginAccount(acc);
                            onClose();
                          }}
                          className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 aurora:text-rose-300 hover:bg-rose-500/25 text-[10px] font-medium cursor-pointer"
                        >
                          重新登录
                        </button>
                      )}
                      {!isConfirming && acc.id === safeAccount.id && (
                        <Check className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                      )}
                      {isConfirming ? (
                        <>
                          <button
                            type="button"
                            disabled={isDisconnecting}
                            onClick={async (e) => {
                              e.stopPropagation();
                              setDisconnectingId(acc.id);
                              setDisconnectError(null);
                              const res = await disconnectTelegramAccount(acc.id, acc.phone);
                              setDisconnectingId(null);
                              if (res.ok) {
                                setConfirmingDeleteId(null);
                                onDeleteAccount?.(acc.id);
                                showToast(`已退出账号 ${acc.name}`);
                              } else {
                                setDisconnectError({
                                  accountId: acc.id,
                                  message: res.error || '云端注销失败',
                                  canForceLocal: res.canForceLocal,
                                });
                              }
                            }}
                            className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[10px] font-medium cursor-pointer"
                          >
                            {isDisconnecting ? '注销中' : '确认退出'}
                          </button>
                          <button
                            type="button"
                            disabled={isDisconnecting}
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmingDeleteId(null);
                              setDisconnectError(null);
                            }}
                            className="px-1.5 py-0.5 rounded bg-[#e2e8f0] dark:bg-[#132234] aurora:bg-[#13252e] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] text-[10px] cursor-pointer"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmingDeleteId(acc.id);
                            setDisconnectError(null);
                          }}
                          className="p-1 rounded-md text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-rose-600 dark:hover:text-rose-400 aurora:hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
                          title="断开直连并退出该账号"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {accError && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-rose-700 dark:text-rose-300 aurora:text-rose-300 bg-rose-500/10 rounded-lg px-2 py-1">
                      <span className="truncate">{accError.message}</span>
                      {accError.canForceLocal && (
                        <button
                          type="button"
                          disabled={isDisconnecting}
                          onClick={async (e) => {
                            e.stopPropagation();
                            setDisconnectingId(acc.id);
                            const forced = await disconnectTelegramAccount(acc.id, acc.phone, true);
                            setDisconnectingId(null);
                            if (forced.ok) {
                              setConfirmingDeleteId(null);
                              setDisconnectError(null);
                              onDeleteAccount?.(acc.id);
                              showToast(`已移除本地账号 ${acc.name}`);
                            }
                          }}
                          className="text-amber-700 dark:text-amber-300 aurora:text-amber-300 hover:underline shrink-0 cursor-pointer"
                        >
                          仅移除本地
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={() => {
                onOpenAddAccount();
                onClose();
              }}
              className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#e6d9c4] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] text-xs font-medium transition-colors cursor-pointer mt-1 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae]"
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span>添加新账号 / 扫码登录 ({accounts.length}/20)</span>
            </button>
          </div>
        )}

        {/* 2. Standard Telegram Menu Items List */}
        <div className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-0.5 text-sm font-medium">
          {/* 新建群组 */}
          <button
            onClick={() => {
              if (onOpenNewGroup) onOpenNewGroup();
              else showToast('请在主界面创建群组');
              onClose();
            }}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#2b2118] hover:text-[#2481cc] dark:hover:text-[#eef4fb] aurora:hover:text-[#5eead4] linen:hover:text-[#8c522d] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#eae0cf] transition-colors cursor-pointer w-full text-left"
          >
            <Users className="w-5 h-5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957]" />
            <span>新建群组</span>
          </button>

          {/* 新建频道 */}
          <button
            onClick={() => {
              if (onOpenNewChannel) onOpenNewChannel();
              else showToast('请在主界面创建频道');
              onClose();
            }}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#2b2118] hover:text-[#2481cc] dark:hover:text-[#eef4fb] aurora:hover:text-[#5eead4] linen:hover:text-[#8c522d] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#eae0cf] transition-colors cursor-pointer w-full text-left"
          >
            <Megaphone className="w-5 h-5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957]" />
            <span>新建频道</span>
          </button>

          {/* 联系人 */}
          <button
            onClick={() => {
              if (onOpenContacts) onOpenContacts();
              else showToast('联系人列表已更新同步');
              onClose();
            }}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#2b2118] hover:text-[#2481cc] dark:hover:text-[#eef4fb] aurora:hover:text-[#5eead4] linen:hover:text-[#8c522d] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#eae0cf] transition-colors cursor-pointer w-full text-left"
          >
            <User className="w-5 h-5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957]" />
            <span>联系人</span>
          </button>

          {/* 收藏夹 (Saved Messages) */}
          <button
            onClick={() => {
              if (onSelectChat) onSelectChat('chat_saved_messages');
              onClose();
            }}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#2b2118] hover:text-[#2481cc] dark:hover:text-[#eef4fb] aurora:hover:text-[#5eead4] linen:hover:text-[#8c522d] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#eae0cf] transition-colors cursor-pointer w-full text-left"
          >
            <Bookmark className="w-5 h-5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957]" />
            <span>收藏夹 (Saved Messages)</span>
          </button>

          {/* 电报偏好设置 */}
          <button
            onClick={() => {
              if (onOpenTelegramSettings) {
                onOpenTelegramSettings();
              }
              onClose();
            }}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#2b2118] hover:text-[#2481cc] dark:hover:text-[#eef4fb] aurora:hover:text-[#5eead4] linen:hover:text-[#8c522d] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#eae0cf] transition-colors cursor-pointer w-full text-left"
          >
            <Settings className="w-5 h-5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#7a6957] shrink-0" />
            <span>电报偏好设置</span>
          </button>

          {/* 当前会员账号信息 */}
          {currentMember && (
            <div className="px-3 py-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd3bf] mt-1 text-[11px] flex items-center justify-between gap-2 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
              <span className="truncate font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                {currentMember.username} · {currentMember.plan === 'trial_3d' ? '试用版' : currentMember.plan === 'monthly_30d' ? '包月版' : 'VIP'}
                {currentMember.vipExpiresAt ? ` · ${new Date(currentMember.vipExpiresAt).toLocaleDateString()}到期` : ''}
              </span>
              <span className="font-mono tabular-nums text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] shrink-0">
                {accounts.length}/20
              </span>
            </div>
          )}

          {/* 退出登录 */}
          {onMemberLogout && (
            confirmingMemberLogout ? (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2">
                <p className="text-[11px] text-rose-700 dark:text-rose-300 aurora:text-rose-300 leading-relaxed">
                  确认退出登录？将同时注销已连接的 Telegram 云端会话并清空本机缓存。
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingMemberLogout(false)}
                    className="px-2.5 py-1 rounded-lg bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] linen:bg-[#e5d9c6] text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingMemberLogout(false);
                      onMemberLogout();
                      onClose();
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-medium cursor-pointer"
                  >
                    确认退出并注销
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingMemberLogout(true)}
                className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-rose-600 dark:text-rose-400 aurora:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer w-full text-left"
              >
                <LogOut className="w-5 h-5 shrink-0" />
                <span className="truncate">
                  退出登录{currentMember ? ` (${currentMember.username})` : ''}
                </span>
              </button>
            )
          )}

          <div className="h-px bg-[#e2e8f0] dark:bg-[#18273a] aurora:bg-[#182b34] linen:bg-[#dfd3bf] my-2 mx-1" />

          {/* 3. 外观色调模式切换 (亮白 / 夜间 / 青夜 / 羊皮) */}
          <div className="px-3 py-2.5 rounded-xl text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {theme === 'linen' ? (
                  <Sparkles className="w-5 h-5 text-[#a86a43]" />
                ) : theme === 'aurora' ? (
                  <Sparkles className="w-5 h-5 text-[#2dd4bf]" />
                ) : theme === 'dark' ? (
                  <Moon className="w-5 h-5 text-[#2ba0ff]" />
                ) : (
                  <Sun className="w-5 h-5 text-amber-600" />
                )}
                <span className="font-medium">界面色调模式</span>
              </div>
              <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                {theme === 'linen' ? '羊皮' : theme === 'aurora' ? '青夜' : theme === 'dark' ? '夜间' : '亮白'}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#e7dccb] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#cbbba2]">
              {(
                [
                  { id: 'light', label: '亮白' },
                  { id: 'dark', label: '夜间' },
                  { id: 'aurora', label: '青夜' },
                  { id: 'linen', label: '羊皮' },
                ] as const
              ).map((opt) => {
                const active = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      if (onSelectTheme) {
                        onSelectTheme(opt.id);
                      } else {
                        onToggleTheme();
                      }
                    }}
                    className={`py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                      active
                        ? opt.id === 'linen'
                          ? 'bg-[#a86a43] text-white shadow-xs'
                          : opt.id === 'aurora'
                          ? 'bg-[#112d36] text-[#5eead4] border border-[#2dd4bf]/45 shadow-xs'
                          : opt.id === 'dark'
                          ? 'bg-[#2ba0ff] text-white shadow-xs'
                          : 'bg-white text-[#2481cc] border border-[#bfdbfe] shadow-xs'
                        : 'text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Toast Popup */}
        {toastMessage && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 bg-[#0f172a]/95 dark:bg-[#132234]/95 aurora:bg-[#102630]/95 linen:bg-[#4e3f32]/95 text-white text-xs font-semibold rounded-xl shadow-xl border border-white/15 aurora:border-[#2dd4bf]/30 linen:border-[#cbbba2]/35 animate-in fade-in zoom-in-95 duration-150 whitespace-nowrap">
            {toastMessage}
          </div>
        )}

        {/* 4. Drawer Footer */}
        <div className="p-3 bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#ece2d1] border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] flex items-center justify-between gap-2 text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
          <div className="flex items-center gap-1.5 min-w-0">
            <img src="/app-icon.png" alt="HumanSense" className="w-4 h-4 rounded-sm object-cover shrink-0" />
            <span className="font-medium text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] truncate">v{APP_VERSION}</span>
          </div>
          <button
            type="button"
            disabled={isCheckingUpdate}
            onClick={async () => {
              if (isCheckingUpdate) return;
              setIsCheckingUpdate(true);
              showToast('正在检查更新...');
              try {
                const res = await checkAppUpdateApi();
                if (!res.ok) {
                  showToast(res.error || '检查更新失败');
                } else if (res.hasUpdate) {
                  showToast(`发现新版本 v${res.latestVersion}`);
                  onUpdateAvailable?.(res);
                  onClose();
                } else {
                  showToast(`已是最新版本 (v${res.currentVersion || APP_VERSION})`);
                }
              } catch (err: any) {
                showToast('检查更新出错: ' + (err?.message || '未知错误'));
              } finally {
                setIsCheckingUpdate(false);
              }
            }}
            className="px-2 py-1 rounded-md bg-[#2ba0ff]/10 hover:bg-[#2ba0ff]/25 linen:bg-[#a86a43]/15 linen:hover:bg-[#a86a43]/25 disabled:opacity-50 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] font-medium transition-colors cursor-pointer shrink-0"
            title="检查软件更新"
          >
            {isCheckingUpdate ? '检查中...' : '检查更新'}
          </button>
        </div>
      </div>
    </div>
  );
};
