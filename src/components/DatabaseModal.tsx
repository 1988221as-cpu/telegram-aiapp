import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  Download,
  Upload,
  RefreshCw,
  X,
  Trash2,
  Laptop,
} from 'lucide-react';
import {
  getLocalStorageMetrics,
  purgeAllLocalChatData
} from '../services/apiService';
import { clearCryptoStorageCache } from '../services/cryptoStorage';

const EXCLUDED_BACKUP_KEYS = new Set([
  'tg_pro_session_token',
  'tg_pro_member_user',
  'tg_custom_api_id',
  'tg_custom_api_hash',
]);

const EXACT_BACKUP_KEYS = new Set([
  'tg_master_voiceprint',
  'tg_deleted_message_ids',
]);

function shouldBackupLocalKey(key: string): boolean {
  if (!key || EXCLUDED_BACKUP_KEYS.has(key)) return false;
  return (
    key.startsWith('tg_desktop_') ||
    key.startsWith('tg_pro_') ||
    key.startsWith('tg_deleted_message_ids') ||
    EXACT_BACKUP_KEYS.has(key)
  );
}

interface DatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurgeComplete?: () => void;
  onRestoreComplete?: () => void;
}

export const DatabaseModal: React.FC<DatabaseModalProps> = ({ isOpen, onClose, onPurgeComplete, onRestoreComplete }) => {
  const [localMetrics, setLocalMetrics] = useState({ totalMessages: 0, totalChats: 0, approxBytes: 0 });
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadStats();
    }
  }, [isOpen]);

  const loadStats = () => {
    setLoading(true);
    setLocalMetrics(getLocalStorageMetrics());
    setLoading(false);
  };

  const handleExportLocalBackup = () => {
    try {
      setBackupLoading(true);
      const backupData: Record<string, any> = {
        exportedAt: new Date().toISOString(),
        version: 'tg_desktop_safe_v2.4',
        type: 'Zero_DB_Local_Workstation_Backup',
        payload: {}
      };

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        if (shouldBackupLocalKey(key)) {
          backupData.payload[key] = localStorage.getItem(key);
        }
      }

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tg_desktop_local_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setActionNotice({
        success: true,
        message: '本地私密备份已导出！聊天记录仅存在于您导出的本地文件中，云端零留存。'
      });
    } catch (err: any) {
      setActionNotice({ success: false, message: '导出失败: ' + err.message });
    } finally {
      setBackupLoading(false);
    }
  };

  const handleImportLocalBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.payload || typeof parsed.payload !== 'object') {
        throw new Error('无效的 HumanSense 本地备份文件');
      }

      let restoredKeys = 0;
      for (const [k, v] of Object.entries(parsed.payload)) {
        if (typeof v === 'string' && !EXCLUDED_BACKUP_KEYS.has(k)) {
          localStorage.setItem(k, v);
          restoredKeys++;
        }
      }

      clearCryptoStorageCache();
      window.dispatchEvent(new Event('tg_voiceprint_updated'));

      setActionNotice({
        success: true,
        message: `本地恢复成功！已还原 ${restoredKeys} 项本地会话及配置数据。`
      });
      loadStats();
      if (onRestoreComplete) {
        onRestoreComplete();
      }
    } catch (err: any) {
      setActionNotice({ success: false, message: '恢复失败: ' + err.message });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePurgeLocalData = () => {
    if (window.confirm('⚠️ 确定要彻底粉碎本机所有聊天记录和客户画像吗？\n\n此操作将清空本机浏览器所有聊天历史，不留任何痕迹且无法撤销。')) {
      purgeAllLocalChatData();
      clearCryptoStorageCache();
      setActionNotice({
        success: true,
        message: '已彻底粉碎清除本机所有聊天历史与本地画像！零残留。'
      });
      loadStats();
      if (onPurgeComplete) onPurgeComplete();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#17212b] border border-[#2b3d52] w-full max-w-xl rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2b3d52] flex items-center justify-between bg-[#131c27]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">本地数据与安全中心</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#7f91a4] hover:text-white hover:bg-[#202e3d] flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Local Workstation Storage KPI Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#0e1621] p-3.5 rounded-xl border border-[#202e3d]">
              <span className="text-[11px] text-[#7f91a4] block">运行环境</span>
              <div className="text-sm font-bold text-white mt-1 flex items-center gap-1.5">
                <Laptop className="w-3.5 h-3.5 text-blue-400" />
                <span>桌面客户端</span>
              </div>
            </div>

            <div className="bg-[#0e1621] p-3.5 rounded-xl border border-[#202e3d]">
              <span className="text-[11px] text-[#7f91a4] block">本地消息数</span>
              <div className="text-lg font-bold text-[#2481cc] mt-1 tabular-nums font-mono">
                {localMetrics.totalMessages} <span className="text-xs font-normal text-white">条</span>
              </div>
            </div>

            <div className="bg-[#0e1621] p-3.5 rounded-xl border border-[#202e3d]">
              <span className="text-[11px] text-[#7f91a4] block">本地存储占用</span>
              <div className="text-lg font-bold text-purple-400 mt-1 tabular-nums font-mono">
                {Math.max(Math.round(localMetrics.approxBytes / 1024), 1)} <span className="text-xs font-normal text-white">KB</span>
              </div>
            </div>
          </div>

          {/* Local Backup & Privacy Shredder Action Area */}
          <div className="p-4 bg-[#0e1621] rounded-xl border border-[#202e3d] space-y-3">
            <div className="text-xs font-bold text-white">本地数据备份与清理</div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportLocalBackup}
                disabled={backupLoading}
                className="flex-1 py-2 px-3 rounded-lg bg-[#202e3d] hover:bg-[#2b3d52] text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>{backupLoading ? '正在导出...' : '导出本地私密备份 (JSON)'}</span>
              </button>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportLocalBackup}
                accept=".json"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 py-2 px-3 rounded-lg bg-[#202e3d] hover:bg-[#2b3d52] text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-blue-400" />
                <span>导入本地备份还原</span>
              </button>

              <button
                onClick={handlePurgeLocalData}
                className="py-2 px-3 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                title="彻底粉碎本机所有聊天记录"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>一键粉碎</span>
              </button>
            </div>

            {actionNotice && (
              <div className={`p-2.5 rounded-lg text-[11px] ${
                actionNotice.success
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-red-500/20 text-red-300 border border-red-500/30'
              }`}>
                {actionNotice.message}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2b3d52] bg-[#131c27] flex items-center justify-between">
          <button
            onClick={loadStats}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-[#7f91a4] hover:text-white cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新状态</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fae] text-white text-xs font-semibold shadow-md cursor-pointer transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
