import type { MasterVoiceprint } from '../types/index.ts';

const STORAGE_KEY = 'tg_master_voiceprint';

export const DEFAULT_SAMPLE_TRANSCRIPT =
  '你好，这是我的个人预设音色与语速音高配置，用于语音合成输出。';

export function getMasterVoiceprint(): MasterVoiceprint | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as MasterVoiceprint;
    return parsed;
  } catch (e) {
    console.warn('Failed to parse master voiceprint from storage', e);
    return null;
  }
}

export function saveMasterVoiceprint(voiceprint: MasterVoiceprint): { success: boolean; error?: string } {
  if (typeof window === 'undefined') return { success: false, error: '环境不支持本地存储' };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(voiceprint));
    // Dispatch custom event for real-time reactive sync across components
    window.dispatchEvent(new CustomEvent('tg_voiceprint_updated', { detail: voiceprint }));
    return { success: true };
  } catch (e: any) {
    console.error('Failed to save master voiceprint to storage', e);
    const errText = e?.name === 'QuotaExceededError'
      ? '音频文件体积过大，超出存储限额，不可用。'
      : (e?.message || '存储不可用');
    return { success: false, error: errText };
  }
}

export function toggleMasterVoiceprintDefault(enabled: boolean): MasterVoiceprint | null {
  const current = getMasterVoiceprint();
  if (!current) return null;
  const updated = { ...current, enabledAsDefault: enabled, updatedAt: Date.now() };
  saveMasterVoiceprint(updated);
  return updated;
}

export function clearMasterVoiceprint(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('tg_voiceprint_updated', { detail: null }));
  } catch (e) {
    console.error('Failed to clear master voiceprint', e);
  }
}
