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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-md bg-white dark:bg-[#17212b] rounded-2xl shadow-2xl border border-[#e0e4e8] dark:border-[#202b36] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e0e4e8] dark:border-[#202b36]">
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff]" />
            <h3 className="text-base font-semibold text-[#111827] dark:text-[#f5f7fa]">新建频道</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#707579] hover:text-[#111827] dark:text-[#7f93a5] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#202b36] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-5 space-y-4">
          {/* Channel Name */}
          <div>
            <label className="block text-xs font-medium text-[#707579] dark:text-[#7f93a5] mb-1.5">
              频道名称
            </label>
            <input
              type="text"
              required
              value={channelTitle}
              onChange={(e) => setChannelTitle(e.target.value)}
              placeholder="例如: 官方公告频道 / Tech News"
              className="w-full px-3 py-2 text-sm rounded-xl bg-[#f0f2f5] dark:bg-[#242f3d] text-[#111827] dark:text-white border border-transparent focus:border-[#2ba0ff]/60 focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-[#707579] dark:text-[#7f93a5] mb-1.5">
              频道描述
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="介绍此频道的宗旨与发布内容..."
              className="w-full px-3 py-2 text-xs rounded-xl bg-[#f0f2f5] dark:bg-[#242f3d] text-[#111827] dark:text-white border border-transparent focus:border-[#2ba0ff]/60 focus:outline-none resize-none"
            />
          </div>

          {/* Channel Type */}
          <div>
            <label className="block text-xs font-medium text-[#707579] dark:text-[#7f93a5] mb-2">
              频道类型
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChannelType('public')}
                className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                  channelType === 'public'
                    ? 'border-[#2481cc] bg-[#2481cc]/10 dark:bg-[#2481cc]/20 text-[#2481cc] dark:text-[#2ba0ff]'
                    : 'border-[#e0e4e8] dark:border-[#2b394a] text-[#707579] dark:text-[#7f93a5]'
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
                    ? 'border-[#2481cc] bg-[#2481cc]/10 dark:bg-[#2481cc]/20 text-[#2481cc] dark:text-[#2ba0ff]'
                    : 'border-[#e0e4e8] dark:border-[#2b394a] text-[#707579] dark:text-[#7f93a5]'
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
              <label className="block text-xs font-medium text-[#707579] dark:text-[#7f93a5] mb-1.5">
                公开链接 / 用户名
              </label>
              <div className="flex items-center rounded-xl bg-[#f0f2f5] dark:bg-[#242f3d] px-3 py-2 text-xs">
                <span className="text-[#707579] dark:text-[#7f93a5]">t.me/</span>
                <input
                  type="text"
                  value={customLink}
                  onChange={(e) => setCustomLink(e.target.value)}
                  placeholder="channel_name"
                  className="w-full bg-transparent text-[#111827] dark:text-white focus:outline-none ml-1"
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {createdWarning && (
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{createdWarning}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-medium shrink-0 cursor-pointer"
              >
                进入频道
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#e0e4e8] dark:border-[#202b36]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-[#707579] hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/5 cursor-pointer font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!channelTitle.trim() || isCreating}
              className="px-5 py-2 rounded-xl bg-[#2481cc] hover:bg-[#2074b8] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-md transition-all flex items-center gap-1.5"
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
