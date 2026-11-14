import React, { useState, useEffect, useRef } from 'react';
import {
  AudioWaveform,
  Volume2,
  Square,
  Send,
  Sparkles,
  X,
  RefreshCw,
  Check,
  Sliders,
  Settings,
} from 'lucide-react';
import { CustomLLMConfig, MasterVoiceprint } from '../types';
import { generateTTSVoice } from '../services/apiService';
import { getMasterVoiceprint } from '../services/voiceprintStorage';
import { MasterVoiceprintModal } from './MasterVoiceprintModal';

export interface VoiceProfile {
  id: string;
  name: string;
  gender: 'female' | 'male';
  tag: string;
  desc: string;
  avatar: string;
  defaultTone: string;
  samplePhrase: string;
}

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: 'Kore',
    name: 'Kore · 治愈甜美声',
    gender: 'female',
    tag: '温和自然女声 (OpenAI: nova)',
    desc: '轻柔温和、语调亲切自然，适合日常陪伴与客户关怀',
    avatar: '🌸',
    defaultTone: 'Gentle, affectionate and soothing with natural pauses',
    samplePhrase: '今天辛苦啦，有没有好好吃饭？',
  },
  {
    id: 'Zephyr',
    name: 'Zephyr · 知性成熟女声',
    gender: 'female',
    tag: '稳重从容女声 (OpenAI: shimmer)',
    desc: '嗓音温润醇厚、从容大方，适合深度倾听与默契对话',
    avatar: '👑',
    defaultTone: 'Warm, mature, steady and reassuring',
    samplePhrase: '放轻松，有什么需要随时告诉我。',
  },
  {
    id: 'Puck',
    name: 'Puck · 阳光活力青年',
    gender: 'male',
    tag: '生活化开朗语调 (OpenAI: echo)',
    desc: '富有朝气、语调自然轻松，适合日常分享与愉快互动',
    avatar: '☀️',
    defaultTone: 'Cheerful, lively, energetic and friendly',
    samplePhrase: '哈喽！刚才看到一个有意思的消息想分享给你。',
  },
  {
    id: 'Fenrir',
    name: 'Fenrir · 磁性沉稳男低音',
    gender: 'male',
    tag: '沉稳低音男声 (OpenAI: onyx)',
    desc: '音色低沉有厚度、沉稳可靠，极具辨识度',
    avatar: '⚡',
    defaultTone: 'Deep, resonant, calm and steady',
    samplePhrase: '别担心，一切交给我来处理。',
  },
  {
    id: 'Charon',
    name: 'Charon · 商务干练精英',
    gender: 'male',
    tag: '专业严谨男声 (OpenAI: fable)',
    desc: '发音饱满标准、节奏清晰从容，适合正式咨询与商务沟通',
    avatar: '💼',
    defaultTone: 'Crisp, articulate, professional and authoritative',
    samplePhrase: '您好，相关业务与资料已为您核对完毕，请查阅。',
  },
];

export const EMOTION_PRESETS = [
  { label: '💫 自然日常', tone: 'Natural, friendly and conversational', emotion: '日常' },
  { label: '💖 亲切温和', tone: 'Sweet, affectionate and gentle', emotion: '温和' },
  { label: '🍵 贴心关怀', tone: 'Caring, soft-spoken and reassuring', emotion: '关怀' },
  { label: '🎉 开朗欢快', tone: 'Playful, upbeat and cheerful', emotion: '欢快' },
  { label: '👔 严谨商务', tone: 'Professional, articulate and confident', emotion: '商务' },
];

function decodeAudioDurationSeconds(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = new Audio();
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('音频元数据解码超时'));
    }, 6000);
    const cleanup = () => {
      clearTimeout(timer);
      probe.onloadedmetadata = null;
      probe.onerror = null;
    };
    probe.onloadedmetadata = () => {
      const dur = probe.duration;
      cleanup();
      if (Number.isFinite(dur) && dur > 0) {
        resolve(Math.max(1, Math.round(dur)));
      } else {
        reject(new Error('无法读取有效音频时长'));
      }
    };
    probe.onerror = () => {
      cleanup();
      reject(new Error('音频文件解码失败'));
    };
    probe.src = src;
  });
}

interface VoiceCloneStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialText: string;
  translatedText?: string;
  targetLangName?: string;
  customConfig?: CustomLLMConfig;
  onSendVoice: (voiceData: {
    text: string;
    audioUrl?: string;
    audioDuration: number;
    voiceName: string;
    voiceTone: string;
    isMasterVoice?: boolean;
  }) => void;
}

export const VoiceCloneStudioModal: React.FC<VoiceCloneStudioModalProps> = ({
  isOpen,
  onClose,
  initialText,
  translatedText,
  targetLangName,
  customConfig,
  onSendVoice,
}) => {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<string>('master_voice');
  const [selectedEmotionIdx, setSelectedEmotionIdx] = useState<number>(0);
  const [speedRate, setSpeedRate] = useState<number>(1.0);
  const [pitchRate, setPitchRate] = useState<number>(1.0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [realAudioDuration, setRealAudioDuration] = useState<number | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [ttsEngine, setTtsEngine] = useState<string>('gemini-3.8-flash-tts');

  const [masterVoiceprint, setMasterVoiceprint] = useState<MasterVoiceprint | null>(null);
  const [isMasterModalOpen, setIsMasterModalOpen] = useState(false);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const isCustomPriority = Boolean(
    customConfig &&
      customConfig.enabled !== false &&
      !customConfig.explicitlyDisabled &&
      customConfig.engineMode === 'custom'
  );
  const isCustomGeminiGateway = Boolean(
    isCustomPriority &&
      (customConfig?.protocol === 'gemini' ||
        (customConfig?.baseUrl || '').toLowerCase().includes('googleapis.com'))
  );
  const isCustomOpenAiGateway = Boolean(isCustomPriority && !isCustomGeminiGateway);

  const invalidateSynthesizedAudio = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }
    setIsPlayingPreview(false);
    setAudioUrl(null);
    setRealAudioDuration(null);
  };

  useEffect(() => {
    if (isOpen) {
      setText(initialText.trim() || '你好呀，今天过得怎么样？');
      setAudioUrl(null);
      setRealAudioDuration(null);
      setIsPlayingPreview(false);
      setIsSending(false);
      setStatusNotice(null);

      const mv = getMasterVoiceprint();
      setMasterVoiceprint(mv);
      const savedTts = mv?.ttsModel?.trim() || '';
      if (isCustomOpenAiGateway) {
        setTtsEngine(savedTts && !/^gemini-/i.test(savedTts) ? savedTts : 'tts-1');
      } else {
        setTtsEngine(savedTts || 'gemini-3.8-flash-tts');
      }
      if (mv?.baseVoice) {
        setSelectedVoice('master_voice');
        setSpeedRate(typeof mv.rate === 'number' && Number.isFinite(mv.rate) ? mv.rate : 1.0);
        setPitchRate(typeof mv.pitch === 'number' && Number.isFinite(mv.pitch) ? mv.pitch : 1.0);
      } else {
        setSelectedVoice(VOICE_PROFILES[0].id);
        setSpeedRate(1.0);
        setPitchRate(1.0);
      }
    }
  }, [isOpen, initialText, isCustomOpenAiGateway]);

  useEffect(() => {
    if (!isOpen) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isMasterSelected = selectedVoice === 'master_voice';
  const hasMasterVoice = Boolean(masterVoiceprint && masterVoiceprint.baseVoice);
  const activeProfile = isMasterSelected
    ? {
        id: 'master_voice',
        name: masterVoiceprint?.name || '个人预设音色档',
        gender: (masterVoiceprint?.gender || 'female') as 'female' | 'male',
        tag: `基于预设 ${masterVoiceprint?.baseVoice || 'Kore'}`,
        desc: `使用已保存的个人预设音色（基础音色 ${masterVoiceprint?.baseVoice || 'Kore'}）`,
        avatar: '🎙️',
        defaultTone: 'Natural voice with selected emotion style',
      }
    : VOICE_PROFILES.find((v) => v.id === selectedVoice) || VOICE_PROFILES[0];

  const activeEmotion = EMOTION_PRESETS[selectedEmotionIdx] || EMOTION_PRESETS[0];
  const supportsEmotionInstructions = !isCustomOpenAiGateway || /gpt-4o-mini-tts/i.test(ttsEngine);

  const handlePreviewVoice = async () => {
    if (!text.trim()) return;

    if (isMasterSelected && !hasMasterVoice) {
      setStatusNotice('尚未保存个人预设音色档，请先选择下方官方预设音色，或点击「配置预设音色与参数」。');
      return;
    }

    if (isPlayingPreview) {
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      setIsPlayingPreview(false);
      return;
    }

    setIsGenerating(true);
    setRealAudioDuration(null);
    setStatusNotice(
      isCustomPriority
        ? `正在通过自有模型网关 (${ttsEngine}) 合成并处理音频...`
        : `正在通过云端/官方引擎 (${ttsEngine}) 合成并处理音频...`
    );

    try {
      const voiceParam = isMasterSelected ? (masterVoiceprint?.baseVoice || 'Kore') : selectedVoice;
      const toneParam = activeEmotion.tone;

      const res = await generateTTSVoice(
        text.trim(),
        voiceParam,
        toneParam,
        customConfig,
        'high',
        activeEmotion.emotion,
        ttsEngine,
        {
          speechRate: speedRate,
          pitch: pitchRate,
        }
      );

      if (res.audioUrl) {
        setAudioUrl(res.audioUrl);
        if (!audioPlayerRef.current) {
          audioPlayerRef.current = new Audio();
        }
        const player = audioPlayerRef.current;
        player.src = res.audioUrl;
        player.onloadedmetadata = () => {
          if (Number.isFinite(player.duration) && player.duration > 0) {
            setRealAudioDuration(Math.max(1, Math.round(player.duration)));
          }
        };
        player.onended = () => setIsPlayingPreview(false);
        player.onerror = () => {
          setIsPlayingPreview(false);
          setStatusNotice('音频解码或播放失败，请检查网络或重新合成');
        };
        await player.play();
        if (Number.isFinite(player.duration) && player.duration > 0) {
          setRealAudioDuration(Math.max(1, Math.round(player.duration)));
        }
        setIsPlayingPreview(true);
        setStatusNotice(
          `正在播放真实合成语音 (${voiceParam} · ${res.modelUsed || ttsEngine} · 语速 ${speedRate.toFixed(2)}x · 音高 ${pitchRate.toFixed(2)}x)`
        );
      } else {
        setAudioUrl(null);
        setRealAudioDuration(null);
        setIsPlayingPreview(false);
        setStatusNotice(`语音合成失败：${res.error || '请检查模型密钥或配额'}`);
      }
    } catch (err: any) {
      console.error('Voice preview error:', err);
      setAudioUrl(null);
      setRealAudioDuration(null);
      setIsPlayingPreview(false);
      setStatusNotice(`语音合成失败：${err?.message || '语音合成请求失败'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendVoiceMessage = async () => {
    if (!text.trim() || isSending) return;
    if (!audioUrl) {
      setStatusNotice('请先点击左下角「试听语音效果」，确认真实音频合成成功后再发送。');
      return;
    }

    if (isPlayingPreview) {
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      setIsPlayingPreview(false);
    }

    setIsSending(true);
    try {
      let resolvedDuration =
        realAudioDuration && realAudioDuration > 0
          ? realAudioDuration
          : audioPlayerRef.current &&
              Number.isFinite(audioPlayerRef.current.duration) &&
              audioPlayerRef.current.duration > 0
            ? Math.max(1, Math.round(audioPlayerRef.current.duration))
            : null;

      if (!resolvedDuration) {
        resolvedDuration = await decodeAudioDurationSeconds(audioUrl);
        setRealAudioDuration(resolvedDuration);
      }

      onSendVoice({
        text: text.trim(),
        audioUrl,
        audioDuration: resolvedDuration,
        voiceName: isMasterSelected
          ? `${masterVoiceprint?.name || '个人预设'} (${masterVoiceprint?.baseVoice || 'Kore'})`
          : activeProfile.name.split('·')[0].trim(),
        voiceTone: activeEmotion.label,
        isMasterVoice: isMasterSelected,
      });

      onClose();
    } catch (err: any) {
      setStatusNotice(`发送中止：${err?.message || '无法读取合成音频真实时长，请重新试听合成'}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 select-none">
        <div className="relative w-full max-w-lg bg-[#0e1621] border border-[#1e2c3c] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#f5f7fa]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#17212b] bg-[#121c27]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#2481cc]/20 border border-[#2481cc]/40 flex items-center justify-center text-[#2ba0ff]">
                <AudioWaveform className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-wide">AI 预设音色语音合成台</h2>
                <p className="text-[11px] text-[#7f93a5] mt-0.5">
                  官方预设音色库 · 服务端 ffmpeg 真实变速变调（非真人声纹克隆）
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#7f93a5] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
            {statusNotice && (
              <div
                className={`p-2.5 rounded-xl border text-xs leading-relaxed ${
                  /失败|未配置|不足|尚未|请先|中止|错误/.test(statusNotice)
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    : 'bg-[#2481cc]/15 border-[#2481cc]/30 text-[#7cc4ff]'
                }`}
              >
                {statusNotice}
              </div>
            )}

            {/* 1. Text Input to synthesize */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#7f93a5]">
                  语音朗读文本 (支持中文及翻译外语)
                </label>
                <span className="text-[11px] text-[#7f93a5] tabular-nums">
                  {audioUrl && realAudioDuration
                    ? `${text.length} 字 · 实测 ${realAudioDuration} 秒`
                    : `${text.length} 字 · 待合成后读取实测时长`}
                </span>
              </div>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  invalidateSynthesizedAudio();
                }}
                rows={3}
                placeholder="请输入要合成语音的消息内容..."
                className="w-full bg-[#152230] border border-[#1e2f42] focus:border-[#2ba0ff] focus:outline-none rounded-xl p-3 text-xs text-white placeholder-[#7f93a5] leading-relaxed resize-none transition-colors"
              />

              {/* Quick Switch to Translated Text */}
              {translatedText && translatedText !== text && (
                <div className="mt-1.5 flex items-center justify-between p-2 rounded-lg bg-[#14202d] border border-[#1e2f42] text-xs">
                  <span className="text-[#9bb3c9] truncate max-w-[70%]">
                    译文 ({targetLangName || '目标语言'}): <strong className="text-white">{translatedText}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setText(translatedText);
                      invalidateSynthesizedAudio();
                    }}
                    className="px-2 py-0.5 rounded bg-[#2481cc]/20 hover:bg-[#2481cc]/30 text-[#2ba0ff] text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    填入译文合成 →
                  </button>
                </div>
              )}
            </div>

            {/* TTS Engine Switcher */}
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#14202d] border border-[#1e2f42]">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-white block">
                    {isCustomOpenAiGateway ? '自有网关语音合成模型 (OpenAI 协议)' : '语音合成模型'}
                  </span>
                  <span className="text-[10px] font-mono text-[#7cc4ff] truncate block">{ttsEngine}</span>
                </div>
              </div>
              {isCustomOpenAiGateway ? (
                <div className="flex items-center gap-1 shrink-0">
                  {[
                    { id: 'tts-1', label: 'tts-1' },
                    { id: 'gpt-4o-mini-tts', label: '4o-mini-tts' },
                    { id: 'tts-1-hd', label: 'tts-1-hd' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setTtsEngine(opt.id);
                        invalidateSynthesizedAudio();
                      }}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                        ttsEngine === opt.id
                          ? 'bg-[#2481cc] text-white shadow-xs'
                          : 'bg-[#152230] text-[#7f93a5] hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setTtsEngine('gemini-3.8-flash-tts');
                      invalidateSynthesizedAudio();
                    }}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      ttsEngine === 'gemini-3.8-flash-tts'
                        ? 'bg-[#2481cc] text-white shadow-xs'
                        : 'bg-[#152230] text-[#7f93a5] hover:text-white'
                    }`}
                  >
                    3.8 Flash
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTtsEngine('gemini-3.8-flash-lite-tts');
                      invalidateSynthesizedAudio();
                    }}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      ttsEngine === 'gemini-3.8-flash-lite-tts'
                        ? 'bg-[#2481cc] text-white shadow-xs'
                        : 'bg-[#152230] text-[#7f93a5] hover:text-white'
                    }`}
                  >
                    3.8 Lite
                  </button>
                </div>
              )}
            </div>

            {/* 2. SAVED PRESET & OFFICIAL VOICE PROFILES */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <AudioWaveform className="w-3.5 h-3.5 text-[#2ba0ff]" />
                  选择预设合成音色
                </label>
                <button
                  type="button"
                  onClick={() => setIsMasterModalOpen(true)}
                  className="text-[11px] text-[#2ba0ff] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Settings className="w-3 h-3" />
                  <span>配置预设音色与参数</span>
                </button>
              </div>

              {hasMasterVoice && (
                <div
                  onClick={() => {
                    setSelectedVoice('master_voice');
                    if (masterVoiceprint) {
                      setSpeedRate(typeof masterVoiceprint.rate === 'number' ? masterVoiceprint.rate : 1.0);
                      setPitchRate(typeof masterVoiceprint.pitch === 'number' ? masterVoiceprint.pitch : 1.0);
                    }
                    invalidateSynthesizedAudio();
                  }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isMasterSelected
                      ? 'bg-[#2481cc]/15 border-[#2481cc] ring-1 ring-[#2481cc]'
                      : 'bg-[#152230] border-[#1e2f42] hover:border-[#2481cc]/40'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[#2481cc]/20 text-[#2ba0ff] flex items-center justify-center shrink-0">
                      <AudioWaveform className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {masterVoiceprint?.name || '个人预设音色档'}
                      </div>
                      <p className="text-[11px] text-[#7f93a5] mt-0.5 truncate tabular-nums">
                        {masterVoiceprint?.baseVoice || 'Kore'} · 语速 {(masterVoiceprint?.rate || 1.0).toFixed(2)}x · 音高 {(masterVoiceprint?.pitch || 1.0).toFixed(2)}x
                      </p>
                    </div>
                  </div>
                  {isMasterSelected && (
                    <div className="w-5 h-5 rounded-full bg-[#2481cc] flex items-center justify-center text-white shrink-0">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {VOICE_PROFILES.map((profile) => {
                  const isSel = selectedVoice === profile.id;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => {
                        setSelectedVoice(profile.id);
                        invalidateSynthesizedAudio();
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                        isSel
                          ? 'bg-[#2481cc]/15 border-[#2481cc] ring-1 ring-[#2481cc]'
                          : 'bg-[#152230] border-[#1e2f42] hover:border-[#2481cc]/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-base shrink-0">{profile.avatar}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{profile.name}</div>
                          <div className="text-[10.5px] text-[#7f93a5] truncate">{profile.tag}</div>
                        </div>
                      </div>
                      {isSel && (
                        <div className="w-4 h-4 rounded-full bg-[#2481cc] flex items-center justify-center text-white shrink-0">
                          <Check className="w-2.5 h-2.5" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Tone Style & Emotion Presets */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="text-xs font-semibold text-[#7f93a5]">
                  情绪与语气风格 (Emotion & Tone)
                </label>
                {!supportsEmotionInstructions && (
                  <span className="text-[10.5px] text-amber-400">
                    当前模型 ({ttsEngine}) 不支持语气指令，仅 gpt-4o-mini-tts / Gemini 生效
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {EMOTION_PRESETS.map((em, idx) => {
                  const isSelected = selectedEmotionIdx === idx;
                  return (
                    <button
                      key={em.label}
                      type="button"
                      disabled={!supportsEmotionInstructions}
                      onClick={() => {
                        setSelectedEmotionIdx(idx);
                        invalidateSynthesizedAudio();
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                        !supportsEmotionInstructions
                          ? 'opacity-45 cursor-not-allowed bg-[#152230] border-[#1e2f42] text-[#7f93a5]'
                          : isSelected
                          ? 'bg-[#2481cc] text-white border-[#2481cc] shadow-sm cursor-pointer'
                          : 'bg-[#152230] border-[#1e2f42] text-[#7f93a5] hover:text-white hover:border-[#2ba0ff]/40 cursor-pointer'
                      }`}
                    >
                      {em.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Server-side ffmpeg Speed & Pitch Controls */}
            <div className="space-y-3 pt-1 text-xs p-3 rounded-xl bg-[#14202d] border border-[#1e2f42]">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[#9bb3c9] font-medium flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-[#2ba0ff]" /> 语速节奏：
                    <span className="text-white font-mono tabular-nums">{speedRate.toFixed(2)}x</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    {[0.8, 1.0, 1.2].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => {
                          setSpeedRate(rate);
                          invalidateSynthesizedAudio();
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          Math.abs(speedRate - rate) < 0.015
                            ? 'bg-[#2481cc] text-white'
                            : 'bg-[#152230] text-[#7f93a5] hover:text-white'
                        }`}
                      >
                        {rate === 0.8 ? '0.8x 慢速' : rate === 1.0 ? '1.0x 标准' : '1.2x 轻快'}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  value={speedRate}
                  onChange={(e) => {
                    setSpeedRate(parseFloat(e.target.value));
                    invalidateSynthesizedAudio();
                  }}
                  className="w-full h-1 bg-[#1e2f42] rounded-lg appearance-none cursor-pointer accent-[#2ba0ff]"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[#9bb3c9] font-medium flex items-center gap-1.5">
                    <AudioWaveform className="w-3.5 h-3.5 text-[#2ba0ff]" /> 音高基线：
                    <span className="text-white font-mono tabular-nums">{pitchRate.toFixed(2)}x</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    {[0.9, 1.0, 1.15].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setPitchRate(p);
                          invalidateSynthesizedAudio();
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          Math.abs(pitchRate - p) < 0.015
                            ? 'bg-[#2481cc] text-white'
                            : 'bg-[#152230] text-[#7f93a5] hover:text-white'
                        }`}
                      >
                        {p === 0.9 ? '0.9x 低沉' : p === 1.0 ? '1.0x 原声调' : '1.15x 清亮'}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  value={pitchRate}
                  onChange={(e) => {
                    setPitchRate(parseFloat(e.target.value));
                    invalidateSynthesizedAudio();
                  }}
                  className="w-full h-1 bg-[#1e2f42] rounded-lg appearance-none cursor-pointer accent-[#2ba0ff]"
                />
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[#17212b] bg-[#121c27]">
            {/* Audition Button */}
            <button
              type="button"
              onClick={handlePreviewVoice}
              disabled={isGenerating || isSending || !text.trim()}
              className={`px-4 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 border transition-all cursor-pointer ${
                isPlayingPreview
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse'
                  : 'bg-[#152230] hover:bg-[#1a2938] border-[#1e2f42] text-white'
              }`}
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-[#2ba0ff]" />
                  <span>合成中...</span>
                </>
              ) : isPlayingPreview ? (
                <>
                  <Square className="w-4 h-4 fill-current" />
                  <span>停止播放</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4" />
                  <span>试听语音效果</span>
                </>
              )}
            </button>

            {/* Send as Telegram Voice Memo */}
            <button
              type="button"
              onClick={() => void handleSendVoiceMessage()}
              disabled={isGenerating || isSending || !text.trim() || !audioUrl}
              className="px-6 py-2.5 rounded-xl bg-[#2481cc] hover:bg-[#2074b8] text-white font-medium text-xs flex items-center gap-2 shadow-md hover:scale-102 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              <span className="tabular-nums">
                {audioUrl && realAudioDuration
                  ? `发送为电报语音条 (${realAudioDuration}")`
                  : '发送为电报语音条'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Nested Preset Voice Settings Modal */}
      <MasterVoiceprintModal
        isOpen={isMasterModalOpen}
        onClose={() => setIsMasterModalOpen(false)}
        onVoiceprintSaved={(newVp) => {
          setMasterVoiceprint(newVp);
          setSelectedVoice('master_voice');
          if (newVp.ttsModel) {
            const nextTts = newVp.ttsModel.trim();
            setTtsEngine(isCustomOpenAiGateway && /^gemini-/i.test(nextTts) ? 'tts-1' : nextTts);
          }
          setSpeedRate(typeof newVp.rate === 'number' ? newVp.rate : 1.0);
          setPitchRate(typeof newVp.pitch === 'number' ? newVp.pitch : 1.0);
          invalidateSynthesizedAudio();
        }}
      />
    </>
  );
};
