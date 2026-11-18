export type TelegramConnectionPhase =
  | 'online'
  | 'connecting'
  | 'reconnecting'
  | 'restoring'
  | 'offline'
  | 'expired';

export const TRANSIENT_DISCONNECT_GRACE_MS = 9000;

export function normalizeTelegramPhoneClient(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }
  if (!cleaned.startsWith('+')) {
    cleaned = `+${cleaned}`;
  }
  const digits = cleaned.slice(1).replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

export interface ResolvedTelegramAccountIdentity {
  isPersonalTelegram: boolean;
  runtimeKey: string;
  userId?: string;
  phone?: string;
  scopedAccountId?: string;
  canonicalAccountId?: string;
}

/**
 * Frontend counterpart of server.ts resolveTelegramAccountRuntimeKey:
 * Ensures opaque internal frontend IDs never overwrite a real phone number,
 * and supports acc_tg_<id>, tg_<id>, numeric userId, +/00 international phone, and id+phone combos.
 */
export function resolveTelegramAccountIdentity(opts: {
  id?: string | null;
  userId?: string | null;
  phone?: string | null;
}): ResolvedTelegramAccountIdentity {
  const rawId = String(opts.id || '').trim();
  if (rawId === 'acc_telegram_bot') {
    return { isPersonalTelegram: false, runtimeKey: '' };
  }
  const rawUidField = String(opts.userId || '').trim();
  const rawPhoneField = String(opts.phone || '').trim();

  let uid = rawUidField;
  if (!uid) {
    if (rawId.startsWith('uid:')) uid = rawId.slice(4).trim();
    else if (rawId.startsWith('acc_tg_')) uid = rawId.slice(7).trim();
    else if (rawId.startsWith('tg_')) uid = rawId.slice(3).trim();
    else if (!/^00\d+$/.test(rawId) && /^\d+$/.test(rawId)) uid = rawId;
  }

  const idPhoneCandidate = rawId.startsWith('phone:')
    ? rawId.slice(6).trim()
    : rawId.startsWith('+') || /^00\d+$/.test(rawId)
      ? rawId
      : '';
  const normPhone = rawPhoneField
    ? normalizeTelegramPhoneClient(rawPhoneField)
    : idPhoneCandidate
      ? normalizeTelegramPhoneClient(idPhoneCandidate)
      : '';

  if (uid) {
    return {
      isPersonalTelegram: true,
      runtimeKey: `uid:${uid}`,
      userId: uid,
      ...(normPhone ? { phone: normPhone } : {}),
      scopedAccountId: `acc_tg_${uid}`,
      canonicalAccountId: `acc_tg_${uid}`,
    };
  }
  if (normPhone) {
    return {
      isPersonalTelegram: true,
      runtimeKey: `phone:${normPhone}`,
      phone: normPhone,
      scopedAccountId: normPhone,
      canonicalAccountId: normPhone,
    };
  }
  return {
    isPersonalTelegram: false,
    runtimeKey: rawId ? `acc:${rawId}` : '',
  };
}

export function getTelegramConnectionPhaseLabel(phase?: TelegramConnectionPhase): string {
  switch (phase) {
    case 'online':
      return '已直连';
    case 'connecting':
      return '正在连接...';
    case 'restoring':
      return '正在恢复会话...';
    case 'reconnecting':
      return '连接波动，正在重连...';
    case 'expired':
      return '会话已失效，请重新登录';
    case 'offline':
    default:
      return '未连接';
  }
}

export function evaluateTelegramAccountUiState(input: {
  phase: TelegramConnectionPhase;
  lastError?: string | null;
  offlineReason?: string | null;
  transientSince?: number | null;
  now: number;
}): {
  uiStatus: 'online' | 'away' | 'offline' | 'expired';
  connectionPhase: TelegramConnectionPhase;
  shouldShowBanner: boolean;
  nextGraceCheckInMs: number | null;
  displayReason: string | null;
} {
  if (input.phase === 'online') {
    return {
      uiStatus: 'online',
      connectionPhase: 'online',
      shouldShowBanner: false,
      nextGraceCheckInMs: null,
      displayReason: null,
    };
  }
  if (input.phase === 'expired') {
    return {
      uiStatus: 'expired',
      connectionPhase: 'expired',
      shouldShowBanner: true,
      nextGraceCheckInMs: null,
      displayReason: input.offlineReason || input.lastError || 'Telegram 会话已失效',
    };
  }
  if (input.phase === 'offline') {
    return {
      uiStatus: 'offline',
      connectionPhase: 'offline',
      shouldShowBanner: true,
      nextGraceCheckInMs: null,
      displayReason: input.offlineReason || input.lastError || 'MTProto 连接尚未建立',
    };
  }
  const since = input.transientSince ?? input.now;
  const elapsed = Math.max(0, input.now - since);
  const withinGrace = elapsed < TRANSIENT_DISCONNECT_GRACE_MS;
  return {
    uiStatus: 'away',
    connectionPhase: input.phase,
    shouldShowBanner: !withinGrace,
    nextGraceCheckInMs: withinGrace ? Math.max(250, TRANSIENT_DISCONNECT_GRACE_MS - elapsed) : null,
    displayReason: input.offlineReason || input.lastError || getTelegramConnectionPhaseLabel(input.phase),
  };
}
