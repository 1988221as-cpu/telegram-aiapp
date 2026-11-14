import React, { useState, useEffect } from 'react';
import {
  Lock,
  User,
  KeyRound,
  ArrowRight,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Ticket,
  RefreshCw,
  Wifi,
  ChevronDown,
} from 'lucide-react';
import {
  memberLogin,
  memberRegister,
  memberRedeemCardKey,
  fetchAuthStatus,
  getPreLoginProxyApi,
  savePreLoginProxyApi,
} from '../services/apiService';
import { MemberUser, SystemProxyConfig } from '../types';

interface MemberAuthModalProps {
  isOpen: boolean;
  onSuccess: (user: MemberUser) => void;
  totalMembers?: number;
  initialTab?: 'login' | 'register' | 'redeem';
  initialError?: string | null;
}

const DEFAULT_PRELOGIN_PROXY: SystemProxyConfig = {
  enabled: false,
  type: 'socks5',
  host: '127.0.0.1',
  port: 1080,
  username: '',
  password: '',
  hasPassword: false,
};

export const MemberAuthModal: React.FC<MemberAuthModalProps> = ({
  isOpen,
  onSuccess,
  totalMembers = 0,
  initialTab,
  initialError,
}) => {
  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'redeem'>(initialTab || 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [cardKey, setCardKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError || null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [isProxyOpen, setIsProxyOpen] = useState(false);
  const [proxyConfig, setProxyConfig] = useState<SystemProxyConfig>(DEFAULT_PRELOGIN_PROXY);
  const [isSavingProxy, setIsSavingProxy] = useState(false);
  const [proxyNotice, setProxyNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialTab) setActiveTab(initialTab);
      if (initialError) setErrorMsg(initialError);
      setErrorCode(null);
      setSuccessMsg(null);
      setProxyNotice(null);
      getPreLoginProxyApi()
        .then((res) => {
          if (res.ok && res.config) {
            setProxyConfig({
              enabled: Boolean(res.config.enabled),
              type: res.config.type === 'socks4' ? 'socks4' : 'socks5',
              host: res.config.host || '127.0.0.1',
              port: Number(res.config.port) || 1080,
              username: res.config.username || '',
              password: '',
              hasPassword: Boolean(res.config.hasPassword),
            });
          }
        })
        .catch(() => {});
    }
  }, [isOpen, initialTab, initialError]);

  if (!isOpen) return null;

  const handleSaveProxy = async () => {
    setProxyNotice(null);
    setIsSavingProxy(true);
    try {
      const res = await savePreLoginProxyApi({
        enabled: proxyConfig.enabled,
        type: proxyConfig.type,
        host: proxyConfig.host.trim() || '127.0.0.1',
        port: Number(proxyConfig.port) || 1080,
        username: proxyConfig.username?.trim() || '',
        password: proxyConfig.password || '',
        preservePassword: !proxyConfig.password && Boolean(proxyConfig.hasPassword),
      });
      if (res.ok && res.config) {
        setProxyConfig({
          enabled: Boolean(res.config.enabled),
          type: res.config.type === 'socks4' ? 'socks4' : 'socks5',
          host: res.config.host || '127.0.0.1',
          port: Number(res.config.port) || 1080,
          username: res.config.username || '',
          password: '',
          hasPassword: Boolean(res.config.hasPassword),
        });
        setProxyNotice({
          ok: true,
          text: res.message || (res.config.enabled ? 'SOCKS 代理已启用，请重新点击上方登录/激活' : '已关闭代理，将直连云端授权中心'),
        });
      } else {
        setProxyNotice({ ok: false, text: res.error || '保存代理设置失败' });
      }
    } finally {
      setIsSavingProxy(false);
    }
  };

  const verifyLocalJwtAndUnlock = async (user: MemberUser, defaultSuccessMsg: string) => {
    const localStatus = await fetchAuthStatus();
    if (!localStatus.jwtConfigured) {
      setErrorMsg('云端认证已成功并保存 Token，但软件本地尚未配置验签公钥 (JWT_PUBLIC_KEY / server/authConfig.ts)。');
      return;
    }
    if (!localStatus.authenticated) {
      if (localStatus.authErrorCode === 'VIP_EXPIRED') {
        setErrorMsg(localStatus.authErrorMessage || '您的卡密会员已到期，请切换到「卡密续费」激活新卡密。');
        setActiveTab('redeem');
        return;
      }
      if (localStatus.authErrorCode === 'DEVICE_MISMATCH') {
        setErrorMsg(localStatus.authErrorMessage || '该账号已绑定至其它电脑设备（单账号仅限 1 台电脑），禁止跨机使用。');
        return;
      }
      if (localStatus.jwtMode === 'asymmetric') {
        setErrorMsg('云端 Token 未通过本地公钥验签或已过期，请确认本地公钥与云端私钥配对且签名算法为 RS256/ES256。');
      } else {
        setErrorMsg('云端 Token 未通过本地验签或已过期，请确认本地公钥或密钥配置一致。');
      }
      return;
    }
    setSuccessMsg(defaultSuccessMsg);
    setTimeout(() => {
      onSuccess(localStatus.user || user);
    }, 450);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setErrorCode(null);
    setSuccessMsg(null);

    const cleanUser = username.trim();
    if (!cleanUser) {
      setErrorMsg('请输入会员账号');
      return;
    }

    if (activeTab === 'register') {
      if (cleanUser.length < 3) {
        setErrorMsg('会员账号至少需 3 个字符');
        return;
      }
      if (password.length < 6) {
        setErrorMsg('密码长度至少需 6 位字符');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('两次输入的密码不一致，请核对');
        return;
      }
      if (!cardKey.trim()) {
        setErrorMsg('请输入注册激活卡密（支持 3 天试用卡密或 30 天包月卡密）');
        return;
      }

      setIsLoading(true);
      const res = await memberRegister(cleanUser, password, cardKey);
      if (res.ok && res.user) {
        await verifyLocalJwtAndUnlock(res.user, res.message || '卡密激活并注册成功！正在进入工作台...');
      } else {
        setErrorCode(res.code || null);
        setErrorMsg(res.error || '注册失败，请检查卡密是否有效或已被使用');
        if (res.code === 'CLOUD_AUTH_UNREACHABLE' || res.code === 'CLOUD_AUTH_TIMEOUT') {
          setIsProxyOpen(true);
        }
      }
      setIsLoading(false);
    } else if (activeTab === 'redeem') {
      if (!cardKey.trim()) {
        setErrorMsg('请输入新的 3 天试用或 30 天包月卡密');
        return;
      }
      setIsLoading(true);
      const res = await memberRedeemCardKey(cleanUser, cardKey, password || undefined);
      if (res.ok && res.user) {
        await verifyLocalJwtAndUnlock(res.user, res.message || '卡密续费成功！正在进入工作台...');
      } else {
        setErrorCode(res.code || null);
        setErrorMsg(res.error || '卡密续费失败，请核对卡密状态或账号密码');
        if (res.code === 'CLOUD_AUTH_UNREACHABLE' || res.code === 'CLOUD_AUTH_TIMEOUT') {
          setIsProxyOpen(true);
        }
      }
      setIsLoading(false);
    } else {
      if (!password) {
        setErrorMsg('请输入登录密码');
        return;
      }

      setIsLoading(true);
      const res = await memberLogin(cleanUser, password);
      if (res.ok && res.user) {
        await verifyLocalJwtAndUnlock(res.user, res.message || '登录成功！正在进入工作台...');
      } else {
        if (res.code === 'VIP_EXPIRED') {
          setActiveTab('redeem');
        }
        setErrorCode(res.code || null);
        setErrorMsg(res.error || '账号或密码错误，请核对后重试');
        if (res.code === 'CLOUD_AUTH_UNREACHABLE' || res.code === 'CLOUD_AUTH_TIMEOUT') {
          setIsProxyOpen(true);
        }
      }
      setIsLoading(false);
    }
  };

  const isNetworkFailure =
    errorCode === 'CLOUD_AUTH_UNREACHABLE' ||
    errorCode === 'CLOUD_AUTH_TIMEOUT' ||
    (errorMsg ? /无法连接|超时|代理|network|fetch/i.test(errorMsg) : false);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md select-none animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#111c28] border border-[#1e3145] rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#f5f7fa]">
        {/* Top HumanSense Brand Header */}
        <div className="p-6 pb-4 bg-gradient-to-b from-[#18293d] to-[#111c28] border-b border-[#1b2c3e] flex flex-col items-center text-center relative">
          <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-lg shadow-[#2481cc]/25 mb-3 ring-2 ring-[#2ba0ff]/40 bg-[#0d1620] flex items-center justify-center">
            <img
              src="/app-icon.png"
              alt="HumanSense"
              className="w-full h-full object-cover"
            />
          </div>
          <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
            <span>HumanSense</span>
          </h2>
          {totalMembers > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#1b2f44] border border-[#26415d] text-[11px] text-[#2ba0ff]">
                <Sparkles className="w-3 h-3" />
                <span>已认证会员: <strong className="text-white tabular-nums">{totalMembers}</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[#1a2b3c] bg-[#0d1620]">
          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setErrorMsg(null);
              setErrorCode(null);
            }}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'login'
                ? 'border-[#2ba0ff] text-[#2ba0ff] bg-[#142232]'
                : 'border-transparent text-[#7e95ab] hover:text-white'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>会员登录</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('register');
              setErrorMsg(null);
              setErrorCode(null);
            }}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'register'
                ? 'border-[#2ba0ff] text-[#2ba0ff] bg-[#142232]'
                : 'border-transparent text-[#7e95ab] hover:text-white'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>卡密注册</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('redeem');
              setErrorMsg(null);
              setErrorCode(null);
            }}
            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'redeem'
                ? 'border-[#2ba0ff] text-[#2ba0ff] bg-[#142232]'
                : 'border-transparent text-[#7e95ab] hover:text-white'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>卡密续费</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-3.5 max-h-[72vh] overflow-y-auto">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs flex flex-col gap-2 animate-in fade-in">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              {isNetworkFailure && !isProxyOpen && (
                <button
                  type="button"
                  onClick={() => setIsProxyOpen(true)}
                  className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] font-medium cursor-pointer transition-colors"
                >
                  <Wifi className="w-3 h-3" />
                  <span>展开配置 SOCKS5 代理以连接云端授权</span>
                </button>
              )}
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Username Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#7e95ab] flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[#2ba0ff]" />
              <span>{activeTab === 'register' ? '设置新会员账号' : '会员账号'}</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入您的会员账号名称"
              className="w-full bg-[#0a121b] border border-[#1e3145] focus:border-[#2ba0ff] text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-colors"
              autoFocus
              required
            />
          </div>

          {/* Password Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#7e95ab] flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#2ba0ff]" />
              <span>
                {activeTab === 'register'
                  ? '设置登录密码'
                  : '登录密码'}
              </span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入登录密码"
              className="w-full bg-[#0a121b] border border-[#1e3145] focus:border-[#2ba0ff] text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-colors"
              required={activeTab !== 'redeem'}
            />
          </div>

          {/* Confirm Password (Only for register) */}
          {activeTab === 'register' && (
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <label className="text-xs font-medium text-[#7e95ab] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#2ba0ff]" />
                <span>确认密码</span>
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入密码以核对"
                className="w-full bg-[#0a121b] border border-[#1e3145] focus:border-[#2ba0ff] text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-colors"
                required
              />
            </div>
          )}

          {/* Card Key Input (For register & redeem) */}
          {(activeTab === 'register' || activeTab === 'redeem') && (
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <label className="text-xs font-medium text-[#7e95ab] flex items-center gap-1.5">
                <Ticket className="w-3.5 h-3.5 text-amber-400" />
                <span>会员卡密激活码</span>
              </label>
              <input
                type="text"
                value={cardKey}
                onChange={(e) => setCardKey(e.target.value)}
                placeholder="例如：LX3D-XXXX-XXXX 或 LX30D-XXXX-XXXX"
                className="w-full bg-[#0a121b] border border-[#1e3145] focus:border-[#2ba0ff] text-white font-mono rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-colors"
                required
              />
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#2481cc] to-[#2ba0ff] hover:opacity-95 text-white font-semibold text-xs transition-all shadow-md shadow-[#2481cc]/25 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span>正在加密校验与绑定设备...</span>
            ) : activeTab === 'login' ? (
              <>
                <span>登录</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : activeTab === 'redeem' ? (
              <>
                <span>激活新卡密并续费时长</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>验证卡密并注册登录</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          {/* Pre-login Proxy Configuration Accordion */}
          <div className="pt-2 border-t border-[#1a2b3c]">
            <button
              type="button"
              onClick={() => setIsProxyOpen((prev) => !prev)}
              className="w-full flex items-center justify-between py-1.5 text-[11px] text-[#7e95ab] hover:text-white transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Wifi className={`w-3.5 h-3.5 ${proxyConfig.enabled ? 'text-emerald-400' : 'text-[#2ba0ff]'}`} />
                <span>网络代理设置 (SOCKS5 / SOCKS4)</span>
                {proxyConfig.enabled && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px]">
                    已启用 {proxyConfig.host}:{proxyConfig.port}
                  </span>
                )}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isProxyOpen ? 'rotate-180' : ''}`} />
            </button>

            {isProxyOpen && (
              <div className="mt-2 p-3 rounded-2xl bg-[#0a121b] border border-[#1e3145] space-y-2.5 text-xs animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#a3b8cc]">启用本地/远程 SOCKS 代理转发授权与 Telegram</span>
                  <button
                    type="button"
                    onClick={() => setProxyConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
                    className={`w-9 h-5 rounded-full transition-colors cursor-pointer flex items-center px-0.5 ${
                      proxyConfig.enabled ? 'bg-emerald-500 justify-end' : 'bg-[#23374d] justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-[#7e95ab] mb-1">协议类型</label>
                    <select
                      value={proxyConfig.type}
                      onChange={(e) =>
                        setProxyConfig((prev) => ({
                          ...prev,
                          type: e.target.value === 'socks4' ? 'socks4' : 'socks5',
                        }))
                      }
                      className="w-full bg-[#111c28] border border-[#1e3145] rounded-lg px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-[#2ba0ff]"
                    >
                      <option value="socks5">SOCKS5</option>
                      <option value="socks4">SOCKS4</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#7e95ab] mb-1">代理主机</label>
                    <input
                      type="text"
                      value={proxyConfig.host}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, host: e.target.value }))}
                      placeholder="127.0.0.1"
                      className="w-full bg-[#111c28] border border-[#1e3145] rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono focus:outline-none focus:border-[#2ba0ff]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#7e95ab] mb-1">端口</label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={proxyConfig.port}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, port: Number(e.target.value) || 0 }))}
                      placeholder="1080"
                      className="w-full bg-[#111c28] border border-[#1e3145] rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono focus:outline-none focus:border-[#2ba0ff]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-[#7e95ab] mb-1">用户名 (可选)</label>
                    <input
                      type="text"
                      value={proxyConfig.username || ''}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, username: e.target.value }))}
                      placeholder="无认证可留空"
                      className="w-full bg-[#111c28] border border-[#1e3145] rounded-lg px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-[#2ba0ff]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#7e95ab] mb-1">密码 (可选)</label>
                    <input
                      type="password"
                      value={proxyConfig.password || ''}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder={proxyConfig.hasPassword ? '已保存（留空保留原密码）' : '无认证可留空'}
                      className="w-full bg-[#111c28] border border-[#1e3145] rounded-lg px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-[#2ba0ff]"
                    />
                  </div>
                </div>

                {proxyNotice && (
                  <div
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] ${
                      proxyNotice.ok
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    {proxyNotice.text}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isSavingProxy}
                  onClick={handleSaveProxy}
                  className="w-full py-1.5 rounded-lg bg-[#1a2c40] hover:bg-[#223952] border border-[#2a4563] text-[#8bc9ff] text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingProxy ? '正在保存并应用代理...' : '保存代理设置'}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

