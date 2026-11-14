import React, { useState } from 'react';
import {
  Users,
  Megaphone,
  User,
  PhoneCall,
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
} from 'lucide-react';
import { Account, MemberUser } from '../types';
import { disconnectTelegramAccount } from '../services/apiService';

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
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenNewGroup?: () => void;
  onOpenNewChannel?: () => void;
  onOpenContacts?: () => void;
  onOpenCalls?: () => void;
  onOpenTelegramSettings?: () => void;
  onOpenKnowledgeEvolution?: () => void;
  currentMember?: MemberUser | null;
  onMemberLogout?: () => void;
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
  onOpenNewGroup,
  onOpenNewChannel,
  onOpenContacts,
  onOpenCalls,
  onOpenTelegramSettings,
  currentMember,
  onMemberLogout,
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
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
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
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity cursor-pointer"
        onClick={onClose}
      />

      {/* Slide-out Drawer from Left */}
      <div className="relative w-72 sm:w-80 h-full bg-white text-[#111827] dark:bg-[#17212b] dark:text-[#f5f7fa] flex flex-col shadow-2xl z-10 animate-in slide-in-from-left duration-250 select-none border-r border-[#e0e4e8] dark:border-[#0e1621] transition-colors">
        {/* 1. Profile Header */}
        <div className="p-4 bg-[#2481cc] text-white flex flex-col justify-between shrink-0 relative overflow-hidden">
          <div className="flex items-start justify-between mb-3">
            <div className="relative">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shadow-md border-2 border-white/20 overflow-hidden"
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
                  className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${
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
              className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
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
          <div className="bg-[#f0f3f6] dark:bg-[#1e2c3a] border-b border-[#e2e6eb] dark:border-[#24374a] p-2 flex flex-col gap-1 max-h-48 overflow-y-auto no-scrollbar animate-in slide-in-from-top-2 duration-150">
            {accounts.map((acc) => {
              const isConfirming = confirmingDeleteId === acc.id;
              const isDisconnecting = disconnectingId === acc.id;
              const accError = disconnectError?.accountId === acc.id ? disconnectError : null;
              return (
                <div
                  key={acc.id}
                  className={`flex flex-col p-2 rounded-xl text-left transition-colors ${
                    acc.id === safeAccount.id
                      ? 'bg-[#2481cc]/15 dark:bg-[#2481cc]/25 text-[#2481cc] dark:text-[#2ba0ff]'
                      : 'hover:bg-black/5 dark:hover:bg-[#253748] text-[#222222] dark:text-white/90'
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
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#f0f3f6] dark:border-[#1e2c3a] ${
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
                            <span className="text-[10px] text-rose-500 font-normal shrink-0">已失效</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#707579] dark:text-white/60 truncate">{acc.phone || acc.username}</div>
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
                          className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 dark:text-rose-300 hover:bg-rose-500/25 text-[10px] font-medium cursor-pointer"
                        >
                          重新登录
                        </button>
                      )}
                      {!isConfirming && acc.id === safeAccount.id && (
                        <Check className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff]" />
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
                            className="px-2 py-0.5 rounded bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-[10px] font-medium cursor-pointer"
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
                            className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[10px] cursor-pointer"
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
                          className="p-1 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                          title="断开直连并退出该账号"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {accError && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-rose-500 dark:text-rose-300 bg-rose-500/10 rounded-lg px-2 py-1">
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
                          className="text-amber-600 dark:text-amber-300 hover:underline shrink-0 cursor-pointer"
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
              className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-black/5 dark:hover:bg-[#253748] text-[#2481cc] dark:text-[#2ba0ff] text-xs font-medium transition-colors cursor-pointer mt-1 border-t border-black/5 dark:border-white/5"
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
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#222222] dark:text-[#cfdbe5] hover:text-[#2481cc] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#243444] transition-colors cursor-pointer w-full text-left"
          >
            <Users className="w-5 h-5 text-[#707579] dark:text-[#7f93a5]" />
            <span>新建群组</span>
          </button>

          {/* 新建频道 */}
          <button
            onClick={() => {
              if (onOpenNewChannel) onOpenNewChannel();
              else showToast('请在主界面创建频道');
              onClose();
            }}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#222222] dark:text-[#cfdbe5] hover:text-[#2481cc] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#243444] transition-colors cursor-pointer w-full text-left"
          >
            <Megaphone className="w-5 h-5 text-[#707579] dark:text-[#7f93a5]" />
            <span>新建频道</span>
          </button>

          {/* 联系人 */}
          <button
            onClick={() => {
              if (onOpenContacts) onOpenContacts();
              else showToast('联系人列表已更新同步');
              onClose();
            }}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#222222] dark:text-[#cfdbe5] hover:text-[#2481cc] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#243444] transition-colors cursor-pointer w-full text-left"
          >
            <User className="w-5 h-5 text-[#707579] dark:text-[#7f93a5]" />
            <span>联系人</span>
          </button>

          {/* 通话 */}
          <button
            onClick={() => {
              if (onOpenCalls) onOpenCalls();
              else showToast('暂无未接来电');
              onClose();
            }}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#222222] dark:text-[#cfdbe5] hover:text-[#2481cc] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#243444] transition-colors cursor-pointer w-full text-left"
          >
            <PhoneCall className="w-5 h-5 text-[#707579] dark:text-[#7f93a5]" />
            <span>通话记录</span>
          </button>

          {/* 收藏夹 (Saved Messages) */}
          <button
            onClick={() => {
              if (onSelectChat) onSelectChat('chat_saved_messages');
              onClose();
            }}
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#222222] dark:text-[#cfdbe5] hover:text-[#2481cc] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#243444] transition-colors cursor-pointer w-full text-left"
          >
            <Bookmark className="w-5 h-5 text-[#707579] dark:text-[#7f93a5]" />
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
            className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-[#222222] dark:text-[#cfdbe5] hover:text-[#2481cc] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#243444] transition-colors cursor-pointer w-full text-left"
          >
            <Settings className="w-5 h-5 text-[#707579] dark:text-[#7f93a5] shrink-0" />
            <span>电报偏好设置</span>
          </button>

          {/* 当前会员账号信息 */}
          {currentMember && (
            <div className="px-3 py-2 border-t border-[#e0e4e8] dark:border-[#202e3d] mt-1 text-[11px] flex items-center justify-between gap-2 text-[#707579] dark:text-[#7f93a5]">
              <span className="truncate font-medium text-[#111827] dark:text-white/90">
                {currentMember.username} · {currentMember.plan === 'trial_3d' ? '试用版' : currentMember.plan === 'monthly_30d' ? '包月版' : 'VIP'}
                {currentMember.vipExpiresAt ? ` · ${new Date(currentMember.vipExpiresAt).toLocaleDateString()}到期` : ''}
              </span>
              <span className="font-mono tabular-nums text-[#2481cc] dark:text-[#2ba0ff] shrink-0">
                {accounts.length}/20
              </span>
            </div>
          )}

          {/* 退出登录 */}
          {onMemberLogout && (
            <button
              onClick={() => {
                onMemberLogout();
                onClose();
              }}
              className="flex items-center gap-4 px-3 py-2.5 rounded-xl text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer w-full text-left"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              <span className="truncate">
                退出登录{currentMember ? ` (${currentMember.username})` : ''}
              </span>
            </button>
          )}

          <div className="h-px bg-[#e0e4e8] dark:bg-[#202e3d] my-2 mx-1" />

          {/* 3. 夜间模式与白天模式切换 (Night Mode Switch) */}
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl text-[#222222] dark:text-[#cfdbe5] hover:bg-black/5 dark:hover:bg-[#243444] transition-colors">
            <div className="flex items-center gap-4">
              {theme === 'dark' ? (
                <Moon className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff]" />
              ) : (
                <Sun className="w-5 h-5 text-amber-500" />
              )}
              <span className="font-medium">夜间模式</span>
            </div>

            {/* Telegram Toggle Switch */}
            <button
              onClick={onToggleTheme}
              role="switch"
              aria-checked={theme === 'dark'}
              title={theme === 'dark' ? '切换为白天模式' : '切换为夜间模式'}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer focus:outline-none ${
                theme === 'dark' ? 'bg-[#2481cc]' : 'bg-[#c4c9cc]'
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                  theme === 'dark' ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Toast Popup */}
        {toastMessage && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-900/90 text-white text-xs font-semibold rounded-xl shadow-xl border border-white/10 animate-in fade-in zoom-in-95 duration-150 whitespace-nowrap">
            {toastMessage}
          </div>
        )}

        {/* 4. Drawer Footer */}
        <div className="p-3 border-t border-[#e0e4e8] dark:border-[#1e2c3a] flex items-center justify-center gap-2 text-[11px] text-[#707579] dark:text-[#637587]">
          <img src="/app-icon.png" alt="HumanSense" className="w-4 h-4 rounded-sm object-cover" />
          <span className="font-medium text-[#546778] dark:text-[#8ea4ba]">HumanSense Desktop</span>
          <span className="font-bold">·</span>
          <span>v2.5.0</span>
        </div>
      </div>
    </div>
  );
};
