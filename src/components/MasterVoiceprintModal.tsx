import React, { useState, useEffect, useRef } from 'react';
import {
  AudioWaveform,
  Check,
  X,
  Cpu,
  Link,
  Sliders,
  Info,
  Upload,
  Mic,
  Square,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react';
import { MasterVoiceprint, VoiceCloneProvider } from '../types';
import {
  getMasterVoiceprint,
  saveMasterVoiceprint,
} from '../services/voiceprintStorage';
import {
  uploadVoiceprintSample,
  fetchVoiceprintSampleBlobUrl,
  deleteVoiceprintSample,
} from '../services/apiService';

const VOICE_CLONE_PROVIDERS: Array<{
  id: VoiceCloneProvider;
  label: string;
  defaultUrl: string;
  defaultModel: string;
  hint: string;
}> = [
  {
    id: 'elevenlabs',
    label: 'ElevenLabs (Instant Voice Cloning)',
    defaultUrl: 'https://api.elevenlabs.io',
    defaultModel: 'eleven_multilingual_v2',
    hint: '自动上传样本注册 voice_id 并复刻声音，支持多语种，后续直接复用',
  },
  {
    id: 'siliconflow_cosyvoice',
    label: '硅基流动 CosyVoice (SiliconFlow)',
    defaultUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'FunAudioLLM/CosyVoice2-0.5B',
    hint: '国内低延迟方案，需填写下方「参考音频原文」以提高复刻准确度',
  },
  {
    id: 'fish_audio',
    label: 'Fish Audio (参考音频零样本克隆)',
    defaultUrl: 'https://api.fish.audio',
    defaultModel: 'tts-1',
    hint: '支持中文/外语高拟真零样本复刻，每次随参考音频或 reference_id 合成',
  },
  {
    id: 'gpt_sovits',
    label: '本地 GPT-SoVITS / 局域网服务端',
    defaultUrl: 'http://127.0.0.1:9880',
    defaultModel: 'gpt-sovits',
    hint: '连接本机或内网 GPT-SoVITS API (/tts)，本地部署密钥可留空',
  },
  {
    id: 'openai_clone_compat',
    label: '兼容 OpenAI 扩展克隆网关 (/audio/speech)',
    defaultUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: 'tts-1',
    hint: '向 /v1/audio/speech 附带 reference_audio 与 reference_text 字段',
  },
];

function resolveCloneModelForProvider(model: string | undefined, defaultModel: string): string {
  const trimmed = (model || '').trim();
  if (!trimmed || /^gemini-/i.test(trimmed)) {
    return defaultModel;
  }
  return trimmed;
}

function probeAudioDurationFromSrc(src: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const timer = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 4000);
    const cleanup = () => {
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
    };
    audio.onloadedmetadata = () => {
      const dur = audio.duration;
      cleanup();
      if (Number.isFinite(dur) && dur > 0) {
        resolve(Math.max(1, Math.round(dur)));
      } else {
        resolve(undefined);
      }
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    audio.src = src;
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
  const [statusText, setStatusText] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'info' | 'error'>('info');

  const [name, setName] = useState('克隆声纹');
  const [enabledAsDefault, setEnabledAsDefault] = useState(true);
  const [pitch, setPitch] = useState(1.0);
  const [rate, setRate] = useState(1.0);
  const [ttsModel, setTtsModel] = useState<string>(VOICE_CLONE_PROVIDERS[0].defaultModel);

  // Personal voiceprint cloning states
  const [sampleId, setSampleId] = useState<string>('');
  const [sampleFileName, setSampleFileName] = useState<string>('');
  const [sampleMimeType, setSampleMimeType] = useState<string>('');
  const [sampleDuration, setSampleDuration] = useState<number | undefined>(undefined);
  const [sampleTranscript, setSampleTranscript] = useState<string>('');
  const [pendingSampleDataUrl, setPendingSampleDataUrl] = useState<string | null>(null);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [cloneProvider, setCloneProvider] = useState<VoiceCloneProvider>('elevenlabs');
  const [cloneGatewayUrl, setCloneGatewayUrl] = useState<string>('https://api.elevenlabs.io');
  const [cloneApiKey, setCloneApiKey] = useState<string>('');
  const [showCloneApiKey, setShowCloneApiKey] = useState<boolean>(false);
  const [cloneVoiceId, setCloneVoiceId] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Microphone recording states
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const objectUrlRef = useRef<string | null>(null);

  const cleanupRecordingResources = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      mediaStreamRef.current = null;
    }
    setIsRecording(false);
  };

  const replacePreviewObjectUrl = (nextUrl: string | null, isObjectUrl: boolean) => {
    if (objectUrlRef.current) {
      try {
        URL.revokeObjectURL(objectUrlRef.current);
      } catch {}
      objectUrlRef.current = null;
    }
    if (nextUrl && isObjectUrl) {
      objectUrlRef.current = nextUrl;
    }
    setPreviewAudioUrl(nextUrl);
  };

  useEffect(() => {
    let cancelled = false;
    if (isOpen) {
      const current = getMasterVoiceprint();
      if (current) {
        setVoiceprint(current);
        setName(!current.name || current.name === '个人预设音色档' ? '克隆声纹' : current.name);
        setEnabledAsDefault(current.enabledAsDefault);
        setPitch(typeof current.pitch === 'number' && Number.isFinite(current.pitch) ? current.pitch : 1.0);
        setRate(typeof current.rate === 'number' && Number.isFinite(current.rate) ? current.rate : 1.0);
        setSampleId(current.sampleId || '');
        setSampleFileName(current.sampleFileName || '');
        setSampleMimeType(current.sampleMimeType || '');
        setSampleDuration(current.duration);
        setSampleTranscript(current.sampleTranscript || '');
        setPendingSampleDataUrl(null);
        const savedProvider = current.cloneProvider || 'elevenlabs';
        setCloneProvider(savedProvider);
        const providerMeta = VOICE_CLONE_PROVIDERS.find((p) => p.id === savedProvider) || VOICE_CLONE_PROVIDERS[0];
        setTtsModel(resolveCloneModelForProvider(current.ttsModel, providerMeta.defaultModel));
        setCloneGatewayUrl(current.cloneGatewayUrl || providerMeta.defaultUrl);
        setCloneApiKey(current.cloneApiKey || '');
        setCloneVoiceId(current.cloneVoiceId || '');

        if (current.sampleId) {
          void fetchVoiceprintSampleBlobUrl(current.sampleId).then((blobUrl) => {
            if (cancelled) {
              if (blobUrl) URL.revokeObjectURL(blobUrl);
              return;
            }
            if (blobUrl) {
              replacePreviewObjectUrl(blobUrl, true);
            } else if (current.sampleAudioUrl) {
              replacePreviewObjectUrl(current.sampleAudioUrl, false);
            } else {
              replacePreviewObjectUrl(null, false);
            }
          });
        } else if (current.sampleAudioUrl) {
          replacePreviewObjectUrl(current.sampleAudioUrl, false);
        } else {
          replacePreviewObjectUrl(null, false);
        }
      } else {
        const defaultMeta = VOICE_CLONE_PROVIDERS[0];
        setName('克隆声纹');
        setCloneProvider(defaultMeta.id);
        setCloneGatewayUrl(defaultMeta.defaultUrl);
        setTtsModel(defaultMeta.defaultModel);
        replacePreviewObjectUrl(null, false);
      }
      setStatusText(null);
      setStatusTone('info');
    } else {
      cleanupRecordingResources();
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      cleanupRecordingResources();
      if (objectUrlRef.current) {
        try {
          URL.revokeObjectURL(objectUrlRef.current);
        } catch {}
        objectUrlRef.current = null;
      }
    };
  }, []);

  if (!isOpen && !embedded) return null;

  const selectedCloneProviderMeta =
    VOICE_CLONE_PROVIDERS.find((p) => p.id === cloneProvider) || VOICE_CLONE_PROVIDERS[0];

  const handleSelectCloneProvider = (nextProvider: VoiceCloneProvider) => {
    const prevMeta = VOICE_CLONE_PROVIDERS.find((p) => p.id === cloneProvider);
    const nextMeta = VOICE_CLONE_PROVIDERS.find((p) => p.id === nextProvider) || VOICE_CLONE_PROVIDERS[0];
    setCloneProvider(nextProvider);
    if (!cloneGatewayUrl.trim() || cloneGatewayUrl.trim() === prevMeta?.defaultUrl) {
      setCloneGatewayUrl(nextMeta.defaultUrl);
    }
    const trimmedModel = ttsModel.trim();
    if (!trimmedModel || /^gemini-/i.test(trimmedModel) || trimmedModel === prevMeta?.defaultModel) {
      setTtsModel(nextMeta.defaultModel);
    }
    setCloneVoiceId('');
  };

  const handleAudioFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      setStatusTone('error');
      setStatusText('声纹样本音频体积不能超过 15MB（建议上传 5~30 秒清晰人声）');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl.startsWith('data:')) {
        setStatusTone('error');
        setStatusText('读取音频文件失败，请重新选择有效的音频文件');
        return;
      }
      const probedDuration = await probeAudioDurationFromSrc(dataUrl);
      setPendingSampleDataUrl(dataUrl);
      setSampleFileName(file.name);
      setSampleMimeType(file.type || 'audio/wav');
      setSampleDuration(probedDuration);
      setCloneVoiceId('');
      replacePreviewObjectUrl(dataUrl, false);
      if (!name.trim() || name === '个人预设音色档') {
        setName('克隆声纹');
      }
      setStatusTone('info');
      setStatusText(`已加载本地声纹样本「${file.name}」，点击底部保存即可应用到后续语音发送`);
    };
    reader.onerror = () => {
      setStatusTone('error');
      setStatusText('读取音频文件失败，请检查文件权限或格式');
    };
    reader.readAsDataURL(file);
  };

  const handleToggleRecording = async () => {
    if (isRecording) {
      cleanupRecordingResources();
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatusTone('error');
      setStatusText('当前运行环境不支持麦克风录音，请使用「上传本地音频」导入已录好的 WAV/MP3 声纹样本。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const supportedMime = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingStartRef.current = Date.now();
      setRecordingSeconds(0);
      setIsRecording(true);
      setStatusText(null);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordingChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        const elapsedSec = Math.max(1, Math.round((Date.now() - recordingStartRef.current) / 1000));
        const mime = recorder.mimeType || supportedMime || 'audio/webm';
        const blob = new Blob(recordingChunksRef.current, { type: mime });
        recordingChunksRef.current = [];
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {}
          });
          mediaStreamRef.current = null;
        }
        setIsRecording(false);

        if (blob.size === 0) {
          setStatusTone('error');
          setStatusText('未录制到有效音频，请检查麦克风权限或输入设备');
          return;
        }

        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : '';
          if (!dataUrl.startsWith('data:')) return;
          const probedDuration = await probeAudioDurationFromSrc(dataUrl);
          const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
          const recName = `mic_voiceprint_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${ext}`;
          setPendingSampleDataUrl(dataUrl);
          setSampleFileName(recName);
          setSampleMimeType(mime);
          setSampleDuration(probedDuration || elapsedSec);
          setCloneVoiceId('');
          replacePreviewObjectUrl(dataUrl, false);
          if (!name.trim() || name === '个人预设音色档') {
            setName('克隆声纹');
          }
          setStatusTone('info');
          setStatusText(`录音完成 (${probedDuration || elapsedSec}秒)，点击底部「保存声纹克隆配置」后将自动绑定`);
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(250);
      recordingTimerRef.current = setInterval(() => {
        const secs = Math.max(0, Math.floor((Date.now() - recordingStartRef.current) / 1000));
        setRecordingSeconds(secs);
        if (secs >= 45 && mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 300);
    } catch (err: any) {
      cleanupRecordingResources();
      setStatusTone('error');
      setStatusText(`无法启动麦克风录音：${err?.message || '请检查系统麦克风权限'}`);
    }
  };

  const handleClearSample = async () => {
    const existingId = sampleId;
    setPendingSampleDataUrl(null);
    setSampleId('');
    setSampleFileName('');
    setSampleMimeType('');
    setSampleDuration(undefined);
    setCloneVoiceId('');
    replacePreviewObjectUrl(null, false);
    if (existingId) {
      await deleteVoiceprintSample(existingId);
    }
    setStatusTone('info');
    setStatusText('已移除当前声纹样本，可重新上传或录制新的个人音频');
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (isRecording) {
      setStatusTone('error');
      setStatusText('请先停止麦克风录音，再保存配置');
      return;
    }

    const resolvedTtsModel = resolveCloneModelForProvider(ttsModel, selectedCloneProviderMeta.defaultModel);

    const hasSample = Boolean(pendingSampleDataUrl || sampleId || voiceprint?.sampleAudioUrl || cloneVoiceId.trim());
    if (!hasSample) {
      setStatusTone('error');
      setStatusText('请先上传本地音频文件或录制一段个人声纹样本（或填写已有的 Voice ID）。');
      return;
    }

    const trimmedUrl = cloneGatewayUrl.trim().replace(/\/+$/, '');
    if (!trimmedUrl) {
      setStatusTone('error');
      setStatusText('请填写声纹克隆引擎服务地址（如 ElevenLabs / 硅基流动 CosyVoice / Fish Audio / 本地 GPT-SoVITS）。');
      return;
    }

    let isLocal = false;
    try {
      const u = new URL(trimmedUrl);
      isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
    } catch {
      setStatusTone('error');
      setStatusText('声纹克隆网关地址格式无效，请输入完整的 http:// 或 https:// 地址。');
      return;
    }

    const lowerUrl = trimmedUrl.toLowerCase();
    if (lowerUrl.includes('googleapis.com') || lowerUrl.includes('api.openai.com')) {
      setStatusTone('error');
      setStatusText('Google Gemini / OpenAI 官方接口不支持个人样本克隆，请切换为 ElevenLabs / CosyVoice / Fish Audio / 本地 GPT-SoVITS。');
      return;
    }

    if (!isLocal && !cloneApiKey.trim()) {
      setStatusTone('error');
      setStatusText('请填写该声纹克隆引擎的 API 密钥（本地 localhost 部署可留空）。');
      return;
    }

    setIsSaving(true);
    try {
      let finalSampleId = sampleId;
      let finalMime = sampleMimeType;
      if (pendingSampleDataUrl) {
        const uploadRes = await uploadVoiceprintSample(
          pendingSampleDataUrl,
          sampleFileName || undefined,
          sampleId || undefined
        );
        if (!uploadRes.ok || !uploadRes.sampleId) {
          setStatusTone('error');
          setStatusText(uploadRes.error || '上传声纹样本至服务端失败，请重试');
          return;
        }
        finalSampleId = uploadRes.sampleId;
        finalMime = uploadRes.mimeType || sampleMimeType;
        setSampleId(finalSampleId);
        setPendingSampleDataUrl(null);
      }

      const updated: MasterVoiceprint = {
        id: voiceprint?.id || 'master_' + Date.now(),
        name: (name.trim() === '个人预设音色档' || !name.trim()) ? '克隆声纹' : name.trim(),
        enabledAsDefault,
        pitch,
        rate,
        timbreTag: `个人声纹样本克隆 · ${selectedCloneProviderMeta.label.split(' ')[0]}`,
        baseVoice: voiceprint?.baseVoice || 'Kore',
        gender: voiceprint?.gender || 'female',
        ttsModel: resolvedTtsModel,
        cloneMode: 'voice_clone',
        sampleId: finalSampleId || undefined,
        sampleFileName: sampleFileName || undefined,
        sampleMimeType: finalMime || undefined,
        duration: sampleDuration,
        recordedAt: voiceprint?.recordedAt || Date.now(),
        sampleTranscript: sampleTranscript.trim() || undefined,
        cloneProvider,
        cloneGatewayUrl: trimmedUrl,
        cloneApiKey: cloneApiKey.trim() || undefined,
        hasCloneApiKey: Boolean(cloneApiKey.trim()),
        cloneVoiceId: cloneVoiceId.trim() || undefined,
        updatedAt: Date.now(),
      };

      const saveRes = saveMasterVoiceprint(updated);
      if (!saveRes.success) {
        setStatusTone('error');
        setStatusText(saveRes.error || '保存失败，存储不可用');
        return;
      }
      setVoiceprint(updated);
      setTtsModel(resolvedTtsModel);
      onVoiceprintSaved?.(updated);
      if (embedded) {
        setStatusTone('info');
        setStatusText('个人声纹克隆模型已保存，后续发送语音将默认使用此克隆声纹');
        setTimeout(() => setStatusText(null), 3500);
      } else {
        onClose();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const hasAnySampleAudio = Boolean(previewAudioUrl || sampleId || pendingSampleDataUrl);

  const innerContent = (
    <>
      {/* Header (Standalone Modal Mode Only) */}
      {!embedded && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2481cc]/12 dark:bg-[#2ba0ff]/12 aurora:bg-[#14b8a6]/15 linen:bg-[#a86a43]/15 border border-[#2481cc]/25 dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/30 linen:border-[#a86a43]/30 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] flex items-center justify-center">
              <AudioWaveform className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] tracking-wide">
                真人声纹样本克隆配置
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-black/5 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Body Content */}
      <div className={`${embedded ? 'p-4 space-y-3.5 flex-1' : 'p-5 space-y-4 max-h-[74vh]'} overflow-y-auto`}>
        {/* Status Alert */}
        {statusText && (
          <div
            className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 leading-relaxed ${
              statusTone === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                : 'bg-[#e8f3ff] dark:bg-[#2ba0ff]/10 aurora:bg-[#112d36] linen:bg-[#a86a43]/15 border-[#bfdbfe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/35 linen:border-[#a86a43]/35 text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d]'
            }`}
          >
            <AudioWaveform className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{statusText}</span>
          </div>
        )}

        {/* Capability Notice */}
        <div className="p-3 rounded-xl bg-[#e8f3ff]/75 dark:bg-[#2ba0ff]/10 aurora:bg-[#112d36]/80 linen:bg-[#a86a43]/12 border border-[#bfdbfe] dark:border-[#2ba0ff]/25 aurora:border-[#2dd4bf]/30 linen:border-[#a86a43]/30 text-[11px] text-[#334155] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32] flex items-start gap-2 leading-relaxed">
          <Info className="w-4 h-4 text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] shrink-0 mt-0.5" />
          <span>
            上传或录制一段 <strong>5~30 秒清晰人声样本</strong>并绑定支持零样本复刻的语音引擎（ElevenLabs / 硅基流动 CosyVoice / Fish Audio / 本地 GPT-SoVITS）。保存后，后续每次发送语音消息都会自动以该克隆声纹作为默认声音模型。
          </span>
        </div>

        {/* Profile Summary Card */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] space-y-3">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none border-b border-transparent focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] w-full"
              placeholder="输入克隆声纹名称"
            />
            <div className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] flex items-center gap-1.5 mt-0.5 truncate">
              <span>{selectedCloneProviderMeta.label.split(' ')[0]} 声纹克隆</span>
              <span>·</span>
              <span className="font-mono text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] truncate">
                {sampleFileName || (cloneVoiceId ? `ID: ${cloneVoiceId}` : '待上传/录制样本')}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] text-[11px]">
            <div className="text-center">
              <div className="text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] text-[10px]">
                声纹来源
              </div>
              <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] mt-0.5 truncate">
                {hasAnySampleAudio
                  ? `${sampleDuration ? `${sampleDuration}s ` : ''}个人样本`
                  : cloneVoiceId
                  ? '已填 Voice ID'
                  : '未上传'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] text-[10px]">语速 / 音高</div>
              <div className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] mt-0.5 tabular-nums">
                {rate.toFixed(2)}x / {pitch.toFixed(2)}x
              </div>
            </div>
            <div className="text-center">
              <div className="text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] text-[10px]">应用状态</div>
              <div className="font-medium text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] mt-0.5">
                {voiceprint ? (enabledAsDefault ? '默认配置' : '已保存') : '待保存'}
              </div>
            </div>
          </div>
        </div>

        {/* Voice Clone Sample Upload / Mic Recording Section */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] flex items-center gap-1.5">
                <AudioWaveform className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                <span>个人声纹样本采集 (5~30秒清晰人声)</span>
              </span>
              {hasAnySampleAudio && (
                <button
                  type="button"
                  onClick={() => void handleClearSample()}
                  className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>移除样本</span>
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
              onChange={handleAudioFileSelected}
              className="hidden"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isRecording}
                onClick={() => fileInputRef.current?.click()}
                className="py-2 px-3 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] hover:border-[#2481cc] dark:hover:border-[#2ba0ff] aurora:hover:border-[#2dd4bf] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                <span>上传本地音频文件</span>
              </button>

              <button
                type="button"
                onClick={() => void handleToggleRecording()}
                className={`py-2 px-3 rounded-lg border font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  isRecording
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300 animate-pulse'
                    : 'bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] hover:border-[#2481cc] dark:hover:border-[#2ba0ff] aurora:hover:border-[#2dd4bf] text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]'
                }`}
              >
                {isRecording ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span className="tabular-nums">停止录音 ({recordingSeconds}s)</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
                    <span>麦克风现场录制</span>
                  </>
                )}
              </button>
            </div>

            {previewAudioUrl && (
              <div className="p-2.5 rounded-lg bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-[#475569] dark:text-[#b4c6d8] aurora:text-[#b7d0d8] linen:text-[#4e3f32]">
                  <span className="truncate font-medium">
                    {sampleFileName || '已保存的个人声纹样本'}
                  </span>
                  <span className="text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] shrink-0 tabular-nums">
                    {sampleDuration ? `${sampleDuration} 秒` : ''} {pendingSampleDataUrl ? '· 待保存' : sampleId ? '· 已持久化' : ''}
                  </span>
                </div>
                <audio controls src={previewAudioUrl} className="w-full h-8" />
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                <span>参考音频原文 (用于提升声纹对齐准确度)</span>
                <span>CosyVoice / GPT-SoVITS 建议填写</span>
              </div>
              <textarea
                rows={2}
                value={sampleTranscript}
                onChange={(e) => setSampleTranscript(e.target.value)}
                placeholder="请输入您在样本音频中朗读的原话内容（例如：你好，今天天气真不错，很高兴认识你。）"
                className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-3 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43] resize-none"
              />
            </div>

            {/* Clone Provider & Credentials */}
            <div className="pt-2 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
                  声纹克隆推理引擎
                </span>
                <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">真实参考音频克隆</span>
              </div>

              <select
                value={cloneProvider}
                onChange={(e) => handleSelectCloneProvider(e.target.value as VoiceCloneProvider)}
                className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-3 py-1.5 text-xs text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
              >
                {VOICE_CLONE_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>

              <p className="text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] leading-snug">
                {selectedCloneProviderMeta.hint}
              </p>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                  <span>克隆服务接入网址 (Base URL)</span>
                  <button
                    type="button"
                    onClick={() => setCloneGatewayUrl(selectedCloneProviderMeta.defaultUrl)}
                    className="text-[#0284c7] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] hover:underline cursor-pointer"
                  >
                    填入默认地址
                  </button>
                </div>
                <input
                  type="text"
                  value={cloneGatewayUrl}
                  onChange={(e) => setCloneGatewayUrl(e.target.value)}
                  placeholder={selectedCloneProviderMeta.defaultUrl}
                  className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-3 py-1.5 text-xs font-mono text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                  <span>克隆引擎 API 密钥 (Key)</span>
                  <span>本地 GPT-SoVITS 可留空</span>
                </div>
                <div className="relative">
                  <input
                    type={showCloneApiKey ? 'text' : 'password'}
                    value={cloneApiKey}
                    onChange={(e) => setCloneApiKey(e.target.value)}
                    placeholder="填写 ElevenLabs / 硅基流动 / Fish Audio API Key"
                    className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg pl-3 pr-9 py-1.5 text-xs font-mono text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCloneApiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748b] dark:text-[#7b93ad] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] linen:hover:text-[#2b2118] cursor-pointer"
                  >
                    {showCloneApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
                  <span>已注册 Voice ID / URI（可选，首次合成后自动缓存）</span>
                </div>
                <input
                  type="text"
                  value={cloneVoiceId}
                  onChange={(e) => setCloneVoiceId(e.target.value)}
                  placeholder="留空则在首次合成时自动上传样本生成并绑定"
                  className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-3 py-1.5 text-xs font-mono text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
                />
              </div>
            </div>
          </div>

        {/* TTS Model Selector */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
              语音合成模型型号
            </span>
            <span className="text-[10px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">支持自由输入</span>
          </div>

          <input
            type="text"
            value={ttsModel}
            onChange={(e) => setTtsModel(e.target.value)}
            placeholder={`输入克隆模型型号，默认：${selectedCloneProviderMeta.defaultModel}`}
            className="w-full bg-white dark:bg-[#08101a] aurora:bg-[#081014] linen:bg-[#faf5ec] border border-[#cbd5e1] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#cbbba2] rounded-lg px-3 py-1.5 text-xs font-mono text-[#0284c7] dark:text-[#7cc4ff] aurora:text-[#5eead4] linen:text-[#8c522d] placeholder-[#94a3b8] dark:placeholder-[#4e657e] aurora:placeholder-[#5a7782] linen:placeholder-[#8f7e6c] focus:outline-none focus:border-[#2481cc] dark:focus:border-[#2ba0ff] aurora:focus:border-[#2dd4bf] linen:focus:border-[#a86a43]"
          />

          <p className="text-[10.5px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] flex items-center gap-1.5 leading-snug">
            <Link className="w-3 h-3 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d] shrink-0" />
            <span>
              真人声纹克隆模式将直接使用上方配置的支持参考音频复刻的引擎网址与密钥。
            </span>
          </p>
        </div>

        {/* ffmpeg Audio Parameters */}
        <div className="p-3.5 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] space-y-3 text-xs">
          <span className="font-medium text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-[#2481cc] dark:text-[#2ba0ff] aurora:text-[#2dd4bf] linen:text-[#8c522d]" />
            <span>音频参数（ffmpeg 实效微调）</span>
          </span>

          {/* Pitch */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
              <span>音高基线 (ffmpeg 实效变调)</span>
              <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] font-medium tabular-nums">{pitch.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.2"
              step="0.05"
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-full h-1 bg-[#cbd5e1] dark:bg-[#1e3148] aurora:bg-[#203742] linen:bg-[#d7c8b0] rounded-lg appearance-none cursor-pointer accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] linen:accent-[#a86a43]"
            />
          </div>

          {/* Rate */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
              <span>语速节奏 (ffmpeg 实效变速)</span>
              <span className="text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118] font-medium tabular-nums">{rate.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.2"
              step="0.05"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-full h-1 bg-[#cbd5e1] dark:bg-[#1e3148] aurora:bg-[#203742] linen:bg-[#d7c8b0] rounded-lg appearance-none cursor-pointer accent-[#2481cc] dark:accent-[#2ba0ff] aurora:accent-[#14b8a6] linen:accent-[#a86a43]"
            />
          </div>
        </div>

        {/* Global Default Toggle */}
        <div className="p-3 rounded-xl bg-[#f8fafc] dark:bg-[#0e1726]/85 aurora:bg-[#101c23]/90 linen:bg-[#efe6d6]/90 border border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
            发语音时默认使用此克隆声纹
          </div>
          <button
            type="button"
            onClick={() => setEnabledAsDefault(!enabledAsDefault)}
            className={`w-10 h-5.5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
              enabledAsDefault ? 'bg-[#2481cc] dark:bg-[#2ba0ff] aurora:bg-[#0d9488] linen:bg-[#a86a43]' : 'bg-[#cbd5e1] dark:bg-[#1e3148] aurora:bg-[#203742] linen:bg-[#d7c8b0]'
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
      <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8f0] dark:border-[#18273a] aurora:border-[#182b34] linen:border-[#dfd2bc] bg-[#f8fafc] dark:bg-[#0d1726] aurora:bg-[#0e1920] linen:bg-[#f0e6d5] shrink-0">
        {!embedded ? (
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a] hover:text-[#0f172a] dark:hover:text-[#eef4fb] aurora:hover:text-[#ecf6f8] linen:hover:text-[#2b2118] hover:bg-black/5 dark:hover:bg-[#152438] aurora:hover:bg-[#152934] linen:hover:bg-[#e7dccb] transition-colors cursor-pointer"
          >
            取消
          </button>
        ) : (
          <span className="text-[11px] text-[#64748b] dark:text-[#7b93ad] aurora:text-[#7e9aa5] linen:text-[#6e5c4a]">
            {voiceprint ? '已配置个人声纹克隆模型' : '上传或录制声纹样本后保存'}
          </span>
        )}

        <button
          type="button"
          disabled={isSaving || isRecording}
          onClick={() => void handleSave()}
          className="px-4 py-2 rounded-lg bg-[#2481cc] hover:bg-[#1d6fb3] dark:bg-[#2ba0ff] dark:hover:bg-[#1e8ee8] aurora:bg-[#0d9488] linen:bg-[#a86a43] aurora:hover:bg-[#0f766e] linen:hover:bg-[#8f5734] text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          <span>保存声纹克隆配置</span>
        </button>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-full min-h-0 select-none text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
        {innerContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 dark:bg-black/75 aurora:bg-black/80 backdrop-blur-xs animate-in fade-in duration-150 select-none">
      <div className="relative w-full max-w-md bg-white dark:bg-[#0b131f] aurora:bg-[#0c151b] linen:bg-[#f8f2e7] border border-[#e2e8f0] dark:border-[#1e3148] aurora:border-[#203742] linen:border-[#d5c6ae] rounded-xl shadow-xl linen:shadow-sm flex flex-col overflow-hidden text-[#0f172a] dark:text-[#eef4fb] aurora:text-[#ecf6f8] linen:text-[#2b2118]">
        {innerContent}
      </div>
    </div>
  );
};
