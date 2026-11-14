import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Square,
  Play,
  Pause,
  Upload,
  AudioWaveform,
  Check,
  X,
  FileAudio,
  Cpu,
  Link,
} from 'lucide-react';
import { MasterVoiceprint } from '../types';
import {
  getMasterVoiceprint,
  saveMasterVoiceprint,
  DEFAULT_SAMPLE_TRANSCRIPT,
} from '../services/voiceprintStorage';

const VOICE_CLONE_MODEL_PRESETS: Array<{ value: string; label: string }> = [
  { value: 'gemini-3.8-flash-tts', label: 'gemini-3.8-flash-tts (Gemini 3.8 Flash 拟真语音)' },
  { value: 'gemini-3.8-flash-lite-tts', label: 'gemini-3.8-flash-lite-tts (Gemini 3.8 Lite 极速)' },
  { value: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts (OpenAI 情感语音)' },
  { value: 'tts-1', label: 'tts-1 (OpenAI 标准语音)' },
  { value: 'tts-1-hd', label: 'tts-1-hd (OpenAI 高清语音)' },
];

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

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
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [sampleAudioUrl, setSampleAudioUrl] = useState<string | null>(null);
  const [audioSourceLabel, setAudioSourceLabel] = useState<string>('系统默认采样');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  // Editable parameters - clean defaults
  const [name, setName] = useState('我的专属原声纹');
  const [enabledAsDefault, setEnabledAsDefault] = useState(true);
  const [pitch, setPitch] = useState(1.0);
  const [rate, setRate] = useState(1.0);
  const [warmth, setWarmth] = useState(90);
  const [timbreTag, setTimbreTag] = useState('全域基准克隆源 · 自然真实质感');
  const [baseVoice, setBaseVoice] = useState<'Kore' | 'Zephyr' | 'Fenrir' | 'Puck' | 'Charon'>('Kore');
  const [ttsModel, setTtsModel] = useState<string>('gemini-3.8-flash-tts');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      const current = getMasterVoiceprint();
      if (current) {
        setVoiceprint(current);
        setName(current.name || '我的专属原声纹');
        setEnabledAsDefault(current.enabledAsDefault);
        setPitch(current.pitch || 1.0);
        setRate(current.rate || 1.0);
        setWarmth(current.warmth || 90);
        setTimbreTag(current.timbreTag || '全域基准克隆源 · 自然真实质感');
        setBaseVoice(current.baseVoice || (current.pitch && current.pitch < 0.95 ? 'Fenrir' : 'Kore'));
        setTtsModel(current.ttsModel || 'gemini-3.8-flash-tts');
        if (current.sampleAudioUrl) {
          setSampleAudioUrl(current.sampleAudioUrl);
          setAudioSourceLabel('已保存的原声条样本');
        }
      }
      setIsRecording(false);
      setRecordingSeconds(0);
      setIsPlayingPreview(false);
      setStatusText(null);
    }
  }, [isOpen]);

  // Clean up audio on unmount/close
  useEffect(() => {
    if (!isOpen) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      clearInterval(timerRef.current);
    }
  }, [isOpen]);

  if (!isOpen && !embedded) return null;

  // 1. Microphone recording
  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        let resolvedUrl = '';
        try {
          resolvedUrl = await blobToDataUrl(audioBlob);
        } catch {
          resolvedUrl = URL.createObjectURL(audioBlob);
        }
        setSampleAudioUrl(resolvedUrl);
        setAudioSourceLabel(`麦克风录制参考音频 (${(audioBlob.size / 1024).toFixed(1)} KB)`);
        stream.getTracks().forEach((track) => track.stop());

        if (resolvedUrl) {
          const tempAudio = new Audio(resolvedUrl);
          tempAudio.onloadedmetadata = () => {
            if (Number.isFinite(tempAudio.duration) && tempAudio.duration > 0) {
              setRecordingSeconds(Math.max(1, Math.round(tempAudio.duration)));
            }
          };
        }
        setStatusText('麦克风参考音频已录制完成，可试听或保存预设音色配置');
        setTimeout(() => setStatusText(null), 3000);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      let count = 0;
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        count++;
        setRecordingSeconds(count);
        if (count >= 20) {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
          clearInterval(timerRef.current);
          setIsRecording(false);
          setStatusText('已达单次录制上限 (20秒)');
          setTimeout(() => setStatusText(null), 3000);
        } else if (count === 10) {
          setStatusText('已录制 10 秒，可随时点击停止录制');
          setTimeout(() => setStatusText(null), 3000);
        }
      }, 1000);
    } catch (err: any) {
      console.warn('Microphone error', err);
      setIsRecording(false);
      setStatusText(`麦克风访问失败：${err.message || '请允许浏览器麦克风权限'}。您可点击下方直接上传本地音频文件。`);
      setTimeout(() => setStatusText(null), 5000);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    clearInterval(timerRef.current);
    setIsRecording(false);
  };

  // 2. Upload / Import Audio File (本地参考音频)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2.5 * 1024 * 1024) {
      setStatusText('音频文件过大 (超过 2.5MB)，请截取 5-20 秒参考音频以保证本地持久化');
      setTimeout(() => setStatusText(null), 4000);
      return;
    }

    setIsAnalyzing(true);
    try {
      const dataUrl = await blobToDataUrl(file);
      const tempAudio = new Audio(dataUrl);
      await new Promise<void>((resolve, reject) => {
        tempAudio.onloadedmetadata = () => {
          const dur = Number.isFinite(tempAudio.duration) && tempAudio.duration > 0
            ? Math.max(1, Math.round(tempAudio.duration))
            : 1;
          setRecordingSeconds(dur);
          resolve();
        };
        tempAudio.onerror = () => reject(new Error('无法解码该音频文件，请确认音频格式有效'));
      });
      setSampleAudioUrl(dataUrl);
      setAudioSourceLabel(`本地音频: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
      setStatusText(`参考音频「${file.name}」已验证加载，可试听或保存。`);
      setTimeout(() => setStatusText(null), 3500);
    } catch (err: any) {
      setStatusText(err?.message || '音频文件读取或解码失败，请选择有效的音频文件');
      setTimeout(() => setStatusText(null), 4000);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 3. Preview Playback
  const handleTogglePlayPreview = () => {
    if (isPlayingPreview) {
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      setIsPlayingPreview(false);
      return;
    }

    if (sampleAudioUrl) {
      if (!audioPlayerRef.current) {
        audioPlayerRef.current = new Audio();
      }
      audioPlayerRef.current.src = sampleAudioUrl;
      audioPlayerRef.current.playbackRate = rate;
      audioPlayerRef.current.onended = () => setIsPlayingPreview(false);
      audioPlayerRef.current.onerror = () => {
        setIsPlayingPreview(false);
        setStatusText('音频播放失败，请重新录制或上传有效音频文件');
      };
      audioPlayerRef.current.play().catch((err) => {
        setIsPlayingPreview(false);
        setStatusText(`音频播放失败：${err?.message || '浏览器阻止播放'}`);
      });
      setIsPlayingPreview(true);
    } else {
      setStatusText('请先使用下方麦克风录制或导入参考音频样本，再进行试听。');
      setTimeout(() => setStatusText(null), 3500);
    }
  };

  // 4. Save
  const handleSave = () => {
    const resolvedTtsModel = ttsModel.trim() || 'gemini-3.8-flash-tts';
    const updated: MasterVoiceprint = {
      id: voiceprint?.id || 'master_' + Date.now(),
      name: name.trim() || '我的专属原声纹',
      sampleAudioUrl: sampleAudioUrl || voiceprint?.sampleAudioUrl || '',
      duration: recordingSeconds || voiceprint?.duration || 0,
      recordedAt: Date.now(),
      enabledAsDefault,
      pitch,
      rate,
      warmth,
      timbreTag: timbreTag.trim() || '全域基准克隆源 · 自然真实质感',
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
      setStatusText(
        sampleAudioUrl
          ? `原声纹与音色模型 (${resolvedTtsModel}) 已保存并设为全域声纹`
          : `音色配置与克隆模型 (${resolvedTtsModel}) 已保存（后续可随时补充参考录音）`
      );
      setTimeout(() => setStatusText(null), 3000);
    } else {
      onClose();
    }
  };

  const isPresetTtsModel = VOICE_CLONE_MODEL_PRESETS.some((m) => m.value === ttsModel);

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
              <h2 className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] tracking-wide">参考录音与预设音色配置</h2>
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

        {/* Voiceprint Info Card */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#18273a] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0 pr-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-transparent text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] focus:outline-none border-b border-transparent focus:border-[#2ba0ff] w-full"
                placeholder="输入原声纹名称"
              />
              <div className="text-[11px] text-[#64748b] dark:text-[#7f95ab] flex items-center gap-1.5 mt-0.5 truncate">
                <span>{sampleAudioUrl ? audioSourceLabel : '未录制原声（可直接配置音色与模型）'}</span>
                <span>·</span>
                <span className="font-mono text-[#0284c7] dark:text-[#7cc4ff]">{ttsModel.trim() || 'gemini-3.8-flash-tts'}</span>
              </div>
            </div>

            {/* Audition Button */}
            <button
              type="button"
              onClick={handleTogglePlayPreview}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 border ${
                isPlayingPreview
                  ? 'bg-[#2ba0ff] border-[#2ba0ff] text-white shadow-xs'
                  : 'bg-white hover:bg-[#f1f5f9] dark:bg-[#132033] dark:hover:bg-[#1a2b44] text-[#334155] dark:text-[#dbe6f0] border-[#cbd5e1] dark:border-[#1e3148]'
              }`}
            >
              {isPlayingPreview ? (
                <>
                  <Pause className="w-3 h-3 fill-current" />
                  <span>停止</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>试听原声</span>
                </>
              )}
            </button>
          </div>

          {/* Real Measurable Stats */}
          <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-[#e2e8f0] dark:border-[#152234] text-[11px]">
            <div className="text-center">
              <div className="text-[#64748b] dark:text-[#7f95ab] text-[10px]">匹配预设音色</div>
              <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] mt-0.5 tabular-nums truncate">
                {sampleAudioUrl ? `${baseVoice} · ${recordingSeconds || voiceprint?.duration || 0}s` : baseVoice}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[#64748b] dark:text-[#7f95ab] text-[10px]">语速倍率</div>
              <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] mt-0.5 tabular-nums">{rate.toFixed(2)}x</div>
            </div>
            <div className="text-center">
              <div className="text-[#64748b] dark:text-[#7f95ab] text-[10px]">全局应用</div>
              <div className="font-medium text-[#0284c7] dark:text-[#2ba0ff] mt-0.5">
                {voiceprint ? (enabledAsDefault ? '默认配置' : '已保存') : '待保存'}
              </div>
            </div>
          </div>
        </div>

        {/* Voice Clone / TTS Model Selector (Routes via Tab 3 Custom Gateway) */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#18273a] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#2ba0ff]" />
              音色克隆 / 语音合成模型型号
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
            {VOICE_CLONE_MODEL_PRESETS.map((m) => (
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
            <span>接入口与密钥统一走「模型 → 接入自有模型网关」配置的大模型接入网址与密钥。</span>
          </p>
        </div>

        {/* Recording & Audio Clip Import Section */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#18273a] space-y-3">
          <div className="flex items-center justify-between text-xs text-[#64748b] dark:text-[#7f95ab]">
            <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] flex items-center gap-1.5">
              <FileAudio className="w-3.5 h-3.5 text-[#2ba0ff]" />
              录制采样或导入原声条
            </span>
            <span>
              {isRecording ? (
                <span className="text-rose-500 dark:text-rose-400 font-semibold tabular-nums">
                  录音中 {recordingSeconds}s
                </span>
              ) : (
                '支持音频条/语音文件'
              )}
            </span>
          </div>

          {/* Calibration Script */}
          <div className="p-2.5 rounded-lg bg-white dark:bg-[#090f19] border border-[#e2e8f0] dark:border-[#18273a] text-[11.5px] text-[#475569] dark:text-[#cbd5e1] leading-relaxed">
            <span className="text-[10px] text-[#64748b] dark:text-[#7f95ab] block mb-0.5">参考校准范句：</span>
            <p className="italic">“{DEFAULT_SAMPLE_TRANSCRIPT}”</p>
          </div>

          {/* Mic & File Import Action Buttons */}
          <div className="flex items-center gap-2.5 pt-0.5">
            {isRecording ? (
              <button
                type="button"
                onClick={handleStopRecording}
                className="w-full py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm tabular-nums"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>完成录制 ({recordingSeconds}s)</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleStartRecording}
                  disabled={isAnalyzing}
                  className="flex-1 py-2 px-3 rounded-lg bg-[#2ba0ff] hover:bg-[#1e8ee8] text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>{sampleAudioUrl ? '麦克风重录' : '麦克风录制'}</span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.ogg,.m4a,.webm"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAnalyzing}
                  title="选择已有语音条或音频文件导入声纹"
                  className="flex-1 py-2 px-3 rounded-lg bg-white hover:bg-[#f1f5f9] dark:bg-[#132033] dark:hover:bg-[#1a2b44] text-[#0f172a] dark:text-white border border-[#cbd5e1] dark:border-[#1e3148] font-medium text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-[#2ba0ff]" />
                  <span>导入参考音频</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Sliders */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#18273a] space-y-3 text-xs">
          <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] block">
            拟真微调 (Fine Tuning)
          </span>

          {/* Base Voice Timbre Anchor */}
          <div className="space-y-1.5 pt-0.5">
            <div className="flex justify-between text-[11px] text-[#64748b] dark:text-[#7f95ab]">
              <span>音色特征锚点 (男女音质基准)</span>
              <span className="text-[#0284c7] dark:text-[#2ba0ff] font-medium">
                {baseVoice === 'Kore' ? '女声 · 甜美温润' :
                 baseVoice === 'Zephyr' ? '女声 · 知性从容' :
                 baseVoice === 'Fenrir' ? '男声 · 磁性沉稳' :
                 baseVoice === 'Puck' ? '男声 · 阳光开朗' : '男声 · 商务精英'}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { id: 'Kore', label: '甜美女', tag: 'F1' },
                { id: 'Zephyr', label: '知性女', tag: 'F2' },
                { id: 'Fenrir', label: '磁性男', tag: 'M1' },
                { id: 'Puck', label: '阳光男', tag: 'M2' },
                { id: 'Charon', label: '商务男', tag: 'M3' },
              ].map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setBaseVoice(v.id as any)}
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
              <span>音高基线</span>
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
              <span>语速节奏</span>
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

          {/* Warmth */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#64748b] dark:text-[#7f95ab]">
              <span>呼吸拟真感</span>
              <span className="text-[#0f172a] dark:text-[#eef4fb] font-medium tabular-nums">{warmth}%</span>
            </div>
            <input
              type="range"
              min="60"
              max="100"
              step="1"
              value={warmth}
              onChange={(e) => setWarmth(parseInt(e.target.value, 10))}
              className="w-full h-1 bg-[#cbd5e1] dark:bg-[#1e3148] rounded-lg appearance-none cursor-pointer accent-[#2ba0ff]"
            />
          </div>
        </div>

        {/* Global Default Toggle */}
        <div className="p-3 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 border border-[#e2e8f0] dark:border-[#18273a] flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb]">
            设为默认音色预设
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
            {voiceprint ? '已关联音色预设' : '选择型号或录入后保存'}
          </span>
        )}

        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-[#2ba0ff] hover:bg-[#1e8ee8] text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
          <span>保存并设为全域声纹</span>
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

