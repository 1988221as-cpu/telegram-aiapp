import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  User,
  Shield,
  Bell,
  Palette,
  Folder,
  Lock,
  Smartphone,
  Check,
  Camera,
  Sliders,
  RefreshCw,
  Trash2,
  Plus,
  AlertCircle,
  Loader2,
  Phone,
  Edit3,
  Eye,
  EyeOff,
  Mail,
  Clock,
  ChevronDown,
  ChevronUp,
  UserPlus,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Account, AppThemeMode, TelegramContact } from '../types';
import {
  updateTelegramUserProfileApi,
  fetchTelegramUserSettingsApi,
  uploadTelegramUserAvatarApi,
  sendTelegramChangePhoneCodeApi,
  confirmTelegramChangePhoneApi,
  updateTelegramTwoFactorApi,
  updateTelegramPrivacyApi,
  updateTelegramGlobalPrivacyApi,
  updateTelegramAccountTtlApi,
  terminateTelegramSessionApi,
  updateTelegramNotificationsApi,
  saveTelegramDialogFilterApi,
  deleteTelegramDialogFilterApi,
  fetchTelegramBlockedContactsApi,
  unblockTelegramUserContactApi,
  TelegramOfficialSettingsResponse,
  TelegramOfficialDialogFilter,
  TelegramPrivacyRuleKey,
  TelegramPrivacyRuleDetail,
  TelegramGlobalPrivacySettings,
} from '../services/apiService';

export interface TelegramClientPrefs {
  showLastSeen: boolean;
  twoFactorAuth: boolean;
  notificationsSound: boolean;
  previewText: boolean;
  sendWithEnter: boolean;
}

export const DEFAULT_TELEGRAM_CLIENT_PREFS: TelegramClientPrefs = {
  showLastSeen: true,
  twoFactorAuth: false,
  notificationsSound: true,
  previewText: true,
  sendWithEnter: true,
};

export const CLIENT_PREFS_STORAGE_KEY = 'tg_pro_client_prefs';

export function getScopedClientPrefsStorageKey(accountId?: string | null): string {
  const cleanId = String(accountId || '').trim();
  return cleanId ? `${CLIENT_PREFS_STORAGE_KEY}::${cleanId}` : CLIENT_PREFS_STORAGE_KEY;
}

export function loadStoredClientPrefs(accountId?: string | null): TelegramClientPrefs {
  try {
    const raw = localStorage.getItem(getScopedClientPrefsStorageKey(accountId));
    if (raw) {
      return { ...DEFAULT_TELEGRAM_CLIENT_PREFS, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_TELEGRAM_CLIENT_PREFS };
}

interface TelegramSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccount?: Account | null;
  onUpdateAccount?: (updated: Partial<Account>, accountId?: string) => void;
  theme: AppThemeMode;
  onToggleTheme: () => void;
  onSelectTheme?: (theme: AppThemeMode) => void;
  onOpenSystemAdmin?: () => void;
  clientPrefs?: TelegramClientPrefs;
  onUpdateClientPrefs?: (updated: TelegramClientPrefs) => void;
  onBlockStatusChanged?: (contactId: string, isBlocked: boolean) => void;
}

function formatUnixTimestamp(ts?: number): string {
  if (!ts) return '未知';
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '未知';
  }
}

export const TelegramSettingsModal: React.FC<TelegramSettingsModalProps> = ({
  isOpen,
  onClose,
  currentAccount,
  onUpdateAccount,
  theme,
  onToggleTheme,
  onSelectTheme,
  onOpenSystemAdmin,
  clientPrefs: externalPrefs,
  onUpdateClientPrefs,
  onBlockStatusChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'privacy' | 'notifications' | 'appearance' | 'folders'>('profile');

  // Profile state
  const [name, setName] = useState(currentAccount?.name || 'Telegram 用户');
  const [username, setUsername] = useState(currentAccount?.username || '');
  const [bio, setBio] = useState(currentAccount?.bio || '');
  const [phone, setPhone] = useState(currentAccount?.phone || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSavedNotice, setIsSavedNotice] = useState(false);
  const [saveNoticeText, setSaveNoticeText] = useState('已同步至 Telegram 云端');
  const [saveError, setSaveError] = useState('');
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // Change phone state
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [newPhoneInput, setNewPhoneInput] = useState('');
  const [changePhoneHash, setChangePhoneHash] = useState('');
  const [changePhoneCode, setChangePhoneCode] = useState('');
  const [isPhoneLoading, setIsPhoneLoading] = useState(false);
  const [phoneFeedback, setPhoneFeedback] = useState('');

  // Official cloud state
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [cloudSettings, setCloudSettings] = useState<TelegramOfficialSettingsResponse | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // 2FA form state
  const [twoFactorMode, setTwoFactorMode] = useState<'idle' | 'enable' | 'change' | 'disable'>('idle');
  const [cur2faPwd, setCur2faPwd] = useState('');
  const [new2faPwd, setNew2faPwd] = useState('');
  const [confirm2faPwd, setConfirm2faPwd] = useState('');
  const [hint2fa, setHint2fa] = useState('');
  const [email2fa, setEmail2fa] = useState('');
  const [emailConfirmCode, setEmailConfirmCode] = useState('');
  const [showCur2faPwd, setShowCur2faPwd] = useState(false);
  const [showNew2faPwd, setShowNew2faPwd] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Per-rule privacy exception editor state
  const [expandedPrivacyKey, setExpandedPrivacyKey] = useState<TelegramPrivacyRuleKey | null>(null);
  const [privacyAllowDraft, setPrivacyAllowDraft] = useState<string[]>([]);
  const [privacyDisallowDraft, setPrivacyDisallowDraft] = useState<string[]>([]);
  const [allowUserInput, setAllowUserInput] = useState('');
  const [disallowUserInput, setDisallowUserInput] = useState('');
  const [blockedUsers, setBlockedUsers] = useState<TelegramContact[]>([]);
  const [isLoadingBlocked, setIsLoadingBlocked] = useState(false);

  // Folder editor state
  const [editingFolder, setEditingFolder] = useState<{
    id?: number;
    title: string;
    contacts: boolean;
    nonContacts: boolean;
    groups: boolean;
    broadcasts: boolean;
    bots: boolean;
    excludeMuted: boolean;
    excludeRead: boolean;
    excludeArchived: boolean;
  } | null>(null);

  const currentAccountIdRef = useRef<string | undefined>(currentAccount?.id);
  currentAccountIdRef.current = currentAccount?.id;

  const [localPrefs, setLocalPrefs] = useState<TelegramClientPrefs>(() => loadStoredClientPrefs(currentAccount?.id));
  const effectivePrefs = externalPrefs || localPrefs;

  const updatePref = (patch: Partial<TelegramClientPrefs>, expectedAccountId?: string) => {
    const targetAccId = expectedAccountId !== undefined ? expectedAccountId : currentAccount?.id;
    const basePrefs = expectedAccountId !== undefined ? loadStoredClientPrefs(targetAccId) : effectivePrefs;
    const next = { ...basePrefs, ...patch };
    setLocalPrefs(next);
    try {
      localStorage.setItem(getScopedClientPrefsStorageKey(targetAccId), JSON.stringify(next));
    } catch {}
    if (expectedAccountId === undefined || currentAccountIdRef.current === targetAccId) {
      onUpdateClientPrefs?.(next);
    }
  };

  const loadOfficialCloudSettings = async () => {
    if (!currentAccount) {
      setCloudSettings(null);
      setCloudError('当前尚未登录/关联任何在线 Telegram 账号，请先在左侧点击「+ 添加账号」登录您的 Telegram 账号后再修改云端设置。');
      return;
    }
    const targetAccountId = currentAccount.id;
    setIsLoadingCloud(true);
    setCloudError('');
    try {
      const res = await fetchTelegramUserSettingsApi(targetAccountId, currentAccount.phone);
      if (currentAccountIdRef.current !== targetAccountId) return;
      if (!res.ok) {
        setCloudSettings(null);
        setCloudError(res.error || '拉取 Telegram 官方云端设置失败');
        return;
      }
      setCloudSettings(res);
      if (res.profile) {
        setName(res.profile.name);
        setUsername(res.profile.username);
        setBio(res.profile.bio);
        setPhone(res.profile.phone);
        onUpdateAccount?.(
          {
            name: res.profile.name,
            username: res.profile.username,
            bio: res.profile.bio,
            phone: res.profile.phone,
            ...(res.profile.hasAvatar ? { avatarUrl: res.profile.avatarUrl } : {}),
          },
          targetAccountId
        );
      }
      updatePref(
        {
          twoFactorAuth: Boolean(res.twoFactor?.hasPassword),
          showLastSeen: res.privacy?.lastSeen !== 'nobody',
          notificationsSound: Boolean(res.notifications?.users?.enabled),
          previewText: Boolean(res.notifications?.users?.showPreviews),
        },
        targetAccountId
      );
    } catch (err: any) {
      if (currentAccountIdRef.current !== targetAccountId) return;
      setCloudSettings(null);
      setCloudError(err?.message || '拉取 Telegram 官方云端设置失败');
    } finally {
      if (currentAccountIdRef.current === targetAccountId) {
        setIsLoadingCloud(false);
      }
    }
    if (targetAccountId.startsWith('acc_tg_')) {
      setIsLoadingBlocked(true);
      fetchTelegramBlockedContactsApi(targetAccountId)
        .then((blkRes) => {
          if (currentAccountIdRef.current !== targetAccountId) return;
          if (blkRes.ok && Array.isArray(blkRes.blocked)) {
            setBlockedUsers(blkRes.blocked);
          }
        })
        .finally(() => {
          if (currentAccountIdRef.current === targetAccountId) {
            setIsLoadingBlocked(false);
          }
        });
    } else {
      setBlockedUsers([]);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setName(currentAccount?.name || 'Telegram 用户');
    setUsername(currentAccount?.username || '');
    setBio(currentAccount?.bio || '');
    setPhone(currentAccount?.phone || '');
    setIsSavedNotice(false);
    setSaveError('');
    setActionFeedback(null);
    setTwoFactorMode('idle');
    setCur2faPwd('');
    setNew2faPwd('');
    setConfirm2faPwd('');
    setHint2fa('');
    setEmail2fa('');
    setEmailConfirmCode('');
    setShowCur2faPwd(false);
    setShowNew2faPwd(false);
    setShowResetConfirm(false);
    setExpandedPrivacyKey(null);
    setAllowUserInput('');
    setDisallowUserInput('');
    setIsEditingPhone(false);
    setChangePhoneHash('');
    setChangePhoneCode('');
    setPhoneFeedback('');
    setCloudSettings(null);
    setCloudError('');
    setBlockedUsers([]);
    setEditingFolder(null);
    setLocalPrefs(loadStoredClientPrefs(currentAccount?.id));
    loadOfficialCloudSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentAccount?.id]);

  if (!isOpen) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetAccountId = currentAccount?.id;
    const trimmedName = name.trim() || currentAccount?.name || 'Telegram 用户';
    const rawUsername = username.trim();
    const normalizedUsername = rawUsername ? (rawUsername.startsWith('@') ? rawUsername : `@${rawUsername}`) : '';
    const trimmedBio = bio.trim();

    setIsSavingProfile(true);
    setSaveError('');
    setIsSavedNotice(false);

    try {
      const cloudRes = await updateTelegramUserProfileApi({
        accountId: targetAccountId,
        phone: currentAccount?.phone,
        name: trimmedName,
        username: normalizedUsername,
        bio: trimmedBio,
      });

      if (!cloudRes.ok) {
        if (cloudRes.profileUpdated) {
          onUpdateAccount?.(
            {
              name: trimmedName,
              bio: trimmedBio,
            },
            targetAccountId
          );
        }
        setSaveError(cloudRes.error || '云端同步失败');
        return;
      }

      onUpdateAccount?.(
        {
          name: cloudRes.profile?.name || trimmedName,
          username: cloudRes.profile?.username !== undefined ? cloudRes.profile.username : normalizedUsername,
          bio: trimmedBio,
          ...(cloudRes.profile?.phone ? { phone: cloudRes.profile.phone } : {}),
        },
        targetAccountId
      );
      setSaveNoticeText('已真实同步至 Telegram 云端');
      setIsSavedNotice(true);
      setTimeout(() => setIsSavedNotice(false), 2500);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAvatarFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setSaveError('头像文件不能超过 5MB');
      return;
    }
    setSaveError('');
    setIsUploadingAvatar(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      const res = await uploadTelegramUserAvatarApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        imageDataUrl: dataUrl,
      });
      if (!res.ok || !res.avatarUrl) {
        setSaveError(res.error || '头像上传 Telegram 云端失败');
        return;
      }
      onUpdateAccount?.({ avatarUrl: res.avatarUrl }, currentAccount?.id);
      setCloudSettings((prev) =>
        prev?.profile ? { ...prev, profile: { ...prev.profile, hasAvatar: true, avatarUrl: res.avatarUrl! } } : prev
      );
      setSaveNoticeText('官方头像已上传至 Telegram 云端');
      setIsSavedNotice(true);
      setTimeout(() => setIsSavedNotice(false), 2500);
    } catch (err: any) {
      setSaveError(err?.message || '上传头像失败');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSendChangePhoneCode = async () => {
    setSaveError('');
    setPhoneFeedback('');
    setIsPhoneLoading(true);
    try {
      const res = await sendTelegramChangePhoneCodeApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        newPhone: newPhoneInput,
      });
      if (!res.ok || !res.phoneCodeHash) {
        setSaveError(res.error || '发送换绑验证码失败');
        return;
      }
      setNewPhoneInput(res.newPhone || newPhoneInput);
      setChangePhoneHash(res.phoneCodeHash);
      setPhoneFeedback(res.message || '验证码已发送，请查收并输入');
    } finally {
      setIsPhoneLoading(false);
    }
  };

  const handleConfirmChangePhone = async () => {
    setSaveError('');
    setPhoneFeedback('');
    setIsPhoneLoading(true);
    try {
      const res = await confirmTelegramChangePhoneApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        newPhone: newPhoneInput,
        phoneCodeHash: changePhoneHash,
        code: changePhoneCode,
      });
      if (!res.ok || !res.phone) {
        setSaveError(res.error || '手机号换绑失败');
        return;
      }
      setPhone(res.phone);
      onUpdateAccount?.({ phone: res.phone }, currentAccount?.id);
      setIsEditingPhone(false);
      setChangePhoneHash('');
      setChangePhoneCode('');
      setSaveNoticeText(res.message || 'Telegram 绑定手机号已更新');
      setIsSavedNotice(true);
      setTimeout(() => setIsSavedNotice(false), 3000);
    } finally {
      setIsPhoneLoading(false);
    }
  };

  const handleSubmitTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (twoFactorMode === 'idle') return;
    if ((twoFactorMode === 'enable' || twoFactorMode === 'change') && new2faPwd !== confirm2faPwd) {
      setActionFeedback({ type: 'err', text: '两次输入的新两步验证密码不一致，请核对后重试' });
      return;
    }
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await updateTelegramTwoFactorApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        action: twoFactorMode,
        currentPassword: cur2faPwd,
        newPassword: new2faPwd,
        hint: hint2fa,
        email: email2fa,
      });
      if (!res.ok) {
        setActionFeedback({ type: 'err', text: res.error || '更新两步验证失败' });
        return;
      }
      setCloudSettings((prev) => (prev ? { ...prev, twoFactor: res.twoFactor } : prev));
      updatePref({ twoFactorAuth: Boolean(res.twoFactor?.hasPassword) });
      setTwoFactorMode('idle');
      setCur2faPwd('');
      setNew2faPwd('');
      setConfirm2faPwd('');
      setHint2fa('');
      setEmail2fa('');
      setActionFeedback({
        type: 'ok',
        text: res.message || (res.twoFactor?.hasPassword ? 'Telegram 云端两步验证密码已更新生效' : '已关闭 Telegram 云端两步验证'),
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleTwoFactorAction = async (
    action: 'confirm_email' | 'resend_email' | 'cancel_email' | 'reset_password',
    code?: string
  ) => {
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await updateTelegramTwoFactorApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        action,
        code,
      });
      if (!res.ok) {
        setActionFeedback({ type: 'err', text: res.error || '两步验证操作失败' });
        return;
      }
      setCloudSettings((prev) => (prev ? { ...prev, twoFactor: res.twoFactor } : prev));
      updatePref({ twoFactorAuth: Boolean(res.twoFactor?.hasPassword) });
      if (action === 'confirm_email' || action === 'cancel_email') {
        setEmailConfirmCode('');
      }
      if (action === 'reset_password') {
        setShowResetConfirm(false);
      }
      setActionFeedback({
        type: 'ok',
        text: res.message || '两步验证状态已更新',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const getRuleUserRefs = (rule?: TelegramPrivacyRuleDetail) => ({
    allowRefs: (rule?.allowUsers || []).map((u) => (u.username ? u.username : u.id)),
    disallowRefs: (rule?.disallowUsers || []).map((u) => (u.username ? u.username : u.id)),
  });

  const handleChangePrivacy = async (
    key: TelegramPrivacyRuleKey,
    mode: 'everybody' | 'contacts' | 'nobody',
    customExceptions?: { allowUserRefs: string[]; disallowUserRefs: string[] }
  ) => {
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const existingRule = cloudSettings?.privacyRules?.[key];
      const fallbackRefs = getRuleUserRefs(existingRule);
      const res = await updateTelegramPrivacyApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        key,
        mode,
        allowUserRefs: customExceptions ? customExceptions.allowUserRefs : fallbackRefs.allowRefs,
        disallowUserRefs: customExceptions ? customExceptions.disallowUserRefs : fallbackRefs.disallowRefs,
      });
      if (!res.ok || !res.mode) {
        setActionFeedback({ type: 'err', text: res.error || '更新隐私设置失败' });
        return;
      }
      const nextRule: TelegramPrivacyRuleDetail = {
        mode: res.mode,
        summary: res.summary || '',
        allowUsers: res.allowUsers || [],
        disallowUsers: res.disallowUsers || [],
      };
      setCloudSettings((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          privacy: {
            lastSeen: key === 'status' ? nextRule.mode : (prev.privacy?.lastSeen || 'nobody'),
            lastSeenSummary: key === 'status' ? nextRule.summary : (prev.privacy?.lastSeenSummary || ''),
            phoneNumber: key === 'phone' ? nextRule.mode : (prev.privacy?.phoneNumber || 'nobody'),
            phoneNumberSummary: key === 'phone' ? nextRule.summary : (prev.privacy?.phoneNumberSummary || ''),
          },
          privacyRules: {
            ...(prev.privacyRules || {}),
            [key]: nextRule,
          },
        };
      });
      if (key === 'status') {
        updatePref({ showLastSeen: res.mode !== 'nobody' });
      }
      if (expandedPrivacyKey === key) {
        setPrivacyAllowDraft(nextRule.allowUsers.map((u) => (u.username ? u.username : u.id)));
        setPrivacyDisallowDraft(nextRule.disallowUsers.map((u) => (u.username ? u.username : u.id)));
      }
      setActionFeedback({ type: 'ok', text: `云端隐私规则已更新：${nextRule.summary}` });
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleGlobalPrivacyField = async (
    field: keyof TelegramGlobalPrivacySettings,
    nextValue: boolean
  ) => {
    const cur = cloudSettings?.globalPrivacy || {
      archiveAndMuteNewNoncontactPeers: false,
      keepArchivedUnmuted: false,
      keepArchivedFolders: false,
      hideReadMarks: false,
      newNoncontactPeersRequirePremium: false,
    };
    const nextSettings: TelegramGlobalPrivacySettings = {
      ...cur,
      [field]: nextValue,
    };
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await updateTelegramGlobalPrivacyApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        ...nextSettings,
      });
      if (!res.ok || !res.globalPrivacy) {
        setActionFeedback({ type: 'err', text: res.error || '更新全局安全策略失败' });
        return;
      }
      setCloudSettings((prev) => (prev ? { ...prev, globalPrivacy: res.globalPrivacy } : prev));
      setActionFeedback({ type: 'ok', text: 'Telegram 全局防骚扰与已读隐私设置已同步至云端' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleUpdateAccountTtl = async (days: number) => {
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await updateTelegramAccountTtlApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        days,
      });
      if (!res.ok || typeof res.accountTtlDays !== 'number') {
        setActionFeedback({ type: 'err', text: res.error || '修改账号自毁期限失败' });
        return;
      }
      setCloudSettings((prev) => (prev ? { ...prev, accountTtlDays: res.accountTtlDays } : prev));
      setActionFeedback({ type: 'ok', text: `账号长期未上线自动注销周期已设为 ${res.accountTtlDays} 天` });
    } finally {
      setActionBusy(false);
    }
  };

  const handleTerminateSession = async (opts: { hash?: string; terminateAllOthers?: boolean }) => {
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await terminateTelegramSessionApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        ...opts,
      });
      if (!res.ok) {
        setActionFeedback({ type: 'err', text: res.error || '注销设备会话失败' });
        return;
      }
      setCloudSettings((prev) => (prev ? { ...prev, sessions: res.sessions || prev.sessions } : prev));
      setActionFeedback({
        type: 'ok',
        text: opts.terminateAllOthers ? '已从 Telegram 云端注销所有其他登录设备' : '目标设备会话已从云端下线',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleUpdateNotifications = async (
    scope: 'users' | 'chats' | 'both',
    enabled: boolean,
    previewText: boolean
  ) => {
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await updateTelegramNotificationsApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        scope,
        enabled,
        previewText,
      });
      if (!res.ok || !res.notifications) {
        setActionFeedback({ type: 'err', text: res.error || '同步通知设置至云端失败' });
        return;
      }
      setCloudSettings((prev) => (prev ? { ...prev, notifications: res.notifications } : prev));
      updatePref({
        notificationsSound: Boolean(res.notifications.users.enabled),
        previewText: Boolean(res.notifications.users.showPreviews),
      });
      setActionFeedback({ type: 'ok', text: '通知与预览设置已同步至 Telegram 云端' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFolder) return;
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await saveTelegramDialogFilterApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        filter: editingFolder,
      });
      if (!res.ok) {
        setActionFeedback({ type: 'err', text: res.error || '保存对话文件夹失败' });
        return;
      }
      setCloudSettings((prev) => (prev ? { ...prev, folders: res.folders || [] } : prev));
      setEditingFolder(null);
      setActionFeedback({ type: 'ok', text: '对话文件夹已真实同步至 Telegram 云端' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteFolder = async (filterId: number) => {
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await deleteTelegramDialogFilterApi({
        accountId: currentAccount?.id,
        phone: currentAccount?.phone,
        filterId,
      });
      if (!res.ok) {
        setActionFeedback({ type: 'err', text: res.error || '删除对话文件夹失败' });
        return;
      }
      setCloudSettings((prev) => (prev ? { ...prev, folders: res.folders || [] } : prev));
      setActionFeedback({ type: 'ok', text: '已从 Telegram 云端删除该对话文件夹' });
    } finally {
      setActionBusy(false);
    }
  };

  const renderCloudStatusBanner = () => {
    if (isLoadingCloud) {
      return (
        <div className="mb-4 p-3 rounded-xl bg-[#e8f3ff] dark:bg-[#2ba0ff]/15 aurora:bg-[#112d36] border border-[#bfdbfe] dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35 text-xs text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>正在从 Telegram 官方 MTProto 服务器实时拉取账号设置...</span>
        </div>
      );
    }
    if (cloudError) {
      return (
        <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-400 aurora:text-rose-400 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Telegram 官方云端设置不可用（严禁本地伪造状态）</div>
              <div className="text-[11px] opacity-90 mt-0.5">{cloudError}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={loadOfficialCloudSettings}
            className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 aurora:text-rose-300 text-[11px] font-medium shrink-0 cursor-pointer flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span>重试</span>
          </button>
        </div>
      );
    }
    return null;
  };

  const summarizeFolderRules = (f: TelegramOfficialDialogFilter): string => {
    const tags: string[] = [];
    if (f.contacts) tags.push('联系人');
    if (f.nonContacts) tags.push('非联系人');
    if (f.groups) tags.push('群组');
    if (f.broadcasts) tags.push('频道');
    if (f.bots) tags.push('机器人');
    if (f.includeCount > 0) tags.push(`已选会话 ${f.includeCount}`);
    if (f.excludeMuted) tags.push('排除静音');
    if (f.excludeRead) tags.push('排除已读');
    if (f.excludeArchived) tags.push('排除归档');
    return tags.length > 0 ? tags.join(' · ') : '自定义会话集合';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] rounded-2xl shadow-2xl border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] overflow-hidden flex flex-col md:flex-row max-h-[85vh]">
        {/* Left Settings Sidebar */}
        <div className="w-full md:w-56 bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] border-b md:border-b-0 md:border-r border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] p-3 flex flex-col shrink-0">
          <div className="px-3 py-2 text-xs font-bold text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] uppercase tracking-wider mb-1">
            电报设置
          </div>

          <div className="space-y-1 text-xs font-medium">
            <button
              onClick={() => { setActiveTab('profile'); setActionFeedback(null); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left cursor-pointer transition-colors ${
                activeTab === 'profile'
                  ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white shadow-xs'
                  : 'text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e]'
              }`}
            >
              <User className="w-4 h-4 shrink-0" />
              <span>个人资料</span>
            </button>

            <button
              onClick={() => { setActiveTab('privacy'); setActionFeedback(null); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left cursor-pointer transition-colors ${
                activeTab === 'privacy'
                  ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white shadow-xs'
                  : 'text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e]'
              }`}
            >
              <Shield className="w-4 h-4 shrink-0" />
              <span>隐私与安全</span>
            </button>

            <button
              onClick={() => { setActiveTab('notifications'); setActionFeedback(null); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left cursor-pointer transition-colors ${
                activeTab === 'notifications'
                  ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white shadow-xs'
                  : 'text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e]'
              }`}
            >
              <Bell className="w-4 h-4 shrink-0" />
              <span>通知与声音</span>
            </button>

            <button
              onClick={() => { setActiveTab('appearance'); setActionFeedback(null); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left cursor-pointer transition-colors ${
                activeTab === 'appearance'
                  ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white shadow-xs'
                  : 'text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e]'
              }`}
            >
              <Palette className="w-4 h-4 shrink-0" />
              <span>对话与外观</span>
            </button>

            <button
              onClick={() => { setActiveTab('folders'); setActionFeedback(null); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left cursor-pointer transition-colors ${
                activeTab === 'folders'
                  ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white shadow-xs'
                  : 'text-[#0f172a] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e]'
              }`}
            >
              <Folder className="w-4 h-4 shrink-0" />
              <span>对话分组</span>
            </button>
          </div>

          {onOpenSystemAdmin && (
            <div className="mt-auto pt-4 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
              <button
                onClick={() => {
                  onClose();
                  onOpenSystemAdmin();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] cursor-pointer font-medium transition-colors"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>工作台系统管理</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Settings Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b]">
          {/* Header */}
          <div className="h-14 px-6 bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between shrink-0">
            <h3 className="font-semibold text-sm text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
              {activeTab === 'profile' && '个人资料'}
              {activeTab === 'privacy' && '隐私与安全'}
              {activeTab === 'notifications' && '通知与声音'}
              {activeTab === 'appearance' && '对话与外观'}
              {activeTab === 'folders' && '对话分组'}
            </h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={loadOfficialCloudSettings}
                disabled={isLoadingCloud}
                title="从 Telegram 云端刷新最新设置"
                className="p-1.5 rounded-lg text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-[#eef4fb] aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingCloud ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-[#64748b] hover:text-[#0f172a] dark:text-[#7b93ad] dark:hover:text-[#eef4fb] aurora:text-[#7e9aa5] aurora:hover:text-[#ecf6f8] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#132234] aurora:hover:bg-[#13252e] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 flex-1 overflow-y-auto">
            {activeTab !== 'appearance' && renderCloudStatusBanner()}

            {actionFeedback && (
              <div
                className={`mb-4 p-2.5 rounded-xl text-xs font-medium flex items-center gap-2 ${
                  actionFeedback.type === 'ok'
                    ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-400 aurora:text-emerald-400'
                    : 'bg-rose-500/10 border border-rose-500/25 text-rose-700 dark:text-rose-400 aurora:text-rose-400'
                }`}
              >
                {actionFeedback.type === 'ok' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{actionFeedback.text}</span>
              </div>
            )}

            {activeTab === 'profile' && (
              <form onSubmit={handleSaveProfile} className="space-y-4 max-w-md">
                <div className="flex items-center gap-4 mb-5">
                  <div className="relative">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl text-white shadow-md relative overflow-hidden"
                      style={{ backgroundColor: currentAccount?.avatarBg || '#2481cc' }}
                    >
                      {currentAccount?.avatarUrl ? (
                        <img src={currentAccount.avatarUrl} alt={name} className="w-full h-full object-cover" />
                      ) : (
                        <span>{currentAccount?.avatarInitial || name.slice(0, 2)}</span>
                      )}
                      {isUploadingAvatar && (
                        <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                          <Loader2 className="w-5 h-5 text-white animate-spin" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={isUploadingAvatar || Boolean(cloudError)}
                      onClick={() => avatarInputRef.current?.click()}
                      title="上传新的 Telegram 官方头像"
                      className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] disabled:opacity-50 text-white flex items-center justify-center shadow-md border-2 border-white dark:border-[#0b131f] aurora:border-[#0c151b] cursor-pointer transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleAvatarFileSelected}
                      className="hidden"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] truncate">{name}</div>
                    <div className="text-xs text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate">
                      {phone || username || '未绑定号码'}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mb-1">显示昵称</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={Boolean(cloudError)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] focus:outline-none disabled:opacity-60 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mb-1">用户名 (@username)</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="@your_username"
                    disabled={Boolean(cloudError)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] focus:outline-none disabled:opacity-60 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mb-1">个人简介</label>
                  <textarea
                    rows={2}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="个人简介..."
                    disabled={Boolean(cloudError)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] focus:outline-none resize-none disabled:opacity-60 transition-colors"
                  />
                </div>

                <div className="p-3 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5 tabular-nums">
                      <Phone className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                      <span>绑定手机号：{phone || '未知'}</span>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(cloudError)}
                      onClick={() => {
                        setIsEditingPhone((v) => !v);
                        setPhoneFeedback('');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {isEditingPhone ? '取消换绑' : '更换号码'}
                    </button>
                  </div>

                  {isEditingPhone && (
                    <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newPhoneInput}
                          onChange={(e) => setNewPhoneInput(e.target.value)}
                          placeholder="输入新手机号（如 +8613800000000）"
                          className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                        />
                        <button
                          type="button"
                          disabled={isPhoneLoading || !newPhoneInput.trim()}
                          onClick={handleSendChangePhoneCode}
                          className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-xs font-medium cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          {isPhoneLoading ? '发送中...' : '发送验证码'}
                        </button>
                      </div>
                      {changePhoneHash && (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={changePhoneCode}
                            onChange={(e) => setChangePhoneCode(e.target.value)}
                            placeholder="输入官方换绑验证码"
                            className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                          />
                          <button
                            type="button"
                            disabled={isPhoneLoading || !changePhoneCode.trim()}
                            onClick={handleConfirmChangePhone}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                          >
                            确认换绑
                          </button>
                        </div>
                      )}
                      {phoneFeedback && <div className="text-[11px] text-emerald-700 dark:text-emerald-400 aurora:text-emerald-400">{phoneFeedback}</div>}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSavingProfile || Boolean(cloudError)}
                    className="px-5 py-2 rounded-xl bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] disabled:opacity-60 text-white text-xs font-semibold cursor-pointer shadow-sm transition-colors"
                  >
                    {isSavingProfile ? '正在同步至云端...' : '保存并同步至云端'}
                  </button>
                  {isSavedNotice && (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 aurora:text-emerald-400 font-medium flex items-center gap-1 animate-in fade-in">
                      <Check className="w-4 h-4" /> {saveNoticeText}
                    </span>
                  )}
                </div>
                {saveError && (
                  <div className="text-xs text-rose-600 dark:text-rose-400 aurora:text-rose-400 font-medium pt-1">
                    {saveError}
                  </div>
                )}
              </form>
            )}

            {activeTab === 'privacy' && (
              <div className="space-y-4 max-w-xl text-xs">
                {/* 2FA Section */}
                <div className="p-4 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 space-y-3 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5 flex-wrap">
                        <Lock className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                        <span>云端两步验证密码 (2FA)</span>
                        {cloudSettings?.twoFactor && (
                          <span
                            className={`text-[11px] font-medium ${
                              cloudSettings.twoFactor.hasPassword
                                ? 'text-emerald-700 dark:text-emerald-400 aurora:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400 aurora:text-amber-400'
                            }`}
                          >
                            · {cloudSettings.twoFactor.hasPassword ? '已开启' : '未设置'}
                          </span>
                        )}
                      </div>
                      {!cloudSettings?.twoFactor && !isLoadingCloud && (
                        <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-1">
                          暂未连接 Telegram 云端状态。请确保已登录在线 Telegram 账号，或点击右侧刷新拉取。
                        </div>
                      )}
                      {cloudSettings?.twoFactor?.hasPassword && (
                        <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-1">
                          提示语：{cloudSettings.twoFactor.hint || '无'}
                          {cloudSettings.twoFactor.hasRecovery ? ' · 已绑定恢复邮箱' : ' · 未绑定恢复邮箱'}
                        </div>
                      )}
                      {Boolean(cloudSettings?.twoFactor?.pendingResetDate) && (
                        <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 aurora:text-amber-300 text-[11px]">
                          官方 2FA 密码重置冷却中：预计于 {formatUnixTimestamp(cloudSettings?.twoFactor?.pendingResetDate)} 自动生效
                        </div>
                      )}
                    </div>

                    {!cloudSettings?.twoFactor ? (
                      <button
                        type="button"
                        disabled={isLoadingCloud}
                        onClick={loadOfficialCloudSettings}
                        className="px-2.5 py-1.5 rounded-lg bg-[#e8f3ff] border border-[#bfdbfe] text-[#0284c7] hover:bg-[#dbeafe] dark:bg-[#2ba0ff]/15 dark:border-[#2ba0ff]/35 dark:text-[#7cc4ff] dark:hover:bg-[#2ba0ff]/25 aurora:bg-[#112d36] aurora:border-[#2dd4bf]/35 aurora:text-[#5eead4] aurora:hover:bg-[#153944] text-[11px] font-medium shrink-0 cursor-pointer disabled:opacity-50 flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw className={`w-3 h-3 ${isLoadingCloud ? 'animate-spin' : ''}`} />
                        <span>刷新状态</span>
                      </button>
                    ) : (
                      twoFactorMode === 'idle' && (
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                          {!cloudSettings.twoFactor.hasPassword ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActionFeedback(null);
                                setShowResetConfirm(false);
                                setCur2faPwd('');
                                setNew2faPwd('');
                                setConfirm2faPwd('');
                                setHint2fa('');
                                setEmail2fa('');
                                setTwoFactorMode('enable');
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-[11px] font-medium cursor-pointer transition-colors"
                            >
                              开启 2FA
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setActionFeedback(null);
                                  setShowResetConfirm(false);
                                  setCur2faPwd('');
                                  setNew2faPwd('');
                                  setConfirm2faPwd('');
                                  setHint2fa(cloudSettings.twoFactor?.hint || '');
                                  setEmail2fa('');
                                  setTwoFactorMode('change');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-[11px] font-medium cursor-pointer transition-colors"
                              >
                                修改密码
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActionFeedback(null);
                                  setShowResetConfirm(false);
                                  setCur2faPwd('');
                                  setNew2faPwd('');
                                  setConfirm2faPwd('');
                                  setTwoFactorMode('disable');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-400 aurora:text-rose-400 text-[11px] font-medium cursor-pointer transition-colors"
                              >
                                关闭
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowResetConfirm((v) => !v)}
                                className="px-2 py-1.5 rounded-lg bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] text-[11px] cursor-pointer transition-colors"
                                title="忘记原两步验证密码？可向 Telegram 申请官方重置"
                              >
                                忘记密码
                              </button>
                            </>
                          )}
                        </div>
                      )
                    )}
                  </div>

                  {/* Unconfirmed Recovery Email Inline Verification */}
                  {cloudSettings?.twoFactor?.emailUnconfirmedPattern && (
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 space-y-2">
                      <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 aurora:text-amber-300 font-medium text-[11px]">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <span>待确认恢复邮箱：{cloudSettings.twoFactor.emailUnconfirmedPattern}</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={emailConfirmCode}
                          onChange={(e) => setEmailConfirmCode(e.target.value)}
                          placeholder="输入邮箱收到的 6 位验证码"
                          className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                        />
                        <button
                          type="button"
                          disabled={actionBusy || !emailConfirmCode.trim()}
                          onClick={() => handleTwoFactorAction('confirm_email', emailConfirmCode)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-[11px] font-medium cursor-pointer disabled:opacity-50 transition-colors"
                        >
                          确认邮箱
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleTwoFactorAction('resend_email')}
                          className="text-[#2481cc] dark:text-[#7cc4ff] aurora:text-[#5eead4] hover:underline cursor-pointer disabled:opacity-50"
                        >
                          重新发送验证邮件
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleTwoFactorAction('cancel_email')}
                          className="text-rose-600 dark:text-rose-400 aurora:text-rose-400 hover:underline cursor-pointer disabled:opacity-50"
                        >
                          取消绑定此邮箱
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Official 7-Day Forgot Password Reset Confirmation */}
                  {showResetConfirm && cloudSettings?.twoFactor?.hasPassword && twoFactorMode === 'idle' && (
                    <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 space-y-2">
                      <div className="text-[11px] text-rose-700 dark:text-rose-400 aurora:text-rose-400 font-medium flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 shrink-0" />
                        <span>忘记原云端两步验证密码？申请官方安全重置</span>
                      </div>
                      <div className="text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] leading-relaxed">
                        调用 Telegram 官方 <code className="px-1 rounded bg-[#e2e8f0] dark:bg-[#132234] aurora:bg-[#13252e]">account.ResetPassword</code>。通常需等待 7 天安全冷却期后生效（若账号当前满足免等条件则立即清除）。
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowResetConfirm(false)}
                          className="px-2.5 py-1 rounded-lg bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] text-[11px] cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleTwoFactorAction('reset_password')}
                          className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-medium cursor-pointer disabled:opacity-50"
                        >
                          {actionBusy ? '提交中...' : '确认提交官方重置申请'}
                        </button>
                      </div>
                    </div>
                  )}

                  {twoFactorMode !== 'idle' && (
                    <form onSubmit={handleSubmitTwoFactor} className="pt-3 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-2.5">
                      {cloudSettings?.twoFactor?.hasPassword && (
                        <div className="relative">
                          <input
                            type={showCur2faPwd ? 'text' : 'password'}
                            required
                            value={cur2faPwd}
                            onChange={(e) => setCur2faPwd(e.target.value)}
                            placeholder="输入当前云端 2FA 密码"
                            className="w-full px-3 py-2 pr-9 text-xs rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowCur2faPwd((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] cursor-pointer"
                            title={showCur2faPwd ? '隐藏密码' : '显示密码'}
                          >
                            {showCur2faPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                      {twoFactorMode !== 'disable' && (
                        <>
                          <div className="relative">
                            <input
                              type={showNew2faPwd ? 'text' : 'password'}
                              required
                              value={new2faPwd}
                              onChange={(e) => setNew2faPwd(e.target.value)}
                              placeholder="输入新的两步验证密码"
                              className="w-full px-3 py-2 pr-9 text-xs rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                            />
                            <button
                              type="button"
                              onClick={() => setShowNew2faPwd((v) => !v)}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] cursor-pointer"
                              title={showNew2faPwd ? '隐藏密码' : '显示密码'}
                            >
                              {showNew2faPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          <input
                            type={showNew2faPwd ? 'text' : 'password'}
                            required
                            value={confirm2faPwd}
                            onChange={(e) => setConfirm2faPwd(e.target.value)}
                            placeholder="再次输入以确认新密码"
                            className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={hint2fa}
                              onChange={(e) => setHint2fa(e.target.value)}
                              placeholder="密码提示语（可选）"
                              className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                            />
                            <input
                              type="email"
                              value={email2fa}
                              onChange={(e) => setEmail2fa(e.target.value)}
                              placeholder={twoFactorMode === 'change' ? '新恢复邮箱（留空保留原邮箱）' : '找回邮箱（可选，需验证）'}
                              className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                            />
                          </div>
                        </>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setTwoFactorMode('idle')}
                          className="px-3 py-1.5 rounded-lg bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] text-xs cursor-pointer transition-colors"
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          disabled={actionBusy}
                          className={`px-3 py-1.5 rounded-lg text-white text-xs font-medium cursor-pointer disabled:opacity-50 transition-colors ${
                            twoFactorMode === 'disable'
                              ? 'bg-rose-600 hover:bg-rose-700'
                              : 'bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e]'
                          }`}
                        >
                          {actionBusy ? '提交至云端...' : twoFactorMode === 'disable' ? '确认关闭 2FA' : '保存至云端'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Granular Individual Telegram Privacy & Security Settings (MTProto Real Controls) */}
                <div className="p-4 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 space-y-3 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                      <span>个人隐私与自定义安全权限</span>
                    </div>
                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                      每项均可独立设置 + 自定义例外用户
                    </span>
                  </div>

                  <div className="divide-y divide-[#e2e8f0] dark:divide-[#18273a] aurora:divide-[#182b34]">
                    {([
                      { key: 'status', title: '最后上线时间与在线状态', supportsNobody: true },
                      { key: 'phone', title: '谁可以看到我的手机号码', supportsNobody: true },
                      { key: 'addedByPhone', title: '谁可以通过手机号找到我', supportsNobody: false, note: '官方仅支持所有人或仅联系人' },
                      { key: 'profilePhoto', title: '谁可以看到我的个人头像', supportsNobody: true },
                      { key: 'bio', title: '谁可以看到我的个人简介', supportsNobody: true },
                      { key: 'forwards', title: '转发我的消息时附带账号主页链接', supportsNobody: true },
                      { key: 'calls', title: '谁可以对我发起语音 / 视频通话', supportsNobody: true },
                      { key: 'p2p', title: '通话点对点 (P2P) 直连', supportsNobody: true, note: '设为仅联系人或没有人可隐藏真实 IP' },
                      { key: 'chatInvite', title: '谁可以将我拉入群组或频道', supportsNobody: true },
                      { key: 'voiceMessages', title: '谁可以向我发送语音与视频消息', supportsNobody: true, note: '限制此项需 Telegram Premium' },
                    ] as Array<{ key: TelegramPrivacyRuleKey; title: string; supportsNobody: boolean; note?: string }>).map((item) => {
                      const rule = cloudSettings?.privacyRules?.[item.key] || (
                        item.key === 'status' && cloudSettings?.privacy
                          ? { mode: cloudSettings.privacy.lastSeen, summary: cloudSettings.privacy.lastSeenSummary, allowUsers: [], disallowUsers: [] }
                          : item.key === 'phone' && cloudSettings?.privacy
                            ? { mode: cloudSettings.privacy.phoneNumber, summary: cloudSettings.privacy.phoneNumberSummary, allowUsers: [], disallowUsers: [] }
                            : undefined
                      );
                      const isExpanded = expandedPrivacyKey === item.key;
                      const excCount = (rule?.allowUsers?.length || 0) + (rule?.disallowUsers?.length || 0);

                      return (
                        <div key={item.key} className="py-2.5 first:pt-1 last:pb-1 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">{item.title}</div>
                              <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                                {rule ? `当前：${rule.summary}` : item.note || '未连接或未获取'}
                                {rule && item.note ? ` · ${item.note}` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={!rule}
                              onClick={() => {
                                if (isExpanded) {
                                  setExpandedPrivacyKey(null);
                                } else {
                                  const refs = getRuleUserRefs(rule);
                                  setPrivacyAllowDraft(refs.allowRefs);
                                  setPrivacyDisallowDraft(refs.disallowRefs);
                                  setAllowUserInput('');
                                  setDisallowUserInput('');
                                  setExpandedPrivacyKey(item.key);
                                }
                              }}
                              className={`px-2 py-1 rounded-md text-[10px] font-medium shrink-0 flex items-center gap-1 cursor-pointer disabled:opacity-40 transition-colors ${
                                excCount > 0
                                  ? 'bg-[#e8f3ff] dark:bg-[#2ba0ff]/15 aurora:bg-[#112d36] text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4]'
                                  : 'bg-[#f1f5f9] dark:bg-[#132234] aurora:bg-[#13252e] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8]'
                              }`}
                            >
                              <UserPlus className="w-3 h-3" />
                              <span>{excCount > 0 ? `例外 (${excCount})` : '自定义例外'}</span>
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          </div>

                          <div className={`grid ${item.supportsNobody ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5`}>
                            {([
                              { id: 'everybody', label: '所有人可见' },
                              { id: 'contacts', label: '仅联系人' },
                              ...(item.supportsNobody ? [{ id: 'nobody', label: '没有人可见' } as const] : []),
                            ] as const).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={actionBusy || !rule}
                                onClick={() => handleChangePrivacy(item.key, opt.id)}
                                className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border cursor-pointer disabled:opacity-50 transition-colors ${
                                  rule?.mode === opt.id
                                    ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#0d9488]'
                                    : 'bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] hover:border-[#2481cc]/60 dark:hover:border-[#2ba0ff]/60 aurora:hover:border-[#2dd4bf]/60'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>

                          {isExpanded && rule && (
                            <div className="p-3 rounded-lg bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] space-y-2.5">
                              {/* Always Allow Users */}
                              <div className="space-y-1.5">
                                <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300 aurora:text-emerald-300">
                                  始终允许的用户（填 @username 或 Telegram 数字 ID）
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {privacyAllowDraft.length === 0 ? (
                                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">无始终允许例外</span>
                                  ) : (
                                    privacyAllowDraft.map((ref) => {
                                      const matched = rule.allowUsers.find((u) => u.username === ref || u.id === ref);
                                      return (
                                        <span
                                          key={ref}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 aurora:text-emerald-300 text-[10px] border border-emerald-500/25"
                                        >
                                          <span>{matched ? `${matched.name} (${ref})` : ref}</span>
                                          <button
                                            type="button"
                                            onClick={() => setPrivacyAllowDraft((prev) => prev.filter((r) => r !== ref))}
                                            className="hover:text-rose-600 dark:hover:text-rose-400 aurora:hover:text-rose-400 cursor-pointer"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </span>
                                      );
                                    })
                                  )}
                                </div>
                                <div className="flex gap-1.5">
                                  <input
                                    type="text"
                                    value={allowUserInput}
                                    onChange={(e) => setAllowUserInput(e.target.value)}
                                    placeholder="例如 @alice 或 123456789"
                                    className="flex-1 px-2.5 py-1 text-[11px] rounded-md bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    disabled={!allowUserInput.trim()}
                                    onClick={() => {
                                      const val = allowUserInput.trim();
                                      if (val && !privacyAllowDraft.includes(val)) {
                                        setPrivacyAllowDraft((prev) => [...prev, val]);
                                      }
                                      setAllowUserInput('');
                                    }}
                                    className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 aurora:text-emerald-300 text-[11px] font-medium cursor-pointer disabled:opacity-40 transition-colors"
                                  >
                                    添加
                                  </button>
                                </div>
                              </div>

                              {/* Never Allow Users */}
                              <div className="space-y-1.5 pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                                <div className="text-[11px] font-medium text-rose-600 dark:text-rose-300 aurora:text-rose-300">
                                  永不允许的用户（填 @username 或 Telegram 数字 ID）
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {privacyDisallowDraft.length === 0 ? (
                                    <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">无永不允许例外</span>
                                  ) : (
                                    privacyDisallowDraft.map((ref) => {
                                      const matched = rule.disallowUsers.find((u) => u.username === ref || u.id === ref);
                                      return (
                                        <span
                                          key={ref}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-300 aurora:text-rose-300 text-[10px] border border-rose-500/25"
                                        >
                                          <span>{matched ? `${matched.name} (${ref})` : ref}</span>
                                          <button
                                            type="button"
                                            onClick={() => setPrivacyDisallowDraft((prev) => prev.filter((r) => r !== ref))}
                                            className="hover:text-rose-700 dark:hover:text-rose-200 aurora:hover:text-rose-200 cursor-pointer"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </span>
                                      );
                                    })
                                  )}
                                </div>
                                <div className="flex gap-1.5">
                                  <input
                                    type="text"
                                    value={disallowUserInput}
                                    onChange={(e) => setDisallowUserInput(e.target.value)}
                                    placeholder="例如 @spammer 或 987654321"
                                    className="flex-1 px-2.5 py-1 text-[11px] rounded-md bg-[#f8fafc] dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    disabled={!disallowUserInput.trim()}
                                    onClick={() => {
                                      const val = disallowUserInput.trim();
                                      if (val && !privacyDisallowDraft.includes(val)) {
                                        setPrivacyDisallowDraft((prev) => [...prev, val]);
                                      }
                                      setDisallowUserInput('');
                                    }}
                                    className="px-2.5 py-1 rounded-md bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-300 aurora:text-rose-300 text-[11px] font-medium cursor-pointer disabled:opacity-40 transition-colors"
                                  >
                                    添加
                                  </button>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setExpandedPrivacyKey(null)}
                                  className="px-2.5 py-1 rounded-md bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#1b2f47] aurora:bg-[#13252e] aurora:hover:bg-[#1a3340] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] text-[11px] cursor-pointer transition-colors"
                                >
                                  收起
                                </button>
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() =>
                                    handleChangePrivacy(item.key, rule.mode, {
                                      allowUserRefs: privacyAllowDraft,
                                      disallowUserRefs: privacyDisallowDraft,
                                    })
                                  }
                                  className="px-3 py-1 rounded-md bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-[11px] font-medium cursor-pointer disabled:opacity-50 transition-colors"
                                >
                                  {actionBusy ? '同步中...' : '保存例外规则到云端'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Global Anti-Harassment & Read Privacy */}
                <div className="p-4 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 space-y-2.5 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                    <span>全局防骚扰与已读隐私</span>
                  </div>
                  {([
                    {
                      field: 'archiveAndMuteNewNoncontactPeers',
                      label: '自动归档并静音陌生非联系人新私聊',
                      desc: '收到陌生人新消息时自动移入归档文件夹并保持静音',
                    },
                    {
                      field: 'keepArchivedUnmuted',
                      label: '已归档但未静音会话保留在归档列表中',
                      desc: '收到新消息时不自动移回主会话列表',
                    },
                    {
                      field: 'keepArchivedFolders',
                      label: '在对话分组文件夹中仍显示已归档会话',
                      desc: '允许归档对话同时保留在自定义文件夹内',
                    },
                    {
                      field: 'hideReadMarks',
                      label: '对非联系人隐藏消息已读时间回执',
                      desc: '需 Telegram Premium 会员才能启用',
                    },
                    {
                      field: 'newNoncontactPeersRequirePremium',
                      label: '仅限联系人和 Premium 会员可向我发起私聊',
                      desc: '需 Telegram Premium 会员才能启用',
                    },
                  ] as Array<{ field: keyof TelegramGlobalPrivacySettings; label: string; desc: string }>).map((gpItem) => (
                    <label
                      key={gpItem.field}
                      className="flex items-start justify-between gap-3 py-1.5 cursor-pointer select-none"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">{gpItem.label}</div>
                        <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">{gpItem.desc}</div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={actionBusy || !cloudSettings?.globalPrivacy}
                        checked={Boolean(cloudSettings?.globalPrivacy?.[gpItem.field])}
                        onChange={(e) => handleToggleGlobalPrivacyField(gpItem.field, e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] rounded cursor-pointer disabled:opacity-40 shrink-0"
                      />
                    </label>
                  ))}
                </div>

                {/* Account Self-Destruct Inactivity TTL */}
                <div className="p-4 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 space-y-2.5 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                      <span>账号长期未登录自动注销期限</span>
                    </div>
                    {typeof cloudSettings?.accountTtlDays === 'number' && (
                      <span className="text-[11px] text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] font-medium tabular-nums">
                        当前：{cloudSettings.accountTtlDays} 天
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { days: 30, label: '1 个月 (30天)' },
                      { days: 90, label: '3 个月 (90天)' },
                      { days: 180, label: '6 个月 (180天)' },
                      { days: 365, label: '1 年 (365天)' },
                    ].map((opt) => (
                      <button
                        key={opt.days}
                        type="button"
                        disabled={actionBusy || typeof cloudSettings?.accountTtlDays !== 'number'}
                        onClick={() => handleUpdateAccountTtl(opt.days)}
                        className={`py-1.5 px-1.5 rounded-lg text-[11px] font-medium border cursor-pointer disabled:opacity-50 transition-colors tabular-nums ${
                          cloudSettings?.accountTtlDays === opt.days
                            ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] text-white border-[#2481cc] dark:border-[#2ba0ff] aurora:border-[#0d9488]'
                            : 'bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] hover:border-[#2481cc]/60 dark:hover:border-[#2ba0ff]/60 aurora:hover:border-[#2dd4bf]/60'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Official Telegram Blacklist / Blocked Users (contacts.GetBlocked + contacts.Unblock) */}
                <div className="p-4 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 space-y-3 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5 tabular-nums">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 aurora:text-amber-400" />
                      <span>黑名单管理 ({blockedUsers.length})</span>
                    </div>
                    <button
                      type="button"
                      disabled={isLoadingBlocked || !currentAccount?.id?.startsWith('acc_tg_')}
                      onClick={() => {
                        if (!currentAccount?.id) return;
                        setIsLoadingBlocked(true);
                        fetchTelegramBlockedContactsApi(currentAccount.id)
                          .then((res) => {
                            if (res.ok && Array.isArray(res.blocked)) setBlockedUsers(res.blocked);
                          })
                          .finally(() => setIsLoadingBlocked(false));
                      }}
                      className="text-[11px] text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingBlocked ? 'animate-spin' : ''}`} />
                      <span>刷新</span>
                    </button>
                  </div>
                  {blockedUsers.length === 0 ? (
                    <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                      {isLoadingBlocked ? '正在同步 Telegram 云端黑名单...' : '当前暂无已拉黑用户'}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {blockedUsers.map((bu) => (
                        <div
                          key={bu.id}
                          className="p-2 rounded-lg bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] truncate">{bu.name}</div>
                            <div className="text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate">
                              {[bu.username, bu.phone].filter(Boolean).join(' · ') || bu.id}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={async () => {
                              if (!currentAccount?.id) return;
                              setActionBusy(true);
                              setActionFeedback(null);
                              try {
                                const res = await unblockTelegramUserContactApi({
                                  accountId: currentAccount.id,
                                  chatId: bu.id,
                                });
                                if (!res.ok) {
                                  setActionFeedback({ type: 'err', text: res.error || '解除拉黑失败' });
                                  return;
                                }
                                setBlockedUsers((prev) => prev.filter((item) => item.id !== bu.id));
                                onBlockStatusChanged?.(bu.id, false);
                                setActionFeedback({ type: 'ok', text: `已将「${bu.name}」移出 Telegram 黑名单` });
                              } finally {
                                setActionBusy(false);
                              }
                            }}
                            className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-600 text-emerald-700 dark:text-emerald-300 aurora:text-emerald-300 hover:text-white text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50 transition-colors"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            <span>解除拉黑</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Official Active Sessions */}
                <div className="p-4 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5 tabular-nums">
                      <Smartphone className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf]" />
                      <span>活跃登录设备 ({cloudSettings?.sessions?.length || 0})</span>
                    </div>
                    {cloudSettings?.sessions && cloudSettings.sessions.length > 1 && (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleTerminateSession({ terminateAllOthers: true })}
                        className="text-[11px] text-rose-600 dark:text-rose-400 aurora:text-rose-400 hover:underline font-medium cursor-pointer disabled:opacity-50"
                      >
                        注销其他所有设备
                      </button>
                    )}
                  </div>

                  {!cloudSettings?.sessions ? (
                    <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">暂未拉取到活跃设备列表</div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {cloudSettings.sessions.map((sess) => (
                        <div
                          key={sess.hash}
                          className="p-2.5 rounded-lg bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] flex items-center gap-1.5 truncate">
                              <span>{sess.deviceModel}</span>
                              {sess.current && (
                                <span className="text-emerald-700 dark:text-emerald-300 aurora:text-emerald-300 text-[11px] font-medium">
                                  · 当前连接
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] truncate">
                              {sess.appName} {sess.appVersion} · {sess.platform} {sess.systemVersion}
                            </div>
                            <div className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] truncate tabular-nums">
                              IP: {sess.ip} ({[sess.country, sess.region].filter(Boolean).join(', ') || '未知地区'}) · 活跃: {formatUnixTimestamp(sess.dateActive)}
                            </div>
                          </div>
                          {!sess.current && (
                            <button
                              type="button"
                              disabled={actionBusy}
                              onClick={() => handleTerminateSession({ hash: sess.hash })}
                              className="px-2 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 aurora:text-rose-300 text-[11px] font-medium shrink-0 cursor-pointer disabled:opacity-50 transition-colors"
                            >
                              下线
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-3 max-w-md text-xs">
                <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between">
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">私聊新消息通知</div>
                  <input
                    type="checkbox"
                    disabled={actionBusy || !cloudSettings?.notifications}
                    checked={Boolean(cloudSettings?.notifications?.users?.enabled)}
                    onChange={(e) =>
                      handleUpdateNotifications(
                        'users',
                        e.target.checked,
                        Boolean(cloudSettings?.notifications?.users?.showPreviews)
                      )
                    }
                    className="w-4 h-4 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] rounded cursor-pointer disabled:opacity-40"
                  />
                </div>

                <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between">
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">群组与频道通知</div>
                  <input
                    type="checkbox"
                    disabled={actionBusy || !cloudSettings?.notifications}
                    checked={Boolean(cloudSettings?.notifications?.chats?.enabled)}
                    onChange={(e) =>
                      handleUpdateNotifications(
                        'chats',
                        e.target.checked,
                        Boolean(cloudSettings?.notifications?.chats?.showPreviews)
                      )
                    }
                    className="w-4 h-4 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] rounded cursor-pointer disabled:opacity-40"
                  />
                </div>

                <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between">
                  <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">消息内容预览</div>
                  <input
                    type="checkbox"
                    disabled={actionBusy || !cloudSettings?.notifications}
                    checked={Boolean(cloudSettings?.notifications?.users?.showPreviews)}
                    onChange={(e) =>
                      handleUpdateNotifications(
                        'both',
                        Boolean(cloudSettings?.notifications?.users?.enabled),
                        e.target.checked
                      )
                    }
                    className="w-4 h-4 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] rounded cursor-pointer disabled:opacity-40"
                  />
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-4 max-w-md text-xs">
                <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 space-y-3 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34]">
                  <div>
                    <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">界面色调模式</div>
                    <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                      当前主题: {theme === 'aurora' ? '极光青暗模式' : theme === 'dark' ? '深夜暗色主题' : '经典亮白主题'}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'light', label: '经典亮白', swatch: 'bg-[#f4f7fb] border-[#cbd5e1]' },
                        { id: 'dark', label: '深夜蓝黑', swatch: 'bg-[#09111d] border-[#2ba0ff]' },
                        { id: 'aurora', label: '极光青暗', swatch: 'bg-[#081116] border-[#2dd4bf]' },
                      ] as const
                    ).map((opt) => {
                      const isActive = theme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            if (onSelectTheme) {
                              onSelectTheme(opt.id);
                            } else {
                              onToggleTheme();
                            }
                          }}
                          className={`p-2 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2 ${
                            isActive
                              ? opt.id === 'aurora'
                                ? 'bg-[#112d36] border-[#2dd4bf] text-[#5eead4] font-semibold'
                                : 'bg-[#e8f3ff] dark:bg-[#2ba0ff]/15 border-[#2481cc] dark:border-[#2ba0ff] text-[#0284c7] dark:text-[#7cc4ff] font-semibold'
                              : 'bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] hover:border-[#94a3b8] dark:hover:border-[#2ba0ff]/40 aurora:hover:border-[#2dd4bf]/40'
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded-full border shrink-0 ${opt.swatch}`} />
                          <span className="truncate">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">回车发送消息</div>
                    <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                      {effectivePrefs.sendWithEnter ? '按 Enter 发送，Shift+Enter 换行' : '按 Ctrl+Enter 发送'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={effectivePrefs.sendWithEnter}
                    onChange={(e) => updatePref({ sendWithEnter: e.target.checked })}
                    className="w-4 h-4 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] rounded cursor-pointer"
                  />
                </div>
              </div>
            )}

            {activeTab === 'folders' && (
              <div className="space-y-3 max-w-lg text-xs">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                    对话分组文件夹（最多 12 字标题）
                  </div>
                  {cloudSettings && !editingFolder && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditingFolder({
                          title: '',
                          contacts: true,
                          nonContacts: false,
                          groups: false,
                          broadcasts: false,
                          bots: false,
                          excludeMuted: false,
                          excludeRead: false,
                          excludeArchived: true,
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新建文件夹</span>
                    </button>
                  )}
                </div>

                {editingFolder && (
                  <form onSubmit={handleSaveFolder} className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 space-y-3 border border-[#2481cc]/35 dark:border-[#2ba0ff]/35 aurora:border-[#2dd4bf]/35">
                    <div className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
                      {editingFolder.id ? '编辑云端文件夹' : '新建云端文件夹'}
                    </div>
                    <input
                      type="text"
                      required
                      maxLength={12}
                      value={editingFolder.title}
                      onChange={(e) => setEditingFolder({ ...editingFolder, title: e.target.value })}
                      placeholder="文件夹名称（最多 12 个字符）"
                      className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf]"
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8]">
                      {([
                        ['contacts', '包含联系人'],
                        ['nonContacts', '包含非联系人'],
                        ['groups', '包含群组'],
                        ['broadcasts', '包含频道'],
                        ['bots', '包含机器人'],
                        ['excludeMuted', '排除已静音'],
                        ['excludeRead', '排除已读'],
                        ['excludeArchived', '排除已归档'],
                      ] as const).map(([field, label]) => (
                        <label key={field} className="flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={editingFolder[field]}
                            onChange={(e) => setEditingFolder({ ...editingFolder, [field]: e.target.checked })}
                            className="w-3.5 h-3.5 accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] rounded"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingFolder(null)}
                        className="px-3 py-1.5 rounded-lg bg-[#f1f5f9] hover:bg-[#e2e8f0] dark:bg-[#132234] dark:hover:bg-[#1b2f47] aurora:bg-[#13252e] aurora:hover:bg-[#1a3340] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] text-xs cursor-pointer transition-colors"
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        disabled={actionBusy}
                        className="px-3 py-1.5 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] aurora:hover:bg-[#0f766e] text-white text-xs font-medium cursor-pointer disabled:opacity-50 transition-colors"
                      >
                        {actionBusy ? '同步中...' : '保存至云端'}
                      </button>
                    </div>
                  </form>
                )}

                {!cloudSettings?.folders ? (
                  <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">请先在线连接 Telegram 账号以同步官方文件夹</div>
                ) : cloudSettings.folders.length === 0 ? (
                  <div className="p-4 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] text-center text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5]">
                    暂无自定义对话文件夹
                  </div>
                ) : (
                  <div className="space-y-2">
                    {cloudSettings.folders.map((folder) => (
                      <div key={folder.id} className="p-3 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8]">
                            <Folder className="w-4 h-4 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] shrink-0" />
                            <span className="truncate">{folder.title}</span>
                          </div>
                          <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] mt-0.5 truncate">
                            {summarizeFolderRules(folder)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() =>
                              setEditingFolder({
                                id: folder.id,
                                title: folder.title,
                                contacts: folder.contacts,
                                nonContacts: folder.nonContacts,
                                groups: folder.groups,
                                broadcasts: folder.broadcasts,
                                bots: folder.bots,
                                excludeMuted: folder.excludeMuted,
                                excludeRead: folder.excludeRead,
                                excludeArchived: folder.excludeArchived,
                              })
                            }
                            title="编辑文件夹规则"
                            className="p-1.5 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-[#2481cc] dark:hover:text-[#2ba0ff] aurora:hover:text-[#2dd4bf] hover:bg-[#e2e8f0]/60 dark:hover:bg-[#1b2f47]/60 aurora:hover:bg-[#1a3340]/60 cursor-pointer transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleDeleteFolder(folder.id)}
                            title="从 Telegram 云端删除此文件夹"
                            className="p-1.5 rounded-lg text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] hover:text-rose-600 dark:hover:text-rose-400 aurora:hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
