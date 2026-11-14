import React, { useState, useEffect } from 'react';
import {
  AudioWaveform,
  Check,
  X,
  Cpu,
  Link,
  Sliders,
  Info,
} from 'lucide-react';
import { MasterVoiceprint } from '../types';
import {
  getMasterVoiceprint,
  saveMasterVoiceprint,
  DEFAULT_SAMPLE_TRANSCRIPT,
} from '../services/voiceprintStorage';

const TTS_MODEL_PRESETS: Array<{ value: string; label: string }> = [
  { value: 'gemini-3.8-flash-tts', label: 'gemini-3.8-flash-tts (Gemini 3.8 Flash 拟真语音)' },
  { value: 'gemini-3.8-flash-lite-tts', label: 'gemini-3.8-flash-lite-tts (Gemini 3.8 Lite 极速)' },
  { value: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts (OpenAI 情感语音)' },
  { value: 'tts-1', label: 'tts-1 (OpenAI 标准语音)' },
  { value: 'tts-1-hd', label: 'tts-1-hd (OpenAI 高清语音)' },
];

const BASE_PRESET_VOICES: Array<{
  id: 'Kore' | 'Zephyr' | 'Fenrir' | 'Puck' | 'Charon';
  label: string;
  tag: string;
  openaiHint: string;
  desc: string;
}> = [
  { id: 'Kore', label: '甜美女', tag: 'F1', openaiHint: 'nova', desc: '女声 · 甜美温润' },
  { id: 'Zephyr', label: '知性女', tag: 'F2', openaiHint: 'shimmer', desc: '女声 · 知性从容' },
  { id: 'Fenrir', label: '磁性男', tag: 'M1', openaiHint: 'onyx', desc: '男声 · 磁性沉稳' },
  { id: 'Puck', label: '阳光男', tag: 'M2', openaiHint: 'echo', desc: '男声 · 阳光开朗' },
  { id: 'Charon', label: '商务男', tag: 'M3', openaiHint: 'fable', desc: '男声 · 商务精英' },
];

interface MasterVoiceprintModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVoiceprintSaved?: (vp: MasterVoiceprint) => void;
  embedded?: boolean;
}

export const MasterVoiceprintModal: React.FC<MasterVoiceprintModalProps> = ({
  isOpen,
  onClose,
  onVoiceprintSaved,
  embedded = false,
}) => {
  const [voiceprint, setVoiceprint] = useState<MasterVoiceprint | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const [name, setName] = useState('个人预设音色档');
  const [enabledAsDefault, setEnabledAsDefault] = useState(true);
  const [pitch, setPitch] = useState(1.0);
  const [rate, setRate] = useState(1.0);
  const [baseVoice, setBaseVoice] = useState<'Kore' | 'Zephyr' | 'Fenrir' | 'Puck' | 'Charon'>('Kore');
  const [ttsModel, setTtsModel] = useState<string>('gemini-3.8-flash-tts');

  useEffect(() => {
    if (isOpen) {
      const current = getMasterVoiceprint();
      if (current) {
        setVoiceprint(current);
        setName(current.name || '个人预设音色档');
        setEnabledAsDefault(current.enabledAsDefault);
        setPitch(typeof current.pitch === 'number' && Number.isFinite(current.pitch) ? current.pitch : 1.0);
        setRate(typeof current.rate === 'number' && Number.isFinite(current.rate) ? current.rate : 1.0);
        setBaseVoice(current.baseVoice || (current.pitch && current.pitch < 0.95 ? 'Fenrir' : 'Kore'));
        setTtsModel(current.ttsModel || 'gemini-3.8-flash-tts');
      }
      setStatusText(null);
    }
  }, [isOpen]);

  if (!isOpen && !embedded) return null;

  const selectedPresetMeta =
    BASE_PRESET_VOICES.find((v) => v.id === baseVoice) || BASE_PRESET_VOICES[0];

  const handleSave = () => {
    const resolvedTtsModel = ttsModel.trim() || 'gemini-3.8-flash-tts';
    const updated: MasterVoiceprint = {
      id: voiceprint?.id || 'master_' + Date.now(),
      name: name.trim() || '个人预设音色档',
      sampleAudioUrl: '',
      duration: 0,
      recordedAt: Date.now(),
      enabledAsDefault,
      pitch,
      rate,
      warmth: 100,
      timbreTag: '预设音色 · 服务端 ffmpeg 真实调速调音高',
      sampleTranscript: DEFAULT_SAMPLE_TRANSCRIPT,
      baseVoice,
      gender: baseVoice === 'Fenrir' || baseVoice === 'Puck' || baseVoice === 'Charon' ? 'male' : 'female',
      ttsModel: resolvedTtsModel,
    };

    const saveRes = saveMasterVoiceprint(updated);
    if (!saveRes.success) {
      setStatusText(saveRes.error || '保存失败，存储不可用');
      return;
    }
    setVoiceprint(updated);
    onVoiceprintSaved?.(updated);
    if (embedded) {
      setStatusText(`预设音色配置与模型 (${resolvedTtsModel}) 已保存`);
      setTimeout(() => setStatusText(null), 3000);
    } else {
      onClose();
    }
  };

  const isPresetTtsModel = TTS_MODEL_PRESETS.some((m) => m.value === ttsModel);

  const innerContent = (
    <>
      {/* Header (Standalone Modal Mode Only) */}
      {!embedded && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e2e8f0] dark:border-[#18273a] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2ba0ff]/12 border border-[#2ba0ff]/25 text-[#0284c7] dark:text-[#2ba0ff] flex items-center justify-center">
              <AudioWaveform className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] tracking-wide">
                预设音色与语音合成配置
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Body Content */}
      <div className={`${embedded ? 'p-4 space-y-3.5 flex-1' : 'p-5 space-y-4 max-h-[72vh]'} overflow-y-auto`}>
        {/* Status Alert */}
        {statusText && (
          <div className="p-2.5 rounded-lg bg-[#2ba0ff]/10 border border-[#2ba0ff]/25 text-xs text-[#0284c7] dark:text-[#7cc4ff] flex items-center gap-2">
            <AudioWaveform className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{statusText}</span>
          </div>
        )}

        {/* Honest Capability Notice */}
        <div className="p-3 rounded-xl bg-sky-500/8 border border-sky-500/25 text-[11px] text-[#334155] dark:text-[#9ec2e6] flex items-start gap-2 leading-relaxed">
          <Info className="w-4 h-4 text-[#0284c7] dark:text-[#2ba0ff] shrink-0 mt-0.5" />
          <span>
            当前使用官方/自有网关的<strong>预设音色库</strong>进行语音合成（不支持真人声音采样复刻）。下方设置的<strong>音高基线</strong>与<strong>语速倍率</strong>会在服务端通过本地 ffmpeg 真实处理导出音频，试听与发往 Telegram 的语音条保持完全一致。
          </span>
        </div>

        {/* Preset Summary Card */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#18273a] space-y-3">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] focus:outline-none border-b border-transparent focus:border-[#2ba0ff] w-full"
              placeholder="输入预设音色档名称"
            />
            <div className="text-[11px] text-[#64748b] dark:text-[#7f95ab] flex items-center gap-1.5 mt-0.5 truncate">
              <span>预设音色 {baseVoice} (OpenAI 映射 {selectedPresetMeta.openaiHint})</span>
              <span>·</span>
              <span className="font-mono text-[#0284c7] dark:text-[#7cc4ff]">{ttsModel.trim() || 'gemini-3.8-flash-tts'}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-[#e2e8f0] dark:border-[#152234] text-[11px]">
            <div className="text-center">
              <div className="text-[#64748b] dark:text-[#7f95ab] text-[10px]">基础预设音色</div>
              <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] mt-0.5 truncate">
                {baseVoice}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[#64748b] dark:text-[#7f95ab] text-[10px]">语速 / 音高</div>
              <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] mt-0.5 tabular-nums">
                {rate.toFixed(2)}x / {pitch.toFixed(2)}x
              </div>
            </div>
            <div className="text-center">
              <div className="text-[#64748b] dark:text-[#7f95ab] text-[10px]">应用状态</div>
              <div className="font-medium text-[#0284c7] dark:text-[#2ba0ff] mt-0.5">
                {voiceprint ? (enabledAsDefault ? '默认配置' : '已保存') : '待保存'}
              </div>
            </div>
          </div>
        </div>

        {/* TTS Model Selector */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#18273a] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#2ba0ff]" />
              语音合成模型型号
            </span>
            <span className="text-[10px] text-[#64748b] dark:text-[#7f95ab]">支持自由输入</span>
          </div>

          <select
            value={isPresetTtsModel ? ttsModel : '__custom__'}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                setTtsModel(e.target.value);
              } else {
                setTtsModel('');
              }
            }}
            className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] focus:outline-none focus:border-[#2ba0ff]"
          >
            {TTS_MODEL_PRESETS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
            <option value="__custom__">自定义输入其他语音模型型号...</option>
          </select>

          <input
            type="text"
            value={ttsModel}
            onChange={(e) => setTtsModel(e.target.value)}
            placeholder="输入模型型号，例如：gemini-3.8-flash-tts / gpt-4o-mini-tts / tts-1"
            className="w-full bg-white dark:bg-[#090f19] border border-[#cbd5e1] dark:border-[#1e3148] rounded-lg px-3 py-1.5 text-xs font-mono text-[#0284c7] dark:text-[#9ec2e6] placeholder-[#94a3b8] dark:placeholder-[#4e657e] focus:outline-none focus:border-[#2ba0ff]"
          />

          <p className="text-[10.5px] text-[#64748b] dark:text-[#7f95ab] flex items-center gap-1.5 leading-snug">
            <Link className="w-3 h-3 text-[#2ba0ff] shrink-0" />
            <span>接入口与密钥统一走「模型 → 接入自有模型网关」配置的大模型接入网址与密钥，或使用官方云端引擎。</span>
          </p>
        </div>

        {/* Preset Voice & ffmpeg Audio Parameters */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#18273a] space-y-3 text-xs">
          <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-[#2ba0ff]" />
            <span>预设音色与音频参数（ffmpeg 实效处理）</span>
          </span>

          {/* Base Voice Anchor */}
          <div className="space-y-1.5 pt-0.5">
            <div className="flex justify-between text-[11px] text-[#64748b] dark:text-[#7f95ab]">
              <span>系统预设音色库 (Gemini / OpenAI 自动映射)</span>
              <span className="text-[#0284c7] dark:text-[#2ba0ff] font-medium">
                {selectedPresetMeta.desc}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {BASE_PRESET_VOICES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setBaseVoice(v.id)}
                  className={`py-1.5 px-1 rounded-lg text-center border transition-all cursor-pointer ${
                    baseVoice === v.id
                      ? 'bg-[#2ba0ff] border-[#2ba0ff] text-white shadow-xs'
                      : 'bg-white dark:bg-[#090f19] border-[#cbd5e1] dark:border-[#1e3148] text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white'
                  }`}
                >
                  <div className={`text-[10px] font-mono font-semibold ${baseVoice === v.id ? 'text-white/90' : 'text-[#2ba0ff]'}`}>
                    {v.tag}
                  </div>
                  <div className="text-[10px] mt-0.5 truncate">{v.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Pitch */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#64748b] dark:text-[#7f95ab]">
              <span>音高基线 (ffmpeg 实效变调)</span>
              <span className="text-[#0f172a] dark:text-[#eef4fb] font-medium tabular-nums">{pitch.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.2"
              step="0.05"
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-full h-1 bg-[#cbd5e1] dark:bg-[#1e3148] rounded-lg appearance-none cursor-pointer accent-[#2ba0ff]"
            />
          </div>

          {/* Rate */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#64748b] dark:text-[#7f95ab]">
              <span>语速节奏 (ffmpeg 实效变速)</span>
              <span className="text-[#0f172a] dark:text-[#eef4fb] font-medium tabular-nums">{rate.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.2"
              step="0.05"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-full h-1 bg-[#cbd5e1] dark:bg-[#1e3148] rounded-lg appearance-none cursor-pointer accent-[#2ba0ff]"
            />
          </div>
        </div>

        {/* Global Default Toggle */}
        <div className="p-3 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#18273a] flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">
            设为默认语音合成预设
          </div>
          <button
            type="button"
            onClick={() => setEnabledAsDefault(!enabledAsDefault)}
            className={`w-10 h-5.5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
              enabledAsDefault ? 'bg-[#2ba0ff]' : 'bg-[#cbd5e1] dark:bg-[#233247]'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-0.75 ${
                enabledAsDefault ? 'left-5.25' : 'left-0.75'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8f0] dark:border-[#18273a] bg-[#f8fafc] dark:bg-[#070d16] shrink-0">
        {!embedded ? (
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#64748b] dark:text-[#7f95ab] hover:text-[#0f172a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            取消
          </button>
        ) : (
          <span className="text-[11px] text-[#64748b] dark:text-[#7f95ab]">
            {voiceprint ? '已关联语音合成预设' : '选择预设与型号后保存'}
          </span>
        )}

        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-[#2ba0ff] hover:bg-[#1e8ee8] text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
          <span>保存预设音色配置</span>
        </button>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-full min-h-0 select-none text-[#0f172a] dark:text-[#eef4fb]">
        {innerContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150 select-none">
      <div className="relative w-full max-w-md bg-white dark:bg-[#0b121e] border border-[#e2e8f0] dark:border-[#1e3148] rounded-xl shadow-xl flex flex-col overflow-hidden text-[#0f172a] dark:text-[#eef4fb]">
        {innerContent}
      </div>
    </div>
  );
};
