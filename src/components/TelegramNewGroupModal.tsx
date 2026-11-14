import React, { useState, useEffect } from 'react';
import { X, Users, Check, RefreshCw, AlertCircle } from 'lucide-react';
import { TelegramContact, Chat } from '../types';
import { createTelegramGroupApi, fetchTelegramUserContactsApi } from '../services/apiService';

interface TelegramNewGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  contacts: TelegramContact[];
  currentAccountId: string;
  onCreateGroup: (newChat: Chat) => void;
  onSyncContacts?: (cloudContacts: TelegramContact[]) => void;
}

export const TelegramNewGroupModal: React.FC<TelegramNewGroupModalProps> = ({
  isOpen,
  onClose,
  contacts,
  currentAccountId,
  onCreateGroup,
  onSyncContacts,
}) => {
  const [groupTitle, setGroupTitle] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    if (currentAccountId && currentAccountId.startsWith('acc_tg_')) {
      fetchTelegramUserContactsApi(currentAccountId).then((res) => {
        if (res.ok && Array.isArray(res.contacts)) {
          onSyncContacts?.(res.contacts);
        }
      });
    }
  }, [isOpen, currentAccountId]);

  if (!isOpen) return null;

  const toggleSelect = (id: string) => {
    setSelectedContactIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupTitle.trim() || isCreating) return;

    setIsCreating(true);
    setErrorMsg('');
    try {
      const selectedPeers = contacts
        .filter((c) => selectedContactIds.includes(c.id))
        .map((c) => ({ id: c.id, username: c.username, phone: c.phone }));

      const res = await createTelegramGroupApi({
        accountId: currentAccountId,
        title: groupTitle.trim(),
        memberPeers: selectedPeers,
      });

      if (!res.ok || !res.chat) {
        setErrorMsg(res.error || 'Telegram 云端创建群组失败');
        return;
      }

      onCreateGroup(res.chat);
      onClose();
      setGroupTitle('');
      setSelectedContactIds([]);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-md bg-white dark:bg-[#17212b] rounded-2xl shadow-2xl border border-[#e0e4e8] dark:border-[#202b36] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e0e4e8] dark:border-[#202b36]">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff]" />
            <h3 className="text-base font-semibold text-[#111827] dark:text-[#f5f7fa]">新建群组</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#707579] hover:text-[#111827] dark:text-[#7f93a5] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#202b36] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="flex-1 overflow-y-auto flex flex-col">
          {/* Group Info Input */}
          <div className="p-5 flex items-center gap-4 border-b border-[#e0e4e8] dark:border-[#202b36]">
            <div className="w-14 h-14 rounded-full bg-[#2481cc] text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-md">
              {groupTitle.trim() ? groupTitle.slice(0, 2).toUpperCase() : <Users className="w-7 h-7" />}
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-[#707579] dark:text-[#7f93a5] mb-1">
                群组名称
              </label>
              <input
                type="text"
                required
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="输入群组名称..."
                className="w-full px-3 py-2 text-sm rounded-xl bg-[#f0f2f5] dark:bg-[#242f3d] text-[#111827] dark:text-white border border-transparent focus:border-[#2ba0ff]/60 focus:outline-none"
              />
            </div>
          </div>

          {/* Member Selection List */}
          <div className="px-5 py-3 text-xs font-semibold text-[#707579] dark:text-[#7f93a5] uppercase tracking-wider bg-gray-50/50 dark:bg-[#121b24]/50 border-b border-[#e0e4e8] dark:border-[#202b36] tabular-nums">
            选择联系人 ({selectedContactIds.length})
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-black/5 dark:divide-[#202b36] max-h-60">
            {contacts.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#707579] dark:text-[#7f93a5]">
                暂无可选联系人，可直接创建群组
              </div>
            ) : (
              contacts.map((contact) => {
                const isSelected = selectedContactIds.includes(contact.id);
                return (
                  <div
                    key={contact.id}
                    onClick={() => toggleSelect(contact.id)}
                    className="flex items-center justify-between p-3 px-5 hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs shrink-0 overflow-hidden relative"
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
                      <div>
                        <div className="font-medium text-xs text-[#111827] dark:text-[#f5f7fa]">
                          {contact.name}
                        </div>
                        <div className="text-[10px] text-[#707579] dark:text-[#7f93a5]">
                          {contact.username || contact.phone || '联系人'}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-[#2481cc] border-[#2481cc] text-white'
                          : 'border-gray-400 dark:border-gray-600'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {errorMsg && (
            <div className="mx-4 mt-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Footer Submit */}
          <div className="p-4 border-t border-[#e0e4e8] dark:border-[#202b36] flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-[#121b24]/50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-[#707579] hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/5 cursor-pointer font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!groupTitle.trim() || isCreating}
              className="px-5 py-2 rounded-xl bg-[#2481cc] hover:bg-[#2074b8] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-md transition-all flex items-center gap-1.5"
            >
              {isCreating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{isCreating ? '正在同步云端建群...' : '创建群组'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
