import {
  AiQaLocalChatItem,
  ChatAppearanceSettings,
  WorkflowPlaybookItem,
} from '../types';

export interface DesktopAiWindowOpenOptions {
  screenX?: number;
  screenY?: number;
  grabOffsetX?: number;
  grabOffsetY?: number;
  width?: number;
  height?: number;
  alwaysOnTop?: boolean;
}

export interface DesktopAiWindowState {
  isElectron: boolean;
  supported: boolean;
  isOpen: boolean;
  isMinimized?: boolean;
  isMaximized?: boolean;
  alwaysOnTop: boolean;
  action?: 'open' | 'focus' | 'dock-back' | 'close' | 'minimize' | 'maximize' | 'pin';
  reason?: string;
}

export interface DesktopAiWindowBridge {
  isAvailable?: boolean;
  open: (options?: DesktopAiWindowOpenOptions) => Promise<{ ok: boolean; state?: DesktopAiWindowState; error?: string }>;
  dockBack: () => Promise<{ ok: boolean; state?: DesktopAiWindowState }>;
  close: () => Promise<{ ok: boolean; state?: DesktopAiWindowState }>;
  focus: () => Promise<{ ok: boolean; state?: DesktopAiWindowState }>;
  minimize: () => Promise<{ ok: boolean; state?: DesktopAiWindowState }>;
  toggleMaximize: () => Promise<{ ok: boolean; state?: DesktopAiWindowState }>;
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<{ ok: boolean; state?: DesktopAiWindowState }>;
  getState: () => Promise<DesktopAiWindowState>;
  onStateChange: (callback: (state: DesktopAiWindowState) => void) => () => void;
}

export interface AiAssistantSyncedState {
  messages: AiQaLocalChatItem[];
  inputText: string;
  pendingImages: string[];
  activeContextText: string;
  activeContextLabel: string;
  selectedPlaybookDay: WorkflowPlaybookItem | null;
  activeChatTitle?: string;
  engineLicenseKey?: string;
  operatorAvatarUrl?: string;
  operatorInitial?: string;
  appearance?: ChatAppearanceSettings;
  updatedAt: number;
  senderId: string;
}

const SYNC_CHANNEL_NAME = 'hs_ai_assistant_sync_v1';
const SYNC_STORAGE_KEY = 'hs_ai_assistant_sync_state_v1';
const WINDOW_INSTANCE_ID = `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let sharedChannel: BroadcastChannel | null = null;
let memorySnapshot: Partial<AiAssistantSyncedState> | null = null;

function getSyncChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!sharedChannel) {
    try {
      sharedChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    } catch {
      sharedChannel = null;
    }
  }
  return sharedChannel;
}

export function getAiWindowSenderId(): string {
  return WINDOW_INSTANCE_ID;
}

export function getDesktopAiWindowBridge(): DesktopAiWindowBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as any).humanSenseAiWindow;
  if (!bridge || typeof bridge.open !== 'function') {
    return null;
  }
  return bridge as DesktopAiWindowBridge;
}

export function isAiAssistantPopoutRoute(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'ai-assistant';
  } catch {
    return false;
  }
}

function createCompactStorageCopy(state: AiAssistantSyncedState): AiAssistantSyncedState {
  const stripLargeDataUrls = (arr?: string[]) =>
    Array.isArray(arr)
      ? arr.filter((src) => typeof src === 'string' && src.length <= 250_000).slice(0, 4)
      : [];

  return {
    ...state,
    pendingImages: stripLargeDataUrls(state.pendingImages),
    messages: state.messages.slice(-30).map((m) => ({
      ...m,
      images: stripLargeDataUrls(m.images),
    })),
  };
}

function readStorageSnapshot(): Partial<AiAssistantSyncedState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Partial<AiAssistantSyncedState>;
  } catch {
    return null;
  }
}

export function loadAiAssistantSnapshot(): Partial<AiAssistantSyncedState> | null {
  if (memorySnapshot) {
    return memorySnapshot;
  }
  const stored = readStorageSnapshot();
  if (stored) {
    memorySnapshot = stored;
  }
  return stored;
}

export function publishAiAssistantState(
  partial: Partial<Omit<AiAssistantSyncedState, 'updatedAt' | 'senderId'>>
): void {
  if (typeof window === 'undefined') return;
  const existing = memorySnapshot || readStorageSnapshot() || {};
  const merged: AiAssistantSyncedState = {
    messages: Array.isArray(partial.messages)
      ? partial.messages
      : Array.isArray(existing.messages)
      ? existing.messages
      : [],
    inputText:
      typeof partial.inputText === 'string'
        ? partial.inputText
        : typeof existing.inputText === 'string'
        ? existing.inputText
        : '',
    pendingImages: Array.isArray(partial.pendingImages)
      ? partial.pendingImages
      : Array.isArray(existing.pendingImages)
      ? existing.pendingImages
      : [],
    activeContextText:
      typeof partial.activeContextText === 'string'
        ? partial.activeContextText
        : typeof existing.activeContextText === 'string'
        ? existing.activeContextText
        : '',
    activeContextLabel:
      typeof partial.activeContextLabel === 'string'
        ? partial.activeContextLabel
        : typeof existing.activeContextLabel === 'string'
        ? existing.activeContextLabel
        : '',
    selectedPlaybookDay:
      'selectedPlaybookDay' in partial
        ? partial.selectedPlaybookDay ?? null
        : existing.selectedPlaybookDay ?? null,
    activeChatTitle:
      'activeChatTitle' in partial
        ? partial.activeChatTitle
        : existing.activeChatTitle,
    engineLicenseKey:
      'engineLicenseKey' in partial
        ? partial.engineLicenseKey
        : existing.engineLicenseKey,
    operatorAvatarUrl:
      'operatorAvatarUrl' in partial
        ? partial.operatorAvatarUrl
        : existing.operatorAvatarUrl,
    operatorInitial:
      'operatorInitial' in partial
        ? partial.operatorInitial
        : existing.operatorInitial,
    appearance:
      'appearance' in partial
        ? partial.appearance
        : existing.appearance,
    updatedAt: Date.now(),
    senderId: WINDOW_INSTANCE_ID,
  };

  memorySnapshot = merged;

  try {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    try {
      localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(createCompactStorageCopy(merged)));
    } catch {}
  }

  const ch = getSyncChannel();
  if (ch) {
    try {
      ch.postMessage({
        type: 'state-update',
        payload: {
          ...partial,
          updatedAt: merged.updatedAt,
          senderId: WINDOW_INSTANCE_ID,
        },
      });
    } catch {}
  }
}

export function clearAiAssistantSnapshot(): void {
  if (typeof window === 'undefined') return;
  memorySnapshot = null;
  try {
    localStorage.removeItem(SYNC_STORAGE_KEY);
  } catch {}
  const ch = getSyncChannel();
  if (ch) {
    try {
      ch.postMessage({
        type: 'state-update',
        payload: {
          messages: [],
          inputText: '',
          pendingImages: [],
          activeContextText: '',
          activeContextLabel: '',
          selectedPlaybookDay: null,
          activeChatTitle: undefined,
          engineLicenseKey: undefined,
          operatorAvatarUrl: undefined,
          operatorInitial: '我',
          updatedAt: Date.now(),
          senderId: WINDOW_INSTANCE_ID,
        },
      });
    } catch {}
  }
}

export function requestAiAssistantSync(): void {
  const ch = getSyncChannel();
  if (!ch) return;
  try {
    ch.postMessage({
      type: 'request-sync',
      senderId: WINDOW_INSTANCE_ID,
    });
  } catch {}
}

export function subscribeAiAssistantSync(
  onRemoteState: (state: Partial<AiAssistantSyncedState>) => void,
  onSyncRequested?: () => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const ch = getSyncChannel();

  const applyRemotePatchToMemory = (patch: Partial<AiAssistantSyncedState>) => {
    const base = memorySnapshot || readStorageSnapshot() || {};
    memorySnapshot = {
      ...base,
      ...patch,
    };
  };

  const handleMessage = (event: MessageEvent) => {
    const data = event?.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'request-sync' && data.senderId !== WINDOW_INSTANCE_ID) {
      onSyncRequested?.();
      return;
    }
    if (data.type === 'state-update' && data.payload && data.payload.senderId !== WINDOW_INSTANCE_ID) {
      const patch = data.payload as Partial<AiAssistantSyncedState>;
      applyRemotePatchToMemory(patch);
      onRemoteState(patch);
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (ch) return;
    if (event.key !== SYNC_STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as AiAssistantSyncedState;
      if (parsed && parsed.senderId !== WINDOW_INSTANCE_ID) {
        applyRemotePatchToMemory(parsed);
        onRemoteState(parsed);
      }
    } catch {}
  };

  if (ch) {
    ch.addEventListener('message', handleMessage);
  }
  window.addEventListener('storage', handleStorage);

  return () => {
    if (ch) {
      ch.removeEventListener('message', handleMessage);
    }
    window.removeEventListener('storage', handleStorage);
  };
}
