import React, { useState } from 'react';
import { X, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-react';
import { TelegramCallRecord } from '../types';

interface TelegramCallsModalProps {
  isOpen: boolean;
  onClose: () => void;
  callRecords: TelegramCallRecord[];
  onStartCall?: (contactName: string) => void;
}

export const TelegramCallsModal: React.FC<TelegramCallsModalProps> = ({
  isOpen,
  onClose,
  callRecords,
}) => {
  const [filter, setFilter] = useState<'all' | 'missed'>('all');

  if (!isOpen) return null;

  const filtered = callRecords.filter((rec) => {
    if (filter === 'missed') return rec.type === 'missed';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-md bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] rounded-2xl shadow-2xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
            <h3 className="text-base font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">通话记录</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-[#eef4fb] aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center px-4 py-2 gap-2 bg-[#f8fafc]/70 dark:bg-[#0d1726]/70 aurora:bg-[#0e1920]/70 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] text-xs">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
              filter === 'all'
                ? 'bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] font-semibold'
                : 'border border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e]'
            }`}
          >
            全部通话
          </button>
          <button
            onClick={() => setFilter('missed')}
            className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
              filter === 'missed'
                ? 'bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] font-semibold'
                : 'border border-transparent text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e]'
            }`}
          >
            未接来电
          </button>
        </div>

        {/* Calls List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#e2e8f0] dark:divide-[#18273a] aurora:divide-[#182b34]">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
              暂无通话记录
            </div>
          ) : (
            filtered.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between p-3.5 px-4 hover:bg-[#f1f5f9] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] transition-colors"
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
                    <div className="font-semibold text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] truncate">
                      {record.contactName}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-0.5 tabular-nums">
                      {record.type === 'incoming' && (
                        <PhoneIncoming className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 aurora:text-emerald-400" />
                      )}
                      {record.type === 'outgoing' && (
                        <PhoneOutgoing className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                      )}
                      {record.type === 'missed' && (
                        <PhoneMissed className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 aurora:text-rose-400" />
                      )}
                      <span>{record.type === 'missed' ? '未接通' : record.duration}</span>
                      <span>·</span>
                      <span>{record.timestamp}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
