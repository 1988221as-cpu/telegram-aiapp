import React, { useState } from 'react';
import { X, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-react';
import { TelegramCallRecord } from '../types';

interface TelegramCallsModalProps {
  isOpen: boolean;
  onClose: () => void;
  callRecords: TelegramCallRecord[];
  onStartCall: (contactName: string) => void;
}

export const TelegramCallsModal: React.FC<TelegramCallsModalProps> = ({
  isOpen,
  onClose,
  callRecords,
  onStartCall,
}) => {
  const [filter, setFilter] = useState<'all' | 'missed'>('all');

  if (!isOpen) return null;

  const filtered = callRecords.filter((rec) => {
    if (filter === 'missed') return rec.type === 'missed';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-md bg-white dark:bg-[#17212b] rounded-2xl shadow-2xl border border-[#e0e4e8] dark:border-[#202b36] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e0e4e8] dark:border-[#202b36]">
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff]" />
            <h3 className="text-base font-semibold text-[#111827] dark:text-[#f5f7fa]">通话记录</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#707579] hover:text-[#111827] dark:text-[#7f93a5] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#202b36] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center px-4 py-2 gap-2 border-b border-[#e0e4e8] dark:border-[#202b36] text-xs">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
              filter === 'all'
                ? 'bg-[#2481cc]/15 text-[#2481cc] dark:text-[#2ba0ff] font-semibold'
                : 'text-[#707579] dark:text-[#7f93a5] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            全部通话
          </button>
          <button
            onClick={() => setFilter('missed')}
            className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
              filter === 'missed'
                ? 'bg-[#2481cc]/15 text-[#2481cc] dark:text-[#2ba0ff] font-semibold'
                : 'text-[#707579] dark:text-[#7f93a5] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            未接来电
          </button>
        </div>

        {/* Calls List */}
        <div className="flex-1 overflow-y-auto divide-y divide-black/5 dark:divide-[#202b36]">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#707579] dark:text-[#7f93a5]">
              暂无通话记录
            </div>
          ) : (
            filtered.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between p-3.5 px-4 hover:bg-black/5 dark:hover:bg-[#202b36] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-xs shrink-0 overflow-hidden"
                    style={{ backgroundColor: record.avatarBg }}
                  >
                    {record.avatarUrl ? (
                      <img src={record.avatarUrl} alt={record.contactName} className="w-full h-full object-cover" />
                    ) : (
                      <span>{record.avatarInitial}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-[#111827] dark:text-[#f5f7fa] truncate">
                      {record.contactName}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#707579] dark:text-[#7f93a5] mt-0.5 tabular-nums">
                      {record.type === 'incoming' && (
                        <PhoneIncoming className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                      {record.type === 'outgoing' && (
                        <PhoneOutgoing className="w-3.5 h-3.5 text-[#2481cc]" />
                      )}
                      {record.type === 'missed' && (
                        <PhoneMissed className="w-3.5 h-3.5 text-red-500" />
                      )}
                      <span>{record.type === 'missed' ? '未接通' : record.duration}</span>
                      <span>·</span>
                      <span>{record.timestamp}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    onStartCall(record.contactName);
                    onClose();
                  }}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[#2481cc] dark:text-[#2ba0ff] hover:bg-[#2481cc]/15 transition-colors cursor-pointer"
                  title="回拨语音电话"
                >
                  <Phone className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
