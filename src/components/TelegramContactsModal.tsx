import React, { useState, useEffect } from 'react';
import { X, Search, UserPlus, MessageSquare, User, RefreshCw, AlertCircle } from 'lucide-react';
import { TelegramContact } from '../types';
import { fetchTelegramUserContactsApi, addTelegramUserContactApi } from '../services/apiService';

interface TelegramContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
  contacts: TelegramContact[];
  currentAccountId?: string;
  onAddContact: (contact: TelegramContact) => void;
  onSyncContacts?: (cloudContacts: TelegramContact[]) => void;
  onStartChatWithContact: (contact: TelegramContact) => void;
}

export const TelegramContactsModal: React.FC<TelegramContactsModalProps> = ({
  isOpen,
  onClose,
  contacts,
  currentAccountId,
  onAddContact,
  onSyncContacts,
  onStartChatWithContact,
}) => {
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSyncCloudContacts = async () => {
    if (!currentAccountId) return;
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

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    if (currentAccountId) {
      handleSyncCloudContacts();
    }
  }, [isOpen, currentAccountId]);

  if (!isOpen) return null;

  const filteredContacts = contacts.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.username && c.username.toLowerCase().includes(q))
    );
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || isSaving) return;
    if (!newPhone.trim() && !newUsername.trim()) {
      setErrorMsg('同步至 Telegram 云端通讯录需要填写手机号或 @用户名');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');
    try {
      const res = await addTelegramUserContactApi({
        accountId: currentAccountId,
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
        username: newUsername.trim() || undefined,
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
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-md bg-white dark:bg-[#17212b] rounded-2xl shadow-2xl border border-[#e0e4e8] dark:border-[#202b36] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e0e4e8] dark:border-[#202b36]">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff]" />
            <h3 className="text-base font-semibold text-[#111827] dark:text-[#f5f7fa] tabular-nums">
              联系人 ({contacts.length})
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleSyncCloudContacts}
              disabled={isSyncing}
              className="p-1.5 rounded-lg text-[#707579] hover:text-[#2481cc] dark:text-[#7f93a5] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#202b36] cursor-pointer"
              title="从 Telegram 云端刷新通讯录"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-[#2ba0ff]' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#707579] hover:text-[#111827] dark:text-[#7f93a5] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#202b36] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Add New Toggle */}
        <div className="p-3 border-b border-[#e0e4e8] dark:border-[#202b36] flex items-center gap-2">
          <div className="relative flex-1 flex items-center">
            <Search className="w-4 h-4 text-[#707579] dark:text-[#7f93a5] absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索联系人..."
              className="w-full bg-[#f0f2f5] dark:bg-[#242f3d] text-xs pl-9 pr-3 py-2 rounded-xl text-[#111827] dark:text-white border border-transparent focus:border-[#2ba0ff]/50 focus:outline-none"
            />
          </div>
          <button
            onClick={() => {
              setIsAdding(!isAdding);
              setErrorMsg('');
            }}
            className="px-3 py-2 rounded-xl bg-[#2481cc] hover:bg-[#2074b8] text-white text-xs font-medium flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span>添加联系人</span>
          </button>
        </div>

        {errorMsg && (
          <div className="mx-3 mt-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Add Contact Inline Form */}
        {isAdding && (
          <form onSubmit={handleCreate} className="p-4 bg-[#f9fafb] dark:bg-[#1e2a38] border-b border-[#e0e4e8] dark:border-[#243547] space-y-3 animate-in fade-in duration-150">
            <div className="text-xs font-semibold text-[#111827] dark:text-[#f5f7fa]">添加联系人</div>
            <div>
              <label className="block text-[11px] text-[#707579] dark:text-[#7f93a5] mb-1">姓名</label>
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
                <label className="block text-[11px] text-[#707579] dark:text-[#7f93a5] mb-1">电话号码</label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+1 234 567 8900"
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

        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto divide-y divide-black/5 dark:divide-[#202b36]">
          {filteredContacts.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#707579] dark:text-[#7f93a5]">
              {contacts.length === 0 ? '暂无联系人，点击上方「添加联系人」' : '未匹配到联系人'}
            </div>
          ) : (
            filteredContacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center justify-between p-3.5 hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-xs shrink-0 overflow-hidden"
                    style={{ backgroundColor: contact.avatarBg || '#2481cc' }}
                  >
                    {contact.avatarUrl ? (
                      <img src={contact.avatarUrl} alt={contact.name} className="w-full h-full object-cover" />
                    ) : (
                      <span>{contact.avatarInitial || contact.name.slice(0, 2)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-[#111827] dark:text-[#f5f7fa] truncate">
                      {contact.name}
                    </div>
                    <div className="text-[11px] text-[#707579] dark:text-[#7f93a5] truncate">
                      {contact.phone || contact.username || (contact.status === 'online' ? '在线' : '离线')}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    onStartChatWithContact(contact);
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#2481cc]/15 hover:bg-[#2481cc] text-[#2481cc] hover:text-white dark:text-[#2ba0ff] dark:hover:text-white transition-all text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>发消息</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
