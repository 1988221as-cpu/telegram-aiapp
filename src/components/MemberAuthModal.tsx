import React, { useState, useEffect } from 'react';
import {
  User,
  KeyRound,
  ArrowRight,
  ArrowLeft,
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
      setActiveTab(initialTab || 'login');
      setErrorMsg(initialError || null);
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

  const switchTab = (nextTab: 'login' | 'register' | 'redeem') => {
    setActiveTab(nextTab);
    setErrorMsg(null);
    setErrorCode(null);
    setSuccessMsg(null);
  };

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/55 dark:bg-black/80 aurora:bg-black/85 backdrop-blur-md select-none animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
        {/* Top HumanSense Brand Header */}
        <div className="p-6 pb-4 bg-gradient-to-b from-[#f0f7ff] to-white dark:from-[#101c2d] dark:to-[#0b131f] aurora:from-[#10222b] aurora:to-[#0c151b] border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex flex-col items-center text-center relative">
          <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-lg shadow-[#2481cc]/20 dark:shadow-[#2ba0ff]/25 aurora:shadow-[#0d9488]/25 mb-3 ring-2 ring-[#2481cc]/35 dark:ring-[#2ba0ff]/40 aurora:ring-[#2dd4bf]/40 bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] flex items-center justify-center">
            <img
              src="/app-icon.png"
              alt="HumanSense"
              className="w-full h-full object-cover"
            />
          </div>
          <h2 className="text-lg font-bold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] tracking-wide flex items-center gap-2">
            <span>HumanSense</span>
          </h2>
          {totalMembers > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#e8f3ff] dark:bg-[#132234] aurora:bg-[#112d36] border border-[#bfdbfe] dark:border-[#1e3148] aurora:border-[#2dd4bf]/30 text-[11px] text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4]">
                <Sparkles className="w-3 h-3" />
                <span>已认证会员: <strong className="text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] tabular-nums">{totalMembers}</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Sub-view navigation header (shown only after clicking into 卡密注册 or 卡密续费; front view keeps only 会员登录) */}
        {activeTab !== 'login' && (
          <div className="flex items-center justify-between px-6 py-2.5 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920]">
            <button
              type="button"
              onClick={() => switchTab('login')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回会员登录</span>
            </button>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]">
              {activeTab === 'register' ? (
                <>
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>卡密注册</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>卡密续费</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-3.5 max-h-[72vh] overflow-y-auto">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs flex flex-col gap-2 animate-in fade-in">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              {isNetworkFailure && !isProxyOpen && (
                <button
                  type="button"
                  onClick={() => setIsProxyOpen(true)}
                  className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-800 dark:text-rose-200 text-[11px] font-medium cursor-pointer transition-colors"
                >
                  <Wifi className="w-3 h-3" />
                  <span>展开配置 SOCKS5 代理以连接云端授权</span>
                </button>
              )}
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/12 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Username Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
              <span>{activeTab === 'register' ? '设置新会员账号' : '会员账号'}</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入您的会员账号名称"
              className="w-full bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-colors"
              autoFocus
              required
            />
          </div>

          {/* Password Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
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
              className="w-full bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-colors"
              required={activeTab !== 'redeem'}
            />
          </div>

          {/* Confirm Password (Only for register) */}
          {activeTab === 'register' && (
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <label className="text-xs font-medium text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                <span>确认密码</span>
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入密码以核对"
                className="w-full bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-colors"
                required
              />
            </div>
          )}

          {/* Card Key Input (For register & redeem) */}
          {(activeTab === 'register' || activeTab === 'redeem') && (
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <label className="text-xs font-medium text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] flex items-center gap-1.5">
                <Ticket className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>会员卡密激活码</span>
              </label>
              <input
                type="text"
                value={cardKey}
                onChange={(e) => setCardKey(e.target.value)}
                placeholder="例如：LX3D-XXXX-XXXX 或 LX30D-XXXX-XXXX"
                className="w-full bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] font-mono rounded-xl px-3.5 py-2.5 text-xs focus:outline-none transition-colors"
                required
              />
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#2481cc] to-[#2ba0ff] aurora:from-[#0d9488] aurora:to-[#14b8a6] hover:opacity-95 text-white font-semibold text-xs transition-all shadow-md shadow-[#2481cc]/25 aurora:shadow-[#0d9488]/25 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
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

          {/* Bottom-right entry actions for 卡密注册 & 卡密续费 right below the 登录 button */}
          {activeTab === 'login' ? (
            <div className="flex items-center justify-end gap-5 pt-0.5 text-xs">
              <button
                type="button"
                onClick={() => switchTab('register')}
                className="inline-flex items-center gap-1.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#2dd4bf] transition-colors cursor-pointer font-medium"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>卡密注册</span>
              </button>
              <button
                type="button"
                onClick={() => switchTab('redeem')}
                className="inline-flex items-center gap-1.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#2dd4bf] transition-colors cursor-pointer font-medium"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>卡密续费</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between pt-0.5 text-xs">
              <button
                type="button"
                onClick={() => switchTab('login')}
                className="inline-flex items-center gap-1 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回会员登录</span>
              </button>
              <button
                type="button"
                onClick={() => switchTab(activeTab === 'register' ? 'redeem' : 'register')}
                className="inline-flex items-center gap-1.5 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#2dd4bf] transition-colors cursor-pointer font-medium"
              >
                {activeTab === 'register' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>卡密续费</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>卡密注册</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Pre-login Proxy Configuration Accordion */}
          <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
            <button
              type="button"
              onClick={() => setIsProxyOpen((prev) => !prev)}
              className="w-full flex items-center justify-between py-1.5 text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Wifi className={`w-3.5 h-3.5 ${proxyConfig.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]'}`} />
                <span>网络代理设置 (SOCKS5 / SOCKS4)</span>
                {proxyConfig.enabled && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px]">
                    已启用 {proxyConfig.host}:{proxyConfig.port}
                  </span>
                )}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isProxyOpen ? 'rotate-180' : ''}`} />
            </button>

            {isProxyOpen && (
              <div className="mt-2 p-3 rounded-2xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] space-y-2.5 text-xs animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8]">启用本地/远程 SOCKS 代理转发授权与 Telegram</span>
                  <button
                    type="button"
                    onClick={() => setProxyConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
                    className={`w-9 h-5 rounded-full transition-colors cursor-pointer flex items-center px-0.5 ${
                      proxyConfig.enabled
                        ? 'bg-emerald-500 justify-end'
                        : 'bg-[#cbd5e1] dark:bg-[#1e3148] aurora:bg-[#203742] justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mb-1">协议类型</label>
                    <select
                      value={proxyConfig.type}
                      onChange={(e) =>
                        setProxyConfig((prev) => ({
                          ...prev,
                          type: e.target.value === 'socks4' ? 'socks4' : 'socks5',
                        }))
                      }
                      className="w-full bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2 py-1.5 text-[11px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    >
                      <option value="socks5">SOCKS5</option>
                      <option value="socks4">SOCKS4</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mb-1">代理主机</label>
                    <input
                      type="text"
                      value={proxyConfig.host}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, host: e.target.value }))}
                      placeholder="127.0.0.1"
                      className="w-full bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-[11px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] font-mono focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mb-1">端口</label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={proxyConfig.port}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, port: Number(e.target.value) || 0 }))}
                      placeholder="1080"
                      className="w-full bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-[11px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] font-mono focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mb-1">用户名 (可选)</label>
                    <input
                      type="text"
                      value={proxyConfig.username || ''}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, username: e.target.value }))}
                      placeholder="无认证可留空"
                      className="w-full bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-[11px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mb-1">密码 (可选)</label>
                    <input
                      type="password"
                      value={proxyConfig.password || ''}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder={proxyConfig.hasPassword ? '已保存（留空保留原密码）' : '无认证可留空'}
                      className="w-full bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] rounded-lg px-2.5 py-1.5 text-[11px] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                  </div>
                </div>

                {proxyNotice && (
                  <div
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] border ${
                      proxyNotice.ok
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                    }`}
                  >
                    {proxyNotice.text}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isSavingProxy}
                  onClick={handleSaveProxy}
                  className="w-full py-1.5 rounded-lg bg-[#e8f3ff] hover:bg-[#dbeafe] dark:bg-[#132234] dark:hover:bg-[#1b2f47] aurora:bg-[#112d36] aurora:hover:bg-[#153842] border border-[#bfdbfe] dark:border-[#1e3148] aurora:border-[#2dd4bf]/35 text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
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

