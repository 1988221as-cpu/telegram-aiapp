import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  UserPlus,
  MessageSquare,
  User,
  RefreshCw,
  AlertCircle,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  Globe,
  Check,
  Edit3,
} from 'lucide-react';
import { TelegramContact } from '../types';
import {
  fetchTelegramUserContactsApi,
  addTelegramUserContactApi,
  deleteTelegramUserContactApi,
  blockTelegramUserContactApi,
  unblockTelegramUserContactApi,
  fetchTelegramBlockedContactsApi,
  searchTelegramGlobalContactsApi,
} from '../services/apiService';

interface TelegramContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
  contacts: TelegramContact[];
  currentAccountId?: string;
  onAddContact: (contact: TelegramContact) => void;
  onSyncContacts?: (cloudContacts: TelegramContact[]) => void;
  onRemoveContact?: (contactId: string) => void;
  onBlockStatusChanged?: (contactId: string, isBlocked: boolean) => void;
  onRenameContact?: (contactId: string, newTitle: string) => Promise<{ ok: boolean; error?: string }>;
  onStartChatWithContact: (contact: TelegramContact) => void;
}

function normalizePhoneSearch(raw?: string): string {
  return String(raw || '').replace(/[\s\-\(\)\.+]/g, '').toLowerCase();
}

export const TelegramContactsModal: React.FC<TelegramContactsModalProps> = ({
  isOpen,
  onClose,
  contacts,
  currentAccountId,
  onAddContact,
  onSyncContacts,
  onRemoveContact,
  onBlockStatusChanged,
  onRenameContact,
  onStartChatWithContact,
}) => {
  const [activeTab, setActiveTab] = useState<'contacts' | 'blocked'>('contacts');
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // Inline confirmation state (replaces native window.confirm for Electron/desktop compatibility)
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: 'delete' | 'block' | 'unblock' } | null>(null);
  const [busyContactId, setBusyContactId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingRemark, setEditingRemark] = useState('');
  const [isSavingRemark, setIsSavingRemark] = useState(false);

  // Blocked users list (real contacts.GetBlocked)
  const [blockedUsers, setBlockedUsers] = useState<TelegramContact[]>([]);
  const [isLoadingBlocked, setIsLoadingBlocked] = useState(false);

  // Global cloud user search (real contacts.Search + contacts.ResolvePhone)
  const [globalResults, setGlobalResults] = useState<TelegramContact[]>([]);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);
  const [hasSearchedGlobal, setHasSearchedGlobal] = useState(false);
  const [addingGlobalId, setAddingGlobalId] = useState<string | null>(null);

  const isBotAccount = currentAccountId === 'acc_telegram_bot';
  const canUseMtprotoContacts = Boolean(currentAccountId && currentAccountId.startsWith('acc_tg_'));

  const handleSyncCloudContacts = async () => {
    if (!currentAccountId || isBotAccount) return;
    setIsSyncing(true);
    setErrorMsg('');
    try {
      const res = await fetchTelegramUserContactsApi(currentAccountId);
      if (res.ok && Array.isArray(res.contacts)) {
        onSyncContacts?.(res.contacts);
      } else if (res.error) {
        setErrorMsg(res.error);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLoadBlockedUsers = async () => {
    if (!currentAccountId || isBotAccount) return;
    setIsLoadingBlocked(true);
    try {
      const res = await fetchTelegramBlockedContactsApi(currentAccountId);
      if (res.ok && Array.isArray(res.blocked)) {
        setBlockedUsers(res.blocked);
      } else if (activeTab === 'blocked' && res.error) {
        setErrorMsg(res.error);
      }
    } finally {
      setIsLoadingBlocked(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    setStatusMsg('');
    setConfirmAction(null);
    setEditingContactId(null);
    setGlobalResults([]);
    setHasSearchedGlobal(false);
    if (currentAccountId && !isBotAccount) {
      void handleSyncCloudContacts();
      void handleLoadBlockedUsers();
    } else {
      setBlockedUsers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentAccountId]);

  // Keep modal Blacklist tab in sync when contacts block status changes elsewhere (e.g. raw event or drawer)
  const blockedIdsFingerprint = contacts
    .filter((c) => c.isBlocked)
    .map((c) => c.id)
    .sort()
    .join(',');

  useEffect(() => {
    if (!isOpen || !currentAccountId || isBotAccount) return;
    if (activeTab === 'blocked') {
      void handleLoadBlockedUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedIdsFingerprint, activeTab]);

  if (!isOpen) return null;

  const trimmedQuery = search.trim();
  const qLower = trimmedQuery.toLowerCase();
  const qDigits = normalizePhoneSearch(trimmedQuery);

  const filteredContacts = contacts.filter((c) => {
    if (!qLower) return true;
    const matchName = c.name.toLowerCase().includes(qLower);
    const matchUsername = Boolean(c.username && c.username.toLowerCase().includes(qLower));
    const matchPhoneRaw = Boolean(c.phone && c.phone.toLowerCase().includes(qLower));
    const matchPhoneNorm = Boolean(qDigits && c.phone && normalizePhoneSearch(c.phone).includes(qDigits));
    return matchName || matchUsername || matchPhoneRaw || matchPhoneNorm;
  });

  const filteredBlocked = blockedUsers.filter((c) => {
    if (!qLower) return true;
    const matchName = c.name.toLowerCase().includes(qLower);
    const matchUsername = Boolean(c.username && c.username.toLowerCase().includes(qLower));
    const matchPhoneRaw = Boolean(c.phone && c.phone.toLowerCase().includes(qLower));
    const matchPhoneNorm = Boolean(qDigits && c.phone && normalizePhoneSearch(c.phone).includes(qDigits));
    return matchName || matchUsername || matchPhoneRaw || matchPhoneNorm;
  });

  const handleSearchGlobal = async () => {
    if (!trimmedQuery || !canUseMtprotoContacts || isSearchingGlobal) return;
    setIsSearchingGlobal(true);
    setErrorMsg('');
    try {
      const res = await searchTelegramGlobalContactsApi(trimmedQuery, currentAccountId);
      setHasSearchedGlobal(true);
      if (!res.ok) {
        setErrorMsg(res.error || 'Telegram 全网用户搜索失败');
        setGlobalResults([]);
        return;
      }
      const existingIds = new Set(contacts.map((c) => c.id));
      setGlobalResults((res.contacts || []).filter((u) => !existingIds.has(u.id)));
    } finally {
      setIsSearchingGlobal(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || isSaving) return;
    const rawPhone = newPhone.trim();
    const rawUsername = newUsername.trim();
    if (!rawPhone && !rawUsername) {
      setErrorMsg('同步至 Telegram 云端通讯录需要填写手机号或 @用户名');
      return;
    }
    if (rawPhone) {
      const compactPhone = rawPhone.replace(/[\s\-\(\)\.]/g, '');
      if (!/^(\+|00)\d{6,15}$/.test(compactPhone)) {
        setErrorMsg('手机号需包含国际区号（例如 +8613800000000）');
        return;
      }
    }

    setIsSaving(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await addTelegramUserContactApi({
        accountId: currentAccountId,
        name: newName.trim(),
        phone: rawPhone || undefined,
        username: rawUsername || undefined,
      });

      if (!res.ok || !res.contact) {
        setErrorMsg(res.error || '添加联系人至 Telegram 云端失败');
        return;
      }

      onAddContact(res.contact);
      setIsAdding(false);
      setNewName('');
      setNewPhone('');
      setNewUsername('');
      setStatusMsg(`已将「${res.contact.name}」同步至 Telegram 云端通讯录`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddGlobalContact = async (user: TelegramContact) => {
    if ((!user.username && !user.phone) || addingGlobalId) return;
    setAddingGlobalId(user.id);
    setErrorMsg('');
    try {
      const res = await addTelegramUserContactApi({
        accountId: currentAccountId,
        name: user.name,
        ...(user.phone ? { phone: user.phone } : {}),
        ...(user.username ? { username: user.username } : {}),
      });
      if (!res.ok || !res.contact) {
        setErrorMsg(res.error || '添加为好友失败');
        return;
      }
      onAddContact(res.contact);
      setGlobalResults((prev) => prev.filter((item) => item.id !== user.id));
      setStatusMsg(`已将「${res.contact.name}」加为云端联系人`);
    } finally {
      setAddingGlobalId(null);
    }
  };

  const handleSaveRemark = async (contact: TelegramContact) => {
    const trimmed = editingRemark.trim();
    if (!trimmed || !onRenameContact || isSavingRemark) return;
    setIsSavingRemark(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await onRenameContact(contact.id, trimmed);
      if (!res.ok) {
        setErrorMsg(res.error || '修改联系人备注失败');
        return;
      }
      setEditingContactId(null);
      setStatusMsg(`已更新「${trimmed}」的云端备注名`);
    } finally {
      setIsSavingRemark(false);
    }
  };

  const executeDeleteContact = async (contact: TelegramContact) => {
    if (busyContactId) return;
    setBusyContactId(contact.id);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await deleteTelegramUserContactApi({
        accountId: currentAccountId,
        chatId: contact.id,
      });
      if (res.ok) {
        setConfirmAction(null);
        onRemoveContact?.(contact.id);
        setStatusMsg(`已从 Telegram 云端及本地通讯录删除「${contact.name}」`);
        await handleSyncCloudContacts();
      } else {
        setErrorMsg(res.error || '删除联系人失败');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '删除联系人网络异常');
    } finally {
      setBusyContactId(null);
    }
  };

  const executeBlockContact = async (contact: TelegramContact) => {
    if (busyContactId) return;
    setBusyContactId(contact.id);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await blockTelegramUserContactApi({
        accountId: currentAccountId,
        chatId: contact.id,
      });
      if (res.ok) {
        setConfirmAction(null);
        onBlockStatusChanged?.(contact.id, true);
        setStatusMsg(`已将「${contact.name}」加入 Telegram 黑名单`);
        await Promise.all([handleSyncCloudContacts(), handleLoadBlockedUsers()]);
      } else {
        setErrorMsg(res.error || '拉黑用户失败');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '拉黑用户网络异常');
    } finally {
      setBusyContactId(null);
    }
  };

  const executeUnblockContact = async (contact: TelegramContact) => {
    if (busyContactId) return;
    setBusyContactId(contact.id);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await unblockTelegramUserContactApi({
        accountId: currentAccountId,
        chatId: contact.id,
      });
      if (res.ok) {
        setConfirmAction(null);
        onBlockStatusChanged?.(contact.id, false);
        setBlockedUsers((prev) => prev.filter((u) => u.id !== contact.id));
        setStatusMsg(`已将「${contact.name}」移出 Telegram 黑名单`);
        await handleSyncCloudContacts();
      } else {
        setErrorMsg(res.error || '解除拉黑失败');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '解除拉黑网络异常');
    } finally {
      setBusyContactId(null);
    }
  };

  const renderAvatar = (contact: TelegramContact) => (
    <div className="relative shrink-0">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-xs overflow-hidden relative"
        style={{ backgroundColor: contact.avatarBg || '#2481cc' }}
      >
        <span className="select-none">{contact.avatarInitial || contact.name.slice(0, 2)}</span>
        {contact.avatarUrl && (
          <img
            src={contact.avatarUrl}
            alt={contact.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover absolute inset-0"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        )}
      </div>
      {contact.status === 'online' && !contact.isBlocked && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#17212b]" />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-lg bg-white dark:bg-[#17212b] rounded-2xl shadow-2xl border border-[#e0e4e8] dark:border-[#202b36] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e0e4e8] dark:border-[#202b36]">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff]" />
            <h3 className="text-base font-semibold text-[#111827] dark:text-[#f5f7fa]">
              好友与联系人管理
            </h3>
          </div>
          <div className="flex items-center gap-1">
            {canUseMtprotoContacts && (
              <button
                type="button"
                onClick={() => {
                  void handleSyncCloudContacts();
                  void handleLoadBlockedUsers();
                }}
                disabled={isSyncing || isLoadingBlocked}
                className="p-1.5 rounded-lg text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#202b36] cursor-pointer"
                title="从 Telegram 云端刷新通讯录与黑名单"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing || isLoadingBlocked ? 'animate-spin text-[#2ba0ff]' : ''}`} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#707579] hover:text-[#111827] dark:text-[#7f93a5] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#202b36] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub-Tabs: Contacts vs Blacklist */}
        <div className="px-4 pt-2 border-b border-[#e0e4e8] dark:border-[#202b36] flex items-center gap-4 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setActiveTab('contacts');
              setConfirmAction(null);
            }}
            className={`pb-2.5 border-b-2 transition-colors cursor-pointer tabular-nums ${
              activeTab === 'contacts'
                ? 'border-[#2481cc] text-[#2481cc] dark:text-[#2ba0ff] font-semibold'
                : 'border-transparent text-[#707579] dark:text-[#7f93a5] hover:text-[#111827] dark:hover:text-white'
            }`}
          >
            全部联系人 ({contacts.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('blocked');
              setConfirmAction(null);
              if (canUseMtprotoContacts) void handleLoadBlockedUsers();
            }}
            className={`pb-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 tabular-nums ${
              activeTab === 'blocked'
                ? 'border-amber-500 text-amber-600 dark:text-amber-400 font-semibold'
                : 'border-transparent text-[#707579] dark:text-[#7f93a5] hover:text-[#111827] dark:hover:text-white'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>黑名单 ({blockedUsers.length})</span>
          </button>
        </div>

        {/* Search & Add New Toggle */}
        <div className="p-3 border-b border-[#e0e4e8] dark:border-[#202b36] flex items-center gap-2">
          <div className="relative flex-1 flex items-center">
            <Search className="w-4 h-4 text-[#707579] dark:text-[#7f93a5] absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (hasSearchedGlobal) {
                  setHasSearchedGlobal(false);
                  setGlobalResults([]);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && activeTab === 'contacts' && trimmedQuery && canUseMtprotoContacts) {
                  e.preventDefault();
                  void handleSearchGlobal();
                }
              }}
              placeholder={
                activeTab === 'contacts'
                  ? '搜索姓名、+区号手机号或 @用户名 (Enter 搜全网用户)...'
                  : '筛选黑名单用户...'
              }
              className="w-full bg-[#f0f2f5] dark:bg-[#242f3d] text-xs pl-9 pr-3 py-2 rounded-xl text-[#111827] dark:text-white border border-transparent focus:border-[#2ba0ff]/50 focus:outline-none"
            />
          </div>
          {activeTab === 'contacts' && trimmedQuery && canUseMtprotoContacts && (
            <button
              type="button"
              onClick={() => void handleSearchGlobal()}
              disabled={isSearchingGlobal}
              className="px-2.5 py-2 rounded-xl bg-black/5 hover:bg-black/10 dark:bg-[#242f3d] dark:hover:bg-[#2c3b4d] text-[#2481cc] dark:text-[#2ba0ff] text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
              title="调用 Telegram 官方全网用户搜索"
            >
              <Globe className={`w-3.5 h-3.5 ${isSearchingGlobal ? 'animate-spin' : ''}`} />
              <span>搜全网</span>
            </button>
          )}
          {activeTab === 'contacts' && (
            <button
              type="button"
              disabled={isBotAccount}
              onClick={() => {
                setIsAdding(!isAdding);
                setErrorMsg('');
                setStatusMsg('');
              }}
              className="px-3 py-2 rounded-xl bg-[#2481cc] hover:bg-[#2074b8] disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>添加好友</span>
            </button>
          )}
        </div>

        {isBotAccount && (
          <div className="mx-3 mt-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Telegram Bot 机器人账号不支持通讯录与黑名单接口，请切换到个人 Telegram 账号管理联系人。</span>
          </div>
        )}

        {errorMsg && (
          <div className="mx-3 mt-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 dark:text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {statusMsg && (
          <div className="mx-3 mt-3 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* Add Contact Inline Form */}
        {activeTab === 'contacts' && isAdding && (
          <form onSubmit={handleCreate} className="p-4 bg-[#f9fafb] dark:bg-[#1e2a38] border-b border-[#e0e4e8] dark:border-[#243547] space-y-3 animate-in fade-in duration-150">
            <div className="text-xs font-semibold text-[#111827] dark:text-[#f5f7fa]">添加联系人到 Telegram 云端</div>
            <div>
              <label className="block text-[11px] text-[#707579] dark:text-[#7f93a5] mb-1">姓名 / 备注名</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如: Alex Turner"
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#17212b] border border-[#d8dde3] dark:border-[#2f4052] text-[#111827] dark:text-white focus:outline-none focus:border-[#2ba0ff]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-[#707579] dark:text-[#7f93a5] mb-1">国际手机号</label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+8613800000000"
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#17212b] border border-[#d8dde3] dark:border-[#2f4052] text-[#111827] dark:text-white focus:outline-none focus:border-[#2ba0ff]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#707579] dark:text-[#7f93a5] mb-1">Telegram 用户名</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="@username"
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#17212b] border border-[#d8dde3] dark:border-[#2f4052] text-[#111827] dark:text-white focus:outline-none focus:border-[#2ba0ff]"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-[#707579] hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/5 cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#2074b8] disabled:opacity-50 text-white text-xs font-medium cursor-pointer flex items-center gap-1"
              >
                {isSaving && <RefreshCw className="w-3 h-3 animate-spin" />}
                <span>{isSaving ? '同步云端中...' : '同步保存联系人'}</span>
              </button>
            </div>
          </form>
        )}

        {/* List Content */}
        <div className="flex-1 overflow-y-auto divide-y divide-black/5 dark:divide-[#202b36]">
          {activeTab === 'contacts' ? (
            <>
              {filteredContacts.length === 0 && !hasSearchedGlobal ? (
                <div className="p-8 text-center text-xs text-[#707579] dark:text-[#7f93a5] space-y-2">
                  <div>
                    {contacts.length === 0
                      ? '暂无联系人，请先点击上方「添加好友」或右上角刷新云端通讯录'
                      : '本地通讯录未匹配到联系人'}
                  </div>
                  {trimmedQuery && canUseMtprotoContacts && (
                    <button
                      type="button"
                      onClick={() => void handleSearchGlobal()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2481cc]/15 text-[#2481cc] dark:text-[#2ba0ff] font-medium cursor-pointer hover:bg-[#2481cc]/25"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>在 Telegram 全网搜索「{trimmedQuery}」</span>
                    </button>
                  )}
                </div>
              ) : (
                filteredContacts.map((contact) => {
                  const isConfirmingThis = confirmAction?.id === contact.id;
                  const isBusyThis = busyContactId === contact.id;
                  const isEditingThis = editingContactId === contact.id;
                  const statusLabel = contact.statusText || (contact.status === 'online' ? '在线' : '离线');
                  const identityParts = [contact.username, contact.phone].filter(Boolean);

                  return (
                    <div
                      key={contact.id}
                      className="flex items-center justify-between p-3.5 hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors gap-2"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {renderAvatar(contact)}
                        <div className="min-w-0 flex-1">
                          {isEditingThis ? (
                            <div className="flex items-center gap-1.5 mb-1">
                              <input
                                type="text"
                                value={editingRemark}
                                onChange={(e) => setEditingRemark(e.target.value)}
                                disabled={isSavingRemark}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleSaveRemark(contact);
                                  } else if (e.key === 'Escape') {
                                    setEditingContactId(null);
                                  }
                                }}
                                className="flex-1 min-w-0 px-2 py-0.5 text-xs rounded-md bg-white dark:bg-[#17212b] border border-[#2481cc] text-[#111827] dark:text-white focus:outline-none"
                              />
                              <button
                                type="button"
                                disabled={isSavingRemark}
                                onClick={() => void handleSaveRemark(contact)}
                                className="p-1 rounded bg-[#2481cc] text-white hover:bg-[#1e6cb0] cursor-pointer disabled:opacity-50"
                                title="保存备注"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={isSavingRemark}
                                onClick={() => setEditingContactId(null)}
                                className="p-1 rounded bg-black/5 dark:bg-white/10 text-[#707579] dark:text-gray-300 cursor-pointer"
                                title="取消"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-xs text-[#111827] dark:text-[#f5f7fa] truncate">
                                {contact.name}
                              </span>
                              {contact.isBlocked && (
                                <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 text-[10px] font-medium shrink-0">
                                  已拉黑
                                </span>
                              )}
                            </div>
                          )}
                          {identityParts.length > 0 && (
                            <div className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] truncate">
                              {identityParts.join(' · ')}
                            </div>
                          )}
                          <div
                            className={`text-[10.5px] truncate ${
                              contact.status === 'online' && !contact.isBlocked
                                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                : 'text-[#707579] dark:text-[#7f93a5]'
                            }`}
                          >
                            {statusLabel}
                          </div>
                        </div>
                      </div>

                      {isConfirmingThis ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] text-[#707579] dark:text-[#9eb1c2]">
                            {confirmAction?.type === 'delete'
                              ? '彻底删除?'
                              : confirmAction?.type === 'block'
                              ? '确认拉黑?'
                              : '解除拉黑?'}
                          </span>
                          <button
                            type="button"
                            disabled={isBusyThis}
                            onClick={() => {
                              if (confirmAction?.type === 'delete') void executeDeleteContact(contact);
                              else if (confirmAction?.type === 'block') void executeBlockContact(contact);
                              else void executeUnblockContact(contact);
                            }}
                            className={`px-2 py-1 rounded-lg text-[11px] font-medium text-white cursor-pointer disabled:opacity-50 ${
                              confirmAction?.type === 'unblock'
                                ? 'bg-emerald-600 hover:bg-emerald-700'
                                : 'bg-red-500 hover:bg-red-600'
                            }`}
                          >
                            {isBusyThis ? '处理中' : '确认'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusyThis}
                            onClick={() => setConfirmAction(null)}
                            className="px-2 py-1 rounded-lg text-[11px] bg-black/5 dark:bg-white/10 text-[#707579] dark:text-gray-300 cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onStartChatWithContact(contact);
                              onClose();
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-[#2481cc]/15 hover:bg-[#2481cc] text-[#2481cc] hover:text-white dark:text-[#2ba0ff] dark:hover:text-white transition-all text-xs font-medium flex items-center gap-1 cursor-pointer"
                            title="发消息"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>发消息</span>
                          </button>
                          {onRenameContact && canUseMtprotoContacts && (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmAction(null);
                                setEditingContactId(contact.id);
                                setEditingRemark(contact.name);
                              }}
                              className="p-1.5 rounded-xl text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-[#2ba0ff] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                              title="修改联系人备注"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {contact.isBlocked ? (
                            <button
                              type="button"
                              onClick={() => setConfirmAction({ id: contact.id, type: 'unblock' })}
                              className="p-1.5 rounded-xl text-emerald-500 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                              title="解除拉黑"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmAction({ id: contact.id, type: 'block' })}
                              className="p-1.5 rounded-xl text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
                              title="加入黑名单 / 拉黑"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ id: contact.id, type: 'delete' })}
                            className="p-1.5 rounded-xl text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="从云端彻底删除联系人"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* Global Telegram Search Results Section */}
              {hasSearchedGlobal && (
                <div className="bg-[#f8fafc] dark:bg-[#121b24]">
                  <div className="px-3.5 py-2 text-[11px] font-semibold text-[#707579] dark:text-[#7f93a5] flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-[#2481cc]" />
                    <span>Telegram 全网搜索结果 ({globalResults.length})</span>
                  </div>
                  {globalResults.length === 0 ? (
                    <div className="px-4 py-4 text-center text-[11px] text-[#707579] dark:text-[#7f93a5]">
                      未在 Telegram 全网找到新的匹配用户
                    </div>
                  ) : (
                    globalResults.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between px-3.5 py-3 hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors gap-2 border-t border-black/5 dark:border-[#202b36]"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {renderAvatar(u)}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-xs text-[#111827] dark:text-[#f5f7fa] truncate">
                                {u.name}
                              </span>
                              {u.isBlocked && (
                                <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 text-[10px] font-medium shrink-0">
                                  已拉黑
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] truncate">
                              {[u.username, u.phone].filter(Boolean).join(' · ') || u.statusText || 'Telegram 用户'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {(u.username || u.phone) && (
                            <button
                              type="button"
                              disabled={addingGlobalId === u.id}
                              onClick={() => void handleAddGlobalContact(u)}
                              className="px-2.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-600 text-emerald-600 dark:text-emerald-400 hover:text-white text-xs font-medium cursor-pointer disabled:opacity-50 flex items-center gap-1"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>{addingGlobalId === u.id ? '添加中' : '加好友'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              onStartChatWithContact(u);
                              onClose();
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-[#2481cc]/15 hover:bg-[#2481cc] text-[#2481cc] hover:text-white dark:text-[#2ba0ff] text-xs font-medium cursor-pointer flex items-center gap-1"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>私聊</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            /* Blacklist Tab */
            <>
              {isLoadingBlocked && blockedUsers.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#707579] dark:text-[#7f93a5] flex flex-col items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#2481cc]" />
                  <span>正在从 Telegram 云端同步黑名单...</span>
                </div>
              ) : filteredBlocked.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#707579] dark:text-[#7f93a5]">
                  {blockedUsers.length === 0 ? '当前黑名单为空' : '未匹配到已拉黑用户'}
                </div>
              ) : (
                filteredBlocked.map((u) => {
                  const isBusyThis = busyContactId === u.id;
                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-3.5 hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors gap-2"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {renderAvatar(u)}
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-[#111827] dark:text-[#f5f7fa] truncate">
                            {u.name}
                          </div>
                          <div className="text-[11px] text-[#707579] dark:text-[#7f93a5] truncate">
                            {[u.username, u.phone].filter(Boolean).join(' · ') || '已拉黑用户'}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isBusyThis}
                        onClick={() => void executeUnblockContact(u)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-600 text-emerald-600 dark:text-emerald-400 hover:text-white text-xs font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors shrink-0"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>{isBusyThis ? '解除中...' : '解除拉黑'}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
