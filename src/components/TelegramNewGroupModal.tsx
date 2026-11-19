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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-md bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] rounded-2xl shadow-2xl linen:shadow-sm border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
            <h3 className="text-base font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">新建群组</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-[#eef4fb] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe6d6] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="flex-1 overflow-y-auto flex flex-col">
          {/* Group Info Input */}
          <div className="p-5 flex items-center gap-4 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
            <div className="w-14 h-14 rounded-full bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43] text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-md">
              {groupTitle.trim() ? groupTitle.slice(0, 2).toUpperCase() : <Users className="w-7 h-7" />}
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-1">
                群组名称
              </label>
              <input
                type="text"
                required
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="输入群组名称..."
                className="w-full px-3 py-2 text-sm rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Member Selection List */}
          <div className="px-5 py-3 text-xs font-semibold text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] uppercase tracking-wider bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] tabular-nums">
            选择联系人 ({selectedContactIds.length})
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#e2e8f0] dark:divide-[#18273a] aurora:divide-[#182b34] linen:divide-[#dfd2bc] max-h-60">
            {contacts.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                暂无可选联系人，可直接创建群组
              </div>
            ) : (
              contacts.map((contact) => {
                const isSelected = selectedContactIds.includes(contact.id);
                return (
                  <div
                    key={contact.id}
                    onClick={() => toggleSelect(contact.id)}
                    className="flex items-center justify-between p-3 px-5 hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe6d6] transition-colors cursor-pointer"
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
                        <div className="font-medium text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                          {contact.name}
                        </div>
                        <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                          {contact.username || contact.phone || '联系人'}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-[#2481cc] border-[#2481cc] dark:bg-[#2ba0ff] dark:border-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:border-[#0d9488] linen:border-[#a86a43] text-white'
                          : 'border-[#cbd5e1] dark:border-[#2a3f59] aurora:border-[#284452] linen:border-[#bfa98a]'
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
            <div className="mx-4 mt-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 aurora:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Footer Submit */}
          <div className="p-4 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-end gap-2 bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-[#475569] hover:bg-[#e2e8f0]/60 dark:text-[#b4c6d8] dark:hover:bg-[#132234] aurora:text-[#b7d0d8] linen:text-[#4e3f32] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe6d6] cursor-pointer font-medium transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!groupTitle.trim() || isCreating}
              className="px-5 py-2 rounded-xl bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-md transition-all flex items-center gap-1.5"
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
