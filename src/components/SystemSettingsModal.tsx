import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  X,
  ShieldCheck,
  Database,
  Lock,
  Globe,
  Server,
  Network,
  CheckCircle2,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import {
  APP_VERSION,
  fetchAuthStatus,
  getSystemProxyApi,
  saveSystemProxyApi,
  reconnectTelegramSessionsApi,
  checkAppUpdateApi,
  type AppUpdateCheckResult,
  type DesktopUpdaterState,
} from '../services/apiService';
import { getCryptoStorageSecurityInfo } from '../services/cryptoStorage';

interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDatabase?: () => void;
  onOpenTranslation?: () => void;
  onUpdateAvailable?: (info: AppUpdateCheckResult) => void;
  updaterState?: DesktopUpdaterState;
  onOpenUpdateModal?: () => void;
}

export const SystemSettingsModal: React.FC<SystemSettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenDatabase,
  onOpenTranslation,
  onUpdateAvailable,
  updaterState,
  onOpenUpdateModal,
}) => {
  const [jwtMode, setJwtMode] = useState<'asymmetric' | 'hs256' | 'unconfigured' | null>(null);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyType, setProxyType] = useState<'socks5' | 'socks4'>('socks5');
  const [proxyHost, setProxyHost] = useState('127.0.0.1');
  const [proxyPort, setProxyPort] = useState('1080');
  const [proxyUsername, setProxyUsername] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [isSavingProxy, setIsSavingProxy] = useState(false);
  const [proxyFeedback, setProxyFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateCheckMessage, setUpdateCheckMessage] = useState<string | null>(null);
  const backdropPointerDownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setProxyFeedback(null);
      setUpdateCheckMessage(null);
      return;
    }
    let active = true;
    fetchAuthStatus()
      .then((status) => {
        if (active && status?.jwtMode) {
          setJwtMode(status.jwtMode);
        }
      })
      .catch(() => {});

    getSystemProxyApi()
      .then((res) => {
        if (active && res.ok && res.config) {
          setProxyEnabled(Boolean(res.config.enabled));
          setProxyType(res.config.type === 'socks4' ? 'socks4' : 'socks5');
          setProxyHost(res.config.host || '127.0.0.1');
          setProxyPort(String(res.config.port || 1080));
          setProxyUsername(res.config.username || '');
          setProxyPassword('');
          setHasExistingPassword(Boolean(res.config.hasPassword));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isOpen]);

  const handleSaveProxy = async (andReconnect = false) => {
    setIsSavingProxy(true);
    setProxyFeedback(null);
    const parsedPort = parseInt(proxyPort, 10);
    const saveRes = await saveSystemProxyApi({
      enabled: proxyEnabled,
      type: proxyType,
      host: proxyHost.trim(),
      port: Number.isNaN(parsedPort) ? 0 : parsedPort,
      username: proxyUsername.trim() || undefined,
      password: proxyPassword ? proxyPassword : undefined,
      preservePassword: !proxyPassword && hasExistingPassword,
    });

    if (!saveRes.ok) {
      setIsSavingProxy(false);
      setProxyFeedback({ ok: false, text: saveRes.error || '保存代理设置失败' });
      return;
    }

    if (saveRes.config) {
      setHasExistingPassword(Boolean(saveRes.config.hasPassword));
      setProxyPassword('');
    }

    if (andReconnect) {
      const reconRes = await reconnectTelegramSessionsApi(true, true);
      setIsSavingProxy(false);
      if (reconRes.ok) {
        setProxyFeedback({ ok: true, text: `${saveRes.message || '代理已保存'}；${reconRes.message || '已触发重连'}` });
      } else {
        setProxyFeedback({ ok: false, text: `代理已保存，但重连失败：${reconRes.error || '请检查代理可用性'}` });
      }
      return;
    }

    setIsSavingProxy(false);
    setProxyFeedback({ ok: true, text: saveRes.message || '代理设置已保存' });
  };

  const handleManualCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateCheckMessage(null);
    try {
      const res = await checkAppUpdateApi();
      if (!res.ok) {
        setUpdateCheckMessage(res.error || '检查更新失败');
      } else if (res.hasUpdate) {
        setUpdateCheckMessage(`发现新版本 v${res.latestVersion}`);
        onUpdateAvailable?.(res);
      } else {
        setUpdateCheckMessage(`已是最新版本 (v${res.currentVersion || APP_VERSION})`);
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  if (!isOpen) return null;

  const cryptoInfo = getCryptoStorageSecurityInfo();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="工作台系统管理"
      onMouseDown={(e) => {
        backdropPointerDownTargetRef.current = e.target;
      }}
      onClick={(e) => {
        const startedOnBackdrop = backdropPointerDownTargetRef.current === e.currentTarget;
        backdropPointerDownTargetRef.current = null;
        if (startedOnBackdrop && e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 aurora:bg-black/80 animate-in fade-in duration-200 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#d5c6ae] rounded-2xl shadow-2xl linen:shadow-sm flex flex-col overflow-hidden text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#e8f3ff] dark:bg-[#2ba0ff]/15 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 border border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35 linen:border-[#a86a43]/40 flex items-center justify-center text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] tracking-wide">工作台系统管理</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-[#e2e8f0] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Section 1: Storage Security & Auth Isolation */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className={`w-4 h-4 ${
                  cryptoInfo.mode === 'fallback_stream'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              />
              <span className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">系统安全与加密状态</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
                <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">会话安全存储</div>
                <div
                  className={`font-medium mt-0.5 flex items-center gap-1 ${
                    cryptoInfo.mode === 'fallback_stream'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {cryptoInfo.mode === 'fallback_stream' ? (
                    <AlertCircle className="w-3 h-3 shrink-0" />
                  ) : (
                    <Lock className="w-3 h-3 shrink-0" />
                  )}
                  <span>{cryptoInfo.label}</span>
                </div>
                <p className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mt-1 leading-snug">{cryptoInfo.detail}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc]">
                <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">运行隔离与鉴权</div>
                <div className="text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] font-medium mt-0.5 flex items-center gap-1">
                  <Server className="w-3 h-3 shrink-0" />
                  <span>
                    {jwtMode === 'asymmetric'
                      ? 'JWT RS256 非对称公钥验签'
                      : jwtMode === 'hs256'
                        ? 'JWT HS256 对称密钥验签'
                        : jwtMode === 'unconfigured'
                          ? 'JWT 验签密钥未配置'
                          : '正在检测鉴权模式...'}
                  </span>
                </div>
              </div>
            </div>

            {(onOpenDatabase || onOpenTranslation) && (
              <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-between gap-3 flex-wrap">
                {onOpenDatabase && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenDatabase();
                    }}
                    className="flex items-center gap-1.5 text-xs text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:underline cursor-pointer"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>打开本地数据中心</span>
                  </button>
                )}
                {onOpenTranslation && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenTranslation();
                    }}
                    className="flex items-center gap-1.5 text-xs text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:underline cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>双向翻译设置</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Section 2: Telegram MTProto Built-in SOCKS Proxy */}
          <div className="bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                <span className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">Telegram MTProto 代理网络</span>
              </div>
              <label className="flex items-center gap-2 text-xs text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] cursor-pointer">
                <input
                  type="checkbox"
                  checked={proxyEnabled}
                  onChange={(e) => setProxyEnabled(e.target.checked)}
                  className="accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] linen:accent-[#a86a43] w-3.5 h-3.5 cursor-pointer"
                />
                <span>启用 SOCKS 代理</span>
              </label>
            </div>

            <div className={`grid grid-cols-3 gap-2.5 text-xs ${!proxyEnabled ? 'opacity-60' : ''}`}>
              <div>
                <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-1">协议类型</label>
                <select
                  value={proxyType}
                  onChange={(e) => setProxyType(e.target.value === 'socks4' ? 'socks4' : 'socks5')}
                  className="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                >
                  <option value="socks5">SOCKS5</option>
                  <option value="socks4">SOCKS4</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-1">代理地址 (Host)</label>
                <input
                  type="text"
                  value={proxyHost}
                  onChange={(e) => setProxyHost(e.target.value)}
                  placeholder="127.0.0.1"
                  className="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-1">端口 (Port)</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={proxyPort}
                  onChange={(e) => setProxyPort(e.target.value)}
                  placeholder="7890"
                  className="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
              </div>
            </div>

            <div className={`grid grid-cols-2 gap-2.5 text-xs ${!proxyEnabled ? 'opacity-60' : ''}`}>
              <div>
                <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-1">用户名（可选）</label>
                <input
                  type="text"
                  value={proxyUsername}
                  onChange={(e) => setProxyUsername(e.target.value)}
                  placeholder="无认证可留空"
                  className="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] mb-1">密码（可选）</label>
                <input
                  type="password"
                  value={proxyPassword}
                  onChange={(e) => setProxyPassword(e.target.value)}
                  placeholder={hasExistingPassword ? '已保存密码（留空则保持不变）' : '无认证可留空'}
                  className="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
              </div>
            </div>

            {proxyFeedback && (
              <div
                className={`p-2.5 rounded-lg text-[11px] flex items-start gap-2 border ${
                  proxyFeedback.ok
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                }`}
              >
                {proxyFeedback.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{proxyFeedback.text}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isSavingProxy}
                onClick={() => handleSaveProxy(false)}
                className="px-3 py-1.5 rounded-lg bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#1b2f47] aurora:bg-[#13252e] linen:bg-[#e7dccb] aurora:hover:bg-[#1a3340] linen:hover:bg-[#dfd2bc] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] disabled:opacity-50 text-xs text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] font-medium cursor-pointer transition-colors"
              >
                {isSavingProxy ? '保存中...' : '仅保存配置'}
              </button>
              <button
                type="button"
                disabled={isSavingProxy}
                onClick={() => handleSaveProxy(true)}
                className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] disabled:opacity-50 text-xs text-white font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSavingProxy ? 'animate-spin' : ''}`} />
                <span>保存并重连 Telegram</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] shrink-0">v{APP_VERSION}</span>
            <button
              type="button"
              disabled={isCheckingUpdate}
              onClick={handleManualCheckUpdate}
              className="text-[11px] px-2 py-0.5 rounded-md border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:bg-[#e8f3ff] dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] linen:hover:bg-[#efe6d6] disabled:opacity-50 cursor-pointer transition-colors shrink-0"
            >
              {isCheckingUpdate ? '检查中...' : '检查更新'}
            </button>
            {updaterState?.status === 'checking' ? (
              <button
                type="button"
                onClick={onOpenUpdateModal}
                className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:underline truncate cursor-pointer"
              >
                正在校验更新清单...
              </button>
            ) : updaterState?.status === 'downloading' ? (
              <button
                type="button"
                onClick={onOpenUpdateModal}
                className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:underline truncate cursor-pointer"
              >
                正在下载更新 {Math.round(updaterState.percent || 0)}%
              </button>
            ) : updaterState?.status === 'downloaded' ? (
              <button
                type="button"
                onClick={onOpenUpdateModal}
                className="text-[11px] font-medium text-[#16a34a] dark:text-[#4ade80] hover:underline truncate cursor-pointer"
              >
                新版已就绪，点击重启更新
              </button>
            ) : updaterState?.status === 'installing' ? (
              <button
                type="button"
                onClick={onOpenUpdateModal}
                className="text-[11px] font-medium text-[#16a34a] dark:text-[#4ade80] hover:underline truncate cursor-pointer"
              >
                正在重启安装更新...
              </button>
            ) : updaterState?.status === 'error' ? (
              <button
                type="button"
                onClick={onOpenUpdateModal}
                title={updaterState.error || '更新失败，点击查看详情并重试'}
                className="text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline truncate cursor-pointer"
              >
                {updaterState.error ? `更新失败：${updaterState.error}` : '更新失败，点击查看详情'}
              </button>
            ) : updateCheckMessage ? (
              <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] truncate">
                {updateCheckMessage}
              </span>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors shrink-0"
          >
            完成并关闭
          </button>
        </div>
      </div>
    </div>
  );
};
