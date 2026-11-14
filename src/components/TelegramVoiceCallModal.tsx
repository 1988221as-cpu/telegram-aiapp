import React, { useState, useEffect, useRef } from 'react';
import { PhoneOff, Mic, MicOff, Volume2, VolumeX, Shield, AlertCircle } from 'lucide-react';
import { Chat } from '../types';
import {
  startTelegramVoiceCallApi,
  getTelegramVoiceCallStatusApi,
  endTelegramVoiceCallApi,
} from '../services/apiService';

interface TelegramVoiceCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  chat?: Chat | null;
  currentAccountId?: string;
  contactName?: string;
  avatarBg?: string;
  avatarInitial?: string;
}

export const TelegramVoiceCallModal: React.FC<TelegramVoiceCallModalProps> = ({
  isOpen,
  onClose,
  chat,
  currentAccountId,
  contactName,
  avatarBg,
  avatarInitial,
}) => {
  const [callStatus, setCallStatus] = useState<'calling' | 'ringing' | 'connected' | 'ended'>('calling');
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [statusNotice, setStatusNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const timerRef = useRef<any>(null);
  const pollRef = useRef<any>(null);
  const callIdRef = useRef<string>('');
  const durationRef = useRef<number>(0);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (!isOpen) {
      setCallStatus('calling');
      setDuration(0);
      setStatusNotice('');
      setErrorMsg('');
      callIdRef.current = '';
      clearInterval(timerRef.current);
      clearInterval(pollRef.current);
      return;
    }

    let cancelled = false;

    (async () => {
      const startRes = await startTelegramVoiceCallApi({
        accountId: currentAccountId,
        chatId: chat?.id,
        username: chat?.username,
      });

      if (cancelled) return;

      if (!startRes.ok || !startRes.callId) {
        setCallStatus('ended');
        setErrorMsg(startRes.error || '未能发起 Telegram 云端语音呼叫');
        return;
      }

      callIdRef.current = startRes.callId;
      setCallStatus('ringing');

      pollRef.current = setInterval(async () => {
        if (!callIdRef.current || cancelled) return;
        const st = await getTelegramVoiceCallStatusApi(callIdRef.current, currentAccountId);
        if (cancelled) return;
        if (st.status === 'accepted') {
          setCallStatus((prev) => {
            if (prev !== 'connected') {
              clearInterval(timerRef.current);
              timerRef.current = setInterval(() => {
                setDuration((d) => d + 1);
              }, 1000);
            }
            return 'connected';
          });
          setStatusNotice('Telegram 云端呼叫信令已接通（Web 端暂不支持直连音频流，请使用语音条）');
        } else if (st.status === 'discarded' || st.status === 'failed') {
          clearInterval(timerRef.current);
          clearInterval(pollRef.current);
          setCallStatus('ended');
          setStatusNotice(st.endedReason || '对方已挂断或未接听');
          setTimeout(() => {
            if (!cancelled) onClose();
          }, 1400);
        }
      }, 1200);
    })();

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      clearInterval(pollRef.current);
      if (callIdRef.current) {
        void endTelegramVoiceCallApi(callIdRef.current, durationRef.current, currentAccountId);
        callIdRef.current = '';
      }
    };
  }, [isOpen, currentAccountId, chat?.id, chat?.username]);

  const handleEndCall = async () => {
    clearInterval(timerRef.current);
    clearInterval(pollRef.current);
    setCallStatus('ended');
    if (callIdRef.current) {
      const activeId = callIdRef.current;
      callIdRef.current = '';
      await endTelegramVoiceCallApi(activeId, durationRef.current, currentAccountId);
    }
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen || (!chat && !contactName)) return null;

  const displayName = chat?.title || contactName || 'Telegram 用户';
  const displayAvatarBg = chat?.avatarBg || avatarBg || '#2481cc';
  const displayAvatarInitial = chat?.avatarInitial || avatarInitial || displayName.slice(0, 2).toUpperCase();
  const displayAvatarUrl = chat?.avatarUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#182533] to-[#0e1621] text-white p-6 shadow-2xl border border-white/10 flex flex-col items-center">
        {/* Top Encryption Indicator */}
        <div className="flex items-center gap-1.5 text-[11px] text-white/70 font-medium mb-6">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          <span>Telegram 云端语音呼叫</span>
        </div>

        {/* Contact Avatar with Animated Pulse Ring */}
        <div className="relative my-4">
          <div
            className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center text-3xl font-bold shadow-2xl border-4 border-white/20 relative z-10"
            style={{ backgroundColor: displayAvatarBg }}
          >
            {displayAvatarUrl ? (
              <img src={displayAvatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span>{displayAvatarInitial}</span>
            )}
          </div>
          {callStatus === 'connected' && (
            <div className="absolute inset-0 rounded-full border-4 border-[#2481cc]/40 animate-ping pointer-events-none" />
          )}
          {(callStatus === 'calling' || callStatus === 'ringing') && (
            <div className="absolute -inset-2 rounded-full border-2 border-emerald-400/40 animate-pulse pointer-events-none" />
          )}
        </div>

        {/* Contact Name & Status */}
        <h3 className="text-xl font-bold text-center mt-3 truncate max-w-[240px] text-white">
          {displayName}
        </h3>
        <p className="text-sm font-medium mt-1 text-[#2ba0ff] tabular-nums">
          {callStatus === 'calling' && '正在连接 Telegram 云端呼叫...'}
          {callStatus === 'ringing' && '对方客户端正在响铃（等待接听）...'}
          {callStatus === 'connected' && `已接通 ${formatDuration(duration)}`}
          {callStatus === 'ended' && (errorMsg ? '呼叫未能建立' : statusNotice || '通话已结束')}
        </p>

        {errorMsg && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-red-500/15 border border-red-400/30 text-red-300 text-xs flex items-center gap-2 text-left w-full">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!errorMsg && statusNotice && (
          <p className="mt-2 text-[11px] text-amber-300/90 text-center leading-relaxed px-2">
            {statusNotice}
          </p>
        )}

        {/* Call Waveform Animation */}
        {callStatus === 'connected' ? (
          <div className="flex items-center gap-1 my-6 h-6">
            <span className="w-1 bg-[#2ba0ff] rounded-full animate-pulse h-4" />
            <span className="w-1 bg-[#2ba0ff] rounded-full animate-pulse h-6 [animation-delay:150ms]" />
            <span className="w-1 bg-[#2ba0ff] rounded-full animate-pulse h-3 [animation-delay:300ms]" />
            <span className="w-1 bg-[#2ba0ff] rounded-full animate-pulse h-5 [animation-delay:450ms]" />
            <span className="w-1 bg-[#2ba0ff] rounded-full animate-pulse h-4 [animation-delay:200ms]" />
          </div>
        ) : (
          <div className="h-6 my-6" />
        )}

        {/* Action Controls */}
        <div className="flex items-center gap-6 mt-4">
          {/* Mute Button */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              isMuted ? 'bg-red-500/80 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title={isMuted ? '取消静音' : '静音'}
          >
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>

          {/* End Call Button */}
          <button
            onClick={handleEndCall}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-105 cursor-pointer"
            title="挂断电话"
          >
            <PhoneOff className="w-7 h-7" />
          </button>

          {/* Speaker Button */}
          <button
            onClick={() => setIsSpeakerOn(!isSpeakerOn)}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              isSpeakerOn ? 'bg-[#2481cc] text-white' : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title={isSpeakerOn ? '扬声器开' : '听筒模式'}
          >
            {isSpeakerOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  );
};
