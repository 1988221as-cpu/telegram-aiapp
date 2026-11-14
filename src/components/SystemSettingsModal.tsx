import React, { useState, useEffect } from 'react';
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
} from '../services/apiService';
import { getCryptoStorageSecurityInfo } from '../services/cryptoStorage';

interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDatabase?: () => void;
  onOpenTranslation?: () => void;
}

export const SystemSettingsModal: React.FC<SystemSettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenDatabase,
  onOpenTranslation,
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

  useEffect(() => {
    if (!isOpen) {
      setProxyFeedback(null);
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
      const reconRes = await reconnectTelegramSessionsApi(false, true);
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

  if (!isOpen) return null;

  const cryptoInfo = getCryptoStorageSecurityInfo();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-lg bg-[#0e1621] border border-[#1e2f42] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#f5f7fa] max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#17212b] bg-[#121c27] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#2481cc]/20 border border-[#2481cc]/40 flex items-center justify-center text-[#2ba0ff]">
              <Settings className="w-5 h-5 text-[#2ba0ff]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">工作台系统管理</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#7f93a5] hover:text-white hover:bg-[#1a2838] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Section 1: Storage Security & Auth Isolation */}
          <div className="bg-[#121c27] border border-[#1e2f42] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className={`w-4 h-4 ${
                  cryptoInfo.mode === 'fallback_stream' ? 'text-amber-400' : 'text-emerald-400'
                }`}
              />
              <span className="text-sm font-semibold text-white">系统安全与加密状态</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-[#0c131c] border border-[#1e2f42]/60">
                <div className="text-[10px] text-[#7f93a5]">会话安全存储</div>
                <div
                  className={`font-medium mt-0.5 flex items-center gap-1 ${
                    cryptoInfo.mode === 'fallback_stream'
                      ? 'text-amber-400'
                      : cryptoInfo.mode === 'electron_aes_gcm'
                        ? 'text-sky-400'
                        : 'text-emerald-400'
                  }`}
                >
                  {cryptoInfo.mode === 'fallback_stream' ? (
                    <AlertCircle className="w-3 h-3 shrink-0" />
                  ) : (
                    <Lock className="w-3 h-3 shrink-0" />
                  )}
                  <span>{cryptoInfo.label}</span>
                </div>
                <p className="text-[10px] text-[#7f93a5] mt-1 leading-snug">{cryptoInfo.detail}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0c131c] border border-[#1e2f42]/60">
                <div className="text-[10px] text-[#7f93a5]">运行隔离与鉴权</div>
                <div className="text-[#2ba0ff] font-medium mt-0.5 flex items-center gap-1">
                  <Server className="w-3 h-3" />
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
              <div className="pt-2 border-t border-[#1e2f42] flex items-center justify-between gap-3 flex-wrap">
                {onOpenDatabase && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenDatabase();
                    }}
                    className="flex items-center gap-1.5 text-xs text-[#2ba0ff] hover:underline cursor-pointer"
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
                    className="flex items-center gap-1.5 text-xs text-[#2ba0ff] hover:underline cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>双向翻译设置</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Section 2: Telegram MTProto Built-in SOCKS Proxy */}
          <div className="bg-[#121c27] border border-[#1e2f42] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-[#2ba0ff]" />
                <span className="text-sm font-semibold text-white">Telegram MTProto 代理网络</span>
              </div>
              <label className="flex items-center gap-2 text-xs text-[#cfdbe5] cursor-pointer">
                <input
                  type="checkbox"
                  checked={proxyEnabled}
                  onChange={(e) => setProxyEnabled(e.target.checked)}
                  className="accent-[#2481cc] w-3.5 h-3.5 cursor-pointer"
                />
                <span>启用 SOCKS 代理</span>
              </label>
            </div>

            <div className={`grid grid-cols-3 gap-2.5 text-xs ${!proxyEnabled ? 'opacity-60' : ''}`}>
              <div>
                <label className="block text-[10px] text-[#7f93a5] mb-1">协议类型</label>
                <select
                  value={proxyType}
                  onChange={(e) => setProxyType(e.target.value === 'socks4' ? 'socks4' : 'socks5')}
                  className="w-full px-2.5 py-2 rounded-lg bg-[#0c131c] border border-[#1e2f42] text-white outline-none focus:border-[#2ba0ff]"
                >
                  <option value="socks5">SOCKS5</option>
                  <option value="socks4">SOCKS4</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[#7f93a5] mb-1">代理地址 (Host)</label>
                <input
                  type="text"
                  value={proxyHost}
                  onChange={(e) => setProxyHost(e.target.value)}
                  placeholder="127.0.0.1"
                  className="w-full px-2.5 py-2 rounded-lg bg-[#0c131c] border border-[#1e2f42] text-white outline-none focus:border-[#2ba0ff]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#7f93a5] mb-1">端口 (Port)</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={proxyPort}
                  onChange={(e) => setProxyPort(e.target.value)}
                  placeholder="7890"
                  className="w-full px-2.5 py-2 rounded-lg bg-[#0c131c] border border-[#1e2f42] text-white outline-none focus:border-[#2ba0ff]"
                />
              </div>
            </div>

            <div className={`grid grid-cols-2 gap-2.5 text-xs ${!proxyEnabled ? 'opacity-60' : ''}`}>
              <div>
                <label className="block text-[10px] text-[#7f93a5] mb-1">用户名（可选）</label>
                <input
                  type="text"
                  value={proxyUsername}
                  onChange={(e) => setProxyUsername(e.target.value)}
                  placeholder="无认证可留空"
                  className="w-full px-2.5 py-2 rounded-lg bg-[#0c131c] border border-[#1e2f42] text-white outline-none focus:border-[#2ba0ff]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#7f93a5] mb-1">密码（可选）</label>
                <input
                  type="password"
                  value={proxyPassword}
                  onChange={(e) => setProxyPassword(e.target.value)}
                  placeholder={hasExistingPassword ? '已保存密码（留空则保持不变）' : '无认证可留空'}
                  className="w-full px-2.5 py-2 rounded-lg bg-[#0c131c] border border-[#1e2f42] text-white outline-none focus:border-[#2ba0ff]"
                />
              </div>
            </div>

            {proxyFeedback && (
              <div
                className={`p-2.5 rounded-lg text-[11px] flex items-start gap-2 border ${
                  proxyFeedback.ok
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
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
                className="px-3 py-1.5 rounded-lg bg-[#1a2838] hover:bg-[#23364b] disabled:opacity-50 text-xs text-[#dce5ee] font-medium cursor-pointer transition-colors"
              >
                {isSavingProxy ? '保存中...' : '仅保存配置'}
              </button>
              <button
                type="button"
                disabled={isSavingProxy}
                onClick={() => handleSaveProxy(true)}
                className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fae] disabled:opacity-50 text-xs text-white font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSavingProxy ? 'animate-spin' : ''}`} />
                <span>保存并重连 Telegram</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#17212b] bg-[#121c27] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[#55697d]">HumanSense Internal Settings · v{APP_VERSION}</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#2481cc] hover:bg-[#1d6fae] text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            完成并关闭
          </button>
        </div>
      </div>
    </div>
  );
};
