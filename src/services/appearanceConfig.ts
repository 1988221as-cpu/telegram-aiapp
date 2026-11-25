import {
  AppThemeMode,
  BubbleCornerStyle,
  ChatAppearanceSettings,
  OfficialThemePresetId,
  OfficialWallpaperId,
} from '../types';

export const APPEARANCE_STORAGE_KEY = 'tg_pro_appearance_v1';

export interface OfficialThemePreset {
  id: OfficialThemePresetId;
  name: string;
  subtitle: string;
  baseTheme: AppThemeMode;
  defaultAccent: string;
  defaultWallpaper: OfficialWallpaperId;
  previewBg: string;
  previewBubbleIn: string;
  previewBubbleOut: string;
  previewBorder: string;
  isDark: boolean;
}

export const OFFICIAL_THEME_PRESETS: OfficialThemePreset[] = [
  {
    id: 'tg_classic',
    name: '经典日间',
    subtitle: 'Telegram Classic',
    baseTheme: 'light',
    defaultAccent: '#2481cc',
    defaultWallpaper: 'tg_doodle',
    previewBg: '#eef3f8',
    previewBubbleIn: '#ffffff',
    previewBubbleOut: '#1e88e5',
    previewBorder: '#cbd5e1',
    isDark: false,
  },
  {
    id: 'tg_day_blue',
    name: '晴空蓝韵',
    subtitle: 'Telegram Day',
    baseTheme: 'light',
    defaultAccent: '#168acd',
    defaultWallpaper: 'tg_sky',
    previewBg: '#e5f1fb',
    previewBubbleIn: '#ffffff',
    previewBubbleOut: '#168acd',
    previewBorder: '#bfdbfe',
    isDark: false,
  },
  {
    id: 'tg_night',
    name: '深夜蓝黑',
    subtitle: 'Telegram Night',
    baseTheme: 'dark',
    defaultAccent: '#2ba0ff',
    defaultWallpaper: 'default',
    previewBg: '#070d16',
    previewBubbleIn: '#111d2c',
    previewBubbleOut: '#1b4975',
    previewBorder: '#1e3148',
    isDark: true,
  },
  {
    id: 'tg_tinted',
    name: '深海微光',
    subtitle: 'Telegram Tinted',
    baseTheme: 'dark',
    defaultAccent: '#5288c1',
    defaultWallpaper: 'tg_ocean',
    previewBg: '#0e1621',
    previewBubbleIn: '#182533',
    previewBubbleOut: '#2b5278',
    previewBorder: '#243447',
    isDark: true,
  },
  {
    id: 'aurora',
    name: '极光青暗',
    subtitle: 'Aurora Teal',
    baseTheme: 'aurora',
    defaultAccent: '#14b8a6',
    defaultWallpaper: 'default',
    previewBg: '#081116',
    previewBubbleIn: '#101c23',
    previewBubbleOut: '#11434d',
    previewBorder: '#182b34',
    isDark: true,
  },
  {
    id: 'linen',
    name: '羊皮暖沙',
    subtitle: 'Warm Linen',
    baseTheme: 'linen',
    defaultAccent: '#a86a43',
    defaultWallpaper: 'default',
    previewBg: '#d4c7b3',
    previewBubbleIn: '#faf6ee',
    previewBubbleOut: '#3a6652',
    previewBorder: '#cbbba2',
    isDark: false,
  },
];

export const OFFICIAL_ACCENT_SWATCHES: Array<{ label: string; hex: string }> = [
  { label: '官方蓝', hex: '#2481cc' },
  { label: '天际蓝', hex: '#2ba0ff' },
  { label: '深海蓝', hex: '#5288c1' },
  { label: '翡翠绿', hex: '#2f9e66' },
  { label: '极光青', hex: '#0d9488' },
  { label: '紫罗兰', hex: '#7c5cdb' },
  { label: '珊瑚红', hex: '#d9534f' },
  { label: '琥珀橙', hex: '#c77d2b' },
  { label: '玫瑰粉', hex: '#c94a7c' },
  { label: '松柏绿', hex: '#3a6652' },
];

export const OFFICIAL_WALLPAPER_OPTIONS: Array<{
  id: OfficialWallpaperId;
  label: string;
  description: string;
}> = [
  { id: 'default', label: '主题默认', description: '随当前主题自动匹配底纹' },
  { id: 'tg_doodle', label: '官方暗纹', description: 'Telegram 经典几何矢量底纹' },
  { id: 'tg_sky', label: '晴空渐变', description: '柔和蓝青氛围渐变背景' },
  { id: 'tg_ocean', label: '深海幽蓝', description: '沉浸式深海微光渐变' },
  { id: 'tg_sunset', label: '暮光暖意', description: '温和日落琥珀玫瑰渐变' },
  { id: 'solid', label: '纯净素色', description: '极简无底纹纯色画布' },
];

export const BUBBLE_CORNER_OPTIONS: Array<{
  id: BubbleCornerStyle;
  label: string;
  radiusPx: string;
}> = [
  { id: 'compact', label: '方正利落', radiusPx: '8px' },
  { id: 'standard', label: '官方标准', radiusPx: '12px' },
  { id: 'rounded', label: '柔和圆润', radiusPx: '18px' },
];

export function defaultPresetForTheme(theme: AppThemeMode): OfficialThemePresetId {
  switch (theme) {
    case 'light':
      return 'tg_classic';
    case 'dark':
      return 'tg_night';
    case 'aurora':
      return 'aurora';
    case 'linen':
    default:
      return 'linen';
  }
}

export function getDefaultAppearance(baseTheme: AppThemeMode = 'linen'): ChatAppearanceSettings {
  const presetId = defaultPresetForTheme(baseTheme);
  const preset = OFFICIAL_THEME_PRESETS.find((p) => p.id === presetId) || OFFICIAL_THEME_PRESETS[5];
  return {
    presetId: preset.id,
    baseTheme: preset.baseTheme,
    accentColor: null,
    wallpaperId: preset.defaultWallpaper,
    wallpaperIntensity: 55,
    bubbleStyle: 'standard',
  };
}

export function loadStoredAppearance(fallbackTheme: AppThemeMode): ChatAppearanceSettings {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const validBase: AppThemeMode =
        parsed?.baseTheme === 'light' ||
        parsed?.baseTheme === 'dark' ||
        parsed?.baseTheme === 'aurora' ||
        parsed?.baseTheme === 'linen'
          ? parsed.baseTheme
          : fallbackTheme;
      const presetExists = OFFICIAL_THEME_PRESETS.some((p) => p.id === parsed?.presetId);
      const validPreset: OfficialThemePresetId = presetExists
        ? parsed.presetId
        : defaultPresetForTheme(validBase);
      const validWallpaper: OfficialWallpaperId = OFFICIAL_WALLPAPER_OPTIONS.some(
        (w) => w.id === parsed?.wallpaperId
      )
        ? parsed.wallpaperId
        : 'default';
      const validBubble: BubbleCornerStyle = BUBBLE_CORNER_OPTIONS.some(
        (b) => b.id === parsed?.bubbleStyle
      )
        ? parsed.bubbleStyle
        : 'standard';
      const intensityNum = Number(parsed?.wallpaperIntensity);
      const validIntensity = Number.isFinite(intensityNum)
        ? Math.max(0, Math.min(100, Math.round(intensityNum)))
        : 55;
      const rawAccent = typeof parsed?.accentColor === 'string' ? parsed.accentColor.trim() : '';
      const validAccent = /^#[0-9a-fA-F]{6}$/.test(rawAccent) ? rawAccent : null;
      return {
        presetId: validPreset,
        baseTheme: validBase,
        accentColor: validAccent,
        wallpaperId: validWallpaper,
        wallpaperIntensity: validIntensity,
        bubbleStyle: validBubble,
      };
    }
  } catch {}
  return getDefaultAppearance(fallbackTheme);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
}

function mixRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  weightB: number
): { r: number; g: number; b: number } {
  const wA = 1 - weightB;
  return {
    r: a.r * wA + b.r * weightB,
    g: a.g * wA + b.g * weightB,
    b: a.b * wA + b.b * weightB,
  };
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

export function computeDerivedThemeTokens(settings: ChatAppearanceSettings): {
  isDark: boolean;
  primaryHex: string;
  primaryTextHex: string;
  activeHex: string;
  bubbleOutHex: string;
  bubbleOutTextHex: string;
  accentGlowRgba: string;
  borderGlowRgba: string;
  hasCustomAccent: boolean;
  bubbleRadiusPx: string;
  wallpaperOpacity: number;
} {
  const preset =
    OFFICIAL_THEME_PRESETS.find((p) => p.id === settings.presetId) ||
    OFFICIAL_THEME_PRESETS.find((p) => p.baseTheme === settings.baseTheme) ||
    OFFICIAL_THEME_PRESETS[0];
  const isDark = settings.baseTheme === 'dark' || settings.baseTheme === 'aurora';
  const hasCustomAccent = Boolean(
    settings.accentColor ||
      (settings.presetId !== defaultPresetForTheme(settings.baseTheme) && preset)
  );
  const baseAccentHex = settings.accentColor || preset.defaultAccent;
  const accentRgb = hexToRgb(baseAccentHex) || { r: 36, g: 129, b: 204 };

  // Outgoing bubbles keep rich contrast so white text, timestamps, and inline translation remain crisp
  let bubbleOutRgb = isDark
    ? mixRgb(accentRgb, { r: 12, g: 24, b: 38 }, 0.52)
    : accentRgb;
  if (relativeLuminance(bubbleOutRgb) > 0.34) {
    let factor = 0.25;
    while (factor <= 0.85) {
      const candidate = mixRgb(bubbleOutRgb, { r: 15, g: 23, b: 42 }, factor);
      if (relativeLuminance(candidate) <= 0.34) {
        bubbleOutRgb = candidate;
        break;
      }
      factor += 0.1;
    }
  }
  const bubbleOutHex = rgbToHex(bubbleOutRgb.r, bubbleOutRgb.g, bubbleOutRgb.b);
  const bubbleOutTextHex = '#ffffff';
  const primaryTextHex = relativeLuminance(accentRgb) > 0.45 ? '#0f172a' : '#ffffff';

  const bubbleRadiusPx =
    BUBBLE_CORNER_OPTIONS.find((b) => b.id === settings.bubbleStyle)?.radiusPx || '12px';

  return {
    isDark,
    primaryHex: baseAccentHex,
    primaryTextHex,
    activeHex: baseAccentHex,
    bubbleOutHex,
    bubbleOutTextHex,
    accentGlowRgba: `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${isDark ? 0.24 : 0.16})`,
    borderGlowRgba: `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${isDark ? 0.36 : 0.28})`,
    hasCustomAccent,
    bubbleRadiusPx,
    wallpaperOpacity: Math.max(0.08, Math.min(1, settings.wallpaperIntensity / 100)),
  };
}

export function applyAppearanceToDocument(settings: ChatAppearanceSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const theme = settings.baseTheme;

  root.classList.toggle('dark', theme === 'dark' || theme === 'aurora');
  root.classList.toggle('theme-aurora', theme === 'aurora');
  root.classList.toggle('theme-linen', theme === 'linen');

  const tokens = computeDerivedThemeTokens(settings);

  root.dataset.tgPreset = settings.presetId;
  root.dataset.wallpaper = settings.wallpaperId;
  root.dataset.bubbleStyle = settings.bubbleStyle;
  root.dataset.customAccent = tokens.hasCustomAccent ? 'true' : 'false';

  root.style.setProperty('--tg-bubble-radius', tokens.bubbleRadiusPx);
  root.style.setProperty('--tg-wallpaper-opacity', String(tokens.wallpaperOpacity));

  if (tokens.hasCustomAccent) {
    root.style.setProperty('--tg-color-primary', tokens.primaryHex);
    root.style.setProperty('--tg-accent-text', tokens.primaryTextHex);
    root.style.setProperty('--tg-bg-active', tokens.activeHex);
    root.style.setProperty('--tg-bg-bubble-out', tokens.bubbleOutHex);
    root.style.setProperty('--tg-bubble-out-text', tokens.bubbleOutTextHex);
    root.style.setProperty('--tg-color-accent-glow', tokens.accentGlowRgba);
    root.style.setProperty('--tg-border-glow', tokens.borderGlowRgba);
  } else {
    root.style.removeProperty('--tg-color-primary');
    root.style.removeProperty('--tg-accent-text');
    root.style.removeProperty('--tg-bg-active');
    root.style.removeProperty('--tg-bg-bubble-out');
    root.style.removeProperty('--tg-bubble-out-text');
    root.style.removeProperty('--tg-color-accent-glow');
    root.style.removeProperty('--tg-border-glow');
  }
}
