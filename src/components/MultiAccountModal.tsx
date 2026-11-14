import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Send,
  Lock,
  KeyRound,
  AlertCircle,
  Smartphone,
  LogOut,
  Mail,
  ChevronDown,
  Users,
} from 'lucide-react';
import QRCode from 'qrcode';
import { Account } from '../types';
import {
  getAuthHeaders,
  disconnectTelegramAccount,
  fetchWithTimeout,
  fetchTelegramCredsStatusApi,
  syncCloudTelegramCredsApi,
} from '../services/apiService';
import { COMMON_COUNTRY_CODES, CountryPreset } from '../data/countryCodes';

export type { CountryPreset };
export { COMMON_COUNTRY_CODES };

export function sanitizePhoneInput(raw: string): string {
  let val = raw;
  // Convert full-width digits to standard ASCII digits
  val = val.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // Convert leading 00 to +
  if (val.trim().startsWith('00')) {
    val = '+' + val.trim().slice(2);
  }
  return val;
}

export function detectCountryFromPhone(phoneVal: string): CountryPreset | null {
  const clean = phoneVal.trim().replace(/^00/, '+');
  const sorted = [...COMMON_COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (clean === c.code || clean.startsWith(c.code)) {
      return c;
    }
  }
  return null;
}

interface MultiAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  activeAccountId: string;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: (account: Partial<Account>) => void;
  onDeleteAccount: (id: string) => void;
  reloginAccount?: Account | null;
}

export const MultiAccountModal: React.FC<MultiAccountModalProps> = ({
  isOpen,
  onClose,
  accounts,
  activeAccountId,
  onSelectAccount,
  onAddAccount,
  onDeleteAccount,
  reloginAccount,
}) => {
  const [loginMethod, setLoginMethod] = useState<'phone' | 'qr'>('qr');
  const [showAccountsPanel, setShowAccountsPanel] = useState(false);

  // Phone Login State (Country dropdown + Dial code + Local number)
  const [selectedCountryIso, setSelectedCountryIso] = useState<string>('US');
  const [dialCode, setDialCode] = useState('+1');
  const [localPhone, setLocalPhone] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [deliveryInfo, setDeliveryInfo] = useState<{
    channel: string;
    note: string;
    warning?: string | null;
    emailPattern?: string;
  } | null>(null);

  const normalizedDialCode = (() => {
    const cleaned = sanitizePhoneInput(dialCode).replace(/[^\d+]/g, '');
    if (!cleaned) return '+';
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  })();

  const isoCountry = COMMON_COUNTRY_CODES.find((c) => c.iso === selectedCountryIso);
  const selectedCountry =
    isoCountry && isoCountry.code === normalizedDialCode
      ? isoCountry
      : COMMON_COUNTRY_CODES.find((c) => c.code === normalizedDialCode) || null;

  const getCombinedPhone = (): string => {
    const cleanLocalRaw = sanitizePhoneInput(localPhone).trim();
    if (cleanLocalRaw.startsWith('+')) {
      return '+' + cleanLocalRaw.slice(1).replace(/[^\d]/g, '');
    }
    const dialDigits = normalizedDialCode.replace(/[^\d]/g, '');
    const localDigits = cleanLocalRaw.replace(/[^\d]/g, '');
    if (!localDigits) return '';
    return `+${dialDigits}${localDigits}`;
  };

  const prefillPhoneNumber = (rawPhone?: string) => {
    if (!rawPhone) return;
    const sanitized = sanitizePhoneInput(rawPhone);
    if (sanitized.trim().startsWith('+')) {
      const matched = detectCountryFromPhone(sanitized);
      if (matched) {
        setSelectedCountryIso(matched.iso);
        setDialCode(matched.code);
        setLocalPhone(sanitized.trim().slice(matched.code.length).trimStart());
        return;
      }
    }
    setLocalPhone(sanitized);
  };

  const [credsStatus, setCredsStatus] = useState<{
    checked: boolean;
    configured: boolean;
    error: string | null;
  }>({ checked: false, configured: true, error: null });
  const [isSyncingCreds, setIsSyncingCreds] = useState(false);

  const checkCloudCredentials = async (forceRefresh = false) => {
    const res = await fetchTelegramCredsStatusApi(forceRefresh);
    setCredsStatus({
      checked: true,
      configured: res.configured,
      error: res.configured ? null : res.cloudSyncError || '云端 Telegram 接入凭据暂未就绪，请重试同步',
    });
  };

  useEffect(() => {
    if (!isOpen) {
      resetState();
    } else {
      void checkCloudCredentials(false);
      if (reloginAccount) {
        if (reloginAccount.phone && /\d/.test(reloginAccount.phone)) {
          prefillPhoneNumber(reloginAccount.phone);
          setLoginMethod('phone');
        } else {
          setLoginMethod('qr');
        }
      }
    }
  }, [isOpen, reloginAccount]);

  // QR Code Login State
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isLoadingQr, setIsLoadingQr] = useState(false);
  const [isSilentRefreshing, setIsSilentRefreshing] = useState(false);
  const [qrExpiresIn, setQrExpiresIn] = useState(30);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrNeeds2FA, setQrNeeds2FA] = useState(false);
  const [qrPasswordInput, setQrPasswordInput] = useState('');
  const [qrIsScanned, setQrIsScanned] = useState(false);
  const [isSubmittingQrPassword, setIsSubmittingQrPassword] = useState(false);
  const qrPollFailCountRef = useRef(0);
  const qrIsScannedRef = useRef(false);
  const qrNeeds2FARef = useRef(false);
  useEffect(() => {
    qrIsScannedRef.current = qrIsScanned;
  }, [qrIsScanned]);
  useEffect(() => {
    qrNeeds2FARef.current = qrNeeds2FA;
  }, [qrNeeds2FA]);

  const extractApiError = (res: Response, data: any, fallback: string): string => {
    if (res.status === 429 || data?.error === 'Too Many Attempts' || data?.error === 'Too Many Requests') {
      return data?.message || '操作尝试过于频繁，请 1 分钟后再试';
    }
    return data?.error || data?.message || (res.ok ? fallback : `${fallback} (HTTP ${res.status})`);
  };
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<{
    accountId: string;
    message: string;
    canForceLocal?: boolean;
  } | null>(null);

  // Generate QR Code locally with High error correction so center Telegram icon never impairs scanning
  useEffect(() => {
    if (!qrUrl) {
      setQrDataUrl(null);
      return;
    }
    let isCancelled = false;
    QRCode.toDataURL(qrUrl, {
      width: 256,
      margin: 1,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!isCancelled) {
          setQrDataUrl(url);
        }
      })
      .catch((err) => {
        console.error('Failed to generate QR code locally:', err);
        if (!isCancelled) {
          setQrError('本地生成二维码失败');
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [qrUrl]);

  // Countdown timer for code resend
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  // Request QR Code Login Token from server with silent background refresh support
  const fetchQrToken = async (silent = false) => {
    if (silent && (qrIsScannedRef.current || qrNeeds2FARef.current)) {
      return;
    }
    const previousSessionId = qrSessionId;
    if (previousSessionId) {
      fetchWithTimeout('/api/telegram/user/cancel-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ sessionId: previousSessionId }),
      }, 5000).catch(() => {});
    }

    const activeNonExpiredCount = accounts.filter((a) => a.status !== 'expired').length;
    if (!reloginAccount && activeNonExpiredCount >= 20) {
      if (!silent) setQrError('已达到单机多账号关联上限（最多 20 个账号），请先退出闲置账号。');
      return;
    }

    if (!silent) {
      setIsLoadingQr(true);
      setQrError(null);
    } else {
      setIsSilentRefreshing(true);
    }
    setQrNeeds2FA(false);
    setQrPasswordInput('');
    setQrIsScanned(false);
    qrPollFailCountRef.current = 0;
    try {
      const res = await fetchWithTimeout(
        '/api/telegram/user/qr-token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({}),
        },
        20000
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        if (!silent) setQrError(extractApiError(res, data, '生成二维码失败'));
      } else {
        setQrError(null);
        setQrSessionId(data.sessionId);
        setQrUrl(data.qrUrl);
        const duration = Number(data.expiresIn) || 30;
        setQrExpiresIn(duration);
      }
    } catch (e: any) {
      if (!silent) setQrError(e.message || '网络连接异常');
    } finally {
      setIsLoadingQr(false);
      setIsSilentRefreshing(false);
    }
  };

  // Submit 2FA password for QR Login
  const handleQrSubmitPassword = async () => {
    if (!qrSessionId || !qrPasswordInput.trim()) return;
    setIsSubmittingQrPassword(true);
    setQrError(null);
    try {
      const res = await fetchWithTimeout(
        '/api/telegram/user/qr-password',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            sessionId: qrSessionId,
            password: qrPasswordInput.trim(),
          }),
        },
        20000
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && data?.isAuthorized && data?.user) {
        const userData = data.user;
        setAuthSuccess(`登录成功！欢迎回来，${userData.firstName || 'Telegram 用户'}`);
        onAddAccount({
          id: `acc_tg_${userData.id}`,
          name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Telegram 账号',
          username: userData.username || `@${userData.id}`,
          phone: userData.phone || '',
          avatarBg: '#2481cc',
          avatarInitial: (userData.firstName || 'TG').slice(0, 2).toUpperCase(),
          unreadTotal: 0,
          isActive: true,
          status: 'online',
          bio: 'Telegram 扫码登录账号 (已连接)',
        });
        setTimeout(() => {
          onClose();
          resetState();
        }, 1000);
      } else {
        setQrError(extractApiError(res, data, '两步验证密码验证失败'));
      }
    } catch (e: any) {
      setQrError(e.message || '网络连接异常');
    } finally {
      setIsSubmittingQrPassword(false);
    }
  };

  // Auto fetch QR code when switching to QR view (skip when reloginAccount is redirecting into phone login)
  useEffect(() => {
    const willSwitchToPhoneRelogin = Boolean(reloginAccount?.phone && /\d/.test(reloginAccount.phone));
    if (loginMethod === 'qr' && isOpen && !willSwitchToPhoneRelogin) {
      if (!qrUrl) {
        fetchQrToken();
      }
    }
  }, [loginMethod, isOpen, reloginAccount]);

  // 30-second countdown timer with automatic silent background refresh
  useEffect(() => {
    if (loginMethod !== 'qr' || !qrUrl || !isOpen || qrIsScanned || qrNeeds2FA) return;
    const timer = setInterval(() => {
      setQrExpiresIn((prev) => {
        if (prev <= 1) {
          fetchQrToken(true);
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [loginMethod, qrUrl, isOpen, qrIsScanned, qrNeeds2FA]);

  // Poll QR Code Authorization Status
  useEffect(() => {
    if (loginMethod !== 'qr' || !qrSessionId || !isOpen) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetchWithTimeout(
          `/api/telegram/user/qr-status?sessionId=${encodeURIComponent(qrSessionId)}`,
          {
            headers: getAuthHeaders(),
          },
          8000
        );
        const data = await res.json().catch(() => ({}));

        if (!res.ok || (data?.ok === false && !data?.waitingForScan && !data?.needsPassword && !data?.isAuthorized)) {
          qrPollFailCountRef.current += 1;
          if (data?.error) {
            setQrError(data.error);
          } else if (qrPollFailCountRef.current >= 2) {
            setQrError('二维码状态查询失败，请点击刷新重试');
          }
          return;
        }

        qrPollFailCountRef.current = 0;

        if (data.needsPassword) {
          setQrNeeds2FA(true);
          setQrIsScanned(true);
        } else if (data.isScanned) {
          setQrIsScanned(true);
        }

        if (data.isAuthorized && data.user) {
          clearInterval(interval);
          const userData = data.user;
          setAuthSuccess(`登录成功！欢迎回来，${userData.firstName || 'Telegram 用户'}`);
          onAddAccount({
            id: `acc_tg_${userData.id}`,
            name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Telegram 账号',
            username: userData.username || `@${userData.id}`,
            phone: userData.phone || '',
            avatarBg: '#2481cc',
            avatarInitial: (userData.firstName || 'TG').slice(0, 2).toUpperCase(),
            unreadTotal: 0,
            isActive: true,
            status: 'online',
            bio: 'Telegram 扫码登录账号 (已连接)',
          });
          setTimeout(() => {
            onClose();
            resetState();
          }, 1000);
        } else if (data.error && !data.waitingForScan) {
          setQrError(data.error);
        } else if (data.qrUrl && data.qrUrl !== qrUrl) {
          setQrError(null);
          setQrUrl(data.qrUrl);
          if (data.expiresIn) {
            setQrExpiresIn(data.expiresIn);
          }
        }
      } catch {
        qrPollFailCountRef.current += 1;
        if (qrPollFailCountRef.current >= 2) {
          setQrError('网络连接异常，无法检测扫码状态，请检查网络后刷新重试');
        }
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [loginMethod, qrSessionId, isOpen]);

  // Handle pasted/typed local phone input (auto-extract international dial code if prefixed with + or 00)
  const handleLocalPhoneChange = (raw: string) => {
    const sanitized = sanitizePhoneInput(raw);
    if (sanitized.trim().startsWith('+')) {
      const matched = detectCountryFromPhone(sanitized);
      if (matched) {
        setSelectedCountryIso(matched.iso);
        setDialCode(matched.code);
        setLocalPhone(sanitized.trim().slice(matched.code.length).trimStart());
        return;
      }
    }
    setLocalPhone(sanitized);
  };

  // Send Code Handler
  const handleSendCode = async () => {
    const fullPhone = getCombinedPhone();
    if (!fullPhone || fullPhone.length < 5) {
      setAuthError('请输入有效的手机号码');
      return;
    }
    const targetDigits = fullPhone.replace(/[^\d]/g, '');
    const isExistingOrRelogin =
      Boolean(reloginAccount) ||
      accounts.some((a) => a.phone && a.phone.replace(/[^\d]/g, '') === targetDigits);
    const activeNonExpiredCount = accounts.filter((a) => a.status !== 'expired').length;
    if (!isExistingOrRelogin && activeNonExpiredCount >= 20) {
      setAuthError('已达到单机多账号关联上限（最多 20 个账号），请先退出闲置账号。');
      return;
    }
    setIsSendingCode(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const res = await fetchWithTimeout(
        '/api/telegram/user/send-code',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            phone: fullPhone,
          }),
        },
        20000
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        const errorMsg = extractApiError(res, data, '验证码发送失败');
        setAuthError(errorMsg);
        const floodMatch = errorMsg.match(/(\d+)\s*秒/);
        if (floodMatch) {
          const secs = parseInt(floodMatch[1], 10);
          if (secs > 0) setResendCountdown(secs);
        }
      } else {
        setCodeSent(true);
        setResendCountdown(data.timeout || 60);
        setDeliveryInfo({
          channel: data.deliveryChannel || 'app',
          note: data.message || '',
          warning: data.publicIdWarning,
          emailPattern: data.emailPattern,
        });
        setAuthSuccess(data.message || '官方验证码已发送至您的客户端！');
      }
    } catch (e: any) {
      setAuthError(e.message || '网络连接异常');
    } finally {
      setIsSendingCode(false);
    }
  };

  // Resend Code Handler
  const handleResendCode = async () => {
    const fullPhone = getCombinedPhone();
    if (!fullPhone) return;
    setIsResendingCode(true);
    setAuthError(null);
    try {
      const res = await fetchWithTimeout(
        '/api/telegram/user/resend-code',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ phone: fullPhone }),
        },
        20000
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        const errorMsg = extractApiError(res, data, '重发验证码失败');
        if (data?.code === 'TELEGRAM_AUTH_SESSION_EXPIRED') {
          setCodeSent(false);
          setNeeds2FA(false);
        }
        setAuthError(errorMsg);
        const floodMatch = errorMsg.match(/(\d+)\s*秒/);
        if (floodMatch) {
          const secs = parseInt(floodMatch[1], 10);
          if (secs > 0) setResendCountdown(secs);
        }
      } else {
        setResendCountdown(data.timeout || 60);
        if (data.deliveryChannel) {
          setDeliveryInfo((prev) => ({
            channel: data.deliveryChannel,
            note: data.message || '',
            warning: prev?.warning,
            emailPattern: prev?.emailPattern,
          }));
        }
        setAuthSuccess(data.message || '已申请重发验证码！');
      }
    } catch (e: any) {
      setAuthError(e.message || '网络连接异常');
    } finally {
      setIsResendingCode(false);
    }
  };

  // Verify Code and Login
  const handleVerifyCode = async () => {
    const fullPhone = getCombinedPhone();
    if (!verificationCode.trim()) {
      setAuthError('请输入收到的验证码');
      return;
    }
    setIsVerifyingCode(true);
    setAuthError(null);
    try {
      const res = await fetchWithTimeout(
        '/api/telegram/user/verify-code',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            phone: fullPhone,
            code: verificationCode.trim(),
            password: cloudPassword.trim() || undefined,
          }),
        },
        20000
      );
      const data = await res.json().catch(() => ({}));
      if (data?.needsPassword) {
        setNeeds2FA(true);
        setAuthError(data.error || '您的账号设置了两步验证密码，请输入密码完成登录');
      } else if (!res.ok || !data?.ok) {
        if (data?.code === 'TELEGRAM_AUTH_SESSION_EXPIRED') {
          setCodeSent(false);
          setNeeds2FA(false);
          setVerificationCode('');
        }
        setAuthError(extractApiError(res, data, '验证失败'));
      } else {
        setAuthSuccess('真实 Telegram 账号授权登录成功！');
        const userData = data.user || {};
        onAddAccount({
          id: `acc_tg_${userData.id}`,
          name: userData.firstName || '我的电报账号',
          username: userData.username || `@user_${String(userData.id).slice(-4)}`,
          phone: userData.phone || fullPhone,
          avatarBg: '#2481cc',
          avatarInitial: (userData.firstName || 'TG').slice(0, 2).toUpperCase(),
          unreadTotal: 0,
          isActive: true,
          status: 'online',
          bio: 'Telegram 手机号登录账号 (已连接)',
        });
        setTimeout(() => {
          onClose();
          resetState();
        }, 1000);
      }
    } catch (e: any) {
      setAuthError(e.message || '网络连接失败');
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const resetState = () => {
    const fullPhone = getCombinedPhone();
    if (fullPhone && codeSent) {
      fetchWithTimeout('/api/telegram/user/cancel-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ phone: fullPhone }),
      }, 5000).catch(() => {});
    }
    if (qrSessionId) {
      fetchWithTimeout('/api/telegram/user/cancel-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ sessionId: qrSessionId }),
      }, 5000).catch(() => {});
    }
    qrPollFailCountRef.current = 0;
    setCodeSent(false);
    setVerificationCode('');
    setCloudPassword('');
    setNeeds2FA(false);
    setAuthError(null);
    setAuthSuccess(null);
    setQrSessionId(null);
    setQrUrl(null);
    setQrError(null);
    setQrNeeds2FA(false);
    setQrPasswordInput('');
    setQrIsScanned(false);
    setDeliveryInfo(null);
    setQrExpiresIn(30);
    setIsSilentRefreshing(false);
    setShowAccountsPanel(false);
    setConfirmingDeleteId(null);
    setDisconnectingId(null);
    setDisconnectError(null);
  };

  const handleSwitchLoginMethod = (method: 'phone' | 'qr') => {
    if (loginMethod === 'qr' && method === 'phone' && qrSessionId) {
      fetchWithTimeout('/api/telegram/user/cancel-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ sessionId: qrSessionId }),
      }, 5000).catch(() => {});
      setQrSessionId(null);
      setQrUrl(null);
    }
    setLoginMethod(method);
    setAuthError(null);
    setAuthSuccess(null);
    setQrError(null);
  };

  // Immediate 0-second cleanup when closing or unmounting
  useEffect(() => {
    return () => {
      if (qrSessionId) {
        fetchWithTimeout('/api/telegram/user/cancel-qr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ sessionId: qrSessionId }),
        }, 5000).catch(() => {});
      }
    };
  }, [qrSessionId]);

  if (!isOpen) return null;

  const handleBackClose = () => {
    if (loginMethod === 'phone' && codeSent) {
      const fullPhone = getCombinedPhone();
      if (fullPhone) {
        fetchWithTimeout('/api/telegram/user/cancel-auth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ phone: fullPhone }),
        }, 5000).catch(() => {});
      }
      setCodeSent(false);
      setNeeds2FA(false);
      setVerificationCode('');
      setAuthError(null);
      setAuthSuccess(null);
      return;
    }
    onClose();
    resetState();
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 left-[54px] z-20 bg-[#f4f7fa] dark:bg-[#05080f] aurora:bg-[#081116] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex flex-col overflow-hidden select-none animate-in fade-in duration-150">
      {/* Top Minimal Header aligned with Window Edges */}
      <div className="h-12 px-5 flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={handleBackClose}
          title="返回"
          className="p-2 -ml-2 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-white aurora:hover:text-[#ecf6f8] hover:bg-[#e2e8f0] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {accounts && accounts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAccountsPanel((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-[#2481cc] hover:text-[#1d6fb3] dark:text-[#2ba0ff] dark:hover:text-[#7cc4ff] aurora:text-[#2dd4bf] aurora:hover:text-[#5eead4] cursor-pointer tabular-nums transition-colors"
          >
            <Users className="w-3.5 h-3.5" />
            <span>已关联账号 ({accounts.length}/20)</span>
          </button>
        )}
      </div>

      {/* Optional Slide-Down Connected Accounts Manager */}
      {showAccountsPanel && accounts && accounts.length > 0 && (
        <div className="mx-auto w-full max-w-md px-5 pb-3 animate-in fade-in duration-150">
          <div className="p-3 rounded-xl bg-white dark:bg-[#0e1726] aurora:bg-[#101c23] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] shadow-sm space-y-1.5 max-h-56 overflow-y-auto">
            {accounts.map((acc) => {
              const isCurrent = acc.id === activeAccountId;
              const isConfirming = confirmingDeleteId === acc.id;
              const isDisconnecting = disconnectingId === acc.id;
              const accError = disconnectError?.accountId === acc.id ? disconnectError : null;
              return (
                <div
                  key={acc.id}
                  className={`flex flex-col p-2 rounded-lg transition-colors ${
                    isCurrent
                      ? 'bg-[#e8f3ff] dark:bg-[#2ba0ff]/15 aurora:bg-[#112d36] text-[#0f172a] dark:text-white aurora:text-[#ecf6f8]'
                      : 'hover:bg-[#f1f5f9] dark:hover:bg-[#152438] aurora:hover:bg-[#152934] text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                      onClick={() => {
                        onSelectAccount(acc.id);
                        onClose();
                        resetState();
                      }}
                    >
                      <div className="relative shrink-0">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: acc.avatarBg || '#2481cc' }}
                        >
                          {acc.avatarInitial || 'TG'}
                        </div>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#0e1726] aurora:border-[#101c23] ${
                            acc.status === 'online'
                              ? 'bg-emerald-400'
                              : acc.status === 'away'
                              ? 'bg-amber-400'
                              : acc.status === 'expired'
                              ? 'bg-rose-500'
                              : 'bg-slate-400'
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate flex items-center gap-1.5">
                          <span className="truncate">{acc.name}</span>
                          {isCurrent && (
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-normal shrink-0">· 当前</span>
                          )}
                          {acc.status === 'expired' && (
                            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-normal shrink-0">· 已失效</span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate">{acc.phone || acc.username}</div>
                      </div>
                    </div>

                    {isConfirming ? (
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <button
                          type="button"
                          disabled={isDisconnecting}
                          onClick={async () => {
                            setDisconnectingId(acc.id);
                            setDisconnectError(null);
                            const res = await disconnectTelegramAccount(acc.id, acc.phone);
                            setDisconnectingId(null);
                            if (res.ok) {
                              setConfirmingDeleteId(null);
                              onDeleteAccount(acc.id);
                            } else {
                              setDisconnectError({
                                accountId: acc.id,
                                message: res.error || '云端注销失败',
                                canForceLocal: res.canForceLocal,
                              });
                            }
                          }}
                          className="px-2 py-1 rounded bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-[11px] font-medium cursor-pointer transition-colors"
                        >
                          {isDisconnecting ? '注销中...' : '确认退出'}
                        </button>
                        <button
                          type="button"
                          disabled={isDisconnecting}
                          onClick={() => {
                            setConfirmingDeleteId(null);
                            setDisconnectError(null);
                          }}
                          className="px-2 py-1 rounded bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#1b2f47] aurora:bg-[#13252e] aurora:hover:bg-[#1a3340] text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] text-[11px] cursor-pointer transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {acc.status === 'expired' && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowAccountsPanel(false);
                              if (acc.phone && /\d/.test(acc.phone)) {
                                prefillPhoneNumber(acc.phone);
                                handleSwitchLoginMethod('phone');
                              } else {
                                handleSwitchLoginMethod('qr');
                                void fetchQrToken();
                              }
                            }}
                            className="px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 text-[11px] font-medium cursor-pointer transition-colors"
                          >
                            重新登录
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingDeleteId(acc.id);
                            setDisconnectError(null);
                          }}
                          className="p-1.5 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="断开并退出该账号"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {accError && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-rose-700 dark:text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md px-2 py-1">
                      <span className="truncate">{accError.message}</span>
                      {accError.canForceLocal && (
                        <button
                          type="button"
                          disabled={isDisconnecting}
                          onClick={async () => {
                            setDisconnectingId(acc.id);
                            const forced = await disconnectTelegramAccount(acc.id, acc.phone, true);
                            setDisconnectingId(null);
                            if (forced.ok) {
                              setConfirmingDeleteId(null);
                              setDisconnectError(null);
                              onDeleteAccount(acc.id);
                            }
                          }}
                          className="text-amber-700 dark:text-amber-300 hover:underline shrink-0 cursor-pointer"
                        >
                          仅移除本地
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Centered Login Stage */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-6 pb-10">
        {reloginAccount && (
          <div className="w-full max-w-[340px] mb-4 flex items-center gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-200 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="truncate">
              正在重新登录已失效账号：{reloginAccount.name} ({reloginAccount.phone || reloginAccount.username || reloginAccount.id})
            </span>
          </div>
        )}

        {credsStatus.checked && !credsStatus.configured && (
          <div className="w-full max-w-[340px] mb-5 flex flex-col gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="flex-1 leading-relaxed">
                {credsStatus.error || '云端 Telegram 接入凭据未同步，无法发起扫码或验证码登录。'}
              </div>
            </div>
            <button
              type="button"
              disabled={isSyncingCreds}
              onClick={async () => {
                setIsSyncingCreds(true);
                const syncRes = await syncCloudTelegramCredsApi();
                setIsSyncingCreds(false);
                if (syncRes.ok) {
                  setCredsStatus({ checked: true, configured: true, error: null });
                  if (loginMethod === 'qr') {
                    void fetchQrToken(false);
                  }
                } else {
                  setCredsStatus({
                    checked: true,
                    configured: false,
                    error: syncRes.error || '同步云端授权凭据失败',
                  });
                }
              }}
              className="self-end px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncingCreds ? 'animate-spin' : ''}`} />
              <span>{isSyncingCreds ? '同步中...' : '重新同步授权凭据'}</span>
            </button>
          </div>
        )}

        {/* Global Status Alerts (Phone mode or Success) */}
        {authSuccess && (
          <div className="w-full max-w-[340px] mb-5 flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{authSuccess}</span>
          </div>
        )}

        {loginMethod === 'phone' && authError && (
          <div className="w-full max-w-[340px] mb-5 flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <div className="flex-1 leading-relaxed">{authError}</div>
          </div>
        )}

        {/* 1. QR Code Login View (Telegram Desktop Official Style) */}
        {loginMethod === 'qr' && (
          <div className="w-full max-w-[380px] flex flex-col items-center text-center">
            {qrNeeds2FA ? (
              <div className="w-full max-w-[340px] text-left flex flex-col gap-5">
                <div>
                  <h2 className="text-xl font-medium text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] mb-1.5">输入两步验证密码</h2>
                  <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">手机扫码已确认，请输入您的云端两步验证密码。</p>
                </div>

                {qrError && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <span>{qrError}</span>
                  </div>
                )}

                <div className="relative">
                  <KeyRound className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]" />
                  <input
                    type="password"
                    value={qrPasswordInput}
                    onChange={(e) => setQrPasswordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && qrPasswordInput.trim() && !isSubmittingQrPassword) {
                        handleQrSubmitPassword();
                      }
                    }}
                    placeholder="两步验证密码"
                    autoFocus
                    className="w-full pl-7 pr-3 pb-2.5 pt-1 bg-transparent border-b border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] text-sm text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] outline-none transition-colors"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleQrSubmitPassword}
                  disabled={isSubmittingQrPassword || !qrPasswordInput.trim()}
                  className="w-full py-3 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer"
                >
                  {isSubmittingQrPassword ? '正在验证...' : '提交并登录'}
                </button>

                <button
                  type="button"
                  onClick={() => fetchQrToken(false)}
                  className="text-sm text-[#2481cc] hover:text-[#1d6fb3] dark:text-[#2ba0ff] dark:hover:text-[#7cc4ff] aurora:text-[#2dd4bf] aurora:hover:text-[#5eead4] cursor-pointer text-center transition-colors"
                >
                  取消并重新扫码
                </button>
              </div>
            ) : (
              <>
                {/* White Rounded QR Card with Center Telegram Icon (strictly pure white for scanning contrast) */}
                <div className="bg-white p-3.5 rounded-2xl shadow-xl border border-[#e2e8f0] dark:border-transparent relative flex items-center justify-center w-[228px] h-[228px]">
                  {isLoadingQr ? (
                    <div className="flex flex-col items-center justify-center gap-2 text-[#64748b]">
                      <RefreshCw className="w-7 h-7 text-[#2481cc] aurora:text-[#0d9488] animate-spin" />
                      <span className="text-xs">正在加载二维码...</span>
                    </div>
                  ) : qrDataUrl ? (
                    <>
                      <img
                        src={qrDataUrl}
                        alt="Telegram Login QR"
                        className="w-full h-full block rounded-lg select-none"
                      />
                      {/* Official Centered Telegram Paper-Plane Badge */}
                      <div className="absolute w-11 h-11 rounded-full bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] flex items-center justify-center ring-4 ring-white shadow-sm pointer-events-none">
                        <svg viewBox="0 0 24 24" className="w-5 h-5 text-white -translate-x-[1px] fill-current">
                          <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
                        </svg>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 text-[#64748b]">
                      <RefreshCw className="w-6 h-6 text-[#2481cc] aurora:text-[#0d9488] animate-spin" />
                      <span className="text-xs">正在生成二维码...</span>
                    </div>
                  )}

                  {/* Scanned Confirmation Overlay */}
                  {qrIsScanned && !qrError && (
                    <div className="absolute inset-0 bg-white/95 dark:bg-[#0b131f]/92 aurora:bg-[#0c151b]/92 backdrop-blur-xs rounded-2xl flex flex-col items-center justify-center gap-2 p-4 text-center animate-in fade-in">
                      <div className="w-11 h-11 rounded-full bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-semibold text-[#0f172a] dark:text-white aurora:text-[#ecf6f8]">手机已扫码</span>
                      <span className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">请在手机 Telegram 上点击「确认连接」</span>
                    </div>
                  )}

                  {/* Expired / Error Overlay (always surfaces over stale QR or post-scan network error) */}
                  {!isLoadingQr && qrError && (
                    <div className="absolute inset-0 bg-white/95 dark:bg-[#0b131f]/92 aurora:bg-[#0c151b]/92 backdrop-blur-xs rounded-2xl flex flex-col items-center justify-center gap-3 p-4 text-center animate-in fade-in">
                      <AlertCircle className="w-7 h-7 text-rose-600 dark:text-rose-400" />
                      <span className="text-xs text-rose-700 dark:text-rose-200 leading-relaxed line-clamp-3">{qrError}</span>
                      <button
                        type="button"
                        onClick={() => fetchQrToken(false)}
                        className="px-4 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-xs font-medium cursor-pointer transition-colors"
                      >
                        点击刷新
                      </button>
                    </div>
                  )}
                </div>

                {/* Title & Official 3 Steps */}
                <h2 className="text-xl font-medium text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] mt-6 mb-4 tracking-wide">
                  从手机客户端扫描
                </h2>

                <ol className="text-[13px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] space-y-2 text-left leading-relaxed">
                  <li>1. 在您的手机上打开 Telegram</li>
                  <li>2. 到设置 &gt; 设备 &gt; 添加设备</li>
                  <li>3. 请使用扫描二维码以登录</li>
                </ol>

                {/* Subtle countdown + manual refresh */}
                {qrUrl && !qrIsScanned && !qrError && (
                  <div className="mt-4 flex items-center gap-2 text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] tabular-nums">
                    <span>{isSilentRefreshing ? '正在刷新二维码...' : `${qrExpiresIn}s 后自动刷新`}</span>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => fetchQrToken(false)}
                      className="text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:underline cursor-pointer"
                    >
                      立即刷新
                    </button>
                  </div>
                )}

                {/* Bottom Switch Link */}
                <button
                  type="button"
                  onClick={() => handleSwitchLoginMethod('phone')}
                  className="mt-6 text-sm text-[#2481cc] hover:text-[#1d6fb3] dark:text-[#2ba0ff] dark:hover:text-[#7cc4ff] aurora:text-[#2dd4bf] aurora:hover:text-[#5eead4] hover:underline cursor-pointer transition-colors"
                >
                  使用电话号码登录
                </button>
              </>
            )}
          </div>
        )}

        {/* 2. Phone Number Login View (Telegram Desktop Official Style) */}
        {loginMethod === 'phone' && (
          <div className="w-full max-w-[340px] flex flex-col">
            {!codeSent ? (
              <>
                <h2 className="text-xl font-medium text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] mb-2">你的手机号码</h2>
                <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] leading-relaxed mb-7">
                  请确认您的国际电话区号并输入您的手机号码。
                </p>

                {/* Country Selector Dropdown (Bottom-border minimal style) */}
                <div className="relative border-b border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus-within:border-[#2481cc] dark:focus-within:border-[#2ba0ff] aurora:focus-within:border-[#2dd4bf] transition-colors">
                  <select
                    value={selectedCountry ? selectedCountry.iso : 'custom'}
                    onChange={(e) => {
                      const iso = e.target.value;
                      if (iso !== 'custom') {
                        const matched = COMMON_COUNTRY_CODES.find((c) => c.iso === iso);
                        if (matched) {
                          setSelectedCountryIso(matched.iso);
                          setDialCode(matched.code);
                        }
                      }
                    }}
                    className="w-full appearance-none bg-transparent py-2.5 pr-7 text-sm text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] outline-none cursor-pointer"
                  >
                    {COMMON_COUNTRY_CODES.map((c) => (
                      <option key={c.iso} value={c.iso}>
                        {c.flag} {c.name} ({c.code})
                      </option>
                    ))}
                    {!selectedCountry && (
                      <option value="custom">
                        其他国家/地区 ({normalizedDialCode})
                      </option>
                    )}
                  </select>
                  <ChevronDown className="w-4 h-4 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Dial Code + Phone Number Inputs */}
                <div className="flex items-end gap-3 mt-5 mb-8">
                  <input
                    type="text"
                    value={dialCode}
                    onChange={(e) => {
                      const cleaned = sanitizePhoneInput(e.target.value).replace(/[^\d+]/g, '');
                      const nextDial = cleaned.startsWith('+') || cleaned === '' ? cleaned : `+${cleaned}`;
                      setDialCode(nextDial);
                      const matched = COMMON_COUNTRY_CODES.find((c) => c.code === nextDial);
                      if (matched) {
                        setSelectedCountryIso(matched.iso);
                      }
                    }}
                    className="w-16 pb-2 bg-transparent border-b border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] text-sm text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] font-mono text-center outline-none transition-colors"
                    maxLength={6}
                    aria-label="国际区号"
                  />
                  <input
                    type="text"
                    value={localPhone}
                    onChange={(e) => handleLocalPhoneChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && localPhone.trim() && !isSendingCode) {
                        handleSendCode();
                      }
                    }}
                    placeholder="--- --- ----"
                    autoFocus
                    className="flex-1 pb-2 bg-transparent border-b border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] text-sm text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] font-mono tracking-wider placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] outline-none transition-colors"
                  />
                </div>

                {/* Next Step Button */}
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={isSendingCode || !localPhone.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {isSendingCode ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在连接...</span>
                    </>
                  ) : (
                    <span>下一步</span>
                  )}
                </button>

                {/* Switch Back to QR Login */}
                <button
                  type="button"
                  onClick={() => handleSwitchLoginMethod('qr')}
                  className="mt-6 text-sm text-[#2481cc] hover:text-[#1d6fb3] dark:text-[#2ba0ff] dark:hover:text-[#7cc4ff] aurora:text-[#2dd4bf] aurora:hover:text-[#5eead4] hover:underline cursor-pointer text-center transition-colors"
                >
                  使用二维码快速登录
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-medium text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] font-mono tabular-nums">{getCombinedPhone()}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      const fullPhone = getCombinedPhone();
                      if (fullPhone) {
                        fetchWithTimeout('/api/telegram/user/cancel-auth', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            ...getAuthHeaders(),
                          },
                          body: JSON.stringify({ phone: fullPhone }),
                        }, 5000).catch(() => {});
                      }
                      setCodeSent(false);
                      setNeeds2FA(false);
                      setVerificationCode('');
                      setAuthError(null);
                    }}
                    className="text-xs text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:underline cursor-pointer"
                  >
                    修改号码
                  </button>
                </div>

                {/* Delivery Channel Notice */}
                {deliveryInfo?.channel === 'app' && (
                  <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] leading-relaxed mb-6 flex items-start gap-2">
                    <Send className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] shrink-0 mt-0.5" />
                    <span>验证码已发送至您已登录的 Telegram 官方 App 服务通知对话，请注意查收。</span>
                  </p>
                )}

                {deliveryInfo?.channel === 'sms' && (
                  <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] leading-relaxed mb-6 flex items-start gap-2">
                    <Smartphone className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <span>验证码已通过国际短信发送至您的手机，可能存在 30~60 秒延迟。</span>
                  </p>
                )}

                {deliveryInfo?.channel === 'email' && (
                  <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] leading-relaxed mb-6 flex items-start gap-2">
                    <Mail className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                    <span>验证码已发送至绑定邮箱 ({deliveryInfo.emailPattern || '关联邮箱'})。</span>
                  </p>
                )}

                {!deliveryInfo && (
                  <p className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] leading-relaxed mb-6">
                    请输入您收到的 5 位 Telegram 官方验证码。
                  </p>
                )}

                {deliveryInfo?.warning && (
                  <div className="mb-5 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-between text-xs text-amber-700 dark:text-amber-300 gap-2">
                    <span className="text-[11px]">未收到通知？</span>
                    <button
                      type="button"
                      onClick={() => {
                        handleSwitchLoginMethod('qr');
                        fetchQrToken();
                      }}
                      className="text-amber-800 dark:text-amber-200 hover:underline font-medium shrink-0 cursor-pointer"
                    >
                      改用扫码登录 →
                    </button>
                  </div>
                )}

                {/* Verification Code Input */}
                <div className="mb-5">
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && verificationCode.trim() && !isVerifyingCode) {
                        handleVerifyCode();
                      }
                    }}
                    placeholder="验证码"
                    maxLength={10}
                    autoFocus
                    className="w-full pb-2.5 bg-transparent border-b border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] text-base text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] font-mono tracking-widest placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] outline-none transition-colors"
                  />
                </div>

                {/* 2FA Password Input */}
                {needs2FA && (
                  <div className="mb-6 animate-in fade-in">
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300 mb-2">
                      <Lock className="w-3.5 h-3.5" />
                      <span>两步验证密码</span>
                    </div>
                    <input
                      type="password"
                      value={cloudPassword}
                      onChange={(e) => setCloudPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && verificationCode.trim() && !isVerifyingCode) {
                          handleVerifyCode();
                        }
                      }}
                      placeholder="请输入云端两步验证密码"
                      className="w-full pb-2.5 bg-transparent border-b border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-amber-500 text-sm text-[#0f172a] dark:text-white aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] outline-none transition-colors"
                    />
                  </div>
                )}

                {/* Action Buttons */}
                <button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={isVerifyingCode || !verificationCode.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {isVerifyingCode ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在验证...</span>
                    </>
                  ) : (
                    <span>确认登录</span>
                  )}
                </button>

                <div className="mt-5 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={isResendingCode || resendCountdown > 0}
                    className="text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:underline disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed tabular-nums"
                  >
                    {isResendingCode
                      ? '重发中...'
                      : resendCountdown > 0
                      ? `${resendCountdown}s 后可重发`
                      : '申请重发验证码'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSwitchLoginMethod('qr')}
                    className="text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:underline cursor-pointer"
                  >
                    使用二维码快速登录
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
