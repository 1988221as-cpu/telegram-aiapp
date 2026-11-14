import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  Download,
  Upload,
  RefreshCw,
  X,
  Trash2,
  Database,
  AlertTriangle,
} from 'lucide-react';
import {
  getLocalStorageMetrics,
  purgeAllLocalChatData,
  fetchDatabaseStatus,
  downloadDatabaseBackup,
  uploadDatabaseRestore,
  purgeDatabaseApi,
} from '../services/apiService';
import {
  clearCryptoStorageCache,
  flushPendingCryptoWrites,
  secureGetItemAsync,
  secureSetItemAsync,
} from '../services/cryptoStorage';

const EXCLUDED_BACKUP_KEYS = new Set([
  'tg_pro_session_token',
  'tg_pro_member_user',
  'tg_custom_api_id',
  'tg_custom_api_hash',
  'tg_pro_crypto_seed_v1',
]);

const EXACT_BACKUP_KEYS = new Set([
  'tg_master_voiceprint',
  'tg_deleted_message_ids',
]);

function sanitizeBackupEntry(key: string, value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (key === 'tg_pro_llm_config') {
    const clone = { ...value };
    delete clone.apiKey;
    delete clone.knowledgeBaseApiKey;
    delete clone.engineLicenseKey;
    delete clone.hasApiKey;
    delete clone.hasKnowledgeBaseApiKey;
    delete clone.hasEngineLicenseKey;
    return clone;
  }
  if (key === 'tg_pro_trans_settings') {
    const clone = { ...value };
    delete clone.geminiApiKey;
    delete clone.googleApiKey;
    delete clone.hasGeminiApiKey;
    delete clone.hasGoogleApiKey;
    return clone;
  }
  return value;
}

const SENSITIVE_CONFIG_BACKUP_KEYS = new Set(['tg_pro_llm_config', 'tg_pro_trans_settings']);

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
  const [dbStatus, setDbStatus] = useState<{
    status: string;
    dbType?: string;
    totalMessages: number;
    totalProfiles: number;
    sizeBytes: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setShowPurgeConfirm(false);
      void loadStats();
    }
  }, [isOpen]);

  const loadStats = async () => {
    setLoading(true);
    setLocalMetrics(getLocalStorageMetrics());
    const statusRes = await fetchDatabaseStatus();
    if (statusRes) {
      setDbStatus({
        status: statusRes.status || 'connected',
        dbType: statusRes.dbType,
        totalMessages: Number(statusRes.totalMessages || 0),
        totalProfiles: Number(statusRes.totalProfiles || 0),
        sizeBytes: Number(statusRes.sizeBytes || 0),
      });
    } else {
      setDbStatus(null);
    }
    setLoading(false);
  };

  const handleExportFullBackup = async () => {
    try {
      setBackupLoading(true);
      setActionNotice(null);
      await flushPendingCryptoWrites();
      const sqliteSnapshot = await downloadDatabaseBackup();

      const localPayload: Record<string, string | null> = {};
      const decryptedPayload: Record<string, any> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        if (shouldBackupLocalKey(key)) {
          const decoded = await secureGetItemAsync(key);
          if (SENSITIVE_CONFIG_BACKUP_KEYS.has(key)) {
            if (decoded && typeof decoded === 'object') {
              const sanitized = sanitizeBackupEntry(key, decoded);
              decryptedPayload[key] = sanitized;
              localPayload[key] = JSON.stringify(sanitized);
            }
          } else {
            localPayload[key] = localStorage.getItem(key);
            if (decoded !== null && decoded !== undefined) {
              decryptedPayload[key] = decoded;
            }
          }
        }
      }

      const backupData = {
        exportedAt: new Date().toISOString(),
        version: 'humansense_full_v3.1',
        type: 'HumanSense_Full_Desktop_Backup',
        sqliteSnapshot,
        decryptedPayload,
        payload: localPayload,
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `humansense_full_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setActionNotice({
        success: true,
        message: '全量私密备份导出成功！已完整打包本地 SQLite 数据库（知识库、人设、进化习惯、客户画像与历史消息）及本地会话缓存。',
      });
    } catch (err: any) {
      setActionNotice({ success: false, message: '导出失败: ' + (err?.message || '未知错误') });
    } finally {
      setBackupLoading(false);
    }
  };

  const handleImportFullBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setRestoreLoading(true);
      setActionNotice(null);
      const text = await file.text();
      const parsed = JSON.parse(text);

      const snapshotToRestore =
        parsed?.sqliteSnapshot?.tables
          ? parsed.sqliteSnapshot
          : parsed?.tables
          ? parsed
          : null;
      const hasDecryptedPayload = Boolean(parsed?.decryptedPayload && typeof parsed.decryptedPayload === 'object');
      const hasLocalPayload = Boolean(parsed?.payload && typeof parsed.payload === 'object');

      if (!snapshotToRestore && !hasLocalPayload && !hasDecryptedPayload) {
        throw new Error('无效的 HumanSense 备份文件（未检测到 SQLite 快照或本地会话数据）');
      }

      const summaryParts: string[] = [];

      if (snapshotToRestore) {
        const restoreRes = await uploadDatabaseRestore(snapshotToRestore);
        if (!restoreRes.success) {
          throw new Error(restoreRes.message || 'SQLite 数据库快照恢复失败');
        }
        const counts = restoreRes.restoredCounts || {};
        const totalSqlRows = Object.values(counts).reduce<number>(
          (sum, v) => sum + (typeof v === 'number' ? v : 0),
          0
        );
        summaryParts.push(`SQLite 数据库记录 ${totalSqlRows} 条`);
      }

      let restoredKeys = 0;
      if (hasDecryptedPayload) {
        for (const [k, v] of Object.entries(parsed.decryptedPayload)) {
          if (!EXCLUDED_BACKUP_KEYS.has(k) && shouldBackupLocalKey(k) && v !== undefined) {
            await secureSetItemAsync(k, v);
            restoredKeys++;
          }
        }
      } else if (hasLocalPayload) {
        for (const [k, v] of Object.entries(parsed.payload)) {
          if (typeof v === 'string' && !EXCLUDED_BACKUP_KEYS.has(k) && shouldBackupLocalKey(k)) {
            localStorage.setItem(k, v);
            restoredKeys++;
          }
        }
      }
      if (restoredKeys > 0) {
        summaryParts.push(`本地加密缓存 ${restoredKeys} 项`);
      }

      clearCryptoStorageCache();
      window.dispatchEvent(new Event('tg_voiceprint_updated'));

      setActionNotice({
        success: true,
        message: `备份恢复成功！已还原 ${summaryParts.join('、')}。`,
      });
      await loadStats();
      if (onRestoreComplete) {
        onRestoreComplete();
      }
    } catch (err: any) {
      setActionNotice({ success: false, message: '恢复失败: ' + (err?.message || '无效文件') });
    } finally {
      setRestoreLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmPurgeAllData = async () => {
    try {
      setPurgeLoading(true);
      setActionNotice(null);
      const dbRes = await purgeDatabaseApi();
      if (!dbRes.success) {
        setActionNotice({
          success: false,
          message: `数据库粉碎失败，已中止清理：${dbRes.error || '请稍后重试'}`,
        });
        return;
      }

      purgeAllLocalChatData();
      clearCryptoStorageCache();
      setShowPurgeConfirm(false);
      setActionNotice({
        success: true,
        message: '已彻底粉碎本地 SQLite 数据库业务记录（消息、客户画像、知识库、人设、演进记录）与本机加密缓存！登录态与系统凭据已保留。',
      });
      await loadStats();
      if (onPurgeComplete) onPurgeComplete();
    } catch (err: any) {
      setActionNotice({ success: false, message: '粉碎清理异常: ' + (err?.message || '未知错误') });
    } finally {
      setPurgeLoading(false);
    }
  };

  if (!isOpen) return null;

  const totalSqliteKb = dbStatus ? Math.max(Math.round(dbStatus.sizeBytes / 1024), 1) : null;
  const totalLocalKb = Math.max(Math.round(localMetrics.approxBytes / 1024), 1);

  return (
    <div className="fixed inset-0 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] w-full max-w-xl rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">本地数据库与安全备份中心</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] hover:bg-[#e2e8f0] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Storage KPI Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
              <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">本地数据库引擎</span>
              <div className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] mt-1.5 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="truncate">{dbStatus?.dbType || 'SQLite (Local)'}</span>
              </div>
              <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-1 tabular-nums">
                库容 {totalSqliteKb !== null ? `${totalSqliteKb} KB` : '--'} · 缓存 {totalLocalKb} KB
              </div>
            </div>

            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
              <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">全库持久化消息</span>
              <div className="text-lg font-bold text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] mt-1 tabular-nums font-mono">
                {dbStatus ? dbStatus.totalMessages : localMetrics.totalMessages}{' '}
                <span className="text-xs font-normal text-[#475569] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">条</span>
              </div>
              <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-0.5 tabular-nums">
                本地活跃窗口 {localMetrics.totalMessages} 条
              </div>
            </div>

            <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 p-3.5 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
              <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] block">全息客户档案</span>
              <div className="text-lg font-bold text-purple-600 dark:text-purple-400 mt-1 tabular-nums font-mono">
                {dbStatus ? dbStatus.totalProfiles : '--'}{' '}
                <span className="text-xs font-normal text-[#475569] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">份</span>
              </div>
              <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-0.5 tabular-nums">
                活跃会话 {localMetrics.totalChats} 个
              </div>
            </div>
          </div>

          {/* Full Backup & Privacy Shredder Action Area */}
          <div className="p-4 bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 rounded-xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-3">
            <div className="text-xs font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">全量数据库备份、还原与彻底粉碎</div>
            <p className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] leading-relaxed">
              导出文件将同时打包本机 SQLite 持久化表（知识库、全局人设、进化习惯、客户全息画像、消息记录）与前端本地加密缓存；已自动剔除敏感会员与 Telegram 会话密钥。
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportFullBackup}
                disabled={backupLoading || restoreLoading || purgeLoading}
                className="flex-1 py-2 px-3 rounded-lg bg-white hover:bg-[#f1f5f9] dark:bg-[#132234] dark:hover:bg-[#1b2f47] aurora:bg-[#13252e] aurora:hover:bg-[#1a3340] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] disabled:opacity-50 text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{backupLoading ? '正在打包导出...' : '导出全量备份 (JSON)'}</span>
              </button>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportFullBackup}
                accept=".json"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={backupLoading || restoreLoading || purgeLoading}
                className="flex-1 py-2 px-3 rounded-lg bg-white hover:bg-[#f1f5f9] dark:bg-[#132234] dark:hover:bg-[#1b2f47] aurora:bg-[#13252e] aurora:hover:bg-[#1a3340] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] disabled:opacity-50 text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                <span>{restoreLoading ? '正在导入还原...' : '导入备份还原'}</span>
              </button>

              <button
                onClick={() => setShowPurgeConfirm((v) => !v)}
                disabled={backupLoading || restoreLoading || purgeLoading}
                className="py-2 px-3 rounded-lg bg-rose-500/12 hover:bg-rose-500/20 disabled:opacity-50 text-rose-700 dark:text-rose-300 border border-rose-500/30 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                title="彻底粉碎本机 SQLite 业务数据与本地缓存"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                <span>一键粉碎</span>
              </button>
            </div>

            {showPurgeConfirm && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/35 space-y-2.5">
                <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-200 leading-relaxed">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    确定要彻底粉碎本机所有业务数据吗？此操作将清空 SQLite 数据库及本地缓存中的聊天记录、客户全息画像、知识库文档、人设与进化记录且无法撤销（会员登录与 Telegram 会话密钥会保留）。
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={purgeLoading}
                    onClick={() => setShowPurgeConfirm(false)}
                    className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#f1f5f9] dark:bg-[#132234] dark:hover:bg-[#1b2f47] aurora:bg-[#13252e] aurora:hover:bg-[#1a3340] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-xs text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] cursor-pointer transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={purgeLoading}
                    onClick={handleConfirmPurgeAllData}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-xs text-white font-semibold cursor-pointer transition-colors"
                  >
                    {purgeLoading ? '正在粉碎...' : '确认彻底粉碎'}
                  </button>
                </div>
              </div>
            )}

            {actionNotice && (
              <div
                className={`p-2.5 rounded-lg text-[11px] leading-relaxed border ${
                  actionNotice.success
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                }`}
              >
                {actionNotice.message}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] flex items-center justify-between">
          <button
            onClick={() => void loadStats()}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新状态</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-xs font-semibold shadow-sm cursor-pointer transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
