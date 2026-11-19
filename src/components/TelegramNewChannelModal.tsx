import React, { useState, useEffect } from 'react';
import { X, Megaphone, Globe, Lock, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Chat } from '../types';
import { createTelegramChannelApi } from '../services/apiService';

interface TelegramNewChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccountId: string;
  onCreateChannel: (newChat: Chat) => void;
}

export const TelegramNewChannelModal: React.FC<TelegramNewChannelModalProps> = ({
  isOpen,
  onClose,
  currentAccountId,
  onCreateChannel,
}) => {
  const [channelTitle, setChannelTitle] = useState('');
  const [description, setDescription] = useState('');
  const [channelType, setChannelType] = useState<'public' | 'private'>('public');
  const [customLink, setCustomLink] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [createdWarning, setCreatedWarning] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setCreatedWarning('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelTitle.trim() || isCreating) return;

    setIsCreating(true);
    setErrorMsg('');
    setCreatedWarning('');

    try {
      const res = await createTelegramChannelApi({
        accountId: currentAccountId,
        title: channelTitle.trim(),
        description: description.trim(),
        channelType,
        customLink: customLink.trim(),
      });

      if (!res.ok || !res.chat) {
        setErrorMsg(res.error || 'Telegram 云端创建频道失败');
        return;
      }

      onCreateChannel(res.chat);
      setChannelTitle('');
      setDescription('');
      setCustomLink('');

      if (res.usernameWarning) {
        setCreatedWarning(res.usernameWarning);
        return;
      }
      onClose();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-md bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] rounded-2xl shadow-2xl linen:shadow-sm border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
            <h3 className="text-base font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">新建频道</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-[#eef4fb] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe6d6] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-5 space-y-4">
          {/* Channel Name */}
          <div>
            <label className="block text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-1.5">
              频道名称
            </label>
            <input
              type="text"
              required
              value={channelTitle}
              onChange={(e) => setChannelTitle(e.target.value)}
              placeholder="例如: 官方公告频道 / Tech News"
              className="w-full px-3 py-2 text-sm rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] focus:outline-none transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-1.5">
              频道描述
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="介绍此频道的宗旨与发布内容..."
              className="w-full px-3 py-2 text-xs rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] focus:outline-none resize-none transition-colors"
            />
          </div>

          {/* Channel Type */}
          <div>
            <label className="block text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-2">
              频道类型
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChannelType('public')}
                className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                  channelType === 'public'
                    ? 'bg-[#e8f3ff] border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] linen:bg-[#a86a43]/15 aurora:border-[#2dd4bf]/35 linen:border-[#a86a43]/40 aurora:text-[#5eead4] linen:text-[#8c522d]'
                    : 'border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe6d6]'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs mb-1">
                  <Globe className="w-4 h-4" />
                  <span>公开频道</span>
                </div>
                <div className="text-[10px] opacity-80">所有人均可在搜索中找到并加入</div>
              </button>

              <button
                type="button"
                onClick={() => setChannelType('private')}
                className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                  channelType === 'private'
                    ? 'bg-[#e8f3ff] border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] linen:bg-[#a86a43]/15 aurora:border-[#2dd4bf]/35 linen:border-[#a86a43]/40 aurora:text-[#5eead4] linen:text-[#8c522d]'
                    : 'border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe6d6]'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs mb-1">
                  <Lock className="w-4 h-4" />
                  <span>私密频道</span>
                </div>
                <div className="text-[10px] opacity-80">仅能通过专属邀请链接加入</div>
              </button>
            </div>
          </div>

          {channelType === 'public' && (
            <div>
              <label className="block text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-1.5">
                公开链接 / 用户名
              </label>
              <div className="flex items-center rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] focus-within:border-[#2481cc] dark:focus-within:border-[#2ba0ff] aurora:focus-within:border-[#2dd4bf] px-3 py-2 text-xs transition-colors">
                <span className="text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">t.me/</span>
                <input
                  type="text"
                  value={customLink}
                  onChange={(e) => setCustomLink(e.target.value)}
                  placeholder="channel_name"
                  className="w-full bg-transparent text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none ml-1"
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 aurora:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {createdWarning && (
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 aurora:text-amber-300 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 aurora:text-emerald-400" />
                <span>{createdWarning}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-800 dark:text-amber-300 aurora:text-amber-300 font-medium shrink-0 cursor-pointer"
              >
                进入频道
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-[#475569] hover:bg-[#f1f5f9] dark:text-[#b4c6d8] dark:hover:bg-[#132234] aurora:text-[#b7d0d8] linen:text-[#4e3f32] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe6d6] cursor-pointer font-medium transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!channelTitle.trim() || isCreating}
              className="px-5 py-2 rounded-xl bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-md transition-all flex items-center gap-1.5"
            >
              {isCreating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{isCreating ? '正在云端创建...' : '创建频道'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
